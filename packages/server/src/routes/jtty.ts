import type { FastifyInstance } from 'fastify';
import {
  KeyboardMessagePanelSchema,
  KeyboardMessagePanelUpdateSchema,
  KeyboardMessageSlotSwapSchema,
  KeyboardMessageSlotUpdateSchema,
  UserRole,
} from '@tx5dr/contracts';
import { requireCallsignAccess, requireRole } from '../auth/authPlugin.js';
import { createJttyMessagePanels } from '../jtty/JttyMessagePanels.js';

const panels = createJttyMessagePanels();

/** Per-callsign, ordered mutations avoid two browser tabs silently losing edits. */
const activeWrites = new Map<string, Promise<void>>();
async function serializeWrite<T>(callsign: string, action: () => Promise<T>): Promise<T> {
  const key = callsign.trim().toUpperCase();
  const preceding = activeWrites.get(key) ?? Promise.resolve();
  const operation = preceding.then(action);
  const settled = operation.then(() => undefined, () => undefined);
  activeWrites.set(key, settled);
  void settled.then(() => {
    if (activeWrites.get(key) === settled) activeWrites.delete(key);
  });
  return operation;
}

export async function jttyRoutes(fastify: FastifyInstance): Promise<void> {
  const requirePanelAccess = [requireRole(UserRole.OPERATOR), requireCallsignAccess()];

  fastify.get('/panel/:callsign', { preHandler: requirePanelAccess }, async (request, reply) => {
    const { callsign } = request.params as { callsign: string };
    return reply.send({ success: true, panel: await serializeWrite(callsign, () => panels.getPanel(callsign)) });
  });

  fastify.patch('/panel/:callsign', { preHandler: requirePanelAccess }, async (request, reply) => {
    const { callsign } = request.params as { callsign: string };
    const { slotCount } = KeyboardMessagePanelUpdateSchema.parse(request.body);
    const panel = await serializeWrite(callsign, () => panels.updatePanel(callsign, slotCount));
    return reply.send({ success: true, panel });
  });

  fastify.patch('/panel/:callsign/slots/:slotId', { preHandler: requirePanelAccess }, async (request, reply) => {
    const { callsign, slotId } = request.params as { callsign: string; slotId: string };
    const update = KeyboardMessageSlotUpdateSchema.parse(request.body);
    const panel = await serializeWrite(callsign, () => panels.updateSlot(callsign, slotId, update));
    return reply.send({ success: true, panel });
  });

  fastify.delete('/panel/:callsign/slots/:slotId', { preHandler: requirePanelAccess }, async (request, reply) => {
    const { callsign, slotId } = request.params as { callsign: string; slotId: string };
    const panel = await serializeWrite(callsign, () => panels.deleteSlotText(callsign, slotId));
    return reply.send({ success: true, panel });
  });

  fastify.post('/panel/:callsign/slots/swap', { preHandler: requirePanelAccess }, async (request, reply) => {
    const { callsign } = request.params as { callsign: string };
    const { slotIdA, slotIdB } = KeyboardMessageSlotSwapSchema.parse(request.body);
    const panel = await serializeWrite(callsign, () => panels.swapSlots(callsign, slotIdA, slotIdB));
    return reply.send({ success: true, panel });
  });

  fastify.post('/panel/:callsign/import-legacy', { preHandler: requirePanelAccess }, async (request, reply) => {
    const { callsign } = request.params as { callsign: string };
    const data = KeyboardMessagePanelSchema.pick({ slotCount: true, slots: true }).parse(request.body);
    const panel = await serializeWrite(callsign, () => panels.seedIfAbsent(callsign, data));
    return reply.send({ success: true, panel });
  });
}
