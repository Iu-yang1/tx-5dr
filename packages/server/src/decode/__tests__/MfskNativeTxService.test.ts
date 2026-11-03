import { describe, expect, it, vi } from 'vitest';
import { MfskNativeTxService, type MfskTxAdmission } from '../MfskNativeTxService.js';
import type { PhysicalAudioTransmissionRequest } from '../../transmission/PhysicalTxCoordinator.js';

function context(mode='Q65'){
  let now=1_800_000_000_000;
  const sent=vi.fn(async(_request:PhysicalAudioTransmissionRequest)=>({
    leaseId:'test-lease',source:'digital' as const,
    operatorIds:['op1'],success:true,reason:'done',physicalConfirmed:true,
  }));
  const encoded=vi.fn(async()=>({
    audioData:new Float32Array(12_000),sampleRate:12_000 as const,
    canonicalText:'CQ K1ABC FN42',
  }));
  const deps: MfskTxAdmission={
    mode:()=>mode,isRunning:()=>true,operatorExists:id=>id==='op1',
    now:()=>now,stopTuneTone:async()=>{},rfAllowed:()=>true,
    sleep:async ms=>{now+=ms;},encode:encoded,transmitAudio:sent,
  };
  return {deps,encoded,sent,now:()=>now};
}
describe('native six-mode transmit protocol and physical lease boundaries',()=>{
  it('requires explicit product RF admission even if a native addon works',async()=>{
    const c=context();
    const service=new MfskNativeTxService({...c.deps,rfAllowed:()=>false});
    await expect(service.send({mode:'Q65',text:'CQ K1ABC FN42',operatorId:'op1',audioHz:1500}))
      .rejects.toThrow(/P9/);
    expect(c.sent).not.toHaveBeenCalled();
  });
  it('sends Q65 only inside a future 60-second UTC frame via guarded coordinator',async()=>{
    const c=context();
    const service=new MfskNativeTxService(c.deps);
    const result=await service.send({mode:'Q65',text:'CQ K1ABC FN42',operatorId:'op1',
      audioHz:1500,q65Submode:'Q65-60B'});
    expect(result.scheduledStartMs).not.toBeNull();
    expect(result.scheduledStartMs!%60_000).toBe(500);
    expect(c.sent).toHaveBeenCalledTimes(1);
    expect(c.sent.mock.calls[0][0]).toMatchObject({
      source:'digital',playbackKind:'digital',operatorIds:['op1'],
      assertPtt:true,
    });
  });
  it('prevents unconsented WSPR beacons and wrong active-mode TX',async()=>{
    const c=context();
    const service=new MfskNativeTxService(c.deps);
    await expect(service.send({mode:'WSPR',text:'K1ABC FN42 37',operatorId:'op1',audioHz:1500}))
      .rejects.toThrow(/authorization/);
    await expect(service.send({mode:'JTTY',text:'CQ K1ABC',operatorId:'op1',audioHz:1500}))
      .rejects.toThrow(/active running/);
    expect(c.sent).not.toHaveBeenCalled();
  });
  it('blocks TX that was cancelled during encoding or was canonicalized',async()=>{
    const c=context();
    const svc=new MfskNativeTxService({...c.deps,encode:async()=> {
      svc.cancel();
      return {audioData:new Float32Array(12000),sampleRate:12000,
        canonicalText:'CQ K1ABC FN42'};
    }});
    await expect(svc.send({mode:'Q65',operatorId:'op1',audioHz:1500,
      text:'CQ K1ABC FN42'})).rejects.toThrow(/cancelled/);
    expect(c.sent).not.toHaveBeenCalled();
    const other=context();
    const mismatch=new MfskNativeTxService({...other.deps,encode:async()=>({
      audioData:new Float32Array(12000),sampleRate:12000,canonicalText:'CQ OTHER FN42',
    })});
    await expect(mismatch.send({mode:'Q65',operatorId:'op1',audioHz:1500,
      text:'CQ K1ABC FN42'})).rejects.toThrow(/canonicalized/);
    expect(other.sent).not.toHaveBeenCalled();
  });
  it('never permits missing operator or invalid AF frequency',async()=>{
    const c=context();const s=new MfskNativeTxService(c.deps);
    await expect(s.send({mode:'Q65',text:'CQ K1ABC FN42',operatorId:'other',
      audioHz:1500})).rejects.toThrow(/Operator/);
    await expect(s.send({mode:'Q65',text:'CQ K1ABC FN42',operatorId:'op1',
      audioHz:6000})).rejects.toThrow();
  });
  it('fences stale UTC waveforms after slow PTT/output setup',async()=>{
    const c=context();
    const callbacks: Array<() => void|Promise<void>>=[];
    const deps:MfskTxAdmission={...c.deps,transmitAudio:async(request)=>{
      if(request.validateStart)callbacks.push(request.validateStart);
      // Simulate a backend which resolves playback preparation only when
      // too little time remains to send the complete Q65 60s waveform.
      await c.deps.sleep?.(59_000);
      await request.validateStart?.();
      return {
        leaseId:'should-not-commit',source:'digital',operatorIds:['op1'],
        success:true,reason:'unexpected',physicalConfirmed:true,
      };
    }};
    const service=new MfskNativeTxService(deps);
    await expect(service.send({mode:'Q65',text:'CQ K1ABC FN42',
      operatorId:'op1',audioHz:1500,q65Submode:'Q65-60B'}))
      .rejects.toThrow(/slot budget expired/);
    expect(callbacks).toHaveLength(1);
    expect(c.sent).not.toHaveBeenCalled();
  });

});
