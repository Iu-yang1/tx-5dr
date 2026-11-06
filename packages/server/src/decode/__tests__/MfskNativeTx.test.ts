import { describe, expect, it, vi } from 'vitest';
import { WSJTXEncodeWorkQueue, type EncodeResult } from '../WSJTXEncodeWorkQueue.js';
import type { MfskNativeModule } from '../MfskNativeAdapter.js';
import { PhysicalTxCoordinator } from '../../transmission/PhysicalTxCoordinator.js';

describe('experimental native TX compatibility adapter', () => {
  it('emits the unchanged request for an explicitly isolated virtual simulation', async () => {
    const pcmF32Le = Buffer.alloc(4 * 1024);
    const native = { encodeSlotted: vi.fn(() => ({
      canonicalText: 'CQ K1ABC FN42', sampleRate: 12000,
      sampleCount: 1024, pcmF32Le,
    })) } as unknown as MfskNativeModule;
    const queue = new WSJTXEncodeWorkQueue(1, native);
    const complete: Array<EncodeResult & { request: unknown }> = [];
    queue.on('encodeComplete', r => complete.push(r as EncodeResult & { request: unknown }));
    const request = {
      operatorId:'simulation:peer-1',virtualSimulation:true,mode:'FT4' as const, message:'CQ K1ABC FN42',
      frequency:1500, slotStartMs:1800000000000,
    };
    await queue.push(request);
    expect(native.encodeSlotted).toHaveBeenCalledWith('FT4',request.message,1500);
    expect(complete).toHaveLength(1);
    expect(complete[0].sampleRate).toBe(12000);
    expect(complete[0].request).toBe(request);
    await queue.destroy();
  });

  it('rejects mutated transmit text without emitting a playable frame', async () => {
    const native = { encodeSlotted: vi.fn(() => ({
      canonicalText: 'CQ OTHER FN42',sampleRate:12000,
      sampleCount:1,pcmF32Le:Buffer.alloc(4),
    })) } as unknown as MfskNativeModule;
    const queue = new WSJTXEncodeWorkQueue(1,native);
    const ok = vi.fn(), bad = vi.fn();
    queue.on('encodeComplete',ok);
    queue.on('encodeError',bad);
    await queue.push({operatorId:'simulation:peer-1', virtualSimulation:true,mode:'FT8', message:'CQ K1ABC FN42',frequency:1500});
    expect(ok).not.toHaveBeenCalled();
    expect(bad).toHaveBeenCalledTimes(1);
    await queue.destroy();
  });
  it('rejects a physical request with no frame revision, decision epoch or aligned UTC slot', async () => {
    const native = { encodeSlotted: vi.fn() } as unknown as MfskNativeModule;
    const queue = new WSJTXEncodeWorkQueue(1, native);
    const ok = vi.fn(), bad = vi.fn();
    queue.on('encodeComplete', ok);
    queue.on('encodeError', bad);
    await queue.push({
      operatorId: 'op-1', mode: 'FT8', frameId: 'frame-1',
      message: 'CQ K1ABC FN42', frequency: 1500,
    });
    expect(native.encodeSlotted).not.toHaveBeenCalled();
    expect(ok).not.toHaveBeenCalled();
    expect(bad).toHaveBeenCalledTimes(1);
    await queue.destroy();
  });

  it.each(['FT8', 'FT4'] as const)(
    'permits a fully identified %s frame in a normal packaged runtime without an environment opt-in',
    async mode => {
      const saved = process.env.TX5DR_ENABLE_MFSK_RF_TX;
      const native = { encodeSlotted: vi.fn(() => ({
        canonicalText: 'CQ K1ABC FN42', sampleRate: 12_000,
        sampleCount: 12_000, pcmF32Le: Buffer.alloc(48_000),
      })) } as unknown as MfskNativeModule;
      const queue = new WSJTXEncodeWorkQueue(1, native);
      const received: EncodeResult[] = [];
      const failed = vi.fn();
      queue.on('encodeComplete', result => received.push(result));
      queue.on('encodeError', failed);
      const frame = {
        operatorId: 'op1', mode, message: 'CQ K1ABC FN42',
        frequency: 1500, slotStartMs: 1_800_000_000_000,
        frameId: 'frame-1', frameRevision: 3, decisionEpoch: 7,
      };
      try {
        delete process.env.TX5DR_ENABLE_MFSK_RF_TX;
        await queue.push(frame);
        expect(native.encodeSlotted).toHaveBeenCalledWith(mode, frame.message, 1500);
        expect(failed).not.toHaveBeenCalled();
        expect(received).toHaveLength(1);
        expect(received[0].audioData.length).toBe(12_000);
        await queue.push({ ...frame, slotStartMs: frame.slotStartMs + 1 });
        expect(failed).toHaveBeenCalledTimes(1);
        expect(received).toHaveLength(1);
      } finally {
        if (saved === undefined) delete process.env.TX5DR_ENABLE_MFSK_RF_TX;
        else process.env.TX5DR_ENABLE_MFSK_RF_TX = saved;
        await queue.destroy();
      }
    },
  );

  it('retains an explicit operator-side emergency RF disable', async () => {
    const saved = process.env.TX5DR_ENABLE_MFSK_RF_TX;
    const native = { encodeSlotted: vi.fn() } as unknown as MfskNativeModule;
    const queue = new WSJTXEncodeWorkQueue(1, native);
    const failed = vi.fn();
    queue.on('encodeError', failed);
    try {
      process.env.TX5DR_ENABLE_MFSK_RF_TX = '0';
      await queue.push({
        operatorId: 'op1', mode: 'FT8', message: 'CQ K1ABC FN42',
        frequency: 1500, slotStartMs: 1_800_000_000_000,
        frameId: 'frame-1', frameRevision: 1, decisionEpoch: 3,
      });
      expect(native.encodeSlotted).not.toHaveBeenCalled();
      expect(failed).toHaveBeenCalledTimes(1);
      expect(failed.mock.calls[0][0].message).toMatch(/explicitly disabled/);
    } finally {
      if (saved === undefined) delete process.env.TX5DR_ENABLE_MFSK_RF_TX;
      else process.env.TX5DR_ENABLE_MFSK_RF_TX = saved;
      await queue.destroy();
    }
  });

  it.each(['FT8', 'FT4'] as const)(
    'delivers native %s PCM through a real physical lease to PTT ON, audio and PTT OFF',
    async mode => {
      const saved = process.env.TX5DR_ENABLE_MFSK_RF_TX;
      const setPTT = vi.fn(async (_active: boolean) => undefined);
      const playback = vi.fn(async (
        _audio: Float32Array,
        _sampleRate: number,
        options?: { onPlaybackStarted?: () => void },
      ) => {
        options?.onPlaybackStarted?.();
      });
      const coordinator = new PhysicalTxCoordinator({
        isRadioConnected: () => true,
        setPTT,
        playAudio: playback,
        stopCurrentPlayback: vi.fn(async () => 0),
        prepareAudioPlayback: vi.fn(async () => ({ ready: true, waitedForDrain: false })),
      });
      const native = { encodeSlotted: vi.fn(() => ({
        canonicalText: 'CQ K1ABC FN42', sampleRate: 12_000,
        sampleCount: 12_000, pcmF32Le: Buffer.alloc(48_000),
      })) } as unknown as MfskNativeModule;
      const queue = new WSJTXEncodeWorkQueue(1, native);
      const txResults: Array<Promise<Awaited<ReturnType<typeof coordinator.transmitAudio>>>> = [];
      queue.on('encodeComplete', result => {
        txResults.push(coordinator.transmitAudio({
          source: 'digital', operatorIds: ['op1'], frameId: 'frame-1',
          reason: `${mode} validated slotted frame`, playbackKind: 'digital',
          assertPtt: true, audioData: result.audioData, sampleRate: result.sampleRate,
        }));
      });
      const failed = vi.fn();
      queue.on('encodeError', failed);
      try {
        delete process.env.TX5DR_ENABLE_MFSK_RF_TX;
        await queue.push({
          operatorId: 'op1', mode, message: 'CQ K1ABC FN42',
          frequency: 1500, slotStartMs: 1_800_000_000_000,
          frameId: 'frame-1', frameRevision: 1, decisionEpoch: 3,
        });
        expect(failed).not.toHaveBeenCalled();
        expect(txResults).toHaveLength(1);
        const result = await txResults[0];
        expect(result.success).toBe(true);
        expect(result.physicalConfirmed).toBe(true);
        expect(setPTT.mock.calls.map(call => call[0])).toEqual([true, false]);
        expect(playback).toHaveBeenCalledTimes(1);
        expect(playback.mock.calls[0][0]).toBeInstanceOf(Float32Array);
        expect(playback.mock.calls[0][1]).toBe(12_000);
      } finally {
        if (saved === undefined) delete process.env.TX5DR_ENABLE_MFSK_RF_TX;
        else process.env.TX5DR_ENABLE_MFSK_RF_TX = saved;
        await queue.destroy();
      }
    },
  );
});
