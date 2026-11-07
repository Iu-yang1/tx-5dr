import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@heroui/react';
import { useTranslation } from 'react-i18next';
import { api } from '@tx5dr/core';
import {
  DEFAULT_DECODE_WINDOW_SETTINGS,
  FT4_WINDOW_PRESETS,
  FT8_WINDOW_PRESETS,
  type DecodeWindowSettings,
} from '@tx5dr/contracts';
import { useCan } from '../../../store/authStore';
import {
  NATIVE_DIGITAL_MODES,
  type NativeDigitalMode,
} from '../digital/digitalDecodePreferences';
import { DigitalDecodePreferencesPanel } from '../../settings/DigitalDecodePreferencesPanel';
import { createLogger } from '../../../utils/logger';

const logger = createLogger('DigitalModeQuickSettings');
export const DIGITAL_QUICK_MODES = ['FT8', 'FT4', 'Q65', 'WSPR', 'MSK144', 'JTTY'] as const;
export type DigitalQuickMode = typeof DIGITAL_QUICK_MODES[number];
type ClassicMode = 'FT8' | 'FT4';
type ClassicPreset = 'maximum' | 'balanced' | 'lightweight' | 'minimum' | 'custom';
type ClassicDraft = { depth: 1 | 2 | 3; preset: ClassicPreset; windows: number[] };

const inputClass = 'w-full rounded-md border border-default-300 bg-content1 px-2 py-1.5 text-xs';
const presetOptions: Record<ClassicMode, ReadonlyArray<ClassicPreset>> = {
  FT8: ['maximum', 'balanced', 'lightweight', 'minimum', 'custom'],
  FT4: ['maximum', 'balanced', 'lightweight', 'custom'],
};

export function decodeQuickDraft(mode: ClassicMode, settings: DecodeWindowSettings): ClassicDraft {
  const family = mode === 'FT8' ? settings.ft8 : settings.ft4;
  const tables = mode === 'FT8' ? FT8_WINDOW_PRESETS : FT4_WINDOW_PRESETS;
  const preset = family?.preset ?? 'balanced';
  const windows = preset === 'custom' && family?.customWindowTiming?.length
    ? family.customWindowTiming : tables[preset] ?? tables.balanced;
  return {
    depth: settings.decodeDepth ?? DEFAULT_DECODE_WINDOW_SETTINGS.decodeDepth ?? 3,
    preset,
    windows: [...windows],
  };
}

export function buildQuickDecodeSettings(
  mode: ClassicMode, latest: DecodeWindowSettings, draft: ClassicDraft,
): DecodeWindowSettings {
  const customWindowTiming = draft.preset === 'custom'
    ? [...draft.windows].sort((a, b) => a - b) : undefined;
  if (mode === 'FT8') {
    return {
      ...latest, decodeDepth: draft.depth,
      ft8: { preset: draft.preset, ...(customWindowTiming ? { customWindowTiming } : {}) },
    };
  }
  if (draft.preset === 'minimum') throw new Error('FT4 does not support the minimum window preset');
  return {
    ...latest, decodeDepth: draft.depth,
    ft4: { preset: draft.preset, ...(customWindowTiming ? { customWindowTiming } : {}) },
  };
}

