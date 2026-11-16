// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_NATIVE_DECODE_PREFERENCES, NATIVE_DIGITAL_MODES } from '@tx5dr/contracts';
import zh from '../../i18n/locales/zh/common.json';
import en from '../../i18n/locales/en/common.json';
import ja from '../../i18n/locales/ja/common.json';
import { DigitalDecodePreferencesPanel } from './DigitalDecodePreferencesPanel';

const locale = vi.hoisted(() => ({ code: 'zh' as 'zh'|'en'|'ja' }));
const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  save: vi.fn(),
}));

vi.mock('@tx5dr/core', () => ({
  api: {
    getNativeDecodePreferences: apiMock.get,
    updateNativeDecodePreferences: apiMock.save,
  },
}));
vi.mock('../../store/authStore', () => ({ useCan: () => true }));
// The panel memoizes reload with [t]; keep translation function identity stable
// across re-renders, just like react-i18next in production.
const translate = (key: string) => {
  const resources = { zh, en, ja };
  const result = key.split('.').reduce<unknown>(
    (value, part) => value && typeof value === 'object'
      ? (value as Record<string, unknown>)[part] : undefined,
    resources[locale.code],
  );
  return typeof result === 'string' ? result : key;
};
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: translate }),
}));

function preferences() {
  return Object.fromEntries(NATIVE_DIGITAL_MODES.map(mode => [
    mode, { ...DEFAULT_NATIVE_DECODE_PREFERENCES },
  ]));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  locale.code = 'zh';
});

describe('native decoder settings action labels', () => {
  for (const lang of ['zh', 'en', 'ja'] as const) {
    it(`renders and executes localized Refresh in ${lang} rather than exposing action.refresh`, async () => {
      locale.code = lang;
      apiMock.get.mockImplementation(async () => ({
        revision: 1, preferences: preferences(),
      }));
      render(<DigitalDecodePreferencesPanel fixedMode="MSK144" compact />);

      const expected = { zh, en, ja }[lang].button.refresh;
      const refresh = await screen.findByRole('button', { name: expected });
      await waitFor(() => expect(apiMock.get).toHaveBeenCalledTimes(1));
      expect(screen.queryByText('action.refresh')).toBeNull();
      expect(screen.getByText({ zh, en, ja }[lang].system.nativeDecode.mskTxFixed)).toBeTruthy();

      fireEvent.click(refresh);
      await waitFor(() => expect(apiMock.get).toHaveBeenCalledTimes(2));
    });
  }
});
