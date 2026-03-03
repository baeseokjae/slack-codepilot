import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config/index.js', () => ({
  config: {
    LOG_LEVEL: 'silent',
  },
}));

const mockGetAccessToken = vi.hoisted(() => vi.fn());
const mockGetClient = vi.hoisted(() => vi.fn());

vi.mock('google-auth-library', () => ({
  GoogleAuth: vi.fn().mockImplementation(() => ({
    getClient: mockGetClient,
  })),
}));

import { _resetTokenCache, getAccessToken } from './vertex-auth.js';

describe('vertex-auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetTokenCache();
    mockGetClient.mockResolvedValue({ getAccessToken: mockGetAccessToken });
  });

  it('should return a token and cache it', async () => {
    const futureExpiry = Date.now() + 60 * 60 * 1000;
    mockGetAccessToken.mockResolvedValue({
      token: 'test-token-1',
      res: { data: { expiry_date: futureExpiry } },
    });

    const token = await getAccessToken();

    expect(token).toBe('test-token-1');
    expect(mockGetClient).toHaveBeenCalledTimes(1);
    expect(mockGetAccessToken).toHaveBeenCalledTimes(1);
  });

  it('should return cached token when not expired', async () => {
    const futureExpiry = Date.now() + 60 * 60 * 1000;
    mockGetAccessToken.mockResolvedValue({
      token: 'test-token-cached',
      res: { data: { expiry_date: futureExpiry } },
    });

    const token1 = await getAccessToken();
    const token2 = await getAccessToken();

    expect(token1).toBe('test-token-cached');
    expect(token2).toBe('test-token-cached');
    // getClient and getAccessToken should only be called once (second call uses cache)
    expect(mockGetClient).toHaveBeenCalledTimes(1);
    expect(mockGetAccessToken).toHaveBeenCalledTimes(1);
  });

  it('should refresh token when near expiry (within 5 min buffer)', async () => {
    // First call: token expires in 4 minutes (inside the 5-min refresh buffer)
    // so it WILL be fetched but on next call it will be refreshed
    const nearExpiry = Date.now() + 4 * 60 * 1000;
    mockGetAccessToken.mockResolvedValueOnce({
      token: 'expiring-soon-token',
      res: { data: { expiry_date: nearExpiry } },
    });

    const token1 = await getAccessToken();
    expect(token1).toBe('expiring-soon-token');
    expect(mockGetClient).toHaveBeenCalledTimes(1);

    // The cached token is within the 5-min buffer, so the next call should refresh
    mockGetAccessToken.mockResolvedValueOnce({
      token: 'fresh-token',
      res: { data: { expiry_date: Date.now() + 60 * 60 * 1000 } },
    });

    const token2 = await getAccessToken();
    expect(token2).toBe('fresh-token');
    expect(mockGetClient).toHaveBeenCalledTimes(2);
  });

  it('should throw when getAccessToken returns null token', async () => {
    mockGetAccessToken.mockResolvedValue({
      token: null,
      res: null,
    });

    await expect(getAccessToken()).rejects.toThrow(
      'Failed to obtain Vertex AI access token: token is null',
    );
  });
});
