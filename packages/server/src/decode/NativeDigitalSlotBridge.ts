import {
  Q65_PERIOD_MS,
  type DecodeResult,
  type DigitalRxEvent,
  type Q65Submode,
} from '@tx5dr/contracts';

/**
 * Presentation adapter into the existing SlotPack/related-message pipeline.
 * The 5 s MSK144 buckets are UI history bins, never simulated T/R slots.
 * JTTY is continuous mutable text and deliberately stays out of SlotPack.
 */
export interface NativeSlotProjection {
  result: DecodeResult;
  presentationSlotMs: number;
}

export function projectNativeDigitalFrames(
  events: readonly DigitalRxEvent[],
  activeMode: string,
  q65Submode: Q65Submode = 'Q65-60B',
): NativeSlotProjection[] {
  if (!['Q65', 'WSPR', 'MSK144'].includes(activeMode)) return [];
  const durationMs = activeMode === 'Q65'
    ? Q65_PERIOD_MS[q65Submode]
    : activeMode === 'WSPR' ? 120_000 : 5_000;
  const batches = new Map<number, NativeSlotProjection>();
  for (const event of events) {
    if (event.mode !== activeMode || event.kind === 'message-update') continue;
    const message = event.text.trim();
    if (!message || !Number.isSafeInteger(event.timestampMs) || event.timestampMs < 0
      || !Number.isFinite(event.frequencyHz) || !Number.isFinite(event.snrDb)) continue;
    // Q65 and WSPR retain their true UTC slot boundary, not the time the
    // worker delivered the result (which can be in the next period).
    const nativeStart = event.kind === 'slot-decode'
      ? Number(event.slotId.split('-').at(-1)) : NaN;
    const startMs = event.kind === 'slot-decode' && Number.isSafeInteger(nativeStart)
      && nativeStart >= 0 && nativeStart % durationMs === 0
      ? nativeStart : Math.floor(event.timestampMs / durationMs) * durationMs;
    let batch = batches.get(startMs);
    if (!batch) {
      batch = {
        presentationSlotMs: durationMs,
        result: {
          slotId: `slot-${startMs}`,
          timestamp: event.timestampMs,
          windowIdx: 0,
          processingTimeMs: 0,
          windowOffsetMs: 0,
          frames: [],
        },
      };
      batches.set(startMs, batch);
    }
    batch.result.frames.push({
      snr: event.snrDb,
      freq: event.frequencyHz,
      // The native burst API does not report a DT estimate; 0 is a
      // transport placeholder and the UI must display '-' for MSK144.
      dt: event.kind === 'slot-decode' ? event.dtSeconds : 0,
      message,
      confidence: 1,
    });
    batch.result.timestamp = Math.max(batch.result.timestamp, event.timestampMs);
  }
  return [...batches.values()].sort((a, b) =>
    a.result.timestamp - b.result.timestamp);
}
