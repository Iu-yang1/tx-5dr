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
}
