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

/** TX-phase and audio preferences must not restart or reset the active receiver. */
export function nativeRxPreferenceFingerprint(
  mode: NativeDigitalMode, prefs: NativeDecodePreferences,
): string {
  return JSON.stringify({
    frequencyHz: prefs.frequencyHz,
    ...(mode !== 'JTTY' ? { toleranceHz: prefs.toleranceHz, depth: prefs.depth } : {}),
    ...(mode === 'Q65' ? {
      q65Submode: prefs.q65Submode,
      q65TimeToleranceSec: prefs.q65TimeToleranceSec,
      q65SyncScore: prefs.q65SyncScore,
      q65MaxCandidates: prefs.q65MaxCandidates,
      averaging: prefs.averaging,
      emeDelay: prefs.emeDelay,
    } : {}),
    ...(mode === 'MSK144' ? {
      mskShorthand: prefs.mskShorthand,
      mskAdaptiveEqualizer: prefs.mskAdaptiveEqualizer,
      mskMyCall: prefs.mskMyCall,
      mskDxCall: prefs.mskDxCall,
    } : {}),
  });
}

export function needsNativeRxReconfigure(prefs: NativeDecodePreferences): boolean {
  const defaults = DEFAULT_NATIVE_DECODE_PREFERENCES;
  return prefs.frequencyHz !== defaults.frequencyHz
    || prefs.toleranceHz !== defaults.toleranceHz
    || prefs.depth !== defaults.depth
    || prefs.q65Submode !== defaults.q65Submode
    || prefs.averaging !== defaults.averaging
    || prefs.emeDelay !== defaults.emeDelay
    || prefs.q65TimeToleranceSec !== defaults.q65TimeToleranceSec
    || prefs.q65SyncScore !== defaults.q65SyncScore
    || prefs.q65MaxCandidates !== defaults.q65MaxCandidates
    || (prefs.mskMyCall !== '' && prefs.mskDxCall !== ''
      && (prefs.mskShorthand || prefs.mskAdaptiveEqualizer));
}

/**
 * Headless settings synchronizer for the original FT8/FT4-style workbench.
 * EngineLifecycle owns receiver startup. We reconfigure only after it is ready
 * and when the stored parameters actually differ; no extra UI is created.
 */
export function shouldUpdateNativeQ65Ap(
  previous: {generation:number;key:string}|null,
  generation: number,
  key: string,
): boolean {
  return previous?.generation !== generation || previous.key !== key;
}

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
  const lastApRef = useRef<{generation:number;key:string}|null>(null);

  useEffect(() => {
    if (!mode || !connection.isConnected) return;
    let cancelled = false;
    let busy = false;
    const maybeApply = () => {
      if (cancelled || busy) return;
      const prefs = loadNativeDecodePreferences(mode);
      const fingerprint = nativeRxPreferenceFingerprint(mode, prefs);
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
              q65Search: {
                ...(prefs.q65TimeToleranceSec !== null ? {
                  timeToleranceSeconds:prefs.q65TimeToleranceSec,
                } : {}),
                ...(prefs.q65SyncScore !== null ? {
                  scoreThreshold:prefs.q65SyncScore,
                } : {}),
                ...(prefs.q65MaxCandidates !== null ? {
                  maxCandidates:prefs.q65MaxCandidates,
                } : {}),
              },
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

  // A mode switch or receiver restart invalidates the previous AP context.
  // Retry while the native decoder is starting, without resetting long EME averaging.
  useEffect(() => {
    if (mode !== 'Q65' || !connection.isConnected) {
      lastApRef.current = null;
      return;
    }
    const key = [apCall,apGrid,apDx,apDxGrid].join('|');
    const context = apCall && apGrid && apDx ? {
      myCall:apCall,myGrid:apGrid,dxCall:apDx,
      ...(apDxGrid ? {dxGrid:apDxGrid} : {}),
      progress:0 as const,
    } : null;
    let cancelled = false;
    let pending = false;
    const sync = () => {
      if (cancelled || pending) return;
      pending = true;
      void api.getMfskLiveRxEvents(0).then(async response => {
        if (cancelled || !response.status.running ||
          response.status.mode !== 'Q65' || !response.status.ready) return;
        if (!shouldUpdateNativeQ65Ap(
          lastApRef.current, response.status.generation, key,
        )) return;
        await api.updateMfskLiveRxApContext(context);
        if (!cancelled) {
          lastApRef.current = {generation:response.status.generation,key};
        }
      }).catch(() => {
        // The decoder can be starting or transitioning; retry on next poll.
      }).finally(() => { pending = false; });
    };
    sync();
    const timer = setInterval(sync, 1750);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [connection.isConnected,mode,apCall,apGrid,apDx,apDxGrid]);
  return null;
}
