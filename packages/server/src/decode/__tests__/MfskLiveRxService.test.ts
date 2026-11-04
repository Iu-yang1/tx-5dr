import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { AudioStreamManager } from '../../audio/AudioStreamManager.js';
import type { ChildProcess } from 'node:child_process';
import { MfskLiveRxService } from '../MfskLiveRxService.js';

class FakeWorker extends EventEmitter {
  readonly messages:unknown[]=[];
  readonly stderr=new EventEmitter();
  killed=false;
  send(payload:unknown) {this.messages.push(payload);return true;}
  kill() {this.killed=true;return true;}
}
function setup(){
  const audio=new EventEmitter() as unknown as AudioStreamManager;
  let now=1_800_000_000_000;
  const workers:FakeWorker[]=[];
  const live=new MfskLiveRxService(audio,()=>now,()=>{
    const child=new FakeWorker();
    workers.push(child);
    return child as unknown as ChildProcess;
  });
  return {audio,live,workers,at:(ms:number)=>{now=ms;}};
}
describe('live receiver protects the real AF ingestion and native session boundaries',()=>{
  it('forwards selected RX frequency tolerance and decoding depth to the native worker',()=>{
    const s=setup();
    const state=s.live.start({mode:'MSK144',frequencyHz:1500,toleranceHz:75,depth:2});
    expect(s.workers[0].messages[0]).toMatchObject({
      cmd:'start',generation:state.generation,
      config:{mode:'MSK144',audioFrequencyHz:1500,toleranceHz:75,depth:2},
    });
    s.live.stop();
    expect(()=>s.live.start({mode:'MSK144',toleranceHz:5100})).toThrow(/F Tol/);
  });
  it('rejects invalid protocols without creating a decode child',()=>{
    const s=setup();
    expect(()=>s.live.start({mode:'Q65',q65Submode:'Q65-60B',frequencyHz:90000})).toThrow();
    expect(s.workers).toHaveLength(0);
    expect(s.live.status().running).toBe(false);
  });

  it('rejects invalid RX updates without disrupting the existing decoder',()=>{
    const s=setup();
    const active=s.live.start({mode:'JTTY',frequencyHz:1500});
    const worker=s.workers[0];
    worker.emit('message',{type:'started',generation:active.generation});
    expect(()=>s.live.start({mode:'Q65',q65Submode:'Q65-60B',frequencyHz:90000}))
      .toThrow(/AF centre frequency/);
    expect(s.live.status()).toMatchObject({
      running:true,ready:true,generation:active.generation,mode:'JTTY',
    });
    expect(worker.killed).toBe(false);
    expect(s.workers).toHaveLength(1);
    s.live.stop();
  });

  it('rejects superseded readiness waits without stopping the subsequent session',async()=>{
    vi.useFakeTimers();
    try{
      const s=setup();
      const oldReady=s.live.startReady({mode:'Q65',q65Submode:'Q65-60B'},1000);
      const replacement=s.live.start({mode:'JTTY'});
      await expect(oldReady).rejects.toThrow(/superseded/);
      s.workers[1].emit('message',{type:'started',generation:replacement.generation});
      await vi.advanceTimersByTimeAsync(1500);
      expect(s.live.status()).toMatchObject({
        running:true,ready:true,generation:replacement.generation,mode:'JTTY',
      });
      s.live.stop();
    }finally{
      vi.useRealTimers();
    }
  });

  it('bounds pre-resampling ingress before IPC backpressure can accumulate',async()=>{
    const s=setup();
    const active=s.live.start({mode:'MSK144'});
    s.workers[0].emit('message',{type:'started',generation:active.generation});
    const audio=s.audio as unknown as EventEmitter;
    for(let i=0;i<9;i++)audio.emit('audioData',new Float32Array(480),12000);
    expect(s.live.status()).toMatchObject({
      running:false,workerFaults:1,droppedAudioChunks:1,
    });
    expect(s.live.status().lastError).toMatch(/backpressure/);
    expect(s.workers[0].killed).toBe(true);
    await new Promise(resolve=>setImmediate(resolve));
    expect(s.workers[0].messages.filter(m=>(m as {cmd?:string}).cmd==='audio'))
      .toHaveLength(0);
  });

  it('drops bounded queued slotted PCM without destroying the receiver',async()=>{
    const s=setup();
    const active=s.live.start({mode:'FT8'});
    s.workers[0].emit('message',{type:'started',generation:active.generation});
    const audio=s.audio as unknown as EventEmitter;
    for(let i=0;i<9;i++)audio.emit('audioData',new Float32Array(480),12000);
    expect(s.live.status()).toMatchObject({
      running:true,workerFaults:0,droppedAudioChunks:1,
    });
    await new Promise(resolve=>setImmediate(resolve));
    s.live.stop();
  });

  it('fails closed after a streaming IPC send throws without crashing the process',async()=>{
    const s=setup();
    const active=s.live.start({mode:'JTTY'});
    const worker=s.workers[0];
    worker.emit('message',{type:'started',generation:active.generation});
    vi.spyOn(worker,'send').mockImplementationOnce(()=>{throw new Error('closed channel');});
    (s.audio as unknown as EventEmitter).emit('audioData',new Float32Array(480),12000);
    await new Promise(resolve=>setImmediate(resolve));
    expect(s.live.status()).toMatchObject({running:false,workerFaults:1});
    expect(s.live.status().lastError).toMatch(/closed channel/);
    expect(worker.killed).toBe(true);
  });

  it('preserves audio-capture timestamp through deferred native streaming queue',async()=>{
    const s=setup();
    const initial=s.live.start({mode:'MSK144'});
    const worker=s.workers[0];
    worker.emit('message',{type:'started',generation:initial.generation});
    const t0=1_800_000_000_000;
    s.at(t0);
    (s.audio as unknown as EventEmitter).emit('audioData',new Float32Array(480),12000);
    // Resampling/serialization resolves only after the source clock advances.
    // The delivered AF still belongs to the earlier hardware callback.
    s.at(t0+2500);
    await new Promise(resolve=>setImmediate(resolve));
    const audioMessage=worker.messages.find((msg)=>
      (msg as {cmd?:string}).cmd==='audio') as {timestampMs:number}|undefined;
    expect(audioMessage?.timestampMs).toBe(t0);
    s.live.stop();
  });

  it('keeps MSK144 real AF chunks contiguous and prevents queued RX after stop',async()=>{
    const s=setup();
    const first=s.live.start({mode:'MSK144',frequencyHz:1500});
    expect(first.physicalTxEnabled).toBe(false);
    expect(first.running).toBe(true);
    const w=s.workers[0];
    expect(w.messages[0]).toMatchObject({cmd:'start',generation:first.generation});
    w.emit('message',{type:'started',generation:first.generation});
    const source=s.audio as unknown as EventEmitter;
    source.emit('audioData',new Float32Array(480),12000);
    await new Promise(resolve=>setImmediate(resolve));
    source.emit('audioData',new Float32Array(480),12000);
    await new Promise(resolve=>setImmediate(resolve));
    const messages=w.messages.filter((m)=> (m as {cmd:string}).cmd==='audio') as Array<{startSample:number;pcm:Buffer}>;
    expect(messages).toHaveLength(2);
    expect(messages.map(m=>m.startSample)).toEqual([0,480]);
    expect(messages[0].pcm.byteLength).toBe(480*4);
    w.emit('message',{type:'ack',generation:first.generation});
    w.emit('message',{type:'events',generation:first.generation,events:[{
      kind:'burst-decode',sessionId:`live-${first.generation}`,
      mode:'MSK144',timestampMs:1_800_000_000_000,frequencyHz:1500,
      observationWindowMs:40,text:'K1ABC K2ABC -10',snrDb:-3,
    }]});
    expect(s.live.recent(0)).toHaveLength(1);
    s.live.stop();
    expect(w.killed).toBe(true);
    const count=w.messages.length;
    source.emit('audioData',new Float32Array(480),12000);
    await new Promise(resolve=>setImmediate(resolve));
    expect(w.messages).toHaveLength(count);
    expect(s.live.status().running).toBe(false);
  });

  it('fails closed instead of concealing stream backpressure gaps',async()=>{
    const s=setup();
    const cfg=s.live.start({mode:'JTTY'});
    const w=s.workers[0];
    w.emit('message',{type:'started',generation:cfg.generation});
    const audio=s.audio as unknown as EventEmitter;
    for(let i=0;i<8;i++){
      audio.emit('audioData',new Float32Array(120),12000);
      await new Promise(resolve=>setImmediate(resolve));
    }
    expect(s.live.status().running).toBe(true);
    audio.emit('audioData',new Float32Array(120),12000);
    expect(s.live.status().running).toBe(false);
    expect(s.live.status().workerFaults).toBe(1);
    expect(s.live.status().lastError).toMatch(/backpressure/i);
    expect(w.killed).toBe(true);
  });

  it('never allows a stale native child to inject messages into a newer generation',()=>{
    const s=setup();
    const first=s.live.start({mode:'FT8'});
    const w=s.workers[0];
    s.live.stop();
    const second=s.live.start({mode:'Q65',q65Submode:'Q65-300A'});
    expect(second.generation).toBeGreaterThan(first.generation);
    w.emit('message',{type:'started',generation:first.generation});
    expect(s.live.status().ready).toBe(false);
    s.live.stop();
  });
  it('fails the isolated RX session on malformed native events without throwing into Fastify',()=>{
    const s=setup();
    const cfg=s.live.start({mode:'MSK144'});
    const child=s.workers[0];
    child.emit('message',{type:'started',generation:cfg.generation});
    expect(()=>child.emit('message',{
      type:'events',generation:cfg.generation,events:[{kind:'burst-decode',mode:'Q65'}],
    })).not.toThrow();
    expect(s.live.status().running).toBe(false);
    expect(s.live.status().workerFaults).toBe(1);
  });

  it('starts checking the first complete UTC period after startup rather than skipping a full period',()=>{
    const s=setup();
    s.at(1_800_000_000_000);
    const status=s.live.start({mode:'FT8'});
    s.workers[0].emit('message',{type:'started',generation:status.generation});
    // Slot-completion calculation must select the current slot after
    // 15s+650ms; previous code incorrectly marked it as already handled.
    s.at(1_800_000_015_750);
    (s.live as unknown as {pollSlot(generation:number, period:number):void})
      .pollSlot(status.generation,15000);
    // No audio was supplied: correctly rejected for insufficient fill.
    expect(s.live.status().rejectedSlots).toBe(1);
    s.live.stop();
  });

  it('updates the live Q65 AP hypothesis without restarting the native worker',async()=>{
    const s=setup();
    const state=s.live.start({mode:'Q65',q65Submode:'Q65-60B'});
    const w=s.workers[0];
    w.emit('message',{type:'started',generation:state.generation});
    const ap={myCall:'K1ABC',myGrid:'FN42',dxCall:'W9XYZ',dxGrid:'EN37',progress:2 as const};
    const pending=s.live.updateApContext(ap);
    expect(w.messages.at(-1)).toMatchObject({
      cmd:'ap-context',generation:state.generation,apContext:ap,
    });
    w.emit('message',{type:'ap-context-updated',generation:state.generation});
    await expect(pending).resolves.toMatchObject({running:true,ready:true,generation:state.generation});
    expect(s.workers).toHaveLength(1);
    expect(s.live.status().generation).toBe(state.generation);
    s.live.stop();
  });
  it('refuses Q65 AP updates on another mode or stale generation',async()=>{
    const s=setup();
    const state=s.live.start({mode:'MSK144'});
    s.workers[0].emit('message',{type:'started',generation:state.generation});
    await expect(s.live.updateApContext()).rejects.toThrow(/ready Q65/);
    s.live.stop();
  });

  it('retains the final JTTY reception-ended update before terminating its worker',async()=>{
    const s=setup();
    const active=s.live.start({mode:'JTTY'});
    const worker=s.workers[0];
    worker.emit('message',{type:'started',generation:active.generation});
    const pending=s.live.flushAndStop();
    await new Promise(resolve=>setImmediate(resolve));
    expect(worker.messages.at(-1)).toMatchObject({cmd:'stop',generation:active.generation});
    worker.emit('message',{type:'events',generation:active.generation,events:[{
      kind:'message-update',sessionId:`live-${active.generation}`,
      mode:'JTTY',timestampMs:1_800_000_000_000,frequencyHz:1500,
      messageId:'stream-1',revision:0,state:'reception-ended',text:'CQ K1ABC',
    }]});
    worker.emit('message',{type:'stopped',generation:active.generation});
    const stopped=await pending;
    expect(stopped.running).toBe(false);
    expect(worker.killed).toBe(true);
    expect(s.live.recent(0)).toEqual([
      expect.objectContaining({kind:'message-update',state:'reception-ended',text:'CQ K1ABC'}),
    ]);
  });
  it('waits for queued JTTY AF PCM before terminating the decoder',async()=>{
    const s=setup();
    const active=s.live.start({mode:'JTTY'});
    const worker=s.workers[0];
    worker.emit('message',{type:'started',generation:active.generation});
    const audio=s.audio as unknown as EventEmitter;
    audio.emit('audioData',new Float32Array(480),12000);
    const pending=s.live.flushAndStop();
    expect(worker.messages.some(m=>(m as {cmd:string}).cmd==='stop')).toBe(false);
    audio.emit('audioData',new Float32Array(480),12000);
    await new Promise(resolve=>setImmediate(resolve));
    expect(worker.messages.map(m=>(m as {cmd:string}).cmd))
      .toEqual(['start','audio','stop']);
    worker.emit('message',{type:'stopped',generation:active.generation});
    const outcome=await pending;
    expect(outcome.running).toBe(false);
    expect(worker.killed).toBe(true);
  });

});
