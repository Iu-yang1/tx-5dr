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
