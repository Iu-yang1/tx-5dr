import type { SpectrumKind } from '@tx5dr/contracts';

export type SpectrumMemoryTier = 'normal' | 'constrained' | 'pressured';
export type MemoryPressureInfo = {
  level: 'normal' | 'warning' | 'critical';
  constrainedDevice: boolean;
  freeMiB: number;
};

export const NORMAL_SPECTRUM_HISTORY_LIMITS: Record<SpectrumKind, number> = {
  audio: 1024,
  'radio-sdr': 1024,
  'openwebrx-sdr': 40,
};

export function resolveSpectrumMemoryTier(pressure: MemoryPressureInfo): SpectrumMemoryTier {
  if (pressure.level !== 'normal') return 'pressured';
  return pressure.constrainedDevice ? 'constrained' : 'normal';
}

export function resolveSpectrumMemoryHistoryLimits(tier: SpectrumMemoryTier): Record<SpectrumKind, number> {
  if (tier === 'pressured') {
    return { audio: 256, 'radio-sdr': 256, 'openwebrx-sdr': 40 };
  }
  if (tier === 'constrained') {
    return { audio: 512, 'radio-sdr': 512, 'openwebrx-sdr': 40 };
  }
  return NORMAL_SPECTRUM_HISTORY_LIMITS;
}
