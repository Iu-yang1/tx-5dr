import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { DigitalCodecMode } from '@tx5dr/contracts';

/**
 * Experimental native codec loader. It does not silently fall back to
 * wsjtx-lib or declare any mode available to the physical radio runtime.
 * Call it inside a codec worker, never synchronously on an audio/UI thread.
 */
export const MFSK_NATIVE_MODULE_PATH = fileURLToPath(
  new URL('../../../mfsk-native/mfsk-native.node', import.meta.url)
);

export interface MfskNativeRow {
  text: string;
  frequencyHz: number;
  snrDb: number;
  dtSeconds: number;
}

export interface MfskNativeWaveform {
  canonicalText: string;
  sampleRate: number;
  sampleCount: number;
  pcmF32Le: Buffer;
}

export interface MfskNativeModule {
  codecVersion(): string;
  supportedModes(): string[];
  encodeSlotted(mode: string, text: string, audioHz: number): MfskNativeWaveform;
  decodeSlotted(mode: string, pcmF32Le: Buffer): MfskNativeRow[];
  encodeJtty(text: string, audioHz: number): MfskNativeWaveform;
  encodeMsk144Standard(call1: string, call2: string, report: string, periodSeconds: number): MfskNativeWaveform;
  SlottedSession: new (mode: string) => {
    decode(pcmF32Le: Buffer, periodIndex?: number, earlyPrefix?: boolean): MfskNativeRow[];
    setParameters(depth: number, averaging: boolean, rxHz?: number, toleranceHz?: number): void;
    setParallelThreads(threads: number): void;
    setQ65SearchOptions(seconds?: number, score?: number, maxCandidates?: number): void;
    setFrameOptions(apMode: string, strategy: string, syncMin?: number, maxCandidates?: number): void;
    setApContext(myCall: string, myGrid: string, dxCall: string, dxGrid: string, progress: number, enabled: boolean): void;
    setEmeDelay(enabled: boolean): void;
    clear(): void;
  };
  JttySession: new (audioHz: number) => {
    push(pcmF32Le: Buffer): Array<{
      id: string; text: string; state: string; frequencyHz: number;
      startSeconds: number; endSeconds: number; snrDb: number;
    }>;
    finish(): Array<{
      id: string; text: string; state: string; frequencyHz: number;
      startSeconds: number; endSeconds: number; snrDb: number;
    }>;
    reset(): void;
  };
  Msk144Session: new (audioHz: number, toleranceHz: number) => {
    push(pcmF32Le: Buffer): MfskNativeRow[];
    configureShorthand(enabled: boolean, call1: string, call2: string): void;
    configureEqualizer(enabled: boolean, dxCall: string): void;
    equalizerStatus(): {
      enabled: boolean; trained: boolean; trainingFrames: number;
      residualRmsRad: number; coefficients: number[];
    };
    newPeriod(): void;
    reset(): void;
  };
}

export type MfskNativeLoadResult =
  | { ready: true; module: MfskNativeModule; version: string; nativeModes: readonly string[] }
  | { ready: false; reason: string };

const requireNative = createRequire(import.meta.url);

function hasFunction(value: unknown, name: string): boolean {
  return value !== null && typeof value === 'object'
    && typeof (value as Record<string, unknown>)[name] === 'function';
}

export function validateNativeModule(module: unknown): MfskNativeLoadResult {
  for (const method of [
    'codecVersion', 'supportedModes', 'encodeSlotted', 'decodeSlotted',
    'encodeJtty', 'encodeMsk144Standard',
    'SlottedSession', 'JttySession', 'Msk144Session',
  ]) {
    if (!hasFunction(module, method)) {
      return { ready: false, reason: `missing native symbol ${method}` };
    }
  }
  const native = module as MfskNativeModule;
  try {
    const nativeModes = native.supportedModes();
    const required = ['FT8', 'FT4', 'WSPR', 'Q65-60B', 'MSK144', 'JTTY'];
    if (!Array.isArray(nativeModes) || !required.every(mode => nativeModes.includes(mode))) {
      return { ready: false, reason: 'missing required protocol families in native build' };
    }
    const version = native.codecVersion();
    if (!version.startsWith('mfsk-core/0.15.1;')) {
      return { ready: false, reason: `unexpected native codec version ${version}` };
    }
    return { ready: true, module: native, version, nativeModes: [...nativeModes] };
  } catch (error) {
    return { ready: false, reason: `native capability probe failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export function loadMfskNative(path = MFSK_NATIVE_MODULE_PATH): MfskNativeLoadResult {
  try {
    return validateNativeModule(requireNative(path) as unknown);
  } catch (error) {
    return { ready: false, reason: `native module unavailable: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export function verifyNativeWaveform(
  result: MfskNativeWaveform,
  requestedText: string,
  mode: DigitalCodecMode,
): Float32Array {
  if (mode === 'MSK144' || mode === 'JTTY') {
    throw new Error('streaming waveform must use its mode-specific TX validator');
  }
  // Never silently transmit a canonicalized message that differs from the intent.
  const normalize = (s: string) => s.trim().toUpperCase().replace(/\s+/g, ' ');
  if (normalize(result.canonicalText) !== normalize(requestedText)) {
    throw new Error(`native TX text mismatch: expected ${requestedText}, got ${result.canonicalText}`);
  }
  if (result.sampleRate !== 12_000 || !Number.isSafeInteger(result.sampleCount)
    || result.sampleCount <= 0 || result.sampleCount > 12_000 * 310
    || !Buffer.isBuffer(result.pcmF32Le)
    || result.pcmF32Le.byteLength !== result.sampleCount * 4) {
    throw new Error('invalid native PCM size/sample rate');
  }
  const pcm = new Float32Array(result.sampleCount);
  for (let i = 0; i < pcm.length; i++) {
    const sample = result.pcmF32Le.readFloatLE(i * 4);
    if (!Number.isFinite(sample) || Math.abs(sample) > 1.000001) {
      throw new Error(`native PCM contains invalid sample at ${i}`);
    }
    pcm[i] = sample;
  }
  return pcm;
}
