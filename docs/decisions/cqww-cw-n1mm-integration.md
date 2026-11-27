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
```
Configure N1MM Configurer > Broadcast Data: Radio, Contacts, External Callsign
Lookup -> 127.0.0.1:12060. On a remote RF server, bind only a trusted private
interface and point N1MM to that address. The receiver is read-only and has no
RF or log write capability. The existing rigctld bridge is unchanged and is
not asserted to be N1MM-compatible. Physical VFO changes remain handled by
PhysicalRadioManager/RadioBridge; no extra CAT polling or stale writeback.

This initial implementation does not emulate WinKeyer or Kenwood CAT, inject
Windows keys, recover missed UDP contacts, or derive official contest scores.
Those interfaces require independent protocol and real N1MM client verification.
