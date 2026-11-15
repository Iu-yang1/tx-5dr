import { useState } from 'react';
import { Button, Input } from '@heroui/react';
import { useTranslation } from 'react-i18next';
import { useJtty } from '../../hooks/useJtty';

/** Whole-message TX only. Editing the buffer does not start RF transmission. */
export function JttyTxBuffer() {
  const { t } = useTranslation('radio');
  const { afHz, setAfHz, canTransmit, txBusy, txPhase, txError, send, stop } = useJtty();
  const [text, setText] = useState('');
  const busy = txBusy || txPhase === 'processing' || txPhase === 'transmitting';
  const transmit = () => { void send(text); };
  return <div className="rounded-lg border border-default-200 bg-content2/50 p-2 space-y-2">
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs font-semibold">{t('jtty.workbench.txBuffer')}</span>
      <span role="status" className="text-xs text-default-500" data-testid="jtty-tx-phase">
        {t('jtty.workbench.phase.' + txPhase)}
      </span>
      <Input size="sm" type="number" min={100} max={5500} step={1}
        className="w-28" aria-label={t('jtty.workbench.af')} endContent="Hz"
        value={afHz} onValueChange={setAfHz} />
    </div>
    <textarea value={text} onChange={event => setText(event.target.value)}
      aria-label={t('jtty.workbench.txBuffer')}
      placeholder={t('jtty.workbench.txPlaceholder')}
      maxLength={64} rows={2} disabled={busy}
      onKeyDown={event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
          event.preventDefault();
          if (!busy) transmit();
        }
      }}
      className="w-full resize-y rounded-md border border-default-300 bg-content1 p-2 font-mono text-sm" />
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-[11px] text-default-500">{text.length}/64</span>
      <div className="flex gap-2">
        <Button size="sm" color="primary" isDisabled={!canTransmit || busy || !text.trim()}
          onPress={transmit}>{t('jtty.workbench.send')}</Button>
        <Button size="sm" color="danger" variant="flat" isDisabled={!busy}
          onPress={() => void stop()}>{t('jtty.workbench.stop')}</Button>
      </div>
    </div>
    {txError && <p role="alert" className="text-xs text-danger">{txError === 'invalid' ? t('jtty.workbench.invalidTx') : txError}</p>}
  </div>;
}
