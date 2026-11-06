import { Q65_PERIOD_MS, type DigitalCodecMode, type Q65Submode } from '@tx5dr/contracts';
import type { MfskTxRequest, MfskTxOutcome } from './MfskNativeTxService.js';
import { isMfskPhysicalTxConfirmed } from './MfskNativeTxService.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('NativeAutoTxScheduler');
type AutoMode = 'Q65' | 'MSK144' | 'WSPR';

export interface NativeAutoTxConfiguration {
  mode: AutoMode;
  operatorId: string;
  /** A WSPR beacon must supply a user-entered CALL GRID POWER message. */
  beaconText?: string;
  audioHz: number;
  q65Submode?: Q65Submode;
  q65TxFirst?: boolean;
  mskPeriodSeconds?: 5 | 10 | 15 | 30;
  mskTxFirst?: boolean;
}

export interface NativeAutoTxStatus {
  enabled: boolean;
  running: boolean;
  mode: AutoMode | null;
  operatorId: string | null;
  pending: boolean;
  lastScheduledStartMs: number | null;
  lastPhysicalTxConfirmed: boolean | null;
  lastError: string | null;
}

export interface NativeAutoTxOperator {
  id: string;
  isTransmitting: boolean;
  callsign: string;
  grid: string;
}

export interface NativeAutoTxDependencies {
  now(): number;
  mode(): string;
  receiver(): { ready: boolean; mode?: DigitalCodecMode; generation: number; q65Submode?: Q65Submode };
  operator(id: string): NativeAutoTxOperator | undefined;
  transmissions(id: string): readonly { text: string; audioFrequencyHz: number }[];
  nativeBusy(): boolean;
  physicalPhase(): string;
  send(request: MfskTxRequest): Promise<MfskTxOutcome>;
  cancelNativeTx(): void;
}

/** Mirrors the native encoder's future-UTC-slot selection exactly. */
export function nextNativeAutoSlot(nowMs: number, periodMs: number, txFirst?: boolean): number {
  if (!Number.isFinite(nowMs) || !Number.isSafeInteger(periodMs) || periodMs <= 0) {
    throw new RangeError('Invalid native UTC slot period or time');
  }
  let start = (Math.floor((nowMs + 1000) / periodMs) + 1) * periodMs;
  if (txFirst !== undefined && Math.floor(start / periodMs) % 2 !== (txFirst ? 0 : 1)) {
    start += periodMs;
  }
  return start;
}

/**
 * Explicitly enabled native TX repetition. No radio/audio/PTT operations occur
 * unless the authenticated native operator panel enabled this controller AND
 * the same operator's TX switch is currently armed. One operator, one waveform.
 *
 * Q65/MSK144 text always comes from the active QSO strategy and is refreshed
 * before each UTC slot. WSPR uses a user-entered beacon identity/power message
 * and never contributes to the QSO completion or logbook pipeline.
 */
export class NativeAutoTxScheduler {
  private running = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private config: NativeAutoTxConfiguration | null = null;
  private configuredGeneration: number | null = null;
  private pending: { operatorId: string; text: string; key: string } | null = null;
  private lastAttemptKey: string | null = null;
  private lastScheduledStartMs: number | null = null;
  private lastPhysicalTxConfirmed: boolean | null = null;
  private lastError: string | null = null;

  constructor(private readonly deps: NativeAutoTxDependencies) {}

  start(intervalMs = 500): void {
    if (this.running) return;
    this.running = true;
    if (intervalMs > 0) {
      this.timer = setInterval(() => { void this.poll(); }, intervalMs);
      this.timer.unref?.();
    }
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.disable();
  }

  disable(): void {
    this.config = null;
    this.configuredGeneration = null;
    this.lastAttemptKey = null;
    this.cancelPending();
  }

  enable(config: NativeAutoTxConfiguration): NativeAutoTxStatus {
    if (!this.running) throw new Error('Native automatic TX scheduler is not running');
    if (!['Q65', 'MSK144', 'WSPR'].includes(config.mode) || this.deps.mode() !== config.mode) {
      throw new Error('Automatic transmitter mode does not match the active native radio mode');
    }
    const rx = this.deps.receiver();
    if (!rx.ready || rx.mode !== config.mode) throw new Error('Native receive path is not ready');
    if (config.mode === 'Q65' && (rx.q65Submode ?? 'Q65-60B') !== (config.q65Submode ?? 'Q65-60B')) {
      throw new Error('Q65 TX submode differs from the active receiver');
    }
    const op = this.deps.operator(config.operatorId);
    if (!op) throw new Error('Unknown operator');
    if (!Number.isFinite(config.audioHz) || config.audioHz < 100 || config.audioHz > 5500) {
      throw new Error('Invalid native transmit audio frequency');
    }
    if (config.mode === 'MSK144' && config.audioHz !== 1500) {
      throw new Error('MSK144 requires 1500 Hz TX audio centre');
    }
    if (config.mode === 'WSPR') {
      const parts = (config.beaconText ?? '').trim().toUpperCase().split(/\s+/);
      const validGrid = /^[A-R]{2}[0-9]{2}$/.test(parts[1] ?? '');
      const power = Number(parts[2]);
      if (parts.length !== 3 || !validGrid || parts[0] !== op.callsign.toUpperCase()
        || parts[1] !== op.grid.toUpperCase().slice(0, 4)
        || !Number.isInteger(power) || power < 0 || power > 60) {
        throw new Error('WSPR beacon requires the operator callsign, four-character grid and explicit 0-60 dBm power');
      }
    }
    this.cancelPending();
    this.config = { ...config };
    this.configuredGeneration = rx.generation;
    this.lastAttemptKey = null;
    this.lastError = null;
    this.lastPhysicalTxConfirmed = null;
    void this.poll();
    return this.status();
  }

