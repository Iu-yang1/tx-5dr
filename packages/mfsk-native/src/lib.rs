//! Experimental multimode native oracle. This package is not wired into the
//! physical TX pipeline until the P3-P9 integration gates have passed.
//! PCM transport is a little-endian f32 Buffer at exactly 12,000 Hz.
use mfsk_core::{
    decoder::{AnyDecoder, SlotInput, Depth},
    encoder::{encode, TxAudio},
    registry::Mode,
};
use napi::{bindgen_prelude::Buffer, Error, Result, Status};
use napi_derive::napi;
use std::sync::Arc;

#[napi(object)]
pub struct Waveform {
    pub canonical_text: String,
    pub sample_rate: u32,
    pub sample_count: u32,
    /// Interleaving is not permitted: mono f32 little-endian bytes.
    pub pcm_f32_le: Buffer,
}

#[napi(object)]
pub struct NativeDecodeRow {
    pub text: String,
    pub frequency_hz: f64,
    pub snr_db: f64,
    pub dt_seconds: f64,
}

#[napi(object)]
pub struct NativeJttyUpdate {
    pub id: String,
    pub text: String,
    pub state: String,
    pub frequency_hz: f64,
    pub start_seconds: f64,
    pub end_seconds: f64,
    pub snr_db: f64,
}

fn invalid(reason: impl Into<String>) -> Error {
    Error::new(Status::InvalidArg, reason.into())
}

fn validate_audio_frequency(f0: f64) -> Result<f32> {
    if !f0.is_finite() || !(100.0..=5500.0).contains(&f0) {
        return Err(invalid("audio carrier must be finite and between 100 and 5500 Hz"));
    }
    Ok(f0 as f32)
}

fn to_pcm(audio: Vec<f32>, canonical_text: String) -> Result<Waveform> {
    if audio.is_empty() || audio.len() > (12_000 * 310) {
        return Err(invalid("empty or oversized waveform"));
    }
    if !audio.iter().all(|x| x.is_finite()) {
        return Err(invalid("non-finite waveform samples"));
    }
    let mut bytes = Vec::with_capacity(audio.len() * 4);
    for sample in audio.iter() {
        bytes.extend_from_slice(&sample.to_le_bytes());
    }
    Ok(Waveform {
        canonical_text,
        sample_rate: 12_000,
        sample_count: u32::try_from(audio.len()).map_err(|_| invalid("waveform too large"))?,
        pcm_f32_le: Buffer::from(bytes),
    })
}

fn from_pcm(pcm: &Buffer) -> Result<Vec<f32>> {
    if pcm.len() % 4 != 0 || pcm.len() > 12_000 * 310 * 4 {
        return Err(invalid("PCM must be f32 little-endian mono at 12 kHz, <=310 seconds"));
    }
    let samples: Vec<f32> = pcm.chunks_exact(4)
        .map(|s| f32::from_le_bytes([s[0], s[1], s[2], s[3]]))
        .collect();
    if !samples.iter().all(|s| s.is_finite()) {
        return Err(invalid("PCM contains NaN or infinity"));
    }
    Ok(samples)
}

#[napi]
pub fn codec_version() -> String {
    "mfsk-core/0.15.0; tx5dr-napi/0.1.0".to_owned()
}

#[napi]
pub fn supported_modes() -> Vec<String> {
    let mut modes: Vec<String> = Mode::ALL.iter().map(|m| m.name().to_owned()).collect();
    modes.push("MSK144".to_owned());
    modes.push("JTTY".to_owned());
    modes
}

/// Encodes FT8, FT4, WSPR or an exact Q65-xx submode (e.g. Q65-60B).
/// Message canonicalisation is intentionally returned: the caller must compare
/// requested text with transmitted text before granting PTT.
#[napi]
pub fn encode_slotted(mode: String, text: String, audio_hz: f64) -> Result<Waveform> {
    let f0 = validate_audio_frequency(audio_hz)?;
    let protocol = Mode::from_name(&mode)
        .ok_or_else(|| invalid(format!("unsupported slotted protocol: {mode}")))?;
    let tx = encode(protocol, &text).map_err(|e| invalid(e.to_string()))?;
    to_pcm(tx.synthesize(&TxAudio::new(12_000, f0)), tx.text().to_owned())
}

#[napi]
pub fn decode_slotted(mode: String, pcm_f32_le: Buffer) -> Result<Vec<NativeDecodeRow>> {
    let protocol = Mode::from_name(&mode)
        .ok_or_else(|| invalid(format!("unsupported slotted protocol: {mode}")))?;
    let samples = from_pcm(&pcm_f32_le)?;
    let mut decoder = AnyDecoder::with_defaults(protocol);
    let result = decoder.decode(&SlotInput::f32(&samples));
    Ok(result.rows.into_iter().map(|r| NativeDecodeRow {
        text: r.decoded.text,
        frequency_hz: f64::from(r.decoded.freq_hz),
        snr_db: f64::from(r.decoded.snr_db),
        dt_seconds: f64::from(r.decoded.dt_sec),
    }).collect())
}

