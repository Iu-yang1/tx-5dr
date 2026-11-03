import { describe, expect, it } from 'vitest';
import { assertNativeLiveModeAdmission } from '../mfsk-live-admission.js';

describe('native RX uses the existing radio workspace and engine',()=>{
  it('permits a matching running native mode',()=>{
    for(const name of ['Q65','WSPR','MSK144','JTTY']){
      expect(()=>assertNativeLiveModeAdmission(name,name,true)).not.toThrow();
    }
  });
  it('cannot start an unrelated receiver over FT8/FT4 or during a mode transition',()=>{
    expect(()=>assertNativeLiveModeAdmission('Q65','FT8',true)).toThrow(/existing radio mode/);
    expect(()=>assertNativeLiveModeAdmission('WSPR','Q65',true)).toThrow(/existing radio mode/);
    expect(()=>assertNativeLiveModeAdmission('Q65','Q65',false)).toThrow(/main radio engine/);
  });
});
