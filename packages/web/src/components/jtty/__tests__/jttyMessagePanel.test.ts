// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KeyboardMessagePanel } from '@tx5dr/contracts';

const remote = vi.hoisted(() => ({
  get: vi.fn(), update: vi.fn(), slot: vi.fn(), remove: vi.fn(),
  swap: vi.fn(), migrate: vi.fn(),
}));
vi.mock('@tx5dr/core', () => ({ api: {
  getJttyMessagePanel: remote.get,
  updateJttyMessagePanel: remote.update,
  updateJttyMessageSlot: remote.slot,
  deleteJttyMessageSlot: remote.remove,
  swapJttyMessageSlots: remote.swap,
  importLegacyJttyMessagePanel: remote.migrate,
} }));
import { jttyMessagePanelAdapter as adapter } from '../jttyMessagePanel';

const defaultPanel = (callsign: string): KeyboardMessagePanel => ({
  callsign, slotCount: 12, maxSlotCount: 12,
  slots: Array.from({ length: 12 }, (_, i) => ({
    id: 'jtty-' + (i + 1), index: i + 1, label: i === 0 ? 'CQ' : 'F' + (i + 1),
    text: i === 0 ? 'CQ CQ DE {MYCALL}' : '',
    repeatEnabled: false, repeatIntervalSec: 5,
  })),
});

describe('JTTY server-backed presets', () => {
  const server = new Map<string, KeyboardMessagePanel>();
  beforeEach(() => {
    vi.clearAllMocks();
    server.clear();
    localStorage.clear();
    remote.get.mockImplementation(async (callsign: string) => {
      if (!server.has(callsign)) server.set(callsign, defaultPanel(callsign));
      return { success: true, panel: server.get(callsign) };
    });
    remote.slot.mockImplementation(async (callsign: string, id: string, update: { text?: string; label?: string }) => {
      const current = server.get(callsign) ?? defaultPanel(callsign);
      const panel = {
        ...current, slots: current.slots.map(slot => slot.id === id ? { ...slot, ...update } : slot),
      };
      server.set(callsign, panel);
      return { success: true, panel };
    });
    remote.migrate.mockImplementation(async (callsign: string, panel: KeyboardMessagePanel) => {
      if (!server.has(callsign)) server.set(callsign, { ...panel, callsign, maxSlotCount: 12 });
      return { success: true, panel: server.get(callsign) };
    });
  });

  it('loads 12-slot presets from the server and sees updates on another browser', async () => {
    const panel = await adapter.getPanel('BG5JSU');
    expect(panel.slots).toHaveLength(12);
    await adapter.updateSlot('BG5JSU', 'jtty-1', { text: 'CQ TEST DE BG5JSU', label: 'TEST' });
    localStorage.clear(); // another device using the same station
    expect((await adapter.getPanel('BG5JSU')).slots[0].text).toBe('CQ TEST DE BG5JSU');
    expect((await adapter.getPanel('K1ABC')).slots[0].label).toBe('CQ');
    expect(remote.get).toHaveBeenCalled();
  });

  it('migrates a V1 browser panel once without overwriting an existing server panel', async () => {
    const legacy = defaultPanel('BG5JSU');
    legacy.slots[0].text = 'LEGACY CQ';
    localStorage.setItem('tx5dr_jtty_message_panel_v1:BG5JSU', JSON.stringify(legacy));
    expect((await adapter.getPanel('BG5JSU')).slots[0].text).toBe('LEGACY CQ');
    expect(remote.migrate).toHaveBeenCalledTimes(1);
    await adapter.updateSlot('BG5JSU', 'jtty-1', { text: 'NEW SERVER' });
    expect((await adapter.getPanel('BG5JSU')).slots[0].text).toBe('NEW SERVER');
    expect(remote.migrate).toHaveBeenCalledTimes(1);
  });
});
