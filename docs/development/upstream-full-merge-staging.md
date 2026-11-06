# Upstream 3-way merge staging — 2026-11-06

This branch is a real two-parent Git merge of the current TX-5DR fork
and boybook/tx-5dr main. Unconflicted upstream changes are present.
Upstream workflow changes are excluded because CI push credentials
lack workflows scope; they remain a separate porting task.
Textual conflicts use the fork side *only for staging*; every line
listed below is an outstanding semantic reconciliation item.
This report does not claim the conflict-side upstream content was ported.

- Fork parent: `2fd65cc4439f3aeab3537289d47587477ae74903`
- Upstream parent: `ad38a085b3794825eab65eaa5c152a8080a38775`
- Textual conflict paths: **42**

## Conflict reconciliation debt

- `Dockerfile`: fork version retained
- `docs/README.md`: fork version retained
- `docs/decisions/client-notifications.md`: fork version retained
- `docs/plugin-system.md`: fork version retained
- `package.json`: fork version retained
- `packages/builtin-plugins/package.json`: fork version retained
- `packages/builtin-plugins/src/_shared/cross-provider-reconcile.test.ts`: fork version retained
- `packages/client-tools/package.json`: fork version retained
- `packages/core/src/index.ts`: fork version retained
- `packages/electron-main/package.json`: fork version retained
- `packages/electron-main/src/main.ts`: fork version retained
- `packages/electron-preload/package.json`: fork version retained
- `packages/plugin-api/scripts/packed-consumer-smoke.mjs`: fork version retained
- `packages/server/package.json`: fork version retained
- `packages/server/src/DigitalRadioEngine.ts`: fork version retained
- `packages/server/src/generated/buildInfo.json`: fork version retained
- `packages/server/src/log/ADIFLogProvider.ts`: fork version retained
- `packages/server/src/log/LogbookRecordService.ts`: fork version retained
- `packages/server/src/log/__tests__/LogbookRecordService.test.ts`: fork version retained
- `packages/server/src/log/persistence/LogbookDocument.ts`: fork version retained
- `packages/server/src/radio/PttHardware.ts`: fork version retained
- `packages/server/src/radio/__tests__/PhysicalRadioManager.test.ts`: fork version retained
- `packages/server/src/radio/connections/HamlibConnection.ts`: fork version retained
- `packages/server/src/rigctld/RadioControllerAdapter.ts`: fork version retained
- `packages/server/src/rigctld/__tests__/RadioControllerAdapter.test.ts`: fork version retained
- `packages/server/src/routes/__tests__/plugins.auth.test.ts`: fork version retained
- `packages/server/src/virtual-radio/VirtualRadioSession.performance.test.ts`: fork version retained
- `packages/server/src/virtual-radio/VirtualRadioSession.ts`: fork version retained
- `packages/shared-config/package.json`: fork version retained
- `packages/web/package.json`: fork version retained
- `packages/web/src/components/common/QrzCallsignLink.tsx`: fork version retained
- `packages/web/src/components/common/__tests__/QrzCallsignLink.test.ts`: fork version retained
- `packages/web/src/components/radio/profile/AudioDeviceSettings.tsx`: fork version retained
- `packages/web/src/components/radio/profile/RadioDeviceSettings.tsx`: fork version retained
- `packages/web/src/i18n/locales/en/common.json`: fork version retained
- `packages/web/src/i18n/locales/ja/common.json`: fork version retained
- `packages/web/src/i18n/locales/zh/common.json`: fork version retained
- `packages/web/src/services/radioService.spectrum.test.ts`: fork version retained
- `scripts/build-install-script.sh`: fork version retained
- `scripts/check-version-consistency.mjs`: fork version retained
- `scripts/generate-oss-manifest.mjs`: fork version retained
- `scripts/host-version.mjs`: fork version retained

## Required acceptance

Check all package/lockfile combinations, native Node ABI, audio and PTT
sequencing, ICOM/Yaesu CAT, all digital modes, i18n and NSIS installed
node.exe. Do not merge this branch without green integration CI.
