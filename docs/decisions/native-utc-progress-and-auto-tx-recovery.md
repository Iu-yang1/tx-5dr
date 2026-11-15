# Native digital UTC progress and automatic TX recovery

Q65, MSK144, WSPR and JTTY use the dedicated native RX / physical TX
pipeline. They must not start the FT8/FT4 `SlotClock` or fake decoder slots.

## Operator progress (UI only)

- Q65 display period follows **receiver-confirmed** Q65 submode, including
  15/30/60/120/300-second variants. If RX is not ready, no Q65 period is
  fabricated.
- WSPR uses true 120-second UTC periods.
- MSK144 displays selected 5/10/15/30-second T/R progress; its receive bursts
  remain asynchronous and are not projected as fixed decode slots.
- Progress is computed from local UTC for visualization only. Actual
  transmission remains anchored to the native TX scheduler's UTC clock,
  configured T/R parity, and physical PTT transaction.
- The progress animation owns its own component timer, and is restarted only
  when UTC period or submode changes. The operator controls do not rerender
  with every progress tick.

## AUTO TX recovery

- A canceled pending auto-TX operation releases the logical scheduler token
  **immediately**. Late encode/UTC-wait completion may not take ownership
  of a newer mode, phase or receiver generation.
- Active physical PTT is never interrupted solely because new text appeared.
  Existing abort, PTT arbitration, mode/generation, and ownership checks remain.
- Q65/MSK144 prefer one active QSO strategy message. If none exists, the
  operator's explicitly entered text is used as a native whole-message TX.
  Multiple active streams are never implicitly mixed.
- WSPR retains its explicit CALL GRID POWER validation, with 120-second slots.
- The AUTO TX status exposes a concrete no-message diagnostic instead of
  appearing enabled indefinitely while no strategy or operator message exists.
- Switching the operator TX control OFF disarms auto TX; re-enabling the
  operator alone does not silently resume a previous automatic transmission.

## Acceptance

Focused web/Node tests cover Q65 period selection, MSK144 T/R values,
WSPR period, message-source priority, null text reporting, stale completion
isolation and canceled scheduler state. Native-mode CI smoke checks are not
a substitute for actual RF validation on a connected radio.

## Changing timing while AUTO TX is enabled

The operator panel reconciles explicit changes to MSK144 T/R period, MSK144
Tx First and Q65 Tx First with the currently owned automatic transmitter,
using the existing same-operator `/mfsk/tx/auto/start` configuration update.
Rapid changes are serialized by the UI's pending flag; the most recently
selected timing is applied after any preceding update completes. Reconfiguration
does not implicitly enable a stopped transmitter, disarm another operator, or
interrupt a physical on-air lease. Q65 receiver submode changes remain receiver
restarts, for which AUTO TX must be explicitly re-enabled after RX is ready.

## Q65 receiver Apply RX and submode consistency

The legacy `/mfsk/live/start` endpoint intentionally loads station-wide
preferences, not client-supplied tuning parameters. The Q65 receiver pane now
applies explicit changes through the existing revisioned
`/mfsk/live/preferences` save path. That server transaction restarts the
running decoder when its RX configuration changes, and the pane waits for the
confirmed receiver state before reporting success. An explicit start no longer
reuses a ready Q65 decoder whose submode disagrees with the saved preference.
Version conflicts are shown to the operator; a stale browser cannot silently
override another client's RX tuning. The RF scheduler's existing receiver
generation check remains authoritative after an RX restart.
