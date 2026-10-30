# NWASH

React Native 0.88.1 with React 19.3 and TypeScript. Android development is configured for a physical USB phone.

## Run on your phone

Enable Developer options and USB debugging on an Android 7.0+ phone. Connect with a data-capable USB cable, unlock it, and approve the USB debugging prompt.

```bash
cd /home/ghost/CyberLothse/MobApp
source scripts/env.sh
adb devices -l
npm start
```

Leave Metro running. In another terminal:

```bash
cd /home/ghost/CyberLothse/MobApp
npm run android
```

The Android command requires an authorized USB device, forwards port 8081, builds for its CPU architecture, installs the app, and launches it. It does not start an emulator. If several phones are connected, use `ANDROID_SERIAL=<serial> npm run android`.

If the phone is missing from both `adb devices -l` and `lsusb`, reconnect it, try another data cable/USB port, and select File transfer on the phone. If ADB shows `unauthorized`, approve the prompt on the phone.

## Installed tools

- Node 24.22.1 and npm: `/opt/node24`
- Temurin JDK 17: `/opt/jdk17`
- Android SDK: `/home/ghost/Android/Sdk`
- SDK platform 37, Build Tools 36.0.0 and 37.0.0, Platform Tools, NDK 27.1.12297006, CMake 3.22.1
- Linux Android USB udev rules

`scripts/env.sh` configures the tools for project commands. The environment is also added to this user's `.bashrc` and `.profile`. Android Studio and an emulator are unnecessary for this command-line workflow.

## Commands

```bash
npm run lint
npx tsc --noEmit
npm test -- --runInBand
npm run build:android
```

The standalone debug build targets arm64 Android phones and writes `android/app/build/outputs/apk/debug/app-debug.apk`. For a connected phone, `npm run android` selects its actual architecture. Debug builds need Metro running to load JavaScript.

Run `bash setup-react-native.sh` to reinstall JavaScript dependencies from the lockfile. Edit `App.tsx` to start developing. iOS project files are included; iOS builds require macOS and Xcode.

## Authentication

Email/password login and signup open Home after a successful API response. Signup requires a password of at least 8 characters. Successful sign-in is remembered securely so the workspace opens offline after restarting. Sign out removes the remembered account; saved issues remain. Passwords are never stored. The backend is required; there is no mock account.

Give [docs/BACKEND_PROMPT.md](docs/BACKEND_PROMPT.md) to the Codex building the API server. It defines endpoints, exact JSON responses, account seeding, and backend tests.

The client API URL is in `src/api/auth.ts`, initially `http://127.0.0.1:8000/api/v1`. Run your backend on port 8000 on this computer. `npm run android` forwards both Metro (8081) and the API (8000) to the USB phone. If the app is already installed, run `adb reverse tcp:8000 tcp:8000` after reconnecting the phone. Use an HTTPS URL for a deployed backend. Production Android builds block plain HTTP.

Login uses email and password. Signup collects full name, email, password, and confirm password. Passwords must match; confirmation stays on the client. The backend must implement POST /api/v1/auth/signup with the session response described in the backend prompt.

## Issue capture

Home now contains **New issue** and the issues saved on this phone. An issue needs at least one camera photo, recorded voice note, or text description. Photos support preview/removal; recordings support playback/removal. Capture location at the top of the editor saves the device location independently of photos. Use Update to capture it again. Drafts and media stay in private mobile storage across restarts, separated by signed-in account.

**Save issue** queues it locally. Pending issues upload automatically from Home when signed in and the server is reachable. **Upload issue / Retry upload** inside the issue remains available for manual attempts. See [docs/ISSUE_FRONTEND.md](docs/ISSUE_FRONTEND.md) for storage behavior, the model for future upload, permission handling, and device checks. Rebuild with `npm run android` after installing the new native dependencies; Metro refresh alone cannot load them.

## Offline access

Choose **Continue offline** on the login screen to capture issues without an account or internet connection. Guest Home has a **Sign in** action. After online login or signup, guest drafts and media transfer automatically to that account. Transfer failures preserve originals and offer Retry transfer.

Remembered accounts reopen without contacting the server, even if their access token has expired. Offline workspace access does not authorize server requests; online reauthentication is required when a server rejects credentials. No upload or refresh-token endpoint is introduced. Session identity and access tokens use native secure storage; passwords are never saved. Explicit sign-out clears the remembered account without deleting drafts.

This version adds a native secure-storage dependency: rebuild Android with `npm run android`. On a Mac, install iOS pods before rebuilding in Xcode.

## Uploading

Account users can upload an issue from its editor or let pending issues upload automatically from Home. Guests choose Sign in to upload. Progress and Cancel upload are available. A 401 offers Sign in to upload while preserving offline workspace access; Back to workspace returns without authenticating.

The first attempted upload freezes the metadata and makes that issue read-only, preserving the exact snapshot and media for retries. Acknowledged issues appear under Sent and retain their local files and separate server ids. This backend has no update API; uploading an edited version under the same id is not supported. On timeouts or network failures, Retry upload sends the same snapshot. Retry-After is respected for rate limits. Automatic uploads run while Home is open in the foreground, after saving, after returning to the app, and at 15-second intervals. Temporary failures use increasing retry delays (up to five minutes); rate limits respect Retry-After. Going to the background cancels active requests safely. Full operating-system background uploading is not enabled. Content/format errors require a manual attempt or correction; 401 pauses this session until sign-in. Cancelling an automatic upload suppresses it for this workspace session; the issue’s manual retry remains available.

Client limits match server defaults: 20 photos, 10 recordings, 15 MiB per photo, 30 MiB per recording, 200 MiB total, and 128 KiB metadata. Live contract checks created an isolated integration-check account/report and verified 201, identical 200 replay, and 409 conflict without modifying existing reports.
# NWASH_APP
