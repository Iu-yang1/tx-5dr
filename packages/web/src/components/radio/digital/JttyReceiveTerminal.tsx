import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { DigitalRxEvent } from '@tx5dr/contracts';
import { useTranslation } from 'react-i18next';
import { useJtty } from '../../../hooks/useJtty';
import { jttyQsoDraftStore } from '../../../store/jttyQsoDraftStore';
import { formatDecodedAfHz } from './decodeValueFormat';
import { NATIVE_DIGITAL_SELECTION_EVENT, type NativeDigitalSelection } from './nativeDigitalSelection';

/** The JTTY decoder emits revisions of a continuous text stream, not UTC slots. */
export function projectJttyTranscript(events: readonly DigitalRxEvent[]) {
  const messages = new Map<string, Extract<DigitalRxEvent, {kind:'message-update'}>>();
  for (const event of events) {
    if (event.mode !== 'JTTY' || event.kind !== 'message-update') continue;
    const key = event.sessionId + ':' + event.messageId;
    const previous = messages.get(key);
    if (!previous || event.revision >= previous.revision) messages.set(key, event);
  }
  return [...messages.values()].sort((a, b) => a.timestampMs - b.timestampMs).slice(-120);
}

/** Recognise callsigns in arbitrary (not just CQ) text without confusing grids or RST. */
export function jttyCallsignToken(token: string): string | null {
  const value = token.toUpperCase().replace(/^[^A-Z0-9/]+|[^A-Z0-9/]+$/g, '');
  if (!/^[A-Z0-9/]{3,24}$/.test(value) || !/[A-Z]/.test(value) || !/[0-9]/.test(value)) return null;
  if (/^[A-R]{2}[0-9]{2}(?:[A-X]{2})?$/.test(value)) return null;
  return value;
}

export function JttyReceiveTerminal({ className = '' }: { className?: string }) {
  const { t } = useTranslation('radio');
  const { events, rxStatus } = useJtty();
  const transcript = useMemo(() => projectJttyTranscript(events), [events]);
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const [follow, setFollow] = useState(true);
  useEffect(() => {
    if (follow && terminalRef.current) terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
  }, [follow, transcript]);

  const onTune = (audioHz: number, text: string) => {
    window.dispatchEvent(new CustomEvent<NativeDigitalSelection>(NATIVE_DIGITAL_SELECTION_EVENT, {
      detail: { mode: 'JTTY', text, audioHz },
    }));
  };
  const copy = () => {
    void navigator.clipboard.writeText(transcript.map(entry => entry.text).join('\n'));
  };
  return <section className={'flex min-h-0 flex-col overflow-hidden rounded-xl border border-default-200 bg-content1 ' + className}
    aria-label={t('jtty.workbench.rxTerminal')}>
    <header className="flex shrink-0 items-center justify-between gap-2 border-b border-default-200 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold">{t('jtty.workbench.rxTerminal')}</span>
        <span role="status" className="text-xs text-default-500">
          {rxStatus?.ready ? t('jtty.workbench.listening') : t('jtty.workbench.notReady')}
        </span>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={copy} className="text-xs text-primary hover:underline">
          {t('jtty.workbench.copy')}
        </button>
        <button type="button" onClick={() => setFollow(true)} className="text-xs text-primary hover:underline">
          {follow ? t('jtty.workbench.following') : t('jtty.workbench.latest')}
        </button>
      </div>
    </header>
    <div ref={terminalRef} role="log" aria-live="off"
      onScroll={event => {
        const node = event.currentTarget;
        setFollow(node.scrollHeight - node.scrollTop - node.clientHeight < 48);
      }}
      className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 py-2 font-mono text-xs">
      {transcript.length === 0 && <p className="py-6 text-center text-default-400">{t('jtty.workbench.empty')}</p>}
      {transcript.map(item => <div key={item.sessionId + ':' + item.messageId}
        onDoubleClick={() => onTune(item.frequencyHz, item.text)}
        className="group flex gap-3 rounded px-1 py-1 hover:bg-default-100">
        <time className="shrink-0 text-default-500 tabular-nums" dateTime={new Date(item.timestampMs).toISOString()}>
          {new Date(item.timestampMs).toISOString().slice(11, 19)}
        </time>
        <span className="w-12 shrink-0 text-right text-default-500 tabular-nums">{formatDecodedAfHz(item.frequencyHz)}</span>
        <span className={'min-w-0 flex-1 whitespace-pre-wrap break-words ' + (item.state === 'growing' ? 'text-primary' : 'text-foreground')}>
          {item.text.split(/(\s+)/).map((part, index) => {
            const callsign = jttyCallsignToken(part);
            return callsign
              ? <button key={index} type="button" title={t('jtty.workbench.useCallsign')}
                  onDoubleClick={event => event.stopPropagation()}
                  onClick={() => jttyQsoDraftStore.setHisCallsign(callsign)}
                  className="font-semibold text-primary hover:underline">{part}</button>
              : <React.Fragment key={index}>{part}</React.Fragment>;
          })}
        </span>
        <span className="shrink-0 text-[10px] text-default-400">{item.state === 'growing' ? '…' : ''}</span>
      </div>)}
    </div>
  </section>;
}
