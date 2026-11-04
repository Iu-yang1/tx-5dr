import { describe, expect, it } from 'vitest';
import { formatDecodedAfHz, formatDecodedDt, formatDecodedSnr } from './decodeValueFormat';
describe('decoded FT8/FT4/native measurement formatting', () => {
  it('rounds SNR dB and audio frequency to fixed cell widths', () => {
    expect(formatDecodedSnr(-8.9539488)).toBe('-9');
    expect(formatDecodedSnr(3.6)).toBe('4');
    expect(formatDecodedSnr('TX')).toBe('TX');
    expect(formatDecodedAfHz(2714.5042)).toBe('2715');
    expect(formatDecodedAfHz(Number.NaN)).toBe('—');
  });
  it('retains the WSJT-X-style 0.1 second DT resolution', () => {
    expect(formatDecodedDt(-1.1234)).toBe('-1.1');
    expect(formatDecodedDt('-')).toBe('-');
  });
});
