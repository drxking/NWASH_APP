#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/env.sh
mapfile -t devices < <(adb devices | awk 'NR > 1 && $2 == "device" && $1 !~ /^emulator-/ {print $1}')
serial="${ANDROID_SERIAL:-}"
if [[ -z "$serial" ]]; then
  if [[ ${#devices[@]} -ne 1 ]]; then
    adb devices -l
    echo "Connect and authorize one USB Android phone, or set ANDROID_SERIAL to select it." >&2
    exit 1
  fi
  serial="${devices[0]}"
fi
if [[ "$serial" == emulator-* ]] || ! printf '%s\n' "${devices[@]}" | grep -Fxq -- "$serial"; then
  echo "Selected device is not an authorized physical Android device: $serial" >&2
  exit 1
fi
if ! adb -s "$serial" get-devpath | grep -q '^usb:'; then
  echo "Selected device is not connected by USB: $serial" >&2
  exit 1
fi
adb -s "$serial" reverse tcp:8081 tcp:8081
adb -s "$serial" reverse tcp:8000 tcp:8000
exec node node_modules/react-native/cli.js run-android --device "$serial" --no-packager --active-arch-only "$@"
