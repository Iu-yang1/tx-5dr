import { describe, expect, it } from 'vitest';
import { CallsignHashRegistry, callsignHash } from '../CallsignHashRegistry.js';

describe('receiver-scoped callsign hash registry', () => {
  it('matches WSJT-X 3.2 hash vectors for all three widths', () => {
    expect(callsignHash('K1ABC', 10)).toBe(712);
    expect(callsignHash('K1ABC', 12)).toBe(2851);
    expect(callsignHash('K1ABC', 22)).toBe(2920267);
  });

  it('retains trusted calls across slots and shares one history for FT8/FT4', () => {
    const registry = new CallsignHashRegistry();
    expect(registry.learnRx(['BG5JSU', '5TB3Z'])).toBe(2);
    const first = registry.snapshot();
    expect(first.calls).toEqual(['BG5JSU', '5TB3Z']);
    expect(registry.learnRx(['<...>', 'FN42', 'RRR', 'CQ', '-13', 'HELLO WORLD'])).toBe(0);
    expect(registry.snapshot()).toEqual(first);
    expect(registry.learnRx(['BG5JSU'])).toBe(1);
    expect(registry.snapshot().calls).toEqual(['5TB3Z', 'BG5JSU']);
  });

  it('caps the long-lived history at 1000 and publishes immutable snapshots', () => {
    const registry = new CallsignHashRegistry();
    const original = registry.snapshot();
    const calls = Array.from({ length: 1100 }, (_, i) => `K${String(i).padStart(4, '0')}A`);
    registry.learnRx(calls);
    expect(registry.size).toBe(1000);
    expect(original.calls).toEqual([]);
    expect(registry.snapshot().calls).toContain('K0100A');
    registry.clear();
    expect(registry.snapshot().calls).toEqual([]);
    expect(registry.version).toBeGreaterThan(original.version);
  });
});
