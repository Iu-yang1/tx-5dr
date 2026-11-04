import { useEffect, useRef } from 'react';
import { api } from '@tx5dr/core';
import { useConnection, useCurrentOperatorId, useOperators, useRadioModeState } from '../../../store/radioStore';
import {
  DECODE_PREFERENCES_CHANGED_EVENT,
  DEFAULT_NATIVE_DECODE_PREFERENCES,
  loadNativeDecodePreferences,
  NATIVE_DIGITAL_MODES,
  type NativeDigitalMode,
  type NativeDecodePreferences,
} from './digitalDecodePreferences';

export function needsNativeRxReconfigure(prefs: NativeDecodePreferences): boolean {
  const defaults = DEFAULT_NATIVE_DECODE_PREFERENCES;
  return prefs.frequencyHz !== defaults.frequencyHz
    || prefs.toleranceHz !== defaults.toleranceHz
    || prefs.depth !== defaults.depth
    || prefs.q65Submode !== defaults.q65Submode
    || prefs.averaging !== defaults.averaging
    || prefs.emeDelay !== defaults.emeDelay
    || (prefs.mskMyCall !== '' && prefs.mskDxCall !== ''
      && (prefs.mskShorthand || prefs.mskAdaptiveEqualizer));
}

/**
 * Headless settings synchronizer for the original FT8/FT4-style workbench.
 * EngineLifecycle owns receiver startup. We reconfigure only after it is ready
 * and when the stored parameters actually differ; no extra UI is created.
 */
export function NativeDigitalRxPreferencesSync() {
  const { currentMode } = useRadioModeState();
  const { state: connection } = useConnection();
  const { currentOperatorId } = useCurrentOperatorId();
  const { operators } = useOperators();
  const mode = NATIVE_DIGITAL_MODES.includes(currentMode?.name as NativeDigitalMode)
    ? currentMode!.name as NativeDigitalMode : null;
  const operator = operators.find(item => item.id === currentOperatorId);
  const apCall = operator?.context?.myCall?.trim().toUpperCase() ?? '';
  const apGrid = operator?.context?.myGrid?.trim().toUpperCase() ?? '';
  const apDx = operator?.context?.targetCall?.trim().toUpperCase() ?? '';
  const apDxGrid = operator?.context?.targetGrid?.trim().toUpperCase() ?? '';
  const lastAppliedRef = useRef<{mode:NativeDigitalMode; generation:number; fingerprint:string} | null>(null);
  const lastApRef = useRef('');

  useEffect(() => {
    if (!mode || !connection.isConnected) return;
    let cancelled = false;
    let busy = false;
    const maybeApply = () => {
      if (cancelled || busy) return;
      const prefs = loadNativeDecodePreferences(mode);
      const fingerprint = JSON.stringify(prefs);
      void api.getMfskLiveRxEvents(0).then(async response => {
        if (cancelled || busy || !response.status.running
          || !response.status.ready || response.status.mode !== mode) return;
        const last = lastAppliedRef.current;
        if (last?.mode === mode && last.generation === response.status.generation
          && last.fingerprint === fingerprint) return;
        // No need to tear down a fresh default session.
        if (!last && !needsNativeRxReconfigure(prefs)
          && (mode !== 'Q65' || response.status.q65Submode === prefs.q65Submode)) {
          lastAppliedRef.current = {mode,generation:response.status.generation,fingerprint};
          return;
        }
        busy = true;
        try {
          const config = {
            mode, frequencyHz:prefs.frequencyHz, toleranceHz:prefs.toleranceHz,depth:prefs.depth,
            ...(mode === 'Q65' ? {
              q65Submode:prefs.q65Submode,
              averaging:prefs.averaging,
              emeDelay:prefs.emeDelay,
            } : {}),
            ...(mode === 'MSK144' && prefs.mskMyCall && prefs.mskDxCall ? {
              msk144Rx:{
                myCall:prefs.mskMyCall,dxCall:prefs.mskDxCall,
                shorthand:prefs.mskShorthand && prefs.toleranceHz <= 250,
                adaptiveEqualizer:prefs.mskAdaptiveEqualizer,
              },
            } : {}),
          };
          const next = await api.startMfskLiveRx(config);
          if (!cancelled) lastAppliedRef.current = {
            mode, generation:next.generation, fingerprint,
          };
        } catch {
          // Keep the prior receiver and retry after the next status poll.
        } finally {
          busy = false;
        }
      }).catch(() => { /* unavailable during engine transitions */ });
    };
    const changed = (event: Event) => {
      const change = (event as CustomEvent<{mode:NativeDigitalMode}>).detail;
      if (change?.mode === mode) maybeApply();
    };
    lastAppliedRef.current = null;
    maybeApply();
    const timer = setInterval(maybeApply, 1750);
    window.addEventListener(DECODE_PREFERENCES_CHANGED_EVENT, changed);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener(DECODE_PREFERENCES_CHANGED_EVENT, changed);
    };
  }, [connection.isConnected,mode]);

  // Q65 AP follows the same operator target/configuration as FT8/FT4,
  // without restarting and discarding a potentially long EME averaging period.
  useEffect(() => {
    if (mode !== 'Q65' || !connection.isConnected) return;
    const key = [apCall,apGrid,apDx,apDxGrid].join('|');
    if (lastApRef.current === key) return;
    const context = apCall && apGrid && apDx ? {
      myCall:apCall,myGrid:apGrid,dxCall:apDx,
      ...(apDxGrid ? {dxGrid:apDxGrid} : {}),
      progress:0 as const,
    } : null;
    let cancelled = false;
    void api.getMfskLiveRxEvents(0).then(response => {
      if (cancelled || response.status.mode !== 'Q65' || !response.status.ready) return;
      return api.updateMfskLiveRxApContext(context).then(() => {
        if (!cancelled) lastApRef.current = key;
      });
    }).catch(() => { /* reattempt when operator target changes */ });
    return () => { cancelled = true; };
  }, [connection.isConnected,mode,apCall,apGrid,apDx,apDxGrid]);
  return null;
}
