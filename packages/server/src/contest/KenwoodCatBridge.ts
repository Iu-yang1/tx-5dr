import { createServer, type Server, type Socket } from 'node:net';
import type { RadioController, RigctlMode } from '@tx5dr/rigctld-server';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('KenwoodCatBridge');
const modeCode: Partial<Record<RigctlMode, string>> = { LSB: '1', USB: '2', CW: '3', FM: '4', AM: '5', RTTY: '6', CWR: '7', RTTYR: '9' };
const codeMode = Object.fromEntries(Object.entries(modeCode).map(([mode, code]) => [code, mode])) as Record<string, RigctlMode>;

export interface KenwoodCatStatus {
  enabled: boolean; listening: boolean; host: string; port: number; clients: number; error?: string;
}
export interface KenwoodKeyerSpeed {
  get(): Promise<number>;
  set(wpm: number): Promise<void>;
}

/**
 * TS-590S-compatible subset for a single logical VFO (SO1V).
 * The logical A VFO is the currently selected physical VFO, not a second
 * hardware cache. Native keying is separate. Unsupported B/split commands
 * return the documented error instead of reporting invented frequencies.
 * CAT commands are always executed on the existing PhysicalRadioManager owner.
 */
export class KenwoodCatSession {
  private ownsPtt = false;
  private closed = false;
  constructor(private readonly radio: RadioController, private readonly speed: KenwoodKeyerSpeed,
    private readonly allowPtt: boolean) {}

  async command(raw: string): Promise<string> {
    if (this.closed) return '?;';
    const cmd = raw.trim().toUpperCase();
    try {
      if (cmd === 'ID') return 'ID021;';
      if (cmd === 'AI') return 'AI0;';
      if (cmd === 'AI0') return '';
      if (cmd === 'FA') return 'FA' + this.formatFrequency(await this.radio.getFrequency()) + ';';
      if (/^FA\d{11}$/.test(cmd)) {
        const hz = Number(cmd.slice(2));
        if (hz <= 0) return '?;';
        await this.radio.setFrequency(hz);
        return '';
      }
      if (cmd === 'MD') return 'MD' + this.mode(await this.radio.getMode()) + ';';
      if (/^MD[1-79]$/.test(cmd) && codeMode[cmd[2]]) {
        await this.radio.setMode(codeMode[cmd[2]], 0);
        return '';
      }
      if (cmd === 'FR' || cmd === 'FT') return cmd + '0;';
      if (cmd === 'FR0' || cmd === 'FT0') return '';
      if (cmd === 'IF') {
        const frequency = this.formatFrequency(await this.radio.getFrequency());
        const mode = this.mode(await this.radio.getMode());
        const ptt = await this.radio.getPTT();
        // The virtual interface exposes simplex, no virtual RIT/XIT, no
        // memory/scan/tone state; these fields are not a physical split API.
        return 'IF' + frequency + '     ' + '+0000' + '00' + '000' +
          (ptt ? '1' : '0') + mode + '0000000;';
      }
      if (cmd === 'KS') return 'KS' + String(await this.speed.get()).padStart(3, '0') + ';';
      if (/^KS\d{3}$/.test(cmd)) {
        const wpm = Number(cmd.slice(2));
        if (wpm < 5 || wpm > 60) return '?;';
        await this.speed.set(wpm);
        return '';
      }
      if (cmd === 'TX' || cmd === 'TX0') {
        if (!this.allowPtt) return '?;';
        if (!this.ownsPtt) {
          await this.radio.setPTT(true);
          this.ownsPtt = true;
        }
        // Close can race an in-flight hardware PTT request.
        if (this.closed) await this.releasePtt();
        return '';
      }
      if (cmd === 'RX') {
        await this.releasePtt();
        return '';
      }
      return '?;';
    } catch (error) {
      logger.debug('Kenwood CAT command failed', { command: cmd.slice(0, 2), error: String(error) });
      return '?;';
    }
  }

  private formatFrequency(hz: number): string {
    if (!Number.isSafeInteger(hz) || hz <= 0 || hz > 99_999_999_999) throw new Error('Invalid frequency');
    return String(hz).padStart(11, '0');
  }
  private mode(info: Awaited<ReturnType<RadioController['getMode']>>): string {
    const code = modeCode[info.mode];
    if (!code) throw new Error('Unsupported virtual mode');
    return code;
  }
  private async releasePtt(): Promise<void> {
    if (!this.ownsPtt) return;
    await this.radio.setPTT(false);
    this.ownsPtt = false;
  }
  markClosed(): void { this.closed = true; }
  async close(): Promise<void> {
    this.markClosed();
    await this.releasePtt();
  }
}

export class KenwoodCatBridge {
  private server?: Server;
  private sockets = new Set<Socket>();
  private tasks = new Set<Promise<void>>();
  private lastError?: string;
  constructor(private readonly config: { enabled: boolean; host: string; port: number; allowPtt: boolean },
    private readonly controller: () => RadioController, private readonly speed: KenwoodKeyerSpeed) {}

  async start(): Promise<void> {
    if (!this.config.enabled || this.server) return;
    const server = createServer(socket => this.connect(socket));
    this.server = server;
    await new Promise<void>(resolve => {
      server.on('error', error => {
        this.lastError = error.message;
        logger.warn('Kenwood CAT listener error', { error: error.message });
        if (!server.listening && this.server === server) this.server = undefined;
        resolve();
      });
      server.listen(this.config.port, this.config.host, () => {
        this.lastError = undefined;
        resolve();
      });
    });
  }

  private connect(socket: Socket): void {
    this.sockets.add(socket);
    socket.setNoDelay(true);
    const session = new KenwoodCatSession(this.controller(), this.speed, this.config.allowPtt);
    let input = '';
    let pending = 0;
    let tail = Promise.resolve();
    const onClose = () => {
      this.sockets.delete(socket);
      session.markClosed();
      const cleanup = tail.then(() => session.close()).catch(error => {
        logger.warn('Kenwood CAT session cleanup failed', { error: String(error) });
      });
      this.tasks.add(cleanup);
      void cleanup.finally(() => this.tasks.delete(cleanup));
    };
    socket.on('error', () => socket.destroy());
    socket.once('close', onClose);
    socket.on('data', bytes => {
      input += bytes.toString('ascii');
      let delimiter: number;
      while ((delimiter = input.indexOf(';')) >= 0) {
        const command = input.slice(0, delimiter);
        input = input.slice(delimiter + 1);
        if (command.length > 128 || pending >= 128) { socket.destroy(); return; }
        pending++;
        tail = tail.then(async () => {
          if (socket.destroyed) return;
          const answer = await session.command(command);
          if (answer && !socket.destroyed) socket.write(answer);
        }).catch(error => {
          logger.debug('Kenwood CAT response failed', { error: String(error) });
          socket.destroy();
        }).finally(() => { pending--; });
      }
      if (input.length > 128) socket.destroy();
    });
  }

  status(): KenwoodCatStatus {
    const address = this.server?.address();
    return { enabled: this.config.enabled, listening: this.server?.listening ?? false,
      host: this.config.host, port: typeof address === 'object' && address ? address.port : this.config.port,
      clients: this.sockets.size, error: this.lastError };
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    const sockets = [...this.sockets];
    const closed = sockets.map(socket => new Promise<void>(resolve => socket.once('close', () => resolve())));
    sockets.forEach(socket => socket.destroy());
    await Promise.all(closed);
    await Promise.all([...this.tasks]);
    if (server?.listening) await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
