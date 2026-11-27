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
});
export const CWContestSnapshotSchema = z.object({
  enabled: z.boolean(), listening: z.boolean(), bind: z.string(), port: z.number(),
  stationCall: z.string(), error: z.string().optional(),
  cat: z.object({ enabled: z.boolean(), listening: z.boolean(), host: z.string(), port: z.number(), clients: z.number(), error: z.string().optional() }).optional(),
  winkey: z.object({ enabled:z.boolean(), listening:z.boolean(), host:z.string(), port:z.number(), connected:z.boolean(), opened:z.boolean(), busy:z.boolean(), wpm:z.number(), error:z.string().optional() }).optional(),
  radio: ContestRadioInfoSchema.optional(),
  lookup: z.object({ call: z.string(), zone: z.string(), receivedAt: z.number() }).optional(),
  contacts: z.array(ContestContactSchema),
  observedContacts: z.number().int().nonnegative(),
});
export type ContestRadioInfo = z.infer<typeof ContestRadioInfoSchema>;
export type ContestContact = z.infer<typeof ContestContactSchema>;
export type CWContestSnapshot = z.infer<typeof CWContestSnapshotSchema>;
