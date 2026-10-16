import { describe, expect, it } from 'vitest';
import { classifyPhysicalMemoryPressure, MemorySnapshotHistory } from '../memoryPressure.js';

describe('physical memory headroom', () => {
  const mib = (value: number) => value * 1_048_576;
  it('detects 8GiB PCs and imminent low-memory pressure', () => {
    expect(classifyPhysicalMemoryPressure(mib(8192), mib(400))).toEqual({
      constrainedDevice: true, level: 'critical', totalMiB: 8192, freeMiB: 400,
    });
    expect(classifyPhysicalMemoryPressure(mib(8192), mib(900)).level).toBe('warning');
    expect(classifyPhysicalMemoryPressure(mib(16384), mib(8192)).constrainedDevice).toBe(false);
    expect(classifyPhysicalMemoryPressure(mib(16384), mib(8192)).level).toBe('normal');
  });

  it('bounds retained production diagnostic records across long runtimes', () => {
    const history = new MemorySnapshotHistory(3);
    for (let i = 0; i < 50; i += 1) {
      history.record({
        at: i, reason: 'interval',
        system: classifyPhysicalMemoryPressure(mib(8192), mib(4096)),
        processes: [],
      });
    }
    expect(history.snapshot().map(s => s.at)).toEqual([47, 48, 49]);
  });
});
