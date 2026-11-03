# Six-mode codec migration: P0 evidence and acceptance contract

Status: **P0 implementation baseline / P1 contract candidate. Not a completed migration.**

## Fixed upstream and application baselines

- Application: `Iu-yang1/tx-5dr` `main` at `d684a561bf775a91be276049cd49e9642bcce259` (2026-11-03).
- Rust upstream: `jl1nie/mfsk-core` `v0.15.0` at `18b37c068e150541b051944db2a94f30bc6c36af`.
- Legacy production native dependency: `wsjtx-lib@2.2.0` in `packages/server/package.json`. The decode and encode worker implementations directly import this package.
- Desired release: FT8, FT4, Q65 (ten actual submodes), WSPR, MSK144, JTTY; RX and TX for all six. `wsjtx-lib` must not remain a production codec after P9.

## Actual code owners

| Owner | Current restriction | Migration acceptance |
| --- | --- | --- |
| `packages/contracts/src/schema/mode.schema.ts` | FT8 and FT4 slot descriptors; no streaming mode model | New independent digital codec contract; do not expose unimplemented modes to the legacy engine |
| `packages/core/src/clock/SlotScheduler.ts` | `FT4` or `FT8` request, WSJT stages 41/47/49/50 | Preserve FT8/FT4 decision deadlines; use a different scheduler for Q65/WSPR/JTTY/MSK144 |
| `packages/server/src/decode/WSJTXDecodeWorkerCore.ts` | `wsjtx-lib` and per-slot native session | Native Rust worker with explicit lifecycle, isolation and bounded failure cleanup |
| `packages/server/src/decode/WSJTXEncodeWorkQueue.ts` | `wsjtx-lib` FT8/FT4 only, 12.64/6.0 s duration assumptions | Protocol-specific waveform duration without destructive clipping |
| `packages/server/src/decode/WSJTXDecodeProcessPool.ts` | Hardcoded `MODE_SLOT_MS` for FT8 and FT4 | Bounded workers for both streaming and longer slots; no starvation of FT4 |
| `packages/server/src/transmission/DigitalFrameCoordinator.ts` | Slot-bound frame IDs, decision epochs, revision identity | Non-slotted TX leases with the same stale-response and physical PTT protection |
| `packages/server/src/DigitalRadioEngine.ts` | Mode-specific assumptions, FT8/FT4 virtual dial path | Capability gating and actual RF/audio frequency invariants |
| `packages/server/src/audio/AudioStreamManager.ts` | Existing shared capture and playback | Preserve present audio devices; add streaming buffers with explicit resampling and sample timestamps |

## Verified protocol boundary

The `mfsk-ffi` v0.15.0 header provides `mfsk_decoder_*` for slotted modes, `mfsk_jtty_*` and `mfsk_msk144_*` for non-slotted modes, plus separate encoding and synthesis calls. JTTY cannot be forced through the slotted API; the JTTY upstream analysis describes a variable-frame continuous mode. Modes compiled into the native library are **not** equal to operational capabilities in TX-5DR.

Exact Q65 names in mfsk-core are `Q65-15A`, `Q65-30A`, `Q65-60A` through `Q65-60E`, `Q65-120D/E`, and `Q65-300A`. FT8 early-prefix handling is not equivalent to every legacy 41/47/49/50 checkpoint; a silent remap is forbidden.

## Release licensing blocker

The repository root `LICENSE` is GNU GPL version 3, but its root `package.json` advertises `"license": "MIT"`. `mfsk-core v0.15.0` declares `GPL-3.0-only`. Resolve package and published-artifact metadata consistently with actual upstream files and dependency licenses before a public P9 release. Do **not** silently edit ownership or license declarations on the assumption that all components have the same copyright holder.

## P0–P9 simulated acceptance gates

1. P0: reproducible protocol vector sources, source SHA, legacy dependency inventory, and license audit.
2. P1: schema and runtime capability checks; fake clock / stream tests; zero ability to TX if capability is unproven.
3. P2: native Node-API loaded from real packaged binaries for each target; encoder/decoder tests and crash isolation.
4. P3: FT8/FT4 live-stage recall and next-slot deadline parity against `wsjtx-lib` golden recordings.
5. P4: Q65 B60/C60 and other ten supported submodes, averaging/AP/EME drift, TX/RX and QSO.
6. P5: WSPR 120 s, decode/encode, false spots, power/compound-call handling, beacon disabled by default.
7. P6: MSK144 streaming 72 ms normal/short frames, missed ping and cancellation/interrupts.
8. P7: JTTY growing/complete/expired/reception-ended, 1–16 frame roundtrip, 2026-era WSJT-X compatibility.
9. P8: complete UI, i18n (zh/en/ja), logbook, virtual radio, all mode-specific TX safety.
10. P9: no `wsjtx-lib` in published runtime tree, CI green, real packaged native module loading and download artifacts.

Physical radio testing is **not** a release gate per operator instruction. Mock tests cannot establish RF emissions, hardware PTT latency, OS device compatibility or verified live EME performance; those remain unverified user-side checks.

### Test evidence required before claiming finished

Use deterministic AWGN, Watterson fading, controlled Doppler/drift, noise-only false-alarm tests, multi-station interference, cross-decoder TX vectors, cancellation and 10,000 cycle durability. The proposed weak-signal target is no more than 0.5 dB degradation of 50% decode threshold with confidence intervals, rather than assuming parity from a few WAV examples. Store machine-readable scores and reject out-of-budget regressions.

Until P9 passes, `mfsk-native` is experimental; no automatic fallback or silent protocol substitution is allowed in the released path.
