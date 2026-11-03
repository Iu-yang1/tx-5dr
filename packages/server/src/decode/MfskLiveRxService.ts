import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'eventemitter3';
import { RingBuffer } from '../audio/ringBuffer.js';
import { resampleAudioProfessional } from '../utils/audioUtils.js';
import type { AudioStreamManager } from '../audio/AudioStreamManager.js';
import {
  DigitalRxEventSchema, type DigitalCodecMode, type DigitalRxEvent,
  type Q65Submode, type MfskApContext,
} from '@tx5dr/contracts';
import { resolveDigitalSchedule } from '@tx5dr/core';
import { WsprSpotStore, type WsprDecodedSpot } from './WsprSpotStore.js';

export interface MfskLiveConfig {
  mode: DigitalCodecMode;
  q65Submode?: Q65Submode;
  frequencyHz?: number;
  depth?: 1|2|3;
  averaging?: boolean;
  emeDelay?: boolean;
  apContext?: MfskApContext;
}
export interface MfskLiveStatus {
  running: boolean;
  ready: boolean;
  physicalTxEnabled: false;
  mode?: DigitalCodecMode;
  q65Submode?: Q65Submode;
  generation: number;
  received: number;
  droppedAudioChunks: number;
  rejectedSlots: number;
  workerFaults: number;
  lastError?: string;
}
export interface MfskLiveEvents {
  events: (result: readonly DigitalRxEvent[])=>void;
  status: (status:MfskLiveStatus)=>void;
}

export class MfskLiveRxService extends EventEmitter<MfskLiveEvents> {
  private child: ChildProcess | null=null;
  private tick: NodeJS.Timeout|null=null;
  private config: MfskLiveConfig|null=null;
  private readonly now:()=>number;
  private readonly audio:AudioStreamManager;
  private readonly spawnWorker:(entry:string)=>ChildProcess;
  private generation=0;
  private ready=false;
  private ring:RingBuffer|null=null;
  private lastDecodedSlot=-1;
  private nextSample=0;
  private pending=0;
  private droppedAudioChunks=0;
  private rejectedSlots=0;
  private workerFaults=0;
  private received=0;
  private lastError:string|undefined;
  private serialized:Promise<void>=Promise.resolve();
  private readonly history:DigitalRxEvent[]=[];
  private readonly wsprSpotStore=new WsprSpotStore();
  private readonly onPcm=(samples:Float32Array,rate:number)=>this.receiveAudio(samples,rate);

  constructor(audio:AudioStreamManager, now:()=>number=Date.now,
    spawnWorker:(entry:string)=>ChildProcess=(entry)=>fork(entry,[],{
      execArgv:[],serialization:'advanced',stdio:['ignore','ignore','pipe','ipc'],
    })) {
    super();this.audio=audio;this.now=now;this.spawnWorker=spawnWorker;
  }

  status():MfskLiveStatus {
    return {
      running:this.config!==null,ready:this.ready,physicalTxEnabled:false,
      ...(this.config?{mode:this.config.mode,q65Submode:this.config.q65Submode}:{}),
      generation:this.generation,received:this.received,
      droppedAudioChunks:this.droppedAudioChunks,rejectedSlots:this.rejectedSlots,
      workerFaults:this.workerFaults,
      ...(this.lastError?{lastError:this.lastError}:{}),
    };
  }

  wsprSpots():WsprDecodedSpot[] {return this.wsprSpotStore.list();}

  recent(afterTimestampMs=0):DigitalRxEvent[] {
    if(!Number.isFinite(afterTimestampMs)||afterTimestampMs<0)throw new Error('Invalid event cursor');
    return this.history.filter(e=>e.timestampMs>afterTimestampMs).slice(-200);
  }

  /** ResourceManager awaits native load; no misleading engine RUNNING state. */
  async startReady(config:MfskLiveConfig,timeoutMs=15_000):Promise<MfskLiveStatus>{
    this.start(config);
    return new Promise((resolve,reject)=>{
      const cleanup=()=>{
        clearTimeout(timer);
        this.off('status',onStatus);
      };
      const onStatus=(state:MfskLiveStatus)=>{
        if(state.ready){cleanup();resolve(state);return;}
        if(!state.running){cleanup();reject(new Error(state.lastError??'Native receiver stopped before ready'));}
      };
      const timer=setTimeout(()=>{
        cleanup();
        this.stop();
        reject(new Error('Timed out waiting for native receiver process'));
      },timeoutMs);
      this.on('status',onStatus);
      if(this.ready)onStatus(this.status());
    });
  }