/// JTTY (non-slotted) message encoder; the user-facing TX scheduler must
/// provide PTT and stop conditions, rather than using a fixed FT8 slot.
#[napi]
pub fn encode_jtty(text: String, audio_hz: f64) -> Result<Waveform> {
    let f0 = validate_audio_frequency(audio_hz)?;
    use mfsk_core::jtty::{pack::{tones, ExchangeProfile}, tx};
    let symbols = tones(&text, ExchangeProfile::Unknown)
        .map_err(|e| invalid(format!("JTTY pack failure: {e:?}")))?
        .ok_or_else(|| invalid("JTTY text has no valid frames"))?;
    to_pcm(tx::synth_f32(&symbols, f0, 0.7), mfsk_core::jtty::pack::normalize(&text))
}

/// Single-buffer offline oracle. A persistent JTTY session will be exposed
/// separately before real-time UI integration: do not call this once per chunk.
#[napi]
pub fn decode_jtty_recording(pcm_f32_le: Buffer, audio_hz: f64) -> Result<Vec<NativeJttyUpdate>> {
    let f0 = validate_audio_frequency(audio_hz)?;
    let input = from_pcm(&pcm_f32_le)?;
    let pcm: Vec<i16> = input.iter().map(|&s| (s * 32767.0).round().clamp(-32768.0, 32767.0) as i16).collect();
    use mfsk_core::jtty::{rx::{Receiver, Stream, Params}, assemble::UpdateKind};
    let mut params = Params::default();
    params.f0_hz = f0;
    let mut stream = Stream::new(Arc::new(Receiver::new()), params);
    let mut updates = Vec::new();
    let mut on_update = |u: mfsk_core::jtty::assemble::MessageUpdate| {
        let state = match u.kind {
            UpdateKind::Growing => "growing",
            UpdateKind::Complete => "complete",
            UpdateKind::Expired => "expired",
            UpdateKind::ReceptionEnded => "reception-ended",
        };
        updates.push(NativeJttyUpdate {
            id: u.id.to_string(), text: u.text, state: state.to_owned(),
            frequency_hz: u.f1_hz as f64, start_seconds: u.start_s,
            end_seconds: u.end_s, snr_db: u.snr_db as f64,
        });
    };
    stream.push(&pcm, &mut on_update);
    stream.finish(&mut on_update);
    Ok(updates)
}

/// MSK144 standard-message modulator; 5/10/15/30 s schedules and repeated
/// waveform policy belong to the TX runtime, not to this native package.
#[napi]
pub fn encode_msk144_standard(
    call1: String, call2: String, report: String, period_s: u32,
) -> Result<Waveform> {
    if ![5, 10, 15, 30].contains(&period_s) {
        return Err(invalid("MSK144 period must be 5, 10, 15 or 30 s"));
    }
    let pcm = mfsk_core::msk144::tx::synthesize_standard(
        &call1, &call2, &report, period_s, 0.7
    ).ok_or_else(|| invalid("unsupported MSK144 standard message"))?;
    to_pcm(pcm, format!("{call1} {call2} {report}"))
}

/// Offline MSK144 burst oracle. Production will use the persistent stream
/// and pass each 0.6 s window through a dedicated worker.
#[napi]
pub fn decode_msk144_recording(pcm_f32_le: Buffer, audio_hz: f64) -> Result<Vec<NativeDecodeRow>> {
    let f0 = validate_audio_frequency(audio_hz)?;
    let input = from_pcm(&pcm_f32_le)?;
    let pcm: Vec<i16> = input.iter().map(|&s| (s * 32767.0).round().clamp(-32768.0, 32767.0) as i16).collect();
    let mut stream = mfsk_core::msk144::decode::Stream::new(f0, 200.0, Depth::Deep, None);
    let mut rows = Vec::new();
    stream.push(&pcm, &mut |r| rows.push(NativeDecodeRow {
        text: r.message, frequency_hz: r.freq_hz as f64,
        snr_db: r.snr_db as f64, dt_seconds: r.t_s,
    }));
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn supports_all_six_mode_families() {
        let m = supported_modes();
        for id in ["FT8", "FT4", "WSPR", "Q65-60B", "MSK144", "JTTY"] {
            assert!(m.iter().any(|s| s == id));
        }
    }

    #[test]
    fn buffers_are_rejected_when_non_finite() {
        assert!(from_pcm(&Buffer::from(f32::NAN.to_le_bytes().to_vec())).is_err());
    }
}
