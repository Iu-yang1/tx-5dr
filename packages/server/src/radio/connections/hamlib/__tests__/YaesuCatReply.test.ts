import { describe, expect, it } from 'vitest';
import { parseSingleYaesuNumericReply } from '../YaesuCatReply.js';

describe('Yaesu CAT EX response validation', () => {
  const parse = (wire: string) => parseSingleYaesuNumericReply(Buffer.from(wire, 'ascii'), 'EX010415');

  it('accepts only a complete, unique matching EX frame', () => {
    expect(parse('EX0104151;')).toBe(1);
    expect(parse('FA014074000;EX0104150;')).toBeNull();
    expect(parse('EX0104150;FA014074000;')).toBeNull();
    expect(parse('EX0104151;EX0104150;')).toBeNull();
  });

  it('rejects a stale command mismatch, malformed numeric field, or partial reply', () => {
    expect(parse('EX0104161;')).toBeNull();
    expect(parse('EX010415;')).toBeNull();
    expect(parse('EX01041512;')).toBeNull();
    expect(parse('EX010415X;')).toBeNull();
    expect(parse('EX0104151')).toBeNull();
    expect(parse('EX0104151;EX010415')).toBeNull();
  });

  it('accepts trailing native NUL padding without accepting a second reply', () => {
    expect(parseSingleYaesuNumericReply(
      Buffer.concat([Buffer.from('EX0104151;', 'ascii'), Buffer.alloc(2)]),
      'EX010415',
    )).toBe(1);
    expect(parseSingleYaesuNumericReply(Buffer.from('EX0104151;'), 'bad')).toBeNull();
  });
});
