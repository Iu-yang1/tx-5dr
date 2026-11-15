import { useCallback, useEffect, useMemo, useState } from 'react';
import { Chip } from '@heroui/react';
import { faKeyboard } from '@fortawesome/free-solid-svg-icons';
import { useCurrentOperatorId, useOperators } from '../../store/radioStore';
import { useJtty } from '../../hooks/useJtty';
import { useMacroPanel } from '../../hooks/useMacroPanel';
import { useSlotShortcuts } from '../../hooks/useSlotShortcuts';
import { useGlobalSlotHotkeys } from '../../hooks/useGlobalSlotHotkeys';
import { jttyKeyerShortcutPreferences } from '../../utils/jttyKeyerShortcutPreferences';
import { useJttyQSODraft } from '../../store/jttyQsoDraftStore';
import { KeyboardMacroPanel } from '../keyboard-mode/KeyboardMacroPanel';
import { useMessagePlaceholders } from '../keyboard-mode/useMessagePlaceholders';
import type { KeyboardMessageSlot, KeyboardPlaceholderValues } from '@tx5dr/contracts';
import { jttyMessagePanelAdapter } from './jttyMessagePanel';
import { JttyTxBuffer } from './JttyTxBuffer';

const MACRO_I18N = {
  prefix: 'radio:jtty.macro',
  defaults: {
    keyerTitle: 'JTTY Macros',
    modeTabs: 'JTTY macro mode',
    operateMode: 'Operate',
    placeholderMissingToast: 'Fill in the required values before sending JTTY.',
  },
};

export function JttyMacroPanel() {
  const { currentOperatorId } = useCurrentOperatorId();
  const { operators } = useOperators();
  const { hisCallsign, trst, rrst } = useJttyQSODraft();
  const { send, stop, canTransmit, txBusy, txPhase } = useJtty();
  const myCall = operators.find(item => item.id === currentOperatorId)?.context?.myCall?.trim() ?? '';
  const values = useMemo<KeyboardPlaceholderValues>(() => ({
    myCall: myCall || undefined,
    hisCall: hisCallsign || undefined,
    trst: trst || undefined,
    rrst: rrst || undefined,
  }), [hisCallsign, myCall, rrst, trst]);
  const macro = useMacroPanel(jttyMessagePanelAdapter, myCall, { enabled: true });
  const shortcuts = useSlotShortcuts(jttyKeyerShortcutPreferences, myCall, macro.panel?.slots);
  const placeholders = useMessagePlaceholders({ values, i18n: MACRO_I18N });
  const [activeSlotId, setActiveSlotId] = useState<string | null>(null);
  const busy = txBusy || txPhase === 'processing' || txPhase === 'transmitting';

  // Read the server panel again while operating so remote edits made on a
  // second browser become visible without disturbing an in-progress editor.
  useEffect(() => {
    if (macro.panelMode !== 'operate' || !myCall) return;
    void macro.loadPanel();
    const timer = window.setInterval(() => {
      if (!busy) void macro.loadPanel();
    }, 8_000);
    return () => window.clearInterval(timer);
  }, [busy, macro.loadPanel, macro.panelMode, myCall]);

  useEffect(() => {
    if (!busy) setActiveSlotId(null);
  }, [busy]);

  const sendSlot = useCallback((slot: KeyboardMessageSlot) => {
    if (busy && activeSlotId === slot.id) {
      void stop();
      return;
    }
    if (!canTransmit || busy) return;
    const resolved = placeholders.resolveForSend(slot.text);
    if (!resolved) return;
    setActiveSlotId(slot.id);
    void send(resolved);
  }, [activeSlotId, busy, canTransmit, placeholders, send, stop]);

  useGlobalSlotHotkeys({
    enabled: canTransmit && macro.panelMode === 'operate',
    slots: macro.visibleSlots,
    shortcuts: shortcuts.shortcuts,
    isActive: busy,
    onTrigger: sendSlot,
    onStop: () => void stop(),
    ignoreInDialogs: true,
    ignoreAutoRepeat: true,
  });

  return <KeyboardMacroPanel
    embedded layout="grid" i18n={MACRO_I18N} icon={faKeyboard}
    statusChip={busy ? <Chip size="sm" color="warning" variant="flat">JTTY TX</Chip> : undefined}
    inputArea={<JttyTxBuffer />}
    macro={macro} shortcuts={shortcuts} placeholders={placeholders}
    isBusy={busy} activeSlotId={activeSlotId}
    activeSlotPhase={activeSlotId && busy ? 'transmitting' : null}
    onPlaySlot={sendSlot}
  />;
}
