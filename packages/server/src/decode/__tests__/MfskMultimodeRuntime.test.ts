import { describe, it, expect, vi } from 'vitest';
import { MfskMultimodeRuntime } from '../MfskMultimodeRuntime.js';
import type { MfskNativeModule } from '../MfskNativeAdapter.js';

function mockNative() {
  const counters={slotted:[] as string[],msk:0,jtty:0,emitted:0,
    equalizer:[] as Array<[boolean,string]>,shorthand:[] as Array<[boolean,string,string]>,
    q65Search:[] as Array<[number|undefined,number|undefined,number|undefined]>};
  const native={
    supportedModes:()=>[
      'FT8','FT4','WSPR','Q65-15A','Q65-60B','Q65-300A','MSK144','JTTY',
    ],
    SlottedSession: class {
      constructor(mode:string){counters.slotted.push(mode)}
      setParameters(){}
      setQ65SearchOptions(seconds?:number,score?:number,candidates?:number){
        counters.q65Search.push([seconds,score,candidates]);
      }
      setApContext(){}
      setEmeDelay(){}
      clear(){}
      decode(){
        return [{text:'CQ K1ABC FN42',frequencyHz:1500,snrDb:-13,dtSeconds:0.5}];
      }
    },
    Msk144Session:class{
      constructor(_f:number,_t:number){}
      configureEqualizer(enabled:boolean,dx:string){counters.equalizer.push([enabled,dx]);}
      configureShorthand(enabled:boolean,my:string,dx:string){
        counters.shorthand.push([enabled,my,dx]);
      }
      push(){counters.msk++;return [{text:'K1ABC K2ABC -10',frequencyHz:1500,snrDb:-3,dtSeconds:0.4}]}
      reset(){}
      newPeriod(){}
    },
    JttySession:class{
      constructor(_f:number){}
      push(){counters.jtty++;return [{id:'1',text:'CQ K1ABC',state:'growing',
        frequencyHz:1500,startSeconds:0,endSeconds:1.8,snrDb:-8}]}
      finish(){return [{id:'1',text:'CQ K1ABC',state:'reception-ended',frequencyHz:1500,startSeconds:0,endSeconds:1.8,snrDb:-8}]}
      reset(){}
    },
    encodeSlotted:vi.fn((_mode:string,text:string)=>{
      counters.emitted++;
      const pcm=Buffer.alloc(4*120);
      return {canonicalText:text,sampleCount:120,sampleRate:12000,pcmF32Le:pcm};
    }),
    encodeJtty:vi.fn((text:string)=>({canonicalText:text,sampleCount:5,sampleRate:12000,pcmF32Le:Buffer.alloc(20)})),
    encodeMsk144Standard:vi.fn((a:string,b:string,r:string)=>({
      canonicalText:`${a} ${b} ${r}`,sampleCount:5,sampleRate:12000,pcmF32Le:Buffer.alloc(20)
    })),
  } as unknown as MfskNativeModule;
  return { native,counters };
}

