Restore the simple phone + device identifier authentication contract used by the NWASH mobile app. The product decision is explicit: no OTP, email/password UI, SMS provider or deviceCredential requirement for this mobile flow. The recently implemented verified-enrollment-only routes return 403 for this client and must be changed to match the contract below. Do not enable a development bypass silently; implement this as the intended configured authentication policy.

All paths use /api/v1/auth.

POST /signup
{
  "fullName": "Sam Example",
  "phoneNumber": "+9779812345678",
  "address": "Kathmandu",
  "device": {
    "platform": "android",
    "identifierType": "android_id",
    "identifier": "1234567890abcdef"
  }
}

POST /login
{
  "phoneNumber": "+9779812345678",
  "device": {
    "platform": "ios",
    "identifierType": "idfv",
    "identifier": "12345678-1234-1234-1234-123456789abc"
  }
}

Both successful endpoints return an immediate session, not a verification challenge:
{
  "accessToken": "...",
  "tokenType": "Bearer",
  "expiresIn": 3600,
  "refreshToken": "...",
  "user": {
    "id": "stable-existing-user-uuid",
    "fullName": "Sam Example",
    "phoneNumber": "+9779812345678",
    "address": "Kathmandu"
  }
}

The mobile app reads the platform identifier automatically for every signup/login request and fails locally if it is unavailable. Android ID is scoped to signing key, device and OS user; iOS IDFV may change after all vendor apps are removed. These are spoofable recognition signals. Accepting them as the sole login factor is the product's chosen security tradeoff; do not describe it as verified phone ownership.

Implement signup by validating and normalizing the phone, trimmed full name (1–100 characters), trimmed address (1–500), and matching platform/identifier type. Create the user and initial device binding atomically. Use a unique normalized phone constraint and return 409 for duplicate signup. Do not mark a phone SMS-verified. Do not create another account or overwrite a binding when an existing phone signs up again.

Implement login by matching the normalized phone and the stored device binding. Issue a bearer session only for a matching active binding. Unknown/mismatched/revoked bindings return generic 401 or 403. Do not require OTP, an SMS sender or deviceCredential. Never silently attach a new device from login input. Changed/lost devices go through support; there is no automatic reassignment or account merge.

Retain versioned keyed HMAC storage for identifiers, TLS, sensible rate limiting, revocation and bearer-session validation for protected endpoints. Keep authentication request bodies, identifiers and tokens out of logs. Preserve existing user UUIDs, report ownership and attachment storage. Never merge by name/address or invent phone values for existing users. Any legacy account migration remains a separate explicit process.

Mobile behavior: see [phone-auth.md](phone-auth.md) for the implemented client. It now stores access/refresh tokens securely, serializes refresh rotation, invokes server logout, exposes a separate Forget this device action and shows read-only profile details. Phone number is mandatory at signup; there is no separate phone-linking flow in the app. Return expiresIn and refreshToken along with the access token in all session responses. No OTP or deviceCredential is submitted.

Error contract: 400 invalid input, 401 authentication failure, 403 unrecognized/unauthorized device, 409 duplicate signup, 429 throttling, 503 service unavailable. Include automated tests for signup/login success without OTP, duplicate races, unknown devices, shared devices with separate phone accounts, unavailable/reset identifiers, revoked bindings, bearer authorization, and preservation of existing account IDs and issue data. Document any remaining deployment configuration and migration steps.
