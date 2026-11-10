import { z } from 'zod';
import { DecodeRequestSchema } from '@tx5dr/contracts';

const SessionId = z.string().min(1).max(63);
const CommandId = z.number().int().positive();
export const CallsignHashSnapshotSchema = z.object({
  version: z.number().int().nonnegative(),
  calls: z.array(z.string().min(2).max(11)).max(12000),
});

export const DecodeWorkerCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('decode'), id: CommandId, request: DecodeRequestSchema,
    hashSnapshot: CallsignHashSnapshotSchema.optional() }),
  z.object({ type: z.literal('shutdown') }),
  z.object({ type: z.literal('end-session'), id: CommandId, sessionId: SessionId }),
]);
export const DecodeSessionEndedSchema = z.object({
  type: z.literal('session-ended'), id: CommandId, sessionId: SessionId,
  error: z.object({ name: z.string(), message: z.string(), stack: z.string().optional() }).optional(),
});
