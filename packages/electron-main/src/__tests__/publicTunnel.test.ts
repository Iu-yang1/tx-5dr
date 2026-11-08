import { mkdtemp, mkdir, readFile, rm, writeFile, chmod, stat } from 'node:fs/promises';
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
    expect(file).not.toContain('transport.tls.useSystemCa');
    expect(file).toContain('name = "tx5dr-web"');
    expect(file).toContain('name = "tx5dr-rtc-udp"');
    expect(file).toContain('localPort = 8077');
    expect(file).toContain('remotePort = 18076');
    expect(file).toContain('remotePort = 50110');
    expect(file).not.toContain('tls.enable = false');
    expect(file).not.toContain('tls.skipVerify');
    expect(file).toContain(token);
  });

  it('requires a trusted FRPS CA instead of emitting unsupported or insecure TLS options', () => {
    expect(() => renderFrpcToml({ ...settings, trustedCaFile: '' }, 'S'.repeat(40), 8076))
      .toThrow('tunnel_trusted_ca_required');
    const file = renderFrpcToml(settings, 'S'.repeat(40), 8076);
    expect(file).not.toContain('transport.tls.useSystemCa');
    expect(file).not.toContain('tls.skipVerify');
    expect(file).not.toContain('insecureSkipVerify');
  });

  it('renders independent user-selected TCP and UDP proxy names safely', () => {
    const file = renderFrpcToml({
      ...settings,
      webProxyName: 'remote.radio_web-1',
      rtcUdpProxyName: 'remote.radio_rtc-2',
    }, 'frps-token', 8076);
    expect(file).toContain('name = "remote.radio_web-1"');
    expect(file).toContain('name = "remote.radio_rtc-2"');
    expect(file).not.toContain('name = "tx5dr-web"');
    expect(file).not.toContain('name = "tx5dr-rtc-udp"');
  });

  it('rejects invalid, empty, duplicate or injection-looking proxy names', () => {
    for (const invalid of ['', ' whitespace', 'name with space', 'bad\\nname', 'bad"\\n[[proxies]]', '.bad', 'x'.repeat(101)]) {
      expect(() => validatePublicTunnelSettings({ ...settings, webProxyName: invalid }))
        .toThrow('tunnel_invalid_proxy_name');
    }
    expect(() => validatePublicTunnelSettings({ ...settings, rtcUdpProxyName: settings.webProxyName }))
      .toThrow('tunnel_duplicate_proxy_names');
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

  it('migrates previously saved tunnel settings using the original proxy names', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'tx5dr-frpc-legacy-'));
    try {
      const { webProxyName: _webProxyName, rtcUdpProxyName: _rtcUdpProxyName, ...legacy } = settings;
      const configDir = path.join(root, 'public-tunnel');
      await mkdir(configDir, { recursive: true });
      await writeFile(path.join(configDir, 'settings.json'), JSON.stringify(legacy));
      const manager = new PublicTunnelManager(root);
      const loaded = await manager.loadSettings();
      expect(loaded.webProxyName).toBe('tx5dr-web');
      expect(loaded.rtcUdpProxyName).toBe('tx5dr-rtc-udp');
      expect(renderFrpcToml(loaded, 'existing-secret', 8076))
        .toContain('name = "tx5dr-rtc-udp"');
      const updated = await manager.save({ webProxyName: 'my-web', rtcUdpProxyName: 'my-rtc' });
      expect(updated.settings.webProxyName).toBe('my-web');
      expect(updated.settings.rtcUdpProxyName).toBe('my-rtc');
      expect((await manager.loadSettings()).webProxyName).toBe('my-web');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
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
