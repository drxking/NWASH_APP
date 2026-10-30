import { NativeModules, Platform } from 'react-native';

export type DeviceIdentity = {
  platform: 'android' | 'ios';
  identifierType: 'android_id' | 'idfv';
  identifier: string;
};

export async function getDeviceIdentity(): Promise<DeviceIdentity> {
  try {
    if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
      throw new Error('Unsupported platform');
    }
    // Read native IDs for each request (the JS device-info helper caches Android ID).
    // Read actual IDFV, rather than a library's cached ID or random UUID fallback.
    const identifier: unknown =
      Platform.OS === 'android'
        ? await NativeModules.RNDeviceInfo.getAndroidId()
        : await NativeModules.DeviceIdentity.getIdentifier();
    const valid =
      typeof identifier === 'string' &&
      (Platform.OS === 'android'
        ? /^[a-f0-9]{16}$/i.test(identifier) && !/^0+$/.test(identifier)
        : /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(identifier) &&
          !/^0{8}(-0{4}){3}-0{12}$/.test(identifier));
    if (!valid) throw new Error('Identifier unavailable');
    return {
      platform: Platform.OS,
      identifierType: Platform.OS === 'android' ? 'android_id' : 'idfv',
      identifier: (identifier as string).toLowerCase(),
    };
  } catch {
    throw new Error(
      'Could not identify this device. Unlock your device and try again.',
    );
  }
}
