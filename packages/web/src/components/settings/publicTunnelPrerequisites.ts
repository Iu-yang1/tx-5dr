import type { RemoteAccessPreset } from '@tx5dr/contracts';

export interface PublicTunnelPresetState {
  selectedPreset: RemoteAccessPreset | null;
  savedPreset: RemoteAccessPreset | null;
  electronPreset: RemoteAccessPreset | null;
  hasUnsavedChanges: boolean;
}

/** Never publish a tunnel based solely on a draft UI selection. */
export function isPublicTunnelPresetReady(state: PublicTunnelPresetState): boolean {
  return state.selectedPreset === 'public'
    && state.savedPreset === 'public'
    && state.electronPreset === 'public'
    && !state.hasUnsavedChanges;
}
