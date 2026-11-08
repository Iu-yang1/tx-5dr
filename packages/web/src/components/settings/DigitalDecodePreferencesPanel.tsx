import { useCallback, useEffect, useState } from 'react';
import { Q65SubmodeSchema } from '@tx5dr/contracts';
import { api } from '@tx5dr/core';
import { useCan } from '../../store/authStore';
import { useTranslation } from 'react-i18next';
import {
  loadNativeDecodePreferences, NATIVE_DIGITAL_MODES, saveNativeDecodePreferences,
  type NativeDecodePreferences, type NativeDigitalMode,
} from '../radio/digital/digitalDecodePreferences';

const inputClass = 'w-full rounded-lg border border-default-300 bg-content1 px-3 py-2 text-sm';
const labelClass = 'flex flex-col gap-1 text-xs text-default-600';

interface NativeNumberInputProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onCommit: (value: number) => void;
}

function NativeNumberInput({ label, value, min, max, onCommit }: NativeNumberInputProps) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);
  const commit = () => {
    const number = Number(draft);
    if (draft.trim() && Number.isInteger(number) && number >= min && number <= max) {
      onCommit(number);
    } else {
      setDraft(String(value));
    }
  };
  return <label className={labelClass}>{label}
    <input className={inputClass} aria-label={label} type="number" step={1}
      min={min} max={max} value={draft} onChange={event => setDraft(event.target.value)}
      onBlur={commit} onKeyDown={event => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }} />
  </label>;
}

interface DigitalDecodePreferencesPanelProps {
  fixedMode?: NativeDigitalMode;
  compact?: boolean;
}

