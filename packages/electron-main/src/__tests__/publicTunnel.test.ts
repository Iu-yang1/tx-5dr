import { mkdtemp, readFile, rm, writeFile, chmod, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PUBLIC_TUNNEL_SETTINGS,
  PublicTunnelManager,
  renderFrpcToml,
  validateFrpAuthToken,
  validatePublicTunnelSettings,
} from '../publicTunnel.js';

const settings = {
  ...DEFAULT_PUBLIC_TUNNEL_SETTINGS,
  frpcPath: path.resolve(process.execPath),
  serverHost: 'tunnel.example.com',
  publicHost: 'radio.example.com',
  trustedCaFile: path.resolve('/tmp/ca.crt'),
};

describe('isolated public tunnel configuration', () => {
  it('does not enable autostart or expose a tunnel by default', () => {
    expect(DEFAULT_PUBLIC_TUNNEL_SETTINGS.autoStart).toBe(false);
    expect(DEFAULT_PUBLIC_TUNNEL_SETTINGS.serverHost).toBe('');
  });

  it('builds a verified FRP TLS connection and separate web/UDP proxies', () => {
    const token = 'S'.repeat(40);
    const file = renderFrpcToml(settings, token, 8077);
    expect(file).toContain('transport.tls.trustedCaFile');
    expect(file).toContain('localPort = 8077');
    expect(file).toContain('remotePort = 18076');
    expect(file).toContain('remotePort = 50110');
    expect(file).not.toContain('tls.enable = false');
    expect(file).not.toContain('tls.skipVerify');
    expect(file).toContain(token);
  });

  it('defaults to system CA verification when no custom CA is used', () => {
    const file = renderFrpcToml({ ...settings, trustedCaFile: '' }, 'S'.repeat(40), 8076);
    expect(file).toContain('transport.tls.useSystemCa = true');
  });

  it('rejects unsafe or ambiguous input', () => {
    expect(() => validatePublicTunnelSettings({ ...settings, serverHost: 'https://invalid.example' })).toThrow();
    expect(() => validatePublicTunnelSettings({ ...settings, remoteWebPort: 0 })).toThrow();
    expect(() => renderFrpcToml(settings, '', 8076)).toThrow('tunnel_token_invalid');
    expect(() => renderFrpcToml(settings, '   ', 8076)).toThrow('tunnel_token_invalid');
    expect(() => validateFrpAuthToken('abc\n123')).toThrow('tunnel_token_invalid');
  });

  it('accepts any nonempty single-line existing frps token without requiring changes on the VPS', () => {
    const shortToken = 'x';
    expect(validateFrpAuthToken(shortToken)).toBe(shortToken);
    expect(renderFrpcToml(settings, shortToken, 8076)).toContain('auth.token = "x"');
    expect(renderFrpcToml(settings, ' existing frps secret ', 8076))
      .toContain('auth.token = " existing frps secret "');
  });

  it('persists token privately and never echoes it in status', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'tx5dr-frpc-test-'));
    try {
      const manager = new PublicTunnelManager(root);
      const token = 'abc';
      const status = await manager.save({ ...settings, authToken: token });
      expect(status.hasToken).toBe(true);
      expect(status.settings).not.toHaveProperty('authToken');
      expect(JSON.stringify(status)).not.toContain(token);
      const onDisk = await readFile(path.join(root, 'public-tunnel', 'frpc.token'), 'utf8');
      expect(onDisk).toBe(token);
      const preserved = await manager.save({ ...settings, authToken: '' });
      expect(preserved.hasToken).toBe(true);
      expect(await readFile(path.join(root, 'public-tunnel', 'frpc.token'), 'utf8')).toBe(token);
      if (process.platform !== 'win32') {
        const perms = (await stat(path.join(root, 'public-tunnel', 'frpc.token'))).mode & 0o777;
        expect(perms).toBe(0o600);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