function ClassicDecodeQuickEditor({ mode }: { mode: ClassicMode }) {
  const { t } = useTranslation('common');
  const canEdit = useCan('update', 'SettingsDecodeWindows');
  const [draft, setDraft] = useState<ClassicDraft | null>(null);
  const [original, setOriginal] = useState<ClassicDraft | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const reply = await api.getDecodeWindowSettings();
      if (!reply.success) throw new Error('Decode window settings request failed');
      const next = decodeQuickDraft(
        mode, (reply.data.settings ?? DEFAULT_DECODE_WINDOW_SETTINGS) as DecodeWindowSettings,
      );
      setDraft(next);
      setOriginal(next);
    } catch (err) {
      logger.error('Failed to load decode windows', err);
      setError(t('digitalQuick.loadFailed'));
    }
  }, [mode, t]);

  useEffect(() => { void reload(); }, [reload]);
  const modified = draft && original && JSON.stringify(draft) !== JSON.stringify(original);
  const presets = mode === 'FT8' ? FT8_WINDOW_PRESETS : FT4_WINDOW_PRESETS;
  const effectiveWindows = draft?.preset === 'custom'
    ? draft.windows : presets[draft?.preset ?? 'balanced'] ?? presets.balanced;

  const apply = async () => {
    if (!draft || !canEdit || pending) return;
    if (draft.preset === 'custom' &&
      (!draft.windows.length || draft.windows.some(v => !Number.isInteger(v) || v < -5000 || v > 1000))) {
      setError(t('digitalQuick.invalidWindows'));
      return;
    }
    setPending(true);
    setSaved(false);
    setError(null);
    try {
      // Read the latest settings before writing. This prevents an edit to FT8
      // from clobbering FT4 (or vice versa) on another connected operator.
      const response = await api.getDecodeWindowSettings();
      if (!response.success) throw new Error('Cannot read latest decode window settings');
      const current = (response.data.settings ?? DEFAULT_DECODE_WINDOW_SETTINGS) as DecodeWindowSettings;
      const next = buildQuickDecodeSettings(mode, current, draft);
      const result = await api.updateDecodeWindowSettings(next);
      if (!result.success) throw new Error('Decode window settings update failed');
      const committed = decodeQuickDraft(mode, next);
      setDraft(committed);
      setOriginal(committed);
      setSaved(true);
      window.dispatchEvent(new CustomEvent('tx5dr:decode-windows-updated'));
    } catch (err) {
      logger.error('Failed to save decode windows', err);
      setError(t('digitalQuick.saveFailed'));
    } finally {
      setPending(false);
    }
  };

  if (!draft) return <p className="text-xs text-default-500" role="status">
    {error ?? t('status.loading')}
  </p>;

  return <div className="space-y-3">
    <label className="flex flex-col gap-1 text-xs text-default-600">
      {t('digitalQuick.sharedDepth')}
      <select className={inputClass} aria-label={t('digitalQuick.sharedDepth')}
        disabled={!canEdit || pending} value={draft.depth}
        onChange={event => { setSaved(false); setDraft(v => v && ({
          ...v, depth: Number(event.target.value) as 1 | 2 | 3,
        })); }}>
        {[1, 2, 3].map(depth => <option key={depth} value={depth}>
          {t(depth === 1 ? 'system.decodeDepthFast' : depth === 2
            ? 'system.decodeDepthNormal' : 'system.decodeDepthDeep')}
        </option>)}
      </select>
    </label>
    <label className="flex flex-col gap-1 text-xs text-default-600">
      {t('digitalQuick.decodeWindows')}
      <select className={inputClass} aria-label={t('digitalQuick.decodeWindows')}
        disabled={!canEdit || pending} value={draft.preset}
        onChange={event => {
          const preset = event.target.value as ClassicPreset;
          setSaved(false);
          setDraft(v => v && ({ ...v, preset, windows: preset === 'custom'
            ? v.windows : [...(presets[preset] ?? presets.balanced)] }));
        }}>
        {presetOptions[mode].map(name => <option key={name} value={name}>
          {t('system.preset' + name.charAt(0).toUpperCase() + name.slice(1))}
        </option>)}
      </select>
    </label>
    {draft.preset === 'custom' && <div className="space-y-1">
      <p className="text-xs text-default-500">{t('digitalQuick.windowOffsets')}</p>
      {draft.windows.map((offset, i) => <div key={i} className="flex gap-2">
        <input className={inputClass} type="number" step={1} min={-5000} max={1000}
          aria-label={t('system.windowOffset', { idx: i + 1 })}
          disabled={!canEdit || pending}
          value={offset} onChange={event => {
            const number = Number(event.target.value);
            if (!Number.isInteger(number) || number < -5000 || number > 1000) return;
            setSaved(false);
            setDraft(v => v && ({ ...v,
              windows: v.windows.map((item, index) => index === i ? number : item) }));
          }} />
        <Button size="sm" variant="flat" color="danger" isIconOnly
          aria-label={t('system.removeWindow')}
          isDisabled={!canEdit || pending || draft.windows.length <= 1}
          onPress={() => { setSaved(false); setDraft(v => v && ({
            ...v, windows: v.windows.filter((_, index) => index !== i),
          })); }}>−</Button>
      </div>)}
      <Button size="sm" variant="flat" isDisabled={!canEdit || pending || draft.windows.length >= 5}
        onPress={() => { setSaved(false); setDraft(v => v && ({
          ...v, windows: [...v.windows, 0],
        })); }}>{t('system.addWindow')}</Button>
    </div>}
    <div className="flex justify-between items-center gap-2">
      <span className="text-xs text-default-500">
        {t('system.decodesPerSlot', { count: effectiveWindows.length })}
      </span>
      <Button size="sm" color="primary" isLoading={pending}
        isDisabled={!canEdit || !modified || pending} onPress={() => void apply()}>
        {t('button.save')}
      </Button>
    </div>
    {!canEdit && <p className="text-xs text-warning">{t('digitalQuick.readOnly')}</p>}
    {error && <p className="text-xs text-danger" role="alert">{error}</p>}
    {saved && <p className="text-xs text-success" role="status">{t('digitalQuick.saved')}</p>}
    <p className="text-xs text-default-500">{t('digitalQuick.classicLimits')}</p>
  </div>;
}