export function DigitalDecodePreferencesPanel({ fixedMode, compact = false }: DigitalDecodePreferencesPanelProps = {}) {
  const { t } = useTranslation('common');
  const [selectedMode, setMode] = useState<NativeDigitalMode>('Q65');
  const mode = fixedMode ?? selectedMode;
  const [values, setValues] = useState<Record<NativeDigitalMode, NativeDecodePreferences>>(
    () => Object.fromEntries(
      NATIVE_DIGITAL_MODES.map(item => [item, loadNativeDecodePreferences(item)]),
    ) as Record<NativeDigitalMode, NativeDecodePreferences>,
  );
  const value = values[mode];
  const canEdit = useCan('execute', 'ModeSwitch');
  const [original, setOriginal] = useState<typeof values | null>(null);
  const [revision, setRevision] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const modified = original !== null && JSON.stringify(value) !== JSON.stringify(original[mode]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSaved(false);
    try {
      const latest = await api.getNativeDecodePreferences();
      const preferences = latest.preferences as Record<NativeDigitalMode, NativeDecodePreferences>;
      setRevision(latest.revision);
      setOriginal(preferences);
      setValues(preferences);
      // Compatibility cache for TX controls outside this panel. Reading cache
      // is allowed; only the explicit server save may apply RX configuration.
      for (const name of NATIVE_DIGITAL_MODES) {
        saveNativeDecodePreferences(name, preferences[name]);
      }
    } catch {
      setRevision(null);
      setError(t('digitalQuick.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void reload(); }, [reload]);

  const update = (partial: Partial<NativeDecodePreferences>) => {
    setSaved(false);
    setValues(current => ({ ...current, [mode]: { ...current[mode], ...partial } }));
  };

  const save = async () => {
    if (revision === null || !canEdit || !modified || busy) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await api.updateNativeDecodePreferences({
        mode, expectedRevision: revision, preferences: value,
      });
      const current = updated.preferences as Record<NativeDigitalMode, NativeDecodePreferences>;
      setRevision(updated.revision);
      setOriginal(current);
      setValues(draft => ({ ...draft, [mode]: current[mode] }));
      saveNativeDecodePreferences(mode, current[mode]);
      setSaved(true);
    } catch {
      // A concurrent writer or failed RX restart must not be shown as saved.
      // The user explicitly reloads the server version before retrying.
      setError(t('system.nativeDecode.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const numberInput = (
    label: string, field: 'frequencyHz' | 'toleranceHz' | 'txAudioHz', min: number, max: number,
  ) => <NativeNumberInput key={field} label={label} value={value[field]} min={min} max={max}
    onCommit={number => { if (number !== value[field]) update({ [field]: number }); }} />;

  return <section className="space-y-4" aria-label={t('system.nativeDecode.aria')}>
    {!compact && <div>
      <h4 className="text-sm font-semibold">{t('system.nativeDecode.title')}</h4>
      <p className="mt-1 text-xs leading-5 text-default-500">
        {t('system.nativeDecode.description')}
      </p>
    </div>}
    {!fixedMode && <div className="flex flex-wrap gap-2" role="group" aria-label={t('system.nativeDecode.mode')}>
      {NATIVE_DIGITAL_MODES.map(item =>
        <button key={item} type="button" aria-pressed={mode === item}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${mode === item
            ? 'bg-primary text-primary-foreground' : 'border border-default-300 bg-content1 text-default-600'}`}
          onClick={() => setMode(item)}>{item}</button>)}
    </div>}
    <fieldset disabled={loading || busy || !canEdit || revision === null} className="space-y-4">
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {numberInput(t('system.nativeDecode.rxCentreHz'), 'frequencyHz', 100, 5500)}
      {mode !== 'JTTY' && numberInput(t('system.nativeDecode.toleranceHz'),
        'toleranceHz', 1, mode === 'MSK144' && value.mskShorthand ? 250 : 5000)}
      {mode !== 'JTTY' && <label className={labelClass}>{t('system.nativeDecode.depth')}
        <select className={inputClass} aria-label={t('system.nativeDecode.depth')}
          value={value.depth} onChange={e => update({depth:Number(e.target.value) as 1|2|3})}>
          <option value={1}>{t('system.nativeDecode.fast')}</option>
          <option value={2}>{t('system.nativeDecode.normal')}</option>
          <option value={3}>{t('system.nativeDecode.deep')}</option>
        </select>
      </label>}
      {mode !== 'MSK144' && numberInput(t('system.nativeDecode.txAudioHz'), 'txAudioHz', 100, 5500)}
      {mode === 'Q65' && <label className={labelClass}>{t('system.nativeDecode.submode')}
        <select className={inputClass} aria-label={t('system.nativeDecode.submode')}
          value={value.q65Submode} onChange={e => update({q65Submode:e.target.value as NativeDecodePreferences['q65Submode']})}>
          {Q65SubmodeSchema.options.map(sub=><option key={sub} value={sub}>{sub}</option>)}
        </select>
      </label>}
    </div>
    {mode === 'Q65' && <section className="space-y-2 rounded-lg border border-default-200 p-2">
      <h5 className="text-xs font-semibold">{t('system.nativeDecode.q65SyncTitle')}</h5>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className={labelClass}>{t('system.nativeDecode.q65TimeSearch')}
          <select className={inputClass} value={value.q65TimeToleranceSec ?? 'native'}
            onChange={e => update({
              q65TimeToleranceSec: e.target.value === 'native' ? null : Number(e.target.value),
            })}>
            <option value="native">{t('system.nativeDecode.nativeDefault')}</option>
            {[5,15,30,60,120,150].map(seconds =>
              <option key={seconds} value={seconds}>{seconds} s</option>)}
          </select>
        </label>
        <label className={labelClass}>{t('system.nativeDecode.q65SyncScore')}
          <select className={inputClass} value={value.q65SyncScore ?? 'native'}
            onChange={e => update({
              q65SyncScore: e.target.value === 'native' ? null : Number(e.target.value),
            })}>
            <option value="native">{t('system.nativeDecode.nativeDefault')}</option>
            {[0.02,0.05,0.1,0.2,0.4].map(score =>
              <option key={score} value={score}>{score}</option>)}
          </select>
        </label>
        <label className={labelClass}>{t('system.nativeDecode.q65Candidates')}
          <select className={inputClass} value={value.q65MaxCandidates ?? 'native'}
            onChange={e => update({
              q65MaxCandidates: e.target.value === 'native' ? null : Number(e.target.value),
            })}>
            <option value="native">{t('system.nativeDecode.nativeDefault')}</option>
            {[8,16,32,64].map(count =>
              <option key={count} value={count}>{count}</option>)}
          </select>
        </label>
      </div>
      <p className="text-xs text-default-500">{t('system.nativeDecode.q65SyncHint')}</p>
    </section>}
    {mode === 'Q65' && <div className="flex flex-wrap gap-5">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={value.averaging}
          onChange={e=>update({averaging:e.target.checked})}/>
        {t('system.nativeDecode.averaging')}
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={value.emeDelay}
          onChange={e=>update({emeDelay:e.target.checked})}/>
        {t('system.nativeDecode.emeDelay')}
      </label>
    </div>}
    {mode === 'Q65' && <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={value.q65TxFirst}
        onChange={e => update({ q65TxFirst: e.target.checked })} />
      {t('system.nativeDecode.q65TxFirst')}
    </label>}
    {mode === 'MSK144' && <section className="space-y-3 rounded-lg border border-default-200 p-3">
      <h5 className="text-sm font-medium">{t('system.nativeDecode.meteor')}</h5>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className={labelClass}>{t('system.nativeDecode.mskPeriod')}
          <select className={inputClass} value={value.mskPeriodSeconds}
            onChange={e => update({ mskPeriodSeconds: Number(e.target.value) as 5 | 10 | 15 | 30 })}>
            {[5, 10, 15, 30].map(seconds => <option key={seconds} value={seconds}>{seconds} s</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={value.mskTxFirst}
            onChange={e => update({ mskTxFirst: e.target.checked })} />
          {t('system.nativeDecode.mskTxFirst')}
        </label>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {([['mskMyCall',t('system.nativeDecode.myCall')],['mskDxCall',t('system.nativeDecode.dxCall')]] as const)
          .map(([key,label])=><label key={key} className={labelClass}>{label}
            <input className={inputClass} aria-label={label} value={value[key]}
              onChange={e=>update({[key]:e.target.value})}/>
          </label>)}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={value.mskAdaptiveEqualizer}
          onChange={e=>update({mskAdaptiveEqualizer:e.target.checked})}/>
        {t('system.nativeDecode.equalizer')}
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={value.mskShorthand}
          onChange={e=>update({mskShorthand:e.target.checked,
            toleranceHz:e.target.checked ? Math.min(value.toleranceHz,250) : value.toleranceHz})}/>
        {t('system.nativeDecode.shorthand')}
      </label>
    </section>}
    {mode === 'MSK144' && (value.mskShorthand || value.mskAdaptiveEqualizer)
      && (!value.mskMyCall || !value.mskDxCall) && <p className="text-xs text-warning" role="status">
      {t('system.nativeDecode.mskRequiresCalls')}
    </p>}
    {mode === 'MSK144' && <p className="text-xs text-default-500">{t('system.nativeDecode.mskTxFixed')}</p>}
    {mode === 'WSPR' && <p className="text-xs text-default-500">{t('system.nativeDecode.wsprFixed')}</p>}
    {mode === 'JTTY' && <p className="text-xs text-default-500">
      {t('system.nativeDecode.jttyStream')}
    </p>}
    </fieldset>
    <div className="flex items-center justify-end gap-2">
      <button type="button" className="rounded-lg border border-default-300 px-3 py-1.5 text-xs"
        disabled={busy || loading} onClick={() => void reload()}>
        {t('action.refresh')}
      </button>
      <button type="button" className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
        disabled={!canEdit || busy || loading || revision === null || !modified}
        onClick={() => void save()}>{t('button.save')}</button>
    </div>
    {loading && <p className="text-xs text-default-500" role="status">{t('status.loading')}</p>}
    {!canEdit && <p className="text-xs text-warning" role="status">{t('digitalQuick.readOnly')}</p>}
    {saved && <p className="text-xs text-success" role="status">{t('system.nativeDecode.saved')}</p>}
    {error && <p className="text-xs text-danger" role="alert">{error}</p>}
    <p className="text-xs text-default-500">
      {t('system.nativeDecode.saveNotice')}
    </p>
  </section>;
}
