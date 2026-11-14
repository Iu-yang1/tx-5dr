# Upstream 3-way merge staging — 2026-11-14

This branch is a real two-parent Git merge of the current TX-5DR fork
and boybook/tx-5dr main. Unconflicted upstream changes are present.
Upstream workflow changes are excluded because CI push credentials
lack workflows scope; they remain a separate porting task.
Textual conflicts use the fork side *only for staging*; every line
listed below is an outstanding semantic reconciliation item.
This report does not claim the conflict-side upstream content was ported.

- Fork parent: `403de3285affbf9481a9c376d6d61c6aefa6d7fd`
- Upstream parent: `1567446b103b69ae34f9bae7cc7a6faeeaf802b6`
- Textual conflict paths: **14**

## Conflict reconciliation debt

- `Dockerfile`: fork version retained
- `docs/plugin-system.md`: fork version retained
- `package.json`: fork version retained
- `packages/client-tools/src/proxy.js`: fork version retained
- `packages/electron-main/src/main.ts`: fork version retained
- `packages/server/package.json`: fork version retained
- `packages/server/src/DigitalRadioEngine.ts`: fork version retained
- `packages/server/src/generated/buildInfo.json`: fork version retained
- `packages/server/src/radio/connections/hamlib/__tests__/ProcessHamlibTransport.test.ts`: fork version retained
- `packages/server/src/subsystems/EngineLifecycle.ts`: fork version retained
- `packages/server/src/subsystems/RadioBridge.ts`: fork version retained
- `packages/web/src/components/cw/CWQSOLogCard.tsx`: fork version retained
- `packages/web/src/components/cw/CWRecentQSOList.tsx`: fork version retained
- `yarn.lock`: fork version retained

## Required acceptance

Check all package/lockfile combinations, native Node ABI, audio and PTT
sequencing, ICOM/Yaesu CAT, all digital modes, i18n and NSIS installed
node.exe. Do not merge this branch without green integration CI.

## Reconciliation on `integration/upstream-20261114`

The 14 conflicts above describe the initial automated staging, not the final reconciliation.

- Dockerfile: ported upstream runtime smoke and toolchain-line changes, retained fork native codec stages.
- Host and server manifests: reconciled upstream dependency ranges without dropping fork-specific packages; regenerated Yarn lockfile.
- Client proxy and desktop: ported upstream startup fixes; retained the fork's more complete redacted Electron console diagnostics.
- DigitalRadioEngine, EngineLifecycle, RadioBridge: ported RTTY-specific service, mode lifecycle and frequency routing; removed obsolete TransmissionTracker references.
- Hamlib worker tests: integrated upstream malformed IPC and tooling message regressions.
- CW log card and recent-QSO list: retained fork-specific working implementations rather than replacing with upstream wrapper refactor.
- Plugin docs: retained fork-specific contract text and integrated compatible upstream text.
- Native FT8/FT4 hash registry, FTDX10 control and manual RR73/73 logbook paths remain unchanged at their v1.0.5 source identity.

CI remains the release gate; this reconciliation report alone is not proof of hardware, packaging, or QSO acceptance.
