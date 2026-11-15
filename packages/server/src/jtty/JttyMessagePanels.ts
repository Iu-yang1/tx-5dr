import { getDataFilePath } from '../utils/app-paths.js';
import { MessagePanelStore, type MessagePanelPreset } from '../keyboard/MessagePanelStore.js';

export const DEFAULT_JTTY_MESSAGE_SLOTS: MessagePanelPreset[] = [
  { label: 'CQ', text: 'CQ CQ DE {MYCALL} {MYCALL} K', repeatIntervalSec: 5 },
  { label: 'REPLY', text: '{HISCALL} DE {MYCALL} {MYCALL} KN', repeatIntervalSec: 5 },
  { label: 'RST', text: '{HISCALL} {TRST} {TRST} DE {MYCALL}', repeatIntervalSec: 5 },
  { label: '73', text: '{HISCALL} TU 73 DE {MYCALL} SK', repeatIntervalSec: 5 },
];

/** Dedicated JTTY storage; never writes RTTY/CW presets or transmits RF. */
export function createJttyMessagePanels(getRootDir: () => Promise<string> = () => getDataFilePath('jtty-keyer')): MessagePanelStore {
  return new MessagePanelStore({
    getRootDir,
    presets: DEFAULT_JTTY_MESSAGE_SLOTS,
    fallbackLabel: index => 'F' + index,
    modeLabel: 'JTTY',
    slotId: index => 'jtty-' + index,
    defaultSlotCount: 12,
    maxTextLength: 64,
    allowRepeat: false,
  });
}
