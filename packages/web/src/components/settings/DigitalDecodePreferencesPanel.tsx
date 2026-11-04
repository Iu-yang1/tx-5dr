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
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith('zh');
  const [mode, setMode] = useState<NativeDigitalMode>('Q65');
  const [values, setValues] = useState<Record<NativeDigitalMode, NativeDecodePreferences>>(() =>
    Object.fromEntries(NATIVE_DIGITAL_MODES.map(item => [item, loadNativeDecodePreferences(item)]))
      as Record<NativeDigitalMode, NativeDecodePreferences>);
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

  return <section className="space-y-4" aria-label={zh ? '其他数字模式接收参数' : 'Other digital decode parameters'}>
    <div>
      <h4 className="text-sm font-semibold">{zh ? 'Q65 / WSPR / MSK144 / JTTY 接收参数' : 'Q65 / WSPR / MSK144 / JTTY receive parameters'}</h4>
      <p className="mt-1 text-xs leading-5 text-default-500">
        {zh
          ? '每个模式独立保存；下次点击对应模式的“应用接收设置”时生效。FT8 / FT4 使用上方的解码深度和解码窗口设置。'
          : 'Saved independently per mode. Apply the selected parameters with Apply RX in that mode. FT8/FT4 use the depth and decoding windows above.'}
      </p>
    </div>
    <div className="flex flex-wrap gap-2" role="group" aria-label="Digital mode">
      {NATIVE_DIGITAL_MODES.map(item =>
        <button key={item} type="button" aria-pressed={mode === item}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${mode === item
            ? 'bg-primary text-primary-foreground' : 'border border-default-300 bg-content1 text-default-600'}`}
          onClick={() => setMode(item)}>{item}</button>)}
    </div>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {numberInput(zh ? '接收中心频率 (Hz)' : 'RX centre (Hz)', 'frequencyHz', 100, 5500)}
      {mode !== 'JTTY' && numberInput(zh ? '搜索容差 (Hz)' : 'Frequency tolerance (Hz)',
        'toleranceHz', 1, mode === 'MSK144' && value.mskShorthand ? 250 : 5000)}
      {mode !== 'JTTY' && <label className={labelClass}>{zh ? '解码深度' : 'Decode depth'}
        <select className={inputClass} aria-label={zh ? '解码深度' : 'Decode depth'}
          value={value.depth} onChange={e => update({depth:Number(e.target.value) as 1|2|3})}>
          <option value={1}>{zh ? '快速 (1)' : 'Fast (1)'}</option>
          <option value={2}>{zh ? '正常 (2)' : 'Normal (2)'}</option>
          <option value={3}>{zh ? '深度 (3)' : 'Deep (3)'}</option>
        </select>
      </label>}
      {mode === 'Q65' && <label className={labelClass}>{zh ? 'Q65 子模式' : 'Q65 submode'}
        <select className={inputClass} aria-label={zh ? 'Q65 子模式' : 'Q65 submode'}
          value={value.q65Submode} onChange={e => update({q65Submode:e.target.value as NativeDecodePreferences['q65Submode']})}>
          {Q65SubmodeSchema.options.map(sub=><option key={sub} value={sub}>{sub}</option>)}
        </select>
      </label>}
    </div>
    {mode === 'Q65' && <div className="flex flex-wrap gap-5">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={value.averaging}
          onChange={e=>update({averaging:e.target.checked})}/>
        {zh ? '多周期平均 (Average)' : 'Multi-period averaging'}
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={value.emeDelay}
          onChange={e=>update({emeDelay:e.target.checked})}/>
        {zh ? 'EME 传播延迟补偿' : 'EME delay compensation'}
      </label>
    </div>}
    {mode === 'MSK144' && <section className="space-y-3 rounded-lg border border-default-200 p-3">
      <h5 className="text-sm font-medium">{zh ? '流星散射接收' : 'Meteor scatter receive'}</h5>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {([['mskMyCall',zh ? '本台呼号':'My callsign'],['mskDxCall',zh ? '对方呼号':'DX callsign']] as const)
          .map(([key,label])=><label key={key} className={labelClass}>{label}
            <input className={inputClass} aria-label={label} value={value[key]}
              onChange={e=>update({[key]:e.target.value})}/>
          </label>)}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={value.mskAdaptiveEqualizer}
          onChange={e=>update({mskAdaptiveEqualizer:e.target.checked})}/>
        {zh ? '自适应均衡' : 'Adaptive equalizer'}
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={value.mskShorthand}
          onChange={e=>update({mskShorthand:e.target.checked,
            toleranceHz:e.target.checked ? Math.min(value.toleranceHz,250) : value.toleranceHz})}/>
        {zh ? 'MSK40 Shorthand 搜索（需要双方呼号，容差 ≤250 Hz）'
          : 'MSK40 shorthand search (both calls required, tolerance ≤250 Hz)'}
      </label>
    </section>}
    {mode === 'JTTY' && <p className="text-xs text-default-500">
      {zh ? 'JTTY 采用连续流解码，解码深度与周期搜索窗口不适用。'
        : 'JTTY uses continuous streaming; slotted decode depth and search windows do not apply.'}
    </p>}
    <p className="text-xs text-default-500">
      {zh ? '配置会即时保存；不会在修改设置时自动发送射频，也不会修改当前接收任务。'
        : 'Changes are saved immediately. Editing preferences never starts RF or restarts a receiver.'}
    </p>
  </section>;
}
