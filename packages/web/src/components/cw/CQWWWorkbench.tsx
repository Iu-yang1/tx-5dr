import React, { useEffect, useRef, useState } from 'react';
import { Button, Chip, Input } from '@heroui/react';
import { useTranslation } from 'react-i18next';
import { api } from '@tx5dr/core';
import type { CWContestSnapshot, N1MMEntryFields, N1MMEntryState } from '@tx5dr/contracts';
import { useCWKeyer } from '../../hooks/useCWKeyer';
import { useOperators, useCurrentOperatorId, useRadioConnectionState } from '../../store/radioStore';
import { useCWQSODraft, setCWQSOHisCallsign } from '../../store/cwQsoDraftStore';
import { cqwwMessages } from './contestMessages';
import { useCWContestProfile, updateCWContestProfile } from '../../store/cwContestProfileStore';

export function CQWWWorkbench() {
  const { t } = useTranslation('radio');
  const { operators } = useOperators();
  const { currentOperatorId } = useCurrentOperatorId();
  const { radioConnected } = useRadioConnectionState();
  const { hisCallsign } = useCWQSODraft();
  const { cwKeyerStatus, isCWMode, sendText, stopMessage } = useCWKeyer();
  const operator = operators.find(op => op.id === currentOperatorId)?.context?.myCall ?? '';
  const { stationCall, sentZone, run } = useCWContestProfile();
  const [snapshot, setSnapshot] = useState<CWContestSnapshot>();
  const [entry,setEntry] = useState<N1MMEntryState>();
  const [zone,setZone] = useState('');
  const [spotFilter,setSpotFilter] = useState<'all'|'mult'|'new'>('all');
  const [entryError,setEntryError] = useState('');
  const editing=useRef(false);
  const editTimer=useRef<ReturnType<typeof setTimeout>>();
  const tail=useRef(Promise.resolve());
  const wanted=useRef<N1MMEntryFields>({call:'',zone:''});
  const sequence=useRef(0);
  const applyEntry=(fields:N1MMEntryFields)=>{
    wanted.current=fields;setCWQSOHisCallsign(fields.call);setZone(fields.zone);
  };
  const requestEntry=(fields:N1MMEntryFields)=>{
    applyEntry(fields);
    if(!entry?.online)return;
    editing.current=true;const seq=++sequence.current;
    if(editTimer.current)clearTimeout(editTimer.current);
    editTimer.current=setTimeout(()=>{
      tail.current=tail.current.catch(()=>undefined).then(async()=>{
        if(seq!==sequence.current)return;
        try{const state=await api.updateN1MMEntry(fields);if(seq===sequence.current){setEntry(state);setEntryError('');}}
        catch(error){if(seq===sequence.current)setEntryError(String(error));}
        finally{if(seq===sequence.current)editing.current=false;}
      });
    },120);
  };
  useEffect(()=>{
    let disposed=false;let timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{
      try{const state=await api.getN1MMEntry();if(!disposed){setEntry(state);if(state.online&&!state.pending&&!editing.current){applyEntry(state.fields);}}}
      catch{if(!disposed)setEntry(undefined);}
      finally{if(!disposed)timer=setTimeout(()=>{void poll();},250);}
    };
    void poll();return()=>{disposed=true;clearTimeout(timer);if(editTimer.current)clearTimeout(editTimer.current);sequence.current++;};
  },[]);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await api.getCWContestSnapshot();
        if (!disposed) { setSnapshot(next); setUnavailable(false); }
      } catch {
        if (!disposed) setUnavailable(true);
      } finally {
        if (!disposed) timer = setTimeout(() => { void poll(); }, 1500);
      }
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, []);
  const messages = cqwwMessages({ stationCall, hisCall: hisCallsign, sentZone, run });
  const busy = Boolean(cwKeyerStatus?.active);
  const canSend = Boolean(operator && radioConnected && isCWMode && !busy && cwKeyerStatus?.backendAvailable !== false);
  const radio = snapshot?.radio;
  const fresh = !unavailable && radio && Date.now() - radio.receivedAt < 30000;
  const filtered = snapshot?.contacts.filter(q => !stationCall || q.stationCall === stationCall.trim().toUpperCase()) ?? [];
  const matching = filtered.filter(q => q.call === hisCallsign.trim().toUpperCase());
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-1">
      <div className="flex flex-wrap items-center gap-1 text-xs">
        <Chip size="sm" variant="flat" color={fresh ? 'success' : 'default'}>N1MM {fresh ? 'RX' : '—'}</Chip>
        <Chip size="sm" variant="flat" color={snapshot?.cat?.clients ? 'success' : 'default'}>CAT {snapshot?.cat?.clients ?? 0}</Chip>
        <Chip size="sm" variant="flat" color={snapshot?.winkey?.opened?'success':'default'}>WK {snapshot?.winkey?.busy?'TX':snapshot?.winkey?.opened?'ON':'—'}</Chip>
        <Chip size="sm" variant="flat" color={entry?.online?'success':'default'}>ENTRY {entry?.online?'ON':'—'}</Chip>
        <span className="font-mono">OP: {operator || '—'}</span>
        {radio && <span className="font-mono">{radio.operator || '—'} · {(radio.frequencyHz / 1e6).toFixed(5)} MHz · {radio.running ? 'RUN' : 'S&P'}</span>}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Input size="sm" label={t('cw.contest.stationCall')} value={stationCall} onValueChange={value => updateCWContestProfile({ stationCall: value.toUpperCase() })} />
        <Input size="sm" label={t('cw.contest.sentZone')} value={sentZone} onValueChange={value => updateCWContestProfile({ sentZone: value })} />
        <Input size="sm" label={t('cw.contest.hisCall')} value={hisCallsign} onValueChange={call=>requestEntry({call:call.toUpperCase().replace(/[^A-Z0-9/]/g,'').slice(0,20),zone})} />
        <Input size="sm" label={t('cw.contest.receivedZone')} value={zone} onValueChange={value=>requestEntry({call:hisCallsign,zone:value.replace(/\D/g,'').slice(0,2)})} />
        <div className="flex items-center gap-1">
          <Button size="sm" variant={run ? 'solid' : 'flat'} onPress={() => updateCWContestProfile({ run: true })}>RUN</Button>
          <Button size="sm" variant={!run ? 'solid' : 'flat'} onPress={() => updateCWContestProfile({ run: false })}>S&amp;P</Button>
        </div>
      </div>
      {fresh && snapshot?.lookup && Date.now() - snapshot.lookup.receivedAt < 30000 && <Button size="sm" variant="flat" onPress={() => requestEntry({call:snapshot.lookup!.call,zone:snapshot.lookup!.zone.replace(/\D/g,'').slice(0,2)})}>{t('cw.contest.useLookup')}: {snapshot.lookup.call}</Button>}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
        {messages.map(message => <Button key={message.key} size="sm" variant="flat" className="h-auto min-h-8 min-w-0 justify-start whitespace-normal py-1 text-left text-xs"
          isDisabled={!canSend || !message.text}
          onPress={() => sendText(message.text, operator)}>
          <span className="shrink-0 font-semibold">{message.key}</span><span className="min-w-0 break-all">{message.text || '—'}</span>
        </Button>)}
        <Button size="sm" color="danger" variant="flat" onPress={stopMessage}>STOP</Button>
      </div>
      {(entryError||entry?.error||snapshot?.winkey?.error)&&<p className="text-xs text-warning">{entryError||entry?.error||snapshot?.winkey?.error}</p>}
      <p className="text-xs text-default-500">{t('cw.contest.logAuthority')}</p>
      {snapshot?.score&&<div className="rounded-md bg-content2 p-2 text-xs"><strong>{t('cw.contest.score')}: {snapshot.score.score.toLocaleString()}</strong> <span className="text-default-500">{snapshot.score.timestamp}</span><div className="flex flex-wrap gap-2">{snapshot.score.breakdown.filter(x=>x.kind==='qso'&&x.mode==='CW').map((x,i)=><span key={i}>{x.band}: {x.value}</span>)}</div></div>}
      <div className="flex items-center gap-1 text-xs"><strong className="flex-1">Bandmap / RBN</strong>{(['all','mult','new'] as const).map(value=><Button key={value} size="sm" variant={spotFilter===value?'solid':'flat'} onPress={()=>setSpotFilter(value)}>{value.toUpperCase()}</Button>)}</div>
      <div className="max-h-48 overflow-auto">{snapshot?.spots?.filter(s=>spotFilter==='all'||(spotFilter==='mult'?s.status.includes('mult'):s.status==='new qso')).map(s=><button key={s.call+':'+s.frequencyHz} type="button" title={s.comment+' / '+s.spotter} className="grid w-full grid-cols-3 gap-1 border-b border-default-100 py-1 text-left text-xs font-mono hover:bg-content2" onClick={()=>requestEntry({call:s.call,zone:''})}><span>{(s.frequencyHz/1000).toFixed(2)}</span><span>{s.call}</span><span>{s.status}</span></button>)}</div>
      <div className="flex items-center justify-between text-xs">
        <span>{t('cw.contest.observed')}: {snapshot?.observedContacts ?? 0}</span>
        {matching.length > 0 && <Chip size="sm" color="warning" variant="flat">{t('cw.contest.workedCandidate')}: {matching.map(q => q.band).filter((b, i, a) => a.indexOf(b) === i).join(', ')}</Chip>}
      </div>
      {(!snapshot?.listening || unavailable || !fresh) && <p className="text-xs text-warning">{t('cw.contest.mirrorUnavailable')}{snapshot?.error ? ': ' + snapshot.error : ''}</p>}
      <div className="min-h-0 overflow-auto">
        {filtered.map(q => <div key={q.stationCall + ':' + q.contestNr + ':' + q.id} className="grid grid-cols-4 gap-1 border-b border-default-100 py-1 text-xs font-mono">
          <span>{q.timestamp.split(' ')[1]?.slice(0, 5) ?? q.timestamp}</span><span>{q.call}</span><span>{q.band}</span><span>{q.zoneReceived}</span>
        </div>)}
      </div>
    </div>
  );
}
