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
import { DigitalRadioEngine } from '../DigitalRadioEngine.js';
import {
  MfskLiveRxStartSchema, MfskLiveRxStatusSchema, MfskLiveRxEventsSchema,
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
    if(typeof obj.version!=='string' || !obj.version.startsWith('mfsk-core/0.15.0;')
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
    preHandler:[requireAbility('manage','all')],
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
  // Admin-only, receive-only; starting it does NOT switch the host's
  // FT8/FT4 transmit scheduler, allocate PTT, or write a logbook QSO.
  fastify.post('/live/start',{preHandler:[requireAbility('manage','all')]},
    async(request,reply)=>{
      const cfg=MfskLiveRxStartSchema.parse(request.body);
      const live=DigitalRadioEngine.getInstance().getMfskLiveRxService();
      return reply.send(MfskLiveRxStatusSchema.parse(live.start(cfg)));
    });
  fastify.post('/live/stop',{preHandler:[requireAbility('manage','all')]},
    async(_request,reply)=>{
      const live=DigitalRadioEngine.getInstance().getMfskLiveRxService();
      return reply.send(MfskLiveRxStatusSchema.parse(live.stop()));
    });
  fastify.get('/live/status',{preHandler:[requireAbility('manage','all')]},
    async(_request,reply)=>{
      const live=DigitalRadioEngine.getInstance().getMfskLiveRxService();
      return reply.send(MfskLiveRxStatusSchema.parse(live.status()));
    });
  fastify.get('/live/events',{preHandler:[requireAbility('manage','all')]},
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

  // Only one CPU-intensive native simulation at a time per server process.
  // Runs in a disposable child; malformed native code cannot crash Fastify.
  let simulationInFlight=false;
  fastify.post('/simulate', {
    preHandler:[requireAbility('manage','all')],
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
