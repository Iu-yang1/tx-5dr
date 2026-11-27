import { createSocket, type Socket } from 'node:dgram';
import type { ContestContact, ContestRadioInfo, CWContestSnapshot, ContestSpot, ContestScore } from '@tx5dr/contracts';

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

// Score broadcasts have a distinct nested schema and no app field. Only
// inspect the documented score fields; reject DTD/ENTITY and never resolve XML.
export function parseN1MMScore(xml:string,stationCall:string,now:number):ContestScore|undefined{
  if(xml.length>65507||/<!DOCTYPE|<!ENTITY/i.test(xml)||!/<dynamicresults[\s>]/i.test(xml))return;
  const field=(name:string)=>new RegExp('<'+name+'>([^<]*)</'+name+'>','i').exec(xml)?.[1]?.trim();
  if(!isCQWW(field('contest'))||!field('call')||(stationCall&&call(field('call'))!==call(stationCall)))return;
  const score=integer(field('score')); if(score===undefined||score<0)return;
  const breakdown:ContestScore['breakdown']=[];
  const body=/<breakdown>([\s\S]*?)<\/breakdown>/i.exec(xml)?.[1]??'';
  for(const match of body.matchAll(/<(qso|point|mult)\s+([^>]+)>(\d+)<\/\1>/gi)){
    const attr=(key:string)=>new RegExp('(?:^|\\s)'+key+'\\s*=\\s*["\x27]([^"\x27]*)["\x27]','i').exec(match[2])?.[1];
    breakdown.push({kind:match[1].toLowerCase(),band:attr('band')??'',mode:attr('mode')??'',type:attr('type'),value:Number(match[3])});
  }
  return {score,timestamp:field('timestamp')??'',receivedAt:now,breakdown};
}
export class N1MMContestReceiver {
  private socket?: Socket;
  private listening = false;
  private error?: string;
  private radio?: ContestRadioInfo;
  private lookup?: CWContestSnapshot['lookup'];
  private contacts = new Map<string, ContestContact>();
  private spots = new Map<string,ContestSpot>();
  private score?:ContestScore;
  private application?: CWContestSnapshot['application'];
  private mirrorResetAt?: number;
  private lastContactAt?: number;
  constructor(private readonly config: { enabled: boolean; bind: string; port: number; stationCall: string; stationName?: string }) {}

  async startAsync():Promise<void>{
    this.start();
    const socket=this.socket;
    if(!socket||this.listening)return;
    await new Promise<void>(resolve=>{
      const done=()=>{socket.off('listening',done);socket.off('error',done);socket.off('close',done);resolve();};
      socket.once('listening',done);socket.once('error',done);socket.once('close',done);
    });
  }
  async closeAsync():Promise<void>{
    const socket=this.socket;
    this.socket=undefined;this.listening=false;
    if(socket)await new Promise<void>(resolve=>{
      try{socket.close(()=>resolve());}catch{resolve();}
    });
  }
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

  /** Discard the local projection before an explicit N1MM full-log rebroadcast. */
  resetMirror(now = Date.now()): void {
    this.contacts.clear();
    this.lastContactAt = undefined;
    this.mirrorResetAt = now;
  }

