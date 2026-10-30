import { NativeModules, Platform } from 'react-native';
import { getAndroidId } from 'react-native-device-info';
import { getDeviceIdentity } from '../src/api/device';
const originalOS = Platform.OS;
beforeEach(() => {
  NativeModules.RNDeviceInfo = { getAndroidId };
});
afterEach(() => {
  Object.defineProperty(Platform, 'OS', {
    value: originalOS,
    configurable: true,
  });
  jest.mocked(getAndroidId).mockResolvedValue('1234567890abcdef');
  delete NativeModules.DeviceIdentity;
});
test('reads and normalizes Android ID', async () => {
  Object.defineProperty(Platform, 'OS', {
    value: 'android',
    configurable: true,
  });
  jest.mocked(getAndroidId).mockResolvedValue('1234567890ABCDEF');
  await expect(getDeviceIdentity()).resolves.toEqual({
    platform: 'android',
    identifierType: 'android_id',
    identifier: '1234567890abcdef',
  });
});
test('reads actual IDFV on iOS', async () => {
  Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
  NativeModules.DeviceIdentity = {
    getIdentifier: jest.fn(async () => 'ABCDEF12-1234-1234-1234-123456789ABC'),
  };
  await expect(getDeviceIdentity()).resolves.toEqual({
    platform: 'ios',
    identifierType: 'idfv',
    identifier: 'abcdef12-1234-1234-1234-123456789abc',
  });
});
test('fails instead of sending a placeholder identifier', async () => {
  Object.defineProperty(Platform, 'OS', {
    value: 'android',
    configurable: true,
  });
  jest.mocked(getAndroidId).mockResolvedValue('unknown');
  await expect(getDeviceIdentity()).rejects.toThrow(
    'Could not identify this device',
  );
});

test('reads Android ID again for each request without a JavaScript cache', async () => {
  Object.defineProperty(Platform, 'OS', {
    value: 'android',
    configurable: true,
  });
  jest
    .mocked(getAndroidId)
    .mockResolvedValueOnce('1111111111111111')
    .mockResolvedValueOnce('2222222222222222');
  expect((await getDeviceIdentity()).identifier).toBe('1111111111111111');
  expect((await getDeviceIdentity()).identifier).toBe('2222222222222222');
});
