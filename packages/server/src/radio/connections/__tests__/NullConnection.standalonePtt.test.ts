import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NullConnection } from '../NullConnection.js';
import { PttHardware } from '../../PttHardware.js';

vi.mock('../../PttHardware.js', () => ({
  PttHardware: vi.fn(),
}));

describe('NullConnection standalone PTT', () => {
  const open = vi.fn(async () => {});
  const set = vi.fn(async (_enabled: boolean) => {});
  const close = vi.fn(async () => {});
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(PttHardware).mockImplementation(() => ({
      open, set, close,
    }) as unknown as PttHardware);
  });

  it('keeps no-CAT / VOX profiles hardware-free', async () => {
    const connection = new NullConnection();
    await connection.connect({ type: 'none', pttMethod: 'vox' } as any);
    await connection.setPTT(true);
    await connection.disconnect();
    expect(PttHardware).not.toHaveBeenCalled();
  });

  it('requires an independent serial port for no-CAT DTR/RTS', async () => {
    await expect(new NullConnection().connect({
      type: 'none', pttMethod: 'dtr',
    } as any)).rejects.toThrow(/PTT port is required/);
  });

  it.each(['dtr', 'rts'] as const)('writes %s and releases on disconnect', async (method) => {
    const connection = new NullConnection();
    await connection.connect({ type: 'none', pttMethod: method, pttPort: '/dev/ttyUSB2' } as any);
    expect(PttHardware).toHaveBeenCalledWith('/dev/ttyUSB2', method);
    expect(open).toHaveBeenCalledOnce();
    await connection.setPTT(true);
    await connection.setPTT(false);
    expect(set).toHaveBeenNthCalledWith(1, true);
    expect(set).toHaveBeenNthCalledWith(2, false);
    await connection.disconnect();
    expect(close).toHaveBeenCalledOnce();
  });
});
