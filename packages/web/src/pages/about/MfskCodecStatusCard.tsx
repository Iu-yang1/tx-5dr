import { useEffect, useState } from 'react';
import { Button, Card, CardBody, Input } from '@heroui/react';
import { useTranslation } from 'react-i18next';
import { api } from '@tx5dr/core';
import type { DigitalCodecMode, MfskCodecProbeResponse, MfskCodecSimulationResponse, Q65Submode } from '@tx5dr/contracts';
import { Q65SubmodeSchema } from '@tx5dr/contracts';

/** Read-only diagnostic for a development build, not a six-mode mode switch. */
export function MfskCodecStatusCard() {
  const { t } = useTranslation('about');

  const [status, setStatus] = useState<MfskCodecProbeResponse | null>(null);
  const [mode, setMode] = useState<DigitalCodecMode>('FT8');
  const [q65, setQ65] = useState<Q65Submode>('Q65-60B');
  const [message, setMessage] = useState('CQ K1ABC FN42');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MfskCodecSimulationResponse | null>(null);
  const [error, setError] = useState(false);

  const chooseMode = (selected:DigitalCodecMode) => {
    setMode(selected);
    setMessage(selected==='WSPR' ? 'K1ABC FN42 37' :
      selected==='MSK144' ? 'K1ABC K2ABC -10' :
      selected==='JTTY' ? 'CQ K1ABC' : 'CQ K1ABC FN42');
    setResult(null);
    setError(false);
  };
  const simulate = () => {
    setBusy(true);
    setResult(null);
    setError(false);
    void api.simulateMfskCodec({
      mode,
      ...(mode==='Q65' ? {q65Submode:q65}:{}),
      text:message,audioFrequencyHz:1500,noiseAmplitude:0.002,
    }).then(setResult).catch(()=>setError(true)).finally(()=>setBusy(false));
  };


  useEffect(() => {
    let active = true;
    void api.getMfskCodecProbe().then(result => {
      if (active) setStatus(result);
    }).catch(() => {
      // Not all servers ship the experimental endpoint; do not suggest
      // availability or display an unauthenticated diagnostics surface.
    });
    return () => { active = false; };
  }, []);

  if (!status) return null;
  return <Card shadow="none">
    <CardBody className="gap-3 px-6 py-5">
      <h2 className="text-base font-semibold">{t('codec.title')}</h2>
      <p className="text-xs text-default-500">{t('codec.virtualOnly')}</p>
      {status.version && <p className="text-xs text-default-400">{status.version}</p>}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {status.capabilities.map(item => <div key={item.mode} className="rounded-md bg-default-100 p-2">
          <p className="font-medium text-sm">{item.mode}</p>
          <p className="text-xs text-default-500">{item.receiverReady ?
            t('codec.offlineReady') : t('codec.unavailable')}</p>
        </div>)}
      </div>
      <p className="text-xs text-default-500">{t('codec.noRf')}</p>
      <div className="border-t border-default-200 pt-3 space-y-3">
        <p className="font-medium text-sm">{t('codec.simTitle')}</p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-default-500" htmlFor="mfsk-mode">{t('codec.mode')}</label>
          <select id="mfsk-mode" value={mode}
            onChange={e=>chooseMode(e.target.value as DigitalCodecMode)}
            className="rounded-md border border-default-300 bg-content1 px-3 py-2 text-sm"
            disabled={busy}>
            {(['FT8','FT4','Q65','WSPR','MSK144','JTTY'] as const).map(m=>
              <option value={m} key={m}>{m}</option>)}
          </select>
          {mode==='Q65'&&<>
            <label className="text-xs text-default-500" htmlFor="mfsk-q65">{t('codec.submode')}</label>
            <select id="mfsk-q65" value={q65}
              onChange={e=>setQ65(e.target.value as Q65Submode)}
              className="rounded-md border border-default-300 bg-content1 px-3 py-2 text-sm"
              disabled={busy}>
              {Q65SubmodeSchema.options.map(m=><option value={m} key={m}>{m}</option>)}
            </select>
          </>}
        </div>
        <Input label={t('codec.message')} value={message} onValueChange={setMessage}
          maxLength={64} isDisabled={busy} size="sm" />
        <Button color="primary" size="sm" isLoading={busy}
          isDisabled={!message.trim() || busy || !status.capabilities.some(c=>c.mode===mode && c.encoderReady)}
          onPress={simulate}>
          {t('codec.run')}
        </Button>
        {result && <section className="rounded-md bg-default-100 p-3 text-sm space-y-1" aria-live="polite">
          <p className="font-medium">{result.messageRecovered?t('codec.passed'):t('codec.notRecovered')}</p>
          <p>{t('codec.transmitted')}: {result.canonicalText}</p>
          <p>{t('codec.decoded')}: {result.receivedTexts.join(' | ') || '—'}</p>
          <p className="text-xs text-default-500">
            {t('codec.samples')}: {result.samples.toLocaleString()} ·
            TX {result.encodeMs.toFixed(1)} ms / RX {result.decodeMs.toFixed(1)} ms
          </p>
        </section>}
        {error && <p role="alert" className="text-sm text-danger">{t('codec.failed')}</p>}
        <p className="text-xs text-default-500">{t('codec.simNote')}</p>
      </div>

    </CardBody>
  </Card>;
}
