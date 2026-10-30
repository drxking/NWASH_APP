/* eslint-env jest */
jest.mock('react-native-device-info', () => ({
  getAndroidId: jest.fn(async () => '1234567890abcdef'),
}));

jest.mock('react-native-keychain', () => ({
  setGenericPassword: jest.fn(async () => ({
    service: 'test',
    storage: 'test',
  })),
  getGenericPassword: jest.fn(async () => false),
  resetGenericPassword: jest.fn(async () => true),
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device' },
}));
