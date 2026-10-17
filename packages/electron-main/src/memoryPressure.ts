/** Lightweight, allocation-bounded production memory diagnostics.
 * Electron's ProcessMetric.memory fields use KiB. OS totals use bytes.
 */
export type MemoryPressureLevel = 'normal' | 'warning' | 'critical';

export interface PhysicalMemoryPressure {
  level: MemoryPressureLevel;
  totalMiB: number;
  freeMiB: number;
  constrainedDevice: boolean;
}

export function classifyPhysicalMemoryPressure(totalBytes: number, availableBytes: number): PhysicalMemoryPressure {
  const totalMiB = Math.max(0, Math.round(totalBytes / 1_048_576));
  const freeMiB = Math.max(0, Math.round(availableBytes / 1_048_576));
  return {
    totalMiB,
    freeMiB,
    constrainedDevice: totalMiB > 0 && totalMiB <= 9 * 1024,
    level: freeMiB <= 512 ? 'critical' : freeMiB <= 1024 ? 'warning' : 'normal',
  };
}

export interface ProcessMemorySample {
  at: number;
  reason: string;
  system: PhysicalMemoryPressure;
  processes: Array<{
    pid: number;
    type: string;
    privateKiB: number;
    workingSetKiB: number;
  }>;
}

export class MemorySnapshotHistory {
  private readonly samples: ProcessMemorySample[] = [];
  constructor(private readonly limit = 30) {}

  record(sample: ProcessMemorySample): void {
    this.samples.push(sample);
    if (this.samples.length > this.limit) this.samples.splice(0, this.samples.length - this.limit);
  }

  snapshot(): ProcessMemorySample[] {
    return this.samples.slice();
  }
}
