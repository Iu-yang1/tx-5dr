import { describe, it, expect } from 'vitest';
import { projectJttyTranscript } from './JttyReceiveTerminal';
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
});
