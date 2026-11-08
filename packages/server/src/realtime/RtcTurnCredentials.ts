import { createHmac, randomUUID } from 'node:crypto';
import type { RealtimeIceServerConfig } from '@tx5dr/contracts';

// coturn REST-API ephemeral HMAC credentials. Do not expose shared secrets in
// connectivity hints, configuration status, or routine logging.
export function createEphemeralTurnIceServer(
  env: NodeJS.ProcessEnv = process.env,
  nowMs = Date.now(),
  nonce: string = randomUUID(),
): RealtimeIceServerConfig | null {
  const url = env.RTC_DATA_AUDIO_TURN_URL?.trim() ?? '';
  const secret = env.RTC_DATA_AUDIO_TURN_SHARED_SECRET ?? '';
  if (!url || !secret) return null;
  if (!/^turns?:[a-zA-Z0-9.-]+(?::[0-9]{1,5})?(?:\?transport=(?:udp|tcp))?$/.test(url)) {
    throw new Error('rtc_invalid_turn_url');
  }
  if (secret.length < 32 || /[\r\n]/.test(secret)) throw new Error('rtc_turn_secret_too_short');
  const configuredTtl = Number.parseInt(env.RTC_DATA_AUDIO_TURN_TTL_SECONDS || '', 10);
  const ttlSeconds = Number.isInteger(configuredTtl) && configuredTtl >= 600 && configuredTtl <= 86400
    ? configuredTtl : 43200;
  const expiry = Math.floor(nowMs / 1000) + ttlSeconds;
  const username = `${expiry}:tx5dr-${nonce.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 64)}`;
  const credential = createHmac('sha1', secret).update(username).digest('base64');
  return { urls: url, username, credential };
}
