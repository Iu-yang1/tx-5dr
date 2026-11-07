import { describe, expect, it } from 'vitest';
import { needsNativeRxReconfigure, nativeRxPreferenceFingerprint, shouldUpdateNativeQ65Ap } from './NativeDigitalRxPreferencesSync';
import { DEFAULT_NATIVE_DECODE_PREFERENCES } from './digitalDecodePreferences';
describe('Native RX settings sync', () => {
  it('does not restart the already running default receiver', () => {
    expect(needsNativeRxReconfigure({...DEFAULT_NATIVE_DECODE_PREFERENCES})).toBe(false);
  });
  it('marks changed Q65 and MSK144 preferences for reconfiguration', () => {
    expect(needsNativeRxReconfigure({...DEFAULT_NATIVE_DECODE_PREFERENCES,
      q65Submode:'Q65-120D'})).toBe(true);
    expect(needsNativeRxReconfigure({...DEFAULT_NATIVE_DECODE_PREFERENCES,
      mskMyCall:'BG5JSU',mskDxCall:'HB9Q',mskShorthand:true})).toBe(true);
  });
  it('Q65 time synchronization changes only the Q65 receiver fingerprint', () => {
    const original={...DEFAULT_NATIVE_DECODE_PREFERENCES};
    const changed={...original,q65TimeToleranceSec:60,q65SyncScore:0.1,q65MaxCandidates:32};
    expect(needsNativeRxReconfigure(changed)).toBe(true);
    expect(nativeRxPreferenceFingerprint('Q65',original))
      .not.toBe(nativeRxPreferenceFingerprint('Q65',changed));
    expect(nativeRxPreferenceFingerprint('WSPR',original))
      .toBe(nativeRxPreferenceFingerprint('WSPR',changed));
  });

  it('changing TX parity or period must not restart native reception', () => {
    const base = { ...DEFAULT_NATIVE_DECODE_PREFERENCES };
    const txChanged = { ...base, q65TxFirst: false, mskTxFirst: false,
      mskPeriodSeconds: 15 as const, txAudioHz: 2100 };
    expect(nativeRxPreferenceFingerprint('Q65', base))
      .toBe(nativeRxPreferenceFingerprint('Q65', txChanged));
    expect(nativeRxPreferenceFingerprint('MSK144', base))
      .toBe(nativeRxPreferenceFingerprint('MSK144', txChanged));
    expect(nativeRxPreferenceFingerprint('WSPR', base))
      .toBe(nativeRxPreferenceFingerprint('WSPR', txChanged));
    expect(nativeRxPreferenceFingerprint('Q65', base))
      .not.toBe(nativeRxPreferenceFingerprint('Q65', { ...base, q65Submode: 'Q65-120D' }));
  });
  it('reapplies Q65 AP context after receiver generation changes', () => {
    const prior = {generation:7,key:'BG5JSU|OL79|HB9Q|JN47'};
    expect(shouldUpdateNativeQ65Ap(prior,7,prior.key)).toBe(false);
    expect(shouldUpdateNativeQ65Ap(prior,8,prior.key)).toBe(true);
    expect(shouldUpdateNativeQ65Ap(prior,7,'BG5JSU|OL79|K1ABC|FN42')).toBe(true);
    expect(shouldUpdateNativeQ65Ap(null,7,prior.key)).toBe(true);
  });
});
