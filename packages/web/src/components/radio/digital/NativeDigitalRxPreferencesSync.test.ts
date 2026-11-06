import { describe, expect, it } from 'vitest';
import { needsNativeRxReconfigure, shouldUpdateNativeQ65Ap } from './NativeDigitalRxPreferencesSync';
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
  it('reapplies Q65 AP context after receiver generation changes', () => {
    const prior = {generation:7,key:'BG5JSU|OL79|HB9Q|JN47'};
    expect(shouldUpdateNativeQ65Ap(prior,7,prior.key)).toBe(false);
    expect(shouldUpdateNativeQ65Ap(prior,8,prior.key)).toBe(true);
    expect(shouldUpdateNativeQ65Ap(prior,7,'BG5JSU|OL79|K1ABC|FN42')).toBe(true);
    expect(shouldUpdateNativeQ65Ap(null,7,prior.key)).toBe(true);
  });
});
