import { PermissionsAndroid, Platform } from 'react-native';
import Geolocation from '@react-native-community/geolocation';
import { captureLocation } from '../src/issues/capture';

jest.mock('@react-native-community/geolocation', () => ({
  getCurrentPosition: jest.fn(),
  requestAuthorization: jest.fn(),
  setRNConfiguration: jest.fn(),
}));
beforeEach(() => {
  jest.clearAllMocks();
  jest.replaceProperty(Platform, 'OS', 'android');
  jest.spyOn(PermissionsAndroid, 'requestMultiple').mockResolvedValue({
    'android.permission.ACCESS_FINE_LOCATION': 'granted',
    'android.permission.ACCESS_COARSE_LOCATION': 'granted',
  } as Awaited<ReturnType<typeof PermissionsAndroid.requestMultiple>>);
});
afterEach(() => jest.restoreAllMocks());

test('falls back to a fresh network fix when GPS times out', async () => {
  const position = {
    coords: { latitude: 27, longitude: 85, accuracy: 120 },
    timestamp: 123,
  };
  jest
    .mocked(Geolocation.getCurrentPosition)
    .mockImplementationOnce((_success, error) => {
      error!({ code: 3 } as never);
    })
    .mockImplementationOnce(success => {
      success(position as never);
    });
  await expect(captureLocation()).resolves.toEqual({
    latitude: 27,
    longitude: 85,
    accuracy: 120,
    timestamp: 123,
  });
  expect(Geolocation.getCurrentPosition).toHaveBeenNthCalledWith(
    2,
    expect.any(Function),
    expect.any(Function),
    expect.objectContaining({ enableHighAccuracy: false, maximumAge: 0 }),
  );
});

test('denied location permission does not request a position', async () => {
  jest.mocked(PermissionsAndroid.requestMultiple).mockResolvedValue({
    'android.permission.ACCESS_FINE_LOCATION': 'denied',
    'android.permission.ACCESS_COARSE_LOCATION': 'denied',
  } as Awaited<ReturnType<typeof PermissionsAndroid.requestMultiple>>);
  await expect(captureLocation()).rejects.toThrow('permission');
  expect(Geolocation.getCurrentPosition).not.toHaveBeenCalled();
});
