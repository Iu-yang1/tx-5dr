import {
  DigitalCodecRuntimeCapabilitySchema, DigitalRxEventSchema,
  type DigitalCodecMode, type DigitalCodecRuntimeCapability, type DigitalRxEvent,
  type Q65Submode, Q65_PERIOD_MS,
} from '@tx5dr/contracts';
import {
  AudioStreamSequence, containingDigitalSlot, resolveDigitalSchedule,
  type DigitalScheduleDefinition,
} from '@tx5dr/core';
import {
  loadMfskNative, verifyNativeWaveform, type MfskNativeModule,
  type MfskNativeWaveform, type MfskNativeRow,
} from './MfskNativeAdapter.js';

export interface NativeSlotDecoder {
  decode(pcmF32Le: Buffer, periodIndex?: number, earlyPrefix?: boolean): MfskNativeRow[];
  setParameters(depth: number, averaging: boolean, rxHz?: number, toleranceHz?: number): void;
  setQ65SearchOptions?: (seconds?: number, score?: number, maxCandidates?: number) => void;
  setApContext(myCall: string, myGrid: string, dxCall: string, dxGrid: string, progress: number, enabled: boolean): void;
  setEmeDelay(enabled: boolean): void;
  clear(): void;
}

export interface NativeJttySession {
  push(pcmF32Le: Buffer): Array<{
    id: string; text: string; state: 'growing' | 'complete' | 'expired' | 'reception-ended';
    frequencyHz: number; startSeconds: number; endSeconds: number; snrDb: number;
  }>;
  finish(): ReturnType<NativeJttySession['push']>;
  reset(): void;
}

export interface NativeMsk144Session {
  push(pcmF32Le: Buffer): MfskNativeRow[];
  configureShorthand(enabled: boolean, call1: string, call2: string): void;
  configureEqualizer(enabled: boolean, dxCall: string): void;
  newPeriod(): void;
  reset(): void;
}

export interface MfskSessionConfig {
  sessionId: string;
  mode: DigitalCodecMode;
  q65Submode?: Q65Submode;
  q65Search?: { timeToleranceSeconds?: number; scoreThreshold?: number; maxCandidates?: number };
  audioFrequencyHz?: number;
  toleranceHz?: number;
  depth?: 1 | 2 | 3;
  averaging?: boolean;
  emeDelay?: boolean;
  msk144Rx?: {
    dxCall:string; myCall?:string;
    shorthand?:boolean; adaptiveEqualizer?:boolean;
  };
}

export interface MfskSlotDecodeInput {
  slotStartMs: number;
  timestampMs: number;
  samples: Float32Array;
  /** A single complete or partial slot; exactly 12 kHz mono PCM. */
  final: boolean;
  ap?: {
    myCall: string; myGrid: string; dxCall: string; dxGrid?: string;
    progress: 0 | 1 | 2 | 3 | 4 | 5;
  };
}

interface SessionState {
  cfg: MfskSessionConfig;
  definition: DigitalScheduleDefinition;
  generation: number;
  source: NativeSlotDecoder | NativeJttySession | NativeMsk144Session;
  sequence?: AudioStreamSequence;
  revisions: Map<string, number>;
  lastSlotStartMs?: number;
}

/**
 * Mode-correct experimental offline codec engine. This is a simulation / IPC
 * service, NOT a transmitter controller. There is no PTT method or physical
 * TX lease, and no fallback to wsjtx-lib. Host must isolate it in a child.
 */
export class MfskMultimodeRuntime {
  private readonly native: MfskNativeModule;
  private readonly sessions = new Map<string, SessionState>();

  constructor(nativeForTests?: MfskNativeModule) {
    if (nativeForTests) this.native = nativeForTests;
    else {
      const result = loadMfskNative();
      if (!result.ready) throw new Error(result.reason);
      this.native = result.module;
    }
  }

  /** Reflect codec availability without falsely claiming safe physical TX. */
  capability(mode: DigitalCodecMode): DigitalCodecRuntimeCapability {
    const supported = this.native.supportedModes();
    const prefix = mode === 'Q65' ? 'Q65-' : mode;
    const available = mode === 'Q65'
      ? supported.includes('Q65-60B') : supported.includes(prefix);
    return DigitalCodecRuntimeCapabilitySchema.parse({
      mode,
      backend: available ? 'mfsk-native' : 'unavailable',
      receiverReady: available,
      encoderReady: available,
      schedulerReady: available,
      txPipelineReady: false,
      submodes: mode === 'Q65' ? supported.filter(x => x.startsWith('Q65-')) : [],
    });
  }

