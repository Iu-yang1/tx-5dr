import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  type DigitalCodecMode, type Q65Submode,
  MfskCodecSimulationRequestSchema,
} from '@tx5dr/contracts';
import { resolveDigitalSchedule } from '@tx5dr/core';
import type {
  PhysicalAudioTransmissionRequest,
  PhysicalTxResult,
} from '../transmission/PhysicalTxCoordinator.js';

export interface MfskTxRequest {
  mode: DigitalCodecMode;
  text: string;
  operatorId: string;
  audioHz: number;
  q65Submode?: Q65Submode;
  /** Explicit opt-in for 120-second WSPR beacon transmission. */
  beaconAuthorized?: boolean;
}
export interface MfskTxWaveform {
  audioData: Float32Array;
  sampleRate: 12000;
  canonicalText: string;
}
export interface MfskTxAdmission {
  /** The existing radio engine must be in exactly this native mode. */
  mode(): string;
  isRunning(): boolean;
  operatorExists(id:string): boolean;
  now(): number;
  transmitAudio(request:PhysicalAudioTransmissionRequest):Promise<PhysicalTxResult>;
  stopTuneTone():Promise<void>;
  /** True ONLY after P9 TX eligibility and explicit RF enable are verified. */
  rfAllowed():boolean;
  sleep?(ms:number):Promise<void>;
  encode?(request:MfskTxRequest):Promise<MfskTxWaveform>;
}

export interface MfskTxOutcome {
  mode:DigitalCodecMode;
  scheduledStartMs:number|null;
  durationMs:number;
  result:PhysicalTxResult;
}

/**
 * Physical TX cannot be entered by merely having an mfsk-core addon loaded.
 * Require mode ownership, PTT/physical lease, operator auth (checked by route)
 * plus an independent product-level RF readiness gate.
 */
export class MfskNativeTxService {
  private epoch=0;
  private busy=false;
  constructor(private readonly deps:MfskTxAdmission) {}

  cancel():void {this.epoch++;}
  isBusy():boolean {return this.busy;}

  async send(request:MfskTxRequest):Promise<MfskTxOutcome> {
    if(this.busy)throw new Error('A native transmit operation is already pending');
    this.validateRequest(request);
    if(!this.deps.rfAllowed())throw new Error('Native RF TX disabled pending P9 release acceptance');
    this.assertPreconditions(request);
    const epoch=this.epoch;
    this.busy=true;
    try{
      const encoded=await (this.deps.encode??encodeMfskInChild)(request);
      this.assertPreconditions(request,epoch);
      const count=encoded.audioData.length;
      if(encoded.sampleRate!==12_000 || !Number.isSafeInteger(count)||count<=0
        ||count>12_000*305||encoded.audioData.some(x=>!Number.isFinite(x)||Math.abs(x)>1.000001)){
        throw new Error('Invalid native TX PCM');
      }
      const normalize=(s:string)=>s.trim().toUpperCase().replace(/\s+/g,' ');
      if(normalize(encoded.canonicalText)!==normalize(request.text)){
        throw new Error('Native TX canonicalized text differs from requested text');
      }
      const durationMs=count/12;
      const definition=resolveDigitalSchedule(request.mode,request.q65Submode);
      const periodMs=definition.slotMs;
      let startMs:null|number=null;
      if(periodMs!==null){
        const margin=request.mode==='WSPR'?2000:500;
        const now=this.deps.now();
        // Schedule a completely future slot: never start a partial WSPR
        // or Q65 waveform, even if the UI clicked near a UTC boundary.
        const slotStart=(Math.floor((now+1000)/periodMs)+1)*periodMs;
        startMs=slotStart+margin;
        const remaining=periodMs-margin-durationMs;
        if(remaining<300)throw new Error('Encoded waveform exceeds safe UTC TX period budget');
        const delay=Math.max(0,startMs-this.deps.now());
        if(delay>periodMs+2000)throw new Error('Unreasonable UTC TX wait');
        await (this.deps.sleep??(ms=>new Promise<void>(resolve=>setTimeout(resolve,ms))))(delay);
        this.assertPreconditions(request,epoch);
        if(this.deps.now()>slotStart+periodMs-durationMs-200){
          throw new Error('TX preparation deadline missed: insufficient slot budget');
        }
      }
      const outcome=await this.deps.transmitAudio({
        source:'digital',operatorIds:[request.operatorId],playbackKind:'digital',
        reason:`native ${request.mode} manual transmission`,
        audioData:encoded.audioData,sampleRate:encoded.sampleRate,
        assertPtt:true,tailHoldMs:100,
        beforeStart:()=>this.deps.stopTuneTone(),
        validateStart:()=>this.assertPreconditions(request,epoch),
      });
      return {mode:request.mode,scheduledStartMs:startMs,durationMs,result:outcome};
    }finally{
      this.busy=false;
    }
  }

