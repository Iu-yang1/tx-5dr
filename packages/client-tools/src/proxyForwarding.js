import { isIP } from 'node:net';

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

function cleanHost(value) {
  const input = String(first(value) ?? '').trim().toLowerCase();
  if (!input || input.includes('/') || input.includes('\\') || /[\s\r\n]/.test(input)) return '';
  try { return new URL(`https://${input}`).hostname.toLowerCase().replace(/^\[|\]$/g, ''); }
  catch { return ''; }
}

function normalizedIp(value) {
  const input = String(value ?? '').trim().replace(/^::ffff:/, '');
  return isIP(input) ? input : null;
}

/**
 * Only trust the Caddy -> FRP -> loopback gateway chain when it has explicitly
 * been enabled and the edge Host matches the configured public domain.
 * Always replace forwarded headers; never propagate caller-provided chains.
 */
export function trustedForwardedContext({ headers, peerAddress, expectedEdgeHost, trustLoopback }) {
  const peer = normalizedIp(peerAddress);
  const local = peer === '127.0.0.1' || peer === '::1';
  const expected = cleanHost(expectedEdgeHost);
  const forwardedHost = cleanHost(first(headers['x-forwarded-host']) || first(headers.host));
  const proto = String(first(headers['x-forwarded-proto']) ?? '').split(',')[0].trim().toLowerCase();
  if (!trustLoopback || !local || !expected || forwardedHost !== expected || proto !== 'https') {
    return null;
  }
  // Caddy does not trust incoming X-Forwarded-For unless explicitly configured.
  // The final hop is its verified remote address, not a client-supplied prefix.
  const parts = String(first(headers['x-forwarded-for']) ?? '').split(',');
  const clientIp = normalizedIp(parts.at(-1));
  if (!clientIp) return null;
  return { proto: 'https', host: first(headers['x-forwarded-host']) || first(headers.host), clientIp };
}

export function buildSafeForwardedHeaders({ headers, peerAddress, entryScheme, targetHost, publicEdgeHost, trustLoopback, localPort }) {
  const edge = trustedForwardedContext({ headers, peerAddress, expectedEdgeHost: publicEdgeHost, trustLoopback });
  const sourceHost = edge?.host || first(headers.host) || '';
  const safeHost = String(sourceHost).replace(/[\r\n]/g, '');
  const clientIp = edge?.clientIp || normalizedIp(peerAddress) || '127.0.0.1';
  const originalPort = (() => {
    try { return new URL(`http://${safeHost}`).port; }
    catch { return ''; }
  })();
  const forwardedPort = edge ? '443' : (originalPort || String(localPort));
  const { host: _host, connection: _connection, upgrade: _upgrade, ...rest } = headers;
  // Do not accept untrusted X-Forwarded-*, Forwarded, or X-Real-IP headers.
  for (const key of Object.keys(rest)) {
    if (/^(x-forwarded-|forwarded$|x-real-ip$)/i.test(key)) delete rest[key];
  }
  return {
    ...rest,
    host: targetHost,
    'x-real-ip': clientIp,
    'x-forwarded-for': clientIp,
    'x-forwarded-proto': edge ? edge.proto : entryScheme,
    'x-forwarded-host': safeHost,
    'x-forwarded-port': forwardedPort,
  };
}
