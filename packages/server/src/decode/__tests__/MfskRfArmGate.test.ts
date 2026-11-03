import { describe, expect, it } from 'vitest';
import { MfskRfArmGate } from '../MfskRfArmGate.js';

describe('native RF operator admission (no physical PTT)', () => {
  it('starts disarmed and never arms without explicit confirmation or real rig identity', () => {
    let identity: string|null=null;
    const gate=new MfskRfArmGate({
      monotonicNowMs:()=>1000,eligibleIdentity:()=>identity,
    });
    expect(gate.allowedForOperator('op1')).toBe(false);
    expect(()=>gate.arm(false,'op1','owner1')).toThrow(/acknowledgement/);
    expect(()=>gate.arm(true,'op1','owner1')).toThrow(/real, connected/);
    identity='rig=2;mode=Q65;rx=8';
    expect(gate.arm(true,'op1','owner1').rfEnabled).toBe(true);
  });

  it('invalidates RF on RX generation, mode or rig reconnection; does not resume automatically',()=>{
    let now=1000,identity:string|null='rig=2;mode=Q65;rx=8';
    const gate=new MfskRfArmGate({
      monotonicNowMs:()=>now,eligibleIdentity:()=>identity,
    });
    gate.arm(true,'op1','owner1');
    expect(gate.status('op1','owner1').remainingMs).toBe(600_000);
    identity='rig=2;mode=Q65;rx=9';
    expect(gate.allowedForOperator('op1')).toBe(false);
    identity='rig=2;mode=Q65;rx=8';
    // A transient identity failure must permanently disarm, even if the
    // external connection layer accidentally reuses a generation number.
    expect(gate.allowedForOperator('op1')).toBe(false);
    identity='rig=3;mode=JTTY;rx=10';
    gate.arm(true,'op1','owner1',1000);
    now=2000;
    expect(gate.allowedForOperator('op1')).toBe(false);
    expect(gate.status('op1','owner1').remainingMs).toBe(0);
  });

  it('revokes approval after a dial-frequency change without restoring it',()=>{
    let identity:string|null='rig:3:Q65:7:432080000';
    const gate=new MfskRfArmGate({
      monotonicNowMs:()=>100,eligibleIdentity:()=>identity,
    });
    gate.arm(true,'op1','owner1');
    identity='rig:3:Q65:7:432090000';
    expect(gate.allowedForOperator('op1')).toBe(false);
    identity='rig:3:Q65:7:432080000';
    expect(gate.allowedForOperator('op1')).toBe(false);
  });

  it('denies a disconnected rig and rejects too-long authorization',()=>{
    let identity:string|null='real:3:Q65:10';
    const gate=new MfskRfArmGate({
      monotonicNowMs:()=>500,eligibleIdentity:()=>identity,
    });
    expect(()=>gate.arm(true,'op1','owner1',600_001)).toThrow(/duration/);
    gate.arm(true,'op1','owner1');
    identity=null;
    expect(gate.allowedForOperator('op1')).toBe(false);
    identity='real:3:Q65:10';
    expect(gate.allowedForOperator('op1')).toBe(false);
    gate.arm(true,'op1','owner1');
    expect(()=>gate.arm(false,'op1','owner1')).toThrow(/acknowledgement/);
    expect(gate.allowedForOperator('op1')).toBe(false);
  });
});

it('binds approval to both operator and authenticated token; no borrowing between users',()=>{
  const gate=new MfskRfArmGate({
    monotonicNowMs:()=>1000,
    eligibleIdentity:()=> 'rig:4:Q65:8:432080000',
  });
  gate.arm(true,'operator-A','token-A');
  expect(gate.status('operator-A','token-A').rfEnabled).toBe(true);
  expect(gate.status('operator-A','token-B').rfEnabled).toBe(false);
  expect(gate.status('operator-B','token-A').rfEnabled).toBe(false);
  expect(gate.allowedForOperator('operator-B')).toBe(false);
  expect(gate.allowedForOperator('operator-A')).toBe(true);
  expect(gate.status('operator-A','token-A').rfEnabled).toBe(true);
});
