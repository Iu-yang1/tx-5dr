import { afterEach, describe, expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { ProcessHamlibTransport } from '../ProcessHamlibTransport.js';

// Simulated child-process + real IPC serialization; no RF equipment is opened.
// This fixture also sends an intentionally stale-generation reply per frequency
// request, so its results are a conservative stress workload, not hardware latency.
const entry = { path: fileURLToPath(new URL('./fixtures/worker.ts', import.meta.url)), execArgv: ['--import', 'tsx'] };
const hosts = new Set<ProcessHamlibTransport>();
afterEach(async () => {
  await Promise.all([...hosts].map(host => host.close()));
  hosts.clear();
});

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
}

function round(number: number): number { return Math.round(number * 100) / 100; }

describe('Hamlib real child-process IPC performance', () => {
  it('measures sequential, concurrent, and 2KiB spectrum streaming control latency', async () => {
    const transport = new ProcessHamlibTransport({ entry, heartbeatTimeoutMs: 3000 });
    hosts.add(transport);
    await transport.call('connect', [{ type: 'network', network: { host: 'normal', port: 4532 } }, undefined]);
    const getFrequency = async (): Promise<number> => transport.call('getFrequency', []) as Promise<number>;

    for (let i = 0; i < 20; i += 1) expect(await getFrequency()).toBe(7100000);
    const baselineCpu = process.cpuUsage();
    const baselineRss = process.memoryUsage().rss;
    const sequentialLatencies: number[] = [];
    const sequentialStart = performance.now();
    for (let i = 0; i < 250; i += 1) {
      const start = performance.now();
      expect(await getFrequency()).toBe(7100000);
      sequentialLatencies.push(performance.now() - start);
    }
    const sequentialMs = performance.now() - sequentialStart;

    const concurrentLatencies: number[] = [];
    const concurrentStart = performance.now();
    for (let batch = 0; batch < 8; batch += 1) {
      await Promise.all(Array.from({ length: 32 }, async () => {
        const start = performance.now();
        expect(await getFrequency()).toBe(7100000);
        concurrentLatencies.push(performance.now() - start);
      }));
    }
    const concurrentMs = performance.now() - concurrentStart;

    let spectrumFrames = 0;
    transport.on('event', event => {
      if (event.event === 'spectrumLine') {
        spectrumFrames++;
        expect(event.args[0].data.length).toBe(2048);
      }
    });
    await transport.call('startManagedSpectrum', [undefined]);
    const streamingLatencies: number[] = [];
    const streamingStart = performance.now();
    for (let i = 0; i < 100; i += 1) {
      const start = performance.now();
      expect(await getFrequency()).toBe(7100000);
      streamingLatencies.push(performance.now() - start);
      if (i % 10 === 0) await new Promise(resolve => setTimeout(resolve, 15));
    }
    await new Promise(resolve => setTimeout(resolve, 400));
    const streamingMs = performance.now() - streamingStart;
    await transport.call('stopManagedSpectrum', []);
    const cpu = process.cpuUsage(baselineCpu);
    const rssDelta = process.memoryUsage().rss - baselineRss;
    const metrics = {
      sample: 'mock worker, real Node child-process IPC; includes stale-message filtering',
      sequentialCalls: sequentialLatencies.length,
      sequentialCallsPerSec: round(sequentialLatencies.length * 1000 / sequentialMs),
      sequentialP95Ms: round(p95(sequentialLatencies)),
      concurrentCalls: concurrentLatencies.length,
      concurrentCallsPerSec: round(concurrentLatencies.length * 1000 / concurrentMs),
      concurrentP95Ms: round(p95(concurrentLatencies)),
      streamingCalls: streamingLatencies.length,
      streamingP95Ms: round(p95(streamingLatencies)),
      streamFrames: spectrumFrames,
      streamingDurationMs: round(streamingMs),
      parentCpuMs: round((cpu.user + cpu.system) / 1000),
      parentRssDeltaMiB: round(rssDelta / (1024 * 1024)),
    };
    console.log('HAMLIB_IPC_PERF_METRICS ' + JSON.stringify(metrics));
    expect(spectrumFrames).toBeGreaterThan(0);
  }, 120000);
});
