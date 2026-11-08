import { afterEach, describe, expect, it, vi } from 'vitest';
import { VoiceSessionManager } from '../VoiceSessionManager.js';

function createSession() {
  const audioStreamManager = {
    setVoiceOutputObserver: vi.fn(),
    clearVoicePlaybackQueue: vi.fn(),
    setVoiceTxOutputEnabled: vi.fn(),
  };
  const physicalTxCoordinator = {
    acquireLease: vi.fn().mockResolvedValue('test-voice-lease'),
    releaseLease: vi.fn().mockResolvedValue({ success: true }),
    markStreamingLeaseActive: vi.fn(),
    forceInterruptLease: vi.fn().mockResolvedValue(null),
    retryUnknownStop: vi.fn().mockResolvedValue({ success: true }),
    getSnapshot: vi.fn().mockReturnValue({ phase: 'idle' }),
  };
  const session = new VoiceSessionManager({
    radioManager: {} as never,
    audioStreamManager: audioStreamManager as never,
    physicalTxCoordinator: physicalTxCoordinator as never,
  });
  return { session, audioStreamManager, physicalTxCoordinator };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('VoiceSessionManager media lifecycle', () => {
  it('only retires voice PTT for its associated audio participant', async () => {
    const { session, physicalTxCoordinator } = createSession();
    await session.start();
    await expect(session.startTransmit('operator-1', 'Operator', 'rtc-send:one'))
      .resolves.toMatchObject({ success: true });

    await session.handleParticipantDisconnect('rtc-send:unrelated');
    expect(physicalTxCoordinator.releaseLease).not.toHaveBeenCalled();
    expect(session.getIsTransmitting()).toBe(true);

    await session.handleParticipantDisconnect('rtc-send:one');
    expect(physicalTxCoordinator.releaseLease).toHaveBeenCalledWith(
      'test-voice-lease', 'released by client',
    );
    expect(session.getIsTransmitting()).toBe(false);
    expect(session.getActiveVoiceAudioClientId()).toBeNull();
    session.destroy();
  });

  it('retains the PTT lock when physical release is unconfirmed, and supports safe retry', async () => {
    const { session, physicalTxCoordinator } = createSession();
    await session.start();
    await session.startTransmit('operator-1', 'Operator', 'rtc-send:one');

    // The first hardware release attempt transitions the coordinator into
    // an unknown state; setting it before the attempt would skip releaseLease.
    physicalTxCoordinator.releaseLease.mockImplementationOnce(async () => {
      physicalTxCoordinator.getSnapshot.mockReturnValue({ phase: 'unknown' });
      return { success: false };
    });
    await session.handleParticipantDisconnect('rtc-send:one');
    expect(session.getIsTransmitting()).toBe(true);
    expect(await session.startTransmit('operator-1', 'Operator', 'rtc-send:two'))
      .toMatchObject({ success: false });

    physicalTxCoordinator.retryUnknownStop.mockImplementation(async () => {
      physicalTxCoordinator.getSnapshot.mockReturnValue({ phase: 'idle' });
      // The coordinator preserves the original TX failure in the result;
      // successful recovery is reported by the idle physical lease phase.
      return { success: false };
    });
    expect(await session.stopTransmit('operator-1')).toBe(true);
    expect(physicalTxCoordinator.retryUnknownStop).toHaveBeenCalledTimes(1);
    expect(session.getIsTransmitting()).toBe(false);
    session.destroy();
  });

  it('auto-unkeys stalled browser voice media but not the independent Voice Keyer', async () => {
    vi.useFakeTimers();
    const { session, physicalTxCoordinator } = createSession();
    await session.start();
    await session.startTransmit('operator-1', 'Operator', 'rtc-send:one');
    await vi.advanceTimersByTimeAsync(3_000);
    expect(physicalTxCoordinator.releaseLease).toHaveBeenCalledTimes(1);
    expect(session.getIsTransmitting()).toBe(false);

    await session.startTransmit('voice-keyer:operator-1', 'Voice Keyer');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(physicalTxCoordinator.releaseLease).toHaveBeenCalledTimes(1);
    expect(session.getIsTransmitting()).toBe(true);
    expect(await session.stopTransmit('voice-keyer:operator-1')).toBe(true);
    session.destroy();
  });

  it('releases the physical voice lease before clearing a timed-out PTT lock', async () => {
    vi.useFakeTimers();
    const { session, physicalTxCoordinator } = createSession();
    await session.start();
    await session.startTransmit('operator-1', 'Operator', 'rtc-send:one');

    await vi.advanceTimersByTimeAsync(180_000);
    expect(physicalTxCoordinator.releaseLease).toHaveBeenCalledTimes(1);
    expect(session.getIsTransmitting()).toBe(false);
    session.destroy();
  });
});
