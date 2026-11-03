# Upstream synchronization (2026-11-03)

This fork merged `boybook/tx-5dr@cbd6449ddff2a524be5df692709e17bed098dc17`
into `Iu-yang1/tx-5dr@296a2afa90fab7545d52b87feeee23f084a872d4`.
The merge commit has both histories as parents.

## Conflict resolution policy

- Preserve this fork's isolated Hamlib transport/runtime, FT-DX10 target-VFO
  frequency/mode association, no-CAT PTT support and renderer OOM recovery.
- Import independent upstream changes (including Wavelog synchronisation,
  logbook scaling, release workflows and radio/voice changes).
- Merge non-overlapping edits in shared files against the common ancestor.
- On overlapping hunks, retain the existing fork implementation pending
  targeted integration validation; such hunks are not automatically accepted.
- Explicitly adopt the upstream PttHardware correction that deasserts both
  DTR and RTS lines when changing PTT state.

## Required validation before main

- Full workspace build, frontend and backend tests.
- FT-DX10 VFO-A/VFO-B, CW/USB mode/frequency readback tests.
- Hamlib worker isolation and native fork-pool long tests.
- Serial DTR/RTS independent PTT release tests.
- Electron renderer OOM recovery/Opus/WebGL memory regression tests.
- Platform packaging where build runners are available.

A successful Git merge alone is not sufficient evidence of runtime compatibility.
