import { spawn } from 'node:child_process';
import { constants as osConstants, setPriority } from 'node:os';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface PublicTunnelSettings {
  frpcPath: string;
  serverHost: string;
  serverPort: number;
  publicHost: string;
  remoteWebPort: number;
  remoteUdpPort: number;
  localUdpPort: number;
  webProxyName: string;
  rtcUdpProxyName: string;
  trustedCaFile: string;
  autoStart: boolean;
}

export interface PublicTunnelUpdate extends Partial<PublicTunnelSettings> {
  authToken?: string;
}

export interface PublicTunnelStatus {
  settings: PublicTunnelSettings;
  hasToken: boolean;
  running: boolean;
  pid: number | null;
  lastError: string | null;
  lastExitCode: number | null;
  configDir: string;
}

export const DEFAULT_PUBLIC_TUNNEL_SETTINGS: PublicTunnelSettings = {
  frpcPath: '',
  serverHost: '',
  serverPort: 7000,
  publicHost: '',
  remoteWebPort: 18076,
  remoteUdpPort: 50110,
  localUdpPort: 50110,
  webProxyName: 'tx5dr-web',
  rtcUdpProxyName: 'tx5dr-rtc-udp',
  trustedCaFile: '',
  autoStart: false,
};

const hostnamePattern = /^(?=.{1,253}$)(?!-)[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*$/;
function checkHost(input: string): string {
  const host = input.trim().toLowerCase();
  if (!hostnamePattern.test(host) || host === 'localhost' || host === '0.0.0.0') throw new Error('tunnel_invalid_host');
  return host;
}
function port(n: unknown): number {
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 65535) throw new Error('tunnel_invalid_port');
  return n;
}
function toml(value: string): string {
  return JSON.stringify(value);
}

// Keep identifiers predictable, reject TOML injection and accidental duplicate proxies.
const proxyNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
function proxyName(value: string): string {
  if (typeof value !== 'string' || !proxyNamePattern.test(value)) {
    throw new Error('tunnel_invalid_proxy_name');
  }
  return value;
}

export function validatePublicTunnelSettings(settings: PublicTunnelSettings): PublicTunnelSettings {
  const next = { ...settings, serverHost: checkHost(settings.serverHost), publicHost: checkHost(settings.publicHost) };
  for (const key of ['serverPort', 'remoteWebPort', 'remoteUdpPort', 'localUdpPort'] as const) port(next[key]);
  if (next.remoteWebPort === next.remoteUdpPort) throw new Error('tunnel_web_udp_ports_conflict');
  next.webProxyName = proxyName(next.webProxyName);
  next.rtcUdpProxyName = proxyName(next.rtcUdpProxyName);
  if (next.webProxyName === next.rtcUdpProxyName) throw new Error('tunnel_duplicate_proxy_names');
  if (!path.isAbsolute(next.frpcPath)) throw new Error('tunnel_frpc_absolute_path_required');
  if (next.trustedCaFile && !path.isAbsolute(next.trustedCaFile)) throw new Error('tunnel_ca_absolute_path_required');
  return next;
}

// Match the existing frps auth.token exactly; FRP itself has no 24-char minimum.
// Blank or multiline values are not valid for this managed public tunnel.
export function validateFrpAuthToken(token: string): string {
  if (!token.trim() || /[\r\n]/.test(token) || token.length > 4096) {
    throw new Error('tunnel_token_invalid');
  }
  return token;
}

export function renderFrpcToml(settings: PublicTunnelSettings, token: string, localWebPort: number): string {
  const cfg = validatePublicTunnelSettings(settings);
  validateFrpAuthToken(token);
  port(localWebPort);
  // In FRP < 0.72, omitting trustedCaFile means TLS without server identity
  // verification. Never silently downgrade this public remote to unverified TLS.
  if (!cfg.trustedCaFile) throw new Error('tunnel_trusted_ca_required');
  return [
    '# Managed by TX5DR. Contains a secret: do not share this file.',
    'serverAddr = ' + toml(cfg.serverHost),
    'serverPort = ' + cfg.serverPort,
    'auth.method = "token"',
    'auth.token = ' + toml(token),
    'transport.tls.enable = true',
    'transport.tls.trustedCaFile = ' + toml(cfg.trustedCaFile),
    'transport.tls.serverName = ' + toml(cfg.serverHost),
    'transport.poolCount = 1',
    'log.to = "console"',
    'log.level = "warn"',
    '',
    '[[proxies]]',
    'name = ' + toml(cfg.webProxyName),
    'type = "tcp"',
    'localIP = "127.0.0.1"',
    'localPort = ' + localWebPort,
    'remotePort = ' + cfg.remoteWebPort,
    '',
    '[[proxies]]',
    'name = ' + toml(cfg.rtcUdpProxyName),
    'type = "udp"',
    'localIP = "127.0.0.1"',
    'localPort = ' + cfg.localUdpPort,
    'remotePort = ' + cfg.remoteUdpPort,
    '',
  ].join('\n');
}

type RunningChild = ReturnType<typeof spawn>;
export class PublicTunnelManager {
  private child: RunningChild | null = null;
  private stopping = false;
  private starting = false;
  private startGeneration = 0;
  private restartTimer: NodeJS.Timeout | null = null;
  private retries = 0;
  private lastError: string | null = null;
  private lastExitCode: number | null = null;
  private localWebPort = 8076;
  private activeSettings: PublicTunnelSettings = { ...DEFAULT_PUBLIC_TUNNEL_SETTINGS };

