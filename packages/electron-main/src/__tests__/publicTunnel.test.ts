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
};

describe('isolated public tunnel configuration', () => {
  it('does not enable autostart or expose a tunnel by default', () => {
    expect(DEFAULT_PUBLIC_TUNNEL_SETTINGS.autoStart).toBe(false);
    expect(DEFAULT_PUBLIC_TUNNEL_SETTINGS.serverHost).toBe('');
  });

  it('builds TLS-encrypted FRP with the configured web/UDP proxies', () => {
    const token = 'S'.repeat(40);
    const file = renderFrpcToml(settings, token, 8077);
    expect(file).toContain('transport.tls.enable = true');
    expect(file).not.toContain('transport.tls.trustedCaFile');
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

  it('matches the field-tested LAN FRPC transport and proxy endpoints without a CA field', () => {
    const file = renderFrpcToml({
      ...settings,
      serverHost: 'langd.space',
      publicHost: 'langd.space',
      localWebIP: '192.168.1.5',
      localWebPort: 10443,
      remoteWebPort: 18443,
      localUdpIP: '192.168.1.5',
      localUdpPort: 50110,
      remoteUdpPort: 18444,
      webProxyName: 'jvm-tx5dr-web',
      rtcUdpProxyName: 'jvm-tx5dr-rtc-udp',
      logLevel: 'info',
    }, 'redacted-fixture-token', 8076);
    expect(file).toContain('serverAddr = "langd.space"');
    expect(file).toContain('transport.tls.enable = true');
    expect(file).toContain('transport.tls.serverName = "langd.space"');
    expect(file).not.toContain('trustedCaFile');
    expect(file).not.toContain('useSystemCa');
    expect(file).toContain('log.level = "info"');
    expect(file).toMatch(/name = "jvm-tx5dr-web"\ntype = "tcp"\nlocalIP = "192.168.1.5"\nlocalPort = 10443\nremotePort = 18443/);
    expect(file).toMatch(/name = "jvm-tx5dr-rtc-udp"\ntype = "udp"\nlocalIP = "192.168.1.5"\nlocalPort = 50110\nremotePort = 18444/);
  });

  it('defaults to the automatically selected TX5DR gateway port, with independent UDP host', () => {
    const file = renderFrpcToml({ ...settings, localWebIP: '127.0.0.1', localWebPort: 0, localUdpIP: '192.168.1.5' }, 'test', 9876);
    expect(file).toContain('localPort = 9876');
    expect(file).toContain('localIP = "192.168.1.5"');
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
    expect(() => validatePublicTunnelSettings({ ...settings, localWebPort: -1 })).toThrow('tunnel_invalid_port');
    expect(() => validatePublicTunnelSettings({ ...settings, localWebPort: 65536 })).toThrow('tunnel_invalid_port');
    expect(() => validatePublicTunnelSettings({ ...settings, localWebIP: 'https://host' })).toThrow('tunnel_invalid_local_ip');
    expect(() => validatePublicTunnelSettings({ ...settings, localUdpIP: '0.0.0.0' })).toThrow('tunnel_invalid_local_ip');
    expect(() => validatePublicTunnelSettings({ ...settings, logLevel: 'trace' as never })).toThrow('tunnel_invalid_log_level');
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
      const {
        webProxyName: _webProxyName, rtcUdpProxyName: _rtcUdpProxyName,
        localWebIP: _localWebIP, localWebPort: _localWebPort, localUdpIP: _localUdpIP,
        logLevel: _logLevel, ...legacy
      } = settings;
      const configDir = path.join(root, 'public-tunnel');
      await mkdir(configDir, { recursive: true });
      await writeFile(path.join(configDir, 'settings.json'), JSON.stringify({
        ...legacy,
        trustedCaFile: '/legacy/old-ca.crt',
      }));
      const manager = new PublicTunnelManager(root);
      const loaded = await manager.loadSettings();
      expect(loaded.webProxyName).toBe('tx5dr-web');
      expect(loaded.rtcUdpProxyName).toBe('tx5dr-rtc-udp');
      expect(loaded.localWebIP).toBe('127.0.0.1');
      expect(loaded.localWebPort).toBe(0);
      expect(loaded.localUdpIP).toBe('127.0.0.1');
      expect(loaded).not.toHaveProperty('trustedCaFile');
      expect(renderFrpcToml(loaded, 'existing-secret', 8076))
        .toContain('name = "tx5dr-rtc-udp"');
      const updated = await manager.save({ webProxyName: 'my-web', rtcUdpProxyName: 'my-rtc' });
      expect(updated.settings.webProxyName).toBe('my-web');
      expect(updated.settings.rtcUdpProxyName).toBe('my-rtc');
      expect((await manager.loadSettings()).webProxyName).toBe('my-web');
      expect((await readFile(path.join(configDir, 'settings.json'), 'utf8'))).not.toContain('trustedCaFile');
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
