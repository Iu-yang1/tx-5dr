import { describe, expect, it } from 'vitest';
import { DEFAULT_DECODE_WINDOW_SETTINGS } from '@tx5dr/contracts';
import {
  buildQuickDecodeSettings,
  decodeQuickDraft,
} from './DigitalModeQuickSettings';

describe('classic decoder quick settings', () => {
  it('reads the shared depth and FT8 window preset without mutating defaults', () => {
    const draft = decodeQuickDraft('FT8', DEFAULT_DECODE_WINDOW_SETTINGS);
    expect(draft).toMatchObject({ depth: 3, preset: 'balanced' });
    expect(draft.windows).toEqual([-3200, -1500, -300]);
    draft.windows[0] = -1000;
    expect(DEFAULT_DECODE_WINDOW_SETTINGS.ft8?.preset).toBe('balanced');
  });

  it('updates only the selected mode while retaining the other modes and depth', () => {
    const current = {
      decodeDepth: 1,
      ft8: { preset: 'lightweight' as const },
      ft4: { preset: 'custom' as const, customWindowTiming: [-1500, 0] },
    };
    const next = buildQuickDecodeSettings('FT8', current, {
      depth: 2, preset: 'custom', windows: [-300, -3200, -1500],
      tuning: { threads: 2, apMode: 'cq-only', strategy: 'sic3', syncMin: 1.5, maxCandidates: 250 },
    });
    expect(next).toEqual({
      decodeDepth: 1,
      ft8: { decodeDepth: 2,
        tuning: { threads: 2, apMode: 'cq-only', strategy: 'sic3', syncMin: 1.5, maxCandidates: 250 },
        preset: 'custom', customWindowTiming: [-3200, -1500, -300] },
      ft4: current.ft4,
    });
    expect(current.ft8).toEqual({ preset: 'lightweight' });
  });

  it('rejects the unsupported FT4 minimum setting', () => {
    expect(() => buildQuickDecodeSettings('FT4', DEFAULT_DECODE_WINDOW_SETTINGS, {
      depth: 3, preset: 'minimum', windows: [-300], tuning: {},
    })).toThrow(/FT4/);
  });

  it('validates that an FT8 early strategy cannot reach FT4', () => {
    expect(() => buildQuickDecodeSettings('FT4', DEFAULT_DECODE_WINDOW_SETTINGS, {
      depth: 2, preset: 'balanced', windows: [-1500, 0],
      tuning: { strategy: 'early' },
    })).toThrow(/FT4/);
  });

  it('preserves FT8 when changing FT4 decode strategy', () => {
    const next = buildQuickDecodeSettings('FT4', {
      decodeDepth: 3,
      ft8: { preset: 'maximum' },
      ft4: { preset: 'balanced' },
    }, { depth: 1, preset: 'lightweight', windows: [0], tuning: { apMode: 'off' } });
    expect(next.ft8?.preset).toBe('maximum');
    expect(next.ft4).toEqual({ preset: 'lightweight', decodeDepth: 1, tuning: { apMode: 'off' } });
    expect(next.decodeDepth).toBe(3);
  });
});