  begin(cfg: MfskSessionConfig): number {
    if (!cfg.sessionId || cfg.sessionId.length > 128 || this.sessions.has(cfg.sessionId)) {
      throw new Error('Session ID missing, too long or already in use');
    }
    const d = resolveDigitalSchedule(cfg.mode, cfg.q65Submode);
    if (!this.capability(cfg.mode).receiverReady) throw new Error('Native RX mode not available');
    const f = cfg.audioFrequencyHz ?? 1500;
    if (!Number.isFinite(f) || f < 100 || f > 5500) throw new Error('Invalid AF centre frequency');
    const tolerance = cfg.toleranceHz ?? 200;
    if (!Number.isFinite(tolerance) || tolerance < 1 || tolerance > 5000) throw new Error('Invalid frequency tolerance');
    if (cfg.depth !== undefined && ![1, 2, 3].includes(cfg.depth)) throw new Error('Invalid depth');
    if (cfg.averaging && cfg.mode !== 'Q65') throw new Error('Averaging is only enabled for Q65 in this bridge');
    if (cfg.emeDelay && cfg.mode !== 'Q65') throw new Error('EME delay is only supported here for Q65');
    if (cfg.q65Search) {
      if (cfg.mode !== 'Q65') throw new Error('Q65 sync options require Q65 mode');
      const opts=cfg.q65Search;
      if ((opts.timeToleranceSeconds !== undefined &&
          (!Number.isFinite(opts.timeToleranceSeconds) || opts.timeToleranceSeconds<1 || opts.timeToleranceSeconds>150))
        || (opts.scoreThreshold !== undefined &&
          (!Number.isFinite(opts.scoreThreshold) || opts.scoreThreshold<0.01 || opts.scoreThreshold>1))
        || (opts.maxCandidates !== undefined &&
          (!Number.isInteger(opts.maxCandidates) || opts.maxCandidates<1 || opts.maxCandidates>64))) {
        throw new Error('Invalid Q65 sync settings');
      }
    }
    if (cfg.msk144Rx) {
      if(cfg.mode!=='MSK144') throw new Error('MSK144 RX options require MSK144 mode');
      const call=/^[A-Z0-9/]{3,12}$/;
      if(!call.test(cfg.msk144Rx.dxCall)) throw new Error('Invalid DX callsign for MSK144 training');
      if(cfg.msk144Rx.shorthand && tolerance>250){
        throw new Error('MSK40 shorthand tolerance is limited to 250 Hz');
      }
      if(cfg.msk144Rx.shorthand && !call.test(cfg.msk144Rx.myCall??'')){
        throw new Error('MSK40 shorthand requires known MY and DX calls');
      }
    }
    let source: SessionState['source'];
    const raw = this.native as unknown as {
      SlottedSession: new (name:string) => NativeSlotDecoder;
      JttySession: new (hz:number) => NativeJttySession;
      Msk144Session: new (hz:number,tolerance:number) => NativeMsk144Session;
    };
    if (cfg.mode === 'JTTY') source = new raw.JttySession(f);
    else if (cfg.mode === 'MSK144') {
      const receiver=new raw.Msk144Session(f,tolerance);
      if(cfg.msk144Rx){
        receiver.configureEqualizer(Boolean(cfg.msk144Rx.adaptiveEqualizer),cfg.msk144Rx.dxCall);
        receiver.configureShorthand(Boolean(cfg.msk144Rx.shorthand),
          cfg.msk144Rx.myCall??'',cfg.msk144Rx.dxCall);
      }
      source=receiver;
    }
    else {
      source = new raw.SlottedSession(cfg.mode === 'Q65' ? d.submode! : cfg.mode);
      source.setParameters(cfg.depth ?? 3, cfg.averaging ?? false, f, tolerance);
      if (cfg.q65Search && Object.keys(cfg.q65Search).length > 0) {
        if (typeof source.setQ65SearchOptions !== 'function')
          throw new Error('Native addon lacks Q65 search-options support');
        source.setQ65SearchOptions(
          cfg.q65Search.timeToleranceSeconds,
          cfg.q65Search.scoreThreshold,
          cfg.q65Search.maxCandidates,
        );
      }
      source.setEmeDelay(cfg.emeDelay ?? false);
    }
    const sequence = d.scheduling === 'utc-slot' ? undefined : new AudioStreamSequence();
    const state: SessionState = { cfg: {...cfg}, definition:d, generation:0, source, sequence, revisions:new Map() };
    this.sessions.set(cfg.sessionId, state);
    return 0;
  }

