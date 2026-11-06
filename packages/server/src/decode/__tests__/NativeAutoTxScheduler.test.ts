import { describe, expect, it, vi } from 'vitest';
import { NativeAutoTxScheduler, nextNativeAutoSlot } from '../NativeAutoTxScheduler.js';
import type { MfskTxRequest, MfskTxOutcome } from '../MfskNativeTxService.js';

function harness(mode:'Q65'|'MSK144'|'WSPR'='Q65') {
  let currentMode = mode;
  let now = 1_800_000_000_000;
  const rx = {ready:true,mode,generation:1,q65Submode:'Q65-60B' as const};
  const op = {id:'op1',isTransmitting:false,callsign:'BG5JSU',grid:'OL79WQ'};
  let messages = [{text:'CQ BG5JSU OL79',audioFrequencyHz:1500}];
  const outcome=(request:MfskTxRequest):MfskTxOutcome=>({
    mode:request.mode,scheduledStartMs:now+60_000,durationMs:50000,
    result:{leaseId:'native-test',source:'digital',
      operatorIds:['op1'],success:true,reason:'done',physicalConfirmed:true},
  });
  const send=vi.fn(async (request:MfskTxRequest)=>outcome(request));
  const cancelNativeTx=vi.fn();
  let physicalPhase = 'idle';
  const service=new NativeAutoTxScheduler({
    now:()=>now,mode:()=>currentMode,receiver:()=>rx,
    operator:id=>id==='op1'?op:undefined,
    transmissions:()=>messages,
    nativeBusy:()=>false,physicalPhase:()=>physicalPhase,
    send,cancelNativeTx,
  });
  return {service,send,rx,op,cancelNativeTx,
    setMessages:(text:string)=>{messages=[{text,audioFrequencyHz:1500}];},
    setNow:(v:number)=>{now=v;},
    setMode:(v:typeof mode)=>{currentMode=v;},
    setPhase:(v:string)=>{physicalPhase=v;},
  };
}

