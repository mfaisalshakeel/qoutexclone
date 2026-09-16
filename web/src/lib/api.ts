const BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
const ACCESS_KEY = 'qx.access';
const REFRESH_KEY = 'qx.refresh';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = 'error',
    public details?: unknown,
  ) {
    super(message);
  }
}

export const tokens = {
  get access() {
    return localStorage.getItem(ACCESS_KEY);
  },
  get refresh() {
    return localStorage.getItem(REFRESH_KEY);
  },
  set(access: string, refresh: string) {
    localStorage.setItem(ACCESS_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

let refreshing: Promise<boolean> | null = null;

/** Exchanges the refresh token once, sharing the flight between callers. */
async function refreshSession(): Promise<boolean> {
  if (!tokens.refresh) return false;
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await fetch(`${BASE}/api/auth/refresh`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ refreshToken: tokens.refresh }),
        });
        if (!res.ok) {
          tokens.clear();
          return false;
        }
        const data = await res.json();
        tokens.set(data.accessToken, data.refreshToken);
        return true;
      } catch {
        return false;
      } finally {
        refreshing = null;
      }
    })();
  }
  return refreshing;
}

async function request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(tokens.access ? { authorization: `Bearer ${tokens.access}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  if (res.status === 401 && retry && tokens.refresh) {
    if (await refreshSession()) return request<T>(method, path, body, false);
  }

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = payload?.error ?? {};
    throw new ApiError(res.status, error.message ?? 'Request failed', error.code, error.details);
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  wsUrl(): string {
    if (BASE) return `${BASE.replace(/^http/, 'ws')}/ws`;
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${protocol}://${location.host}/ws`;
  },
};
