// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { jttyMessagePanelAdapter as adapter } from '../jttyMessagePanel';

describe('JTTY standalone presets', () => {
  beforeEach(() => localStorage.clear());

  it('starts with 12 independent F-key slots and four QSO messages', async () => {
    const panel = await adapter.getPanel('BG5JSU');
    expect(panel.slots).toHaveLength(12);
    expect(panel.slots[0].label).toBe('CQ');
    expect(panel.slots[3].label).toBe('73');
    expect(panel.slots[0].text).toContain('{MYCALL}');
  });

  it('persists edits separately by operator without touching RTTY keys', async () => {
    await adapter.updateSlot('BG5JSU', 'jtty-1', { text: 'CQ TEST DE BG5JSU', label: 'TEST' });
    expect((await adapter.getPanel('BG5JSU')).slots[0].text).toBe('CQ TEST DE BG5JSU');
    expect((await adapter.getPanel('K1ABC')).slots[0].label).toBe('CQ');
    expect(localStorage.getItem('tx5dr_rtty_keyer_shortcut_presets')).toBeNull();
  });

  it('keeps stable F-key identities when macros are exchanged or deleted', async () => {
    await adapter.swapSlots('BG5JSU', 'jtty-1', 'jtty-4');
    let panel = await adapter.getPanel('BG5JSU');
    expect(panel.slots[0].id).toBe('jtty-1');
    expect(panel.slots[0].label).toBe('73');
    await adapter.deleteSlot('BG5JSU', 'jtty-1');
    panel = await adapter.getPanel('BG5JSU');
    expect(panel.slots[0].text).toBe('');
    expect(panel.slots[3].label).toBe('CQ');
  });
});
