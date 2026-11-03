import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  resolveDigitalSchedule, nextDigitalSlot, containingDigitalSlot,
  DigitalScheduleGeneration, AudioStreamSequence,
} from '../src/clock/DigitalModeSchedule.js';

describe('multimode UTC scheduling', () => {
  it('keeps all six mode clocks separate', () => {
    assert.equal(resolveDigitalSchedule('FT8').slotMs, 15_000);
    assert.equal(resolveDigitalSchedule('FT4').slotMs, 7_500);
    assert.equal(resolveDigitalSchedule('WSPR').slotMs, 120_000);
    assert.equal(resolveDigitalSchedule('Q65','Q65-60B').slotMs, 60_000);
    assert.equal(resolveDigitalSchedule('Q65','Q65-300A').slotMs, 300_000);
    assert.equal(resolveDigitalSchedule('MSK144').slotMs, null);
    assert.equal(resolveDigitalSchedule('JTTY').slotMs, null);
    assert.throws(() => resolveDigitalSchedule('FT8','Q65-60B'));
    assert.throws(() => containingDigitalSlot(resolveDigitalSchedule('JTTY'), 0));
  });

  it('never rounds FT4 7.5-second UTC half-slot to a whole second', () => {
    const ft4 = resolveDigitalSchedule('FT4');
    assert.deepEqual(
      [containingDigitalSlot(ft4,22_499).startMs,
       containingDigitalSlot(ft4,22_500).startMs,
       nextDigitalSlot(ft4,22_500).startMs],
      [15_000,22_500,30_000],
    );
    assert.equal(nextDigitalSlot(resolveDigitalSchedule('WSPR'),120_000).startMs,240_000);
    assert.equal(containingDigitalSlot(resolveDigitalSchedule('Q65','Q65-120D'),239_999).startMs,120_000);
  });

  it('rejects stale generations, nonconsecutive audio and repeat after restart', () => {
    const sequence = new AudioStreamSequence();
    const g = sequence.currentGeneration();
    assert.equal(sequence.accept(g,0,960),true);
    assert.equal(sequence.accept(g,0,960),false);
    assert.equal(sequence.accept(g,1920,960),false);
    assert.equal(sequence.accept(g,960,960),true);
    const next = sequence.restart();
    assert.equal(sequence.accept(g,0,960),false);
    assert.equal(sequence.accept(next,0,960),true);
    assert.equal(sequence.accept(next,-1,960),false);
    assert.equal(sequence.accept(next,960,NaN),false);
  });

  it('does not allow previously allocated slot generations after reset', () => {
    const clock = new DigitalScheduleGeneration();
    assert.equal(clock.accepts(clock.current()),true);
    const old = clock.current();
    clock.invalidate();
    assert.equal(clock.accepts(old),false);
  });
});
