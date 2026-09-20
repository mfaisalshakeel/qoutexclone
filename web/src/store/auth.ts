import { create } from 'zustand';
import { api, tokens } from '../lib/api';
import { setDisplayPreferences } from '../lib/format';
import { realtime } from '../lib/ws';
import { useNotifications } from './notifications';
import { useMarket } from './market';
import type { AccountType, User } from '../lib/types';

interface Session {
  user: User;
  accessToken: string;
  refreshToken: string;
}

export type LoginResult = { done: true } | { done: false; challengeToken: string };

interface AuthState {
  user: User | null;
  ready: boolean;
  loading: boolean;
  bootstrap: () => Promise<void>;
  /** Resolves to a challenge when the account has a second factor enrolled. */
  login: (email: string, password: string) => Promise<LoginResult>;
  /** Finishes a sign-in that stopped for a code. */
  submitSecondFactor: (challengeToken: string, code: string) => Promise<void>;
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
  /** Stores the tokens a sign-in returned and brings the socket with it. */
  adoptSession: (session: Session) => void;
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
      setDisplayPreferences(user);
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
      const data = await api.post<Session | { twoFactorRequired: true; challengeToken: string }>(
        '/auth/login',
        { email, password },
      );
      if ('twoFactorRequired' in data) return { done: false, challengeToken: data.challengeToken };
      get().adoptSession(data);
      return { done: true };
    } finally {
      set({ loading: false });
    }
  },

  async submitSecondFactor(challengeToken, code) {
    set({ loading: true });
    try {
      const data = await api.post<Session>('/auth/2fa', { challengeToken, code });
      get().adoptSession(data);
    } finally {
      set({ loading: false });
    }
  },

  async register(input) {
    set({ loading: true });
    try {
      const data = await api.post<Session>('/auth/register', input);
      get().adoptSession(data);
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
    // the next trader on this browser must not inherit anyone's notifications,
    // nor keep this session's claim on the workspace
    useNotifications.getState().reset();
    useMarket.getState().forgetLayout();
    set({ user: null });
  },

  async refreshUser() {
    const { user } = await api.get<{ user: User }>('/me');
    setDisplayPreferences(user);
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

  adoptSession(session) {
    tokens.set(session.accessToken, session.refreshToken);
    setDisplayPreferences(session.user);
    set({ user: session.user });
    realtime.reauthenticate();
  },
}));

export function activeBalance(user: User | null): number {
  if (!user) return 0;
  return user.activeAccount === 'DEMO' ? user.demoBalance : user.realBalance;
}
