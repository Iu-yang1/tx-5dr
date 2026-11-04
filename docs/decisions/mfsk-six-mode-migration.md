# Six-mode codec migration: P0 evidence and acceptance contract

Status: **P2–P8 implemented on PR #23; P9 pending current-head acceptance and release.** No verified physical RF claims.

## Fixed upstream and application baselines

- Application: `Iu-yang1/tx-5dr` `main` at `d684a561bf775a91be276049cd49e9642bcce259` (2026-11-03).
- Rust upstream: `jl1nie/mfsk-core` `v0.15.1` at `a26c7de6246eb2a7a44d2529cb24981b1f867d16`.
- Legacy reference: `wsjtx-lib@2.2.0` is now a test/development-only dependency in `packages/server/package.json`. Production uses the pinned Rust addon and fails closed if it is absent.
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

The `mfsk-ffi` v0.15.1 header provides `mfsk_decoder_*` for slotted modes, `mfsk_jtty_*` and `mfsk_msk144_*` for non-slotted modes, plus separate encoding and synthesis calls. JTTY cannot be forced through the slotted API; the JTTY upstream analysis describes a variable-frame continuous mode. Modes compiled into the native library are **not** equal to operational capabilities in TX-5DR.

Exact Q65 names in mfsk-core are `Q65-15A`, `Q65-30A`, `Q65-60A` through `Q65-60E`, `Q65-120D/E`, and `Q65-300A`. FT8 early-prefix handling is not equivalent to every legacy 41/47/49/50 checkpoint; a silent remap is forbidden.

## Resolved package licensing audit

The root package metadata now declares `GPL-3.0-only` consistently with the existing repository `LICENSE` and the pinned `mfsk-core v0.15.1`. This metadata fix does not alter ownership or imply that unrelated third-party components share the same copyright holder.

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

## Normal radio workspace integration (PR #23)

The existing `RadioControl` mode selector is the only primary mode entry point. Selecting Q65, WSPR, MSK144 or JTTY retains the existing radio control and spectrum surface and switches the native-family resource plan in `EngineLifecycle`. No stand-alone About-page receiver console or extra MFSK mode menu is required.

- Existing **left RX pane**: decoded AF messages, UTC, SNR/frequency diagnostics, Q65 actual submode, AP and EME delay/averaging controls and local-only WSPR spots.
- Existing **right operator pane**: operator selection, manual TX message and independently selectable TX AF carrier, Q65 and MSK144 T/R parity, 5/10/15/30 s MSK144 periods, explicit WSPR beacon consent, and manual QSO confirmation. JTTY incremental revisions replace earlier versions of the same message in display.
- FT8/FT4 retain their original RX timeline, operator automation and legacy slot decisions. In native modes, obsolete FT8 automation cards are hidden rather than being allowed to key the wrong protocol.
- RF is **not automatically armed** by selecting a mode, connecting a rig or receiving AF. An operator with `RadioControl` permission must explicitly acknowledge their station, frequency and PTT readiness in the existing right pane. A per-process, ten-minute approval is bound to the physical radio connection generation, current native mode and receiver session generation. A mode change, engine stop, receiver restart or reconnect invalidates it; disarm requests interrupt a currently held native digital PTT lease.
- The host continues to own actual PTT through `PhysicalTxCoordinator`. No successful QSO is inferred from decode events; the operator explicitly logs a completed exchange. WSPR spots are not QSOs.
- MSK144 TX is fixed at 1500 Hz AF by the upstream synthesizer, independently of tunable RX AF. It supports standard 72 ms frames; experimental MSK40 shorthand and adaptive RX equalization require the separately pinned DSP fork, with independent validation outstanding; unmodified upstream does not implement them.
- Native RX configuration is validated before stopping an active receiver. The asynchronous startup waiter is bound to its receiver generation; timeout or acknowledgment from an older generation must never stop or validate a replacement session.
- Post-demodulated AF ingress has two independent backpressure boundaries: pending resample callbacks (at most eight and at most one second of normalized 12 kHz samples) and pending native worker messages. A streaming gap fails closed rather than joining non-contiguous samples. A slotted-mode gap increments dropped-chunk statistics and the incomplete UTC window is rejected.
- Child spawn and IPC write failures must transition native RX into stopped/fault state without escaping a radio audio callback or UTC polling timer. Explicit JTTY stop still flushes accepted AF before a terminal update.

## Evidence and remaining release limits

