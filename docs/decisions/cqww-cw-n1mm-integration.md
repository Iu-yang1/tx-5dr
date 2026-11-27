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

The initial implementation does not emulate WinKeyer, inject Windows keys,
recover missed UDP contacts, or derive official contest scores. Those interfaces
require independent protocol and real N1MM client verification.

## Regression scope

The focused radio CI explicitly runs the new CAT/UDP unit and localhost socket
integration tests, CW contest message tests, and existing CW keyer, decoder and
frequency-control tests. Hardware fallback, physical dial/real CAT latency,
N1MM native F-key keying and contest-log networking require station acceptance:
first test with a dummy load or RF output disabled, then disconnect/close
TX-5DR and verify N1MM direct CAT, F1/F2, Esc and logging independently.

## Integrated N1MM control (experimental)

Set N1MM_WINKEY_ENABLED=1, N1MM_WINKEY_BIND=127.0.0.1 and N1MM_WINKEY_PORT=4534 on the RF host (trusted private interface for remote clients). Use the existing Kenwood CAT port 4533 and a Windows virtual COM pair for WinKeyer. Install pyserial; run `python packages/client-tools/src/n1mm-winkey-proxy.py --com COM21 --host 127.0.0.1` and configure N1MM WinKey on COM20. The TCP proxy disconnects on failure rather than replaying stale bytes. TX-5DR's own CW presets remain independent of the logger host; both share the physical keyer. Host Mode compatibility is a subset, not a full WK2 implementation; immediate tune, prosigns, mid-character pause and exact serial echo timing need further work. Use the station radio's own BK-IN and keying lead/tail. Do not enable duplicate software PTT for CW.

For real-time entry edits, install pywinauto and psutil, inspect the local N1MM Entry Window using Inspect.exe or Accessibility Insights, and obtain exact title plus call/zone AutomationIds. Set TX5DR_N1MM_TOKEN to the operator API session token; run `python packages/client-tools/src/n1mm-entry-agent.py --api http://127.0.0.1:8080/api --title "ACTUAL TITLE" --call-id "ACTUAL CALL ID" --zone-id "ACTUAL ZONE ID"` (replace host/port/ids). This local adapter uses UI Automation with explicit process/window/control identity, reports readback and never sends global keys or auto-logs. It is not verified against the actual N1MM executable yet. The server expires pending edits when disconnected; no replay after reconnect. N1MM local Entry edits are read back into TX-5DR. Enable N1MM Spots, Score, Contacts and All QSOs (on one selected authoritative sender) and point broadcasts at UDP 12060; spots use kHz, contact frequencies use 10 Hz. Score is projected from dynamicresults. The Bandmap click selects the call only in this increment. N1MM must remain the log authority. Do not broadcast All QSOs from multiple misconfigured retransmitting stations.

Protocol references: https://n1mmwp.hamdocs.com/appendices/external-udp-broadcasts/ and https://www.k1elsystems.com/files/WK3_Datasheet_v1.3.pdf.
