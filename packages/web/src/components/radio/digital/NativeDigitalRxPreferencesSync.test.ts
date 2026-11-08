import { describe, expect, it } from 'vitest';
import { shouldUpdateNativeQ65Ap } from './NativeDigitalRxPreferencesSync';

describe('Native RX settings sync', () => {
  it('reapplies Q65 AP context after receiver generation changes', () => {
    const prior = {generation:7,key:'BG5JSU|OL79|HB9Q|JN47'};
    expect(shouldUpdateNativeQ65Ap(prior,7,prior.key)).toBe(false);
    expect(shouldUpdateNativeQ65Ap(prior,8,prior.key)).toBe(true);
    expect(shouldUpdateNativeQ65Ap(prior,7,'BG5JSU|OL79|K1ABC|FN42')).toBe(true);
    expect(shouldUpdateNativeQ65Ap(null,7,prior.key)).toBe(true);
  });
});
