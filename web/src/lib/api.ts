const BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
const ACCESS_KEY = 'qx.access';
const REFRESH_KEY = 'qx.refresh';

/** Network-level retries only apply to reads; writes must never be replayed. */
const RETRYABLE_METHODS = new Set(['GET', 'HEAD']);
const MAX_RETRIES = 2;
const BASE_BACKOFF_MS = 300;

export type ApiErrorCode =
  | 'network_error'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'validation_error'
  | 'rate_limited'
  | 'insufficient_funds'
  | 'conflict'
  | 'internal_error'
  | (string & {});

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: ApiErrorCode = 'error',
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** True when the request never reached the server. */
  get isNetwork(): boolean {
    return this.status === 0;
  }

  get isAuth(): boolean {
    return this.status === 401 || this.status === 403;
  }

  get isValidation(): boolean {
    return this.code === 'validation_error';
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

/**
 * Exchanges the refresh token. Concurrent 401s share one flight, so a burst of
 * requests cannot trigger a storm of refreshes (and rotate the token out from
 * under each other).
 */
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
          // Only a refusal of the token itself ends the session. A 429 from the
          // rate limiter or a 5xx from a restarting instance is a temporary
          // failure, and signing someone out over it loses their session for no
          // reason — the same reasoning as the network case below.
          if (res.status === 401 || res.status === 403) tokens.clear();
          return false;
        }
        const data = await res.json();
        tokens.set(data.accessToken, data.refreshToken);
        return true;
      } catch {
        // a network failure is not a bad token, so the session is left alone
        return false;
      } finally {
        refreshing = null;
      }
    })();
  }
  return refreshing;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface RequestOptions {
  /** Skip the Authorization header (used by the refresh call itself). */
  anonymous?: boolean;
  signal?: AbortSignal;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options: RequestOptions = {},
  attempt = 0,
  refreshed = false,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(!options.anonymous && tokens.access ? { authorization: `Bearer ${tokens.access}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: options.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    // offline, DNS failure, server restarting: retry reads with backoff
    if (RETRYABLE_METHODS.has(method) && attempt < MAX_RETRIES) {
      await sleep(BASE_BACKOFF_MS * 2 ** attempt);
      return request<T>(method, path, body, options, attempt + 1, refreshed);
    }
    throw new ApiError(0, 'Cannot reach the server. Check your connection and try again.', 'network_error');
  }

  if (res.status === 401 && !refreshed && !options.anonymous && tokens.refresh) {
    if (await refreshSession()) return request<T>(method, path, body, options, attempt, true);
  }

  // 502/503/504 mean the instance is restarting or behind a proxy hiccup
  if (res.status >= 502 && res.status <= 504 && RETRYABLE_METHODS.has(method) && attempt < MAX_RETRIES) {
    await sleep(BASE_BACKOFF_MS * 2 ** attempt);
    return request<T>(method, path, body, options, attempt + 1, refreshed);
  }

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = payload?.error ?? {};
    throw new ApiError(res.status, error.message ?? 'Request failed', error.code ?? 'error', error.details);
  }
  return payload as T;
}

/**
 * A GET that returns a file rather than JSON — a statement download, say.
 * Triggers the browser's own save flow via a throwaway object URL rather than
 * returning the blob, since every caller wants exactly that.
 */
async function downloadFile(path: string, refreshed = false): Promise<void> {
  const res = await fetch(`${BASE}/api${path}`, {
    headers: tokens.access ? { authorization: `Bearer ${tokens.access}` } : {},
  }).catch(() => {
    throw new ApiError(0, 'Cannot reach the server. Check your connection and try again.', 'network_error');
  });

  if (res.status === 401 && !refreshed && tokens.refresh) {
    if (await refreshSession()) return downloadFile(path, true);
  }
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    const error = payload?.error ?? {};
    throw new ApiError(res.status, error.message ?? 'Request failed', error.code ?? 'error', error.details);
  }

  const disposition = res.headers.get('content-disposition') ?? '';
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'download';
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>('GET', path, undefined, options),
  download: downloadFile,
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('POST', path, body ?? {}, options),
  patch: <T>(path: string, body: unknown, options?: RequestOptions) =>
    request<T>('PATCH', path, body, options),
  put: <T>(path: string, body: unknown, options?: RequestOptions) => request<T>('PUT', path, body, options),
  del: <T>(path: string, options?: RequestOptions) => request<T>('DELETE', path, undefined, options),

  wsUrl(): string {
    if (BASE) return `${BASE.replace(/^http/, 'ws')}/ws`;
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${protocol}://${location.host}/ws`;
  },

  /** Test seam: clears the in-flight refresh between specs. */
  _resetRefresh() {
    refreshing = null;
  },
};
