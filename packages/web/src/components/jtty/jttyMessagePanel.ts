import { api } from '@tx5dr/core';
import type { KeyboardMessagePanel, KeyboardMessageSlotUpdate } from '@tx5dr/contracts';
import type { MacroPanelAdapter } from '../../hooks/useMacroPanel';

const V1_STORAGE_PREFIX = 'tx5dr_jtty_message_panel_v1:';
const MIGRATION_PREFIX = 'tx5dr_jtty_message_panel_server_imported:';

/**
 * The station server is authoritative. Existing V1 browser presets are
 * imported exactly once, only if the server has not created a panel yet.
 * The browser's V1 copy is retained as a backup, never used as live state.
 */
async function migrateBrowserPanel(callsign: string): Promise<void> {
  const normalized = callsign.trim().toUpperCase();
  const marker = MIGRATION_PREFIX + normalized;
  if (localStorage.getItem(marker)) return;
  const raw = localStorage.getItem(V1_STORAGE_PREFIX + normalized);
  if (!raw) return;
  let parsed: KeyboardMessagePanel;
  try {
    parsed = JSON.parse(raw) as KeyboardMessagePanel;
  } catch {
    // Invalid old browser data cannot block the authoritative server panel.
    return;
  }
  if (!Array.isArray(parsed.slots)) return;
  await api.importLegacyJttyMessagePanel(normalized, {
    slotCount: parsed.slotCount,
    slots: parsed.slots,
  });
  localStorage.setItem(marker, '1');
}

/** JTTY macros synchronize through the station API; RTTY presets stay isolated. */
export const jttyMessagePanelAdapter: MacroPanelAdapter = {
  getPanel: async callsign => {
    await migrateBrowserPanel(callsign);
    return (await api.getJttyMessagePanel(callsign)).panel;
  },
  updatePanel: async (callsign, update) =>
    (await api.updateJttyMessagePanel(callsign, update)).panel,
  updateSlot: async (callsign, slotId, update: KeyboardMessageSlotUpdate) =>
    (await api.updateJttyMessageSlot(callsign, slotId, update)).panel,
  deleteSlot: async (callsign, slotId) =>
    (await api.deleteJttyMessageSlot(callsign, slotId)).panel,
  swapSlots: async (callsign, a, b) =>
    (await api.swapJttyMessageSlots(callsign, a, b)).panel,
};
