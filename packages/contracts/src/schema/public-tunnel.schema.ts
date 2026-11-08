import { z } from 'zod';

export const PublicTunnelSettingsSchema = z.object({
  frpcPath: z.string().default(''),
  serverHost: z.string().default(''),
  serverPort: z.number().int().min(1).max(65535).default(7000),
  publicHost: z.string().default(''),
  remoteWebPort: z.number().int().min(1).max(65535).default(18076),
  remoteUdpPort: z.number().int().min(1).max(65535).default(50110),
  localUdpPort: z.number().int().min(1).max(65535).default(50110),
  trustedCaFile: z.string().default(''),
  autoStart: z.boolean().default(false),
});
export type PublicTunnelSettings = z.infer<typeof PublicTunnelSettingsSchema>;

export const PublicTunnelUpdateSchema = PublicTunnelSettingsSchema.partial().extend({
  authToken: z.string().min(1).max(4096).refine(
    (value) => Boolean(value.trim()) && !/[\r\n]/.test(value),
    { message: 'FRP token must be non-blank and single-line' },
  ).optional(),
});
export type PublicTunnelUpdate = z.infer<typeof PublicTunnelUpdateSchema>;

export const PublicTunnelStatusSchema = z.object({
  settings: PublicTunnelSettingsSchema,
  hasToken: z.boolean(),
  running: z.boolean(),
  pid: z.number().int().nullable(),
  lastError: z.string().nullable(),
  lastExitCode: z.number().int().nullable(),
  configDir: z.string(),
});
export type PublicTunnelStatus = z.infer<typeof PublicTunnelStatusSchema>;
