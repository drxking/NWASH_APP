import * as Keychain from 'react-native-keychain';
import {
  API_BASE_URL,
  ApiError,
  Session,
  authRequest,
  parseSession,
  requireSecureApi,
} from './auth';

const service = 'nwash.identity.v1';
export const guest: Session = {
  accessToken: '',
  user: { id: 'local-guest-v1', email: 'Guest' },
};
let active: Session | null = null;
let generation = 0;
let writes: Promise<unknown> = Promise.resolve();
const listeners = new Set<(session: Session) => void>();
const refreshing = new Map<string, Promise<Session>>();
export function onSessionChange(listener: (session: Session) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function persist(session: Session, expected?: number): Promise<void> {
  const operation = writes
    .catch(() => {})
    .then(async () => {
      if (expected !== undefined && generation !== expected)
        throw new ApiError('The active account changed. Sign in again.', 401);
      const { id, email, fullName, phoneNumber, address } = session.user;
      const stored = await Keychain.setGenericPassword(
        'identity',
        JSON.stringify({
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
          expiresAt: session.expiresAt,
          user: { id, email, fullName, phoneNumber, address },
        }),
        {
          service,
          accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        },
      );
      if (stored === false)
        throw new Error('Could not securely save your session.');
      if (expected !== undefined && generation !== expected)
        throw new ApiError('The active account changed. Sign in again.', 401);
      active = session;
      listeners.forEach(listener => listener(session));
    });
  writes = operation;
  return operation;
}
export function remember(session: Session) {
  generation++;
  return persist(session);
}
export async function restore(): Promise<Session | null> {
  await writes.catch(() => {});
  const saved = await Keychain.getGenericPassword({ service });
  if (!saved) {
    active = null;
    return null;
  }
  const session = JSON.parse(saved.password);
  if (
    typeof session?.user?.id !== 'string' ||
    !session.user.id ||
    typeof session.accessToken !== 'string' ||
    (session.refreshToken !== undefined &&
      (typeof session.refreshToken !== 'string' || !session.refreshToken)) ||
    (session.expiresAt !== undefined && !Number.isFinite(session.expiresAt))
  )
    throw new Error('Saved identity could not be read.');
  active = session;
  return session;
}
export async function forget() {
  generation++;
  const operation = writes
    .catch(() => {})
    .then(async () => {
      await Keychain.resetGenericPassword({ service });
      active = null;
    });
  writes = operation;
  await operation;
}
export async function validSession(
  session: Session,
  force = false,
): Promise<Session> {
  if (session.user.id === guest.user.id)
    throw new ApiError('Please sign in again. Your drafts are safe.', 401);
  if (!active || active.user.id !== session.user.id)
    throw new ApiError(
      'This account is no longer active. Please sign in again.',
      401,
    );
  const inFlight = refreshing.get(session.user.id);
  if (inFlight) return inFlight;
  const latest = active?.user.id === session.user.id ? active : session;
  if (
    force &&
    latest.accessToken !== session.accessToken &&
    latest.accessToken &&
    (latest.expiresAt || 0) > Date.now() + 30000
  )
    return latest;
  if (
    !force &&
    latest.accessToken &&
    (latest.expiresAt === undefined || latest.expiresAt > Date.now() + 30000)
  )
    return latest;
  if (!latest.refreshToken)
    throw new ApiError('Please sign in again. Your drafts are safe.', 401);
  const expected = generation;
  const operation = (async () => {
    const token = latest.refreshToken!;
    // Invalidate durably before sending: a lost response must never replay this token.
    await persist(
      { ...latest, accessToken: '', refreshToken: undefined, expiresAt: 0 },
      expected,
    );
    try {
      const replacement = parseSession(
        await authRequest('refresh', { refreshToken: token }, undefined, 200),
        false,
      );
      if (
        replacement.user.id !== latest.user.id ||
        replacement.refreshToken === token
      )
        throw new ApiError(
          'Invalid session replacement. Please sign in again.',
          401,
        );
      await persist(replacement, expected);
      return replacement;
    } catch (failure) {
      if (failure instanceof ApiError)
        throw new ApiError(
          `${failure.message} Please sign in again; the previous refresh token will not be retried.`,
          failure.status || 401,
          failure.retryAt,
        );
      throw new ApiError(
        'Could not save the replacement session. Please sign in again.',
        401,
      );
    }
  })();
  refreshing.set(session.user.id, operation);
  try {
    return await operation;
  } finally {
    refreshing.delete(session.user.id);
  }
}
export async function authorizedAction(
  session: Session,
  path: string,
  body?: object,
  status = 200,
) {
  let live = await validSession(session);
  try {
    return await authRequest(path, body, live.accessToken, status);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    live = await validSession(live, true);
    return authRequest(path, body, live.accessToken, status);
  }
}
export async function endSession(
  session: Session,
  forgetDevice = false,
): Promise<{ revoked: boolean }> {
  let revoked = false;
  try {
    await authorizedAction(
      session,
      forgetDevice ? 'forget-device' : 'logout',
      undefined,
      204,
    );
    revoked = true;
  } catch (error) {
    if (forgetDevice) throw error;
  }
  // Forget-device fails visibly if revocation is unconfirmed; ordinary logout always clears locally.
  await forget();
  return { revoked };
}
// Use this for future private API/media fetches. Never attach bearer tokens to external URLs.
export async function authenticatedFetch(
  session: Session,
  path: string,
  init: RequestInit = {},
) {
  requireSecureApi();
  if (!path.startsWith('/') || path.startsWith('//'))
    throw new ApiError('Invalid private API path.');
  let live = await validSession(session);
  const send = (token: string) => {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  };
  let response = await send(live.accessToken);
  if (response.status === 401) {
    live = await validSession(live, true);
    response = await send(live.accessToken);
  }
  return response;
}
