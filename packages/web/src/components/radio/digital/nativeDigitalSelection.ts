import type { DigitalCodecMode } from '@tx5dr/contracts';

/** A receiver-row selection never sends RF or creates logbook entries. */
export const NATIVE_DIGITAL_SELECTION_EVENT = 'tx5dr:native-digital-rx-selection';

export interface NativeDigitalSelection {
  mode: DigitalCodecMode;
  text: string;
  audioHz: number;
}

/** Only unambiguous CQ callsigns are populated automatically. */
export function extractCqCallsign(message: string): string | null {
  const tokens = message.trim().toUpperCase().split(/\s+/);
  if(tokens[0]!=='CQ')return null;
  const valid = (call:string) =>
    /^[A-Z0-9/]{3,24}$/.test(call) && /[A-Z]/.test(call) && /\d/.test(call)
    && !/^[A-R]{2}\d{2}(?:[A-X]{2})?$/.test(call);
  return tokens.slice(1,4).find(valid)??null;
}
