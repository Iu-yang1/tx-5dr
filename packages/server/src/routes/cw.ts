import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  UserRole,
  N1MMEntryRequestSchema,
  N1MMInterfaceConfigSchema,N1MMVirtualSerialActionSchema,type N1MMInterfaceConfig,
  N1MMEntryAgentUpdateSchema,
  CWKeyerBackendSchema,
  CWDecoderConfigPatchSchema,
  CWDecoderTuningUpdateSchema,
  CWMessagePanelUpdateSchema,
  CWMessageSlotUpdateSchema,
  CWMessageSlotSwapSchema,
} from '@tx5dr/contracts';
import { DigitalRadioEngine } from '../DigitalRadioEngine.js';
import { requireAbility, requireCallsignAccess, requireRole } from '../auth/authPlugin.js';
import { RadioError, RadioErrorCode } from '../utils/errors/RadioError.js';
import { createLogger } from '../utils/logger.js';
import { N1MMContestReceiver } from '../contest/N1MMContestReceiver.js';
import { ConfigManager } from '../config/config-manager.js';
import { SerialLoomProvider } from '../contest/SerialLoomProvider.js';
import { N1MMEntryBridge } from '../contest/N1MMEntryBridge.js';

const logger = createLogger('CWRoutes');

const UNAUTHORIZED_RESPONSE = {
  success: false,
  error: { code: 'UNAUTHORIZED', message: 'Authentication required', userMessage: 'Please login first' },
} as const;

const FORBIDDEN_RESPONSE = {
  success: false,
  error: { code: 'FORBIDDEN', message: 'Permission denied', userMessage: 'You do not have permission for this operation' },
} as const;

function hasPatchBody(body: unknown): boolean {
  return Boolean(body)
    && typeof body === 'object'
    && !Array.isArray(body)
    && Object.keys(body as Record<string, unknown>).length > 0;
}

async function requireCWDecoderConfigUpdateForPatch(request: FastifyRequest, reply: FastifyReply) {
  if (!hasPatchBody(request.body)) return;
  if (!request.authUser) {
    return reply.code(401).send(UNAUTHORIZED_RESPONSE);
  }
  if (request.ability.cannot('update', 'CWDecoderConfig')) {
    return reply.code(403).send(FORBIDDEN_RESPONSE);
  }
}

