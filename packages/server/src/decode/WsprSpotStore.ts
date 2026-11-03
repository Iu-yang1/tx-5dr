import type { DigitalRxEvent } from '@tx5dr/contracts';

export interface WsprDecodedSpot {
  slotId: string;
  receivedAtMs: number;
  callsign: string;
  grid: string;
  powerDbm: number;
  audioHz: number;
  snrDb: number;
  text: string;
}

/** Type-1 standard WSPR messages only. Compound/hashed calls require
 * additional message-type resolution; never invent their identity/grid. */
export function parseStandardWsprSpot(event: DigitalRxEvent): WsprDecodedSpot | null {
  if(event.kind!=='slot-decode'||event.mode!=='WSPR'||!event.final)return null;
  const raw=event.text.trim().toUpperCase().replace(/\s+/g,' ');
  const parts=/^([A-Z0-9/]{3,16}) ([A-R]{2}[0-9]{2}) (\d{1,2})$/.exec(raw);
  if(!parts)return null;
  const powerDbm=Number(parts[3]);
  if(!Number.isInteger(powerDbm)||powerDbm<0||powerDbm>60)return null;
  if(!Number.isFinite(event.frequencyHz)||event.frequencyHz<0||event.frequencyHz>6000)return null;
  if(!Number.isFinite(event.snrDb)||!Number.isSafeInteger(event.timestampMs))return null;
  return {
    slotId:event.slotId,receivedAtMs:event.timestampMs,callsign:parts[1],
    grid:parts[2],powerDbm,audioHz:event.frequencyHz,
    snrDb:event.snrDb,text:raw,
  };
}

/** Bounded in-memory local WSPR spot display; intentionally no uploads to
 * PSK Reporter or WSPRnet. That requires explicit account/consent and
 * accurate RF dial calibration, which are not established by AF alone. */
export class WsprSpotStore {
  private readonly spots:WsprDecodedSpot[]=[];
  private readonly dedup=new Set<string>();
  constructor(private readonly limit=200){
    if(!Number.isInteger(limit)||limit<1||limit>5000)throw new Error('Invalid WSPR spot limit');
  }
  add(event:DigitalRxEvent):boolean {
    const parsed=parseStandardWsprSpot(event);
    if(!parsed)return false;
    const key=[parsed.slotId,parsed.callsign,parsed.grid,parsed.powerDbm,
      Math.round(parsed.audioHz)].join('|');
    if(this.dedup.has(key))return false;
    this.dedup.add(key);
    this.spots.push(parsed);
    if(this.spots.length>this.limit) {
      const removed=this.spots.shift()!;
      this.dedup.delete([removed.slotId,removed.callsign,removed.grid,
        removed.powerDbm,Math.round(removed.audioHz)].join('|'));
    }
    return true;
  }
  list():WsprDecodedSpot[] {return this.spots.map(s=>({...s})).reverse();}
  clear():void {this.spots.length=0;this.dedup.clear();}
}
