import { create } from 'zustand';
import { api } from '../lib/api';
import { realtime } from '../lib/ws';

/**
 * The platform settings an operator can change, as the browser sees them.
 *
 * Loaded once at boot and kept current over the socket, so a change in the
 * back office reaches every open tab without a reload — the same contract the
 * terminal's trading configuration already has.
 */
interface SettingsState {
  values: Record<string, unknown>;
  loaded: boolean;
  load: () => Promise<void>;
  apply: (key: string, value: unknown) => void;
}

export const useSettings = create<SettingsState>((set) => ({
  values: {},
  loaded: false,

  async load() {
    try {
      const { settings } = await api.get<{ settings: Record<string, unknown> }>('/market/settings');
      set({ values: settings, loaded: true });
    } catch {
      // the defaults baked into each component stand in until this succeeds
      set({ loaded: true });
    }
  },

  apply(key, value) {
    set((state) => ({ values: { ...state.values, [key]: value } }));
  },
}));

realtime.on('settings:changed', ({ key, value }) => useSettings.getState().apply(key, value));
