import { z } from 'zod';
import { Q65SubmodeSchema } from './digital-codec.schema.js';

/** Station-wide native RX/TX preferences. Clients never own the receiver lifecycle. */
export const NativeDigitalModeSchema = z.enum(['Q65', 'WSPR', 'MSK144', 'JTTY']);
export type NativeDigitalMode = z.infer<typeof NativeDigitalModeSchema>;

export const NativeDecodePreferencesSchema = z.object({
  frequencyHz: z.number().finite().min(100).max(5500),
  toleranceHz: z.number().finite().min(1).max(5000),
  depth: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  q65Submode: Q65SubmodeSchema,
  q65TimeToleranceSec: z.number().finite().min(1).max(150).nullable(),
  q65SyncScore: z.number().finite().min(0.01).max(1).nullable(),
  q65MaxCandidates: z.number().int().min(1).max(64).nullable(),
  averaging: z.boolean(),
  emeDelay: z.boolean(),
  mskShorthand: z.boolean(),
  mskAdaptiveEqualizer: z.boolean(),
  mskMyCall: z.string().trim().toUpperCase().max(12),
  mskDxCall: z.string().trim().toUpperCase().max(12),
  txAudioHz: z.number().finite().min(100).max(5500),
  q65TxFirst: z.boolean(),
  mskPeriodSeconds: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(30)]),
  mskTxFirst: z.boolean(),
}).strict();
export type NativeDecodePreferences = z.infer<typeof NativeDecodePreferencesSchema>;

export const DEFAULT_NATIVE_DECODE_PREFERENCES: NativeDecodePreferences = {
  frequencyHz: 1500, toleranceHz: 200, depth: 3, q65Submode: 'Q65-60B',
  q65TimeToleranceSec: null, q65SyncScore: null, q65MaxCandidates: null,
  averaging: false, emeDelay: false,
  mskShorthand: false, mskAdaptiveEqualizer: false, mskMyCall: '', mskDxCall: '',
  txAudioHz: 1500, q65TxFirst: true, mskPeriodSeconds: 5, mskTxFirst: true,
};

export const NATIVE_DIGITAL_MODES = NativeDigitalModeSchema.options;
export const NativeDecodePreferencesStateSchema = z.object({
  revision: z.number().int().nonnegative(),
  preferences: z.record(NativeDigitalModeSchema, NativeDecodePreferencesSchema),
});
export type NativeDecodePreferencesState = z.infer<typeof NativeDecodePreferencesStateSchema>;

export const UpdateNativeDecodePreferencesSchema = z.object({
  mode: NativeDigitalModeSchema,
  expectedRevision: z.number().int().nonnegative(),
  preferences: NativeDecodePreferencesSchema,
}).strict();
