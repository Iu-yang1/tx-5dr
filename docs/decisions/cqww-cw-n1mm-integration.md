# CQ WW CW / N1MM+ integration boundary

The existing CW console keeps the decoder, frequency control, manual text, and
editable CW message presets. The CQ WW CW tab adds independent operator-triggered
RUN/S&P messages and a passive N1MM projection. Contest callsign and operator
identity are separate; no automatic call, QSY, or QSO logging is performed.

N1MM is the contest log owner. Each station's N1MM performs its own native CW
keying and Radmin VPN multi-user logging. Do not bridge N1MM contacts back into
the ordinary TX-5DR log or its outgoing WSJT-X UDP plugin. The local mirror is
best-effort, session-only and cannot be used as an authoritative dupe checker.
UDP has no replay/acknowledgement: a disconnect or restart can miss contacts.
N1MM's own database and scoring remain authoritative.

## Station configuration / independent fallback

On the RF station configure N1MM's real physical radio CAT interface and a
separate independent CW keyer (hardware WinKeyer or a supported physical DTR/RTS
keying interface). Do not open the same exclusive COM port simultaneously in
both programs. Where radio hardware cannot support two independent CAT
connections, stop/disconnect TX-5DR to release the physical CAT port before
switching N1MM to it. Keep the direct radio and keying configuration tested and
available; a virtual keyer or CAT proxy hosted by TX-5DR cannot survive its
process failure. Do not connect incompatible electrical keying outputs in parallel.
Native N1MM macros, ESM and the physical keyer remain independent of this tab.
The existing TX-5DR native CW macros continue to use CWKeyerManager.

Set the contest callsign and sent CQ zone in the tab (e.g. BG8GLR and 24 when
authorized). Select the actual operator account, BG5JVM or BG5JSU. Select
CQWWCW in N1MM, use the team contest callsign and exchange, and change operator
using Ctrl+O. Record QSOs only in N1MM. Use the coordinator's Radmin network and
N1MM Multi-User configuration; no team coordination or shared database protocol
is added here. N1MM's radio/contacts/lookup broadcasts are observational only.

Enable optional server-side UDP receiver before starting the server:
```powershell
$env:N1MM_CW_UDP_ENABLED = "1"
$env:N1MM_CW_UDP_BIND = "127.0.0.1"
$env:N1MM_CW_UDP_PORT = "12060"
$env:N1MM_CW_STATION_CALL = "BG8GLR"
# Optional: actual N1MM Windows computer name, e.g. JVM-PC.
$env:N1MM_CW_STATION_NAME = "JVM-PC"
```
Replace JVM-PC with the actual N1MM StationName (NetBIOS name), or omit it
if only the local N1MM instance sends UDP. This separates local RadioInfo and
LookupInfo from other BG8GLR stations while preserving team contact projection.
Configure N1MM Configurer > Broadcast Data: Radio, Contacts, External Callsign
Lookup -> 127.0.0.1:12060. On a remote RF server, bind only a trusted private
interface and point N1MM to that address. The receiver is read-only and has no
RF or log write capability. The existing rigctld bridge is unchanged and is not asserted to be directly
N1MM-compatible. Enable the experimental single-logical-VFO TS-590S CAT subset
with N1MM_CAT_ENABLED=1, N1MM_CAT_BIND=127.0.0.1, N1MM_CAT_PORT=4533. Use N1MM
SO1V and the TS-590S radio protocol over TCP (or a verified serial/TCP bridge).
CW keying remains on its independent native hardware interface; keep software
PTT disabled in N1MM unless explicitly required. N1MM_CAT_PTT_ENABLED=1 enables
CAT PTT using the existing TX coordinator, with session-owned release on close.
The virtual protocol supports ID, FA, IF, MD, FR0, FT0, AI0, KS, RX and optional
TX; it does not represent physical split, VFO B, or automatic AI reports.
Physical dial changes remain handled by PhysicalRadioManager/RadioBridge; set
N1MM_CW_FAST_POLL=1 for the optional faster existing CW polling cycle. No extra
CAT poller or stale writeback. The CAT subset is based on Kenwood TS-590S/SG PC
Control Command Reference (ID, FA, IF, MD, KS); actual N1MM compatibility must
be tested before use. The active CQ WW CW tab substitutes the station callsign
in existing CW message placeholders while the preset storage and authorization
continue using the actual operator account.

This section describes the original fallback. The integrated virtual WinKeyer path and Entry Agent below are now available for simulated testing. Missed UDP contact replay and actual N1MM compatibility remain open.

## Regression scope

The focused radio CI explicitly runs the new CAT/UDP unit and localhost socket
integration tests, CW contest message tests, and existing CW keyer, decoder and
frequency-control tests. Hardware fallback, physical dial/real CAT latency,
N1MM native F-key keying and contest-log networking require station acceptance:
first test with a dummy load or RF output disabled, then disconnect/close
TX-5DR and verify N1MM direct CAT, F1/F2, Esc and logging independently.

## Integrated N1MM control (experimental)

Set N1MM_WINKEY_ENABLED=1, N1MM_WINKEY_BIND=127.0.0.1 and N1MM_WINKEY_PORT=4534 on the RF host (trusted private interface for remote clients). Use the existing Kenwood CAT port 4533 and a Windows virtual COM pair for WinKeyer. Install pyserial; run `python packages/client-tools/src/n1mm-winkey-proxy.py --com COM21 --host 127.0.0.1` and configure N1MM WinKey on COM20. The TCP proxy disconnects on failure rather than replaying stale bytes. TX-5DR's own CW presets remain independent of the logger host; both share the physical keyer. Host Mode compatibility is a subset, not a full WK2 implementation; immediate tune, prosigns, mid-character pause and exact serial echo timing need further work. Use the station radio's own BK-IN and keying lead/tail. Do not enable duplicate software PTT for CW.

