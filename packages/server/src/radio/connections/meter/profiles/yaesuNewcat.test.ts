import { describe, expect, it, vi } from 'vitest';

import type { MeterReadContext } from '../types.js';
import { yaesuNewcatProfile } from './yaesuNewcat.js';

function createContext(overrides: Partial<MeterReadContext> = {}): MeterReadContext {
  return {
    getLevel: vi.fn().mockResolvedValue(null),
    sendRaw: vi.fn().mockResolvedValue(Buffer.from('?', 'ascii')),
    currentFrequencyHz: 14_074_000,
    supportedLevels: new Set(['RAWSTR', 'ALC', 'SWR']),
    rigMetadata: { rigModel: 1042, mfgName: 'Yaesu', modelName: 'FTDX-10' },
    txPowerMaxWatts: 100,
    levelDecodeStrategy: {
      name: 'yaesu',
      sourceLevel: 'RAWSTR',
      displayStyle: 's-meter',
      label: 'yaesu-rawstr',
    },
    ...overrides,
  };
}

describe('yaesuNewcatProfile FTDX-10 meters', () => {
  it.each([
    3_573_000,
    7_074_000,
    14_074_000,
    21_074_000,
    28_074_000,
  ])('reads the receive S-meter through RM1 at %d Hz', async (currentFrequencyHz) => {
    const ctx = createContext({
      currentFrequencyHz,
      sendRaw: vi.fn().mockResolvedValue(Buffer.from('RM1130000;', 'ascii')),
      getLevel: vi.fn().mockResolvedValue(20),
    });

    const level = await yaesuNewcatProfile.readLevel!(ctx);

    expect(ctx.sendRaw).toHaveBeenCalledWith(
      Buffer.from('RM1;', 'ascii'),
      16,
      Buffer.from(';'),
    );
    expect(ctx.getLevel).not.toHaveBeenCalled();
    expect(level).toMatchObject({ raw: 130, formatted: 'S9', displayStyle: 's-meter' });
  });

  it('falls back to Hamlib RAWSTR if the direct RM1 reply is unavailable', async () => {
    const ctx = createContext({
      sendRaw: vi.fn().mockResolvedValue(Buffer.from('?;', 'ascii')),
      getLevel: vi.fn().mockResolvedValue(81),
    });

    const level = await yaesuNewcatProfile.readLevel!(ctx);

    expect(ctx.getLevel).toHaveBeenCalledWith('RAWSTR');
    expect(level).toMatchObject({ raw: 81, formatted: 'S6' });
  });

  it('keeps non-FTDX-10 Yaesu radios on the existing RAWSTR path', async () => {
    const ctx = createContext({
      rigMetadata: { rigModel: 1035, mfgName: 'Yaesu', modelName: 'FT-991A' },
      getLevel: vi.fn().mockResolvedValue(130),
      sendRaw: vi.fn(),
    });

    const level = await yaesuNewcatProfile.readLevel!(ctx);

    expect(ctx.sendRaw).not.toHaveBeenCalled();
    expect(ctx.getLevel).toHaveBeenCalledWith('RAWSTR');
    expect(level?.raw).toBe(130);
  });

  it('uses Hamlib\'s 0-64 ALC full-scale calibration for FTDX-10', async () => {
    const ctx = createContext({
      sendRaw: vi.fn().mockResolvedValue(Buffer.from('RM4064000;', 'ascii')),
    });

    await expect(yaesuNewcatProfile.readAlc!(ctx)).resolves.toEqual({
      raw: 64,
      percent: 100,
      alert: true,
    });
  });

  it('does not apply the FTDX-10 ALC calibration to FTDX-101 models', async () => {
    const ctx = createContext({
      rigMetadata: { rigModel: 1040, mfgName: 'Yaesu', modelName: 'FTDX-101D' },
      sendRaw: vi.fn().mockResolvedValue(Buffer.from('RM4064000;', 'ascii')),
    });

    const alc = await yaesuNewcatProfile.readAlc!(ctx);

    expect(alc?.raw).toBe(64);
    expect(alc?.percent).toBeCloseTo((64 / 255) * 100);
    expect(alc?.alert).toBe(false);
  });
});
