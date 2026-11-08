import { describe, expect, it } from 'vitest';
import { isPublicTunnelPresetReady } from '../publicTunnelPrerequisites';

const applied = {
  selectedPreset: 'public' as const,
  savedPreset: 'public' as const,
  electronPreset: 'public' as const,
  hasUnsavedChanges: false,
};

describe('public tunnel preset prerequisite', () => {
  it('permits a tunnel when public access was both saved and applied in Electron', () => {
    expect(isPublicTunnelPresetReady(applied)).toBe(true);
  });

  it('blocks local and LAN presets even if FRP settings are complete', () => {
    for (const preset of ['local', 'lan'] as const) {
      expect(isPublicTunnelPresetReady({ ...applied, electronPreset: preset })).toBe(false);
      expect(isPublicTunnelPresetReady({ ...applied, savedPreset: preset })).toBe(false);
    }
  });

  it('blocks an unsaved public selection and unsaved origin or security changes', () => {
    expect(isPublicTunnelPresetReady({ ...applied, savedPreset: 'local' })).toBe(false);
    expect(isPublicTunnelPresetReady({ ...applied, hasUnsavedChanges: true })).toBe(false);
    expect(isPublicTunnelPresetReady({ ...applied, selectedPreset: null })).toBe(false);
    expect(isPublicTunnelPresetReady({ ...applied, electronPreset: null })).toBe(false);
  });
});
