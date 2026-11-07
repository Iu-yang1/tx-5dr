import { describe, expect, it } from 'vitest';
import { DEFAULT_NATIVE_DECODE_PREFERENCES, normalizeNativeDecodePreferences } from './digitalDecodePreferences';

describe('native digital receiver preference validation', () => {
  it('normalizes receiver sensitivity knobs per mode', () => {
    expect(normalizeNativeDecodePreferences({frequencyHz:2100,toleranceHz:80,depth:2,
      q65Submode:'Q65-120D',averaging:true,emeDelay:true})).toMatchObject({
        frequencyHz:2100,toleranceHz:80,depth:2,q65Submode:'Q65-120D',averaging:true,emeDelay:true,
      });
  });
  it('never persists an out-of-range frequency, tolerance, or unsupported Q65 submode', () => {
    expect(normalizeNativeDecodePreferences({frequencyHz:-1,toleranceHz:7000,depth:9,
      q65Submode:'Q65-999X'})).toMatchObject(DEFAULT_NATIVE_DECODE_PREFERENCES);
  });
  it('normalizes native TX preferences without losing RX defaults', () => {
    expect(normalizeNativeDecodePreferences({
      txAudioHz: 1900, q65TxFirst: false, mskTxFirst: false, mskPeriodSeconds: 15,
    })).toMatchObject({
      txAudioHz: 1900, q65TxFirst: false, mskTxFirst: false, mskPeriodSeconds: 15,
    });
    expect(normalizeNativeDecodePreferences({
      txAudioHz: 8000, mskPeriodSeconds: 20, q65TxFirst: true,
    })).toMatchObject({
      txAudioHz: 1500, mskPeriodSeconds: 5, q65TxFirst: true,
    });
  });

  it('retains MSK144 shorthand/equalizer settings', () => {
    expect(normalizeNativeDecodePreferences({mskShorthand:true,mskAdaptiveEqualizer:true,
      mskMyCall:'bg5jsu',mskDxCall:'hb9q'})).toMatchObject({
        mskShorthand:true,mskAdaptiveEqualizer:true,mskMyCall:'BG5JSU',mskDxCall:'HB9Q',
      });
  });
});
