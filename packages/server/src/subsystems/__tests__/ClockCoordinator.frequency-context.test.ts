import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'eventemitter3';
import { MODES } from '@tx5dr/contracts';
import { ClockCoordinator } from '../ClockCoordinator.js';

describe('ClockCoordinator decode frequency context', () => {
  it('captures authoritative RF context before SlotPack creation', () => {
    const decodeQueue = new EventEmitter();
    const setFrequencyContext = vi.fn();
    const processDecodeResult = vi.fn();
    const coordinator = new ClockCoordinator({
      engineEmitter: new EventEmitter() as never,
      slotClock: new EventEmitter() as never,
      decodeQueue: decodeQueue as never,
      slotPackManager: {
        setFrequencyContext,
        processDecodeResult,
        on: vi.fn(),
        off: vi.fn(),
      } as never,
      spectrumScheduler: new EventEmitter() as never,
      operatorManager: { broadcastAllOperatorStatusUpdates: vi.fn() } as never,
      callsignTracker: { updateFromSlotPack: vi.fn() } as never,
      getTransmissionPipeline: () => ({
        onSlotStart: vi.fn(), onEncodeStart: vi.fn(), onTransmitStart: vi.fn(),
      }) as never,
      getRadioBridge: () => ({ onSpectrumEvent: vi.fn() }) as never,
      getCurrentMode: () => MODES.FT8,
      getFrequencyContext: () => ({ frequency: 14_074_000, band: '20m', mode: 'FT8' }),
    });

    coordinator.setup();
    const decodeResult = { slotId: 'slot-1' };
    decodeQueue.emit('decodeComplete', decodeResult);

    expect(setFrequencyContext).toHaveBeenCalledWith({ frequency: 14_074_000, band: '20m', mode: 'FT8' });
    expect(processDecodeResult).toHaveBeenCalledWith(decodeResult);
    expect(setFrequencyContext.mock.invocationCallOrder[0])
      .toBeLessThan(processDecodeResult.mock.invocationCallOrder[0]!);
    coordinator.teardown();
  });
});

describe('ClockCoordinator FT8/FT4 transmit intent delivery', () => {
  it.each(['FT8', 'FT4'] as const)('drains %s strategy requests before the pipeline encode phase', mode => {
    const engineEmitter = new EventEmitter();
    const slotClock = new EventEmitter();
    const order: string[] = [];
    const pending: string[] = [];
    engineEmitter.on('encodeStart', () => {
      order.push('strategy');
      pending.push('CQ BG5JSU OL79');
    });
    const consume = vi.fn(() => {
      order.push('consume');
      expect(pending.splice(0)).toEqual(['CQ BG5JSU OL79']);
    });
    const onEncodeStart = vi.fn(() => order.push('pipeline'));
    const coordinator = new ClockCoordinator({
      engineEmitter: engineEmitter as never,
      slotClock: slotClock as never,
      decodeQueue: new EventEmitter() as never,
      slotPackManager: new EventEmitter() as never,
      spectrumScheduler: new EventEmitter() as never,
      operatorManager: {
        broadcastAllOperatorStatusUpdates: vi.fn(),
        processPendingTransmissions: consume,
        hasActiveTransmissionsInCurrentCycle: () => false,
      } as never,
      callsignTracker: {updateFromSlotPack: vi.fn()} as never,
      getTransmissionPipeline: () => ({
        onSlotStart: vi.fn(), onEncodeStart, onTransmitStart: vi.fn(),
      }) as never,
      getRadioBridge: () => ({onSpectrumEvent: vi.fn()}) as never,
      getCurrentMode: () => MODES[mode],
    });
    coordinator.setup();
    const slot = { id: 'slot-45000', startMs: 45000, phaseMs: 0, driftMs: 0 };
    slotClock.emit('encodeStart', slot);
    expect(order).toEqual(['strategy', 'consume', 'pipeline']);
    expect(consume).toHaveBeenCalledExactlyOnceWith(slot);
    coordinator.teardown();
  });
});
