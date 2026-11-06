import { assertNativeLiveModeAdmission } from './mfsk-live-admission.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { FastifyInstance } from 'fastify';
import {
  DigitalCodecRuntimeCapabilitySchema,
  MfskCodecProbeResponseSchema,
  MfskCodecSimulationRequestSchema,
  MfskCodecSimulationResponseSchema,
  MfskPhysicalTxRequestSchema,
  MfskManualQsoSchema,
  WsprSpotsResponseSchema,
  Q65SubmodeSchema,
  MfskLiveRxStartSchema,
  MfskLiveRxStatusSchema,
  MfskLiveRxEventsSchema,
  MfskLiveRxApContextUpdateSchema,
  type DigitalCodecMode,
  type MfskCodecProbeResponse,
} from '@tx5dr/contracts';
import { requireAbility, requireOperatorAbility } from '../auth/authPlugin.js';
import { MFSK_NATIVE_MODULE_PATH } from '../decode/MfskNativeAdapter.js';
import { fileURLToPath } from 'node:url';
import { isMfskPhysicalTxConfirmed } from '../decode/MfskNativeTxService.js';
import { DigitalRadioEngine } from '../DigitalRadioEngine.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const NativeAutomaticTxStartSchema = z.object({
  mode: z.enum(['Q65', 'MSK144', 'WSPR']),
  operatorId: z.string().trim().min(1).max(128),
  text: z.string().trim().max(64).optional(),
  audioHz: z.number().finite().min(100).max(5500),
  q65Submode: Q65SubmodeSchema.optional(),
  q65TxFirst: z.boolean().optional(),
  mskPeriodSeconds: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(30)]).optional(),
  mskTxFirst: z.boolean().optional(),
}).superRefine((value, ctx) => {
  if (value.mode === 'WSPR' && !value.text?.trim()) {
    ctx.addIssue({code:z.ZodIssueCode.custom,path:['text'],
      message:'WSPR requires a configured callsign, grid and power'});
  }
  if (value.mode !== 'Q65' && (value.q65Submode || value.q65TxFirst !== undefined)) {
    ctx.addIssue({code:z.ZodIssueCode.custom,path:['q65Submode'],message:'Q65-only settings'});
  }
  if (value.mode !== 'MSK144' && (value.mskPeriodSeconds || value.mskTxFirst !== undefined)) {
    ctx.addIssue({code:z.ZodIssueCode.custom,path:['mskPeriodSeconds'],message:'MSK144-only settings'});
  }
});

const execAsync = promisify(execFile);
const MODES: DigitalCodecMode[] = ['FT8','FT4','Q65','WSPR','MSK144','JTTY'];
const PROBE_CODE = [
  "const codec = require(process.argv[1]);",
  "process.stdout.write(JSON.stringify({ version:codec.codecVersion(), modes:codec.supportedModes() }));",
].join('\n');

export function buildCodecProbeResponse(
  probe?: { version: string; modes: readonly string[] },
  error?: string,
): MfskCodecProbeResponse {
  const list = probe?.modes ?? [];
  const capabilities = MODES.map(mode => {
    const available = mode === 'Q65'
      ? list.includes('Q65-60B')
      : list.includes(mode);
    return DigitalCodecRuntimeCapabilitySchema.parse({
      mode,backend:available?'mfsk-native':'unavailable',
      receiverReady:available,encoderReady:available,schedulerReady:available,
      txPipelineReady:false,
      submodes:mode === 'Q65' ?
        list.filter(s => s.startsWith('Q65-')) : [],
    });
  });
  return MfskCodecProbeResponseSchema.parse({
    experimental:true,physicalTxEnabled:false,
    version:probe?.version??null,capabilities,
    ...(error?{error}:{}),
  });
}

let cached: MfskCodecProbeResponse | undefined;
let cachedAt = 0;
let pending: Promise<MfskCodecProbeResponse> | undefined;

