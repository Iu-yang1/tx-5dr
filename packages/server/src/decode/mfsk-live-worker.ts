/**
 * Isolated native AF receiver. Native decoding MUST NOT run inside the
 * main Fastify event loop. It has no radio, PTT or logbook capability.
 */
import { MfskMultimodeRuntime, type MfskSessionConfig } from './MfskMultimodeRuntime.js';
import type { DigitalRxEvent } from '@tx5dr/contracts';

type StartMessage = { cmd: 'start'; generation: number; config: MfskSessionConfig };
type SlotMessage = { cmd: 'slot'; generation: number; utcStartMs: number; timestampMs: number; pcm: Buffer };
type StreamMessage = { cmd: 'audio'; generation: number; startSample: number; timestampMs: number; pcm: Buffer };
type StopMessage = { cmd: 'stop' | 'shutdown'; generation: number };
type RxCommand = StartMessage | SlotMessage | StreamMessage | StopMessage;

let decoder: MfskMultimodeRuntime | null = null;
let active: { id: string; generation: number; mode: MfskSessionConfig['mode'] } | null = null;
let processing = false;

function send(message: unknown): void {
  if (process.send) process.send(message);
}

function unpack(input: unknown): Float32Array {
  if (!Buffer.isBuffer(input) && !(input instanceof Uint8Array)) {
    throw new Error('IPC PCM must be a Buffer or Uint8Array');
  }
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (bytes.byteLength === 0 || bytes.byteLength % 4 !== 0 || bytes.byteLength > 12000 * 305 * 4) {
    throw new Error('IPC PCM length out of bounds');
  }
  const pcm = new Float32Array(bytes.byteLength / 4);
  for(let i=0;i<pcm.length;i++) {
    const value = bytes.readFloatLE(i * 4);
    if (!Number.isFinite(value)) throw new Error('Non-finite IPC PCM');
    pcm[i] = value;
  }
  return pcm;
}

function processCommand(message: RxCommand): void {
  if (processing) throw new Error('Concurrent native receiver request');
  processing=true;
  try {
    if(message.cmd === 'shutdown') {
      if(active && decoder) decoder.stop(active.id);
      process.exit(0);
    }
    if (message.cmd==='stop') {
      if(active && decoder) decoder.stop(active.id);
      active=null;
      decoder=null;
      send({ type:'stopped', generation: message.generation });
      return;
    }
    if(message.cmd==='start'){
      if(active && decoder) decoder.stop(active.id);
      decoder=new MfskMultimodeRuntime();
      decoder.begin(message.config);
      active={id:message.config.sessionId,generation:message.generation,mode:message.config.mode};
      send({type:'started',generation:message.generation});
      return;
    }
    if(!active || !decoder || message.generation !== active.generation){
      send({type:'ack',generation:message.generation,dropped:true});
      return;
    }
    const pcm=unpack(message.pcm);
    const events:DigitalRxEvent[]=message.cmd==='slot'
      ? decoder.decodeSlot(active.id,0,{
          slotStartMs:message.utcStartMs,timestampMs:message.timestampMs,
          samples:pcm,final:true,
        })
      : decoder.pushStream(active.id,0,message.startSample,message.timestampMs,pcm);
    if(events.length) send({type:'events',generation:message.generation,events});
    send({type:'ack',generation:message.generation});
  } finally {
    processing=false;
  }
}

process.on('message', (payload:unknown) => {
  try{
    if(!payload || typeof payload!=='object' || !('cmd' in payload)) {
      throw new Error('Malformed native receiver IPC command');
    }
    processCommand(payload as RxCommand);
  }catch(error) {
    send({type:'fault',generation:active?.generation??-1,
      error:error instanceof Error?error.message:String(error)});
    if(active && decoder)decoder.stop(active.id);
    active=null; decoder=null;
  }
});
process.on('disconnect',()=>process.exit(0));
process.on('uncaughtException',(e)=>{send({type:'fault',generation:active?.generation??-1,error:e.message});process.exit(1)});
process.on('unhandledRejection',(e)=>{send({type:'fault',generation:active?.generation??-1,error:String(e)});process.exit(1)});
