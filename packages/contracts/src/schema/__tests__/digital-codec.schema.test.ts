import { describe, expect, it } from 'vitest';
import {
  DIGITAL_CODEC_PROFILES, DigitalCodecModeSchema, DigitalCodecModeProfileSchema,
  DigitalCodecRuntimeCapabilitySchema, DigitalRxEventSchema,
  Q65_PERIOD_MS, Q65SubmodeSchema, MfskPhysicalTxRequestSchema,
  digitalCodecSlotStart, digitalCodecTxAllowed,
} from '../digital-codec.schema.js';

describe('six-mode codec contract', () => {
  it('has exactly six families and only ten protocol-backed Q65 submodes', () => {
    expect(DigitalCodecModeSchema.options).toHaveLength(6);
    expect(Object.keys(DIGITAL_CODEC_PROFILES)).toEqual(DigitalCodecModeSchema.options);
    expect(Object.keys(Q65_PERIOD_MS)).toEqual(Q65SubmodeSchema.options);
    for (const profile of Object.values(DIGITAL_CODEC_PROFILES)) {
      expect(DigitalCodecModeProfileSchema.parse(profile)).toEqual(profile);
    }
  });

  it('never forces continuous receivers through a slotted clock', () => {
    for (const mode of ['MSK144', 'JTTY'] as const) {
      expect(DIGITAL_CODEC_PROFILES[mode].slotMs).toBeNull();
      expect(DIGITAL_CODEC_PROFILES[mode].streaming).toBe(true);
    }
    expect(DIGITAL_CODEC_PROFILES.WSPR.usage).toBe('beacon');
    expect(DIGITAL_CODEC_PROFILES.Q65.slotMs).toBe(60_000);
  });

  it('aligns FT4 half-second boundaries and WSPR periods exactly', () => {
    expect(digitalCodecSlotStart(22_499, 7_500)).toBe(15_000);
    expect(digitalCodecSlotStart(22_500, 7_500)).toBe(22_500);
    expect(digitalCodecSlotStart(250_000, 120_000)).toBe(240_000);
    expect(digitalCodecSlotStart(-1, 7_500)).toBe(-7_500);
    expect(() => digitalCodecSlotStart(1, 0)).toThrow();
    expect(() => digitalCodecSlotStart(NaN, 15_000)).toThrow();
  });

  it('requires runtime readiness and explicit beacon TX authorisation', () => {
    const base = DigitalCodecRuntimeCapabilitySchema.parse({
      mode: 'WSPR', backend: 'mfsk-native', receiverReady: true,
      encoderReady: true, schedulerReady: true, txPipelineReady: true,
    });
    expect(digitalCodecTxAllowed(base, true, true, true)).toBe(false);
    expect(digitalCodecTxAllowed(base, true, true, true, true)).toBe(true);
    expect(digitalCodecTxAllowed({ ...base, encoderReady: false }, true, true, true, true)).toBe(false);
    expect(digitalCodecTxAllowed({ ...base, mode: 'FT8' }, true, true, false)).toBe(false);
    expect(digitalCodecTxAllowed(undefined, true, true, true)).toBe(false);
  });

  it('accepts Q65 UTC TX phase and manual WSPR transmission without a separate authorization', () => {
    const q65={mode:'Q65',operatorId:'operator1',text:'CQ K1ABC FN42',
      audioHz:1500,q65Submode:'Q65-60B',q65TxFirst:false};
    expect(MfskPhysicalTxRequestSchema.parse(q65)).toMatchObject(q65);
    expect(() => MfskPhysicalTxRequestSchema.parse({...q65,mode:'FT8'})).toThrow();
    expect(() => MfskPhysicalTxRequestSchema.parse({...q65,mode:'MSK144'})).toThrow();
    const wspr={mode:'WSPR',operatorId:'operator1',text:'K1ABC FN42 37',audioHz:1500};
    expect(MfskPhysicalTxRequestSchema.parse(wspr)).toMatchObject(wspr);
    expect(MfskPhysicalTxRequestSchema.parse({...wspr,beaconAuthorized:true})).toMatchObject(wspr);
  });

  it('rejects a non-slotted message missing its own lifecycle identity', () => {
    const update = {
      kind: 'message-update', sessionId: 'stream-1', mode: 'JTTY',
      timestampMs: 1000, frequencyHz: 1500, messageId: 'msg-3',
      revision: 2, state: 'growing', text: 'CQ TEST',
    };
    expect(DigitalRxEventSchema.parse(update)).toMatchObject(update);
    expect(() => DigitalRxEventSchema.parse({ ...update, messageId: '' })).toThrow();
    expect(() => DigitalRxEventSchema.parse({ ...update, kind: 'slot-decode' })).toThrow();
  });
});