async function probeNative(): Promise<MfskCodecProbeResponse> {
  try{
    // Probe in a disposable process so a faulty Node-API module cannot
    // crash the web API or inherit any physical PTT control.
    const { stdout } = await execAsync(process.execPath,[
      '-e', PROBE_CODE, MFSK_NATIVE_MODULE_PATH,
    ],{timeout:8_000,maxBuffer:16*1024,windowsHide:true});
    const obj=JSON.parse(stdout) as {version?:unknown;modes?:unknown};
    if(typeof obj.version!=='string' || !obj.version.startsWith('mfsk-core/0.15.1;')
      || !Array.isArray(obj.modes)
      || obj.modes.some(x=>typeof x!=='string')) {
      return buildCodecProbeResponse(undefined,'native ABI/version mismatch');
    }
    return buildCodecProbeResponse({version:obj.version,modes:obj.modes as string[]});
  }catch {
    return buildCodecProbeResponse(undefined,'native runtime unavailable');
  }
}

export async function mfskCapabilityRoutes(fastify:FastifyInstance):Promise<void> {
  fastify.get('/capabilities',{
    preHandler:[requireAbility('read','all')],
  },async (_request,reply)=>{
    const now=Date.now();
    if(!cached || now-cachedAt>30_000){
      pending ??= probeNative().finally(()=>{pending=undefined;});
      cached=await pending;
      cachedAt=Date.now();
    }
    return reply.send(cached);
  });


  // This receiver is attached to the existing post-demodulated AF audioData
  // stream, but runs the native DSP exclusively in a dedicated child process.
  // Mode-switch-authorized live receiver; starting it does NOT switch the host's
  // FT8/FT4 transmit scheduler, allocate PTT, or write a logbook QSO.
  fastify.post('/live/start',{preHandler:[requireAbility('execute','ModeSwitch')]},
    async(request,reply)=>{
      const cfg=MfskLiveRxStartSchema.parse(request.body);
      const engine=DigitalRadioEngine.getInstance();
      try {
        assertNativeLiveModeAdmission(cfg.mode,engine.getCurrentMode().name,
          engine.getStatus().isRunning);
      } catch(error) {
        return reply.code(409).send({success:false,
          error:error instanceof Error?error.message:'Receiver mode admission rejected'});
      }
      return reply.send(MfskLiveRxStatusSchema.parse(engine.getMfskLiveRxService().start(cfg)));
    });
  fastify.post('/live/ap-context',{preHandler:[requireAbility('execute','ModeSwitch')]},
    async(request,reply)=>{
      const payload=MfskLiveRxApContextUpdateSchema.parse(request.body);
      const live=DigitalRadioEngine.getInstance().getMfskLiveRxService();
      return reply.send(MfskLiveRxStatusSchema.parse(
        await live.updateApContext(payload.apContext??undefined)));
    });
  fastify.post('/live/stop',{preHandler:[requireAbility('execute','ModeSwitch')]},
    async(_request,reply)=>{
      const live=DigitalRadioEngine.getInstance().getMfskLiveRxService();
      return reply.send(MfskLiveRxStatusSchema.parse(await live.flushAndStop()));
    });
  fastify.get('/live/status',{preHandler:[requireAbility('read','all')]},
    async(_request,reply)=>{
      const live=DigitalRadioEngine.getInstance().getMfskLiveRxService();
      return reply.send(MfskLiveRxStatusSchema.parse(live.status()));
    });
  fastify.get('/live/events',{preHandler:[requireAbility('read','all')]},
    async(request,reply)=>{
      const query=request.query as {afterMs?:string};
      const afterMs=Number(query.afterMs??0);
      if(!Number.isFinite(afterMs)||afterMs<0){
        return reply.code(400).send({error:'invalid afterMs'});
      }
      const live=DigitalRadioEngine.getInstance().getMfskLiveRxService();
      return reply.send(MfskLiveRxEventsSchema.parse({
        events:live.recent(afterMs),status:live.status(),
      }));
    });

  fastify.get('/live/wspr-spots',{preHandler:[requireAbility('read','all')]},
    async(_request,reply)=>{
      const live=DigitalRadioEngine.getInstance().getMfskLiveRxService();
      return reply.send(WsprSpotsResponseSchema.parse({
        spots:live.wsprSpots(),localOnly:true,rfDialCalibrated:false,
      }));
    });

  fastify.get('/tx/auto/status',{preHandler:[requireAbility('read','all')]},
    async (_request,reply)=>reply.send(
      DigitalRadioEngine.getInstance().getNativeAutoTxScheduler().status(),
    ));

  fastify.post('/tx/auto/start',{
    preHandler:[
      requireAbility('execute','RadioControl'),
      requireOperatorAbility(req=>(req.body as {operatorId?:string})?.operatorId??''),
    ],
  },async(request,reply)=>{
    const config=NativeAutomaticTxStartSchema.parse(request.body);
    const controller=DigitalRadioEngine.getInstance().getNativeAutoTxScheduler();
    try{
      return reply.send(controller.enable({
        mode:config.mode,operatorId:config.operatorId,
        audioHz:config.audioHz,
        ...(config.mode==='WSPR'?{beaconText:config.text}:{}),
        ...(config.mode==='Q65'?{
          q65Submode:config.q65Submode,q65TxFirst:config.q65TxFirst,
        }:{}),
        ...(config.mode==='MSK144'?{
          mskPeriodSeconds:config.mskPeriodSeconds,mskTxFirst:config.mskTxFirst,
        }:{}),
      }));
    }catch(error){
      return reply.code(409).send({success:false,
        error:error instanceof Error?error.message:String(error)});
    }
  });

  fastify.post('/tx/auto/stop',{
    preHandler:[
      requireAbility('execute','RadioControl'),
      requireOperatorAbility(req=>(req.body as {operatorId?:string})?.operatorId??''),
    ],
  },async(request,reply)=>{
    const { operatorId }=z.object({operatorId:z.string().min(1).max(128)}).parse(request.body);
    const engine=DigitalRadioEngine.getInstance();
    const scheduler=engine.getNativeAutoTxScheduler();
    const owner=scheduler.status().operatorId;
    if(owner && owner!==operatorId){
      return reply.code(409).send({success:false,error:'Native automatic TX belongs to a different operator'});
    }
    if(owner===operatorId)await engine.disarmMfskNativeRfTx();
    return reply.send(scheduler.status());
  });

  // Dedicated, user-triggered TX. Existing audio/PTT coordinator owns the
  // normal key-on, waveform playback, and key-off sequence.
  fastify.get('/tx/status',{preHandler:[requireAbility('read','all')]},
    async(request,reply)=>{
      const operatorId=(request.query as {operatorId?:string})?.operatorId??'';
      const engine=DigitalRadioEngine.getInstance();
      const ownsOperator=Boolean(operatorId && request.authUser &&
        (request.ability.can('manage','all') ||
         request.authUser.role==='admin' ||
         request.authUser.operatorIds.includes(operatorId)));
      const status={rfEnabled:ownsOperator,remainingMs:0};
      return reply.send({...status,busy:engine.getMfskNativeTxService().isBusy()});
    });
  // Compatibility endpoints for older clients. Transmit no longer requires
  // a pre-arm acknowledgement or expiring RF authorization.
  fastify.post('/tx/arm',{
    preHandler:[
      requireAbility('execute','RadioControl'),
      requireOperatorAbility(req=>(req.body as {operatorId?:string})?.operatorId??''),
    ],
  },async(_request,reply)=>reply.send({success:true,rfEnabled:true,remainingMs:0}));
  fastify.post('/tx/disarm',{preHandler:[
    requireAbility('execute','RadioControl'),
    async(request,reply)=>{
      // The legacy STOP endpoint is still used by manual TX. During an
      // automatic session, only its owning operator may terminate the lease.
      const owner=DigitalRadioEngine.getInstance().getNativeAutoTxScheduler().status().operatorId;
      if(owner)await requireOperatorAbility(()=>owner)(request,reply);
    },
  ]},async(_request,reply)=>{
    await DigitalRadioEngine.getInstance().disarmMfskNativeRfTx();
    return reply.send({success:true,rfEnabled:false,remainingMs:0});
  });
  fastify.post('/tx/send',{
    preHandler:[
      requireAbility('execute','RadioControl'),
      requireOperatorAbility(req=>(req.body as {operatorId?:string})?.operatorId??''),
    ],
  },async(request,reply)=>{
    const payload=MfskPhysicalTxRequestSchema.parse(request.body);
    const engine=DigitalRadioEngine.getInstance();
    // Manual RF requests must not race an operator-owned automatic UTC slot.
    if(engine.getNativeAutoTxScheduler().status().enabled){
      return reply.code(409).send({
        success:false,error:'Disable native automatic TX before sending manually',
      });
    }
    const service=engine.getMfskNativeTxService();
    const result=await service.send(payload);
    if(!isMfskPhysicalTxConfirmed(result)){
      // A denied/rolled-back PTT lease is NOT a completed transmission.
      // Return a non-2xx response so every client reports failure rather
      // than treating the finished HTTP request as successful RF TX.
      return reply.code(409).send({
        success:false,error:'Native RF transmission was not physically confirmed',
        leaseId:result.result.leaseId,
      });
    }
    return reply.send(result);
  });

  // Never interpret a successful decode as a completed contact. Only
  // a user-confirmed manual QSO is written to the existing logbook service.
  fastify.post('/qso/confirm',{
    preHandler:[requireOperatorAbility(req=>(req.body as {operatorId?:string})?.operatorId??'')],
  },async(request,reply)=>{
    const item=MfskManualQsoSchema.parse(request.body);
    const engine=DigitalRadioEngine.getInstance();
    const op=engine.operatorManager.getOperatorById(item.operatorId);
    if(!op)return reply.code(404).send({success:false,error:'Unknown operator'});
    if(engine.getCurrentMode().name!==item.mode){
      return reply.code(409).send({success:false,error:'The recorded protocol must match the current active mode'});
    }
    const record=await engine.operatorManager.submitQsoCompletion({
      operatorId:item.operatorId,
      persistencePolicy:'preserve-distinct',
      qsoRecord:{
        id:randomUUID(),
        callsign:item.callsign,
        ...(item.grid?{grid:item.grid}:{}),
        frequency:item.frequencyHz,
        mode:item.mode,
        startTime:item.startTime,endTime:item.endTime,
        ...(item.reportSent?{reportSent:item.reportSent}:{}),
        ...(item.reportReceived?{reportReceived:item.reportReceived}:{}),
        messageHistory:item.messageHistory,
        myCallsign:op.config.myCallsign,
        ...(op.config.myGrid?{myGrid:op.config.myGrid}:{}),
        ...(item.q65Submode?{notes:`Q65 submode: ${item.q65Submode}`}:{}),
        ...(item.mode==='JTTY'?{notes:'Experimental JTTY continuous mode; ADIF compatibility projection applies'}:{}),
        lotwQslSent:'N',lotwQslReceived:'N',
        qrzQslSent:'N',qrzQslReceived:'N',
      },
    });
    return reply.send({success:true,id:record.id});
  });

  // Only one CPU-intensive native simulation at a time per server process.
  // Runs in a disposable child; malformed native code cannot crash Fastify.
  let simulationInFlight=false;
  // Offline DSP simulation is CPU-intensive (up to a 300 s Q65 period).
  // View-only accounts can inspect status but cannot launch decode jobs.
  fastify.post('/simulate', {
    preHandler:[requireAbility('execute','ModeSwitch')],
  },async (request,reply)=>{
    const payload = MfskCodecSimulationRequestSchema.parse(request.body);
    if(simulationInFlight){
      return reply.code(429).send({success:false,error:'Codec simulation is already running'});
    }
    simulationInFlight=true;
    try {
      const script=fileURLToPath(new URL('../decode/mfsk-sim-worker.js',import.meta.url));
      const { stdout }=await execAsync(process.execPath,[
        script,JSON.stringify(payload),
      ],{timeout:120_000,maxBuffer:64*1024,windowsHide:true});
      const response=MfskCodecSimulationResponseSchema.parse(JSON.parse(stdout));
      return reply.send(response);
    }catch(error){
      const detail=error instanceof Error?error.message:String(error);
      fastify.log.warn({detail},'Isolated native simulation failed');
      return reply.code(422).send({
        success:false,error:'Native offline simulation failed; inspect server diagnostics',
      });
    }finally{
      simulationInFlight=false;
    }
  });
}
