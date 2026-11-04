//! TX-5DR experimental MSK40 (40 ms shorthand) physical-layer primitives.
//! Independent of the mfsk-core 72 ms MSK144 standard-frame implementation.
//! WSJT-X references: genmsk40.f90, encode_msk40.f90, nhash.c.
//!
//! IMPORTANT: known-calls offline matched-waveform decoding is not the full
//! WSJT-X msk40spd/bpdecode40 receiver. Do not route this to physical PTT
//! or claim MSK40 P9 support without full decoder/equalizer acceptance.

const FS: usize = 12_000;
const NSPS: usize = 6;
const FRAME_TONES: usize = 40;
const FRAME_SAMPLES: usize = FRAME_TONES * NSPS;
const GENERATOR: [u16; 16] = [
    0x4428, 0x5a6b, 0x1b04, 0x2c12, 0x60c4, 0x1071, 0xbe6a, 0x36dd,
    0xc580, 0xad9a, 0xeca2, 0x7843, 0x332e, 0xa685, 0x5906, 0x1efe,
];
const COLORDER: [usize; 32] = [
    4, 1, 2, 3, 0, 8, 6, 10, 13, 28, 20, 23, 17, 15, 27, 25,
    16, 12, 18, 19, 7, 21, 22, 11, 24, 5, 26, 14, 9, 29, 30, 31,
];
const SYNC: [u8; 8] = [1, 0, 1, 1, 0, 0, 0, 1];
const REPORTS: [&str; 16] = [
    "-03", "+00", "+03", "+06", "+10", "+13", "+16",
    "R-03", "R+00", "R+03", "R+06", "R+10", "R+13", "R+16", "RRR", "73",
];

// WSJT-X hash(string, 37, init=146) uses Bob Jenkins lookup3 and masks
// its result to 12 bits; FT8 ihashcall uses a DIFFERENT algorithm.
fn mix(a: &mut u32, b: &mut u32, c: &mut u32) {
    *a = a.wrapping_sub(*c); *a ^= c.rotate_left(4); *c = c.wrapping_add(*b);
    *b = b.wrapping_sub(*a); *b ^= a.rotate_left(6); *a = a.wrapping_add(*c);
    *c = c.wrapping_sub(*b); *c ^= b.rotate_left(8); *b = b.wrapping_add(*a);
    *a = a.wrapping_sub(*c); *a ^= c.rotate_left(16); *c = c.wrapping_add(*b);
    *b = b.wrapping_sub(*a); *b ^= a.rotate_left(19); *a = a.wrapping_add(*c);
    *c = c.wrapping_sub(*b); *c ^= b.rotate_left(4); *b = b.wrapping_add(*a);
}
fn final_mix(a: &mut u32, b: &mut u32, c: &mut u32) {
    *c ^= *b; *c = c.wrapping_sub(b.rotate_left(14));
    *a ^= *c; *a = a.wrapping_sub(c.rotate_left(11));
    *b ^= *a; *b = b.wrapping_sub(a.rotate_left(25));
    *c ^= *b; *c = c.wrapping_sub(b.rotate_left(16));
    *a ^= *c; *a = a.wrapping_sub(c.rotate_left(4));
    *b ^= *a; *b = b.wrapping_sub(a.rotate_left(14));
    *c ^= *b; *c = c.wrapping_sub(b.rotate_left(24));
}

fn valid_call(call: &str) -> Option<String> {
    let c = call.trim().to_ascii_uppercase();
    if c.len() < 3 || c.len() > 12 || !c.bytes().all(|x|
        x.is_ascii_uppercase() || x.is_ascii_digit() || x == b'/') {
        return None;
    }
    Some(c)
}

fn pair_hash(calls: &str) -> u16 {
    let mut bytes = [b' '; 37];
    let raw = calls.as_bytes();
    bytes[..raw.len()].copy_from_slice(raw);
    let init = 0xdead_beefu32.wrapping_add(37).wrapping_add(146);
    let (mut a, mut b, mut c) = (init, init, init);
    for block in bytes[..36].chunks_exact(12) {
        a = a.wrapping_add(u32::from_le_bytes(block[0..4].try_into().unwrap()));
        b = b.wrapping_add(u32::from_le_bytes(block[4..8].try_into().unwrap()));
        c = c.wrapping_add(u32::from_le_bytes(block[8..12].try_into().unwrap()));
        mix(&mut a, &mut b, &mut c);
    }
    a = a.wrapping_add(bytes[36] as u32);
    final_mix(&mut a, &mut b, &mut c);
    (c & 0x0fff) as u16
}

fn shorthand_bits(hash12: u16, report: usize) -> [u8; 40] {
    let value = (hash12 << 4) | (report as u16);
    let mut message = [0u8; 16];
    for (i, bit) in message.iter_mut().enumerate() {
        *bit = ((value >> i) & 1) as u8; // Fortran message(i)=ishft(ig,1-i)
    }
    let mut reordered = [0u8; 32];
    for (i, row) in GENERATOR.iter().enumerate() {
        let mut parity = 0u8;
        for (j, bit) in message.iter().enumerate() {
            parity ^= *bit & (((row >> (15-j)) & 1) as u8);
        }
        reordered[COLORDER[i]] = parity;
    }
    for j in 0..16 { reordered[COLORDER[16+j]] = message[j]; }
    let mut bits = [0u8; 40];
    bits[..8].copy_from_slice(&SYNC);
    bits[8..].copy_from_slice(&reordered);
    bits
}

