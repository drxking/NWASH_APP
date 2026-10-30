import { getDeviceIdentity } from './device';

// Development only. Set this to your deployed HTTPS /api/v1 URL before release.
export const API_BASE_URL = 'http://192.168.1.76:8000/api/v1';
export type User = {
  id: string;
  email?: string;
  fullName?: string;
  phoneNumber?: string;
  address?: string;
};
// Optional token metadata supports offline guests and pre-rollout saved accounts.
export type Session = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  user: User;
};
export class ApiError extends Error {
  constructor(
    message: string,
    public status?: number,
    public retryAt?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
export function normalizePhoneNumber(value: string): string | null {
  const normalized = value.trim().replace(/[ ()-]/g, '');
  return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : null;
}
export function requireSecureApi() {
  if (!__DEV__ && !API_BASE_URL.startsWith('https://'))
    throw new ApiError(
      'Configure the HTTPS API URL before deploying this app.',
    );
}
export function retryAfter(value: string | null | undefined, now = Date.now()) {
  if (value && /^\d+(\.\d+)?$/.test(value.trim()))
    return now + Number(value) * 1000;
  const date = Date.parse(value || '');
  return Number.isFinite(date) ? Math.max(now, date) : now + 60000;
}
const cooldowns = new Map<string, number>();
export async function authRequest(
  path: string,
  body?: object,
  accessToken?: string,
  expectedStatus?: number,
): Promise<any> {
  requireSecureApi();
  const retryAt = cooldowns.get(path);
  if (retryAt && retryAt > Date.now())
    throw new ApiError(
      'Too many attempts. Wait before trying again.',
      429,
      retryAt,
    );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${API_BASE_URL}/auth/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    if (!response.ok) {
      if (response.status === 429) {
        const deadline = retryAfter(response.headers?.get('Retry-After'));
        cooldowns.set(path, deadline);
        throw new ApiError(
          'Too many attempts. Wait before trying again.',
          429,
          deadline,
        );
      }
      const messages: Record<number, string> = {
        400: 'Check your name, phone number, and address.',
        401: 'Unable to sign in with this phone number and device. Please sign in again.',
        403: 'This device is unrecognized or revoked. Contact support to recover access.',
        409: 'An account with this phone number already exists. Sign in instead.',
        404: 'The sign-in service was not found. Check the server address or contact support.',
        500: 'The server could not complete sign-in (HTTP 500). Please try again later or contact support.',
        502: 'The server is temporarily unavailable (HTTP 502). Please try again later.',
        504: 'The server took too long to respond (HTTP 504). Please try again later.',
        503: 'The server is temporarily unavailable. Please try again later.',
      };
      throw new ApiError(
        messages[response.status] ||
          `Unable to complete the request (HTTP ${response.status}). Please try again.`,
        response.status,
      );
    }
    if (expectedStatus && response.status !== expectedStatus)
      throw new ApiError('The server returned an unexpected response.');
    if (response.status === 204) return undefined;
    try {
      return await response.json();
    } catch {
      throw new ApiError('The server returned an invalid response.');
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      controller.signal.aborted
        ? 'The request timed out. Please try again.'
        : 'Cannot reach the server. Check your connection and try again.',
    );
  } finally {
    clearTimeout(timeout);
  }
}
export function parseSession(data: any, phoneRequired = true): Session {
  if (
    !data ||
    typeof data.accessToken !== 'string' ||
    !data.accessToken ||
    data.tokenType !== 'Bearer' ||
    typeof data.user?.id !== 'string' ||
    !data.user.id ||
    typeof data.refreshToken !== 'string' ||
    !data.refreshToken ||
    !Number.isFinite(data.expiresIn) ||
    data.expiresIn <= 0 ||
    (phoneRequired &&
      (typeof data.user.phoneNumber !== 'string' ||
        !normalizePhoneNumber(data.user.phoneNumber) ||
        typeof data.user.fullName !== 'string' ||
        !data.user.fullName.trim() ||
        typeof data.user.address !== 'string' ||
        !data.user.address.trim()))
  )
    throw new ApiError('The server returned an invalid sign-in response.');
  const user: User = { id: data.user.id };
  for (const key of ['email', 'fullName', 'phoneNumber', 'address'] as const)
    if (typeof data.user[key] === 'string') user[key] = data.user[key];
  return {
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    expiresAt: Date.now() + data.expiresIn * 1000,
    user,
  };
}
export function login(phoneNumber: string): Promise<Session> {
  return authenticate('login', phoneNumber);
}
export function signup(
  fullName: string,
  phoneNumber: string,
  address: string,
): Promise<Session> {
  const name = fullName.trim();
  const location = address.trim();
  if (!name || name.length > 100 || !location || location.length > 500)
    return Promise.reject(
      new ApiError(
        'Enter your full name (up to 100 characters) and address (up to 500 characters).',
        400,
      ),
    );
  return authenticate('signup', phoneNumber, name, location);
}
async function authenticate(
  action: 'signup' | 'login',
  phoneNumber: string,
  fullName?: string,
  address?: string,
) {
  const phone = normalizePhoneNumber(phoneNumber);
  if (!phone)
    throw new ApiError('Enter a phone number with country code.', 400);
  const device = await getDeviceIdentity();
  const result = parseSession(
    await authRequest(
      action,
      {
        phoneNumber: phone,
        device,
        ...(action === 'signup' ? { fullName, address } : {}),
      },
      undefined,
      action === 'signup' ? 201 : 200,
    ),
  );
  if (result.user.phoneNumber !== phone)
    throw new ApiError('The server returned a different phone number.');
  return result;
}
