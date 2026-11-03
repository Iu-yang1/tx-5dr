import { describe, it, expect } from 'vitest';
import { extractCqCallsign } from './nativeDigitalSelection';

describe('native mode RX row selection',()=>{
  it('extracts only unambiguous CQ callsigns',()=>{
    expect(extractCqCallsign('CQ K1ABC FN42')).toBe('K1ABC');
    expect(extractCqCallsign('CQ RU AB5XS EM12')).toBe('AB5XS');
    expect(extractCqCallsign('CQ DX BG5JSU OL79')).toBe('BG5JSU');
  });
  it('does not invent target call from non-CQ or malformed traffic',()=>{
    expect(extractCqCallsign('K1ABC K2ABC -12')).toBeNull();
    expect(extractCqCallsign('CQ FN42 TEST')).toBeNull();
    expect(extractCqCallsign('')).toBeNull();
  });
});
