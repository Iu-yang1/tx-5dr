import { describe, it, expect, vi } from 'vitest';
import { MfskDecodeWorkerCore } from '../MfskDecodeWorkerCore.js';
import type { MfskNativeModule, MfskNativeRow } from '../MfskNativeAdapter.js';
import type { DecodeRequest } from '@tx5dr/core';

function fakeRequest(opts: Partial<DecodeRequest> = {}): DecodeRequest {
  const pcm = new Float32Array(12_000 * 15);
  return {
    slotId: 'FT8-240000000-1800000000000',
    mode: 'FT8', slotStartMs: 1800000000000,
    windowIdx: 0, pcm: pcm.buffer, sampleRate: 12000,
    timestamp: 1800000011000, windowOffsetMs: -3200,
    decodeDepth: 3, decodeSessionId: 'slot-1',
    decodeStage: 41,
    ...opts,
  };
}

function fakeNative(rows: MfskNativeRow[] = []) {
  const calls = { mode: [] as string[], decoded: 0, ap: [] as unknown[],
    threads: [] as number[], frameOptions: [] as unknown[][], preloads: [] as string[][] };
  class Slotted {
    constructor(mode: string) { calls.mode.push(mode); }
    decode() { calls.decoded += 1; return rows; }
    preloadCallsigns(callsigns: string[]) { calls.preloads.push([...callsigns]); }
    setParameters() {}
    setParallelThreads(threads: number) { calls.threads.push(threads); }
    setFrameOptions(...args: unknown[]) { calls.frameOptions.push(args); }
    setApContext(...args: unknown[]) { calls.ap.push(args); }
    clear() {}
  }
  const native = { SlottedSession: Slotted } as unknown as MfskNativeModule;
  return { native, calls };
}

describe('isolated mfsk-native worker', () => {
  it('keeps native decode sessions and filters duplicate staged deliveries', async () => {
    const { native, calls } = fakeNative([
      {text:'CQ K1ABC FN42',frequencyHz:1500,snrDb:-12,dtSeconds:0.7},
    ]);
    const worker = new MfskDecodeWorkerCore(native);
    const first = await worker.decode(fakeRequest());
    const second = await worker.decode(fakeRequest({ windowIdx: 1, decodeStage: 47 }));
    expect(first.frames).toHaveLength(1);
    expect(second.frames).toHaveLength(0);
    expect(calls.mode).toEqual(['FT8']);
    expect(calls.decoded).toBe(2);
    worker.endSession('slot-1');
    await worker.decode(fakeRequest({ decodeSessionId: 'slot-2' }));
    expect(calls.mode).toEqual(['FT8', 'FT8']);
  });

  it('preloads the same trusted hash snapshot into fresh slots and publishes final learning', async () => {
    const { native, calls } = fakeNative([
      { text: '<BG5JSU> 5TB3Z', frequencyHz: 1500, snrDb: -13,
        dtSeconds: 0.4, learnedCallsigns: ['5TB3Z'] },
    ]);
    const worker = new MfskDecodeWorkerCore(native);
    const snapshot = { version: 1, calls: ['5TB3Z'] };
    await worker.decode(fakeRequest({ decodeFinalWindow: false }), snapshot);
    expect(worker.takeLearnedCalls()).toEqual([]);
    await worker.decode(fakeRequest({ decodeStage: 50, decodeFinalWindow: true }), snapshot);
    expect(worker.takeLearnedCalls()).toEqual(['5TB3Z']);
    await worker.decode(fakeRequest({ decodeSessionId: 'slot-2', decodeStage: 50,
      decodeFinalWindow: true }), snapshot);
    expect(calls.preloads).toEqual([['5TB3Z'], ['5TB3Z']]);
  });

  it('applies advanced Rayon/AP/SIC/synchronization settings to the native decoder', async () => {
    const {native,calls} = fakeNative();
    const worker = new MfskDecodeWorkerCore(native);
    const decoderTuning = {
      threads: 3, apMode: 'cq-only' as const, strategy: 'sic3' as const,
      syncMin: 1.4, maxCandidates: 250,
    };
    await worker.decode(fakeRequest({decoderTuning}));
    await worker.decode(fakeRequest({windowIdx:1,decodeStage:47,decoderTuning}));
    expect(calls.threads).toEqual([3,3]);
    expect(calls.frameOptions).toEqual([
      ['cq-only','sic3',1.4,250], ['cq-only','sic3',1.4,250],
    ]);
    await expect(worker.decode(fakeRequest({
      windowIdx:2,decodeStage:49,
      decoderTuning:{...decoderTuning,threads:4},
    }))).rejects.toThrow(/tuning changed/);
    expect(calls.decoded).toBe(2);
  });

  it('fails closed if an old native addon lacks the requested DSP API', async () => {
    const native = { SlottedSession: class {
      decode() { return []; }
      setParameters() {}
      setApContext() {}
      clear() {}
    }} as unknown as MfskNativeModule;
    const worker = new MfskDecodeWorkerCore(native);
    await expect(worker.decode(fakeRequest({
      decoderTuning:{threads:2,apMode:'off'},
    }))).rejects.toThrow(/does not support advanced decoder tuning/);
  });

  it('never inherits AP context from an earlier receive request', async () => {
    const { native, calls } = fakeNative();
    const worker = new MfskDecodeWorkerCore(native);
    await worker.decode(fakeRequest({
      apContext:{ operatorId:'op-1',myCall:'K2ABC',myGrid:'FN32',
        dxCall:'K1ABC',frequencyHz:1500,qsoProgress:2,currentSlot:'even' },
    }));
    await worker.decode(fakeRequest({ windowIdx:1, decodeStage:47 }));
    expect((calls.ap[0] as unknown[]).at(-1)).toBe(true);
    expect((calls.ap[1] as unknown[]).at(-1)).toBe(false);
  });

  it('rejects non-aligned FT4 slots and invalid worker audio without decoding', async () => {
    const { native, calls } = fakeNative();
    const worker = new MfskDecodeWorkerCore(native);
    const invalid = fakeRequest({mode:'FT4',slotStartMs:1800000000001,
      decodeStage:'ft4-final',decodeSessionId:'slot-4'});
    await expect(worker.decode(invalid)).rejects.toThrow(/exact millisecond/);
    const badPcm = fakeRequest({pcm:new ArrayBuffer(3),decodeSessionId:'slot-5'});
    await expect(worker.decode(badPcm)).rejects.toThrow(/PCM/);
    expect(calls.decoded).toBe(0);
  });
  it('uses a complete decode on FT8 stage 50, not only early prefix', async () => {
    const prefixArgs: Array<boolean | undefined> = [];
    const fake = {
      SlottedSession: class {
        decode(_pcm: Buffer, _period: number, prefix?: boolean) {
          prefixArgs.push(prefix);
          return [];
        }
        setParameters() {}
        setApContext() {}
        clear() {}
      },
    } as unknown as MfskNativeModule;
    const worker = new MfskDecodeWorkerCore(fake);
    await worker.decode(fakeRequest({decodeStage:41,decodeFinalWindow:false}));
    await worker.decode(fakeRequest({decodeStage:50,decodeFinalWindow:true}));
    expect(prefixArgs).toEqual([true,false]);
  });

});
