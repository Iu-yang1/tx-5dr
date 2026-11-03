import { useEffect, useState } from 'react';
import { Button, Card, CardBody, Input } from '@heroui/react';
import { useTranslation } from 'react-i18next';
import { api } from '@tx5dr/core';
import { useCurrentOperatorId, useRadioModeState } from '../../store/radioStore';
import { Q65SubmodeSchema, type DigitalCodecMode, type DigitalRxEvent,
  type MfskLiveRxStatus, type Q65Submode } from '@tx5dr/contracts';

/** Receives post-demodulated AF from the application's live audio input.
 * Does not offer any PTT or RF TX control. Visible only to administrators. */
export function MfskLiveReceiverPanel({initialMode}: {initialMode?:DigitalCodecMode} = {}) {
  const { t } = useTranslation('about');
  const { currentOperatorId } = useCurrentOperatorId();
  const radioMode = useRadioModeState();
  const [status,setStatus] = useState<MfskLiveRxStatus | null>(null);
  const [mode,setMode] = useState<DigitalCodecMode>(initialMode??'Q65');
  const [submode,setSubmode] = useState<Q65Submode>('Q65-60B');
  const [frequency,setFrequency] = useState('1500');
  const [averaging,setAveraging] = useState(false);
  const [emeDelay,setEmeDelay] = useState(false);
  const [events,setEvents] = useState<DigitalRxEvent[]>([]);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState<string | null>(null);
  const [txStatus,setTxStatus] = useState<{rfEnabled:boolean;busy:boolean}>({rfEnabled:false,busy:false});
  const [text,setText] = useState('CQ K1ABC FN42');
  const [beaconAuthorized,setBeaconAuthorized] = useState(false);
  const [txPending,setTxPending] = useState(false);
  const [txNotice,setTxNotice] = useState<string | null>(null);
  const [dxCall,setDxCall] = useState('');
  const [dxGrid,setDxGrid] = useState('');
  const [txReport,setTxReport] = useState('-10');
  const [rxReport,setRxReport] = useState('-12');
  const [frequencyMHz,setFrequencyMHz] = useState('');
  const [contactStartMs,setContactStartMs] = useState(() => Date.now());
  const [qsoBusy,setQsoBusy] = useState(false);
  const [qsoNotice,setQsoNotice] = useState<string|null>(null);


  useEffect(()=>{
    let active=true;
    const poll=()=>{
      void api.getMfskLiveRxEvents(0).then(data=>{
        if(!active)return;
        setStatus(data.status);
        setEvents(data.events.slice(-60));
      }).catch(()=>{/* Feature is optional on non-experimental server. */});
      void api.getMfskNativeTxStatus().then(value=>{if(active)setTxStatus(value);}).catch(()=>{
        if(active)setTxStatus({rfEnabled:false,busy:false});
      });
    };
    poll();
    const timer=setInterval(poll,1500);
    return ()=>{active=false;clearInterval(timer);};
  },[]);

  const run=(start:boolean)=>{
    setBusy(true);setError(null);
    const hz=Number(frequency);
    if(start && (!Number.isFinite(hz)||hz<100||hz>5500)){
      setBusy(false);setError(t('codec.liveInvalidFrequency'));return;
    }
    const action=start
      ? api.startMfskLiveRx({
          mode,...(mode==='Q65'?{q65Submode:submode,averaging,emeDelay}:{}),
          frequencyHz:hz,depth:3,
        })
      : api.stopMfskLiveRx();
    void action.then(value=>{setStatus(value);setEvents([]);})
      .catch(()=>setError(t('codec.liveOperationFailed')))
      .finally(()=>setBusy(false));
  };

  const recordQso=()=>{
    if(!currentOperatorId || (mode!=='Q65'&&mode!=='MSK144'&&mode!=='JTTY'))return;
    const hz = Number(frequencyMHz) * 1_000_000 ||
      radioMode.currentRadioFrequency || 0;
    if(!Number.isFinite(hz)||hz<1000||hz>100_000_000_000){
      setQsoNotice(t('codec.logFrequencyInvalid'));return;
    }
    const call=dxCall.trim().toUpperCase();
    if(!/^[A-Z0-9/]{3,24}$/.test(call)){
      setQsoNotice(t('codec.logCallInvalid'));return;
    }
    const grid=dxGrid.trim().toUpperCase();
    if(grid && !/^[A-R]{2}[0-9]{2}(?:[A-X]{2})?$/.test(grid)){
      setQsoNotice(t('codec.logGridInvalid'));return;
    }
    const matched=events.filter(e=>e.text.toUpperCase().includes(call)
      && e.timestampMs>=contactStartMs-60_000).map(e=>e.text).slice(-64);
    setQsoBusy(true);setQsoNotice(null);
    void api.confirmMfskQso({
      mode,operatorId:currentOperatorId,callsign:call,
      ...(grid?{grid}:{}),frequencyHz:Math.round(hz),
      startTime:contactStartMs,endTime:Date.now(),
      ...(txReport.trim()?{reportSent:txReport.trim()}:{}),
      ...(rxReport.trim()?{reportReceived:rxReport.trim()}:{}),
      ...(mode==='Q65'?{q65Submode:submode}:{}),
      messageHistory:matched,
    }).then(value=>{
      setQsoNotice(value.success?t('codec.logSaved'):t('codec.logFailed'));
      if(value.success){setContactStartMs(Date.now());setDxCall('');}
    }).catch(()=>setQsoNotice(t('codec.logFailed')))
      .finally(()=>setQsoBusy(false));
  };

  const transmit=()=>{
    if(!currentOperatorId || !txStatus.rfEnabled || !status?.ready || txPending) return;
    const hz=Number(frequency);
    if(!Number.isFinite(hz)||hz<100||hz>5500) {
      setTxNotice(t('codec.liveInvalidFrequency')); return;
    }
    setTxPending(true);
    setTxNotice(null);
    void api.transmitMfsk({
      mode,operatorId:currentOperatorId,text:text.trim(),audioHz:hz,
      ...(mode==='Q65'?{q65Submode:submode}:{}),
      ...(mode==='WSPR'?{beaconAuthorized}:{}),
    }).then(()=>setTxNotice(t('codec.txComplete')))
      .catch(()=>setTxNotice(t('codec.txFailed')))
      .finally(()=>setTxPending(false));
  };

  return <Card shadow="none">
    <CardBody className="gap-3 px-6 py-5">
      <h2 className="text-base font-semibold">{t('codec.liveTitle')}</h2>
      <p className="text-xs text-default-500">{t('codec.liveSubtitle')}</p>
      <div className="flex flex-wrap gap-3 items-center">
        <label htmlFor="mfsk-live-mode" className="text-sm">{t('codec.mode')}</label>
        <select id="mfsk-live-mode" value={mode} onChange={e=>setMode(e.target.value as DigitalCodecMode)}
          className="rounded-md border border-default-300 bg-content1 px-3 py-2 text-sm"
          disabled={busy||status?.running||Boolean(initialMode)}>
          {(['FT8','FT4','Q65','WSPR','MSK144','JTTY'] as const).map(m=>
            <option key={m} value={m}>{m}</option>)}
        </select>
        {mode==='Q65' && <>
          <label htmlFor="mfsk-live-q65" className="text-sm">{t('codec.submode')}</label>
          <select id="mfsk-live-q65" value={submode} onChange={e=>setSubmode(e.target.value as Q65Submode)}
            className="rounded-md border border-default-300 bg-content1 px-3 py-2 text-sm"
            disabled={busy}>
            {Q65SubmodeSchema.options.map(m=><option key={m} value={m}>{m}</option>)}
          </select>
        </>}
        <Input size="sm" className="max-w-[140px]" type="number"
          label={t('codec.afFrequency')} value={frequency} onValueChange={setFrequency}
          isDisabled={busy}/>
      </div>
      {mode==='Q65' && <div className="flex flex-wrap gap-5 text-sm">
        <label><input type="checkbox" checked={averaging}
          disabled={busy} onChange={e=>setAveraging(e.target.checked)}/> {t('codec.averaging')}</label>
        <label><input type="checkbox" checked={emeDelay}
          disabled={busy} onChange={e=>setEmeDelay(e.target.checked)}/> {t('codec.emeDelay')}</label>
      </div>}
      <div className="flex flex-wrap gap-2 items-center">
        <Button size="sm" color="primary" onPress={()=>run(true)}
          isDisabled={busy} isLoading={busy}>
          {status?.running?t('codec.applyRx'):t('codec.startRx')}
        </Button>
        <Button size="sm" variant="flat" onPress={()=>run(false)}
          isDisabled={busy||!status?.running||Boolean(initialMode)}>{t('codec.stopRx')}</Button>
        <span className="text-xs text-default-500">
          {status?.ready?t('codec.liveReady'):status?.running?t('codec.liveStarting'):t('codec.liveStopped')}
        </span>
      </div>
      {!!status && <p className="text-xs text-default-500">
        RX: {status.received} · {t('codec.dropped')}: {status.droppedAudioChunks} ·
        {t('codec.rejectedSlots')}: {status.rejectedSlots} ·
        {t('codec.workerFaults')}: {status.workerFaults}
      </p>}
      {status?.lastError && <p role="alert" className="text-xs text-danger">{status.lastError}</p>}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      <div className="max-h-64 overflow-y-auto rounded-md border border-default-200">
        {events.length===0 ?
          <p className="p-3 text-sm text-default-500">{t('codec.liveNoEvents')}</p>
          : <table className="w-full text-left text-xs">
            <thead><tr className="bg-default-100"><th className="px-2 py-1">UTC</th>
              <th className="px-2 py-1">Hz</th><th className="px-2 py-1">{t('codec.decoded')}</th></tr></thead>
            <tbody>{events.map((e,i)=><tr key={`${e.timestampMs}-${i}`} className="border-t border-default-100">
              <td className="px-2 py-1 whitespace-nowrap">{new Date(e.timestampMs).toISOString().slice(11,19)}</td>
              <td className="px-2 py-1">{e.frequencyHz.toFixed(1)}</td>
              <td className="px-2 py-1 font-mono">{e.text}</td>
            </tr>)}</tbody></table>}
      </div>
      <div className="rounded-md border border-default-200 p-3 space-y-3">
        <p className="text-sm font-medium">{t('codec.txTitle')}</p>
        <Input size="sm" label={t('codec.message')} value={text} onValueChange={setText}
          isDisabled={txPending} maxLength={64}/>
        {mode==='WSPR' && <label className="text-xs flex gap-2 items-center">
          <input type="checkbox" checked={beaconAuthorized} onChange={e=>setBeaconAuthorized(e.target.checked)}
            disabled={txPending}/>
          {t('codec.beaconAuthorization')}
        </label>}
        <div className="flex gap-2 items-center flex-wrap">
          <Button size="sm" color="warning" isLoading={txPending}
            isDisabled={!status?.ready||!txStatus.rfEnabled||txStatus.busy||!currentOperatorId||
              !text.trim()||txPending||(mode==='WSPR'&&!beaconAuthorized)}
            onPress={transmit}>{t('codec.manualTx')}</Button>
          <span className="text-xs text-default-500">
            {txStatus.rfEnabled?t('codec.rfAvailable'):t('codec.rfLocked')}
          </span>
        </div>
        {txNotice && <p className="text-xs" role="status">{txNotice}</p>}
      </div>
      {mode!=='WSPR' && <section className="rounded-md border border-default-200 p-3 space-y-2">
        <p className="text-sm font-medium">{t('codec.logTitle')}</p>
        <p className="text-xs text-default-500">{t('codec.logManualOnly')}</p>
        <div className="grid grid-cols-2 gap-2">
          <Input size="sm" label={t('codec.dxCall')} value={dxCall} onValueChange={setDxCall} maxLength={24}/>
          <Input size="sm" label={t('codec.dxGrid')} value={dxGrid} onValueChange={setDxGrid} maxLength={6}/>
          <Input size="sm" label={t('codec.sentReport')} value={txReport} onValueChange={setTxReport} maxLength={16}/>
          <Input size="sm" label={t('codec.receivedReport')} value={rxReport} onValueChange={setRxReport} maxLength={16}/>
          <Input size="sm" type="number" label={t('codec.logFrequencyMHz')}
            value={frequencyMHz} onValueChange={setFrequencyMHz}
            placeholder={radioMode.currentRadioFrequency ?
              (radioMode.currentRadioFrequency/1_000_000).toFixed(6):'144.360'}/>
        </div>
        <p className="text-xs text-default-500">{t('codec.logUtc')}:
          {' '}{new Date(contactStartMs).toISOString().replace('T',' ').slice(0,19)} UTC</p>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="flat" onPress={()=>{setContactStartMs(Date.now());setQsoNotice(null);}}>
            {t('codec.logNewContact')}</Button>
          <Button size="sm" color="primary" isLoading={qsoBusy}
            isDisabled={!currentOperatorId||!dxCall.trim()||qsoBusy}
            onPress={recordQso}>{t('codec.logConfirm')}</Button>
        </div>
        {qsoNotice && <p className="text-xs" role="status">{qsoNotice}</p>}
      </section>}
      <p className="text-xs text-default-500">{t('codec.liveNoTx')}</p>
    </CardBody>
  </Card>;
}
