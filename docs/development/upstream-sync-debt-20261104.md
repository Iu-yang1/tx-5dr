# Upstream integration debt — 2026-11-04

## Provenance

- Fork: [Iu-yang1/tx-5dr](https://github.com/Iu-yang1/tx-5dr), version v1.0.1-rc.5 baseline
- Upstream: [boybook/tx-5dr](https://github.com/boybook/tx-5dr), audited head `52eee948632214d1ceca5467d1494878e32b71ed`
- GitHub compare: **46 upstream-only commits / 180 fork-only commits**, around 300 changed paths
- Legacy sync PRs [#13](https://github.com/Iu-yang1/tx-5dr/pull/13) and [#18](https://github.com/Iu-yang1/tx-5dr/pull/18) were created on 2026-11-03 against obsolete integration bases. Neither can be merged conflict-free onto the current fork.

## Unmerged upstream changes (explicitly not claimed complete)

| Upstream commit | Scope | Required next integration |
| --- | --- | --- |
| `2a60dca39eb2` | ICOM MK2 + WLAN connection lifecycle | CAT/CI-V/PTT and ICOM session regression, preserve local FT-DX10/Hamlib support |
| `714682ecca23` | CW acknowledgements/timeouts | hardware handshake and scheduler validation |
| `14a85de741a8` | update unread-channel badge | targeted React UI/notification tests |
| `8494cc847bf5` | admin-only plugin disable diagnostics | permissions, plugin manager state and error path tests |
| `52eee9486322` | dependency security upgrades (Electron, Zod, Yarn and server) | staged major-version migration + lockfile updates, node native ABI, installed Windows NSIS runtime validation |

Also compare and integrate earlier upstream-only commits from the merge base: audio, logbook durability/sync, plugin APIs and SDK, updated app dependencies and release workflows.

## Strategy

Do **not** merge the obsolete sync branches or declare the entire upstream history integrated without content review. Recreate an integration branch off current `main`; perform a true 3-way merge, reconcile conflict hunks by subsystem, rerun focused and full platform CI. Preserve fork native `mfsk-core`, Windows Node integrity checking, and PTT sequencing. Merge when the validated result is ready, not merely when metadata marks the branch mergeable.

The issues tracker is disabled for this repository. This document is the durable tracking record for the outstanding upstream work; closing #13 and #18 means *superseded*, not *merged*.