export async function cwRoutes(fastify: FastifyInstance) {
  const engine = DigitalRadioEngine.getInstance();
  const entryBridge = new N1MMEntryBridge();
  const configManager=ConfigManager.getInstance();
  const receiverConfig=(config:N1MMInterfaceConfig)=>({enabled:config.udp.enabled,bind:config.udp.host,port:config.udp.port,stationCall:config.udp.stationCall,stationName:config.udp.stationName});
  let active=configManager.getN1MMInterfaceConfig();
  let contestReceiver=new N1MMContestReceiver(receiverConfig(active));
  const serial=new SerialLoomProvider();
  let tail:Promise<unknown>=Promise.resolve();
  const serialTask=<T>(fn:()=>Promise<T>):Promise<T>=>{const task=tail.catch(()=>undefined).then(fn);tail=task;return task;};
  const status=()=>{const udp=contestReceiver.snapshot();return {config:active,cat:engine.getN1MMCatStatus(),winkey:engine.getN1MMWinKeyStatus(),udp:{listening:udp.listening,error:udp.error}};};
  fastify.addHook('onReady',async()=>{await contestReceiver.startAsync();});
  fastify.addHook('onClose',async()=>{await tail.catch(()=>undefined);await contestReceiver.closeAsync();});
  fastify.get('/contest/interfaces',{preHandler:[requireRole(UserRole.ADMIN)]},async()=>status());
  fastify.put('/contest/interfaces',{preHandler:[requireRole(UserRole.ADMIN)]},async(req,reply)=>{
    const next=N1MMInterfaceConfigSchema.parse(req.body);
    return reply.send(await serialTask(async()=>{
      await configManager.updateN1MMInterfaceConfig(next);
      await engine.applyN1MMInterfaceConfig(next);
      if(JSON.stringify(active.udp)!==JSON.stringify(next.udp)){
        await contestReceiver.closeAsync();
        contestReceiver=new N1MMContestReceiver(receiverConfig(next));
      }
      await contestReceiver.startAsync();
      active=next;return status();
    }));
  });
  fastify.get('/contest/virtual-serial',{preHandler:[requireRole(UserRole.ADMIN)]},async()=>serial.status());
  fastify.post('/contest/virtual-serial',{preHandler:[requireRole(UserRole.ADMIN)]},async(req,reply)=>{
    const action=N1MMVirtualSerialActionSchema.parse(req.body);
    return reply.send(await serialTask(()=>serial.apply(action,active)));
  });
  fastify.get('/contest/n1mm', { preHandler: [requireRole(UserRole.OPERATOR)] }, async (req, reply) => {
    const query=req.query as {call?:string};
    return reply.send({ ...contestReceiver.snapshot(typeof query.call==='string'?query.call:undefined), cat: engine.getN1MMCatStatus(), winkey: engine.getN1MMWinKeyStatus(), entry: entryBridge.snapshot() });
  });

  fastify.post('/contest/mirror/reset', { preHandler: [requireRole(UserRole.OPERATOR)] }, async (_req, reply) => {
    contestReceiver.resetMirror();
    return reply.send(contestReceiver.snapshot());
  });
  fastify.get('/contest/entry', { preHandler: [requireRole(UserRole.OPERATOR)] }, async (_req, reply) => reply.send(entryBridge.snapshot()));
  fastify.put('/contest/entry', { preHandler: [requireRole(UserRole.OPERATOR)] }, async (req, reply) => {
    const {action,...fields} = N1MMEntryRequestSchema.parse(req.body);
    try { return reply.send(entryBridge.request(fields,action)); }
    catch(error) { return reply.code(409).send({success:false,error:{message:String(error)}}); }
  });
  fastify.post('/contest/entry/agent', { preHandler: [requireRole(UserRole.OPERATOR)] }, async (req, reply) => {
    return reply.send(entryBridge.agent(N1MMEntryAgentUpdateSchema.parse(req.body)));
  });

  fastify.get('/decoder/backends', async (_req, reply) => {
    return reply.send({ success: true, backends: engine.getCWDecoderBackends() });
  });

  fastify.get('/decoder/config', async (_req, reply) => {
    return reply.send({
      success: true,
      config: engine.getCWDecoderConfig(),
      status: engine.getCWDecoderStatus(),
    });
  });

  fastify.put('/decoder/config', {
    preHandler: [requireAbility('update', 'CWDecoderConfig')],
  }, async (req, reply) => {
    try {
      const patch = CWDecoderConfigPatchSchema.parse(req.body);
      const config = await engine.updateCWDecoderConfig(patch);
      return reply.send({ success: true, config, status: engine.getCWDecoderStatus() });
    } catch (error) {
      throw RadioError.from(error, RadioErrorCode.INVALID_CONFIG);
    }
  });

  fastify.patch('/decoder/tuning', {
    preHandler: [requireAbility('update', 'CWDecoderConfig')],
  }, async (req, reply) => {
    try {
      const patch = CWDecoderTuningUpdateSchema.parse(req.body);
      const status = await engine.updateCWDecoderTuning(patch);
      return reply.send({ success: true, status });
    } catch (error) {
      throw RadioError.from(error, RadioErrorCode.INVALID_CONFIG);
    }
  });

  fastify.post('/decoder/start', {
    preHandler: [requireAbility('execute', 'CWDecoder'), requireCWDecoderConfigUpdateForPatch],
  }, async (req, reply) => {
    try {
      const patch = CWDecoderConfigPatchSchema.parse(req.body ?? {});
      const status = await engine.startCWDecoder(patch);
      return reply.send({ success: true, status, config: engine.getCWDecoderConfig() });
    } catch (error) {
      throw RadioError.from(error, RadioErrorCode.INVALID_OPERATION);
    }
  });

  fastify.post('/decoder/stop', {
    preHandler: [requireAbility('execute', 'CWDecoder')],
  }, async (_req, reply) => {
    try {
      const status = await engine.stopCWDecoder();
      return reply.send({ success: true, status, config: engine.getCWDecoderConfig() });
    } catch (error) {
      throw RadioError.from(error, RadioErrorCode.INVALID_OPERATION);
    }
  });

  fastify.post('/decoder/clear', {
    preHandler: [requireAbility('execute', 'CWDecoder')],
  }, async (_req, reply) => {
    try {
      const status = engine.clearCWDecoderTranscript();
      return reply.send({ success: true, status, config: engine.getCWDecoderConfig() });
    } catch (error) {
      throw RadioError.from(error, RadioErrorCode.INVALID_OPERATION);
    }
  });

  // GET /config - return CW keyer config
  fastify.get('/config', async (_req, reply) => {
    const manager = engine.getCWKeyerManager();
    return reply.send({ success: true, config: await manager.getConfigAsync() });
  });

  // PUT /config - update CW keyer config (wpm, etc.)
  fastify.put('/config', {
    preHandler: [requireRole(UserRole.OPERATOR)],
  }, async (req, reply) => {
    try {
      const manager = engine.getCWKeyerManager();
      const body = req.body as { backend?: unknown; wpm?: unknown };
      const update: { backend?: 'cat' | 'serial'; wpm?: number } = {};
      if (body.backend !== undefined) {
        update.backend = CWKeyerBackendSchema.parse(body.backend);
      }
      if (body.wpm !== undefined) {
        update.wpm = Number(body.wpm);
      }
      await manager.updateConfig(update);
      logger.info('CW keyer config updated', update);
      return reply.send({ success: true, config: manager.getConfig() });
    } catch (error) {
      throw RadioError.from(error, RadioErrorCode.INVALID_CONFIG);
    }
  });

  // GET /panel/:callsign - get message panel
  fastify.get('/panel/:callsign', {
    preHandler: [requireRole(UserRole.OPERATOR), requireCallsignAccess()],
  }, async (req, reply) => {
    const { callsign } = req.params as { callsign: string };
    const manager = engine.getCWKeyerManager();
    const panel = await manager.getPanel(callsign);
    return reply.send({ success: true, panel });
  });

  // PATCH /panel/:callsign - update panel (slot count)
  fastify.patch('/panel/:callsign', {
    preHandler: [requireRole(UserRole.OPERATOR), requireCallsignAccess()],
  }, async (req, reply) => {
    const { callsign } = req.params as { callsign: string };
    const body = CWMessagePanelUpdateSchema.parse(req.body);
    const manager = engine.getCWKeyerManager();
    const panel = await manager.updatePanel(callsign, body.slotCount);
    return reply.send({ success: true, panel });
  });

  // PATCH /panel/:callsign/slots/:slotId - update slot
  fastify.patch('/panel/:callsign/slots/:slotId', {
    preHandler: [requireRole(UserRole.OPERATOR), requireCallsignAccess()],
  }, async (req, reply) => {
    const { callsign, slotId } = req.params as { callsign: string; slotId: string };
    const body = CWMessageSlotUpdateSchema.parse(req.body);
    const manager = engine.getCWKeyerManager();
    const panel = await manager.updateSlot(callsign, slotId, body);
    return reply.send({ success: true, panel });
  });

  // DELETE /panel/:callsign/slots/:slotId - clear slot text
  fastify.delete('/panel/:callsign/slots/:slotId', {
    preHandler: [requireRole(UserRole.OPERATOR), requireCallsignAccess()],
  }, async (req, reply) => {
    const { callsign, slotId } = req.params as { callsign: string; slotId: string };
    const manager = engine.getCWKeyerManager();
    const panel = await manager.deleteSlotText(callsign, slotId);
    return reply.send({ success: true, panel });
  });

  // POST /panel/:callsign/slots/swap - swap two slots
  fastify.post('/panel/:callsign/slots/swap', {
    preHandler: [requireRole(UserRole.OPERATOR), requireCallsignAccess()],
  }, async (req, reply) => {
    const { callsign } = req.params as { callsign: string };
    const body = CWMessageSlotSwapSchema.parse(req.body);
    const manager = engine.getCWKeyerManager();
    const panel = await manager.swapSlots(callsign, body.slotIdA, body.slotIdB);
    return reply.send({ success: true, panel });
  });
}