  /** Passive projection only: never writes to the contest log or controls RF. */
  ingest(xml: string, now = Date.now()): void {
    const score=parseN1MMScore(xml,this.config.stationCall,now);
    if(score){this.score=score;return;}
    const packet = parseN1MMFlatXml(xml);
    if (!packet) return;
    const { type, fields: f } = packet;
    if(type==='spot'){
      const dx=call(f.dxcall),frequencyHz=Math.round(Number(f.frequency)*1000);
      if(!dx||!Number.isSafeInteger(frequencyHz)||frequencyHz<1000||frequencyHz>10_000_000_000||f.mode?.toUpperCase()!=='CW')return;
      const key=dx+':'+frequencyHz;
      for (const [id, spot] of this.spots) {
        if (now - spot.receivedAt >= 30 * 60 * 1000) this.spots.delete(id);
      }
      if(f.action?.toLowerCase()==='delete'){this.spots.delete(key);return;}
      if(f.action?.toLowerCase()!=='add')return;
      this.spots.set(key,{call:dx,frequencyHz,spotter:call(f.spottercall),timestamp:f.timestamp??'',status:f.status??'',comment:f.comment??'',receivedAt:now});
      return;
    }
    const stationCall = call(f.mycall);
    if (!stationCall || (this.config.stationCall && stationCall !== call(this.config.stationCall))) return;
    // On a distributed team, every computer may report the same contest call.
    // Keep local radio/entry state separate from the team contact projection.
    if ((type === 'radioinfo' || type === 'lookupinfo' || type === 'appinfo') && this.config.stationName &&
        call(f.stationname) !== call(this.config.stationName)) return;
    if (type === 'appinfo') {
      if (!f.dbname || !f.contestnr || !f.contestname) return;
      const next = { database: f.dbname, contestNr: f.contestnr, contest: f.contestname, station: f.stationname ?? '', receivedAt: now };
      const previous = this.application;
      if (previous && previous.station === next.station && (previous.database !== next.database || previous.contestNr !== next.contestNr || previous.contest !== next.contest)) {
        this.resetMirror(now);
        this.score = undefined;
        this.lookup = undefined;
        this.spots.clear();
      }
      this.application = next;
      return;
    }
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
    // ID is globally unique; contestnr is scoped to the sender's database.
    // All Computers can forward the same QSO under a different contestnr.
    const key = stationCall + ':' + id;
    if (this.application && !isCQWW(this.application.contest)) return;
    if (type === 'contactdelete') {
      this.contacts.delete(key);
      this.lastContactAt = now;
      return;
    }
    if (!['contactinfo', 'contactreplace'].includes(type) || !isCQWW(f.contestname) || f.mode?.toUpperCase() !== 'CW') return;
    const frequencyHz = hz(f.rxfreq);
    if (!frequencyHz || !call(f.call) || !f.timestamp) return;
    this.lastContactAt = now;
    this.contacts.set(key, { id, contestNr: f.contestnr, station: f.stationname ?? '',
      stationCall, operator: call(f.operator), call: call(f.call), timestamp: f.timestamp,
      frequencyHz, mode: 'CW', band: f.band ?? '', rstSent: f.snt ?? '', rstReceived: f.rcv ?? '',
      zoneSent: f.sentexchange || f.sntnr || '', zoneReceived: f.zone || f.rcvnr || '',
      points: integer(f.points), countryPrefix:f.countryprefix || undefined });
  }

  snapshot(queryCall?:string): CWContestSnapshot {
    const now=Date.now();const observed=[...this.contacts.values()];
    const bands=new Map<string,{qsos:number;zones:Set<string>;countries:Set<string>}>();
    let last10=0,last60=0;
    for(const q of observed){
      let band=bands.get(q.band);if(!band){band={qsos:0,zones:new Set(),countries:new Set()};bands.set(q.band,band);}
      band.qsos++;if(q.zoneReceived)band.zones.add(q.zoneReceived);if(q.countryPrefix)band.countries.add(q.countryPrefix);
      const stamp=Date.parse(q.timestamp.replace(' ','T')+(q.timestamp.endsWith('Z')?'':'Z'));
      const age=now-stamp;if(age>=0&&age<3600000){last60++;if(age<600000)last10++;}
    }
    return { enabled: this.config.enabled, listening: this.listening, bind: this.config.bind,
      port: this.listening && this.socket ? this.socket.address().port : this.config.port,
      stationCall: this.config.stationCall, error: this.error,
      application: this.application, mirrorResetAt: this.mirrorResetAt, lastContactAt: this.lastContactAt,
      radio: this.radio, lookup: this.lookup, observedContacts: this.contacts.size,
      logCandidates:queryCall && queryCall.length>=3 ? [...new Set(observed.map(q=>q.call))].filter(c=>Math.abs(c.length-queryCall.length)<=1 || c.includes(call(queryCall))).slice(0,1000):[],
      workedBands:queryCall?[...new Set(observed.filter(q=>q.call===call(queryCall)).map(q=>q.band))]:[],
      rate:{last10,last60},observedBands:[...bands].map(([band,v])=>({band,qsos:v.qsos,zones:v.zones.size,countries:v.countries.size})),
      score:this.score,spots:[...this.spots.values()].filter(s=>Date.now()-s.receivedAt<30*60*1000).sort((a,b)=>a.frequencyHz-b.frequencyHz),
      contacts: observed.sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 100) };
  }
}
