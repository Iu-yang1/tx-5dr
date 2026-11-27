import React, { useEffect, useState } from 'react';
import { Button, Chip, Input } from '@heroui/react';
import { useTranslation } from 'react-i18next';
import { api } from '@tx5dr/core';
import type { CWContestSnapshot } from '@tx5dr/contracts';
import { useCWKeyer } from '../../hooks/useCWKeyer';
import { useOperators, useCurrentOperatorId, useRadioConnectionState } from '../../store/radioStore';
import { useCWQSODraft, setCWQSOHisCallsign } from '../../store/cwQsoDraftStore';
import { cqwwMessages } from './contestMessages';

function stored(key: string, fallback: string): string {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function save(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* storage may be unavailable */ }
}

export function CQWWWorkbench() {
  const { t } = useTranslation('radio');
  const { operators } = useOperators();
  const { currentOperatorId } = useCurrentOperatorId();
  const { radioConnected } = useRadioConnectionState();
  const { hisCallsign } = useCWQSODraft();
  const { cwKeyerStatus, isCWMode, sendText, stopMessage } = useCWKeyer();
  const operator = operators.find(op => op.id === currentOperatorId)?.context?.myCall ?? '';
  const [stationCall, setStationCall] = useState(() => stored('tx5dr_cqww_station_call', ''));
  const [sentZone, setSentZone] = useState(() => stored('tx5dr_cqww_sent_zone', ''));
  const [run, setRun] = useState(() => stored('tx5dr_cqww_run', 'true') === 'true');
  const [snapshot, setSnapshot] = useState<CWContestSnapshot>();
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
        <span className="font-mono">OP: {operator || '—'}</span>
        {radio && <span className="font-mono">{radio.operator || '—'} · {(radio.frequencyHz / 1e6).toFixed(5)} MHz · {radio.running ? 'RUN' : 'S&P'}</span>}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Input size="sm" label={t('cw.contest.stationCall')} value={stationCall} onValueChange={value => { const next = value.toUpperCase(); setStationCall(next); save('tx5dr_cqww_station_call', next); }} />
        <Input size="sm" label={t('cw.contest.sentZone')} value={sentZone} onValueChange={value => { setSentZone(value); save('tx5dr_cqww_sent_zone', value); }} />
        <Input size="sm" label={t('cw.contest.hisCall')} value={hisCallsign} onValueChange={setCWQSOHisCallsign} />
        <div className="flex items-center gap-1">
          <Button size="sm" variant={run ? 'solid' : 'flat'} onPress={() => { setRun(true); save('tx5dr_cqww_run', 'true'); }}>RUN</Button>
          <Button size="sm" variant={!run ? 'solid' : 'flat'} onPress={() => { setRun(false); save('tx5dr_cqww_run', 'false'); }}>S&amp;P</Button>
        </div>
      </div>
      {fresh && snapshot?.lookup && <Button size="sm" variant="flat" onPress={() => setCWQSOHisCallsign(snapshot.lookup!.call)}>{t('cw.contest.useLookup')}: {snapshot.lookup.call}</Button>}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
        {messages.map(message => <Button key={message.key} size="sm" variant="flat" className="h-auto min-h-8 min-w-0 justify-start whitespace-normal py-1 text-left text-xs"
          isDisabled={!canSend || !message.text}
          onPress={() => sendText(message.text, operator)}>
          <span className="shrink-0 font-semibold">{message.key}</span><span className="min-w-0 break-all">{message.text || '—'}</span>
        </Button>)}
        <Button size="sm" color="danger" variant="flat" onPress={stopMessage}>STOP</Button>
      </div>
      <p className="text-xs text-default-500">{t('cw.contest.logAuthority')}</p>
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
