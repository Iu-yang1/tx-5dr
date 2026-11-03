import { z } from 'zod';

/**
 * Protocol contract, not an assertion that TX-5DR can operate the mode yet.
 * Production mode selection MUST check runtime RX/TX capabilities separately.
 * Do not add modes to legacy MODES until their scheduler is installed.
 */
export const DigitalCodecModeSchema = z.enum([
  'FT8', 'FT4', 'Q65', 'MSK144', 'JTTY', 'WSPR',
]);
export type DigitalCodecMode = z.infer<typeof DigitalCodecModeSchema>;

export const DigitalCodecScheduleSchema = z.enum([
  'fixed-slot', 'long-period', 'burst-stream', 'continuous',
]);
export type DigitalCodecSchedule = z.infer<typeof DigitalCodecScheduleSchema>;

export const Q65SubmodeSchema = z.enum([
  'Q65-15A', 'Q65-30A', 'Q65-60A', 'Q65-60B', 'Q65-60C',
  'Q65-60D', 'Q65-60E', 'Q65-120D', 'Q65-120E', 'Q65-300A',
]);
export type Q65Submode = z.infer<typeof Q65SubmodeSchema>;

export const Q65_PERIOD_MS: Readonly<Record<Q65Submode, number>> = Object.freeze({
  'Q65-15A': 15_000,
  'Q65-30A': 30_000,
  'Q65-60A': 60_000,
  'Q65-60B': 60_000,
  'Q65-60C': 60_000,
  'Q65-60D': 60_000,
  'Q65-60E': 60_000,
  'Q65-120D': 120_000,
  'Q65-120E': 120_000,
  'Q65-300A': 300_000,
});

export const DigitalCodecModeProfileSchema = z.object({
  mode: DigitalCodecModeSchema,
  schedule: DigitalCodecScheduleSchema,
  usage: z.enum(['qso', 'beacon']),
  /** null: no fixed UTC slot; not a zero-length slotted mode. */
  slotMs: z.number().int().positive().nullable(),
  /** Non-slotted modes must not enter legacy SlotClock/SlotScheduler. */
  streaming: z.boolean(),
  /** Advisory. Permissioned physical TX remains a separate decision. */
  txKind: z.enum(['slot', 'repeat', 'continuous', 'beacon']),
});

export type DigitalCodecModeProfile = z.infer<typeof DigitalCodecModeProfileSchema>;

export const DIGITAL_CODEC_PROFILES: Readonly<Record<DigitalCodecMode, DigitalCodecModeProfile>> =
  Object.freeze({
    FT8: { mode: 'FT8', schedule: 'fixed-slot', usage: 'qso', slotMs: 15_000, streaming: false, txKind: 'slot' },
    FT4: { mode: 'FT4', schedule: 'fixed-slot', usage: 'qso', slotMs: 7_500, streaming: false, txKind: 'slot' },
    Q65: { mode: 'Q65', schedule: 'long-period', usage: 'qso', slotMs: 60_000, streaming: false, txKind: 'slot' },
    MSK144: { mode: 'MSK144', schedule: 'burst-stream', usage: 'qso', slotMs: null, streaming: true, txKind: 'repeat' },
    JTTY: { mode: 'JTTY', schedule: 'continuous', usage: 'qso', slotMs: null, streaming: true, txKind: 'continuous' },
    WSPR: { mode: 'WSPR', schedule: 'long-period', usage: 'beacon', slotMs: 120_000, streaming: false, txKind: 'beacon' },
  });

/** A mode present in a Rust build is NOT necessarily connected to the running radio engine. */
export const DigitalCodecRuntimeCapabilitySchema = z.object({
  mode: DigitalCodecModeSchema,
  backend: z.enum(['wsjtx-lib', 'mfsk-native', 'unavailable']),
  receiverReady: z.boolean(),
  encoderReady: z.boolean(),
  schedulerReady: z.boolean(),
  txPipelineReady: z.boolean(),
  submodes: z.array(Q65SubmodeSchema).default([]),
});
export type DigitalCodecRuntimeCapability = z.infer<typeof DigitalCodecRuntimeCapabilitySchema>;

const RxBase = {
  sessionId: z.string().min(1),
  mode: DigitalCodecModeSchema,
  timestampMs: z.number().finite(),
  frequencyHz: z.number().finite(),
};

export const DigitalRxEventSchema = z.discriminatedUnion('kind', [
  z.object({
    ...RxBase,
    kind: z.literal('slot-decode'),
    slotId: z.string().min(1),
    text: z.string(),
    snrDb: z.number().finite(),
    dtSeconds: z.number().finite(),
    final: z.boolean(),
  }),
  z.object({
    ...RxBase,
    kind: z.literal('burst-decode'),
    /** Known burst duration, if the native decoder reports it. */
    durationMs: z.number().positive().optional(),
    /** Length of the observed stream chunk; not necessarily burst duration. */
    observationWindowMs: z.number().positive(),
    text: z.string(),
    snrDb: z.number().finite(),
  }),
  z.object({
    ...RxBase,
    kind: z.literal('message-update'),
    messageId: z.string().min(1),
    revision: z.number().int().nonnegative(),
    state: z.enum(['growing', 'complete', 'expired', 'reception-ended']),
    text: z.string(),
  }),
]);
export type DigitalRxEvent = z.infer<typeof DigitalRxEventSchema>;

/**
 * Fail closed. Every caller must provide an explicit current runtime capability,
 * mode-specific TX authorisation and physical radio/PTT readiness.
 */
export function digitalCodecTxAllowed(
  capability: DigitalCodecRuntimeCapability | undefined,
  permissionGranted: boolean,
  radioReady: boolean,
  pttAvailable: boolean,
  beaconTxEnabled = false,
): boolean {
  if (!capability || !capability.encoderReady || !capability.schedulerReady
    || !capability.txPipelineReady || !permissionGranted || !radioReady || !pttAvailable) {
    return false;
  }
  return DIGITAL_CODEC_PROFILES[capability.mode].usage !== 'beacon' || beaconTxEnabled;
}

/** Exact UTC alignment; use integer milliseconds rather than rounded seconds. */
export function digitalCodecSlotStart(timeMs: number, slotMs: number): number {
  if (!Number.isSafeInteger(timeMs) || !Number.isSafeInteger(slotMs) || slotMs <= 0) {
    throw new RangeError('timeMs and slotMs must be safe integers; slotMs must be positive');
  }
  return Math.floor(timeMs / slotMs) * slotMs;
}

/** Read-only probe of an isolated native codec process (never RF readiness). */
export const MfskCodecProbeResponseSchema = z.object({
  experimental: z.literal(true),
  physicalTxEnabled: z.literal(false),
  version: z.string().nullable(),
  capabilities: z.array(DigitalCodecRuntimeCapabilitySchema).length(6),
  error: z.string().optional(),
});
export type MfskCodecProbeResponse = z.infer<typeof MfskCodecProbeResponseSchema>;