  start(config:MfskLiveConfig):MfskLiveStatus {
    this.stop();
    const definition=resolveDigitalSchedule(config.mode,config.q65Submode);
    const f=config.frequencyHz??1500;
    if(!Number.isFinite(f)||f<100||f>5500)throw new Error('Invalid receiver AF centre frequency');
    if(config.depth!==undefined && ![1,2,3].includes(config.depth))throw new Error('Invalid decode depth');
    if(config.averaging && config.mode!=='Q65')throw new Error('Averaging only supported for Q65');
    if(config.emeDelay && config.mode!=='Q65')throw new Error('EME delay only supported for Q65');
    if(config.apContext && config.mode!=='Q65')throw new Error('AP context only supported for Q65');

    this.generation++;
    const generation=this.generation;
    this.config={...config};
    // The first complete slot after startup is the slot containing now.
    // Do not mark it decoded before any PCM has arrived.
    this.lastDecodedSlot=definition.slotMs===null?-1:
      Math.floor(this.now()/definition.slotMs)*definition.slotMs-definition.slotMs;
    this.nextSample=0;this.pending=0;this.history.length=0;this.received=0;
    this.wsprSpotStore.clear();
    this.lastError=undefined;this.ready=false;this.droppedAudioChunks=0;
    this.rejectedSlots=0;this.workerFaults=0;
    // Independent long-period buffer: a 300 s Q65 slot cannot fit the
    // application's standard 60 s FT8 ring. Keep 1 s timing slack.
    this.ring=definition.slotMs===null?null:new RingBuffer(12000,definition.slotMs+1000,this.now);
    const url=fileURLToPath(new URL('./mfsk-live-worker.js',import.meta.url));
    const child=this.spawnWorker(url);
    this.child=child;
    child.on('message',(payload:unknown)=>this.onWorkerMessage(generation,payload));
    child.on('error',(e)=>this.fail(generation,e.message));
    child.on('exit',(code,signal)=>{
      if(this.child!==child)return;
      this.fail(generation,`MFSK receiver exited (code=${code},signal=${signal})`);
    });
    child.stderr?.on('data',(b:Buffer)=>{
      if(this.generation===generation){
        this.lastError=String(b).slice(-1000);
      }
    });
    child.send({cmd:'start',generation,config:{
      sessionId:`live-${generation}`,mode:config.mode,q65Submode:config.q65Submode,
      audioFrequencyHz:f,depth:config.depth??3,averaging:config.averaging??false,
      emeDelay:config.emeDelay??false,
      apContext:config.apContext,
    }});
    this.audio.on('audioData',this.onPcm);
    if(definition.slotMs!==null) {
      this.tick=setInterval(()=>this.pollSlot(generation,definition.slotMs!),100);
      this.tick.unref();
    }
    this.emit('status',this.status());
    return this.status();
  }

  /**
   * Gracefully finish a user-requested JTTY receive session. The child is
   * still isolated and may crash or hang: a hard timeout always stops it.
   * Other modes can stop immediately; no JTTY terminal frames are expected.
   */
  async flushAndStop(timeoutMs=2_000):Promise<MfskLiveStatus> {
    if(!this.child||!this.ready||this.config?.mode!=='JTTY')return this.stop();
    const child=this.child;
    const generation=this.generation;
    return new Promise(resolve=>{
      let done=false;
      const finish=()=>{
        if(done)return;
        done=true;
        clearTimeout(timer);
        child.off('message',onMessage);
        if(this.child===child && this.generation===generation)this.stop();
        resolve(this.status());
      };
      const onMessage=(payload:unknown)=>{
        if(!payload||typeof payload!=='object')return;
        const value=payload as {type?:string;generation?:number};
        if(value.type==='stopped'&&value.generation===generation)finish();
      };
      const timer=setTimeout(finish,timeoutMs);
      timer.unref();
      child.on('message',onMessage);
      try{child.send({cmd:'stop',generation});}
      catch{finish();}
    });
  }

