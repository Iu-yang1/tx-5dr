import { describe, expect, it } from 'vitest';
import { cqwwMessages } from '../contestMessages';
describe('CQWW macros', () => {
  const context = { stationCall: 'BG8GLR', hisCall: 'JA1ABC', sentZone: '24', run: true };
  it('uses the contest identity, not the operator, in RUN and S&P', () => {
    expect(cqwwMessages(context).slice(0, 3).map(m => m.text)).toEqual(['CQ TEST BG8GLR BG8GLR TEST', 'JA1ABC 5NN 24', 'TU BG8GLR']);
    expect(cqwwMessages({ ...context, run: false }).slice(0, 3).map(m => m.text)).toEqual(['BG8GLR', '5NN 24', 'TU']);
  });
  it('does not create a callsign or invalid exchange from missing input', () => {
    const m = cqwwMessages({ ...context, stationCall: '', hisCall: '599', sentZone: '41' });
    expect(m[0].text).toBe(''); expect(m[1].text).toBe(''); expect(m[4].text).toBe('');
  });
});
