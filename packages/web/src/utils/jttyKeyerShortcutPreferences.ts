import { createKeyerShortcutPreferences } from './keyerShortcutPreferences';

/** Local F1-F12 assignments, scoped to JTTY and operator callsign. */
export const jttyKeyerShortcutPreferences = createKeyerShortcutPreferences({
  storageKey: 'tx5dr_jtty_keyer_shortcut_presets',
  eventName: 'jttyKeyerShortcutChanged',
  loggerName: 'JttyKeyerShortcutPrefs',
  label: 'JTTY macros',
});
