import { useEffect, useMemo, useState } from 'react';
import { api } from '@tx5dr/core';
import { Q65_PERIOD_MS, type Q65Submode, type SlotInfo } from '@tx5dr/contracts';
import {
  DECODE_PREFERENCES_CHANGED_EVENT,
  loadNativeDecodePreferences,
} from '../digital/digitalDecodePreferences';
import { getRadioOperatorProgressAnimation } from './radioOperatorProgress';

export type NativeTimedMode = 'Q65' | 'MSK144' | 'WSPR';

export interface NativeDisplayCycle {
  slotMs: number;
  slotInfo: SlotInfo;
}

/**
 * Display-only UTC phase, never a legacy FT8/FT4 decoder slot.
 * Q65 uses the receiver's confirmed submode; MSK144 shows its T/R interval.
 */
export function nativeDisplayCycle(
  mode: NativeTimedMode, nowMs: number, q65Submode: Q65Submode | null,
  mskPeriodSeconds: 5 | 10 | 15 | 30,
): NativeDisplayCycle | null {
  const slotMs = mode === 'WSPR' ? 120_000
    : mode === 'MSK144' ? mskPeriodSeconds * 1000
    : q65Submode ? Q65_PERIOD_MS[q65Submode] : null;
  if (!slotMs || !Number.isFinite(nowMs) || nowMs < 0) return null;
  const startMs = Math.floor(nowMs / slotMs) * slotMs;
  return {
    slotMs,
    slotInfo: {
      id: 'native-utc-' + mode + '-' + slotMs + '-' + startMs,
      startMs, phaseMs: nowMs - startMs, driftMs: 0,
      cycleNumber: Math.floor(nowMs / slotMs),
      utcSeconds: Math.floor(nowMs / 1000), mode,
    },
  };
}

/** Keep display refresh in a child so operator controls do not re-render. */
export function NativeOperatorProgress({
  mode, enabled, onAir,
}: { mode: NativeTimedMode; enabled: boolean; onAir: boolean }) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [q65Submode, setQ65Submode] = useState<Q65Submode | null>(null);
  const [mskPeriodSeconds, setMskPeriodSeconds] = useState<5 | 10 | 15 | 30>(
    () => loadNativeDecodePreferences('MSK144').mskPeriodSeconds,
  );

  useEffect(() => {
    if (!enabled) return;
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 400);
    return () => window.clearInterval(timer);
  }, [enabled, mode]);

  useEffect(() => {
    if (!enabled || mode !== 'Q65') return;
    let active = true;
    const poll = () => {
      void api.getMfskLiveRxStatus().then(status => {
        if (!active) return;
        setQ65Submode(status.ready && status.mode === 'Q65'
          ? status.q65Submode ?? 'Q65-60B' : null);
      }).catch(() => { if (active) setQ65Submode(null); });
    };
    setQ65Submode(null);
    poll();
    const timer = window.setInterval(poll, 1500);
    return () => { active = false; window.clearInterval(timer); };
  }, [enabled, mode]);

  useEffect(() => {
    if (!enabled || mode !== 'MSK144') return;
    const read = () => setMskPeriodSeconds(
      loadNativeDecodePreferences('MSK144').mskPeriodSeconds,
    );
    read();
    const onChange = (event: Event) => {
      if ((event as CustomEvent<{mode:string}>).detail?.mode === 'MSK144') read();
    };
    window.addEventListener(DECODE_PREFERENCES_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(DECODE_PREFERENCES_CHANGED_EVENT, onChange);
  }, [enabled, mode]);

  const cycle = nativeDisplayCycle(mode, nowMs, q65Submode, mskPeriodSeconds);
  const startMs = cycle?.slotInfo.startMs;
  const slotMs = cycle?.slotMs;
  // Animate only on UTC period changes, not after every 400ms status refresh.
  const animation = useMemo(() => {
    if (startMs === undefined || !slotMs) return { animation: 'none' };
    return getRadioOperatorProgressAnimation({
      id: 'native-' + startMs, startMs,
      phaseMs: Math.min(slotMs, Math.max(0, Date.now() - startMs)),
      driftMs: 0, cycleNumber: Math.floor(startMs / slotMs),
      utcSeconds: Math.floor(startMs / 1000), mode,
    }, slotMs);
  }, [startMs, slotMs, mode]);

  if (!enabled || !cycle) return null;
  return <>
    <div className="absolute inset-0 transition-colors duration-200" style={{
      backgroundColor: onAir ? 'hsl(var(--heroui-danger) / 0.15)'
        : cycle.slotInfo.cycleNumber % 2 === 0 ? 'var(--ft8-cycle-even-bg)'
          : 'var(--ft8-cycle-odd-bg)',
    }} />
    <div key={cycle.slotInfo.id} className="absolute inset-0 progress-bar-mask"
      style={animation} />
  </>;
}
