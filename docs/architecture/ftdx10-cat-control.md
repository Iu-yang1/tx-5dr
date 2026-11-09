# FTDX10 CAT controls — staged safety contract

This contract documents the FTDX10-only controls introduced on the P0–P6
feature branches. It does **not** authorize transmission, imply physical
hardware validation, or announce a release.

## Connection ownership

- The FTDX10 uses Hamlib model **1042** on the existing Enhanced COM serial
  connection. It is **not** given a separate raw-CAT serial listener.
- `HamlibRuntime.runSerializedTask(..., { critical: true })` is the application
  CAT-owner queue. `HamlibConnection` forwards typed operations across the
  worker boundary in `hamlib-protocol.ts`.
- Runtime detection is scoped to the live connection's serial model ID.
  Other Yaesu rigs must not inherit new FTDX10-specific write capabilities.
- Physical PTT/Split are consulted immediately before manual mode/passband
  writes; failed or unknown PTT/Split reads reject the operation.
- The application cannot prevent a user from manually pressing PTT on the
  radio *between* those reads and a native write. Hardware tests must include
  such asynchronous operator events.

## Capability semantics

| Capability | Transport | Unit / scope | Required acknowledgement |
| --- | --- | --- | --- |
| `radio_mode` | native `setMode` (manual guarded path) | runtime-supported modes | exact RX mode readback; Split OFF |
| `mode_bandwidth` | native `setMode(mode, bandwidth)` (guarded) | live passband-filter **Hz**, not a roofing relay | mode **and** width readback; Split OFF |
| `rf_gain` | native `RIG_LEVEL_RF` | normalized 0–1; not TX power | FTDX10 RX guard; small step tolerance |
| `if_shift` | native `RIG_LEVEL_IF` | signed integer Hz, ±1200 | exact readback; RX guard |
| `cw_pitch` | native `RIG_LEVEL_CWPITCH` | 300–900 Hz, 10 Hz step | exact readback; RX guard |
| `key_speed` | native `RIG_LEVEL_KEYSPD` | 6–48 WPM | exact readback; RX guard |
| `apf_enabled` | native `RIG_FUNC_APF` | receiver APF switch; not APF level | exact readback; RX guard |

These controls do not implement a native FTDX10 roofing-filter selector,
Contour, APF *level* adjustment, or full VFO/Split state machine. Existing Hamlib
AGC/PREAMP/ATT capabilities must continue to be advertised only after their
own supported-value discovery and read probes.

## Raw EX commands: why P3 is still a gate

The project uses `boybook/node-hamlib@0.7.7`. In that binding,
`sendRawWrite(data)` is implemented as `sendRaw(data, 0)`, and its N-API
worker calls `shim_rig_send_raw` under the native rig lock. Hamlib
`rig_send_raw` reads a single terminator-delimited reply and subsequently
flushes the serial port. It does **not** associate the response with a unique
transaction identifier at the API boundary.

The TypeScript `parseSingleYaesuNumericReply` helper now rejects a
malformed, incomplete, duplicated, or contaminated EX response. It **cannot**
prove a same-prefix late response belongs to the current request.

Consequently `tx_audio_input_source` remains quarantined. The
retained FTDX10 adapter now refuses EX route changes unless physical RX and
Split OFF are confirmed. If a compound route write or its readback fails, a
connection-scoped quarantine blocks **further raw route operations until
reconnect**: this avoids an uncontrolled retry after a potentially partial
MOD SOURCE / REAR SELECT update. It is a defensive failure policy, **not**
sufficient proof that a valid same-prefix EX reply is fresh.

Do not expose raw EX DATA routing and do not add retry-by-sleep, a second
serial reader, or a false success acknowledgement. The native library
(or a verified protocol API) must provide a bounded same-command correlation policy,
including tests for unsolicited frames, timeouts, reconnects, and delayed
responses. Composite MOD SOURCE + REAR SELECT writes can be partially applied;
they must not be represented as atomic until this is solved and tested.

## Acceptance matrix

1. **P0:** confirm serial model ID, connection ownership and CI baseline.
2. **P1:** verify RX/TX/unknown PTT, Split ON/OFF/unknown, exact mode
   readback, external frequency/mode changes and reconnect fencing.
3. **P2:** verify RF Gain / AGC / IPO / ATT with actual steps, IF Shift Hz,
   passband WIDTH options, and distinguish hardware roofing filters.
4. **P3:** prove raw response association in the native layer with
   unsolicited + stale frames, multiple EX commands and forced timeout.
5. **P4:** only after P3, test each DATA audio EX menu group for all supported
   modes, readback, route rollback, and physical input level.
6. **P5:** test CW keyer speed/pitch, VFO A/B and Split frequency+mode
   independently, APF/Contour, and spectrum settings.
7. **P6:** run targeted unit/IPC tests, native worker/reconnect tests,
   typecheck/build/i18n, aislop quality gate, packaging and release/rollback
   checks. **Physical FTDX10 tests are excluded from the software release gate
   at the operator's explicit request**; the operator performs them after
   publication. Release notes must identify CAT/device compatibility as
   software-only validation, never as real-radio acceptance.

## Dependency investigation: native Hamlib extended controls

The official FTDX10 CAT manual documents RF (roofing filter), SH (DSP WIDTH),
PA (IPO), RA (attenuator), CO (Contour/APF), ST (Split), and EX menu commands.
The checked Hamlib FTDX10 backend exposes extended tokens
`ROOFINGFILTER`, `KEYER`, `APF_FREQ`, `APF_WIDTH`, `CONTOUR`,
`CONTOUR_FREQ`, `CONTOUR_LEVEL`, and `CONTOUR_WIDTH`.
However the current npm `hamlib@0.7.7` Node binding exposes ordinary
`getLevel` / `setLevel` and raw `sendRaw`, but **not** Hamlib's extended
level getter/setter. The implementation must extend the owning native
binding (and preserve its queue/lock) before advertising these capabilities,
rather than treating raw RF/EX/CO commands as safely isolated.

Do not merge to `main`, deploy, or publish a stable Release while any
**software** safety gate remains unresolved. Keep unrelated CI environment
failures (including optional native dependency installation) separate from
radio-control correctness failures.
