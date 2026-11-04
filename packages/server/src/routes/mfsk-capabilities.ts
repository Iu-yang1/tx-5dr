import { assertNativeLiveModeAdmission } from './mfsk-live-admission.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { FastifyInstance } from 'fastify';
import {
  DIGITAL_CODEC_PROFILES,
  DigitalCodecRuntimeCapabilitySchema,
  MfskCodecProbeResponseSchema,
  type DigitalCodecMode,
  type MfskCodecProbeResponse,
} from '@tx5dr/contracts';
import { requireAbility } from '../auth/authPlugin.js';
import { MFSK_NATIVE_MODULE_PATH } from '../decode/MfskNativeAdapter.js';
import { MfskCodecSimulationRequestSchema, MfskCodecSimulationResponseSchema } from '@tx5dr/contracts';
import { fileURLToPath } from 'node:url';
import { isMfskPhysicalTxConfirmed } from '../decode/MfskNativeTxService.js';
import { DigitalRadioEngine } from '../DigitalRadioEngine.js';
import { requireOperatorAbility } from '../auth/authPlugin.js';
import { MfskPhysicalTxRequestSchema, MfskManualQsoSchema, WsprSpotsResponseSchema } from '@tx5dr/contracts';
import { randomUUID } from 'node:crypto';
import {
  MfskLiveRxStartSchema, MfskLiveRxStatusSchema, MfskLiveRxEventsSchema,
  MfskLiveRxApContextUpdateSchema,
} from '@tx5dr/contracts';

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

  // Dedicated authenticated TX path. The host's physical lease owns PTT;
  // Rust encoding runs in a separate child. Explicit, short-lived arm only.
  fastify.get('/tx/status',{preHandler:[requireAbility('read','all')]},
    async(request,reply)=>{
      const operatorId=(request.query as {operatorId?:string})?.operatorId??'';
      const engine=DigitalRadioEngine.getInstance();
      const ownsOperator=Boolean(operatorId && request.authUser &&
        (request.ability.can('manage','all') ||
         request.authUser.role==='admin' ||
         request.authUser.operatorIds.includes(operatorId)));
      const status=ownsOperator
        ?engine.getMfskRfArmGate().status(operatorId,request.authUser!.tokenId)
        :{rfEnabled:false,remainingMs:0};
      return reply.send({...status,busy:engine.getMfskNativeTxService().isBusy()});
    });
  fastify.post('/tx/arm',{
    preHandler:[
      requireAbility('execute','RadioControl'),
      requireOperatorAbility(req=>(req.body as {operatorId?:string})?.operatorId??''),
    ],
  },async(request,reply)=>{
      const payload=request.body as {acknowledged?:unknown;operatorId?:unknown}|null;
      if(payload?.acknowledged!==true || typeof payload?.operatorId!=='string'){
        return reply.code(400).send({success:false,error:'Explicit RF safety acknowledgement and operator required'});
      }
      const engine=DigitalRadioEngine.getInstance();
      try{
        return reply.send({success:true,...engine.armMfskNativeRfTx(
          true,payload.operatorId,request.authUser!.tokenId,
        )});
      }catch(e){
        return reply.code(409).send({
          success:false,error:e instanceof Error?e.message:'RF arm admission rejected',
        });
      }
    });
  fastify.post('/tx/disarm',{preHandler:[requireAbility('execute','RadioControl')]},
    async(_request,reply)=>{
      const engine=DigitalRadioEngine.getInstance();
      await engine.disarmMfskNativeRfTx();
      return reply.send({success:true,...engine.getMfskRfArmGate().status()});
    });
  fastify.post('/tx/send',{
    preHandler:[
      requireAbility('execute','RadioControl'),
      requireOperatorAbility(req=>(req.body as {operatorId?:string})?.operatorId??''),
    ],
  },async(request,reply)=>{
    const payload=MfskPhysicalTxRequestSchema.parse(request.body);
    const engine=DigitalRadioEngine.getInstance();
    const service=engine.getMfskNativeTxService();
    const auth=engine.getMfskRfArmGate().status(payload.operatorId,request.authUser!.tokenId);
    if(!auth.rfEnabled || !service.isRfEnabled(payload.operatorId)){
      return reply.code(423).send({
        success:false,error:'Native RF requires explicit time-limited authorization',
      });
    }
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
