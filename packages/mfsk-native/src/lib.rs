//! Experimental multimode native oracle. This package is not wired into the
//! physical TX pipeline until the P3-P9 integration gates have passed.
//! PCM transport is a little-endian f32 Buffer at exactly 12,000 Hz.
use mfsk_core::{
    decoder::{AnyDecoder, AnyExtras, SlotInput, Depth},
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
    "mfsk-core/0.15.1; tx5dr-fork/ba92290fca5e; tx5dr-napi/0.1.0".to_owned()
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
    configure_slot_decoder(&mode, &mut decoder);
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
            _ => "reception-ended", // v0.15 UpdateKind is non-exhaustive
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


/// Experimental MSK40 40 ms shorthand TX vector, not a physical PTT capability.
/// MSK144 standard frames and this 32/16 LDPC shorthand are different formats.
#[napi]
pub fn encode_msk40_shorthand(
    call1: String, call2: String, report: String, period_s: u32,
) -> Result<Waveform> {
    let pcm=mfsk_core::msk144::msk40::synthesize(&call1,&call2,&report,period_s)
        .ok_or_else(|| invalid("invalid MSK40 call, report or T/R period"))?;
    to_pcm(pcm,format!("<{} {}> {}",call1.trim().to_ascii_uppercase(),
        call2.trim().to_ascii_uppercase(),report.trim().to_ascii_uppercase()))
}

/// Known-call offline MSK40 reference-only decoder. Not a full short-ping RX.
#[napi]
pub fn decode_msk40_known_calls(
    pcm_f32_le: Buffer, call1: String, call2: String,
) -> Result<Option<String>> {
    let pcm=from_pcm(&pcm_f32_le)?;
    Ok(mfsk_core::msk144::msk40::decode_known_calls(&pcm,&call1,&call2))
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

/// Apply reference-calibrated searches to the actual TX-5DR decoder.
/// No message-specific filters or goldens enter the production DSP path.
fn configure_slot_decoder(mode: &str, decoder: &mut AnyDecoder) {
    match mode {
        "WSPR" => decoder.params_mut().band_hz = (1400.0, 1620.0),
        name if name.starts_with("Q65-") => decoder.params_mut().band_hz = (200.0, 3000.0),
        _ => {}
    }
    match decoder.extras_mut() {
        AnyExtras::Wspr(options) => {
            // wsprd's 10,000 Fano cycles/bit are needed for the -23 dB
            // G8VDQ reference signal; GUI Deep defaults to only 500.
            options.max_cycles_per_bit = Some(10_000);
            options.search.max_candidates = Some(100);
            options.search.score_threshold = Some(0.05);
        }
        AnyExtras::Q65(options) => {
            // Wide time search recovers off-air 60A EME signals that
            // a narrow nominal-slot default misses.
            let period_sec = mode.trim_start_matches("Q65-")
                .chars().take_while(|c| c.is_ascii_digit())
                .collect::<String>().parse::<f32>().unwrap_or(60.0);
            let tolerance_sec = (period_sec / 2.0).clamp(7.5, 150.0);
            options.search.time_tolerance_early_sec = Some(tolerance_sec);
            options.search.time_tolerance_late_sec = Some(tolerance_sec);
            options.search.score_threshold = Some(0.05);
            options.search.max_candidates = Some(16);
        }
        _ => {}
    }
}

/// Persistent per-channel, per-mode receiver. The Node worker owns these
/// handles and must cancel/dispose the session when its generation changes.
#[napi]
pub struct SlottedSession {
    mode: String,
    inner: std::sync::Mutex<AnyDecoder>,
}

#[napi]
impl SlottedSession {
    #[napi(constructor)]
    pub fn new(mode: String) -> Result<Self> {
        let protocol = Mode::from_name(&mode)
            .ok_or_else(|| invalid(format!("unknown slotted mode: {mode}")))?;
        let mut decoder = AnyDecoder::with_defaults(protocol);
        configure_slot_decoder(&mode, &mut decoder);
        Ok(Self { mode, inner: std::sync::Mutex::new(decoder) })
    }

    #[napi]
    pub fn decode(
        &self, pcm_f32_le: Buffer, period_index: Option<i32>, early_prefix: Option<bool>,
    ) -> Result<Vec<NativeDecodeRow>> {
        let prefix = early_prefix.unwrap_or(false);
        if prefix && self.mode != "FT8" {
            return Err(invalid("early-prefix state is currently implemented only for FT8"));
        }
        let audio = from_pcm(&pcm_f32_le)?;
        let mut slot = SlotInput::f32(&audio);
        slot.period = period_index.map(i64::from);
        let mut decoder = self.inner.lock().map_err(|_| invalid("decoder lock poisoned"))?;
        let decoded = if prefix { decoder.decode_prefix(&slot) } else { decoder.decode(&slot) };
        Ok(decoded.rows.into_iter().map(|r| NativeDecodeRow {
            text: r.decoded.text,
            frequency_hz: r.decoded.freq_hz as f64,
            snr_db: r.decoded.snr_db as f64,
            dt_seconds: r.decoded.dt_sec as f64,
        }).collect())
    }

    #[napi]
    pub fn set_parameters(&self, depth: u32, averaging: bool, rx_hz: Option<f64>, tolerance_hz: Option<f64>) -> Result<()> {
        let depth = match depth {
            1 => Depth::Fast,
            2 => Depth::Normal,
            3 => Depth::Deep,
            _ => return Err(invalid("decode depth must be 1, 2 or 3")),
        };
        let mut d = self.inner.lock().map_err(|_| invalid("decoder lock poisoned"))?;
        let params = d.params_mut();
        params.depth = depth;
        params.averaging = averaging;
        if let Some(f) = rx_hz {
            let f = validate_audio_frequency(f)?;
            params.rx_freq_hz = Some(f);
            if self.mode == "WSPR" {
                params.band_hz = ((f - 110.0).max(100.0), (f + 110.0).min(5500.0));
            }
        }
        if let Some(t) = tolerance_hz {
            if !t.is_finite() || t <= 0.0 || t > 5000.0 {
                return Err(invalid("invalid frequency tolerance"));
            }
            params.tol_hz = Some(t as f32);
        }
        Ok(())
    }

    /// Affects Q65/JT65 emedelay only when the caller explicitly enables it.
    #[napi]
    pub fn set_eme_delay(&self, enabled: bool) -> Result<()> {
        self.inner.lock().map_err(|_| invalid("decoder lock poisoned"))?
            .params_mut().eme_delay = enabled;
        Ok(())
    }

    /// Transmit/QSO context is explicit and is cleared when absent by the host.
    /// This mirrors the station and QSO hypothesis fields of DecodeParams.
    #[napi]
    pub fn set_ap_context(
        &self,
        my_call: String, my_grid: String,
        dx_call: String, dx_grid: String,
        progress: u32, enabled: bool,
    ) -> Result<()> {
        use mfsk_core::decoder::{ApMode, QsoProgress, Station, QsoContext};
        let state = match progress {
            0 => QsoProgress::Calling,
            1 => QsoProgress::Replying,
            2 => QsoProgress::Report,
            3 => QsoProgress::RogerReport,
            4 => QsoProgress::Rogers,
            5 => QsoProgress::Signoff,
            _ => return Err(invalid("QSO progress must be between 0 and 5")),
        };
        let mut decoder = self.inner.lock().map_err(|_| invalid("decoder lock poisoned"))?;
        let params = decoder.params_mut();
        params.station = Station::new(&my_call, &my_grid);
        params.qso = QsoContext::new(&dx_call, &dx_grid, state);
        params.ap = if enabled { ApMode::Full } else { ApMode::Off };
        Ok(())
    }

    #[napi]
    pub fn clear(&self) -> Result<()> {
        self.inner.lock().map_err(|_| invalid("decoder lock poisoned"))?.clear();
        Ok(())
    }
}

/// A persistent continuous receiver: JTTY messages have stable identifiers
/// and are emitted on growing, completed, expired, and end-of-reception updates.
#[napi]
pub struct JttySession {
    inner: std::sync::Mutex<mfsk_core::jtty::rx::Stream>,
}

#[napi]
impl JttySession {
    #[napi(constructor)]
    pub fn new(audio_hz: f64) -> Result<Self> {
        let mut p = mfsk_core::jtty::rx::Params::default();
        p.f0_hz = validate_audio_frequency(audio_hz)?;
        let rx = mfsk_core::jtty::rx::Stream::new(Arc::new(mfsk_core::jtty::rx::Receiver::new()), p);
        Ok(Self { inner: std::sync::Mutex::new(rx) })
    }

    #[napi]
    pub fn push(&self, pcm_f32_le: Buffer) -> Result<Vec<NativeJttyUpdate>> {
        let audio = from_pcm(&pcm_f32_le)?;
        let pcm: Vec<i16> = audio.iter().map(|&s| (s * 32767.0).round().clamp(-32768.0,32767.0) as i16).collect();
        let mut updates = Vec::new();
        let mut guard = self.inner.lock().map_err(|_| invalid("JTTY receiver lock poisoned"))?;
        guard.push(&pcm, &mut |u| updates.push(jtty_update(u)));
        Ok(updates)
    }

    #[napi]
    pub fn finish(&self) -> Result<Vec<NativeJttyUpdate>> {
        let mut updates = Vec::new();
        self.inner.lock().map_err(|_| invalid("JTTY receiver lock poisoned"))?
            .finish(&mut |u| updates.push(jtty_update(u)));
        Ok(updates)
    }

    #[napi]
    pub fn reset(&self) -> Result<()> {
        self.inner.lock().map_err(|_| invalid("JTTY receiver lock poisoned"))?.reset();
        Ok(())
    }
}

fn jtty_update(u: mfsk_core::jtty::assemble::MessageUpdate) -> NativeJttyUpdate {
    use mfsk_core::jtty::assemble::UpdateKind;
    let state = match u.kind {
        UpdateKind::Growing => "growing",
        UpdateKind::Complete => "complete",
        UpdateKind::Expired => "expired",
        UpdateKind::ReceptionEnded => "reception-ended",
        _ => "reception-ended",
    };
    NativeJttyUpdate {
        id: u.id.to_string(), text: u.text, state: state.to_owned(),
        frequency_hz: u.f1_hz as f64, start_seconds: u.start_s,
        end_seconds: u.end_s, snr_db: u.snr_db as f64,
    }
}

/// Guarded adaptive MSK144 session equalizer training status.
#[napi(object)]
pub struct NativeMsk144EqualizerStatus {
    pub enabled: bool,
    pub trained: bool,
    pub training_frames: u32,
    pub residual_rms_rad: f64,
    pub coefficients: Vec<f64>,
}

/// MSK144 is an inherently sliding-window stream; the UI must not wait for
/// an FT-style complete decode window before publishing the ping.
#[napi]
pub struct Msk144Session {
    inner: std::sync::Mutex<mfsk_core::msk144::decode::Stream>,
}

#[napi]
impl Msk144Session {
    #[napi(constructor)]
    pub fn new(audio_hz: f64, tolerance_hz: f64) -> Result<Self> {
        let f = validate_audio_frequency(audio_hz)?;
        if !tolerance_hz.is_finite() || tolerance_hz <= 0.0 || tolerance_hz > 5000.0 {
            return Err(invalid("invalid MSK144 tolerance"));
        }
        Ok(Self {
            inner: std::sync::Mutex::new(
                mfsk_core::msk144::decode::Stream::new(f,tolerance_hz as f32,Depth::Deep,None)
            ),
        })
    }

    #[napi]
    pub fn push(&self, pcm_f32_le: Buffer) -> Result<Vec<NativeDecodeRow>> {
        let audio = from_pcm(&pcm_f32_le)?;
        let pcm: Vec<i16> = audio.iter().map(|&s| (s * 32767.0).round().clamp(-32768.0,32767.0) as i16).collect();
        let mut rows = Vec::new();
        self.inner.lock().map_err(|_| invalid("MSK144 receiver lock poisoned"))?
            .push(&pcm, &mut |r| rows.push(NativeDecodeRow {
                text:r.message, frequency_hz:r.freq_hz as f64, snr_db:r.snr_db as f64,dt_seconds:r.t_s,
            }));
        Ok(rows)
    }

    /// Only meaningful when a real DX callsign and positive user intent
    /// are supplied. No automatic training or cross-station coefficients.
    #[napi]
    pub fn configure_equalizer(&self, enabled: bool, dx_call: String) -> Result<()> {
        self.inner.lock().map_err(|_| invalid("MSK144 receiver lock poisoned"))?
            .configure_equalizer(enabled,&dx_call);
        Ok(())
    }

    #[napi]
    pub fn equalizer_status(&self) -> Result<NativeMsk144EqualizerStatus> {
        let s=self.inner.lock().map_err(|_| invalid("MSK144 receiver lock poisoned"))?
            .equalizer_status();
        Ok(NativeMsk144EqualizerStatus {
            enabled:s.enabled,trained:s.trained,training_frames:s.training_frames,
            residual_rms_rad:if s.residual_rms_rad.is_finite(){s.residual_rms_rad}else{-1.0},
            coefficients:s.coefficients.to_vec(),
        })
    }

    /// Optional 40 ms shorthand decode inside MSK144. Only accepted against
    /// an explicit known pair, never unidentified SWL hash guesses.
    #[napi]
    pub fn configure_shorthand(&self, enabled:bool, call1:String,call2:String)->Result<()> {
        self.inner.lock().map_err(|_| invalid("MSK144 receiver lock poisoned"))?
            .configure_shorthand(enabled,&call1,&call2);
        Ok(())
    }

    #[napi]
    pub fn new_period(&self) -> Result<()> {
        self.inner.lock().map_err(|_| invalid("MSK144 receiver lock poisoned"))?.new_period();
        Ok(())
    }

    #[napi]
    pub fn reset(&self) -> Result<()> {
        self.inner.lock().map_err(|_| invalid("MSK144 receiver lock poisoned"))?.reset();
        Ok(())
    }
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
