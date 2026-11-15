import { describe, expect, it } from 'vitest';
import { nativeDisplayCycle } from './NativeOperatorProgress';

describe('native operator UTC display progress', () => {
  it('follows the receiver submode instead of the static 60-second Q65 descriptor', () => {
    for (const [submode, duration] of [
      ['Q65-15A', 15_000], ['Q65-60B', 60_000],
      ['Q65-120E', 120_000], ['Q65-300A', 300_000],
    ] as const) {
      const phase = nativeDisplayCycle('Q65', 3_600_000 + duration / 2, submode, 5)!;
      expect(phase.slotMs).toBe(duration);
      expect(phase.slotInfo.startMs).toBe(3_600_000);
      expect(phase.slotInfo.phaseMs).toBe(duration / 2);
    }
  });

  it('uses MSK144 T/R selections 5, 10, 15 and 30 seconds', () => {
    for (const period of [5, 10, 15, 30] as const) {
      const phase = nativeDisplayCycle('MSK144', 3_600_000 + period * 500, null, period)!;
      expect(phase.slotMs).toBe(period * 1000);
      expect(phase.slotInfo.phaseMs).toBe(period * 500);
    }
  });

  it('uses WSPR two-minute UTC period', () => {
    const phase = nativeDisplayCycle('WSPR', 180_001, null, 30)!;
    expect(phase.slotMs).toBe(120_000);
    expect(phase.slotInfo.startMs).toBe(120_000);
    expect(phase.slotInfo.phaseMs).toBe(60_001);
  });

  it('does not invent a Q65 period until the receiver confirms its submode', () => {
    expect(nativeDisplayCycle('Q65', 1_000_000, null, 5)).toBeNull();
    const earlier = nativeDisplayCycle('MSK144', 9_999, null, 5)!;
    const later = nativeDisplayCycle('MSK144', 10_001, null, 5)!;
    expect(later.slotInfo.startMs).toBe(10_000);
    expect(later.slotInfo.phaseMs).toBe(1);
    expect(later.slotInfo.id).not.toBe(earlier.slotInfo.id);
  });
});
