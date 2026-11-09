import { describe, expect, it } from 'vitest';
import {
  encodeFtdx10ReceiverWrite,
  parseFtdx10ReceiverReply,
  FTDX10_RECEIVER_REGISTERS,
} from '../Ftdx10ReceiverCat.js';

describe('FTDX10 dedicated Roofing / Contour CAT registers', () => {
  it('keeps the Roofing relay independent of digital mode WIDTH', () => {
    expect(FTDX10_RECEIVER_REGISTERS.roofing_filter.query).toBe('RF0;');
    expect(() => encodeFtdx10ReceiverWrite('roofing_filter', 0)).toThrow();
    expect(parseFtdx10ReceiverReply('roofing_filter', Buffer.from('RF00;'))).toBeNull();
    expect(encodeFtdx10ReceiverWrite('roofing_filter', 1)).toBe('RF01;');
    expect(encodeFtdx10ReceiverWrite('roofing_filter', 2)).toBe('RF02;');
    expect(encodeFtdx10ReceiverWrite('roofing_filter', 4)).toBe('RF04;');
    expect(encodeFtdx10ReceiverWrite('roofing_filter', 5)).toBe('RF05;');
    expect(parseFtdx10ReceiverReply('roofing_filter', Buffer.from('RF06;'))).toBe(1);
    expect(parseFtdx10ReceiverReply('roofing_filter', Buffer.from('RF07;'))).toBe(2);
    expect(parseFtdx10ReceiverReply('roofing_filter', Buffer.from('RF09;'))).toBe(4);
    expect(parseFtdx10ReceiverReply('roofing_filter', Buffer.from('RF0A;'))).toBe(5);
    for (const candidate of [-1, 0, 3, 6, 12, 500, NaN]) {
      expect(() => encodeFtdx10ReceiverWrite('roofing_filter', candidate)).toThrow('not an advertised option');
    }
    expect(parseFtdx10ReceiverReply('roofing_filter', Buffer.from('RF08;'))).toBeNull();
  });

  it('encodes Contour ON/OFF, frequency, level and width according to CAT fields', () => {
    expect(encodeFtdx10ReceiverWrite('contour_enabled', 1)).toBe('CO000001;');
    expect(encodeFtdx10ReceiverWrite('contour_enabled', 0)).toBe('CO000000;');
    expect(parseFtdx10ReceiverReply('contour_enabled', Buffer.from('CO000001;'))).toBe(1);
    expect(parseFtdx10ReceiverReply('contour_enabled', Buffer.from('CO000000;'))).toBe(0);
    expect(encodeFtdx10ReceiverWrite('contour_frequency', 800)).toBe('CO010800;');
    expect(parseFtdx10ReceiverReply('contour_frequency', Buffer.from('CO013200;'))).toBe(3200);
    expect(encodeFtdx10ReceiverWrite('contour_level', -12)).toBe('EX030202-12;');
    expect(encodeFtdx10ReceiverWrite('contour_level', 5)).toBe('EX030202+05;');
    expect(parseFtdx10ReceiverReply('contour_level', Buffer.from('EX030202-12;'))).toBe(-12);
    expect(encodeFtdx10ReceiverWrite('contour_width', 11)).toBe('EX03020311;');
    expect(parseFtdx10ReceiverReply('contour_width', Buffer.from('EX03020311;'))).toBe(11);
  });

  it('rejects malformed, concatenated, unsolicited and out-of-range replies', () => {
    for (const raw of ['FA014074000;', 'CO010800;EX030202-12;', 'EX030202+05;EX030202+05;',
      'EX030202+05', 'garbageEX030202+05;', 'EX030202+99;', 'EX030202-99;', 'EX03020212;']) {
      expect(parseFtdx10ReceiverReply('contour_level', Buffer.from(raw))).toBeNull();
    }
    expect(parseFtdx10ReceiverReply('contour_level', Buffer.from('EX030202+05;\0\0'))).toBe(5);
    expect(parseFtdx10ReceiverReply('contour_frequency', Buffer.from('CO010000;'))).toBeNull();
    expect(parseFtdx10ReceiverReply('contour_enabled', Buffer.from('CO000007;'))).toBeNull();
    expect(() => encodeFtdx10ReceiverWrite('contour_level', -41)).toThrow();
    expect(() => encodeFtdx10ReceiverWrite('contour_width', 0)).toThrow();
    expect(() => encodeFtdx10ReceiverWrite('contour_frequency', 3201)).toThrow();
  });
});
