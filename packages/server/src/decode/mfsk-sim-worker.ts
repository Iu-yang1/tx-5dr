/**
 * Disposable, isolated simulation process. No physical radio interfaces,
 * PTT permissions, rigctld, logbook or external uploads are imported.
 */
import {
  MfskCodecSimulationRequestSchema, MfskCodecSimulationResponseSchema,
  type DigitalRxEvent, type MfskCodecSimulationResponse,
} from '@tx5dr/contracts';
import { resolveDigitalSchedule } from '@tx5dr/core';
import { MfskMultimodeRuntime } from './MfskMultimodeRuntime.js';

const SAMPLE_RATE = 12_000;

function seededNoise(amplitude: number): () => number {
  let seed = 0x37ac21d5;
  const uniform = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return ((seed >>> 0) + 0.5) / 4294967296;
  };
  return () => {
    if (amplitude === 0) return 0;
    return amplitude * Math.sqrt(-2 * Math.log(Math.max(uniform(), 1e-9)))
      * Math.cos(2 * Math.PI * uniform());
  };
}

async function main(): Promise<void> {
  if (!process.argv[2]) throw new Error('Missing simulation parameters');
  const request = MfskCodecSimulationRequestSchema.parse(JSON.parse(process.argv[2]));
  const mode = request.mode;
  const def = resolveDigitalSchedule(mode, request.q65Submode);
  const runtime = new MfskMultimodeRuntime();
  const sessionId = 'simulation';
  const cfg = {
    mode,
    ...(mode === 'Q65' ? { q65Submode: request.q65Submode ?? 'Q65-60B' as const } : {}),
    audioFrequencyHz: request.audioFrequencyHz,
  };
  const encodeStart = performance.now();
  const encoded = runtime.encodeVirtual(cfg, request.text, 5);
  const encodeMs = performance.now() - encodeStart;

  const startOffset = mode === 'WSPR' ? 2 : def.scheduling === 'utc-slot' ? 0.5 : mode === 'JTTY' ? 0.2 : 0;
  const durationSeconds = def.slotMs === null
    ? Math.ceil(encoded.pcm.length / SAMPLE_RATE + startOffset + 1)
    : def.slotMs / 1000;
  const count = Math.round(durationSeconds * SAMPLE_RATE);
  if (!Number.isSafeInteger(count) || count <= 0 || count > 12_000 * 301) {
    throw new Error('Invalid simulated channel duration');
  }
  const channel = new Float32Array(count);
  const noise = seededNoise(request.noiseAmplitude);
  const start = Math.round(startOffset * SAMPLE_RATE);
  for (let i = 0; i < channel.length; i++) {
    const signal = i >= start && i - start < encoded.pcm.length
      ? encoded.pcm[i - start] * 0.35
      : 0;
    channel[i] = signal + noise();
  }

  runtime.begin({
    sessionId, ...cfg,
    depth:3, ...(mode === 'Q65' ? { averaging:false, emeDelay:false } : {}),
  });
  const decodeStart = performance.now();
  const received: DigitalRxEvent[] = [];
  if (def.scheduling === 'utc-slot') {
    const slotMs = def.slotMs!;
    const slotStartMs = Math.floor(Date.now()/slotMs)*slotMs;
    received.push(...runtime.decodeSlot(sessionId,0,{
      slotStartMs, timestampMs:slotStartMs + slotMs,
      samples:channel,final:true,
    }));
  } else {
    // Streaming must enter in contiguous 12 kHz chunks, exactly as from an
    // actual AF capture ring-buffer, but without any audio device.
    for(let offset=0;offset<channel.length;offset+=SAMPLE_RATE) {
      const end=Math.min(offset+SAMPLE_RATE,channel.length);
      received.push(...runtime.pushStream(
        sessionId,0,offset,Date.now() + Math.round(offset/12),
        channel.subarray(offset,end),
      ));
    }
    if(mode === 'JTTY') received.push(...runtime.finishJtty(sessionId,Date.now()));
  }
  const decodeMs = performance.now() - decodeStart;
  runtime.stop(sessionId);

  const receivedTexts = Array.from(new Set(received.map(x=>x.text.trim()).filter(Boolean))).slice(0,64);
  const normalize = (s:string) => s.trim().toUpperCase().replace(/\s+/g,' ');
  const expected = normalize(encoded.canonicalText);
  const messageRecovered = receivedTexts.some(x=>normalize(x)===expected);
  const result: MfskCodecSimulationResponse = MfskCodecSimulationResponseSchema.parse({
    mode,submode:def.submode,canonicalText:encoded.canonicalText,
    receivedTexts,messageRecovered,samples:count,sampleRate:SAMPLE_RATE,
    encodeMs,decodeMs,physicalTxEnabled:false,simulationOnly:true,
  });
  process.stdout.write(JSON.stringify(result));
}

void main().catch((error:unknown)=>{
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exitCode=1;
});
