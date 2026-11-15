import { describe, it, expect } from 'vitest';
import { jttyCallsignToken, projectJttyTranscript } from './JttyReceiveTerminal';
describe('JTTY streaming transcript', () => {
  it('deduplicates revisions without converting text to FT8-like slots', () => {
    const base = {
      kind:'message-update' as const,mode:'JTTY' as const,sessionId:'s',
      timestampMs:1000,frequencyHz:1700,messageId:'a',state:'growing' as const,
    };
    const items = projectJttyTranscript([
      {...base,revision:0,text:'CQ'},
      {...base,revision:1,text:'CQ TEST'},
      {...base,messageId:'b',revision:0,timestampMs:1100,text:'DE BG5JSU'},
    ]);
    expect(items).toHaveLength(2);
    expect(items[0].text).toBe('CQ TEST');
    expect(items[1].text).toBe('DE BG5JSU');
  });
  it('keeps sessions separate and refuses to roll back an older revision', () => {
    const base = {kind: 'message-update' as const, mode: 'JTTY' as const,
      sessionId: 'session-a', messageId: 'line-1', timestampMs: 100,
      frequencyHz: 1700, state: 'growing' as const};
    const values = projectJttyTranscript([
      {...base, revision: 2, text: 'CQ DE BG5JSU'},
      {...base, revision: 1, text: 'CQ'},
      {...base, sessionId: 'session-b', revision: 0, text: 'CQ DE JA1ABC'},
    ]);
    expect(values).toHaveLength(2);
    expect(values[0].text).toBe('CQ DE BG5JSU');
  });

  it('recognises station callsigns but not grid locators and signal reports', () => {
    expect(jttyCallsignToken('BG5JSU,')).toBe('BG5JSU');
    expect(jttyCallsignToken('JA1ABC')).toBe('JA1ABC');
    expect(jttyCallsignToken('PM95')).toBeNull();
    expect(jttyCallsignToken('599')).toBeNull();
  });
});
