import {describe,expect,it} from 'vitest';
import {WsprSpotStore,parseStandardWsprSpot} from '../WsprSpotStore.js';
import type {DigitalRxEvent} from '@tx5dr/contracts';

function event(text:string,slot='WSPR-10',af=1500):DigitalRxEvent {
  return {kind:'slot-decode',mode:'WSPR',sessionId:'rx-1',
    slotId:slot,timestampMs:1800000000000,
    frequencyHz:af,text,snrDb:-25,dtSeconds:0.5,final:true};
}
describe('local WSPR Type-1 spot store',()=>{
  it('extracts standard call/grid/power without inventing RF dial frequency',()=>{
    expect(parseStandardWsprSpot(event('K1ABC FN42 37'))).toMatchObject({
      callsign:'K1ABC',grid:'FN42',powerDbm:37,audioHz:1500,snrDb:-25,
    });
    expect(parseStandardWsprSpot(event('bi1abc ol87 20'))).toMatchObject({
      callsign:'BI1ABC',grid:'OL87',powerDbm:20,
    });
  });
  it('does not fabricate compound/hash callsigns, malformed grids or power',()=>{
    for(const raw of ['<K1ABC> 37','K1ABC XX42 37','K1ABC FN42 61',
      'K1ABC FN42 -10','CQ K1ABC FN42','K1ABC FN42 37 EXTRA']){
      expect(parseStandardWsprSpot(event(raw))).toBeNull();
    }
    expect(parseStandardWsprSpot({...event('K1ABC FN42 37'),final:false})).toBeNull();
    expect(parseStandardWsprSpot({...event('K1ABC FN42 37'),mode:'FT8'})).toBeNull();
  });
  it('deduplicates per UTC slot and AF bin and evicts bounded oldest spots',()=>{
    const store=new WsprSpotStore(2);
    expect(store.add(event('K1ABC FN42 37'))).toBe(true);
    expect(store.add(event('K1ABC FN42 37'))).toBe(false);
    expect(store.add(event('K2ABC FN32 23'))).toBe(true);
    expect(store.add(event('K3ABC FN22 20'))).toBe(true);
    expect(store.list().map(s=>s.callsign)).toEqual(['K3ABC','K2ABC']);
    expect(store.add(event('K1ABC FN42 37'))).toBe(true);
    expect(store.list().length).toBe(2);
    store.clear();
    expect(store.list()).toHaveLength(0);
  });
});
