import { useState } from 'react';
import { Q65SubmodeSchema } from '@tx5dr/contracts';
import { useTranslation } from 'react-i18next';
import {
  loadNativeDecodePreferences, NATIVE_DIGITAL_MODES, saveNativeDecodePreferences,
  type NativeDecodePreferences, type NativeDigitalMode,
} from '../radio/digital/digitalDecodePreferences';

const inputClass = 'w-full rounded-lg border border-default-300 bg-content1 px-3 py-2 text-sm';
const labelClass = 'flex flex-col gap-1 text-xs text-default-600';

export function DigitalDecodePreferencesPanel() {
  const { t } = useTranslation('common');
  const [mode, setMode] = useState<NativeDigitalMode>('Q65');
  const [values, setValues] = useState<Record<NativeDigitalMode, NativeDecodePreferences>>(
    () => Object.fromEntries(
      NATIVE_DIGITAL_MODES.map(item => [item, loadNativeDecodePreferences(item)]),
    ) as Record<NativeDigitalMode, NativeDecodePreferences>,
  );
  const value = values[mode];

  const update = (partial: Partial<NativeDecodePreferences>) => {
    const next = { ...value, ...partial };
    saveNativeDecodePreferences(mode, next);
    setValues(current => ({ ...current, [mode]: loadNativeDecodePreferences(mode) }));
  };

  const numberInput = (
    label: string, field: 'frequencyHz' | 'toleranceHz', min: number, max: number,
  ) => <label className={labelClass} key={field}>{label}
    <input className={inputClass} aria-label={label} type="number" min={min} max={max}
      value={value[field]} onChange={event => {
        const v = Number(event.target.value);
        if (Number.isFinite(v) && v >= min && v <= max) update({ [field]: v });
      }} />
  </label>;

  return <section className="space-y-4" aria-label={t('system.nativeDecode.aria')}>
    <div>
      <h4 className="text-sm font-semibold">{t('system.nativeDecode.title')}</h4>
      <p className="mt-1 text-xs leading-5 text-default-500">
        {t('system.nativeDecode.description')}
      </p>
    </div>
    <div className="flex flex-wrap gap-2" role="group" aria-label={t('system.nativeDecode.mode')}>
      {NATIVE_DIGITAL_MODES.map(item =>
        <button key={item} type="button" aria-pressed={mode === item}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${mode === item
            ? 'bg-primary text-primary-foreground' : 'border border-default-300 bg-content1 text-default-600'}`}
          onClick={() => setMode(item)}>{item}</button>)}
    </div>
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
      {mode === 'Q65' && <label className={labelClass}>{t('system.nativeDecode.submode')}
        <select className={inputClass} aria-label={t('system.nativeDecode.submode')}
          value={value.q65Submode} onChange={e => update({q65Submode:e.target.value as NativeDecodePreferences['q65Submode']})}>
          {Q65SubmodeSchema.options.map(sub=><option key={sub} value={sub}>{sub}</option>)}
        </select>
      </label>}
    </div>
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
    {mode === 'MSK144' && <section className="space-y-3 rounded-lg border border-default-200 p-3">
      <h5 className="text-sm font-medium">{t('system.nativeDecode.meteor')}</h5>
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
    {mode === 'JTTY' && <p className="text-xs text-default-500">
      {t('system.nativeDecode.jttyStream')}
    </p>}
    <p className="text-xs text-default-500">
      {t('system.nativeDecode.saveNotice')}
    </p>
  </section>;
}
