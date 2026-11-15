import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createJttyMessagePanels } from '../JttyMessagePanels.js';

const roots: string[] = [];
async function createPanelStore() {
  const dir = await mkdtemp(join(tmpdir(), 'tx5dr-jtty-'));
  roots.push(dir);
  return { dir, panels: createJttyMessagePanels(async () => dir) };
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe('JTTY station-side message panels', () => {
  it('uses 12 independent F slots and survives a second server store instance', async () => {
    const { dir, panels } = await createPanelStore();
    const initial = await panels.getPanel('BG5JSU');
    expect(initial.slots).toHaveLength(12);
    expect(initial.slotCount).toBe(12);
    expect(initial.slots[0].id).toBe('jtty-1');
    expect(initial.slots[0].text).toContain('{MYCALL}');
    await panels.updateSlot('BG5JSU', 'jtty-1', { text: 'CQ TEST', label: 'TEST' });
    const second = createJttyMessagePanels(async () => dir);
    expect((await second.getPanel('BG5JSU')).slots[0].text).toBe('CQ TEST');
    expect((await second.getPanel('K1ABC')).slots[0].label).toBe('CQ');
    await second.swapSlots('BG5JSU', 'jtty-1', 'jtty-4');
    expect((await panels.getPanel('BG5JSU')).slots[3].text).toBe('CQ TEST');
  });

  it('imports a V1 local panel only once and never overwrites server edits', async () => {
    const { panels } = await createPanelStore();
    const original = await panels.getPanel('OTHER1');
    const legacy = {
      slotCount: 12,
      slots: original.slots.map(slot => slot.id === 'jtty-1'
        ? { ...slot, label: 'OLD', text: 'CQ OLD DE BG5JSU' } : slot),
    };
    expect((await panels.seedIfAbsent('BG5JSU', legacy)).slots[0].label).toBe('OLD');
    await panels.updateSlot('BG5JSU', 'jtty-1', { text: 'NEW SERVER CONTENT' });
    expect((await panels.seedIfAbsent('BG5JSU', legacy)).slots[0].text).toBe('NEW SERVER CONTENT');
  });

  it('bounds whole-message JTTY text to 64 and never persists RTTY repeat mode', async () => {
    const { panels } = await createPanelStore();
    await panels.updateSlot('BG5JSU', 'jtty-1', { text: 'A'.repeat(100), repeatEnabled: true });
    const panel = await panels.getPanel('BG5JSU');
    expect(panel.slots[0].text).toBe('A'.repeat(64));
    expect(panel.slots[0].repeatEnabled).toBe(false);
    await panels.deleteSlotText('BG5JSU', 'jtty-1');
    expect((await panels.getPanel('BG5JSU')).slots[0].text).toBe('');
  });
});
