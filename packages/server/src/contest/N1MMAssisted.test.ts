import { describe,it,expect } from 'vitest';
import { N1MMContestReceiver,parseN1MMScore } from './N1MMContestReceiver.js';
describe('N1MM assistance broadcasts',()=>{
  it('parses spots in kHz and preserves official status, then deletes the spot',()=>{
    const r=new N1MMContestReceiver({enabled:false,bind:'127.0.0.1',port:12060,stationCall:'BG8GLR'});
    const packet='<spot><app>N1MM</app><StationName>CONTEST-PC</StationName><dxcall>JA1ABC</dxcall><frequency>14025.3</frequency><spottercall>RBN</spottercall><mode>CW</mode><action>add</action><status>single mult</status><comment>CW 24 WPM</comment></spot>';
    r.ingest(packet);expect(r.snapshot().spots?.[0]).toMatchObject({call:'JA1ABC',frequencyHz:14025300,status:'single mult'});
    r.ingest(packet.replace('<action>add','<action>delete'));expect(r.snapshot().spots).toEqual([]);
  });
  it('uses authoritative nested score and band breakdown, not local estimated score',()=>{
    const xml='<dynamicresults><contest>CQ-WW-CW</contest><call>BG8GLR</call><breakdown><qso band="20" mode="CW">10</qso><mult band="20" mode="CW" type="zone">4</mult></breakdown><score>123</score></dynamicresults>';
    expect(parseN1MMScore(xml,'BG8GLR',10)).toMatchObject({score:123,breakdown:[{kind:'qso',band:'20',value:10},{kind:'mult',band:'20',type:'zone',value:4}]});
    expect(parseN1MMScore(xml,'BG1ABC',10)).toBeUndefined();
  });
});
