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
