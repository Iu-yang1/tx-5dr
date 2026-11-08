import { useEffect, useRef } from 'react';
import { api } from '@tx5dr/core';
import { useConnection, useCurrentOperatorId, useOperators, useRadioModeState } from '../../../store/radioStore';

/**
 * Native RX preferences are now server-owned and applied only on authorized
 * explicit saves. This component must never restart a shared Q65 receiver from
 * browser localStorage, especially during multi-period EME averaging.
 *
 * Q65 AP hypotheses remain dynamic, but one browser session holds a short
 * server-side lease so independent operator tabs cannot overwrite each other.
 */
export function shouldUpdateNativeQ65Ap(
  previous: { generation: number; key: string } | null,
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
  const operator = operators.find(item => item.id === currentOperatorId);
  const apCall = operator?.context?.myCall?.trim().toUpperCase() ?? '';
  const apGrid = operator?.context?.myGrid?.trim().toUpperCase() ?? '';
  const apDx = operator?.context?.targetCall?.trim().toUpperCase() ?? '';
  const apDxGrid = operator?.context?.targetGrid?.trim().toUpperCase() ?? '';
  const lastApRef = useRef<{ generation: number; key: string } | null>(null);
  const clientId = useRef('native-ap-' + Math.random().toString(36).slice(2) +
    '-' + Math.random().toString(36).slice(2));

  useEffect(() => {
    if (currentMode?.name !== 'Q65' || !connection.isConnected) {
      lastApRef.current = null;
      return;
    }
    const key = [apCall, apGrid, apDx, apDxGrid].join('|');
    const context = apCall && apGrid && apDx ? {
      myCall: apCall, myGrid: apGrid, dxCall: apDx,
      ...(apDxGrid ? { dxGrid: apDxGrid } : {}),
      progress: 0 as const,
    } : null;
    let cancelled = false;
    let pending = false;
    const sync = () => {
      if (cancelled || pending || (!context && !lastApRef.current)) return;
      pending = true;
      void api.getMfskLiveRxEvents(0).then(async response => {
        if (cancelled || !response.status.running ||
          response.status.mode !== 'Q65' || !response.status.ready) return;
        // Renew the owner's lease even if the context has not changed. The
        // backend avoids sending repeated identical AP updates to the worker.
        await api.updateMfskLiveRxApContext(context, clientId.current);
        if (!cancelled) {
          lastApRef.current = { generation: response.status.generation, key };
        }
      }).catch(() => {
        // Another browser may currently own Q65 AP; never restart RX to win.
      }).finally(() => { pending = false; });
    };
    sync();
    const timer = setInterval(sync, 1750);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [connection.isConnected, currentMode?.name, apCall, apGrid, apDx, apDxGrid]);
  return null;
}