  stop(sessionId: string): void {
    const state=this.sessions.get(sessionId);
    if (!state) return;
    state.sequence?.restart();
    this.sessions.delete(sessionId);
  }

  reset(sessionId: string): number {
    const state = this.get(sessionId);
    state.generation++;
    state.lastSlotStartMs = undefined;
    state.revisions.clear();
    if (state.definition.scheduling === 'utc-slot') (state.source as NativeSlotDecoder).clear();
    else if (state.cfg.mode === 'MSK144') {
      const receiver=state.source as NativeMsk144Session;
      receiver.reset();
      if(state.cfg.msk144Rx){
        receiver.configureEqualizer(Boolean(state.cfg.msk144Rx.adaptiveEqualizer),
          state.cfg.msk144Rx.dxCall);
        receiver.configureShorthand(Boolean(state.cfg.msk144Rx.shorthand),
          state.cfg.msk144Rx.myCall??'',state.cfg.msk144Rx.dxCall);
      }
    }
    else (state.source as NativeJttySession).reset();
    state.sequence?.restart();
    return state.generation;
  }

  decodeSlot(sessionId: string, generation: number, input: MfskSlotDecodeInput): DigitalRxEvent[] {
    const state=this.get(sessionId);
    if (generation !== state.generation) return [];
    if (state.definition.scheduling !== 'utc-slot') throw new Error('Cannot slot-decode a continuous mode');
    if (!Number.isSafeInteger(input.timestampMs) || !Number.isSafeInteger(input.slotStartMs)) {
      throw new Error('Invalid UTC slot timestamp');
    }
    const slot = containingDigitalSlot(state.definition,input.slotStartMs);
    if (slot.startMs !== input.slotStartMs || input.timestampMs < input.slotStartMs) {
      throw new Error('Non-aligned or premature decode period');
    }
    if (state.lastSlotStartMs !== undefined && input.slotStartMs < state.lastSlotStartMs) {
      throw new Error('Out of order slot; reset the decoder before replay');
    }
    const samples = validateSamples(input.samples, 12_000 * 305);
    if (state.definition.slotMs === null || samples.length > 12_000 * state.definition.slotMs / 1000) {
      throw new Error('PCM exceeds this mode period');
    }
    const period = slot.period;
    if (!Number.isInteger(period) || period < 0 || period > 2_147_483_647) {
      throw new Error('Native period index out of range');
    }
    const decoder = state.source as NativeSlotDecoder;
    const ap=input.ap;
    decoder.setApContext(ap?.myCall??'',ap?.myGrid??'',ap?.dxCall??'',ap?.dxGrid??'',ap?.progress??0, Boolean(ap));
    state.lastSlotStartMs = input.slotStartMs;
    const prefix = state.cfg.mode === 'FT8' && !input.final;
    const pcm = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
    const rows=decoder.decode(pcm,period,prefix);
    return rows.map(r=> {
      const event: DigitalRxEvent = {
        kind:'slot-decode',sessionId,mode:state.cfg.mode,
        timestampMs:input.timestampMs,frequencyHz:assertFinite(r.frequencyHz),
        slotId:slot.slotId,text:r.text,snrDb:assertFinite(r.snrDb),
        dtSeconds:assertFinite(r.dtSeconds),final:input.final,
      };
      return DigitalRxEventSchema.parse(event);
    });
  }

  /** No artificial slot conversion. Call with consecutive 12kHz samples. */
  pushStream(sessionId: string, generation: number, sampleStart: number,
    timestampMs: number, samples: Float32Array): DigitalRxEvent[] {
    const state=this.get(sessionId);
    if (state.definition.scheduling === 'utc-slot' || !state.sequence) {
      throw new Error('Slot mode cannot accept continuous chunks');
    }
    if (generation !== state.generation) return [];
    const pcm=validateSamples(samples,12_000 * 10);
    // First check sequence and then call decoder; if a decoder fails, reset.
    if (!state.sequence.accept(state.sequence.currentGeneration(),sampleStart,pcm.length)) {
      throw new Error('Non-monotonic or gapped stream PCM; restart session');
    }
    const bytes=Buffer.from(pcm.buffer,pcm.byteOffset,pcm.byteLength);
    try {
      if(state.cfg.mode === 'MSK144'){
        const rows=(state.source as NativeMsk144Session).push(bytes);
        return rows.map(r=>DigitalRxEventSchema.parse({
          kind:'burst-decode',sessionId,mode:'MSK144',timestampMs,
          frequencyHz:assertFinite(r.frequencyHz),text:r.text,snrDb:assertFinite(r.snrDb),
          observationWindowMs:1000*pcm.length/12_000,
        }));
      }
      const updates=(state.source as NativeJttySession).push(bytes);
      return updates.map(u=>this.jttyEvent(state,sessionId,timestampMs,u));
    }catch(error) {
      this.reset(sessionId);
      throw error;
    }
  }

