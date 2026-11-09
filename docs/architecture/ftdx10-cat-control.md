# FTDX10 CAT controls — software acceptance contract

This contract documents the FTDX10-only controls introduced on the P0–P6
feature branches. The operator explicitly authorizes these controls, including
P4 TX-audio routing, for software-level release acceptance. Physical FTDX10
testing remains an operator-run post-release activity.

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
| `roofing_filter` | FTDX10 RF0 CAT (Hamlib-owned raw transport) | 12 kHz (1), 3 kHz (2), 500 Hz (4), optional 300 Hz (5); **not DSP WIDTH** | RX + Split OFF, one pre-read and two post-reads |
| `contour_enabled` | CO00 CAT | receiver Contour ON/OFF | RX + Split OFF, double readback |
| `contour_frequency` | CO01 CAT | 10–3200 Hz | RX + Split OFF, double readback |
| `contour_level` | EX030202 CAT | −40 to +20 dB | RX + Split OFF, double readback |
| `contour_width` | EX030203 CAT | 1–11 | RX + Split OFF, double readback |
| `tx_audio_input_source` | mode-specific EX MOD SOURCE + REAR SELECT | MIC / USB / rear input as supported by model | serialized write, live-mode bank selection, exact register readback |
| `split_tx_mode` | native `getSplitMode` / `setSplitMode` | independently selected TX VFO mode | TX-VFO-specific readback; no RX frequency/mode rewrite |

The dedicated Roofing/Contour API uses the existing native Hamlib rig handle,
not a second COM reader. It is a **model-specific CAT adapter** (not the native
Hamlib extended-level API) and cannot claim a transport-level response identity.
Yaesu CAT reference 2308-F, p.19, defines RF command P1=0 as a **fixed
selector**, not an AUTO choice. Valid Roofing P2 selections are 1, 2, 4, 5;
P2=0 and the reserved 1.2 kHz slot (3) must never be issued. The Hamlib
backend's internal AUTO combo index 0 cannot safely be mapped to `RF00;`.
Contour centre frequency is a 1 Hz-step numeric parameter in the Hamlib
model table, independent of DSP WIDTH.
Optional 300 Hz Roofing requires an installed hardware filter. Any ambiguous
raw read or write leaves the shared raw CAT access quarantined until reconnect,
including the future audio-route code.

APF *level* adjustment and the full VFO/Split state machine remain separate.
Existing Hamlib AGC/PREAMP/ATT capabilities must continue to be advertised only
after their own supported-value discovery and read probes.

## Raw EX commands: why P3 is still a gate

The project uses `boybook/node-hamlib@0.7.7`. In that binding,
`sendRawWrite(data)` is implemented as `sendRaw(data, 0)`, and its N-API
worker calls `shim_rig_send_raw` under the native rig lock. Hamlib
`rig_send_raw` reads a single terminator-delimited reply and subsequently
flushes the serial port. It does **not** associate the response with a unique
transaction identifier at the API boundary.

