import { useEffect, useState } from 'react';
import { Button, Card, CardBody, Input } from '@heroui/react';
import { useTranslation } from 'react-i18next';
import { api } from '@tx5dr/core';
import { Q65SubmodeSchema, type DigitalCodecMode, type DigitalRxEvent,
  type MfskLiveRxStatus, type Q65Submode } from '@tx5dr/contracts';

/** Receives post-demodulated AF from the application's live audio input.
 * Does not offer any PTT or RF TX control. Visible only to administrators. */
export function MfskLiveReceiverPanel({initialMode}: {initialMode?:DigitalCodecMode} = {}) {
  const { t } = useTranslation('about');
  const [status,setStatus] = useState<MfskLiveRxStatus | null>(null);
  const [mode,setMode] = useState<DigitalCodecMode>(initialMode??'Q65');
  const [submode,setSubmode] = useState<Q65Submode>('Q65-60B');
  const [frequency,setFrequency] = useState('1500');
  const [averaging,setAveraging] = useState(false);
  const [emeDelay,setEmeDelay] = useState(false);
  const [events,setEvents] = useState<DigitalRxEvent[]>([]);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState<string | null>(null);

  useEffect(()=>{
    let active=true;
    const poll=()=>{
      void api.getMfskLiveRxEvents(0).then(data=>{
        if(!active)return;
        setStatus(data.status);
        setEvents(data.events.slice(-60));
      }).catch(()=>{/* Feature is optional on non-experimental server. */});
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
            disabled={busy||status?.running}>
            {Q65SubmodeSchema.options.map(m=><option key={m} value={m}>{m}</option>)}
          </select>
        </>}
        <Input size="sm" className="max-w-[140px]" type="number"
          label={t('codec.afFrequency')} value={frequency} onValueChange={setFrequency}
          isDisabled={busy||status?.running}/>
      </div>
      {mode==='Q65' && <div className="flex flex-wrap gap-5 text-sm">
        <label><input type="checkbox" checked={averaging}
          disabled={busy||status?.running} onChange={e=>setAveraging(e.target.checked)}/> {t('codec.averaging')}</label>
        <label><input type="checkbox" checked={emeDelay}
          disabled={busy||status?.running} onChange={e=>setEmeDelay(e.target.checked)}/> {t('codec.emeDelay')}</label>
      </div>}
      <div className="flex flex-wrap gap-2 items-center">
        <Button size="sm" color="primary" onPress={()=>run(true)}
          isDisabled={busy||status?.running} isLoading={busy}>
          {t('codec.startRx')}
        </Button>
        <Button size="sm" variant="flat" onPress={()=>run(false)}
          isDisabled={busy||!status?.running}>{t('codec.stopRx')}</Button>
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
      <p className="text-xs text-default-500">{t('codec.liveNoTx')}</p>
    </CardBody>
  </Card>;
}
