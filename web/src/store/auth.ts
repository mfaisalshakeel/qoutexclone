import { create } from 'zustand';
import { api, tokens } from '../lib/api';
import { realtime } from '../lib/ws';
import type { AccountType, User } from '../lib/types';

interface AuthState {
  user: User | null;
  ready: boolean;
  loading: boolean;
  bootstrap: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (input: {
    email: string;
    password: string;
    name: string;
    country?: string;
    referralCode?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  setAccount: (accountType: AccountType) => Promise<void>;
  resetDemo: () => Promise<void>;
  patchBalance: (accountType: AccountType, balance: number) => void;
  setUser: (user: User) => void;
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  ready: false,
  loading: false,

  async bootstrap() {
    if (!tokens.access) {
      set({ ready: true });
      return;
    }
    try {
      const { user } = await api.get<{ user: User }>('/me');
      set({ user });
      realtime.connect();
    } catch {
      tokens.clear();
    } finally {
      set({ ready: true });
    }
  },

  async login(email, password) {
    set({ loading: true });
    try {
      const data = await api.post<{ user: User; accessToken: string; refreshToken: string }>('/auth/login', {
        email,
        password,
      });
      tokens.set(data.accessToken, data.refreshToken);
      set({ user: data.user });
      realtime.reauthenticate();
    } finally {
      set({ loading: false });
    }
  },

  async register(input) {
    set({ loading: true });
    try {
      const data = await api.post<{ user: User; accessToken: string; refreshToken: string }>(
        '/auth/register',
        input,
      );
      tokens.set(data.accessToken, data.refreshToken);
      set({ user: data.user });
      realtime.reauthenticate();
    } finally {
      set({ loading: false });
    }
  },

  async logout() {
    try {
      await api.post('/auth/logout', { refreshToken: tokens.refresh });
    } catch {
      /* logging out locally is what matters */
    }
    tokens.clear();
    realtime.disconnect();
    set({ user: null });
  },

  async refreshUser() {
    const { user } = await api.get<{ user: User }>('/me');
    set({ user });
  },

  async setAccount(accountType) {
    const { user } = await api.post<{ user: User }>('/me/account', { accountType });
    set({ user });
  },

  async resetDemo() {
    const { user } = await api.post<{ user: User }>('/me/demo/reset');
    set({ user });
  },

  patchBalance(accountType, balance) {
    const user = get().user;
    if (!user) return;
    set({ user: { ...user, [accountType === 'DEMO' ? 'demoBalance' : 'realBalance']: balance } });
  },

  setUser(user) {
    set({ user });
  },
}));

export function activeBalance(user: User | null): number {
  if (!user) return 0;
  return user.activeAccount === 'DEMO' ? user.demoBalance : user.realBalance;
}
