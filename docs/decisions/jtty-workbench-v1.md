# JTTY Workbench V1 — UI / protocol ownership

JTTY remains an ordinary `digital` engine mode, selected only when the current
digital mode is `JTTY`. Its desktop and mobile panes intentionally resemble
RTTY, but JTTY does not share RTTY's Baudot stream, Mark/Space tuning, keyer,
AFC, or real-time type-ahead queue.

## State and boundaries

- `JttyProvider` owns JTTY receiver polling, audio-frequency selection and
  whole-message TX lifecycle. It mounts around both JTTY panes, and polling
  is enabled only while JTTY is selected.
- Receive events remain session/message/revision streams; the latest revision
  wins, so a growing decode is one transcript row. Callsign selection fills
  the QSO draft only; it never keys PTT or creates a QSO.
- JTTY TX uses `transmitMfsk({ mode: 'JTTY' })` and
  `disarmMfskNativeTx`. An editable buffer or F-key macro resolves one
  bounded message, then sends one native transmission request. No streaming
  interface is implied.
- JTTY F1–F12 macro content is persisted by the station server in its separate
  `jtty-keyer` data directory, partitioned by callsign. Authorized clients on
  the same station share presets, and the operate panel refreshes periodically.
  Browser-local V1 presets are imported once on first access only when the server
  has no existing panel; an existing server panel always wins. Shortcut key
  assignments remain local browser preferences.
- `ModeQSOLogCard` supports an optional new-record submitter. JTTY injects
  `confirmMfskQso` for new QSOs; edits/deletions continue through the shared
  logbook API. The native confirmation schema accepts QTH and ADIF COMMENT
  (alongside optional NOTES), so the creation form exposes QTH/remarks and
  persists them in the initial native QSO transaction. Failed confirmation
  leaves form fields intact. It never logs
  merely because a callsign was clicked.
- Recent-QSO presentation reuses the keyboard-mode list with a JTTY-only
  filter. Recent JTTY QSOs are queried with the server-side `mode=JTTY` filter,
  with an additional UI-side filter for live event isolation.

## Validation scope

Run TypeScript build, web tests, locale parity and the PR quality gate. Native
JTTY TX/RX simulation and real-radio RF tests require their dedicated test
workflow/hardware; they are not implied by a frontend-only build.

## v1.0.7 rebuild

The targeted v1.0.7 replacement is authorized by changing
`release/official-rebuild.txt` to `v1.0.7` in the merge commit. The official
release dispatcher verifies that the marker matches the package version and
runs platform workflows with `replace_existing=true`; no nightly is requested.
