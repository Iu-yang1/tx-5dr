import { afterEach, describe, expect, it } from 'vitest';
import { encodeRealtimeEncodedAudioFrame } from '@tx5dr/core';
import { BrowserOpusDecoder, OPUS_MAX_PENDING_FRAMES } from '../realtimeAudioCodec';

const originalAudioDecoder = (globalThis as unknown as { AudioDecoder?: unknown }).AudioDecoder;
const originalEncodedAudioChunk = (globalThis as unknown as { EncodedAudioChunk?: unknown }).EncodedAudioChunk;

class FakeDecodedAudioData {
  readonly numberOfFrames = 320;
  readonly numberOfChannels = 1;
  readonly format = 'f32';

  constructor(readonly sampleRate: number) {}

  allocationSize(): number {
    return this.numberOfFrames * 4;
  }

  copyTo(destination: ArrayBufferView): void {
    const samples = destination as Float32Array;
    samples.fill(0.25);
  }

  close(): void {}
}

class FakeAudioDecoder {
  static instances: FakeAudioDecoder[] = [];

  readonly chunks: unknown[] = [];

  constructor(private readonly init: { output: (output: unknown) => void; error: (error: Error) => void }) {
    FakeAudioDecoder.instances.push(this);
  }

  configure(): void {}

  decode(chunk: unknown): void {
    this.chunks.push(chunk);
  }

  emit(sampleRate = 48_000): void {
    this.init.output(new FakeDecodedAudioData(sampleRate));
  }

  emitError(): void {
    this.init.error(new Error('simulated native decoder failure'));
  }

  close(): void {
    this.chunks.length = 0;
  }
}

class FakeEncodedAudioChunk {
  constructor(init: Record<string, unknown>) {
    Object.assign(this, init);
  }
}

function makeOpusPayload(sequence: number, timestampMs: number): ArrayBuffer {
  return encodeRealtimeEncodedAudioFrame({
    codec: 'opus',
    sequence,
    timestampMs,
    serverSentAtMs: timestampMs + 2,
    sourceSampleRate: 48_000,
    codecSampleRate: 48_000,
    channels: 1,
    samplesPerChannel: 960,
    frameDurationMs: 20,
    payload: new Uint8Array([sequence & 0xff]),
  });
}

describe('BrowserOpusDecoder', () => {
  afterEach(() => {
    (globalThis as unknown as { AudioDecoder?: unknown }).AudioDecoder = originalAudioDecoder;
    (globalThis as unknown as { EncodedAudioChunk?: unknown }).EncodedAudioChunk = originalEncodedAudioChunk;
    FakeAudioDecoder.instances = [];
  });

  it('keeps decoded metadata in FIFO order while WebCodecs output is async', () => {
    (globalThis as unknown as { AudioDecoder?: unknown }).AudioDecoder = FakeAudioDecoder;
    (globalThis as unknown as { EncodedAudioChunk?: unknown }).EncodedAudioChunk = FakeEncodedAudioChunk;

    const decoded: Array<{ sourceTimestampMs: number; receivedAtClientMs: number; serverSentAtMs?: number }> = [];
    const decoder = new BrowserOpusDecoder((frame) => {
      decoded.push({
        sourceTimestampMs: frame.sourceTimestampMs,
        receivedAtClientMs: frame.receivedAtClientMs,
        serverSentAtMs: frame.serverSentAtMs,
      });
    });

    decoder.decode(makeOpusPayload(0, 1000), 2000);
    decoder.decode(makeOpusPayload(1, 1020), 2020);

    const fakeDecoder = FakeAudioDecoder.instances[0]!;
    expect(fakeDecoder.chunks).toHaveLength(2);

    fakeDecoder.emit();
    fakeDecoder.emit();

    expect(decoded).toEqual([
      { sourceTimestampMs: 1000, receivedAtClientMs: 2000, serverSentAtMs: undefined },
      { sourceTimestampMs: 1020, receivedAtClientMs: 2020, serverSentAtMs: undefined },
    ]);
  });

  it('caps metadata even if input continues forever and WebCodecs never produces output', () => {
    (globalThis as unknown as { AudioDecoder?: unknown }).AudioDecoder = FakeAudioDecoder;
    (globalThis as unknown as { EncodedAudioChunk?: unknown }).EncodedAudioChunk = FakeEncodedAudioChunk;

    const decoded: number[] = [];
    const decoder = new BrowserOpusDecoder((frame) => decoded.push(frame.sequence));
    for (let i = 0; i < OPUS_MAX_PENDING_FRAMES * 5; i += 1) {
      decoder.decode(makeOpusPayload(i, i * 20), i * 20 + 3);
      expect(decoder.getDiagnostics().pendingFrames).toBeLessThanOrEqual(OPUS_MAX_PENDING_FRAMES);
    }
    expect(FakeAudioDecoder.instances.length).toBeGreaterThan(1);
    expect(decoder.getDiagnostics().overloadResets).toBeGreaterThan(0);

    // A late callback from an obsolete codec must not consume current metadata.
    const previous = FakeAudioDecoder.instances[0]!;
    const last = FakeAudioDecoder.instances[FakeAudioDecoder.instances.length - 1]!;
    const before = decoder.getDiagnostics().pendingFrames;
    previous.emit();
    expect(decoded).toEqual([]);
    expect(decoder.getDiagnostics().pendingFrames).toBe(before);
    last.emit();
    expect(decoded).toHaveLength(1);
  });

  it('abandons a failed decode session and automatically recreates it on the next frame', () => {
    (globalThis as unknown as { AudioDecoder?: unknown }).AudioDecoder = FakeAudioDecoder;
    (globalThis as unknown as { EncodedAudioChunk?: unknown }).EncodedAudioChunk = FakeEncodedAudioChunk;
    const output: number[] = [];
    const decoder = new BrowserOpusDecoder((frame) => output.push(frame.sequence));

    decoder.decode(makeOpusPayload(1, 1_000), 1_100);
    const failed = FakeAudioDecoder.instances[0]!;
    failed.emitError();
    expect(decoder.getDiagnostics().pendingFrames).toBe(0);

    decoder.decode(makeOpusPayload(2, 1_020), 1_120);
    const current = FakeAudioDecoder.instances[FakeAudioDecoder.instances.length - 1]!;
    failed.emit();
    current.emit();
    expect(output).toEqual([2]);
  });
});
