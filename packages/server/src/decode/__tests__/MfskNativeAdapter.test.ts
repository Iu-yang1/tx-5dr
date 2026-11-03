import { describe, expect, it } from 'vitest';
import { validateNativeModule, verifyNativeWaveform } from '../MfskNativeAdapter.js';

const testModule = () => ({
  codecVersion: () => 'mfsk-core/0.15.0; tx5dr-napi/0.1.0',
  supportedModes: () => ['FT8', 'FT4', 'Q65-60B', 'WSPR', 'MSK144', 'JTTY'],
  encodeSlotted: () => ({}),
  decodeSlotted: () => [],
  encodeJtty: () => ({}),
  encodeMsk144Standard: () => ({}),
  SlottedSession: class {},
  JttySession: class {},
  Msk144Session: class {},
});

describe('experimental native codec ABI boundary', () => {
  it('fails closed for absent modules, missing modes and ABI drift', () => {
    expect(validateNativeModule(undefined)).toMatchObject({ ready: false });
    const partial = { ...testModule(), Msk144Session: undefined };
    expect(validateNativeModule(partial)).toMatchObject({ ready: false });
    const missing = { ...testModule(), supportedModes: () => ['FT8', 'FT4'] };
    expect(validateNativeModule(missing)).toMatchObject({ ready: false });
    const badVersion = { ...testModule(), codecVersion: () => '0.0.0' };
    expect(validateNativeModule(badVersion)).toMatchObject({ ready: false });
    expect(validateNativeModule(testModule())).toMatchObject({ ready: true });
  });

  it('verifies actual little-endian PCM without implicit truncation or TX text changes', () => {
    const samples = Buffer.alloc(16);
    samples.writeFloatLE(0.125, 0);
    samples.writeFloatLE(-0.25, 4);
    samples.writeFloatLE(0.5, 8);
    samples.writeFloatLE(-0.125, 12);
    const wave = { canonicalText: 'CQ K1ABC FN42', sampleRate: 12000, sampleCount: 4, pcmF32Le: samples };
    expect(Array.from(verifyNativeWaveform(wave, 'cq k1abc fn42', 'FT8'))).toEqual([
      0.125, -0.25, 0.5, -0.125,
    ]);
    expect(() => verifyNativeWaveform(wave, 'CQ OTHER FN42', 'FT8')).toThrow(/text mismatch/);
    expect(() => verifyNativeWaveform({ ...wave, sampleRate: 48000 }, wave.canonicalText, 'FT8')).toThrow();
    expect(() => verifyNativeWaveform({ ...wave, sampleCount: 5 }, wave.canonicalText, 'FT8')).toThrow();
    samples.writeFloatLE(Number.NaN, 4);
    expect(() => verifyNativeWaveform(wave, wave.canonicalText, 'FT8')).toThrow(/invalid sample/);
  });
});
