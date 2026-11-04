import { describe, expect, it } from 'vitest';
import { needsNativeRxReconfigure } from './NativeDigitalRxPreferencesSync';
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
});
