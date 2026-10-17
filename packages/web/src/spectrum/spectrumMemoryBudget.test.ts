import { describe, expect, it } from 'vitest';
import { resolveSpectrumMemoryHistoryLimits, resolveSpectrumMemoryTier } from './spectrumMemoryBudget';

describe('spectrum memory pressure budgets', () => {
  it('caps an 8GiB host to half the normal history without touching the backend', () => {
    const tier = resolveSpectrumMemoryTier({ level: 'normal', constrainedDevice: true, freeMiB: 2048 });
    expect(tier).toBe('constrained');
    expect(resolveSpectrumMemoryHistoryLimits(tier).audio).toBe(512);
  });
  it('sheds expensive local FFT history at low OS headroom', () => {
    const tier = resolveSpectrumMemoryTier({ level: 'critical', constrainedDevice: true, freeMiB: 200 });
    expect(tier).toBe('pressured');
    expect(resolveSpectrumMemoryHistoryLimits(tier)['radio-sdr']).toBe(256);
    expect(resolveSpectrumMemoryHistoryLimits(tier)['openwebrx-sdr']).toBe(40);
  });
  it('keeps normal desktop history limits on larger hosts', () => {
    expect(resolveSpectrumMemoryHistoryLimits(
      resolveSpectrumMemoryTier({ level: 'normal', constrainedDevice: false, freeMiB: 8192 }),
    ).audio).toBe(1024);
  });
});