describe('native automatic UTC transmit scheduling',()=>{
  it('aligns next native slot and selected Q65/MSK144 TX parity',()=>{
    const now=1_800_000_000_000;
    for(const [period,first] of [[60_000,true],[60_000,false],[15_000,true],[15_000,false]] as const) {
      const at=nextNativeAutoSlot(now,period,first);
      expect(at).toBeGreaterThan(now);
      expect(at%period).toBe(0);
      expect(Math.floor(at/period)%2).toBe(first?0:1);
    }
  });

  it('does not send when controller is not armed or operator TX is off',async()=>{
    const h=harness();h.service.start(0);
    await h.service.poll();
    expect(h.send).not.toHaveBeenCalled();
    h.service.enable({mode:'Q65',operatorId:'op1',audioHz:1500,
      q65Submode:'Q65-60B',q65TxFirst:true});
    await h.service.poll();
    expect(h.send).not.toHaveBeenCalled();
    h.service.stop();
  });

  it('uses changing QSO strategy content and the native Q65 PCM path',async()=>{
    const h=harness();h.op.isTransmitting=true;h.service.start(0);
    h.service.enable({mode:'Q65',operatorId:'op1',audioHz:1500,
      q65Submode:'Q65-60B',q65TxFirst:false});
    await vi.waitFor(()=>expect(h.send).toHaveBeenCalledTimes(1));
    expect(h.send).toHaveBeenCalledWith(expect.objectContaining({
      mode:'Q65',operatorId:'op1',text:'CQ BG5JSU OL79',
      q65TxFirst:false,q65Submode:'Q65-60B',
    }));
    await vi.waitFor(()=>expect(h.service.status().lastPhysicalTxConfirmed).toBe(true));
    h.service.stop();
  });

  it('uses a fixed 1500 Hz native MSK144 centre and selected 15s period',async()=>{
    const h=harness('MSK144');h.op.isTransmitting=true;h.service.start(0);
    h.service.enable({mode:'MSK144',operatorId:'op1',audioHz:1500,
      mskPeriodSeconds:15,mskTxFirst:false});
    await vi.waitFor(()=>expect(h.send).toHaveBeenCalledTimes(1));
    expect(h.send).toHaveBeenCalledWith(expect.objectContaining({
      mode:'MSK144',audioHz:1500,mskPeriodSeconds:15,mskTxFirst:false,
    }));
    h.service.stop();
  });

  it('requires explicit operator-identity WSPR beacon message and power',async()=>{
    const h=harness('WSPR');h.op.isTransmitting=true;h.service.start(0);
    expect(()=>h.service.enable({mode:'WSPR',operatorId:'op1',audioHz:1500,
      beaconText:'OTHER OL79 37'})).toThrow(/callsign/);
    expect(()=>h.service.enable({mode:'WSPR',operatorId:'op1',audioHz:1500,
      beaconText:'BG5JSU OL79'})).toThrow(/callsign/);
    expect(h.send).not.toHaveBeenCalled();
    h.service.enable({mode:'WSPR',operatorId:'op1',audioHz:1500,
      beaconText:'BG5JSU OL79 37'});
    await vi.waitFor(()=>expect(h.send).toHaveBeenCalledTimes(1));
    expect(h.send).toHaveBeenCalledWith(expect.objectContaining({
      mode:'WSPR',text:'BG5JSU OL79 37',
    }));
    h.service.stop();
  });

  it('cancels an uncommitted UTC waveform when operator TX is switched off',async()=>{
    const h=harness();h.op.isTransmitting=true;h.service.start(0);
    h.send.mockImplementation(()=>new Promise<MfskTxOutcome>(()=>{}));
    h.service.enable({mode:'Q65',operatorId:'op1',audioHz:1500});
    expect(h.send).toHaveBeenCalledTimes(1);
    h.op.isTransmitting=false;
    h.service.onOperatorStateChanged('op1');
    expect(h.cancelNativeTx).toHaveBeenCalled();
    h.service.stop();
  });

  it('does not cancel an unchanged queued waveform during UTC slot rollover',async()=>{
    const h=harness();h.op.isTransmitting=true;h.service.start(0);
    h.send.mockImplementation(()=>new Promise<MfskTxOutcome>(()=>{}));
    const now=1_800_000_000_000;
    h.setNow(now);
    const target=nextNativeAutoSlot(now,60_000,true);
    h.service.enable({mode:'Q65',operatorId:'op1',audioHz:1500});
    expect(h.send).toHaveBeenCalledTimes(1);
    h.setNow(target-200);
    await h.service.poll();
    expect(h.cancelNativeTx).not.toHaveBeenCalled();
    h.service.stop();
  });

  it('cancels a pending native waveform when the QSO response changes',async()=>{
    const h=harness();h.op.isTransmitting=true;h.service.start(0);
    h.send.mockImplementation(()=>new Promise<MfskTxOutcome>(()=>{}));
    h.service.enable({mode:'Q65',operatorId:'op1',audioHz:1500});
    expect(h.send).toHaveBeenCalledTimes(1);
    h.setMessages('K1ABC BG5JSU -10');
    await h.service.poll();
    expect(h.cancelNativeTx).toHaveBeenCalledTimes(1);
    h.service.stop();
  });

  it('does not let a second operator replace an already enabled automatic TX session',async()=>{
    const h=harness();h.op.isTransmitting=true;h.service.start(0);
    h.service.enable({mode:'Q65',operatorId:'op1',audioHz:1500});
    expect(()=>h.service.enable({mode:'Q65',operatorId:'op2',audioHz:1500}))
      .toThrow(/already controlled by another operator/);
    expect(h.service.status()).toMatchObject({enabled:true,operatorId:'op1'});
    expect(h.send).toHaveBeenCalledTimes(1);
    h.service.stop();
  });

  it('disarms automatically when the native RX generation changes',async()=>{
    const h=harness();h.op.isTransmitting=true;h.service.start(0);
    h.service.enable({mode:'Q65',operatorId:'op1',audioHz:1500});
    h.rx.generation+=1;
    await h.service.poll();
    expect(h.service.status().enabled).toBe(false);
    h.service.stop();
  });
});