fn tones(hash12: u16, report: usize) -> [u8; 40] {
    let bits = shorthand_bits(hash12, report);
    let sign = |i: usize| 2 * bits[i] as i32 - 1;
    let mut out = [0u8; 40];
    for i in 0..20 {
        let t1 = (sign(2*i+1)*sign(2*i)+1)/2;
        let t2 = -(sign(2*i+1)*sign((2*i+2)%40)-1)/2;
        out[2*i] = (1-t1) as u8;
        out[2*i+1] = (1-t2) as u8;
    }
    out
}

fn phases(tones: &[u8; 40]) -> [f64; FRAME_SAMPLES] {
    let mut phi=0.0f64;
    let mut out=[0.0f64; FRAME_SAMPLES];
    for (k, phase) in out.iter_mut().enumerate() {
        phi += core::f64::consts::TAU*(1000.0+1000.0*f64::from(tones[k/NSPS]))/FS as f64;
        if phi > core::f64::consts::TAU { phi -= core::f64::consts::TAU; }
        *phase = phi;
    }
    out
}

pub fn synthesize(call1: &str, call2: &str, report: &str, period_s: u32) -> Option<Vec<f32>> {
    if ![5,10,15,30].contains(&period_s) { return None; }
    let a=valid_call(call1)?;
    let b=valid_call(call2)?;
    let report_idx=REPORTS.iter().position(|r| r.eq_ignore_ascii_case(report.trim()))?;
    let hash=pair_hash(&format!("{a} {b}"));
    let frame=tones(hash,report_idx);
    let length=(period_s as usize)*FS-6000;
    let mut phi=0.0f64;
    let mut amplitude=0.7f64;
    let mut audio=Vec::with_capacity(length);
    for k in 0..length {
        let tone=frame[(k/NSPS)%FRAME_TONES];
        phi += core::f64::consts::TAU*(1000.0+1000.0*f64::from(tone))/FS as f64;
        if phi>core::f64::consts::TAU { phi-=core::f64::consts::TAU; }
        if k>=length.saturating_sub(204) { amplitude*=0.98f64.powi(4); }
        audio.push((amplitude*phi.sin()) as f32);
    }
    Some(audio)
}

/// Only the *known-call* offline receiver. Normalise correlations against
/// every one of the 16 valid report codewords and do NOT guess unknown hashes.
/// Caller must not expose this as general on-air RX acceptance.
pub fn decode_known_calls(pcm: &[f32], call1: &str, call2: &str) -> Option<String> {
    let a=valid_call(call1)?;
    let b=valid_call(call2)?;
    if pcm.len()<FRAME_SAMPLES*3 || pcm.iter().any(|s| !s.is_finite()) { return None; }
    let hash=pair_hash(&format!("{a} {b}"));
    let refs: Vec<([f64;FRAME_SAMPLES],[f64;FRAME_SAMPLES],f64)> = (0..16).map(|r|{
        let p=phases(&tones(hash,r));
        let mut sin=[0.0f64;FRAME_SAMPLES];
        let mut cos=[0.0f64;FRAME_SAMPLES];
        let mut norm=0.0f64;
        for k in 0..FRAME_SAMPLES {
            sin[k]=p[k].sin(); cos[k]=p[k].cos(); norm+=sin[k]*sin[k];
        }
        (sin,cos,norm)
    }).collect();
    // Track a maximum over offsets PER report. Adjacent offsets of the
    // same report are not independent candidates for runner-up rejection.
    let mut scores=[0.0f64;16];
    // Sliding by one sample allows arbitrary receive-phase alignment.
    // A bounded initial 1-second acquisition window keeps CPU use finite.
    let search_limit=pcm.len().saturating_sub(FRAME_SAMPLES).min(FS);
    for offset in 0..=search_limit {
        if offset%3!=0 { continue; }
        let slice=&pcm[offset..offset+FRAME_SAMPLES];
        let energy=slice.iter().map(|x| f64::from(*x)*f64::from(*x)).sum::<f64>();
        if energy<0.001 { continue; }
        for (idx,(sin,cos,norm)) in refs.iter().enumerate() {
            let mut si=0.0f64;let mut co=0.0f64;
            for k in 0..FRAME_SAMPLES {
                si+=f64::from(slice[k])*sin[k];
                co+=f64::from(slice[k])*cos[k];
            }
            let score=(si*si+co*co).sqrt()/(energy*norm).sqrt();
            if score>scores[idx] {scores[idx]=score;}
        }
    }
    let mut ranks:Vec<(usize,f64)>=scores.iter().copied().enumerate().collect();
    ranks.sort_by(|a,b| b.1.total_cmp(&a.1));
    let winner=ranks[0];
    if winner.1<0.90 || winner.1-ranks[1].1<0.05 { return None; }
    Some(format!("<{a} {b}> {}",REPORTS[winner.0]))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parity_and_sync_bits_are_deterministic() {
        let bits=shorthand_bits(0xabc,15);
        assert_eq!(&bits[..8],&SYNC);
        for i in 0..16 { assert_eq!(bits[8+COLORDER[16+i]],((0xabcfu16 >> i)&1) as u8); }
    }
    #[test]
    fn known_call_shorthand_round_trip_and_noise_rejection() {
        let tx=synthesize("K1ABC","W9XYZ","RRR",5).unwrap();
        assert_eq!(tx.len(),54_000);
        assert_eq!(decode_known_calls(&tx,"K1ABC","W9XYZ").as_deref(),Some("<K1ABC W9XYZ> RRR"));
        assert_eq!(decode_known_calls(&vec![0.0;720],"K1ABC","W9XYZ"),None);
        assert_eq!(decode_known_calls(&tx,"K1ABC","K2ABC"),None);
    }
}