export interface DigitalModeQuickSettingsProps {
  activeMode: string | null | undefined;
  availableModes: ReadonlyArray<string>;
  onSelectMode: (mode: DigitalQuickMode) => void | Promise<void>;
  disabled?: boolean;
}

export function DigitalModeQuickSettings({
  activeMode, availableModes, onSelectMode, disabled = false,
}: DigitalModeQuickSettingsProps) {
  const { t } = useTranslation('common');
  const initial = DIGITAL_QUICK_MODES.includes(activeMode as DigitalQuickMode)
    ? activeMode as DigitalQuickMode : 'FT8';
  const [editingMode, setEditingMode] = useState<DigitalQuickMode>(initial);
  useEffect(() => {
    if (DIGITAL_QUICK_MODES.includes(activeMode as DigitalQuickMode)) {
      setEditingMode(activeMode as DigitalQuickMode);
    }
  }, [activeMode]);
  const available = useMemo(() => new Set(availableModes), [availableModes]);
  const isClassic = editingMode === 'FT8' || editingMode === 'FT4';
  return <div className="w-[min(28rem,calc(100vw-2rem))] max-h-[min(75vh,700px)] overflow-y-auto space-y-3 p-3">
    <div>
      <p className="text-sm font-semibold">{t('digitalQuick.title')}</p>
      <p className="text-xs text-default-500 mt-1">{t('digitalQuick.description')}</p>
    </div>
    <div className="grid grid-cols-3 gap-1.5" role="group" aria-label={t('digitalQuick.mode')}>
      {DIGITAL_QUICK_MODES.map(name => <Button key={name} size="sm" variant="flat"
        color={editingMode === name ? 'primary' : 'default'}
        isDisabled={disabled || !available.has(name)}
        onPress={() => {
          setEditingMode(name);
          if (name !== activeMode) void onSelectMode(name);
        }}>{name}</Button>)}
    </div>
    <div className="border-t border-divider pt-3">
      {isClassic
        ? <ClassicDecodeQuickEditor key={editingMode} mode={editingMode as ClassicMode} />
        : NATIVE_DIGITAL_MODES.includes(editingMode as NativeDigitalMode)
          ? <DigitalDecodePreferencesPanel fixedMode={editingMode as NativeDigitalMode} compact />
          : null}
    </div>
  </div>;
}
