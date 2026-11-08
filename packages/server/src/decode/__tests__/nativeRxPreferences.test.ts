import { describe, expect, it } from 'vitest';
import { DEFAULT_NATIVE_DECODE_PREFERENCES } from '@tx5dr/contracts';
import { nativeRxConfigFromPreferences, nativeRxTuningFingerprint } from '../nativeRxPreferences.js';

describe('native receiver canonical preferences', () => {
  it('converts Q65 EME synchronization and averaging settings without a browser', () => {
    const p = { ...DEFAULT_NATIVE_DECODE_PREFERENCES,
      q65Submode: 'Q65-120D' as const, averaging: true, emeDelay: true,
      q65MaxCandidates: 32, q65SyncScore: 0.1, q65TimeToleranceSec: 60 };
    expect(nativeRxConfigFromPreferences('Q65', p)).toMatchObject({
      mode: 'Q65', q65Submode: 'Q65-120D', averaging: true, emeDelay: true,
      q65Search: { maxCandidates: 32, scoreThreshold: 0.1, timeToleranceSeconds: 60 },
    });
  });
  it('does not disrupt Q65 averaging for changes affecting TX only', () => {
    const p = { ...DEFAULT_NATIVE_DECODE_PREFERENCES };
    expect(nativeRxTuningFingerprint('Q65', p)).toBe(nativeRxTuningFingerprint('Q65', {
      ...p, txAudioHz: 1900, q65TxFirst: false,
    }));
    expect(nativeRxTuningFingerprint('Q65', p)).not.toBe(nativeRxTuningFingerprint('Q65', {
      ...p, averaging: true,
    }));
  });
  it('only enables MSK shorthand with both calls and a narrow search window', () => {
    expect(nativeRxConfigFromPreferences('MSK144', {
      ...DEFAULT_NATIVE_DECODE_PREFERENCES,
      mskMyCall: 'BG5JSU', mskDxCall: 'HB9Q', mskShorthand: true, toleranceHz: 500,
    }).msk144Rx?.shorthand).toBe(false);
  });
});
