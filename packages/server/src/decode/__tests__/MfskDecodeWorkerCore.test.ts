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
  const calls = { mode: [] as string[], decoded: 0, ap: [] as unknown[] };
  class Slotted {
    constructor(mode: string) { calls.mode.push(mode); }
    decode() { calls.decoded += 1; return rows; }
    setParameters() {}
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
