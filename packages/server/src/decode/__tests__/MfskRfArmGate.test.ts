import { describe, expect, it } from 'vitest';
import { MfskRfArmGate } from '../MfskRfArmGate.js';

describe('native RF operator admission (no physical PTT)', () => {
  it('starts disarmed and never arms without explicit confirmation or real rig identity', () => {
    let identity: string|null=null;
    const gate=new MfskRfArmGate({
      monotonicNowMs:()=>1000,eligibleIdentity:()=>identity,
    });
    expect(gate.allowed()).toBe(false);
    expect(()=>gate.arm(false)).toThrow(/acknowledgement/);
    expect(()=>gate.arm(true)).toThrow(/real, connected/);
    identity='rig=2;mode=Q65;rx=8';
    expect(gate.arm(true).rfEnabled).toBe(true);
  });

  it('invalidates RF on RX generation, mode or rig reconnection; does not resume automatically',()=>{
    let now=1000,identity:string|null='rig=2;mode=Q65;rx=8';
    const gate=new MfskRfArmGate({
      monotonicNowMs:()=>now,eligibleIdentity:()=>identity,
    });
    gate.arm(true);
    expect(gate.status().remainingMs).toBe(600_000);
    identity='rig=2;mode=Q65;rx=9';
    expect(gate.allowed()).toBe(false);
    identity='rig=2;mode=Q65;rx=8';
    // A transient identity failure must permanently disarm, even if the
    // external connection layer accidentally reuses a generation number.
    expect(gate.allowed()).toBe(false);
    identity='rig=3;mode=JTTY;rx=10';
    gate.arm(true,1000);
    now=2000;
    expect(gate.allowed()).toBe(false);
    expect(gate.status().remainingMs).toBe(0);
  });

  it('denies a disconnected rig and rejects too-long authorization',()=>{
    let identity:string|null='real:3:Q65:10';
    const gate=new MfskRfArmGate({
      monotonicNowMs:()=>500,eligibleIdentity:()=>identity,
    });
    expect(()=>gate.arm(true,600_001)).toThrow(/duration/);
    gate.arm(true);
    identity=null;
    expect(gate.allowed()).toBe(false);
    identity='real:3:Q65:10';
    expect(gate.allowed()).toBe(false);
    gate.arm(true);
    expect(()=>gate.arm(false)).toThrow(/acknowledgement/);
    expect(gate.allowed()).toBe(false);
  });
});
