import { PermissionsAndroid, Platform } from 'react-native';
import Geolocation from '@react-native-community/geolocation';
import { CaptureLocation } from './model';

export async function requirePermission(kind: 'camera' | 'audio') {
  if (Platform.OS !== 'android') {
    return;
  }
  const permission =
    kind === 'camera'
      ? PermissionsAndroid.PERMISSIONS.CAMERA
      : PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;
  const result = await PermissionsAndroid.request(permission);
  if (result !== PermissionsAndroid.RESULTS.GRANTED) {
    throw new Error(
      `${
        kind === 'camera' ? 'Camera' : 'Microphone'
      } permission is required. Enable it in phone settings.`,
    );
  }
}

export async function captureLocation(): Promise<CaptureLocation> {
  if (Platform.OS === 'android') {
    const result = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
    ]);
    if (
      result['android.permission.ACCESS_FINE_LOCATION'] !== 'granted' &&
      result['android.permission.ACCESS_COARSE_LOCATION'] !== 'granted'
    ) {
      throw new Error('Location permission was not granted.');
    }
  } else {
    Geolocation.setRNConfiguration({
      skipPermissionRequests: false,
      authorizationLevel: 'whenInUse',
      enableBackgroundLocationUpdates: false,
    });
    await new Promise<void>((resolve, reject) =>
      Geolocation.requestAuthorization(resolve, reject),
    );
  }
  const fix = (
    enableHighAccuracy: boolean,
    timeout: number,
  ): Promise<CaptureLocation> =>
    new Promise((resolve, reject) =>
      Geolocation.getCurrentPosition(
        position =>
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            timestamp: position.timestamp,
          }),
        reject,
        { enableHighAccuracy, timeout, maximumAge: 0 },
      ),
    );
  try {
    return await fix(true, 12000);
  } catch (error) {
    // GPS can fail indoors. Try a fresh network fix, retaining its actual accuracy.
    if ((error as { code?: number }).code === 1) {
      throw error;
    }
    return fix(false, 8000);
  }
}