  stop():MfskLiveStatus {
    this.generation++;
    if(this.tick){clearInterval(this.tick);this.tick=null;}
    this.audio.off('audioData',this.onPcm);
    const child=this.child;
    this.child=null;this.config=null;this.ring=null;this.ready=false;
    this.pending=0;this.serialized=Promise.resolve();
    if(child){child.removeAllListeners();child.kill();}
    this.emit('status',this.status());
    return this.status();
  }

  private fail(generation:number,error:string):void {
    if(this.generation!==generation)return;
    this.workerFaults++;
    this.lastError=error;
    this.stop();
  }

  private onWorkerMessage(generation:number,payload:unknown):void {
    if(this.generation!==generation||!payload||typeof payload!=='object')return;
    const m=payload as {type?:string;generation?:number;dropped?:boolean;error?:string;events?:unknown[]};
    if(m.generation!==generation)return;
    if(m.type==='started')this.ready=true;
    if(m.type==='ack')this.pending=Math.max(0,this.pending-1);
    if(m.type==='fault') {this.fail(generation,m.error??'Unknown native decoder failure');return;}
    if(m.type==='events'&&Array.isArray(m.events)){
      let events:DigitalRxEvent[];
      try {
        events=m.events.map(e=>DigitalRxEventSchema.parse(e));
      } catch (error) {
        this.fail(generation,`Native decoder returned invalid event: ${error instanceof Error?error.message:String(error)}`);
        return;
      }
      this.history.push(...events);this.received+=events.length;
      for(const event of events)this.wsprSpotStore.add(event);
      if(this.history.length>200)this.history.splice(0,this.history.length-200);
      this.emit('events',events);
    }
    this.emit('status',this.status());
  }

  private receiveAudio(pcm:Float32Array,sampleRate:number):void {
    const generation=this.generation;
    if(!this.ready||!this.config||!this.child)return;
    if(!Number.isFinite(sampleRate)||sampleRate<8000||sampleRate>192000||!pcm.length)return;
    if(this.pending>=8){
      this.droppedAudioChunks++;
      // Streaming modes cannot silently continue after a hole. Terminate
      // this generation instead of concatenating unrelated audio samples.
      if(!this.ring)this.fail(generation,'Live RX backpressure caused non-contiguous PCM');
      return;
    }
    // Preserve arrival order across any asynchronous resampling.
    const snapshot=new Float32Array(pcm);
    this.serialized=this.serialized.then(async()=>{
      if(this.generation!==generation)return;
      const normalized=sampleRate===12000?snapshot:
        await resampleAudioProfessional(snapshot,sampleRate,12000,1);
      if(this.generation!==generation||!this.config)return;
      if(normalized.length===0||normalized.some(x=>!Number.isFinite(x))){
        this.fail(generation,'Invalid resampled AF audio');
        return;
      }
      if(this.ring){
        this.ring.write(normalized,this.now());
      }else{
        this.sendAudio(generation,normalized);
      }
    }).catch(e=>this.fail(generation,e instanceof Error?e.message:String(e)));
  }

  private sendAudio(generation:number,samples:Float32Array):void {
    if(this.generation!==generation||!this.child||!this.ready)return;
    if(this.pending>=8){
      this.fail(generation,'Native streaming RX queue overrun');
      return;
    }
    const bytes=Buffer.from(samples.buffer.slice(samples.byteOffset,
      samples.byteOffset+samples.byteLength));
    const startSample=this.nextSample;
    this.nextSample+=samples.length;
    this.pending++;
    this.child.send({cmd:'audio',generation,startSample,
      timestampMs:this.now(),pcm:bytes});
  }

  private pollSlot(generation:number,periodMs:number):void {
    if(this.generation!==generation||!this.ready||!this.ring||!this.child)return;
    const now=this.now();
    // Allow the AF callback and resampler to deliver the final audio tail.
    const completed=Math.floor((now-650)/periodMs)*periodMs-periodMs;
    if(completed<=this.lastDecodedSlot)return;
    this.lastDecodedSlot=completed;
    const reading=this.ring.readByWallClock(completed,periodMs);
    if(reading.filledRatio<0.98||reading.futureSamples>0||reading.evictedSamples>0){
      this.rejectedSlots++;
      this.emit('status',this.status());
      return;
    }
    if(this.pending>=2) {
      this.rejectedSlots++;
      return;
    }
    this.pending++;
    this.child.send({cmd:'slot',generation,utcStartMs:completed,
      timestampMs:now,pcm:Buffer.from(reading.pcm)});
  }
}