- [PR #23 integration branch](https://github.com/Iu-yang1/tx-5dr/pull/23) must pass *all mandatory* tests on one unchanged head SHA before `main` is updated.
- [P9 native matrix](https://github.com/Iu-yang1/tx-5dr/actions/workflows/mfsk-native-acceptance.yml) validates the pinned addon on five OS/CPU targets, independent WSJT-X recordings and compiled runtime loading.
- [Reference sensitivity](https://github.com/Iu-yang1/tx-5dr/actions/workflows/mfsk-sensitivity.yml) enforces paired FT8/FT4 AWGN 50% decode degradation no worse than +0.5 dB (including 95% paired-bootstrap upper bound); exploratory Watterson-like 1/10/30 Hz and 0/10/20 Hz/s Doppler runs record separate per-SNR reference recoveries and false detections and are not a calibrated fading-equipment claim.
- Distribution checks for Electron, Linux server and Docker must verify the compiled Rust addon is installed; `wsjtx-lib` is not a production runtime dependency.
- Native physical transceiver output, audio-interface timing, hardware PTT latency and actual on-air QSO quality are untested on CI and must be described as such. A successful virtual-radio release gate is not a hardware certification.

## Automated P9 CI watch

A [default-branch GitHub Actions watcher](https://github.com/Iu-yang1/tx-5dr/actions/workflows/tx5dr-p9-half-hour-watch.yml) is scheduled at minutes 00 and 30, plus manual workflow dispatch. GitHub scheduled execution is best effort; it may be delayed.

The watcher inspects only PR #23 `integration/mfsk-six-mode-p0-p9` and the matching **current HEAD or up-to-date synthetic merge SHA**, never accepts previous commits' successes, and requires all eight validation workflows. The five native CI platform jobs, independent native `server-runtime` replay and all five Electron desktop platforms must succeed, not be skipped or cancelled. GitHub-hosted infrastructure failures at checkout or Node/Rust setup may be retried **once**. Deterministic decoder, security and frontend failures must be fixed in source code; the watcher creates an actionable GitHub issue and does **not** weaken test gates.

Once the full matrix is green the watcher can mark the PR ready and attempt to merge under the repository's normal branch protection, using an exact head-SHA assertion. A successful merge initiates Electron, Linux Server, Docker and Android Runtime **nightly** build workflows explicitly because ordinary `GITHUB_TOKEN` pushes do not automatically trigger chained GitHub Actions workflows. Nightly build artifacts are *not* an official versioned release. The watcher is a CI controller, not an autonomous AI coder: source defects still require a real corrective PR commit. Physical RF characterization remains outside CI evidence.

## 0.15.1 migration guard (2026-11-04)

The upstream 0.15.1 release improves FT8 real-recording recall, time-offset reporting/subtraction, fine-sync deduplication, blind CQ AP and bit metrics. Upstream explicitly retains the MSK40 shorthand TX/RX and adaptive MSK144 receive equalization as unported functionality; the release upgrade alone **does not** complete those TX-5DR P9 requirements. The legacy golden WAV corpus is intentionally fixed at the previous source SHA, while the native codec version is advanced. Four-mode reference interoperability via wsjtx-lib remains a **test-only** dependency, and this change is not proof of five-platform runtime packaging or full fading-channel 50% decode thresholds.


## Cross-repository fork DSP ownership (2026-11-04)

DSP source of truth for TX-5DR MSK40 short-message RX/TX and guarded MSK144 adaptive phase equalization is `Iu-yang1/mfsk-core-tx5dr` at commit `9b48880d730988d2b0b526a918565368743a146a`, consumed using an exact Cargo git rev. The historical `packages/mfsk-native/src/msk40.rs` experimental duplicate is removed; the Node-API adapter is transport only. This git rev describes an **unaccepted fork draft**, not a verified public release; update only after independent CI and golden reference testing. The automatic upstream-release updater intentionally rejects changing the crate's semver without first reconciling and verifying the fork.


### Guarded live RX controls

`POST /mfsk/live/start` accepts an optional `msk144Rx` object for MSK144 only, e.g. `{"dxCall":"K2ABC","myCall":"K1ABC","shorthand":true,"adaptiveEqualizer":true}`. Omission disables both features; shorthand is rejected unless both call identities are known. These parameters belong to the isolated receive child and do not grant transmit/PTT authorization. On session restart/reset training is cleared and the validated configuration is re-applied. `equalizerStatus()` is exposed through the native session for diagnostics. The experimental MSK40 known-call receiver must pass independent off-air/golden sensitivity tests before claiming production parity.