For real-time entry edits, install pywinauto and psutil, inspect the local N1MM Entry Window using Inspect.exe or Accessibility Insights, and obtain exact title plus call/zone AutomationIds. Set TX5DR_N1MM_TOKEN to the operator API session token; run `python packages/client-tools/src/n1mm-entry-agent.py --api http://127.0.0.1:8080/api --title "ACTUAL TITLE" --call-id "ACTUAL CALL ID" --zone-id "ACTUAL ZONE ID"` (replace host/port/ids). This local adapter uses UI Automation with explicit process/window/control identity, reports readback and never sends global keys or auto-logs. It is not verified against the actual N1MM executable yet. The server expires pending edits when disconnected; no replay after reconnect. N1MM local Entry edits are read back into TX-5DR. Enable N1MM Spots, Score, Contacts and All QSOs (on one selected authoritative sender) and point broadcasts at UDP 12060; spots use kHz, contact frequencies use 10 Hz. Score is projected from dynamicresults. The Bandmap frequency column performs an explicit manual QSY through the existing radio owner; the callsign column selects the call. This separation prevents N1MM's QSY-wipe option from erasing a freshly inserted call. N1MM must remain the log authority. Do not broadcast All QSOs from multiple misconfigured retransmitting stations.

Protocol references: https://n1mmwp.hamdocs.com/appendices/external-udp-broadcasts/ and https://www.k1elsystems.com/files/WK3_Datasheet_v1.3.pdf.

### Native N1MM buttons

The Entry Agent also accepts an optional --actions JSON mapping of F1 through F12, STOP, LOG, WIPE, MARK, STORE, SPOT, RUN and S&P to the actual button/radio-button AutomationIds discovered on the N1MM host. Only uniquely resolved controls are advertised. Do not guess IDs. A native macro click uses N1MM's own configured message through WinKeyer, and the TX-5DR macro toggle uses its own keyer. LOG invokes the actual N1MM Log It button once after readback; only a ContactInfo packet is proof of a logged contact. No action is replayed after disconnect. Native N1MM ESM keyboard behavior, modal dialogs and check-window data are not emulated.

The QSO mirror provides observed rate, worked bands and zone/country counts from all received contact records; these are explicitly observed rather than official results. Official score and breakdown originate in N1MM. For the assisted setup enable All QSOs at one chosen N1MM sender, Radio/Lookup from the local operator instance, and Spots/Score at the configured endpoint. N1MM All QSOs is a stream of log changes, not an initial full database dump. No direct mutation of N1MM's SQLite file is attempted.

To discover controls rather than guess IDs: `python packages/client-tools/src/n1mm-entry-agent.py --title "ACTUAL TITLE" --inspect`. For CAT on a virtual COM pair instead of native TCP, run a second proxy with `--com COM23 --host RADIO_HOST --port 4533 --baud 9600 --stopbits 1`, then select COM22 and the corresponding Kenwood rig profile in N1MM. The exact rig's TCP/serial polling behavior still needs N1MM validation. For stations without server authentication, use --no-auth explicitly. TX-5DR STOP also clears queued WinKeyer host messages so a cancelled message cannot restart from a pending batch. Simulated UI adapter tests use fake edit/button objects; they verify readback and at-most-once invocation, not actual N1MM UI Automation interoperability.

## Full-log recovery and actual CW log card

Enable Application Info and Contacts + All Computers on the chosen N1MM instance. N1MM's Tools → Rebroadcast all Contest QSOs to other Apps can resend the active contest log. On first attach or after lost UDP, click Rebuild → Reset mirror in TX-5DR, then invoke that N1MM command manually. Check the received count against N1MM; UDP has no completion acknowledgement, so the mirror does not claim authoritative completeness. This operation never deletes the N1MM database or transmits RF. The global QSO ID, not local contestnr, is used for duplicate suppression across networked computers. The CQ WW mode changes the existing CW QSO card into an N1MM entry/log request form with CQ zone; ordinary CW still uses its own log. Native action completion is not proof of QSO creation until ContactInfo arrives. 

### WinKeyer direct keying and prosigns

Host immediate tune (0B) and buffered key-down (19) use the existing serial CW keyer only when a real key port is configured; CAT text-only radios return an explicit unsupported capability. A tune watchdog (100 s, per K1EL protocol) and clear/disconnect release the session-owned key. Common merged prosigns (AR/SK/BT/KN/BK/CL) reuse the existing serial Morse encoder. CAT prosign encoding is not asserted portable. Speed commands retain their original position in the send queue; block-level serial echoes are not claimed as per-element hardware readback. Full WinKeyer hardware features such as arbitrary buffer-pointer edits, paddle input, Farnsworth, physical PTT accessories and exact character echo are still not emulated.

## Native ESM and local check sources
Use --native-keys on the Entry Agent to expose explicit ESM Enter, Insert, Alt+Enter, Space, Tab and Alt+Y (Yank). These are native N1MM commands, not a second ESM state machine. The bound window must be foreground at dispatch; actual keyboard behavior must be checked on Windows. Check / SCP supports locally imported Master.scp and simple Call,Zone CSV, observed log candidates and spots. These candidates do not reproduce every N1MM ranking, Telnet quality rule or Check Window feature. The original CW log card is shared outside the tabs so it remains visible in CQ WW mode.
