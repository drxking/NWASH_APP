jest.mock('../src/api/device', () => ({
  getDeviceIdentity: jest.fn(async () => ({
    platform: 'android',
    identifierType: 'android_id',
    identifier: '1234567890abcdef',
  })),
}));
import {
  ApiError,
  login,
  signup,
  authRequest,
  retryAfter,
} from '../src/api/auth';

const fetchMock = jest.fn();
const originalFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = fetchMock;
  fetchMock.mockReset();
});
afterAll(() => {
  globalThis.fetch = originalFetch;
});

test('normalizes phone number and sends device identity', async () => {
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      accessToken: 'token',
      refreshToken: 'refresh',
      expiresIn: 3600,
      tokenType: 'Bearer',
      user: {
        id: '1',
        phoneNumber: '+9779812345678',
        fullName: 'Sam Example',
        address: 'Kathmandu',
      },
    }),
  });
  await expect(login(' +977 9812345678 ')).resolves.toEqual({
    accessToken: 'token',
    refreshToken: 'refresh',
    expiresAt: expect.any(Number),
    user: {
      id: '1',
      phoneNumber: '+9779812345678',
      fullName: 'Sam Example',
      address: 'Kathmandu',
    },
  });
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
    phoneNumber: '+9779812345678',
    device: {
      platform: 'android',
      identifierType: 'android_id',
      identifier: '1234567890abcdef',
    },
  });
});

test('rejects wrong credentials without trusting server error text', async () => {
  fetchMock.mockResolvedValue({ ok: false, status: 401 });
  await expect(login('+9779812345678')).rejects.toThrow(
    'Unable to sign in with this phone number and device.',
  );
});

test('rejects malformed success responses', async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ user: {} }) });
  await expect(login('+9779812345678')).rejects.toBeInstanceOf(ApiError);
});

test('network failures produce an actionable message', async () => {
  fetchMock.mockRejectedValue(new TypeError('Network request failed'));
  await expect(login('+9779812345678')).rejects.toThrow(
    'Cannot reach the server.',
  );
});

test('signup sends name, phone, address and device identity', async () => {
  fetchMock.mockResolvedValue({
    ok: true,
    status: 201,
    json: async () => ({
      accessToken: 'token',
      refreshToken: 'refresh',
      expiresIn: 3600,
      tokenType: 'Bearer',
      user: {
        id: '2',
        phoneNumber: '+9779812345678',
        fullName: 'Sam Example',
        address: 'Kathmandu',
      },
    }),
  });
  await signup(' Sam Example ', ' +977 9812345678 ', ' Kathmandu ');
  expect(fetchMock.mock.calls[0][0]).toMatch(/\/auth\/signup$/);
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
    phoneNumber: '+9779812345678',
    device: {
      platform: 'android',
      identifierType: 'android_id',
      identifier: '1234567890abcdef',
    },
    fullName: 'Sam Example',
    address: 'Kathmandu',
  });
});

test('signup explains duplicate phone errors', async () => {
  fetchMock.mockResolvedValue({ ok: false, status: 409 });
  await expect(
    signup('Sam Example', '+9779812345678', 'Kathmandu'),
  ).rejects.toThrow('already exists');
});

test('requires country code and validates signup lengths before sending', async () => {
  await expect(login('9812345678')).rejects.toMatchObject({ status: 400 });
  await expect(
    signup('  ', '+9779812345678', 'Kathmandu'),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    signup('a'.repeat(101), '+9779812345678', 'Kathmandu'),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    signup('Sam', '+9779812345678', 'a'.repeat(501)),
  ).rejects.toMatchObject({ status: 400 });
  expect(fetchMock).not.toHaveBeenCalled();
});
test('unavailable native identifier prevents submitting authentication', async () => {
  const { getDeviceIdentity } = require('../src/api/device');
  getDeviceIdentity.mockRejectedValueOnce(new Error('Identifier unavailable'));
  await expect(login('+9779812345678')).rejects.toThrow(
    'Identifier unavailable',
  );
  expect(fetchMock).not.toHaveBeenCalled();
});
test('403 returns support guidance without attempting signup', async () => {
  fetchMock.mockResolvedValue({ ok: false, status: 403 });
  await expect(login('+9779812345678')).rejects.toThrow('Contact support');
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toMatch(/auth\/login$/);
});
test('429 honors Retry-After locally instead of resubmitting', async () => {
  fetchMock.mockResolvedValue({
    ok: false,
    status: 429,
    headers: { get: () => '60' },
  });
  await expect(authRequest('rate-test')).rejects.toMatchObject({
    status: 429,
    retryAt: expect.any(Number),
  });
  await expect(authRequest('rate-test')).rejects.toMatchObject({ status: 429 });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(retryAfter('120', 1000)).toBe(121000);
  expect(retryAfter('Thu, 01 Jan 1970 00:02:00 GMT', 1000)).toBe(120000);
});
test('503 remains retryable without consuming a session', async () => {
  fetchMock.mockResolvedValue({ ok: false, status: 503 });
  await expect(login('+9779812345678')).rejects.toThrow(
    'temporarily unavailable',
  );
});

test('release builds refuse the development HTTP API URL', () => {
  const environment = globalThis as unknown as { __DEV__: boolean };
  const original = environment.__DEV__;
  environment.__DEV__ = false;
  try {
    const { requireSecureApi } = jest.requireActual('../src/api/auth');
    expect(requireSecureApi).toThrow('HTTPS API URL');
  } finally {
    environment.__DEV__ = original;
  }
});

test('server failures identify HTTP 500 instead of showing an unexplained generic error', async () => {
  fetchMock.mockResolvedValue({ ok: false, status: 500 });
  await expect(login('+9779812345678')).rejects.toThrow('HTTP 500');
});
