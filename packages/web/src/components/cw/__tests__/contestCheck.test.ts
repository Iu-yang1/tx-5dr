import {describe,it,expect} from 'vitest';
import {parseMasterScp,parseCallHistory,checkCandidates} from '../contestCheck';
describe('local Check and SCP',()=>{
  it('distinguishes exact, partial and one-edit candidates',()=>{
    expect(checkCandidates('JA1ABC',parseMasterScp('JA1ABC\nJA1ABCD\nJA1ABD\nDL1XYZ\nJA1ABC')).map(x=>x.kind)).toEqual(['exact','partial','near']);
    expect(checkCandidates('JA',['JA1ABC'])).toEqual([]);
  });
  it('imports explicit CQ zone history and rejects malformed rows',()=>{
    expect(parseCallHistory('Call,Zone\nJA1ABC,25\nK1ABC,05\nDL1ABC,41')).toEqual([{call:'JA1ABC',zone:'25'},{call:'K1ABC',zone:'05'}]);
  });
});
