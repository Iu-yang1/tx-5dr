import { describe, expect, it } from 'vitest';
import {
  buildFrequencyOperatingStateRequest,
  resolveFrequencyRadioMode,
} from '../frequencyRadioMode.js';

describe('digital CAT mode preference across all codec families', () => {
  it.each(['FT8', 'FT4', 'Q65', 'MSK144', 'WSPR', 'JTTY'])(
    'honours USB-DATA on %s without silently reverting to SSB microphone input',
    (effectiveMode) => {
      expect(resolveFrequencyRadioMode({
        effectiveMode, requestedRadioMode: 'USB', engineMode: 'digital',
        digitalModeRadioMode: 'usb-data',
      })).toEqual({
        displayRadioMode: 'USB-DATA',
        writeRadioMode: 'USB',
        modeOptions: { intent: 'digital' },
      });
      expect(buildFrequencyOperatingStateRequest({
        frequency: 14_074_000, effectiveMode, radioMode: 'USB',
        engineMode: 'digital', digitalModeRadioMode: 'usb-data',
      })).toMatchObject({
        frequency: 14_074_000,
        mode: 'USB',
        options: { intent: 'digital' },
      });
    },
  );

  it.each(['FT8', 'FT4', 'Q65', 'MSK144', 'WSPR', 'JTTY'])(
    'keeps explicit no-CAT-mode preference for %s',
    (effectiveMode) => {
      expect(resolveFrequencyRadioMode({
        effectiveMode, requestedRadioMode: 'USB', engineMode: 'digital',
        digitalModeRadioMode: 'none',
      })).toEqual({});
    },
  );

  it('does not affect SSB voice mode policy', () => {
    expect(resolveFrequencyRadioMode({
      effectiveMode: 'VOICE', requestedRadioMode: 'LSB', engineMode: 'voice',
      digitalModeRadioMode: 'usb-data',
    })).toEqual({
      displayRadioMode: 'LSB',
      writeRadioMode: 'LSB',
      modeOptions: { intent: 'voice' },
    });
  });
});
