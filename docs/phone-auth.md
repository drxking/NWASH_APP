# NWASH phone + device authentication

The mobile app uses the supplied /api/v1 phone + device contract. Signup asks for full name, a 10-digit Nepal mobile number, and address. Login asks only for the Nepal mobile number. Both forms display a fixed +977 prefix and automatically submit the complete international number. Pasted +977 numbers are accepted without duplicating the prefix; other country prefixes are rejected. There are no OTP, email/password, advertising ID, installation UUID, or device-credential requirements in either flow. Device recognition is not proof of phone ownership.

Each signup/login call re-reads Android Settings.Secure.ANDROID_ID through the installed RNDeviceInfo native module, or actual UIDevice.identifierForVendor through ios/MobApp/DeviceIdentity.mm. Neither reader falls back to another identifier. Missing, malformed or all-zero identifiers stop the call locally. The iOS reader runs on the main queue and rejects an unavailable IDFV.

API endpoints:

- POST /auth/signup: {fullName, phoneNumber, address, device}; expects 201.
- POST /auth/login: {phoneNumber, device}; expects 200.
- POST /auth/refresh: {refreshToken}; expects 200 with replacement tokens.
- POST /auth/logout: bearer session; expects 204. Keeps the backend device binding.
- POST /auth/forget-device: bearer session; expects 204. Separate confirmation in Account; never silently re-enrolls.

All session responses must include accessToken, refreshToken, tokenType Bearer, positive expiresIn and user.id. Phone signup/login also require fullName, phoneNumber and address in user. The app uses the stable server user.id as owner. Legacy stored offline sessions remain readable but cannot gain server access without valid bearer authorization.

Sessions are persisted as one Keychain/Keystore record, with WHEN_UNLOCKED_THIS_DEVICE_ONLY on iOS. Android backups are disabled in the existing manifest. Refresh is serialized across callers; the old refresh token is removed from secure storage before it can be submitted. Both replacement tokens are saved together. A timeout, malformed response, storage failure or server rejection requires login rather than replaying a potentially consumed token. Expired offline sessions still open local drafts. Uploads refresh before sending and retry at most once after 401, retaining the original owner, metadata, files and idempotency key. Generic private API/media fetches should use authenticatedFetch from src/api/tokens.ts; the current media viewer reads local files and has no remote private attachment fetch path.

Account displays the registered name, mandatory phone number and address, with sign out and a separately confirmed Forget this device action. Ordinary logout tries server revocation and always clears the local session if storage is available. If revocation is unconfirmed, the UI explicitly reports local logout and the unconfirmed server state. Forget-device leaves the local session in place on failure so it never falsely reports that the binding was revoked.

400 shows input guidance; 401 requests login; 403 directs users to support without registration/rebinding; duplicate signup offers Sign in. 429 honors Retry-After seconds or HTTP-date and prevents early resubmission, including a visible countdown. 503/network failures show retryable messages. Guest/offline work remains available during auth cooldowns.

Drafts and attachments remain in their original owner directories. Token refresh never transfers issues. The existing anonymous guest-transfer journal is preserved and refuses a target UUID different from its original target. No account-to-account merge or phone backfill is performed.

## Deployment and native verification

- src/api/auth.ts currently contains the existing LAN HTTP development URL. Replace API_BASE_URL with the deployed HTTPS /api/v1 URL before release. Release builds reject HTTP auth, upload and authenticatedFetch requests. No tokens or raw device IDs are logged by this implementation.
- Android uses the already installed/autolinked react-native-device-info and react-native-keychain dependencies. Rebuild the native app after dependency changes. No identifier permission prompt is required by this implementation. Debug Gradle assembly has been verified in this workspace.
- iOS: run pod install in ios on macOS after installing npm dependencies, then build/test in Xcode. DeviceIdentity.mm is already included in the app target. Confirm actual IDFV behavior on an unlocked physical iPhone. iOS compilation and live backend integration are not verified by Linux/Jest testing.
- Do not add request-body/header capture to proxy, APM or analytics for authentication routes. Backend availability, binding recovery and deployed credentials remain server responsibilities.
