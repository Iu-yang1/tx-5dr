import type { KeyboardMessagePanel, KeyboardMessageSlot, KeyboardMessageSlotUpdate } from '@tx5dr/contracts';
import type { MacroPanelAdapter } from '../../hooks/useMacroPanel';

const STORAGE_PREFIX = 'tx5dr_jtty_message_panel_v1:';
const DEFAULT_MESSAGES = [
  ['CQ', 'CQ CQ DE {MYCALL} {MYCALL} K'],
  ['REPLY', '{HISCALL} DE {MYCALL} {MYCALL} KN'],
  ['RST', '{HISCALL} {TRST} {TRST} DE {MYCALL}'],
  ['73', '{HISCALL} TU 73 DE {MYCALL} SK'],
] as const;

function initialPanel(callsign: string): KeyboardMessagePanel {
  return {
    callsign,
    slotCount: 12,
    maxSlotCount: 12,
    slots: Array.from({ length: 12 }, (_, position): KeyboardMessageSlot => ({
      id: 'jtty-' + (position + 1),
      index: position + 1,
      label: DEFAULT_MESSAGES[position]?.[0] ?? 'F' + (position + 1),
      text: DEFAULT_MESSAGES[position]?.[1] ?? '',
      repeatEnabled: false,
      repeatIntervalSec: 5,
    })),
  };
}

function storageKey(callsign: string): string {
  return STORAGE_PREFIX + callsign.trim().toUpperCase();
}

function load(callsign: string): KeyboardMessagePanel {
  const fresh = initialPanel(callsign);
  const raw = localStorage.getItem(storageKey(callsign));
  if (!raw) return fresh;
  const saved = JSON.parse(raw) as KeyboardMessagePanel;
  if (!Array.isArray(saved.slots)) return fresh;
  const byId = new Map(saved.slots.map(slot => [slot.id, slot]));
  return {
    ...fresh,
    slotCount: Math.max(3, Math.min(12, saved.slotCount || 12)),
    slots: fresh.slots.map(slot => {
      const old = byId.get(slot.id);
      return old ? {
        ...slot,
        label: old.label,
        text: old.text,
        repeatEnabled: false,
        repeatIntervalSec: old.repeatIntervalSec || 5,
      } : slot;
    }),
  };
}

function save(callsign: string, panel: KeyboardMessagePanel): KeyboardMessagePanel {
  localStorage.setItem(storageKey(callsign), JSON.stringify(panel));
  return panel;
}

/** JTTY owns per-operator local presets. No RTTY server macro or streaming TX API is used. */
export const jttyMessagePanelAdapter: MacroPanelAdapter = {
  getPanel: async (callsign) => load(callsign),
  updatePanel: async (callsign, update) => save(callsign, {
    ...load(callsign), slotCount: Math.max(3, Math.min(12, update.slotCount)),
  }),
  updateSlot: async (callsign, slotId, update: KeyboardMessageSlotUpdate) => {
    const current = load(callsign);
    return save(callsign, {
      ...current,
      slots: current.slots.map(slot => slot.id === slotId ? {
        ...slot, ...update, repeatEnabled: false,
      } : slot),
    });
  },
  deleteSlot: async (callsign, slotId) => {
    const current = load(callsign);
    return save(callsign, {
      ...current,
      slots: current.slots.map(slot => slot.id === slotId ? {
        ...slot, label: '', text: '', repeatEnabled: false,
      } : slot),
    });
  },
  swapSlots: async (callsign, a, b) => {
    const current = load(callsign);
    const first = current.slots.find(slot => slot.id === a);
    const second = current.slots.find(slot => slot.id === b);
    if (!first || !second) return current;
    return save(callsign, {
      ...current,
      slots: current.slots.map(slot => {
        if (slot.id === a) return { ...slot, label: second.label, text: second.text };
        if (slot.id === b) return { ...slot, label: first.label, text: first.text };
        return slot;
      }),
    });
  },
};
