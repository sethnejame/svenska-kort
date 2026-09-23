/**
 * Transfer codes — moving an account to a second device.
 *
 * The one supported way to keep a learner's account when they clear browser
 * data or switch devices, since the app has no login. `createTransferCode`
 * runs on the device that already holds the account; `claimTransferCode` runs
 * on the device that wants it, and hands back a new token for `setToken` to
 * store — the caller reloads the page afterwards so every module-level cache
 * (like `RemoteScoreStore`'s `cachedDeviceId`) picks up the new identity.
 */
import {
  claimTransferCodeResponseSchema,
  createTransferCodeResponseSchema,
} from '../../shared/api';
import { apiRequest } from './apiClient';

export interface TransferCode {
  code: string;
  expiresAt: string;
}

/** Requires an existing account on this device. */
export async function createTransferCode(): Promise<TransferCode> {
  const result = await apiRequest(createTransferCodeResponseSchema, {
    method: 'POST',
    path: '/api/transfer/create',
  });
  if (!result.ok) throw new Error(result.message);
  return result.data;
}

/**
 * Claims a code and returns the new device token. Unauthenticated — the code
 * itself is the credential — so callers must pass `auth: false` through, and
 * must not call this before the learner has confirmed any local data loss.
 */
export async function claimTransferCode(code: string): Promise<string> {
  const result = await apiRequest(claimTransferCodeResponseSchema, {
    method: 'POST',
    path: '/api/transfer/claim',
    body: { code },
    auth: false,
  });
  if (!result.ok) throw new Error(result.message);
  return result.data.token;
}