  status(): NativeAutoTxStatus {
    return {
      enabled: this.config !== null,
      running: this.running,
      mode: this.config?.mode ?? null,
      operatorId: this.config?.operatorId ?? null,
      pending: this.pending !== null,
      lastScheduledStartMs: this.lastScheduledStartMs,
      lastPhysicalTxConfirmed: this.lastPhysicalTxConfirmed,
      lastError: this.lastError,
    };
  }

  private cancelPending(): void {
    if (this.pending && this.deps.physicalPhase() === 'idle') {
      this.deps.cancelNativeTx();
    }
  }

  /** Also called by the operator-status listener on switch-off. */
  onOperatorStateChanged(operatorId: string): void {
    if (this.config?.operatorId !== operatorId) return;
    if (!this.deps.operator(operatorId)?.isTransmitting) this.cancelPending();
  }

  async poll(): Promise<void> {
    const cfg = this.config;
    if (!this.running || !cfg) return;
    const rx = this.deps.receiver();
    if (this.deps.mode() !== cfg.mode || !rx.ready || rx.mode !== cfg.mode
      || rx.generation !== this.configuredGeneration
      || (cfg.mode === 'Q65' && (rx.q65Submode ?? 'Q65-60B') !== (cfg.q65Submode ?? 'Q65-60B'))) {
      this.disable();
      return;
    }
    const op = this.deps.operator(cfg.operatorId);
    if (!op || !op.isTransmitting) {
      this.cancelPending();
      return;
    }
    const period = cfg.mode === 'Q65' ? Q65_PERIOD_MS[cfg.q65Submode ?? 'Q65-60B']
      : cfg.mode === 'MSK144' ? (cfg.mskPeriodSeconds ?? 5) * 1000 : 120_000;
    const first = cfg.mode === 'Q65' ? (cfg.q65TxFirst ?? true)
      : cfg.mode === 'MSK144' ? (cfg.mskTxFirst ?? true) : undefined;
    const slotStart = nextNativeAutoSlot(this.deps.now(), period, first);
    const transmissions = cfg.mode === 'WSPR' ? [] : this.deps.transmissions(cfg.operatorId);
    // A mixed/multistream native waveform would need a dedicated native mixer,
    // not a fallback to the legacy FT8 encoder.
    if (cfg.mode !== 'WSPR' && transmissions.length !== 1) {
      this.cancelPending();
      return;
    }
    const text = cfg.mode === 'WSPR' ? cfg.beaconText!.trim().toUpperCase()
      : transmissions[0]!.text.trim();
    const af = cfg.mode === 'MSK144' ? 1500
      : cfg.mode === 'WSPR' ? cfg.audioHz
      : transmissions[0]!.audioFrequencyHz;
    if (!text || !Number.isFinite(af)) return;
    const key = [rx.generation, cfg.operatorId, cfg.mode, slotStart, text, af].join('|');
    if (this.pending) {
      // A QSO response may change while an encoder is waiting for its UTC
      // slot. Cancel only pre-PTT work; never truncate an on-air frame.
      if (this.pending.key !== key && this.deps.physicalPhase() === 'idle') this.cancelPending();
      return;
    }
    if (this.deps.nativeBusy() || this.deps.physicalPhase() !== 'idle' || this.lastAttemptKey === key) return;

    const request: MfskTxRequest = {
      mode: cfg.mode, operatorId: cfg.operatorId, text, audioHz: af,
      ...(cfg.mode === 'Q65' ? { q65Submode: cfg.q65Submode ?? 'Q65-60B', q65TxFirst: first } : {}),
      ...(cfg.mode === 'MSK144' ? { mskPeriodSeconds: cfg.mskPeriodSeconds ?? 5, mskTxFirst: first } : {}),
    };
    this.lastAttemptKey = key;
    this.pending = { key, operatorId: cfg.operatorId, text };
    const pending = this.pending;
    void this.deps.send(request).then(outcome => {
      if (this.pending !== pending) return;
      this.lastScheduledStartMs = outcome.scheduledStartMs;
      this.lastPhysicalTxConfirmed = isMfskPhysicalTxConfirmed(outcome);
      if (!this.lastPhysicalTxConfirmed) this.lastError = 'Native audio/PTT did not confirm transmission';
    }).catch(error => {
      if (this.pending !== pending) return;
      this.lastError = error instanceof Error ? error.message : String(error);
      logger.warn('Native automatic transmit attempt failed', {
        mode: cfg.mode, operatorId: cfg.operatorId, error: this.lastError,
      });
    }).finally(() => {
      if (this.pending === pending) this.pending = null;
    });
  }
}
