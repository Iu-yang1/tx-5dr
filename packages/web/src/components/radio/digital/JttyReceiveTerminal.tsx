import { useEffect, useMemo, useState } from 'react';
import { api } from '@tx5dr/core';
import type { DigitalRxEvent, MfskLiveRxStatus } from '@tx5dr/contracts';
import { useTranslation } from 'react-i18next';
import { formatDecodedAfHz } from './decodeValueFormat';
import { NATIVE_DIGITAL_SELECTION_EVENT, type NativeDigitalSelection } from './nativeDigitalSelection';

/** The JTTY decoder emits revisions of a continuous text stream, not UTC slots. */
export function projectJttyTranscript(events: readonly DigitalRxEvent[]) {
  const messages = new Map<string, Extract<DigitalRxEvent, {kind:'message-update'}>>();
  for (const event of events) {
    if (event.mode !== 'JTTY' || event.kind !== 'message-update') continue;
    const key = `${event.sessionId}:${event.messageId}`;
    const previous = messages.get(key);
    if (!previous || event.revision >= previous.revision) messages.set(key, event);
  }
  return [...messages.values()].sort((a, b) =>
    a.timestampMs - b.timestampMs).slice(-120);
}

export function JttyReceiveTerminal() {
  const { t } = useTranslation('common');
  const [events, setEvents] = useState<DigitalRxEvent[]>([]);
  const [status, setStatus] = useState<MfskLiveRxStatus | null>(null);
  useEffect(() => {
    let active = true;
    const poll = () => {
      void api.getMfskLiveRxEvents(0).then(result => {
        if (!active) return;
        setStatus(result.status);
        setEvents(result.status.mode === 'JTTY' ? result.events : []);
      }).catch(() => {
        if (active) setStatus(null);
      });
    };
    poll();
    const timer = setInterval(poll, 1200);
    return () => { active = false; clearInterval(timer); };
  }, []);
  const transcript = useMemo(() => projectJttyTranscript(events), [events]);
  return <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-default-200 bg-content1"
    aria-label={t('system.jttyTerminal.receiver')}>
    <header className="flex shrink-0 items-center justify-between border-b border-default-200 px-3 py-2">
      <span className="text-xs font-semibold tracking-wide">{t('system.jttyTerminal.receiver')}</span>
      <span role="status" className="text-xs text-default-500">
        {status?.ready ? t('system.jttyTerminal.listening') : t('system.jttyTerminal.notReady')}
      </span>
    </header>
    <div role="log" aria-live="off" className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 py-2 font-mono text-xs">
      {transcript.length === 0 &&
        <p className="py-6 text-center text-default-400">{t('system.jttyTerminal.noText')}</p>}
      {transcript.map(item =>
        <div key={`${item.sessionId}:${item.messageId}`}
          className="group flex gap-3 rounded px-1 py-1 hover:bg-default-100"
          onDoubleClick={() => window.dispatchEvent(new CustomEvent<NativeDigitalSelection>(
            NATIVE_DIGITAL_SELECTION_EVENT, {detail: {
              mode:'JTTY', text:item.text, audioHz:item.frequencyHz,
            }}))}>
          <time className="shrink-0 text-default-500 tabular-nums" dateTime={new Date(item.timestampMs).toISOString()}>
            {new Date(item.timestampMs).toISOString().slice(11, 19)}
          </time>
          <span className="w-12 shrink-0 text-right text-default-500 tabular-nums">
            {formatDecodedAfHz(item.frequencyHz)}
          </span>
          <span className={`min-w-0 flex-1 whitespace-pre-wrap break-words ${
            item.state === 'growing' ? 'text-primary' : 'text-foreground'
          }`}>{item.text}</span>
          <span className="shrink-0 text-[10px] text-default-400">
            {item.state === 'growing' ? '…' : ''}
          </span>
        </div>)}
    </div>
  </div>;
}
