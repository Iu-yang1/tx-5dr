import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from '@tx5dr/core';
import type { DigitalRxEvent, MfskLiveRxStatus } from '@tx5dr/contracts';
import { useCan } from '../store/authStore';
import { useCurrentOperatorId } from '../store/radioStore';
import { NATIVE_DIGITAL_SELECTION_EVENT, type NativeDigitalSelection } from '../components/radio/digital/nativeDigitalSelection';

export type JttyTxPhase = 'idle' | 'processing' | 'transmitting' | 'complete' | 'stopped' | 'failed';

interface JttyState {
  events: DigitalRxEvent[];
  rxStatus: MfskLiveRxStatus | null;
  afHz: string;
  setAfHz(value: string): void;
  txPhase: JttyTxPhase;
  txBusy: boolean;
  txError: string | null;
  canTransmit: boolean;
  send(text: string): Promise<boolean>;
  stop(): Promise<void>;
}

const JttyContext = createContext<JttyState | null>(null);

/** JTTY has independent receive and whole-message TX state; it never owns the RTTY keyer. */
export function JttyProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  const { currentOperatorId } = useCurrentOperatorId();
  const allowed = useCan('execute', 'RadioControl');
  const [events, setEvents] = useState<DigitalRxEvent[]>([]);
  const [rxStatus, setRxStatus] = useState<MfskLiveRxStatus | null>(null);
  const [afHz, setAfHz] = useState('1700');
  const [txPhase, setTxPhase] = useState<JttyTxPhase>('idle');
  const [txBusy, setTxBusy] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const stopRevisionRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const update = (event: Event) => {
      const detail = (event as CustomEvent<NativeDigitalSelection>).detail;
      if (detail?.mode === 'JTTY' && Number.isFinite(detail.audioHz) && detail.audioHz >= 100 && detail.audioHz <= 5500) {
        setAfHz(String(Math.round(detail.audioHz)));
      }
    };
    window.addEventListener(NATIVE_DIGITAL_SELECTION_EVENT, update);
    return () => window.removeEventListener(NATIVE_DIGITAL_SELECTION_EVENT, update);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const result = await api.getMfskLiveRxEvents(0);
        if (!active) return;
        setRxStatus(result.status.mode === 'JTTY' ? result.status : null);
        setEvents(result.status.mode === 'JTTY' ? result.events : []);
      } catch {
        if (active) setRxStatus(null);
      } finally {
        polling = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1200);
    return () => { active = false; window.clearInterval(timer); };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const poll = async () => {
      try {
        const result = await api.getMfskNativeTxStatus(currentOperatorId ?? undefined);
        if (!active) return;
        setTxBusy(result.busy);
        if (result.busy) setTxPhase('transmitting');
        else setTxPhase(phase => phase === 'transmitting' ? 'complete' : phase);
      } catch {
        if (active) setTxBusy(false);
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1200);
    return () => { active = false; window.clearInterval(timer); };
  }, [currentOperatorId, enabled]);

  const canTransmit = enabled && allowed && Boolean(currentOperatorId);
  const send = useCallback(async (text: string): Promise<boolean> => {
    if (!canTransmit || !currentOperatorId || pendingRef.current || txBusy) return false;
    const frequency = Number(afHz);
    if (!Number.isFinite(frequency) || frequency < 100 || frequency > 5500 || !text.trim() || text.length > 64) {
      setTxError('invalid');
      setTxPhase('failed');
      return false;
    }
    pendingRef.current = true;
    const sendRevision = stopRevisionRef.current;
    setTxPhase('processing');
    setTxError(null);
    try {
      await api.transmitMfsk({ mode: 'JTTY', operatorId: currentOperatorId, text: text.trim(), audioHz: frequency });
      if (sendRevision !== stopRevisionRef.current) return false;
      setTxPhase('complete');
      return true;
    } catch (error) {
      if (sendRevision !== stopRevisionRef.current) return false;
      setTxError(error instanceof Error ? error.message : String(error));
      setTxPhase('failed');
      return false;
    } finally {
      pendingRef.current = false;
    }
  }, [afHz, canTransmit, currentOperatorId, txBusy]);

  const stop = useCallback(async () => {
    stopRevisionRef.current += 1;
    try {
      await api.disarmMfskNativeTx();
      setTxPhase('stopped');
      setTxError(null);
    } catch (error) {
      setTxPhase('failed');
      setTxError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  return <JttyContext.Provider value={{
    events, rxStatus, afHz, setAfHz, txPhase, txBusy, txError,
    canTransmit, send, stop,
  }}>{children}</JttyContext.Provider>;
}

export function useJtty(): JttyState {
  const context = useContext(JttyContext);
  if (!context) throw new Error('useJtty requires JttyProvider');
  return context;
}
