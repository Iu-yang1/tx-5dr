import { createSocket, type Socket } from 'node:dgram';
import type { ContestContact, ContestRadioInfo, CWContestSnapshot } from '@tx5dr/contracts';

type Fields = Record<string, string>;

/** N1MM's contact/radio packets use flat XML fields. Reject DTD/entity declarations and
 * nested content; no XML external entity or network resolution is performed. */
export function parseN1MMFlatXml(raw: string): { type: string; fields: Fields } | undefined {
  if (raw.length > 65507 || /<!DOCTYPE|<!ENTITY/i.test(raw)) return;
  const cleaned = raw.replace(/^\uFEFF?\s*<\?xml[^?]*\?>\s*/i, '').trim().replace(/^\uFEFF/, '');
  const match = /^<([a-z][\w]*)\s*>([\s\S]*)<\/\1\s*>$/i.exec(cleaned);
  if (!match) return;
  const fields: Fields = Object.create(null);
  const body = match[2];
  const tag = /<([a-z][\w]*)\s*>([^<]*)<\/\1\s*>|<([a-z][\w]*)\s*\/>/gi;
  let previous = 0;
  for (const m of body.matchAll(tag)) {
    if (body.slice(previous, m.index).trim()) return;
    const key = (m[1] ?? m[3]).toLowerCase();
    if (Object.prototype.hasOwnProperty.call(fields, key)) return;
    fields[key] = (m[2] ?? '').replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (entity, name: string) => {
      const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
      if (name[0] !== '#') return entities[name.toLowerCase()] ?? entity;
      const code = name[1]?.toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : entity;
    }).trim();
    previous = (m.index ?? 0) + m[0].length;
  }
  if (body.slice(previous).trim() || fields.app?.toUpperCase() !== 'N1MM') return;
  return { type: match[1].toLowerCase(), fields };
}

function hz(value?: string): number | undefined {
  if (!value || !/^\d+$/.test(value)) return;
  const n = Number(value) * 10;
  return Number.isSafeInteger(n) && n >= 1000 && n <= 10_000_000_000 ? n : undefined;
}
function isCQWW(name?: string): boolean {
  return (name ?? '').toUpperCase().replace(/[^A-Z]/g, '') === 'CQWWCW';
}
function call(value?: string): string { return (value ?? '').toUpperCase(); }
function bool(value?: string): boolean { return /^(true|1)$/i.test(value ?? ''); }
function integer(value?: string): number | undefined {
  if (!value || !/^-?\d+$/.test(value)) return;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : undefined;
}

export class N1MMContestReceiver {
  private socket?: Socket;
  private listening = false;
  private error?: string;
  private radio?: ContestRadioInfo;
  private lookup?: CWContestSnapshot['lookup'];
  private contacts = new Map<string, ContestContact>();
  constructor(private readonly config: { enabled: boolean; bind: string; port: number; stationCall: string; stationName?: string }) {}

  start(): void {
    if (!this.config.enabled || this.socket) return;
    const socket = createSocket('udp4');
    this.socket = socket;
    socket.on('error', error => {
      this.error = error.message;
      this.listening = false;
      if (this.socket === socket) this.socket = undefined;
      try { socket.close(); } catch { /* already closed */ }
    });
    socket.on('listening', () => { this.listening = true; this.error = undefined; });
    socket.on('message', data => { this.ingest(data.toString('utf8')); });
    try { socket.bind(this.config.port, this.config.bind); }
    catch (error) {
      this.error = String(error);
      this.socket = undefined;
      try { socket.close(); } catch { /* already closed */ }
    }
  }

  close(): void {
    const socket = this.socket;
    this.socket = undefined;
    this.listening = false;
    if (socket) { try { socket.close(); } catch { /* already closed */ } }
  }

  /** Passive projection only: never writes to the contest log or controls RF. */
  ingest(xml: string, now = Date.now()): void {
    const packet = parseN1MMFlatXml(xml);
    if (!packet) return;
    const { type, fields: f } = packet;
    const stationCall = call(f.mycall);
    if (!stationCall || (this.config.stationCall && stationCall !== call(this.config.stationCall))) return;
    // On a distributed team, every computer may report the same contest call.
    // Keep local radio/entry state separate from the team contact projection.
    if ((type === 'radioinfo' || type === 'lookupinfo') && this.config.stationName &&
        call(f.stationname) !== call(this.config.stationName)) return;
    if (type === 'radioinfo') {
      const frequencyHz = hz(f.freq);
      if (!frequencyHz || f.mode?.toUpperCase() !== 'CW' || (f.radionr && f.radionr !== '1')) return;
      this.radio = { station: f.stationname ?? '', stationCall, operator: call(f.opcall),
        radioNr: 1, frequencyHz, txFrequencyHz: hz(f.txfreq), mode: 'CW',
        running: bool(f.isrunning), transmitting: bool(f.istransmitting), receivedAt: now };
      return;
    }
    if (type === 'lookupinfo') {
      if (isCQWW(f.contestname) && call(f.call)) this.lookup = { call: call(f.call), zone: f.zone ?? '', receivedAt: now };
      return;
    }
    const id = f.id?.trim();
    if (!id || id.length > 128 || !f.contestnr) return;
    const key = stationCall + ':' + f.contestnr + ':' + id;
    if (type === 'contactdelete') {
      this.contacts.delete(key);
      return;
    }
    if (!['contactinfo', 'contactreplace'].includes(type) || !isCQWW(f.contestname) || f.mode?.toUpperCase() !== 'CW') return;
    const frequencyHz = hz(f.rxfreq);
    if (!frequencyHz || !call(f.call) || !f.timestamp) return;
    this.contacts.set(key, { id, contestNr: f.contestnr, station: f.stationname ?? '',
      stationCall, operator: call(f.operator), call: call(f.call), timestamp: f.timestamp,
      frequencyHz, mode: 'CW', band: f.band ?? '', rstSent: f.snt ?? '', rstReceived: f.rcv ?? '',
      zoneSent: f.sentexchange || f.sntnr || '', zoneReceived: f.zone || f.rcvnr || '',
      points: integer(f.points) });
  }

  snapshot(): CWContestSnapshot {
    return { enabled: this.config.enabled, listening: this.listening, bind: this.config.bind,
      port: this.listening && this.socket ? this.socket.address().port : this.config.port,
      stationCall: this.config.stationCall, error: this.error,
      radio: this.radio, lookup: this.lookup, observedContacts: this.contacts.size,
      contacts: [...this.contacts.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 100) };
  }
}