  constructor(private readonly configRoot: string) {}

  private get dir(): string { return path.join(this.configRoot, 'public-tunnel'); }
  private get settingsPath(): string { return path.join(this.dir, 'settings.json'); }
  private get tokenPath(): string { return path.join(this.dir, 'frpc.token'); }
  private get frpcConfigPath(): string { return path.join(this.dir, 'frpc.toml'); }

  async loadSettings(): Promise<PublicTunnelSettings> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.settingsPath, 'utf-8')) as Partial<PublicTunnelSettings>;
      return { ...DEFAULT_PUBLIC_TUNNEL_SETTINGS, ...parsed };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...DEFAULT_PUBLIC_TUNNEL_SETTINGS };
      throw error;
    }
  }

  async status(): Promise<PublicTunnelStatus> {
    const settings = await this.loadSettings();
    let hasToken = false;
    try {
      hasToken = Boolean(validateFrpAuthToken(await fs.readFile(this.tokenPath, 'utf-8')));
    } catch { /* token absent or invalid */ }
    return {
      settings,
      hasToken,
      running: this.child !== null && this.child.exitCode === null,
      pid: this.child?.pid ?? null,
      lastError: this.lastError,
      lastExitCode: this.lastExitCode,
      configDir: this.dir,
    };
  }

  async save(update: PublicTunnelUpdate): Promise<PublicTunnelStatus> {
    if (this.child || this.starting || this.restartTimer) throw new Error('tunnel_stop_before_update');
    const previous = await this.loadSettings();
    const next: PublicTunnelSettings = {
      ...previous, ...update,
      autoStart: update.autoStart === undefined ? previous.autoStart : update.autoStart === true,
    };
    delete (next as PublicTunnelSettings & { authToken?: string }).authToken;
    const validated = validatePublicTunnelSettings(next);
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    if (update.authToken !== undefined && update.authToken !== '') {
      const authToken = validateFrpAuthToken(update.authToken);
      await fs.writeFile(this.tokenPath, authToken, { mode: 0o600 });
      await fs.chmod(this.tokenPath, 0o600).catch(() => {});
    }
    await fs.writeFile(this.settingsPath, JSON.stringify(validated, null, 2) + '\n', { mode: 0o600 });
    await fs.chmod(this.settingsPath, 0o600).catch(() => {});
    this.lastError = null;
    return this.status();
  }

  async start(localWebPort: number): Promise<PublicTunnelStatus> {
    if (this.child) return this.status();
    if (this.starting) throw new Error('tunnel_already_starting');
    this.starting = true;
    const generation = ++this.startGeneration;
    try {
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null; }
    this.localWebPort = port(localWebPort);
    const settings = validatePublicTunnelSettings(await this.loadSettings());
    const token = validateFrpAuthToken(await fs.readFile(this.tokenPath, 'utf-8'));
    const executable = await fs.stat(settings.frpcPath);
    if (!executable.isFile()) throw new Error('tunnel_frpc_not_a_file');
    if (!settings.trustedCaFile) throw new Error('tunnel_trusted_ca_required');
    await fs.access(settings.trustedCaFile);
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    await fs.writeFile(this.frpcConfigPath, renderFrpcToml(settings, token, localWebPort), { mode: 0o600 });
    await fs.chmod(this.frpcConfigPath, 0o600).catch(() => {});
    if (generation !== this.startGeneration) throw new Error('tunnel_start_cancelled');
    this.stopping = false;
    this.activeSettings = settings;
    this.lastError = null;
    this.lastExitCode = null;
    const child = spawn(settings.frpcPath, ['-c', this.frpcConfigPath], {
      cwd: this.dir, windowsHide: true, shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GOMAXPROCS: '2' },
    });
    this.child = child;
    if (child.pid) {
      try { setPriority(child.pid, osConstants.priority.PRIORITY_BELOW_NORMAL); }
      catch { /* best effort; OS scheduling permissions vary */ }
    }
    const onOutput = (chunk: Buffer) => {
      const line = chunk.toString('utf8').slice(-1024).replaceAll(token, '[REDACTED]');
      if (/\b(error|failed|invalid|refused)\b/i.test(line)) this.lastError = line.trim().slice(-400);
    };
    child.stdout?.on('data', onOutput);
    child.stderr?.on('data', onOutput);
    child.once('error', (error) => { this.lastError = error.message; });
    child.once('exit', (code) => {
      if (this.child !== child) return;
      this.child = null;
      this.lastExitCode = code;
      if (!this.stopping) {
        this.lastError ||= 'frpc_exited_' + String(code);
        if (this.retries < 3) {
          const delay = 5_000 * Math.pow(2, this.retries++);
          this.restartTimer = setTimeout(() => {
            this.restartTimer = null;
            void this.start(this.localWebPort).catch((error) => { this.lastError = String(error); });
          }, delay);
          this.restartTimer.unref?.();
        }
      }
    });
    return this.status();
    } finally {
      this.starting = false;
    }
  }

  async stop(): Promise<PublicTunnelStatus> {
    this.startGeneration++;
    this.stopping = true;
    this.retries = 0;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    const child = this.child;
    this.child = null;
    if (child?.exitCode === null) {
      try { child.kill(); } catch { /* already stopped */ }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          try { child.kill('SIGKILL'); } catch { /* already stopped */ }
          resolve();
        }, 1500);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
      });
    }
    return this.status();
  }

  getPublicHostForGateway(): string | null {
    return this.activeSettings.publicHost || null;
  }
}
