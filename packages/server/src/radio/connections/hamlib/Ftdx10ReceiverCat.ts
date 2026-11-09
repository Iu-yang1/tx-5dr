/**
 * FTDX10 receiver CAT registers from Yaesu CAT Operation Reference 2308-F.
 *
 * RF0 is the analogue roofing relay and is independent from SH / DSP WIDTH.
 * CO00 and CO01 are the Contour switch and centre frequency. Contour level
 * and width use EX menus, whose response is NOT transaction-identified.
 *
 * This module validates a single exact frame. A valid frame alone does not
 * prove freshness; the connection owner must quarantine a suspicious session.
 */
export type Ftdx10ReceiverControl =
  | 'roofing_filter'
  | 'contour_enabled'
  | 'contour_frequency'
  | 'contour_level'
  | 'contour_width';

interface ReceiverCatRegister {
  query: string;
  prefix: string;
  valid: (value: number) => boolean;
  encode: (value: number) => string;
  decode: (suffix: string) => number | null;
}

const numeric = (min: number, max: number, step = 1) =>
  (value: number) => Number.isInteger(value) && value >= min && value <= max
    && (value - min) % step === 0;

// Yaesu RF0 set values 1=12k, 2=3k, 4=500Hz, 5=optional 300Hz.
// The auto mode is intentionally excluded: its hardware readback is ambiguous.
const roofingSetToRead = new Map([[1, '6'], [2, '7'], [4, '9'], [5, 'A']]);
const roofingReadToSet = new Map<string, number>([...roofingSetToRead].map(([choice, code]) => [code, choice] as const));

export const FTDX10_RECEIVER_REGISTERS: Record<Ftdx10ReceiverControl, ReceiverCatRegister> = {
  roofing_filter: {
    query: 'RF0;',
    prefix: 'RF0',
    valid: (value) => roofingSetToRead.has(value),
    encode: (value) => `RF0${value};`,
    decode: (suffix) => roofingReadToSet.get(suffix) ?? null,
  },
  contour_enabled: {
    query: 'CO00;',
    prefix: 'CO00',
    valid: numeric(0, 1),
    encode: (value) => `CO00${String(value).padStart(4, '0')};`,
    decode: (suffix) => /^[0-9]{4}$/.test(suffix) && (suffix === '0000' || suffix === '0001')
      ? Number(suffix) : null,
  },
  contour_frequency: {
    query: 'CO01;',
    prefix: 'CO01',
    valid: numeric(10, 3200),
    encode: (value) => `CO01${String(value).padStart(4, '0')};`,
    decode: (suffix) => /^[0-9]{4}$/.test(suffix) && numeric(10, 3200)(Number(suffix))
      ? Number(suffix) : null,
  },
  contour_level: {
    query: 'EX030202;',
    prefix: 'EX030202',
    valid: numeric(-40, 20),
    encode: (value) => `EX030202${value >= 0 ? '+' : '-'}${String(Math.abs(value)).padStart(2, '0')};`,
    decode: (suffix) => /^[+-][0-9]{2}$/.test(suffix) && numeric(-40, 20)(Number(suffix))
      ? Number(suffix) : null,
  },
  contour_width: {
    query: 'EX030203;',
    prefix: 'EX030203',
    valid: numeric(1, 11),
    encode: (value) => `EX030203${String(value).padStart(2, '0')};`,
    decode: (suffix) => /^[0-9]{2}$/.test(suffix) && numeric(1, 11)(Number(suffix))
      ? Number(suffix) : null,
  },
};

export function encodeFtdx10ReceiverWrite(control: Ftdx10ReceiverControl, value: number): string {
  const register = FTDX10_RECEIVER_REGISTERS[control];
  if (!register.valid(value)) {
    throw new Error(`FTDX10 ${control} value is not an advertised option: ${value}`);
  }
  return register.encode(value);
}

export function parseFtdx10ReceiverReply(control: Ftdx10ReceiverControl, data: Buffer): number | null {
  const register = FTDX10_RECEIVER_REGISTERS[control];
  const reply = data.toString('ascii').replace(/\x00+$/g, '');
  if (reply.length < 3 || !reply.endsWith(';') || !reply.startsWith(register.prefix)) return null;
  // No leading garbage, concatenated frames, duplicate ACKs, or partial payload.
  const payload = reply.slice(register.prefix.length, -1);
  if (payload.includes(';') || payload.length === 0) return null;
  return register.decode(payload);
}
