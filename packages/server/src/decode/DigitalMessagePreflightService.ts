import type { DigitalMessagePreflightRequest, DigitalMessagePreflightResult } from '@tx5dr/plugin-api';
import {
  loadMfskNative, verifyNativeWaveform,
  type MfskNativeLoadResult,
} from './MfskNativeAdapter.js';
import { digitalMessageTextsMatch, normalizeDigitalMessageText } from './digitalMessageValidation.js';

/**
 * A production message preflight must use the SAME native Rust encoder as
 * actual FT8/FT4 transmissions. In particular, do not eagerly import the
 * obsolete reference binary: it is intentionally absent in packaged apps.
 */
export class DigitalMessagePreflightService {
  constructor(private readonly loadCodec: () => MfskNativeLoadResult = loadMfskNative) {}

  async check(request: DigitalMessagePreflightRequest): Promise<DigitalMessagePreflightResult> {
    const requestedText = normalizeDigitalMessageText(request.text);
    if (!requestedText) return { encodable: false, requestedText, reason: 'empty' };
    try {
      const codec = this.loadCodec();
      if (!codec.ready) throw new Error(codec.reason);
      const mode = request.mode === 'FT4' ? 'FT4' : 'FT8';
      const waveform = codec.module.encodeSlotted(mode, requestedText, 1500);
      const transmittedText = normalizeDigitalMessageText(waveform.canonicalText ?? '');
      if (!digitalMessageTextsMatch(requestedText, transmittedText)) {
        return { encodable: false, requestedText, transmittedText, reason: 'encoder_changed_text' };
      }
      if (!waveform.pcmF32Le || waveform.sampleCount === 0) {
        return { encodable: false, requestedText, transmittedText, reason: 'encode_failed', error: 'empty_audio' };
      }
      // Ensure native PCM is finite, bounded, and matches the declared
      // sample rate/count. No malformed waveform may pass preflight.
      verifyNativeWaveform(waveform, requestedText, mode);
      return { encodable: true, requestedText, transmittedText };
    } catch (error) {
      return {
        encodable: false,
        requestedText,
        reason: 'encode_failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