  finishJtty(sessionId: string, timestampMs: number): DigitalRxEvent[] {
    const s=this.get(sessionId);
    if(s.cfg.mode!=='JTTY') throw new Error('finishJtty is only for JTTY');
    return (s.source as NativeJttySession).finish().map(u=>this.jttyEvent(s,sessionId,timestampMs,u));
  }

  /** Virtual-ONLY waveform generator; caller never receives permission to key PTT. */
  encodeVirtual(cfg: Omit<MfskSessionConfig,'sessionId'>, text: string,
    periodSeconds = 15): { pcm: Float32Array; sampleRate: 12000; canonicalText: string } {
    const d=resolveDigitalSchedule(cfg.mode,cfg.q65Submode);
    const f=cfg.audioFrequencyHz??1500;
    if (!Number.isFinite(f)||f<100||f>5500) throw new Error('Invalid virtual TX AF frequency');
    if (!this.capability(cfg.mode).encoderReady) throw new Error('Codec encoder not available');
    let wave:MfskNativeWaveform;
    if(cfg.mode==='JTTY'){
      wave=this.native.encodeJtty(text,f);
    }else if(cfg.mode==='MSK144'){
      if(![5,10,15,30].includes(periodSeconds)) throw new Error('Unsupported MSK144 period');
      const parts=text.trim().toUpperCase().split(/\s+/);
      if(parts.length!==3) throw new Error('MSK144 standard TX requires CALL1 CALL2 REPORT');
      wave=this.native.encodeMsk144Standard(parts[0],parts[1],parts[2],periodSeconds);
    }else{
      wave=this.native.encodeSlotted(cfg.mode==='Q65'?d.submode!:cfg.mode,text,f);
    }
    // A read-only simulator can construct audio, but the physical TX permission
    // remains absent in every capability exposed by this experimental service.
    const pcm=(cfg.mode==='MSK144'||cfg.mode==='JTTY')
      ? validateStreamWave(wave,text)
      : verifyNativeWaveform(wave,text,cfg.mode);
    return {pcm,sampleRate:12000,canonicalText:wave.canonicalText};
  }

  private jttyEvent(s:SessionState,sessionId:string,timestampMs:number,
    u:ReturnType<NativeJttySession['push']>[number]): DigitalRxEvent {
    const rev=(s.revisions.get(u.id)??-1)+1;
    s.revisions.set(u.id,rev);
    return DigitalRxEventSchema.parse({
      kind:'message-update',sessionId,mode:'JTTY',timestampMs,
      frequencyHz:assertFinite(u.frequencyHz),messageId:u.id,revision:rev,
      state:u.state,text:u.text,
    });
  }

  private get(id:string):SessionState {
    const state=this.sessions.get(id);
    if(!state) throw new Error('Unknown or closed codec session');
    return state;
  }
}

function assertFinite(value:number):number {
  if(!Number.isFinite(value)) throw new Error('Non-finite native decode result');
  return value;
}
function validateSamples(samples:Float32Array,max:number):Float32Array {
  if(!(samples instanceof Float32Array) || !samples.length || samples.length>max
    || samples.some(s=>!Number.isFinite(s))) throw new Error('Invalid 12kHz PCM samples');
  return samples;
}
function validateStreamWave(wave:MfskNativeWaveform,requestedText:string):Float32Array {
  const normal=(s:string)=>s.trim().toUpperCase().replace(/\s+/g,' ');
  if(normal(wave.canonicalText)!==normal(requestedText)) {
    throw new Error('Native stream TX text differs from requested text');
  }
  if(wave.sampleRate!==12000 || !Number.isSafeInteger(wave.sampleCount)
    ||wave.sampleCount<=0 ||wave.sampleCount>12_000*310
    ||!Buffer.isBuffer(wave.pcmF32Le) || wave.pcmF32Le.length!==wave.sampleCount*4) {
    throw new Error('Native stream TX PCM geometry invalid');
  }
  const out=new Float32Array(wave.sampleCount);
  for(let i=0;i<out.length;i++){
    const value=wave.pcmF32Le.readFloatLE(i*4);
    if(!Number.isFinite(value) || Math.abs(value)>1.000001)throw new Error('Invalid native stream TX PCM');
    out[i]=value;
  }
  return out;
}
