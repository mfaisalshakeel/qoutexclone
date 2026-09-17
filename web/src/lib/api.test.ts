import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, tokens } from './api';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('api client', () => {
  beforeEach(() => {
    localStorage.clear();
    api._resetRefresh();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns the parsed payload on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ok: true, value: 7 })));
    await expect(api.get<{ value: number }>('/thing')).resolves.toEqual({ ok: true, value: 7 });
  });

  it('throws a typed error carrying the server code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(json({ error: { code: 'insufficient_funds', message: 'Not enough' } }, 400)),
    );
    const error = (await api.post('/trades', {}).catch((err) => err)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe('insufficient_funds');
    expect(error.status).toBe(400);
    expect(error.isValidation).toBe(false);
  });

  it('retries a GET on a network failure and succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.get('/market/assets')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after the retry budget with a network error', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    const error = (await api.get('/market/assets').catch((err) => err)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.isNetwork).toBe(true);
    expect(error.code).toBe('network_error');
    // initial attempt plus two retries
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('never replays a POST after a network failure', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.post('/trades', { amount: 10 })).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a GET when the server is restarting (503)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ error: { message: 'restarting' } }, 503))
      .mockResolvedValueOnce(json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.get('/ready')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refreshes once for a burst of 401s (single flight)', async () => {
    tokens.set('stale-access', 'good-refresh');

    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (String(url).endsWith('/api/auth/refresh')) {
        return Promise.resolve(json({ accessToken: 'fresh', refreshToken: 'rotated' }));
      }
      const auth = (init?.headers as Record<string, string>)?.authorization;
      if (auth === 'Bearer fresh') return Promise.resolve(json({ ok: true }));
      return Promise.resolve(json({ error: { code: 'unauthorized', message: 'expired' } }, 401));
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const results = await Promise.all([api.get('/me'), api.get('/wallet/balances'), api.get('/trades')]);
    expect(results).toEqual([{ ok: true }, { ok: true }, { ok: true }]);

    const refreshCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/auth/refresh'));
    expect(refreshCalls).toHaveLength(1);
    expect(tokens.access).toBe('fresh');
  });

  it('clears the session when the refresh token is rejected', async () => {
    tokens.set('stale', 'dead-refresh');
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        String(url).endsWith('/api/auth/refresh')
          ? Promise.resolve(json({ error: { message: 'expired' } }, 401))
          : Promise.resolve(json({ error: { code: 'unauthorized', message: 'nope' } }, 401)),
      ) as unknown as typeof fetch,
    );

    await expect(api.get('/me')).rejects.toBeInstanceOf(ApiError);
    expect(tokens.access).toBeNull();
    expect(tokens.refresh).toBeNull();
  });

  it('keeps the session on a network failure during refresh', async () => {
    tokens.set('stale', 'good-refresh');
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        String(url).endsWith('/api/auth/refresh')
          ? Promise.reject(new TypeError('Failed to fetch'))
          : Promise.resolve(json({ error: { code: 'unauthorized', message: 'nope' } }, 401)),
      ) as unknown as typeof fetch,
    );

    await expect(api.get('/me')).rejects.toBeInstanceOf(ApiError);
    expect(tokens.refresh).toBe('good-refresh');
  });
});