describe('multi-mode native simulation runtime',()=>{
  it('does not expose physical TX permission just because codecs are present',()=>{
    const {native}=mockNative();
    const runtime=new MfskMultimodeRuntime(native);
    for(const mode of ['FT8','FT4','Q65','WSPR','MSK144','JTTY'] as const){
      const capability=runtime.capability(mode);
      expect(capability.receiverReady).toBe(true);
      expect(capability.encoderReady).toBe(true);
      expect(capability.txPipelineReady).toBe(false);
    }
  });

  it('Q65-B60 receives on 60-second slots and rejects a wrong boundary',()=>{
    const {native,counters}=mockNative();
    const runtime=new MfskMultimodeRuntime(native);
    runtime.begin({sessionId:'q',mode:'Q65',q65Submode:'Q65-60B',averaging:true,emeDelay:true});
    expect(counters.slotted).toEqual(['Q65-60B']);
    const signal=new Float32Array(600);
    const events=runtime.decodeSlot('q',0,{slotStartMs:1800000000000,
      timestampMs:1800000001200,samples:signal,final:true});
    expect(events[0]).toMatchObject({kind:'slot-decode',mode:'Q65',text:'CQ K1ABC FN42'});
    expect(()=>runtime.decodeSlot('q',0,{slotStartMs:1800000000001,
      timestampMs:1800000001200,samples:signal,final:true})).toThrow();
  });

  it('applies Q65-specific time search and sync/candidate gates to native DSP',()=>{
    const {native,counters}=mockNative();
    const runtime=new MfskMultimodeRuntime(native);
    runtime.begin({sessionId:'q-search',mode:'Q65',q65Submode:'Q65-60B',
      q65Search:{timeToleranceSeconds:15,scoreThreshold:0.1,maxCandidates:32}});
    expect(counters.q65Search).toEqual([[15,0.1,32]]);
    expect(()=>runtime.begin({sessionId:'other',mode:'WSPR',
      q65Search:{timeToleranceSeconds:15}})).toThrow(/Q65/);
    expect(()=>runtime.begin({sessionId:'bad',mode:'Q65',
      q65Search:{scoreThreshold:NaN}})).toThrow(/Invalid Q65/);
    expect(()=>runtime.begin({sessionId:'bad2',mode:'Q65',
      q65Search:{maxCandidates:65}})).toThrow(/Invalid Q65/);
  });

  it('WSPR is a 120s beacon protocol and not allowed to emulate a 15s FT8 period',()=>{
    const {native,counters}=mockNative();
    const runtime=new MfskMultimodeRuntime(native);
    runtime.begin({sessionId:'w',mode:'WSPR'});
    expect(counters.slotted).toEqual(['WSPR']);
    expect(()=>runtime.decodeSlot('w',0,{slotStartMs:1800000030000,
      timestampMs:1800000032000,samples:new Float32Array(30),final:true})).toThrow();
    const wave=runtime.encodeVirtual({mode:'WSPR'},'K1ABC FN42 37');
    expect(wave.canonicalText).toBe('K1ABC FN42 37');
  });

  it('MSK144 stream rejects gaps, stale generations and sync-free fake slot mode',()=>{
    const {native,counters}=mockNative();
    const runtime=new MfskMultimodeRuntime(native);
    runtime.begin({sessionId:'m',mode:'MSK144'});
    const events=runtime.pushStream('m',0,0,1000,new Float32Array(480));
    expect(events[0]).toMatchObject({kind:'burst-decode',mode:'MSK144',observationWindowMs:40});
    expect(()=>runtime.pushStream('m',0,960,1040,new Float32Array(480))).toThrow();
    const next=runtime.reset('m');
    expect(next).toBe(1);
    expect(runtime.pushStream('m',0,0,1080,new Float32Array(480))).toEqual([]);
    expect(runtime.pushStream('m',1,0,1080,new Float32Array(480))).toHaveLength(1);
    expect(counters.msk).toBe(2);
  });

  it('MSK144 requires explicit paired calls and guarded equalizer settings',()=>{
    const {native,counters}=mockNative();
    const runtime=new MfskMultimodeRuntime(native);
    expect(()=>runtime.begin({sessionId:'x',mode:'Q65',
      msk144Rx:{dxCall:'K2ABC',adaptiveEqualizer:true}})).toThrow(/MSK144/);
    expect(()=>runtime.begin({sessionId:'x',mode:'MSK144',
      msk144Rx:{dxCall:'K2ABC',shorthand:true}})).toThrow(/known MY/);
    expect(()=>runtime.begin({sessionId:'x',mode:'MSK144',toleranceHz:300,
      msk144Rx:{dxCall:'K2ABC',myCall:'K1ABC',shorthand:true}}))
      .toThrow(/250 Hz/);
    runtime.begin({sessionId:'msk40',mode:'MSK144',
      msk144Rx:{dxCall:'K2ABC',myCall:'K1ABC',
        shorthand:true,adaptiveEqualizer:true}});
    expect(counters.equalizer).toEqual([[true,'K2ABC']]);
    expect(counters.shorthand).toEqual([[true,'K1ABC','K2ABC']]);
    runtime.reset('msk40');
    expect(counters.equalizer).toHaveLength(2);
    expect(counters.shorthand).toHaveLength(2);
    runtime.stop('msk40');
    expect('requestPtt' in runtime).toBe(false);
  });

  it('JTTY preserves identity, revisions and final reception lifecycle',()=>{
    const {native}=mockNative();
    const runtime=new MfskMultimodeRuntime(native);
    runtime.begin({sessionId:'j',mode:'JTTY'});
    const first=runtime.pushStream('j',0,0,1000,new Float32Array(480));
    const second=runtime.pushStream('j',0,480,1040,new Float32Array(480));
    const last=runtime.finishJtty('j',1080);
    expect(first[0]).toMatchObject({kind:'message-update',revision:0,state:'growing',messageId:'1'});
    expect(second[0]).toMatchObject({kind:'message-update',revision:1});
    expect(last[0]).toMatchObject({kind:'message-update',revision:2,state:'reception-ended'});
    expect(runtime.encodeVirtual({mode:'JTTY'},'CQ K1ABC').pcm).toHaveLength(5);
  });

  it('rejects physical TX access through this service and closes sessions strictly',()=>{
    const {native}=mockNative();
    const runtime=new MfskMultimodeRuntime(native);
    expect('requestPtt' in runtime).toBe(false);
    runtime.begin({sessionId:'a',mode:'FT8'});
    expect(()=>runtime.begin({sessionId:'a',mode:'FT8'})).toThrow();
    runtime.stop('a');
    expect(()=>runtime.decodeSlot('a',0,{slotStartMs:0,timestampMs:1,
      samples:new Float32Array(12),final:true})).toThrow();
    expect(runtime.encodeVirtual({mode:'MSK144'},'K1ABC K2ABC -10',15).pcm).toHaveLength(5);
  });
});
