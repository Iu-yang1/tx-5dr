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
  it('rejects invalid protocols without creating a decode child',()=>{
    const s=setup();
    expect(()=>s.live.start({mode:'Q65',q65Submode:'Q65-60B',frequencyHz:90000})).toThrow();
    expect(s.workers).toHaveLength(0);
    expect(s.live.status().running).toBe(false);
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

  it('retains the final JTTY reception-ended update before terminating its worker',async()=>{
    const s=setup();
    const active=s.live.start({mode:'JTTY'});
    const worker=s.workers[0];
    worker.emit('message',{type:'started',generation:active.generation});
    const pending=s.live.flushAndStop();
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
});
