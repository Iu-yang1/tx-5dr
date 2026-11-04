import { useEffect, useState } from 'react';
import { Button, Input } from '@heroui/react';
import { api } from '@tx5dr/core';
import { useTranslation } from 'react-i18next';
import { useCan } from '../../../store/authStore';
import { useCurrentOperatorId, useOperators, useRadioModeState } from '../../../store/radioStore';
import { openLogbookWindow } from '../../../utils/windowManager';
import { NATIVE_DIGITAL_SELECTION_EVENT, type NativeDigitalSelection } from './nativeDigitalSelection';

export function JttyOperatorTerminal() {
  const { t } = useTranslation('about');
  const allowed = useCan('execute', 'RadioControl');
  const { currentOperatorId, setCurrentOperatorId } = useCurrentOperatorId();
  const { operators } = useOperators();
  const radio = useRadioModeState();
  const [text, setText] = useState('');
  const [afHz, setAfHz] = useState('1700');
  const [target, setTarget] = useState('');
  const [grid, setGrid] = useState('');
  const [txPending, setTxPending] = useState(false);
  const [txBusy, setTxBusy] = useState(false);
  const [txNotice, setTxNotice] = useState('');
  const [logExpanded, setLogExpanded] = useState(false);
  const [logBusy, setLogBusy] = useState(false);
  const [logNotice, setLogNotice] = useState('');
  const [contactStart, setContactStart] = useState(() => Date.now());
  const [sentReport, setSentReport] = useState('');
  const [receivedReport, setReceivedReport] = useState('');
  const selected = operators.find(item => item.id === currentOperatorId);

  useEffect(() => {
    const update = (event: Event) => {
      const detail = (event as CustomEvent<NativeDigitalSelection>).detail;
      if (detail?.mode !== 'JTTY') return;
      if (Number.isFinite(detail.audioHz) && detail.audioHz >= 100 && detail.audioHz <= 5500) {
        setAfHz(String(Math.round(detail.audioHz)));
      }
    };
    window.addEventListener(NATIVE_DIGITAL_SELECTION_EVENT, update);
    return () => window.removeEventListener(NATIVE_DIGITAL_SELECTION_EVENT, update);
  }, []);
  useEffect(() => {
    let active = true;
    const read = () => {
      void api.getMfskNativeTxStatus(currentOperatorId ?? undefined).then(result => {
        if (active) setTxBusy(result.busy);
      }).catch(() => { if (active) setTxBusy(false); });
    };
    read();
    const timer = setInterval(read, 1200);
    return () => { active = false; clearInterval(timer); };
  }, [currentOperatorId]);

  const send = () => {
    if (!allowed || !currentOperatorId || !text.trim() || txPending || txBusy) return;
    const hz = Number(afHz);
    if (!Number.isFinite(hz) || hz < 100 || hz > 5500) {
      setTxNotice(t('codec.liveInvalidFrequency')); return;
    }
    setTxPending(true);setTxNotice('');
    void api.transmitMfsk({mode:'JTTY',operatorId:currentOperatorId,
      text:text.trim(),audioHz:hz})
      .then(() => setTxNotice(t('codec.txComplete')))
      .catch(() => setTxNotice(t('codec.txFailed')))
      .finally(() => setTxPending(false));
  };
  const stop = () => {
    void api.disarmMfskNativeTx().then(() => setTxNotice(t('codec.txStopped')))
      .catch(() => setTxNotice(t('codec.txStopFailed')));
  };
  const logQso = () => {
    if (!currentOperatorId || logBusy) return;
    const callsign = target.trim().toUpperCase();
    const locator = grid.trim().toUpperCase();
    if (!/^[A-Z0-9/]{3,24}$/.test(callsign)) {
      setLogNotice(t('codec.logCallInvalid')); return;
    }
    if (locator && !/^[A-R]{2}[0-9]{2}(?:[A-X]{2})?$/.test(locator)) {
      setLogNotice(t('codec.logGridInvalid')); return;
    }
    const frequencyHz = radio.currentRadioFrequency ?? 0;
    if (!Number.isFinite(frequencyHz) || frequencyHz < 1000) {
      setLogNotice(t('codec.logFrequencyInvalid')); return;
    }
    setLogBusy(true);setLogNotice('');
    void api.confirmMfskQso({
      mode:'JTTY',operatorId:currentOperatorId,callsign,
      ...(locator ? {grid:locator} : {}),
      frequencyHz,startTime:contactStart,endTime:Date.now(),
      ...(sentReport.trim() ? {reportSent:sentReport.trim()} : {}),
      ...(receivedReport.trim() ? {reportReceived:receivedReport.trim()} : {}),
      messageHistory:[],
    }).then(response => {
      setLogNotice(response.success ? t('codec.logSaved') : t('codec.logFailed'));
      if (response.success) {
        setContactStart(Date.now());
        setTarget('');setGrid('');
      }
    }).catch(() => setLogNotice(t('codec.logFailed')))
      .finally(() => setLogBusy(false));
  };

  return <section className="h-full min-h-0 space-y-3 overflow-y-auto overscroll-contain p-1">
    <div className="rounded-xl border border-default-200 bg-content1 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">{t('common:system.jttyTerminal.operator')}</span>
        <select value={currentOperatorId ?? ''} aria-label={t('codec.operatorSelect')}
          onChange={event => setCurrentOperatorId(event.target.value)}
          className="max-w-[55%] rounded-md border border-default-300 bg-content1 px-2 py-1 text-xs">
          <option value="" disabled>{t('codec.operatorRequired')}</option>
          {operators.map(item => <option key={item.id} value={item.id}>
            {item.context?.myCall || item.id}
          </option>)}
        </select>
      </div>
      <div className="text-xs text-default-500">
        {selected?.context?.myCall || t('codec.operatorRequired')}
      </div>
      <Input size="sm" type="number" label={t('codec.txAfFrequency')}
        value={afHz} onValueChange={setAfHz} />
      <textarea className="min-h-24 w-full resize-y rounded-lg border border-default-300 bg-content1 p-3 font-mono text-sm"
        aria-label={t('codec.message')} value={text} onChange={event => setText(event.target.value)}
        maxLength={64} disabled={txPending} />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" color="primary" isLoading={txPending}
          isDisabled={!allowed || !currentOperatorId || !text.trim() || txPending || txBusy}
          onPress={send}>{t('codec.manualTx')}</Button>
        <Button size="sm" variant="flat" isDisabled={!txPending && !txBusy}
          onPress={stop}>{t('codec.stopTx')}</Button>
      </div>
      {txNotice && <p role="status" className="text-xs text-default-500">{txNotice}</p>}
    </div>
    <div className="rounded-xl border border-default-200 bg-content1 p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">{t('codec.logTitle')}</span>
        <div className="flex gap-2">
          <Button size="sm" variant="light" isDisabled={!currentOperatorId}
            onPress={() => { if (currentOperatorId) openLogbookWindow({operatorId: currentOperatorId}); }}>
            {t('codec.logTitle')}
          </Button>
          <Button size="sm" variant="flat" aria-expanded={logExpanded}
            onPress={() => setLogExpanded(old => !old)}>
            {logExpanded ? t('codec.logCollapse') : t('codec.logExpand')}
          </Button>
        </div>
      </div>
      {logExpanded && <>
        <div className="grid grid-cols-2 gap-2">
          <Input size="sm" label={t('codec.dxCall')} value={target} onValueChange={setTarget} />
          <Input size="sm" label={t('codec.dxGrid')} value={grid} onValueChange={setGrid} />
          <Input size="sm" label={t('codec.sentReport')} value={sentReport} onValueChange={setSentReport} />
          <Input size="sm" label={t('codec.receivedReport')} value={receivedReport} onValueChange={setReceivedReport} />
        </div>
        <Button size="sm" color="primary" isLoading={logBusy}
          isDisabled={!allowed || !currentOperatorId || !target.trim() || logBusy}
          onPress={logQso}>{t('codec.logConfirm')}</Button>
      </>}
      {logNotice && <p role="status" className="text-xs text-default-500">{logNotice}</p>}
    </div>
  </section>;
}
