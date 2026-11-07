import { useEffect, useMemo, useState } from 'react';
import {
  NATIVE_DIGITAL_SELECTION_EVENT,
  extractCqCallsign,
  type NativeDigitalSelection,
} from '../../components/radio/digital/nativeDigitalSelection';
import { Button, Card, CardBody, Input } from '@heroui/react';
import { formatDecodedAfHz, formatDecodedSnr } from '../../components/radio/digital/decodeValueFormat';
import { DECODE_PREFERENCES_CHANGED_EVENT, loadNativeDecodePreferences, saveNativeDecodePreferences, type NativeDecodePreferences, type NativeDigitalMode } from '../../components/radio/digital/digitalDecodePreferences';
import { useTranslation } from 'react-i18next';
import { useCan } from '../../store/authStore';
import { api } from '@tx5dr/core';
import { useCurrentOperatorId, useRadioModeState, useOperators } from '../../store/radioStore';
import { Q65SubmodeSchema, type DigitalCodecMode, type DigitalRxEvent,
  type MfskLiveRxStatus, type Q65Submode, type WsprDecodedSpot } from '@tx5dr/contracts';

/** Six-mode digital operator workbench: user-triggered UTC scheduling and normal PTT playback. */
export function MfskLiveReceiverPanel({
  initialMode, surface = 'receiver',
}: {initialMode?:DigitalCodecMode;surface?:'receiver'|'operator'} = {}) {
  const { t } = useTranslation('about');
  const { currentOperatorId, setCurrentOperatorId } = useCurrentOperatorId();
  const { operators } = useOperators();
  const radioMode = useRadioModeState();
  const maySwitchMode = useCan('execute','ModeSwitch');
  const mayArmRf = useCan('execute','RadioControl');
  const [status,setStatus] = useState<MfskLiveRxStatus | null>(null);
  // The existing RadioControl mode selector owns both workspace panes.
  const selected = radioMode.currentMode?.name ?? '';
  const mode: DigitalCodecMode = initialMode ?? (
    ['Q65','WSPR','MSK144','JTTY'].includes(selected)
      ? selected as DigitalCodecMode : 'Q65'
  );
  const [submode,setSubmode] = useState<Q65Submode>(() => loadNativeDecodePreferences(mode as NativeDigitalMode).q65Submode);
  const [submodeDirty,setSubmodeDirty] = useState(false);
  const [apApplying,setApApplying] = useState(false);
  const [apNotice,setApNotice] = useState<string|null>(null);
  const [frequency,setFrequency] = useState(() => String(loadNativeDecodePreferences(mode as NativeDigitalMode).frequencyHz));
  const [tolerance,setTolerance] = useState(() => String(loadNativeDecodePreferences(mode as NativeDigitalMode).toleranceHz));
  const [decodeDepth,setDecodeDepth] = useState<1|2|3>(() => loadNativeDecodePreferences(mode as NativeDigitalMode).depth);
  const [txFrequency,setTxFrequency] = useState(() => String(loadNativeDecodePreferences(mode as NativeDigitalMode).txAudioHz));
  const [averaging,setAveraging] = useState(() => loadNativeDecodePreferences(mode as NativeDigitalMode).averaging);
  const [emeDelay,setEmeDelay] = useState(() => loadNativeDecodePreferences(mode as NativeDigitalMode).emeDelay);
  const [apMyCall,setApMyCall] = useState('');
  const [apMyGrid,setApMyGrid] = useState('');
  const [apDxCall,setApDxCall] = useState('');
  const [apDxGrid,setApDxGrid] = useState('');
  const [apProgress,setApProgress] = useState<0|1|2|3|4|5>(0);
  const [events,setEvents] = useState<DigitalRxEvent[]>([]);
  // Replace incremental JTTY revisions by their latest message state.
  const displayEvents=useMemo(()=>{
    const merged=new Map<string,DigitalRxEvent>();
    for(const event of events){
      const id=event.kind==='message-update'
        ? `${event.sessionId}|${event.messageId}`
        : `${event.sessionId}|${event.timestampMs}|${event.frequencyHz}|${event.text}`;
      const prior=merged.get(id);
      if(!prior || (event.kind==='message-update' && prior.kind==='message-update'
        && event.revision>=prior.revision))merged.set(id,event);
    }
    return Array.from(merged.values()).sort((a,b)=>a.timestampMs-b.timestampMs).slice(-60);
  },[events]);
  const [wsprSpots,setWsprSpots] = useState<WsprDecodedSpot[]>([]);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState<string | null>(null);
  const [txStatus,setTxStatus] = useState<{rfEnabled:boolean;busy:boolean;remainingMs:number}>({rfEnabled:false,busy:false,remainingMs:0});
  // Never prefill a fictitious TX callsign into a live transmitter.
  const [text,setText] = useState('');
  const [mskPeriod,setMskPeriod] = useState<5|10|15|30>(() => loadNativeDecodePreferences(mode as NativeDigitalMode).mskPeriodSeconds);
  const [mskTxFirst,setMskTxFirst] = useState(() => loadNativeDecodePreferences(mode as NativeDigitalMode).mskTxFirst);
  const [q65TxFirst,setQ65TxFirst] = useState(() => loadNativeDecodePreferences(mode as NativeDigitalMode).q65TxFirst);
  const [txPending,setTxPending] = useState(false);
  const [autoPending,setAutoPending] = useState(false);
  const [autoStatus,setAutoStatus] = useState<Awaited<ReturnType<typeof api.getMfskNativeAutoTxStatus>>|null>(null);
  const [txStopPending,setTxStopPending] = useState(false);
  const [txNotice,setTxNotice] = useState<string | null>(null);
  const [dxCall,setDxCall] = useState('');
  const [dxGrid,setDxGrid] = useState('');
  const [txReport,setTxReport] = useState('-10');
  const [rxReport,setRxReport] = useState('-12');
  const [frequencyMHz,setFrequencyMHz] = useState('');
  const [contactStartMs,setContactStartMs] = useState(() => Date.now());
  const [qsoBusy,setQsoBusy] = useState(false);
  const [qsoNotice,setQsoNotice] = useState<string|null>(null);
  // AP call hypotheses stay in the receiver pane; sensitivity is managed centrally.
  const [rxMoreOpen,setRxMoreOpen] = useState(false);
  const [txMoreOpen,setTxMoreOpen] = useState(false);
  const [logOpen,setLogOpen] = useState(false);


  useEffect(()=>{
    let active=true;
    const poll=()=>{
      void api.getMfskLiveRxEvents(0).then(data=>{
        if(!active)return;
        setStatus(data.status);
        setEvents(data.events.slice(-60));
        if(data.status.mode==='WSPR'){
          void api.getMfskLiveWsprSpots().then(result=>{
            if(active)setWsprSpots(result.spots);
          }).catch(()=>{if(active)setWsprSpots([]);});
        }
      }).catch(()=>{/* Feature is optional on non-experimental server. */});
      void api.getMfskNativeAutoTxStatus().then(value=>{if(active)setAutoStatus(value);}).catch(()=>{
        if(active)setAutoStatus(null);
      });
      void api.getMfskNativeTxStatus(currentOperatorId??undefined).then(value=>{if(active)setTxStatus(value);}).catch(()=>{
        if(active)setTxStatus({rfEnabled:false,busy:false,remainingMs:0});
      });
    };
    poll();
    const timer=setInterval(poll,1500);
    return ()=>{active=false;clearInterval(timer);};
  },[currentOperatorId]);

  useEffect(() => {
    if (surface !== 'receiver') return;
    const apply = (event: Event) => {
      const changed = (event as CustomEvent<{mode:NativeDigitalMode}>).detail;
      if (changed?.mode !== mode) return;
      const prefs = loadNativeDecodePreferences(mode as NativeDigitalMode);
      setFrequency(String(prefs.frequencyHz));
      setTolerance(String(prefs.toleranceHz));
      setDecodeDepth(prefs.depth);
      setSubmode(prefs.q65Submode);
      setSubmodeDirty(true);
      setAveraging(prefs.averaging);
      setEmeDelay(prefs.emeDelay);
    };
    window.addEventListener(DECODE_PREFERENCES_CHANGED_EVENT, apply);
    return () => window.removeEventListener(DECODE_PREFERENCES_CHANGED_EVENT, apply);
  },[surface,mode]);

  // The quick-panel TX controls and operator pane share persisted settings.
  // Updating these fields never keys the radio or starts an automatic TX job.
  const saveTxOption = (patch: Partial<NativeDecodePreferences>) => {
    const selectedMode = mode as NativeDigitalMode;
    saveNativeDecodePreferences(selectedMode, { ...loadNativeDecodePreferences(selectedMode), ...patch });
  };
  useEffect(() => {
    const apply = () => {
      const prefs = loadNativeDecodePreferences(mode as NativeDigitalMode);
      setTxFrequency(String(prefs.txAudioHz));
      setMskPeriod(prefs.mskPeriodSeconds);
      setMskTxFirst(prefs.mskTxFirst);
      setQ65TxFirst(prefs.q65TxFirst);
    };
    apply();
    const onChanged = (event: Event) => {
      if ((event as CustomEvent<{ mode: NativeDigitalMode }>).detail?.mode === mode) apply();
    };
    window.addEventListener(DECODE_PREFERENCES_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(DECODE_PREFERENCES_CHANGED_EVENT, onChanged);
  }, [mode]);

  // Keep the Q65 selector aligned with the receiver after a page reload,
  // unless the operator is intentionally editing the next submode.
  useEffect(()=>{
    if(surface==='receiver' && !submodeDirty && status?.mode==='Q65' && status.q65Submode){
      setSubmode(status.q65Submode);
    }
  },[surface,submodeDirty,status?.mode,status?.q65Submode]);

  // Receiver settings live in the left pane. The right pane must use
  // the server-confirmed Q65 submode rather than its own initial state.
  const activeSubmode = surface==='operator'
    ? status?.q65Submode ?? 'Q65-60B' : submode;
  useEffect(()=>{
    if(surface!=='operator')return;
    const listener=(event:Event)=>{
      const detail=(event as CustomEvent<NativeDigitalSelection>).detail;
      if(!detail || detail.mode!==mode)return;
      if(Number.isFinite(detail.audioHz) && detail.audioHz>=100 && detail.audioHz<=5500
        && mode!=='MSK144')setTxFrequency(String(Math.round(detail.audioHz)));
      const call=extractCqCallsign(detail.text);
      if(call)setDxCall(call);
    };
    window.addEventListener(NATIVE_DIGITAL_SELECTION_EVENT,listener);
    return ()=>window.removeEventListener(NATIVE_DIGITAL_SELECTION_EVENT,listener);
  },[mode,surface]);

  const selectReceived=(event:DigitalRxEvent)=>{
    if(mode==='Q65'){
      const call=extractCqCallsign(event.text);
      if(call)setApDxCall(call);
    }
    window.dispatchEvent(new CustomEvent<NativeDigitalSelection>(
      NATIVE_DIGITAL_SELECTION_EVENT,{detail:{
        mode,text:event.text,audioHz:event.frequencyHz,
      }},
    ));
  };

  const selectedOperator=operators.find(item=>item.id===currentOperatorId);
  const ownCall=selectedOperator?.context?.myCall?.trim().toUpperCase()??'';
  const ownGrid=selectedOperator?.context?.myGrid?.trim().toUpperCase()??'';
  useEffect(()=>{
    if(surface!=='receiver')return;
    if(ownCall)setApMyCall(old=>old||ownCall);
    if(ownGrid)setApMyGrid(old=>old||ownGrid);
  },[surface,ownCall,ownGrid]);
  const updateAp=()=>{
    if(!status?.ready || status.mode!=='Q65' || apApplying)return;
    const ctx=apMyCall.trim()&&apMyGrid.trim()&&apDxCall.trim()?{
      myCall:apMyCall.trim().toUpperCase(),
      myGrid:apMyGrid.trim().toUpperCase(),
      dxCall:apDxCall.trim().toUpperCase(),
      ...(apDxGrid.trim()?{dxGrid:apDxGrid.trim().toUpperCase()}:{}),
      progress:apProgress,
    }:null;
    setApApplying(true);setApNotice(null);
    void api.updateMfskLiveRxApContext(ctx)
      .then(()=>setApNotice(t('codec.apUpdated')))
      .catch(()=>setApNotice(t('codec.apUpdateFailed')))
      .finally(()=>setApApplying(false));
  };
  const useTxTemplate=(kind:'cq'|'report'|'roger'|'rr73')=>{
    if(!ownCall)return;
    const dx=dxCall.trim().toUpperCase();
    if(kind==='cq'){
      if(ownGrid)setText(`CQ ${ownCall} ${ownGrid.slice(0,4)}`);
    }else if(dx){
      setText(`${dx} ${ownCall} ${kind==='report'?txReport.trim()||'-10':
        kind==='roger'? `R${(txReport.trim()||'-10').replace(/^R/,'')}`: 'RR73'}`);
    }
  };

  const receiverMatches=Boolean(status?.ready && status.mode===mode &&
    (mode!=='Q65'||status.q65Submode===activeSubmode));

  const run=(start:boolean)=>{
    if(surface!=='receiver'||!maySwitchMode)return;
    setBusy(true);setError(null);
    const hz=Number(frequency),tol=Number(tolerance);
    if(start && (!Number.isFinite(hz)||hz<100||hz>5500)){
      setBusy(false);setError(t('codec.liveInvalidFrequency'));return;
    }
    if(start && (!Number.isFinite(tol)||tol<1||tol>5000)){
      setBusy(false);setError(t('codec.rxInvalidTolerance'));return;
    }
    const action=start
      ? api.startMfskLiveRx({
          mode,...(mode==='Q65'?{
            q65Submode:submode,averaging,emeDelay,
            q65Search: (() => {
              const prefs = loadNativeDecodePreferences('Q65');
              return {
                ...(prefs.q65TimeToleranceSec !== null
                  ? {timeToleranceSeconds:prefs.q65TimeToleranceSec} : {}),
                ...(prefs.q65SyncScore !== null
                  ? {scoreThreshold:prefs.q65SyncScore} : {}),
                ...(prefs.q65MaxCandidates !== null
                  ? {maxCandidates:prefs.q65MaxCandidates} : {}),
              };
            })(),
            ...(apMyCall.trim()&&apMyGrid.trim()&&apDxCall.trim()?{
              apContext:{
                myCall:apMyCall.trim().toUpperCase(),myGrid:apMyGrid.trim().toUpperCase(),
                dxCall:apDxCall.trim().toUpperCase(),
                ...(apDxGrid.trim()?{dxGrid:apDxGrid.trim().toUpperCase()}:{}),
                progress:apProgress,
              },
            }:{}),
          }:{}),
          frequencyHz:hz,toleranceHz:tol,depth:decodeDepth,
          ...(mode==='MSK144'?(() => {
            const prefs=loadNativeDecodePreferences('MSK144');
            if(!prefs.mskMyCall || !prefs.mskDxCall)return {};
            return {msk144Rx:{
              myCall:prefs.mskMyCall,dxCall:prefs.mskDxCall,
              shorthand:prefs.mskShorthand && tol<=250,
              adaptiveEqualizer:prefs.mskAdaptiveEqualizer,
            }};
          })():{}),
        })
      : api.stopMfskLiveRx();
    void action.then(value=>{
      if(start)setSubmodeDirty(false);
      setStatus(value);
      if(start){setEvents([]);setWsprSpots([]);}
      // Stop is graceful for JTTY: retain final reception-ended messages.
    })
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
      ...(mode==='Q65'?{q65Submode:activeSubmode}:{}),
      messageHistory:matched,
    }).then(value=>{
      setQsoNotice(value.success?t('codec.logSaved'):t('codec.logFailed'));
      if(value.success){setContactStartMs(Date.now());setDxCall('');}
    }).catch(()=>setQsoNotice(t('codec.logFailed')))
      .finally(()=>setQsoBusy(false));
  };

  const autoActive=autoStatus?.enabled===true && autoStatus.mode===mode
    && autoStatus.operatorId===currentOperatorId;
  const startAutomaticTransmission=()=>{
    if(autoPending||!mayArmRf||!receiverMatches||!currentOperatorId||autoActive)return;
    const audioHz=Number(mode==='MSK144'?1500:txFrequency);
    if(!Number.isFinite(audioHz)||audioHz<100||audioHz>5500){
      setTxNotice(t('codec.liveInvalidFrequency'));return;
    }
    setAutoPending(true);
    setTxNotice(null);
    void api.startMfskNativeAutoTx({
      mode:mode as 'Q65'|'MSK144'|'WSPR',
      operatorId:currentOperatorId,
      audioHz,
      ...(mode==='WSPR'?{text:text.trim()}:{}),
      ...(mode==='Q65'?{q65Submode:activeSubmode,q65TxFirst}:{}),
      ...(mode==='MSK144'?{mskPeriodSeconds:mskPeriod,mskTxFirst}:{}),
    }).then(()=>api.getMfskNativeAutoTxStatus()).then(setAutoStatus)
      .catch(error=>setTxNotice(error instanceof Error?error.message:String(error)))
      .finally(()=>setAutoPending(false));
  };
  const stopAutomaticTransmission=()=>{
    if(autoPending||!currentOperatorId||!autoActive)return;
    setAutoPending(true);
    void api.stopMfskNativeAutoTx(currentOperatorId).then(()=>api.getMfskNativeAutoTxStatus())
      .then(setAutoStatus).catch(error=>setTxNotice(error instanceof Error?error.message:String(error)))
      .finally(()=>setAutoPending(false));
  };

  const transmit=()=>{
    if(!mayArmRf || !currentOperatorId || !receiverMatches || autoStatus?.enabled || txStatus.busy || txPending || txStopPending) return;
    const hz=Number(mode==='MSK144'?1500:txFrequency);
    if(!Number.isFinite(hz)||hz<100||hz>5500) {
      setTxNotice(t('codec.liveInvalidFrequency')); return;
    }
    setTxPending(true);
    setTxNotice(null);
    void api.transmitMfsk({
      mode,operatorId:currentOperatorId,text:text.trim(),
      audioHz:hz,
      ...(mode==='Q65'?{q65Submode:activeSubmode,q65TxFirst}:{}),
      ...(mode==='MSK144'?{mskPeriodSeconds:mskPeriod,mskTxFirst}:{}),
    }).then(()=>setTxNotice(t('codec.txComplete')))
      .catch(()=>setTxNotice(t('codec.txFailed')))
      .finally(()=>setTxPending(false));
  };

  const stopTransmission=()=>{
    if(txStopPending || (!txPending && !txStatus.busy))return;
    setTxStopPending(true);
    void api.disarmMfskNativeTx()
      .then(()=>setTxNotice(t('codec.txStopped')))
      .catch(()=>setTxNotice(t('codec.txStopFailed')))
      .finally(()=>setTxStopPending(false));
  };

  return <Card shadow="none" className="h-full min-h-0 overflow-hidden bg-transparent">
    <CardBody className={surface==='receiver'
      ? 'flex h-full min-h-0 flex-col gap-2 p-1'
      : 'h-full min-h-0 overflow-y-auto overscroll-contain gap-3 p-2'}>
      {surface==='receiver' && <>
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-default-200 bg-content1 p-2">
        <span className="rounded-md bg-default-100 px-2 py-1 text-sm font-semibold">{mode}</span>
        {mode==='Q65' && <select id="mfsk-live-q65" aria-label={t('codec.submode')}
          value={submode} onChange={e=>{setSubmode(e.target.value as Q65Submode);setSubmodeDirty(true);}}
          className="max-w-[130px] rounded-md border border-default-300 bg-content1 px-2 py-1 text-xs"
          disabled={busy}>
          {Q65SubmodeSchema.options.map(m=><option key={m} value={m}>{m}</option>)}
        </select>}
        <Input size="sm" className="w-32" type="number"
          label={t('codec.afFrequency')} value={frequency} onValueChange={setFrequency}
          isDisabled={busy}/>
        <Button size="sm" color="primary" onPress={()=>run(true)}
          isDisabled={busy||!maySwitchMode} isLoading={busy}>
          {status?.running?t('codec.applyRx'):t('codec.startRx')}
        </Button>
        <Button size="sm" variant="flat" onPress={()=>run(false)}
          isDisabled={busy||!maySwitchMode||!status?.running}>{t('codec.stopRx')}</Button>
        <span className="text-xs text-default-500">
          {status?.ready?t('codec.liveReady'):status?.running?t('codec.liveStarting'):t('codec.liveStopped')}
        </span>
        <Button size="sm" variant="light" className="ml-auto min-w-8 px-2"
          title={rxMoreOpen?t('codec.lessSettings'):t('codec.moreSettings')}
          aria-label={t('codec.moreSettings')} aria-expanded={rxMoreOpen}
          onPress={()=>setRxMoreOpen(value=>!value)}>⋯</Button>
      </div>
      {rxMoreOpen && <section className="space-y-3 rounded-xl border border-default-200 bg-content1 p-3">
        <p className="text-xs text-default-500">{t('codec.liveSubtitle')}</p>
        <div className="text-xs text-default-500">
          {t('codec.afFrequency')}: {frequency} Hz · {t('codec.rxTolerance')}: {tolerance} Hz · {t('codec.rxDepth')}: {decodeDepth}
        </div>
        {mode==='Q65' && <section className="rounded-md border border-default-200 p-2 space-y-2">
          <p className="text-xs font-medium">{t('codec.apTitle')}</p>
          <div className="grid grid-cols-2 gap-2">
            <Input size="sm" maxLength={24} value={apMyCall} onValueChange={setApMyCall}
              label={t('codec.apMyCall')}/>
            <Input size="sm" maxLength={6} value={apMyGrid} onValueChange={setApMyGrid}
              label={t('codec.apMyGrid')}/>
            <Input size="sm" maxLength={24} value={apDxCall} onValueChange={setApDxCall}
              label={t('codec.apDxCall')}/>
            <Input size="sm" maxLength={6} value={apDxGrid} onValueChange={setApDxGrid}
              label={t('codec.apDxGrid')}/>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <label className="text-xs" htmlFor="mfsk-ap-progress">{t('codec.apProgress')}</label>
            <select id="mfsk-ap-progress" value={apProgress}
              onChange={e=>setApProgress(Number(e.target.value) as 0|1|2|3|4|5)}
              className="rounded-md border border-default-300 bg-content1 px-2 py-1 text-xs">
              {([0,1,2,3,4,5] as const).map(n=>
                <option key={n} value={n}>{t(`codec.apStage${n}`)}</option>)}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="flat" isLoading={apApplying}
              isDisabled={apApplying||!status?.ready||status.mode!=='Q65'}
              onPress={updateAp}>{t('codec.apApply')}</Button>
            <span className="text-xs text-default-500">{apNotice}</span>
          </div>
          <p className="text-xs text-default-500">{t('codec.apGuide')}</p>
        </section>}
        {!!status && <p className="text-xs text-default-500">
          RX: {status.received} · {t('codec.dropped')}: {status.droppedAudioChunks} ·
          {t('codec.rejectedSlots')}: {status.rejectedSlots} ·
          {t('codec.workerFaults')}: {status.workerFaults}
        </p>}
      </section>}
      {status?.lastError && <p role="alert" className="text-xs text-danger">{status.lastError}</p>}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      <div className="min-h-[12rem] flex-1 overflow-y-auto rounded-xl border border-default-200 bg-content1">
        {displayEvents.length===0 ?
          <p className="p-3 text-sm text-default-500">{t('codec.liveNoEvents')}</p>
          : <table className="w-full table-fixed text-left text-xs">
            <colgroup><col className="w-20"/><col className="w-14"/><col className="w-12"/><col /></colgroup>
            <thead><tr className="bg-default-100"><th className="px-2 py-1 whitespace-nowrap">UTC</th>
              <th className="px-2 py-1 text-right">Hz</th><th className="px-2 py-1 text-right">SNR</th>
              <th className="px-2 py-1">{t('codec.decoded')}</th></tr></thead>
            <tbody>{displayEvents.map((e,i)=><tr key={`${e.timestampMs}-${i}`}
              className="border-t border-default-100 cursor-pointer hover:bg-default-100"
              tabIndex={0} title={t('codec.selectDecode')}
              onDoubleClick={()=>selectReceived(e)}
              onKeyDown={event=>{if(event.key==='Enter')selectReceived(e);}}>
              <td className="px-2 py-1 whitespace-nowrap">{new Date(e.timestampMs).toISOString().slice(11,19)}</td>
              <td className="px-2 py-1 text-right font-mono tabular-nums">{formatDecodedAfHz(e.frequencyHz)}</td>
              <td className="px-2 py-1 text-right font-mono tabular-nums">{e.kind==='message-update'?'—':formatDecodedSnr(e.snrDb)}</td>
              <td className="px-2 py-1 min-w-0 break-words font-mono">{e.text}</td>
            </tr>)}</tbody></table>}
      </div>
      {status?.mode==='WSPR' && <section className="rounded-md border border-default-200 p-3">
        <h3 className="text-sm font-medium mb-1">{t('codec.wsprSpots')}</h3>
        <p className="text-xs text-default-500 mb-2">{t('codec.wsprLocalOnly')}</p>
        {wsprSpots.length===0?<p className="text-xs text-default-500">{t('codec.wsprNoSpots')}</p>:
          <div className="max-h-56 overflow-auto">
            <table className="w-full table-fixed text-left text-xs">
              <thead><tr>
                <th className="p-1">UTC</th><th className="p-1">{t('codec.dxCall')}</th>
                <th className="p-1">Grid</th><th className="p-1">dBm</th>
                <th className="p-1">SNR</th><th className="p-1">AF Hz</th>
              </tr></thead><tbody>{wsprSpots.map((spot,i)=><tr
                key={`${spot.slotId}-${spot.callsign}-${i}`} className="border-t border-default-100">
                <td className="p-1">{new Date(spot.receivedAtMs).toISOString().slice(11,19)}</td>
                <td className="p-1 font-mono">{spot.callsign}</td>
                <td className="p-1">{spot.grid}</td><td className="p-1">{spot.powerDbm}</td>
                <td className="p-1 text-right font-mono tabular-nums">{formatDecodedSnr(spot.snrDb)}</td>
                <td className="p-1 text-right font-mono tabular-nums">{formatDecodedAfHz(spot.audioHz)}</td>
              </tr>)}</tbody>
            </table>
          </div>}
      </section>}
      </>}
      {surface==='operator' && <>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-default-200 bg-content1 p-3">
        <span className="text-sm font-semibold">{t('codec.operatorSelect')}</span>
        <select aria-label={t('codec.operatorSelect')} className="rounded-md border border-default-300 bg-content1 px-2 py-1 text-sm"
          value={currentOperatorId??''}
          onChange={e=>setCurrentOperatorId(e.target.value)}>
          <option value="" disabled>{t('codec.operatorRequired')}</option>
          {operators.map(operator=><option key={operator.id} value={operator.id}>
            {operator.context?.myCall || operator.id}
          </option>)}
        </select>
        <Button size="sm" variant="flat" onPress={()=>
          window.dispatchEvent(new CustomEvent('openSettingsModal',{detail:{tab:'operator'}}))}>
          {t('codec.manageOperators')}
        </Button>
      </div>
      <div className="rounded-xl border border-default-200 bg-content1 p-3 space-y-3">
        <p className="text-sm font-medium">{t('codec.txTitle')} · {mode}{mode==='Q65'? ` (${activeSubmode})`:''}</p>
        {mode==='MSK144' && <p className="text-xs text-default-500">{t('codec.mskFixedTxAf')}</p>}
        {mode!=='WSPR' && <Input size="sm" label={t('codec.dxCall')}
          value={dxCall} onValueChange={setDxCall} maxLength={24}/>}
        <Input size="sm" label={t('codec.message')} value={text} onValueChange={setText}
          isDisabled={txPending} maxLength={64}/>
        {(mode==='Q65'||mode==='MSK144') && <div className="flex flex-wrap gap-1">
          {(['cq','report','roger','rr73'] as const).map(kind=>
            <Button key={kind} size="sm" variant="flat" isDisabled={!ownCall||txPending||
              (kind==='cq'?!ownGrid:!dxCall.trim())}
              onPress={()=>useTxTemplate(kind)}>{t(`codec.template.${kind}`)}</Button>)}
        </div>}
        {mode!=='MSK144' && <Input size="sm" type="number"
          label={t('codec.txAfFrequency')} value={txFrequency}
          onValueChange={setTxFrequency}
          onBlur={() => {
            const hz = Number(txFrequency);
            if (Number.isInteger(hz) && hz >= 100 && hz <= 5500) saveTxOption({ txAudioHz: hz });
          }}
          isDisabled={txPending}/>} 
        {(mode==='Q65'||mode==='MSK144') && <div className="flex justify-end">
          <Button size="sm" variant="light" className="min-w-8 px-2"
            title={txMoreOpen?t('codec.lessSettings'):t('codec.moreSettings')}
            aria-label={t('codec.moreSettings')} aria-expanded={txMoreOpen}
            onPress={()=>setTxMoreOpen(value=>!value)}>⋯</Button>
        </div>}
        {txMoreOpen && <div className="space-y-3 rounded-md bg-default-50 p-2">
        {mode==='Q65' && <label className="text-xs flex gap-2 items-center">
          <input type="checkbox" checked={q65TxFirst}
            onChange={e=>{setQ65TxFirst(e.target.checked);saveTxOption({q65TxFirst:e.target.checked});}} disabled={txPending}/>
          {t('codec.q65TxFirst')}
        </label>}
        {mode==='MSK144' && <div className="flex gap-2 items-center">
          <label htmlFor="mfsk-msk-period" className="text-xs">{t('codec.mskPeriod')}</label>
          <select id="mfsk-msk-period" value={mskPeriod}
            disabled={txPending||status?.running&&txStatus.busy}
            onChange={e=>{
              const value = Number(e.target.value) as 5|10|15|30;
              setMskPeriod(value);
              saveTxOption({mskPeriodSeconds:value});
            }}
            className="rounded-md border border-default-300 bg-content1 px-3 py-2 text-sm">
            {[5,10,15,30].map(seconds=><option key={seconds} value={seconds}>{seconds}s</option>)}
          </select>
        </div>}
        {mode==='MSK144' && <label className="text-xs flex gap-2 items-center">
          <input type="checkbox" checked={mskTxFirst}
            onChange={e=>{setMskTxFirst(e.target.checked);saveTxOption({mskTxFirst:e.target.checked});}} disabled={txPending}/>
          {t('codec.mskTxFirst')}
        </label>}
        </div>}
        <div className="flex gap-2 items-center flex-wrap">
          <Button size="sm" color="warning" isLoading={txPending}
            isDisabled={!mayArmRf||!receiverMatches||autoStatus?.enabled||txStatus.busy||!currentOperatorId||
              !text.trim()||txPending||txStopPending}
            onPress={transmit}>{t('codec.manualTx')}</Button>
          {(mode==='Q65'||mode==='MSK144'||mode==='WSPR') && (
            autoActive ? <Button size="sm" color="warning" variant="flat"
              isLoading={autoPending} isDisabled={autoPending}
              onPress={stopAutomaticTransmission}>STOP AUTO</Button>
            : <Button size="sm" color="primary" variant="flat"
              isLoading={autoPending}
              isDisabled={!mayArmRf||!receiverMatches||!currentOperatorId||txStatus.busy||autoPending||
                (mode==='WSPR'&&!text.trim())}
              onPress={startAutomaticTransmission}>AUTO TX</Button>
          )}
          <Button size="sm" variant="flat" isLoading={txStopPending}
            isDisabled={(!txPending&&!txStatus.busy)||txStopPending}
            onPress={stopTransmission}>{t('codec.stopTx')}</Button>
        </div>
        {!autoActive && (mode==='Q65'||mode==='MSK144'||mode==='WSPR') &&
          <p className="text-xs text-warning-600" role="status">{t('codec.autoNeedsStart')}</p>}
        {autoActive && autoStatus?.pending && <p className="text-xs text-default-500" role="status">
          {t('codec.autoPending')}
        </p>}
        {autoActive && autoStatus?.lastError && <p className="text-xs text-danger" role="alert">
          {t('codec.txFailed')}: {autoStatus.lastError}
        </p>}
        {autoActive && autoStatus?.lastPhysicalTxConfirmed === true && <p className="text-xs text-success" role="status">
          {t('codec.autoConfirmed')}
        </p>}
        {txNotice && <p className="text-xs" role="status">{txNotice}</p>}
      </div>
      {(mode==='Q65'||mode==='JTTY'||mode==='MSK144') && <section className="rounded-xl border border-default-200 bg-content1 p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">{t('codec.logTitle')}</p>
          <Button size="sm" variant="light" className="min-w-8 px-2"
            title={logOpen?t('codec.logCollapse'):t('codec.logExpand')}
            aria-label={t('codec.logExpand')} aria-expanded={logOpen}
            onPress={()=>setLogOpen(value=>!value)}>⋯</Button>
        </div>
        {logOpen && <>
        <p className="text-xs text-default-500">{t('codec.logManualOnly')}</p>
        <div className="grid grid-cols-2 gap-2">
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
        </>}
        {qsoNotice && <p className="text-xs" role="status">{qsoNotice}</p>}
      </section>}
      </>}
    </CardBody>
  </Card>;
}
