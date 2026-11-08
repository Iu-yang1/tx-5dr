import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSafeForwardedHeaders, trustedForwardedContext } from './proxyForwarding.js';

const base = {
  peerAddress: '127.0.0.1',
  entryScheme: 'http',
  targetHost: '127.0.0.1:4000',
  publicEdgeHost: 'radio.example.com',
  localPort: 8076,
};

test('verified Caddy/FRP edge retains HTTPS origin and real visitor IP', () => {
  const result = buildSafeForwardedHeaders({
    ...base, trustLoopback: true,
    headers: {
      host: 'radio.example.com',
      'x-forwarded-host': 'radio.example.com',
      'x-forwarded-proto': 'https',
      'x-forwarded-for': '198.51.100.12',
    },
  });
  assert.equal(result['x-forwarded-proto'], 'https');
  assert.equal(result['x-real-ip'], '198.51.100.12');
  assert.equal(result['x-forwarded-port'], '443');
  assert.equal(result.host, '127.0.0.1:4000');
});

test('disabled mode refuses spoofed HTTPS and client IP even from loopback', () => {
  const result = buildSafeForwardedHeaders({
    ...base, trustLoopback: false,
    headers: {
      host: 'radio.example.com',
      'x-forwarded-host': 'radio.example.com',
      'x-forwarded-proto': 'https',
      'x-forwarded-for': '8.8.8.8',
      forwarded: 'for=8.8.8.8',
    },
  });
  assert.equal(result['x-forwarded-proto'], 'http');
  assert.equal(result['x-real-ip'], '127.0.0.1');
  assert.equal(result.forwarded, undefined);
});

test('non-loopback clients cannot impersonate proxy even when enabled', () => {
  assert.equal(trustedForwardedContext({
    headers: { host: 'radio.example.com', 'x-forwarded-proto': 'https', 'x-forwarded-for': '8.8.8.8' },
    peerAddress: '192.168.0.17', trustLoopback: true, expectedEdgeHost: 'radio.example.com',
  }), null);
});

test('public Host must match configured domain; malformed IP fails closed', () => {
  const result = buildSafeForwardedHeaders({
    ...base, trustLoopback: true,
    headers: { host: 'wrong.example.com', 'x-forwarded-proto': 'https', 'x-forwarded-for': 'not-an-ip' },
  });
  assert.equal(result['x-forwarded-proto'], 'http');
  assert.equal(result['x-real-ip'], '127.0.0.1');
});
