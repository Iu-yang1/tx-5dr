import { describe,it,expect } from 'vitest';
import { N1MMEntryBridge } from './N1MMEntryBridge.js';
describe('N1MM Entry mailbox',()=>{
  it('coalesces edits, acknowledges actual readback and preserves local typing',()=>{
    let t=1000;const b=new N1MMEntryBridge(()=>t);
    expect(()=>b.request({call:'J',zone:''})).toThrow();
    b.agent({fields:{call:'',zone:''}});
    const old=b.request({call:'J',zone:''}).pending!;
    const next=b.request({call:'JA1ABC',zone:'25'}).pending!;
    expect(next.revision).toBeGreaterThan(old.revision);
    expect(b.agent({fields:{call:'J',zone:''},appliedRevision:old.revision}).pending).toEqual(next);
    expect(b.agent({fields:{call:'JA1ABC',zone:'25'},appliedRevision:next.revision}).pending).toBeUndefined();
    expect(b.agent({fields:{call:'K1ABC',zone:'05'}}).fields.call).toBe('K1ABC');
    b.request({call:'DL1ABC',zone:'14'});t+=3001;
    expect(b.snapshot().pending).toBeUndefined();expect(b.snapshot().online).toBe(false);
  });
});

describe('explicit N1MM actions',()=>{
  it('only accepts advertised actions, never overwrites pending one, and accepts a cleared form after LOG',()=>{
    let now=1000;const b=new N1MMEntryBridge(()=>now);const fields={call:'JA1ABC',zone:'25'};
    b.agent({fields,actions:['LOG','F1','STOP']});
    expect(()=>b.request(fields,'SPOT')).toThrow();
    const p=b.request(fields,'LOG').pending!;
    expect(()=>b.request({call:'K1ABC',zone:'05'})).toThrow();
    expect(b.agent({fields:{call:'',zone:''},appliedRevision:p.revision,actions:['LOG']}).pending).toBeUndefined();
    expect(b.snapshot().error).toBeUndefined();
    b.request(fields,'LOG');now+=3001;expect(b.snapshot().pending).toBeUndefined();
  });
});
