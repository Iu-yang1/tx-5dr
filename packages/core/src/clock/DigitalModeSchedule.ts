import {
  DIGITAL_CODEC_PROFILES,
  Q65_PERIOD_MS,
  type DigitalCodecMode,
  type Q65Submode,
  digitalCodecSlotStart,
} from '@tx5dr/contracts';

/** This planner is clock-pure: no PTT, decoder or timers are implicitly started. */
export interface DigitalScheduleDefinition {
  mode: DigitalCodecMode;
  scheduling: 'utc-slot' | 'burst-stream' | 'continuous';
  slotMs: number | null;
  /** A mode-specific selectable submode, never parsed from display labels. */
  submode: Q65Submode | null;
}

export interface DigitalSlotWindow {
  slotId: string;
  startMs: number;
  endMs: number;
  period: number;
  /** Used by the QSO scheduler, not a promise that a waveform fits this period. */
  txParity: 0 | 1;
}

export function resolveDigitalSchedule(
  mode: DigitalCodecMode,
  q65Submode?: Q65Submode,
): DigitalScheduleDefinition {
  const profile = DIGITAL_CODEC_PROFILES[mode];
  if (!profile) throw new RangeError(`Unsupported digital mode: ${mode}`);
  if (mode !== 'Q65' && q65Submode !== undefined) {
    throw new RangeError('Q65 submode cannot be attached to another mode');
  }
  if (mode === 'Q65') {
    const submode = q65Submode ?? 'Q65-60B';
    const period = Q65_PERIOD_MS[submode];
    if (!period) throw new RangeError(`Unknown Q65 submode: ${submode}`);
    return { mode, submode, scheduling: 'utc-slot', slotMs: period };
  }
  if (profile.streaming) {
    return {
      mode, submode: null,
      scheduling: mode === 'MSK144' ? 'burst-stream' : 'continuous',
      slotMs: null,
    };
  }
  return { mode, submode: null, scheduling: 'utc-slot', slotMs: profile.slotMs };
}

function clockInput(ms: number): number {
  if (!Number.isSafeInteger(ms)) {
    throw new RangeError('Digital scheduler requires an integer UTC epoch millisecond time');
  }
  return ms;
}

/** Return the fixed UTC period containing the timestamp. Throws for streams. */
export function containingDigitalSlot(def: DigitalScheduleDefinition, nowMs: number): DigitalSlotWindow {
  clockInput(nowMs);
  if (def.scheduling !== 'utc-slot' || def.slotMs === null) {
    throw new Error(`${def.mode} is not a fixed UTC slot mode`);
  }
  const startMs = digitalCodecSlotStart(nowMs, def.slotMs);
  const period = startMs / def.slotMs;
  return {
    slotId: `${def.submode ?? def.mode}-${period}-${startMs}`,
    startMs,
    endMs: startMs + def.slotMs,
    period,
    txParity: (Math.abs(period % 2) as 0 | 1),
  };
}

/** Calculate the next boundary strictly *after* nowMs, including exact boundaries. */
export function nextDigitalSlot(def: DigitalScheduleDefinition, nowMs: number): DigitalSlotWindow {
  const current = containingDigitalSlot(def, nowMs);
  return containingDigitalSlot(def, current.endMs);
}

/** A generation token invalidates results after mode switch or clock reset. */
export class DigitalScheduleGeneration {
  private epoch = 0;

  current(): number {
    return this.epoch;
  }

  invalidate(): number {
    this.epoch += 1;
    if (!Number.isSafeInteger(this.epoch)) {
      throw new Error('Digital scheduler generation overflow');
    }
    return this.epoch;
  }

  accepts(generation: number): boolean {
    return Number.isSafeInteger(generation) && generation === this.epoch;
  }
}

/** Non-slotted modes receive continuous monotonic audio chunks, not fake slot records. */
export class AudioStreamSequence {
  private generation = new DigitalScheduleGeneration();
  private lastEndSample: number | null = null;

  restart(): number {
    this.lastEndSample = null;
    return this.generation.invalidate();
  }

  currentGeneration(): number {
    return this.generation.current();
  }

  /** Reject overlap or gaps, so reordering cannot silently corrupt decoding state. */
  accept(generation: number, sampleStart: number, sampleCount: number): boolean {
    if (!this.generation.accepts(generation)
      || !Number.isSafeInteger(sampleStart) || sampleStart < 0
      || !Number.isSafeInteger(sampleCount) || sampleCount <= 0) return false;
    if (this.lastEndSample !== null && sampleStart !== this.lastEndSample) return false;
    this.lastEndSample = sampleStart + sampleCount;
    return true;
  }
}