  private validateRequest(request:MfskTxRequest):void {
    if(!request.operatorId||request.operatorId.length>128)throw new Error('Missing transmitter operator');
    MfskCodecSimulationRequestSchema.parse({
      mode:request.mode,text:request.text,
      audioFrequencyHz:request.audioHz,q65Submode:request.q65Submode,
    });
    if(request.mode==='WSPR'&&!request.beaconAuthorized){
      throw new Error('WSPR beacon transmission requires explicit authorization');
    }
  }
  private assertPreconditions(r:MfskTxRequest,epoch=this.epoch):void {
    if(epoch!==this.epoch)throw new Error('Native TX cancelled by a newer mode or radio generation');
    if(!this.deps.rfAllowed())throw new Error('Native RF TX disabled');
    if(!this.deps.isRunning()||this.deps.mode()!==r.mode){
      throw new Error('Native TX mode is not the active running radio engine mode');
    }
    if(!this.deps.operatorExists(r.operatorId)){
      throw new Error('Operator no longer exists');
    }
  }
}

/** Child-process encoder: does not execute Rust DSP on the Fastify thread. */
export function encodeMfskInChild(request:MfskTxRequest):Promise<MfskTxWaveform> {
  return new Promise((resolve,reject)=>{
    const entry=fileURLToPath(new URL('./mfsk-tx-worker.js',import.meta.url));
    const child=fork(entry,[],{
      execArgv:[],serialization:'advanced',stdio:['ignore','ignore','pipe','ipc'],
    });
    let complete=false;
    const fail=(e:unknown)=>{
      if(complete)return;complete=true;clearTimeout(timeout);child.kill();
      reject(e instanceof Error?e:new Error(String(e)));
    };
    const timeout=setTimeout(()=>fail(new Error('Native TX encoder timed out')),90_000);
    child.on('error',fail);
    child.on('exit',(code)=>{if(!complete)fail(new Error(`Native TX encoder exited ${code}`));});
    child.on('message',(payload:unknown)=>{
      if(complete)return;
      if(!payload||typeof payload!=='object')return fail(new Error('Invalid native TX IPC reply'));
      const reply=payload as {type?:string;message?:string;data?:Uint8Array;sampleRate?:number;canonicalText?:string};
      if(reply.type==='error')return fail(new Error(reply.message??'Native encoder failed'));
      if(reply.type!=='waveform'||!(reply.data instanceof Uint8Array)||reply.sampleRate!==12000
        ||typeof reply.canonicalText!=='string')return fail(new Error('Native TX waveform reply malformed'));
      const data=Buffer.from(reply.data);
      if(data.length===0||data.length%4!==0||data.length>12_000*305*4){
        return fail(new Error('Native TX waveform payload exceeds size constraints'));
      }
      const samples=new Float32Array(data.length/4);
      for(let i=0;i<samples.length;i++)samples[i]=data.readFloatLE(i*4);
      complete=true;clearTimeout(timeout);child.kill();
      resolve({audioData:samples,sampleRate:12000,canonicalText:reply.canonicalText});
    });
    child.send({mode:request.mode,text:request.text,operatorId:request.operatorId,
      audioFrequencyHz:request.audioHz,
      ...(request.q65Submode?{q65Submode:request.q65Submode}:{})});
  });
}
