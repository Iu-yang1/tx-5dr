import { describe, expect, it, vi } from 'vitest';
import { MfskNativeTxService, isMfskPhysicalTxConfirmed, type MfskTxAdmission } from '../MfskNativeTxService.js';
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
    receiver:()=>({mode:mode as 'Q65',q65Submode:'Q65-60B',ready:true}),
    now:()=>now,stopTuneTone:async()=>{},
    sleep:async ms=>{now+=ms;},encode:encoded,transmitAudio:sent,
  };
  return {deps,encoded,sent,now:()=>now};
}
describe('native six-mode transmit protocol and physical lease boundaries',()=>{
  it('never reports a denied or unconfirmed physical lease as transmitted',()=>{
    const outcome={mode:'Q65' as const,scheduledStartMs:1800000000000,durationMs:50000,
      result:{leaseId:'lease1',source:'digital' as const,operatorIds:['op1'],
        success:true,reason:'simulated',physicalConfirmed:false}};
    expect(isMfskPhysicalTxConfirmed(outcome)).toBe(false);
    expect(isMfskPhysicalTxConfirmed({...outcome,result:{...outcome.result,success:false,physicalConfirmed:true}})).toBe(false);
    expect(isMfskPhysicalTxConfirmed({...outcome,result:{...outcome.result,success:true,physicalConfirmed:true}})).toBe(true);
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
  it('aligns Q65 TX first/second to even/odd UTC periods',async()=>{
    for(const [q65TxFirst,expectedPhase] of [[true,0],[false,1]] as const){
      const c=context('Q65');
      const service=new MfskNativeTxService(c.deps);
      const outcome=await service.send({mode:'Q65',text:'CQ K1ABC FN42',
        operatorId:'op1',audioHz:1500,q65Submode:'Q65-60B',q65TxFirst});
      expect(outcome.scheduledStartMs).not.toBeNull();
      expect(Math.floor((outcome.scheduledStartMs!-500)/60_000)%2).toBe(expectedPhase);
      expect(outcome.durationMs).toBe(1000);
    }
    const c=context();
    await expect(new MfskNativeTxService(c.deps).send({
      mode:'MSK144',text:'K1ABC K2ABC -10',operatorId:'op1',audioHz:1500,
      q65TxFirst:true,
    })).rejects.toThrow(/Q65 TX phase/);
  });
  it('rejects a misleading non-1500 Hz MSK144 TX request',async()=>{
    const c=context('MSK144');
    const svc=new MfskNativeTxService(c.deps);
    await expect(svc.send({mode:'MSK144',text:'K1ABC K2ABC -10',
      operatorId:'op1',audioHz:1750,mskPeriodSeconds:5}))
      .rejects.toThrow(/fixed 1500 Hz/);
    expect(c.sent).not.toHaveBeenCalled();
  });
  it('requires the active operating mode, not a separate manual RF authorization',async()=>{
    const c=context();
    const service=new MfskNativeTxService(c.deps);
    await expect(service.send({mode:'JTTY',text:'CQ K1ABC',operatorId:'op1',audioHz:1500}))
      .rejects.toThrow(/active running/);
    expect(c.sent).not.toHaveBeenCalled();
  });
  it('releases a pending UTC wait immediately when the user disarms RF',async()=>{
    const c=context();
    let entering!:()=>void;
    const entered=new Promise<void>(resolve=>{entering=resolve;});
    const service=new MfskNativeTxService({...c.deps,
      sleep:async()=>{entering();await new Promise<void>(()=>{});},
    });
    const pending=service.send({mode:'Q65',text:'CQ K1ABC FN42',
      operatorId:'op1',audioHz:1500,q65Submode:'Q65-60B'});
    await entered;
    expect(service.isBusy()).toBe(true);
    service.cancel();
    await expect(pending).rejects.toThrow(/cancelled/);
    expect(service.isBusy()).toBe(false);
    expect(c.sent).not.toHaveBeenCalled();
  });

  it('cancels a hung encoder without keeping the radio TX queue busy',async()=>{
    const c=context();
    let entering!:()=>void;
    const entered=new Promise<void>(resolve=>{entering=resolve;});
    const service=new MfskNativeTxService({...c.deps,
      encode:async()=>{entering();return new Promise<never>(()=>{});},
    });
    const pending=service.send({mode:'Q65',text:'CQ K1ABC FN42',
      operatorId:'op1',audioHz:1500});
    await entered;
    service.cancel();
    await expect(pending).rejects.toThrow(/cancelled/);
    expect(service.isBusy()).toBe(false);
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

  it('will not key a Q65 waveform whose submode differs from the ready receiver',async()=>{
    const c=context();
    const service=new MfskNativeTxService({
      ...c.deps,
      receiver:()=>({mode:'Q65',q65Submode:'Q65-300A',ready:true}),
    });
    await expect(service.send({mode:'Q65',text:'CQ K1ABC FN42',
      operatorId:'op1',audioHz:1500,q65Submode:'Q65-60B'}))
      .rejects.toThrow(/submode differs/);
    expect(c.encoded).not.toHaveBeenCalled();
  });
  it('will not key a waveform when live RX is stopped or switched modes',async()=>{
    const c=context();
    for(const receiver of [
      {mode:'Q65' as const,q65Submode:'Q65-60B' as const,ready:false},
      {mode:'JTTY' as const,ready:true},
    ]){
      const service=new MfskNativeTxService({...c.deps,receiver:()=>receiver});
      await expect(service.send({mode:'Q65',text:'CQ K1ABC FN42',
        operatorId:'op1',audioHz:1500,q65Submode:'Q65-60B'}))
        .rejects.toThrow(/matching RX mode/);
    }
    expect(c.encoded).not.toHaveBeenCalled();
  });

  it('accepts all four MSK144 T/R periods and rejects a period on other modes',async()=>{
    const cfg=context('MSK144');
    const selected:Array<number|undefined>=[];
    const service=new MfskNativeTxService({
      ...cfg.deps,
      receiver:()=>({mode:'MSK144',ready:true}),
      encode:async(request)=>{
        selected.push(request.mskPeriodSeconds);
        return {audioData:new Float32Array(12_000),sampleRate:12_000,
          canonicalText:'K1ABC K2ABC -10'};
      },
    });
    for(const seconds of [5,10,15,30] as const){
      const outcome=await service.send({mode:'MSK144',text:'K1ABC K2ABC -10',
        operatorId:'op1',audioHz:1500,mskPeriodSeconds:seconds});
      // Never truncate halfway through a 72 ms frame: 1000 ms holds 13.
      expect(outcome.durationMs).toBe(13 * 72);
    }
    expect(selected).toEqual([5,10,15,30]);
    await expect(service.send({mode:'MSK144',text:'K1ABC K2ABC -10',
      operatorId:'op1',audioHz:1500,mskPeriodSeconds:20 as 5}))
      .rejects.toThrow();
    await expect(new MfskNativeTxService(cfg.deps).send({
      mode:'Q65',text:'CQ K1ABC FN42',operatorId:'op1',
      audioHz:1500,mskPeriodSeconds:15,
    })).rejects.toThrow();
  });

  it('aligns MSK144 to selected even/odd UTC T/R periods and ends on whole 72ms frames',async()=>{
    const base=context('MSK144');
    const submissions:Array<{audioData:Float32Array;validateStart?:()=>void|Promise<void>}>= [];
    const service=new MfskNativeTxService({
      ...base.deps,receiver:()=>({mode:'MSK144',ready:true}),
      encode:async()=>({
        audioData:new Float32Array(5*12_000),sampleRate:12_000,
        canonicalText:'K1ABC K2ABC -10',
      }),
      transmitAudio:async(request)=>{
        submissions.push(request);
        await request.validateStart?.();
        return {
          leaseId:'mock-lease',source:'digital',operatorIds:['op1'],
          success:true,reason:'completed',physicalConfirmed:true,
        };
      },
    });
    const even=await service.send({
      mode:'MSK144',operatorId:'op1',audioHz:1500,
      text:'K1ABC K2ABC -10',mskPeriodSeconds:5,mskTxFirst:true,
    });
    const odd=await service.send({
      mode:'MSK144',operatorId:'op1',audioHz:1500,
      text:'K1ABC K2ABC -10',mskPeriodSeconds:5,mskTxFirst:false,
    });
    expect(Math.floor((even.scheduledStartMs!-100)/5000)%2).toBe(0);
    expect(Math.floor((odd.scheduledStartMs!-100)/5000)%2).toBe(1);
    expect(submissions).toHaveLength(2);
    for(const item of submissions){
      expect(item.audioData.length%864).toBe(0);
      expect(item.audioData.length).toBeLessThan(60_000);
      expect(item.audioData.length).toBeGreaterThan(50_000);
    }
    expect(even.durationMs).toBe(submissions[0].audioData.length/12);
    expect(odd.durationMs).toBe(submissions[1].audioData.length/12);
  });
  it('rejects an MSK144 phase on other digital protocols',async()=>{
    const c=context();
    await expect(new MfskNativeTxService(c.deps).send({
      mode:'Q65',operatorId:'op1',audioHz:1500,
      text:'CQ K1ABC FN42',mskTxFirst:true,
    })).rejects.toThrow(/MSK144 TX phase/);
    expect(c.sent).not.toHaveBeenCalled();
  });

});
