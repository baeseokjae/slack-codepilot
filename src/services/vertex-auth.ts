import { GoogleAuth } from 'google-auth-library';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('vertex-auth');

interface TokenCache {
  token: string;
  expiresAtMs: number;
}

let tokenCache: TokenCache | null = null;
const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });

// Refresh 5 minutes before actual expiry
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

export async function getAccessToken(): Promise<string> {
  const now = Date.now();

  if (tokenCache && now < tokenCache.expiresAtMs - REFRESH_BUFFER_MS) {
    logger.debug('Returning cached Vertex AI access token');
    return tokenCache.token;
  }

  logger.debug('Fetching new Vertex AI access token');
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();

  if (!tokenResponse.token) {
    throw new Error('Failed to obtain Vertex AI access token: token is null');
  }

  // Default to 1 hour expiry if not provided
  const expiresAtMs =
    tokenResponse.res?.data?.expiry_date ??
    (now + 60 * 60 * 1000);

  tokenCache = {
    token: tokenResponse.token,
    expiresAtMs,
  };

  logger.debug({ expiresAtMs }, 'Cached new Vertex AI access token');
  return tokenCache.token;
}

/** Reset the token cache. Exported for testing only. */
export function _resetTokenCache(): void {
  tokenCache = null;
}
