import type { DigitalCodecMode, Q65Submode } from '@tx5dr/contracts';

export type NativeDigitalMode = Exclude<DigitalCodecMode, 'FT8' | 'FT4'>;

export interface NativeDecodePreferences {
  frequencyHz: number;
  toleranceHz: number;
  depth: 1 | 2 | 3;
  q65Submode: Q65Submode;
  averaging: boolean;
  emeDelay: boolean;
  mskShorthand: boolean;
  mskAdaptiveEqualizer: boolean;
  mskMyCall: string;
  mskDxCall: string;
  /** Physical TX is still user-triggered; these only configure the next send. */
  txAudioHz: number;
  q65TxFirst: boolean;
  mskPeriodSeconds: 5 | 10 | 15 | 30;
  mskTxFirst: boolean;
}

export const DECODE_PREFERENCES_CHANGED_EVENT = 'tx5dr:decode-preferences-changed';
const KEY = 'tx5dr.native-digital-rx-preferences.v1';

export const NATIVE_DIGITAL_MODES: NativeDigitalMode[] = ['Q65', 'WSPR', 'MSK144', 'JTTY'];

export const DEFAULT_NATIVE_DECODE_PREFERENCES: Readonly<NativeDecodePreferences> = {
  frequencyHz: 1500,
  toleranceHz: 200,
  depth: 3,
  q65Submode: 'Q65-60B',
  averaging: false,
  emeDelay: false,
  mskShorthand: false,
  mskAdaptiveEqualizer: false,
  mskMyCall: '',
  mskDxCall: '',
  txAudioHz: 1500,
  q65TxFirst: true,
  mskPeriodSeconds: 5,
  mskTxFirst: true,
};

const Q65_SUBMODES = new Set(['Q65-15A', 'Q65-30A', 'Q65-60A', 'Q65-60B', 'Q65-60C',
  'Q65-60D', 'Q65-60E', 'Q65-120D', 'Q65-120E', 'Q65-300A']);

const bounded = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fallback;

export function normalizeNativeDecodePreferences(candidate: unknown): NativeDecodePreferences {
  const entry = (candidate && typeof candidate === 'object' && !Array.isArray(candidate))
    ? candidate as Record<string, unknown> : {};
  const defaults = DEFAULT_NATIVE_DECODE_PREFERENCES;
  const depth = bounded(entry.depth, 1, 3, defaults.depth);
  const q65 = entry.q65Submode;
  return {
    frequencyHz: bounded(entry.frequencyHz, 100, 5500, defaults.frequencyHz),
    toleranceHz: bounded(entry.toleranceHz, 1, 5000, defaults.toleranceHz),
    depth: Math.round(depth) as 1 | 2 | 3,
    q65Submode: typeof q65 === 'string' && Q65_SUBMODES.has(q65) ? q65 as Q65Submode : defaults.q65Submode,
    averaging: entry.averaging === true,
    emeDelay: entry.emeDelay === true,
    mskShorthand: entry.mskShorthand === true,
    mskAdaptiveEqualizer: entry.mskAdaptiveEqualizer === true,
    mskMyCall: typeof entry.mskMyCall === 'string' ? entry.mskMyCall.trim().toUpperCase().slice(0, 12) : '',
    mskDxCall: typeof entry.mskDxCall === 'string' ? entry.mskDxCall.trim().toUpperCase().slice(0, 12) : '',
    txAudioHz: Math.round(bounded(entry.txAudioHz, 100, 5500, defaults.txAudioHz)),
    q65TxFirst: entry.q65TxFirst !== false,
    mskPeriodSeconds: [5, 10, 15, 30].includes(entry.mskPeriodSeconds as number)
      ? entry.mskPeriodSeconds as 5 | 10 | 15 | 30 : defaults.mskPeriodSeconds,
    mskTxFirst: entry.mskTxFirst !== false,
  };
}

export function loadNativeDecodePreferences(mode: NativeDigitalMode): NativeDecodePreferences {
  try {
    if (typeof localStorage === 'undefined') return { ...DEFAULT_NATIVE_DECODE_PREFERENCES };
    const all = JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, unknown>;
    return normalizeNativeDecodePreferences(all[mode]);
  } catch {
    return { ...DEFAULT_NATIVE_DECODE_PREFERENCES };
  }
}

export function saveNativeDecodePreferences(mode: NativeDigitalMode, prefs: NativeDecodePreferences): void {
  const normalized = normalizeNativeDecodePreferences(prefs);
  // Do not modify the active radio engine here. The receiver toolbar owns Apply RX.
  if (typeof localStorage === 'undefined') return;
  let all: Record<string, unknown> = {};
  try { all = JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, unknown>; }
  catch { /* replace invalid stored data */ }
  localStorage.setItem(KEY, JSON.stringify({ ...all, [mode]: normalized }));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(DECODE_PREFERENCES_CHANGED_EVENT, { detail: { mode } }));
  }
}
