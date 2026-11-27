import { z } from 'zod';

export const ContestRadioInfoSchema = z.object({
  station: z.string(), stationCall: z.string(), operator: z.string(),
  radioNr: z.number().int(), frequencyHz: z.number().int().positive(),
  txFrequencyHz: z.number().int().positive().optional(),
  mode: z.string(), running: z.boolean(), transmitting: z.boolean(),
  receivedAt: z.number(),
});
export const ContestContactSchema = z.object({
  id: z.string(), contestNr: z.string(), station: z.string(), stationCall: z.string(),
  operator: z.string(), call: z.string(), timestamp: z.string(),
  frequencyHz: z.number().int().positive(), mode: z.string(), band: z.string(),
  rstSent: z.string(), rstReceived: z.string(), zoneSent: z.string(), zoneReceived: z.string(),
  points: z.number().int().optional(),
  countryPrefix:z.string().optional(),
});
export const N1MMEntryFieldsSchema = z.object({ call: z.string().max(20).regex(/^[A-Z0-9/]*$/), zone: z.string().max(2).regex(/^\d{0,2}$/) });
export const N1MMEntryActionSchema = z.enum(['F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12','STOP','LOG','WIPE','MARK','STORE','SPOT','RUN','S&P','ENTER','INSERT','ALT_ENTER','SPACE','TAB','YANK']);
export type N1MMEntryAction = z.infer<typeof N1MMEntryActionSchema>;
export const N1MMEntryRequestSchema = N1MMEntryFieldsSchema.extend({action:N1MMEntryActionSchema.optional()});
export const N1MMEntryStateSchema = z.object({
  online: z.boolean(), fields: N1MMEntryFieldsSchema, revision: z.number().int().nonnegative(),
  pending: z.object({ revision: z.number().int(), fields: N1MMEntryFieldsSchema, expiresAt: z.number(), action:N1MMEntryActionSchema.optional() }).optional(),
  actions:z.array(N1MMEntryActionSchema).optional(),
  error: z.string().optional(), updatedAt: z.number(),
});
export const N1MMEntryAgentUpdateSchema = z.object({
  fields: N1MMEntryFieldsSchema, appliedRevision: z.number().int().nonnegative().optional(),
  error: z.string().max(400).optional(),
  actions:z.array(N1MMEntryActionSchema).optional(),
});
export type N1MMEntryFields = z.infer<typeof N1MMEntryFieldsSchema>;
export type N1MMEntryState = z.infer<typeof N1MMEntryStateSchema>;
export const ContestSpotSchema = z.object({
  call:z.string(), frequencyHz:z.number(), spotter:z.string(), timestamp:z.string(),
  status:z.string(), comment:z.string(), receivedAt:z.number(),
});
export const ContestScoreSchema = z.object({
  score:z.number(), timestamp:z.string(), receivedAt:z.number(),
  breakdown:z.array(z.object({kind:z.string(),band:z.string(),mode:z.string(),value:z.number(),type:z.string().optional()})),
});
export type ContestSpot = z.infer<typeof ContestSpotSchema>;
export type ContestScore = z.infer<typeof ContestScoreSchema>;
export const CWContestSnapshotSchema = z.object({
  enabled: z.boolean(), listening: z.boolean(), bind: z.string(), port: z.number(),
  stationCall: z.string(), error: z.string().optional(),
  cat: z.object({ enabled: z.boolean(), listening: z.boolean(), host: z.string(), port: z.number(), clients: z.number(), error: z.string().optional() }).optional(),
  winkey: z.object({ enabled:z.boolean(), listening:z.boolean(), host:z.string(), port:z.number(), connected:z.boolean(), opened:z.boolean(), busy:z.boolean(), wpm:z.number(), error:z.string().optional() }).optional(),
  application: z.object({ database: z.string(), contestNr: z.string(), contest: z.string(), station: z.string(), receivedAt: z.number() }).optional(),
  mirrorResetAt: z.number().optional(),
  lastContactAt: z.number().optional(),
  radio: ContestRadioInfoSchema.optional(),
  lookup: z.object({ call: z.string(), zone: z.string(), receivedAt: z.number() }).optional(),
  entry: N1MMEntryStateSchema.optional(),
  spots: z.array(ContestSpotSchema).optional(), score: ContestScoreSchema.optional(),
  contacts: z.array(ContestContactSchema),
  observedContacts: z.number().int().nonnegative(),
  workedBands:z.array(z.string()).optional(),
  logCandidates:z.array(z.string()).optional(),
  rate:z.object({last10:z.number(),last60:z.number()}).optional(),
  observedBands:z.array(z.object({band:z.string(),qsos:z.number(),zones:z.number(),countries:z.number()})).optional(),
});
export type ContestRadioInfo = z.infer<typeof ContestRadioInfoSchema>;
export type ContestContact = z.infer<typeof ContestContactSchema>;
export type CWContestSnapshot = z.infer<typeof CWContestSnapshotSchema>;
