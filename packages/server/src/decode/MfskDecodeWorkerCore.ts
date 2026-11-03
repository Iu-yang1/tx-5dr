import type { DecodeRequest, DecodeResult } from '@tx5dr/core';
import { resampleAudioProfessional } from '../utils/audioUtils.js';
import { loadMfskNative, type MfskNativeModule, type MfskNativeRow } from './MfskNativeAdapter.js';

export interface MfskNativeSlotHandle {
  decode(pcmF32Le: Buffer, periodIndex?: number, earlyPrefix?: boolean): MfskNativeRow[];
  setParameters(depth: number, averaging: boolean, rxHz?: number, toleranceHz?: number): void;
  setApContext(myCall: string, myGrid: string, dxCall: string, dxGrid: string, progress: number, enabled: boolean): void;
  clear(): void;
}

interface SlotSession {
  id: string;
  mode: 'FT8' | 'FT4';
  depth: number;
  handle: MfskNativeSlotHandle;
  seen: Set<string>;
}

/**
 * Experimental, opt-in FT8/FT4 decode backend running INSIDE the existing
 * isolated process pool. It never falls back silently to a different codec.
 *
 * DecodeRequest / DecodeResult are unchanged to avoid bypassing the host's
 * existing session cancellation and TX-decision deadline logic.
 */
export class MfskDecodeWorkerCore {
  private readonly native: MfskNativeModule;
  private session: SlotSession | null = null;
  private decoding = false;

  constructor(nativeModule?: MfskNativeModule) {
    if (nativeModule) {
      this.native = nativeModule;
    } else {
      const load = loadMfskNative();
      if (!load.ready) throw new Error(load.reason);
      this.native = load.module;
    }
  }

  async decode(request: DecodeRequest): Promise<DecodeResult> {
    if (this.decoding) throw new Error('Concurrent native decode is prohibited');
    this.decoding = true;
    try {
      return await this.decodeInternal(request);
    } finally {
      this.decoding = false;
    }
  }

  endSession(id: string): void {
    if (this.decoding) throw new Error('Cannot end session during native decode');
    if (this.session?.id === id) this.session = null;
  }

  private async decodeInternal(request: DecodeRequest): Promise<DecodeResult> {
    const started = performance.now();
    const mode = request.mode;
    if (mode !== 'FT8' && mode !== 'FT4') {
      throw new Error(`Unsupported legacy IPC mode: ${String(mode)}`);
    }
    const depth = request.decodeDepth ?? 3;
    if (![1, 2, 3].includes(depth)) throw new Error('Invalid decode depth');

    // A session maps exactly to one UTC period, not to a mode globally.
    const id = request.decodeSessionId || request.slotId;
    if (!this.session || this.session.id !== id) {
      const create = this.native.SlottedSession as unknown as
        new (name: string) => MfskNativeSlotHandle;
      this.session = { id, mode, depth, handle: new create(mode), seen: new Set() };
    }
    const session = this.session;
    if (session.mode !== mode || session.depth !== depth) {
      throw new Error('Decode mode/depth changed inside a native session');
    }

    const baseFrequency = request.apContext?.frequencyHz;
    const rxHz = baseFrequency !== undefined && Number.isFinite(baseFrequency)
      && baseFrequency >= 100 && baseFrequency <= 5500 ? baseFrequency : undefined;
    session.handle.setParameters(depth, false, rxHz);
    const ap = request.apContext;
    const progress = ap?.qsoProgress ?? 0;
    if (!Number.isInteger(progress) || progress < 0 || progress > 5) {
      throw new Error('Invalid QSO progress');
    }
    session.handle.setApContext(
      ap?.myCall ?? '', ap?.myGrid ?? '',
      ap?.dxCall ?? '', ap?.dxGrid ?? '', progress,
      Boolean(ap?.myCall && ap.dxCall),
    );

    if (!(request.pcm instanceof ArrayBuffer) || request.pcm.byteLength % 4 !== 0) {
      throw new Error('Decode PCM is not a valid Float32 ArrayBuffer');
    }
    const input = new Float32Array(request.pcm);
    const rate = request.sampleRate;
    if (!Number.isFinite(rate) || rate < 8000 || rate > 192000) {
      throw new Error('Invalid source sample rate');
    }
    if (input.length === 0 || input.length > 192000 * 16) {
      throw new Error('Invalid decode input duration');
    }
    const normalized = rate === 12000 ? input :
      await resampleAudioProfessional(input, rate, 12000, 1);
    if (normalized.length > 12000 * 16 || normalized.some(x => !Number.isFinite(x))) {
      throw new Error('Resampled PCM was invalid');
    }

    const pcm = Buffer.from(normalized.buffer, normalized.byteOffset, normalized.byteLength);
    // Explicit millisecond period identity protects FT4's 7.5 s half-slot.
    let slotStartMs = request.slotStartMs;
    if (slotStartMs === undefined) {
      const suffix = /-(\d{11,16})$/.exec(request.slotId);
      if (suffix) slotStartMs = Number(suffix[1]);
    }
    const periodMs = mode === 'FT8' ? 15000 : 7500;
    if (!Number.isSafeInteger(slotStartMs) || (slotStartMs as number) % periodMs !== 0) {
      throw new Error('Native decode requires exact millisecond UTC slot start');
    }
    const period = (slotStartMs as number) / periodMs;
    if (period < 0 || period > 2147483647) throw new Error('Native period index outside signed 32-bit range');

    const tNative = performance.now();
    // The native FT8 front end recognises its own prefix checkpoints.
    // FT4 has no corresponding prefix API: a complete window is decoded whole.
    const earlyPrefix = mode === 'FT8' && request.decodeStage !== undefined
      && request.decodeStage !== 50
      && !request.decodeFinalWindow && !request.lateRetry;
    const decoded = session.handle.decode(pcm, period, earlyPrefix);
    const nativeProcessingTimeMs = performance.now() - tNative;
    const frames: DecodeResult['frames'] = [];
    for (const row of decoded) {
      if (typeof row.text !== 'string' || !row.text.trim()
        || !Number.isFinite(row.frequencyHz) || !Number.isFinite(row.snrDb)
        || !Number.isFinite(row.dtSeconds)) {
        throw new Error('Native decoder returned invalid row');
      }
      // Suppress duplicate candidate deliveries between staged invocations.
      // Keep distinct stations/times on the same audio frequency separate.
      const key = `${row.text.trim()}|${Math.round(row.frequencyHz * 2)}|${Math.round(row.dtSeconds * 100)}`;
      if (session.seen.has(key)) continue;
      session.seen.add(key);
      frames.push({
        message: row.text,
        snr: row.snrDb,
        dt: row.dtSeconds,
        freq: row.frequencyHz,
        confidence: 1,
      });
    }
    const result: DecodeResult = {
      slotId: request.slotId,
      windowIdx: request.windowIdx,
      frames,
      timestamp: request.timestamp,
      processingTimeMs: performance.now() - started,
      nativeProcessingTimeMs,
      decodeDepth: depth,
      windowOffsetMs: request.windowOffsetMs ?? 0,
      ...(request.decodeStage !== undefined ? { decodeStage: request.decodeStage } : {}),
      ...(request.decisionDeadlineMs !== undefined ?
        { late: Date.now() > request.decisionDeadlineMs } : {}),
    };
    if (request.decodeFinalWindow) this.session = null;
    return result;
  }
}
