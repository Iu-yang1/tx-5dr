import {
  type NativeDigitalMode, type NativeDecodePreferences,
} from '@tx5dr/contracts';
import type { MfskLiveConfig } from './MfskLiveRxService.js';

/** Only RX-impacting fields affect an active decoder; TX options never restart RX. */
export function nativeRxConfigFromPreferences(
  mode: NativeDigitalMode, prefs: NativeDecodePreferences,
): MfskLiveConfig {
  return {
    mode, frequencyHz: prefs.frequencyHz, toleranceHz: prefs.toleranceHz,
    depth: prefs.depth,
    ...(mode === 'Q65' ? {
      q65Submode: prefs.q65Submode,
      q65Search: {
        ...(prefs.q65TimeToleranceSec !== null ? { timeToleranceSeconds: prefs.q65TimeToleranceSec } : {}),
        ...(prefs.q65SyncScore !== null ? { scoreThreshold: prefs.q65SyncScore } : {}),
        ...(prefs.q65MaxCandidates !== null ? { maxCandidates: prefs.q65MaxCandidates } : {}),
      },
      averaging: prefs.averaging, emeDelay: prefs.emeDelay,
    } : {}),
    ...(mode === 'MSK144' && prefs.mskMyCall && prefs.mskDxCall ? {
      msk144Rx: {
        myCall: prefs.mskMyCall, dxCall: prefs.mskDxCall,
        shorthand: prefs.mskShorthand && prefs.toleranceHz <= 250,
        adaptiveEqualizer: prefs.mskAdaptiveEqualizer,
      },
    } : {}),
  };
}

export function nativeRxTuningFingerprint(
  mode: NativeDigitalMode, prefs: NativeDecodePreferences,
): string {
  return JSON.stringify(nativeRxConfigFromPreferences(mode, prefs));
}