A native FTDX10 wrong-register reply detector and EX/CO/RF no-retry policy have been implemented in
[`Iu-yang1/Hamlib` PR #1](https://github.com/Iu-yang1/Hamlib/pull/1).
Both native entry points now have a guarded FTDX10 EX/CO/RF path:
`newcat_get_cmd` checks **full register selectors** instead of the first
two letters and fails without retry on ambiguous `?;` or timeout;
`rig_send_raw` (the API actually called by node-hamlib's
`sendRaw`) drains the RX side before a register query, validates its
single terminated reply against the complete register selector, and rejects
unrelated or concatenated frames with `-RIG_EPROTO`. It does not retry.

A standalone C test verifies correct/wrong-slot/incomplete/repeated frames
locally with `-std=c11 -Wall -Wextra -Werror -pedantic`.
The TX5DR FTDX10 CAT regression workflow also builds the **fork's entire
native Hamlib library** and exercises the C test as a separate job.
**This patched native library is not yet linked into the published
`hamlib@0.7.7` Node addon's binary used by TX5DR.**
In addition, matching old same-register replies have no protocol transaction
identifier. Therefore P3 cannot be marked complete on that evidence alone.

The TypeScript `parseSingleYaesuNumericReply` helper now rejects a
malformed, incomplete, duplicated, or contaminated EX response. It **cannot**
prove a same-prefix late response belongs to the current request.

The earlier global capability quarantine is **lifted by operator request**.
`tx_audio_input_source` is now exposed whenever the active model declares
supported routing sources. Other receivers do not inherit FTDX10-only controls.
The shared Hamlib serial queue remains the sole CAT owner: there is no second
port reader, speculative retry or synthetic ACK.

FTDX10 mode-specific MOD SOURCE and REAR SELECT menu commands are resolved
from the **live** radio mode (SSB, AM, FM, DATA), not a cached UI mode. Writes
are acknowledged by reading the exact matching EX menu registers. Real CAT
timeouts, wrong-register frames, or inconsistent readbacks still produce
errors and fence the affected connection until reconnect; this is recovery
from an observed transport failure, not a global disabled feature.

A **same-register, byte-identical late response cannot be distinguished**
from a current reply by any host implementation when the device provides no
transaction nonce. The application therefore never claims cryptographic or
request-ID correlation. This protocol limitation is documented but is **not
a global feature-denial criterion** under the operator's approved policy.

## Acceptance matrix

1. **P0:** confirm serial model ID, connection ownership and CI baseline.
2. **P1:** verify RX/TX/unknown PTT, Split ON/OFF/unknown, exact mode
   readback, external frequency/mode changes and reconnect fencing.
3. **P2:** verify RF Gain / AGC / IPO / ATT with actual steps, IF Shift Hz,
   passband WIDTH options, and distinguish hardware roofing filters.
4. **P3:** verify serialized CAT ownership, full EX/CO/RF register matching,
   unsolicited/malformed-frame rejection, forced timeouts and reconnect fencing.
   Device protocol request IDs are not required because FTDX10 has none.
5. **P4:** advertise the operator-authorized TX audio source capability and
   test its SSB/AM/FM/DATA EX banks, live-mode selection, exact readback and
   failure reporting. Physical input levels are verified by the operator.
6. **P5:** test CW keyer speed/pitch, VFO A/B, independent Split TX frequency
   and TX mode (with VFO-specific readback), APF/Contour and spectrum settings.
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
level getter/setter. P2's bounded model-specific raw CAT implementation permits supervised
receiver control testing without a second reader. Native `get/set_ext_level`
exposure remains the preferred consolidated abstraction. In particular,
native command association remains preferable for future packaging, but the
operator has explicitly authorized P4 without a blanket gate. The application
has its own strict EX/CO/RF parsing and serialized CAT transactions.

### Native Node addon compatibility gate

The separate native build job now tests the *real integration dependency*:
it builds the patched Hamlib source, installs a temporary shared library,
checks out the pinned `boybook/node-hamlib@0.7.7` source, rebuilds its N-API
addon, attempts to load `build/Release/hamlib.node`, and inspects the
resulting link map. The source-level Hamlib native build and C reply test
already passed.

Upstream node-hamlib's legacy shim directly accesses `RIG.state` and
`ROT.state`, removed from newer Hamlib. The isolated CI adaptation replaces legacy port fields with public
`HAMLIB_RIGPORT`/`HAMLIB_PTTPORT`/`HAMLIB_DCDPORT`/`HAMLIB_ROTPORT`
accessors and the remaining state fields with `HAMLIB_STATE`. It deliberately
does not use the `IN_HAMLIB`-only internal macros.

**Linux native integration CI passed** for the pinned patched Hamlib source:
the `node-hamlib@0.7.7` shim and N-API addon rebuilt, direct addon import
succeeded, `ldd` resolved `libhamlib.so.5` to the patched temporary
prefix, and the node-hamlib loader smoke tests passed. This proves a
**reproducible isolated Linux source integration**, not that Windows/macOS
production packages contain the patched native binary. No production
`hamlib@0.7.7` binary has yet been replaced. This limits claims about
**native-layer** cross-platform validation, but does not suppress the software
CAPABILITY or prevent operator-authorized release. Do not assert that the
production binary contains fork-only changes.

Merge and release require the relevant software tests, type checks and
packaging validations to pass. The lack of an impossible on-wire transaction
ID is a documented compatibility limitation rather than a reason to disable
functions. Keep unrelated CI environment failures (including optional native
dependency installation) separate from radio-control correctness failures.
Verify generated assets and channel identities before claiming publication.
