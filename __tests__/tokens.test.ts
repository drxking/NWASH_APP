import * as Keychain from 'react-native-keychain';
import { ApiError, Session } from '../src/api/auth';
import {
  endSession,
  forget,
  remember,
  restore,
  validSession,
  authenticatedFetch,
} from '../src/api/tokens';
jest.mock('../src/api/device', () => ({
  getDeviceIdentity: jest.fn(async () => ({
    platform: 'android',
    identifierType: 'android_id',
    identifier: '1234567890abcdef',
  })),
}));
const oldFetch = globalThis.fetch;
const fetchMock = jest.fn();
const user = {
  id: 'original-owner',
  fullName: 'Sam',
  phoneNumber: '+9779812345678',
  address: 'Kathmandu',
};
const expired = (): Session => ({
  accessToken: 'old-access',
  refreshToken: 'old-refresh',
  expiresAt: Date.now() - 1000,
  user,
});
const wire = (id = user.id) => ({
  accessToken: 'new-access',
  refreshToken: 'new-refresh',
  expiresIn: 3600,
  tokenType: 'Bearer',
  user: { ...user, id },
});
const ok = (data: object, status = 200) => ({
  ok: true,
  status,
  json: async () => data,
});
beforeEach(async () => {
  await forget();
  jest.clearAllMocks();
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
});
afterAll(() => {
  globalThis.fetch = oldFetch;
});

test('concurrent refresh callers share one rotation and persist both replacement tokens', async () => {
  const session = expired();
  await remember(session);
  fetchMock.mockResolvedValue(ok(wire()));
  const [a, b] = await Promise.all([
    validSession(session),
    validSession(session),
  ]);
  expect(a).toEqual(b);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
    refreshToken: 'old-refresh',
  });
  const writes = jest
    .mocked(Keychain.setGenericPassword)
    .mock.calls.map(call => JSON.parse(call[1]));
  expect(writes[1]).toMatchObject({ accessToken: '', expiresAt: 0 });
  expect(writes[1].refreshToken).toBeUndefined();
  expect(writes.at(-1)).toMatchObject({
    accessToken: 'new-access',
    refreshToken: 'new-refresh',
    user: { id: user.id },
  });
  expect(
    jest.mocked(Keychain.setGenericPassword).mock.calls.at(-1)?.[2],
  ).toMatchObject({
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
});

test('a lost refresh response is not retried even by callers holding the old session', async () => {
  const session = expired();
  await remember(session);
  fetchMock.mockRejectedValue(new TypeError('Offline'));
  await expect(validSession(session)).rejects.toThrow('Please sign in again');
  await expect(validSession(session)).rejects.toMatchObject({ status: 401 });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('rejects replacement tokens for a different user and never stores that user', async () => {
  const session = expired();
  await remember(session);
  fetchMock.mockResolvedValue(ok(wire('someone-else')));
  await expect(validSession(session)).rejects.toMatchObject({ status: 401 });
  expect(
    jest
      .mocked(Keychain.setGenericPassword)
      .mock.calls.map(call => JSON.parse(call[1]).user.id),
  ).not.toContain('someone-else');
});

test('a refresh cannot overwrite a newly selected account', async () => {
  const session = expired();
  await remember(session);
  let release!: (value: unknown) => void;
  let started!: () => void;
  const ready = new Promise<void>(resolve => {
    started = resolve;
  });
  fetchMock.mockImplementation(() => {
    started();
    return new Promise(resolve => {
      release = resolve;
    });
  });
  const refreshing = validSession(session);
  await ready;
  const other = { accessToken: 'other', user: { id: 'other-account' } };
  await remember(other);
  release(ok(wire()));
  await expect(refreshing).rejects.toThrow('active account changed');
  expect(
    JSON.parse(jest.mocked(Keychain.setGenericPassword).mock.calls.at(-1)![1])
      .user.id,
  ).toBe('other-account');
});

test('logout revokes with bearer before clearing secure storage and never forgets the device', async () => {
  const session = { ...expired(), expiresAt: Date.now() + 3600000 };
  await remember(session);
  fetchMock.mockResolvedValue(ok({}, 204));
  await expect(endSession(session)).resolves.toEqual({ revoked: true });
  expect(fetchMock.mock.calls[0][0]).toMatch(/\/auth\/logout$/);
  expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(
    'Bearer old-access',
  );
  expect(Keychain.resetGenericPassword).toHaveBeenCalled();
  await expect(validSession(session)).rejects.toMatchObject({ status: 401 });
});

test('offline logout clears local storage while reporting unconfirmed server revocation', async () => {
  const session = { ...expired(), expiresAt: Date.now() + 3600000 };
  await remember(session);
  fetchMock.mockRejectedValue(new TypeError('Offline'));
  await expect(endSession(session)).resolves.toEqual({ revoked: false });
  expect(Keychain.resetGenericPassword).toHaveBeenCalled();
});

test('forget-device uses its separate route and does not claim success offline', async () => {
  const session = { ...expired(), expiresAt: Date.now() + 3600000 };
  await remember(session);
  fetchMock.mockRejectedValueOnce(new TypeError('Offline'));
  await expect(endSession(session, true)).rejects.toBeInstanceOf(ApiError);
  expect(Keychain.resetGenericPassword).not.toHaveBeenCalled();
  fetchMock.mockResolvedValueOnce(ok({}, 204));
  await expect(endSession(session, true)).resolves.toEqual({ revoked: true });
  expect(fetchMock.mock.calls.at(-1)![0]).toMatch(/\/auth\/forget-device$/);
});

test('private requests send bearer and refresh only once on 401', async () => {
  const session = { ...expired(), expiresAt: Date.now() + 3600000 };
  await remember(session);
  fetchMock
    .mockResolvedValueOnce({ ok: false, status: 401 })
    .mockResolvedValueOnce(ok(wire()))
    .mockResolvedValueOnce({ ok: true, status: 200 });
  await authenticatedFetch(session, '/private/attachment');
  expect(fetchMock.mock.calls[0][1].headers.get('Authorization')).toBe(
    'Bearer old-access',
  );
  expect(fetchMock.mock.calls[2][1].headers.get('Authorization')).toBe(
    'Bearer new-access',
  );
  expect(fetchMock).toHaveBeenCalledTimes(3);
  await expect(
    authenticatedFetch(session, 'https://unrelated.example'),
  ).rejects.toThrow('Invalid private API path');
});

test('expired offline accounts restore for drafts without a network call', async () => {
  jest
    .mocked(Keychain.getGenericPassword)
    .mockResolvedValueOnce({ password: JSON.stringify(expired()) } as never);
  expect((await restore())?.user.id).toBe(user.id);
  expect(fetchMock).not.toHaveBeenCalled();
});
