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

/** All test transmission in this API is synthetic: no PTT, no RF and no logbook. */
export const MfskCodecSimulationRequestSchema = z.object({
  mode: DigitalCodecModeSchema,
  q65Submode: Q65SubmodeSchema.optional(),
  text: z.string().trim().min(1).max(64),
  audioFrequencyHz: z.number().finite().min(100).max(5500).default(1500),
  noiseAmplitude: z.number().finite().min(0).max(0.025).default(0.002),
  mskPeriodSeconds: z.union([z.literal(5),z.literal(10),z.literal(15),z.literal(30)]).optional(),
}).superRefine((value, ctx) => {
  if (value.mode !== 'Q65' && value.q65Submode !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Q65 submode is only valid for Q65', path: ['q65Submode'] });
  }
  if (value.mode !== 'MSK144' && value.mskPeriodSeconds !== undefined) {
    ctx.addIssue({ code:z.ZodIssueCode.custom, message:'MSK144 period is only valid for MSK144', path:['mskPeriodSeconds'] });
  }
});
export type MfskCodecSimulationRequest = z.infer<typeof MfskCodecSimulationRequestSchema>;

export const MfskCodecSimulationResponseSchema = z.object({
  mode: DigitalCodecModeSchema,
  submode: Q65SubmodeSchema.nullable(),
  canonicalText: z.string(),
  receivedTexts: z.array(z.string()).max(64),
  messageRecovered: z.boolean(),
  samples: z.number().int().positive(),
  sampleRate: z.literal(12_000),
  encodeMs: z.number().finite().nonnegative(),
  decodeMs: z.number().finite().nonnegative(),
  physicalTxEnabled: z.literal(false),
  simulationOnly: z.literal(true),
});
export type MfskCodecSimulationResponse = z.infer<typeof MfskCodecSimulationResponseSchema>;

/** Separate live RX process. This API NEVER requests physical PTT. */
export const MfskApContextSchema = z.object({
  myCall:z.string().trim().toUpperCase().regex(/^[A-Z0-9\/]{3,24}$/),
  myGrid:z.string().trim().toUpperCase().regex(/^[A-R]{2}[0-9]{2}(?:[A-X]{2})?$/),
  dxCall:z.string().trim().toUpperCase().regex(/^[A-Z0-9\/]{3,24}$/),
  dxGrid:z.string().trim().toUpperCase().regex(/^[A-R]{2}[0-9]{2}(?:[A-X]{2})?$/).optional(),
  progress:z.union([z.literal(0),z.literal(1),z.literal(2),
    z.literal(3),z.literal(4),z.literal(5)]).default(0),
});
export type MfskApContext=z.infer<typeof MfskApContextSchema>;

export const MfskLiveRxStartSchema = z.object({
  mode: DigitalCodecModeSchema,
  q65Submode: Q65SubmodeSchema.optional(),
  frequencyHz: z.number().finite().min(100).max(5500).default(1500),
  depth: z.union([z.literal(1),z.literal(2),z.literal(3)]).default(3),
  averaging: z.boolean().default(false),
  emeDelay: z.boolean().default(false),
  apContext:MfskApContextSchema.optional(),
}).superRefine((value,ctx)=>{
  if(value.q65Submode && value.mode!=='Q65'){
    ctx.addIssue({code:z.ZodIssueCode.custom,path:['q65Submode'],message:'Q65 submode is only for Q65'});
  }
  if(value.apContext && value.mode!=='Q65'){
    ctx.addIssue({code:z.ZodIssueCode.custom,path:['apContext'],message:'AP context only supported on Q65'});
  }
  if((value.averaging||value.emeDelay)&&value.mode!=='Q65'){
    ctx.addIssue({code:z.ZodIssueCode.custom,path:['averaging'],message:'EME settings are only for Q65'});
  }
});
export type MfskLiveRxStart = z.infer<typeof MfskLiveRxStartSchema>;

export const MfskLiveRxStatusSchema = z.object({
  running:z.boolean(),ready:z.boolean(),physicalTxEnabled:z.literal(false),
  mode:DigitalCodecModeSchema.optional(),
  q65Submode:Q65SubmodeSchema.optional(),
  generation:z.number().int().nonnegative(),
  received:z.number().int().nonnegative(),
  droppedAudioChunks:z.number().int().nonnegative(),
  rejectedSlots:z.number().int().nonnegative(),
  workerFaults:z.number().int().nonnegative(),
  lastError:z.string().optional(),
});
export type MfskLiveRxStatus = z.infer<typeof MfskLiveRxStatusSchema>;

export const MfskLiveRxEventsSchema = z.object({
  events:z.array(DigitalRxEventSchema).max(200),
  status:MfskLiveRxStatusSchema,
});
export type MfskLiveRxEvents = z.infer<typeof MfskLiveRxEventsSchema>;

export const MfskPhysicalTxRequestSchema = z.object({
  mode:DigitalCodecModeSchema,
  operatorId:z.string().min(1).max(128),
  text:z.string().trim().min(1).max(64),
  audioHz:z.number().finite().min(100).max(5500),
  q65Submode:Q65SubmodeSchema.optional(),
  mskPeriodSeconds: z.union([z.literal(5),z.literal(10),z.literal(15),z.literal(30)]).optional(),
  beaconAuthorized:z.boolean().default(false),
}).superRefine((value,ctx)=>{
  if(value.mode==='WSPR'&&!value.beaconAuthorized){
    ctx.addIssue({code:z.ZodIssueCode.custom,path:['beaconAuthorized'],message:'WSPR beacon requires explicit authorization'});
  }
  if(value.mode!=='Q65'&&value.q65Submode){
    ctx.addIssue({code:z.ZodIssueCode.custom,path:['q65Submode'],message:'Q65-only submode'});
  }
  if(value.mode!=='MSK144'&&value.mskPeriodSeconds!==undefined){
    ctx.addIssue({code:z.ZodIssueCode.custom,path:['mskPeriodSeconds'],message:'MSK144-only period'});
  }
});
export type MfskPhysicalTxRequest = z.infer<typeof MfskPhysicalTxRequestSchema>;

/** Manual operator-confirmed contact only; WSPR is propagation beacon, not a QSO. */
export const MfskManualQsoSchema = z.object({
  mode:z.enum(['Q65','MSK144','JTTY']),
  operatorId:z.string().trim().min(1).max(128),
  callsign:z.string().trim().toUpperCase().regex(/^[A-Z0-9\/]{3,24}$/),
  grid:z.string().trim().toUpperCase().regex(/^[A-R]{2}[0-9]{2}(?:[A-X]{2})?$/).optional(),
  frequencyHz:z.number().finite().min(1000).max(100_000_000_000),
  startTime:z.number().int().nonnegative(),
  endTime:z.number().int().nonnegative(),
  reportSent:z.string().trim().max(16).optional(),
  reportReceived:z.string().trim().max(16).optional(),
  q65Submode:Q65SubmodeSchema.optional(),
  messageHistory:z.array(z.string().max(128)).max(128).default([]),
}).superRefine((data,ctx)=>{
  if(data.endTime<data.startTime){
    ctx.addIssue({code:z.ZodIssueCode.custom,path:['endTime'],message:'End time before start time'});
  }
  if(data.mode!=='Q65'&&data.q65Submode){
    ctx.addIssue({code:z.ZodIssueCode.custom,path:['q65Submode'],message:'Q65-only submode'});
  }
});
export type MfskManualQso=z.infer<typeof MfskManualQsoSchema>;
