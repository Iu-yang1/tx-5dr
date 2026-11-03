import { describe, expect, it, vi } from 'vitest';
import { WSJTXEncodeWorkQueue, type EncodeResult } from '../WSJTXEncodeWorkQueue.js';
import type { MfskNativeModule } from '../MfskNativeAdapter.js';

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
  it('blocks physical RF native TX even when the caller supplies a valid frame', async () => {
    const native = { encodeSlotted: vi.fn() } as unknown as MfskNativeModule;
    const queue = new WSJTXEncodeWorkQueue(1,native);
    const ok=vi.fn(),bad=vi.fn();
    queue.on('encodeComplete',ok);
    queue.on('encodeError',bad);
    await queue.push({operatorId:'op-1',mode:'FT8',
      frameId:'frame-1',message:'CQ K1ABC FN42',frequency:1500});
    expect(native.encodeSlotted).not.toHaveBeenCalled();
    expect(ok).not.toHaveBeenCalled();
    expect(bad).toHaveBeenCalledTimes(1);
    await queue.destroy();
  });

  it('accepts a fully identified native physical frame only when the explicit RF gate is on',async()=>{
    const current=process.env.TX5DR_ENABLE_MFSK_RF_TX;
    const wave=Buffer.alloc(12_000*4);
    const native={encodeSlotted:vi.fn(()=>({
      canonicalText:'CQ K1ABC FN42',sampleRate:12000,sampleCount:12000,pcmF32Le:wave,
    }))} as unknown as MfskNativeModule;
    const q=new WSJTXEncodeWorkQueue(1,native);
    const received:Array<EncodeResult & {request?:{frameId?:string}}>=[],failed=vi.fn();
    q.on('encodeComplete',r=>received.push(r as EncodeResult & {request?:{frameId?:string}}));
    q.on('encodeError',failed);
    const frame={
      operatorId:'op1',mode:'FT8' as const,message:'CQ K1ABC FN42',
      frequency:1500,slotStartMs:1_800_000_000_000,
      frameId:'frame-1',frameRevision:3,decisionEpoch:7,
    };
    try{
      process.env.TX5DR_ENABLE_MFSK_RF_TX='1';
      await q.push(frame);
      expect(failed).not.toHaveBeenCalled();
      expect(received).toHaveLength(1);
      expect(received[0].request?.frameId).toBe('frame-1');
      // Even with the RF gate on, a forged or unaligned lease is rejected.
      await q.push({...frame,slotStartMs:frame.slotStartMs+1});
      expect(failed).toHaveBeenCalledTimes(1);
      expect(received).toHaveLength(1);
    }finally{
      if(current===undefined)delete process.env.TX5DR_ENABLE_MFSK_RF_TX;
      else process.env.TX5DR_ENABLE_MFSK_RF_TX=current;
      await q.destroy();
    }
  });

});
