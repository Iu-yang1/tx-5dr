import { describe, expect, it } from 'vitest';
import { CallsignHashRegistry } from '../CallsignHashRegistry.js';

describe('receiver-scoped callsign hash registry', () => {
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
    const calls = Array.from({ length: 1100 }, (_, i) => `K${String(i).padStart(4, '0')}`);
    registry.learnRx(calls);
    expect(registry.size).toBe(1000);
    expect(original.calls).toEqual([]);
    expect(registry.snapshot().calls[0]).toBe('K0100');
    registry.clear();
    expect(registry.snapshot().calls).toEqual([]);
    expect(registry.version).toBeGreaterThan(original.version);
  });
});
