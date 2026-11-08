import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { createEphemeralTurnIceServer } from '../RtcTurnCredentials.js';

describe('ephemeral TURN credentials', () => {
  const env = {
    RTC_DATA_AUDIO_TURN_URL: 'turns:turn.example.com:5349?transport=tcp',
    RTC_DATA_AUDIO_TURN_SHARED_SECRET: 'a'.repeat(48),
    RTC_DATA_AUDIO_TURN_TTL_SECONDS: '3600',
  };

  it('is opt-in and returns no credentials unless configured', () => {
    expect(createEphemeralTurnIceServer({})).toBeNull();
    expect(createEphemeralTurnIceServer({ RTC_DATA_AUDIO_TURN_URL: env.RTC_DATA_AUDIO_TURN_URL })).toBeNull();
  });

  it('creates coturn REST shared-secret credentials with a bounded expiry', () => {
    const result = createEphemeralTurnIceServer(env, 1_700_000_000_000, 'abc-123');
    expect(result?.urls).toBe(env.RTC_DATA_AUDIO_TURN_URL);
    expect(result?.username).toBe('1700003600:tx5dr-abc-123');
    expect(result?.credential).toBe(createHmac('sha1', env.RTC_DATA_AUDIO_TURN_SHARED_SECRET).update(result!.username!).digest('base64'));
  });

  it('rejects invalid URLs or undersized secrets without leaking values', () => {
    expect(() => createEphemeralTurnIceServer({ ...env, RTC_DATA_AUDIO_TURN_URL: 'http://example.com' })).toThrow('rtc_invalid_turn_url');
    expect(() => createEphemeralTurnIceServer({ ...env, RTC_DATA_AUDIO_TURN_SHARED_SECRET: 'abc' })).toThrow('rtc_turn_secret_too_short');
  });
});
