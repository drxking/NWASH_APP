# NWASH backend implementation prompt

You are implementing the backend for NWASH, an offline-first React Native issue-reporting app. Implement working server code, migrations, storage, tests, and developer documentation. Inspect the existing backend first: authentication already works, so extend it without replacing its architecture or breaking accounts. If no backend exists, use TypeScript, Node.js LTS, Express, PostgreSQL, Prisma, and Argon2id. Check official documentation for current compatible dependency versions.

Do not modify the mobile frontend in this task. Deliver an exact API contract and curl examples for the next frontend integration task. Do not stop at a scaffold, plan, or mocked API.

## 1. Actual mobile behavior

- Users can sign up with fullName, email, and password. Password confirmation is validated locally and is not sent.
- Users can sign in with email/password, or choose Continue offline and create guest issues without any server connection.
- Account identity and access tokens are remembered securely. A remembered account can reopen its local workspace even while offline or after its server token expires. This is local access, not authorization to call the server.
- Guest drafts and their media move locally to an account after successful login/signup. The server never accepts a guest token, guest owner id, or anonymous issue upload.
- Each issue accepts multiple camera photos, multiple recorded voice notes, and a text description. At least ONE photo, completed voice note, or nonblank description is required. Location by itself does not satisfy this requirement.
- Location starts automatically after the first photo is saved; subsequent photos do not replace it. It comes from the device, not photo EXIF. It contains coordinates, accuracy in meters, and the device location timestamp. Location is optional; GPS failure must not prevent uploading other evidence.
- Issues and media remain in private phone storage until future upload logic receives a successful server acknowledgement. Uploading is not wired into the current frontend yet.
- Names are the full creation date/time formatted on the phone. Do not name issues using their description, require a title, or store a localized date string as their name.
- Issues are listed newest-created first. Editing, retrying, or uploading must not change their creation order.
- Voice-note waveform bars are decorative and identical for every recording. Do not generate waveforms, transcribe audio, or store display-only amplitude samples.

The existing local model is approximately:

```ts
type Attachment = {
  id: string;
  file: string;                 // local relative filename; never a server path
  createdAt: string;            // ISO 8601
  durationMs?: number;
  waveform?: number[];          // legacy display metadata; omit from upload
};
type Issue = {
  id: string;                   // example: "1793193119352-190i1858"; NOT a UUID
  ownerId: string;              // local identity only; server derives owner from token
  createdAt: string;
  updatedAt: string;
  description: string;
  photos: Attachment[];
  audio: Attachment[];
  status: 'draft' | 'pending_upload'; // device state, not server workflow status
  firstPhotoId?: string;        // legacy; no longer set
  location?: {
    latitude: number;
    longitude: number;
    accuracy: number;
    timestamp: number;         // Unix milliseconds, not seconds
  };
  locationSource?: 'manual';
  locationStatus: 'none' | 'pending' | 'captured' | 'unavailable';
};
```

## 2. Runtime and authentication compatibility

Listen on `0.0.0.0:8000`; prefix routes with `/api/v1`. The current development client uses `http://192.168.1.76:8000/api/v1`; the host IP is environment-specific. USB development can instead use localhost with `adb reverse tcp:8000 tcp:8000`. Production uses HTTPS. Provide `.env.example` and configurable database URL, token configuration, port, upload directory, and request limits. Do not commit secrets or test passwords.

Preserve these routes and response names:

### POST /auth/signup

```json
{"fullName":"Sam Example","email":"sam@example.com","password":"password123"}
```

201 response:

```json
{
  "accessToken":"signed-token",
  "tokenType":"Bearer",
  "expiresIn":3600,
  "user":{"id":"server-user-uuid","email":"sam@example.com","fullName":"Sam Example"}
}
```

Trim fullName; require 1–100 characters and accept Unicode names. Normalize email by trimming and lowercasing. Require passwords of 8–128 characters for new registrations; preserve password bytes exactly. Hash with Argon2id. Handle duplicate normalized emails through a database unique constraint and return 409 EMAIL_EXISTS. Do not impose new signup rules retroactively on login for existing accounts.

### POST /auth/login

Request: `{"email":"sam@example.com","password":"password123"}`.
200 returns the same session shape as signup. Wrong password and unknown email both return 401 INVALID_CREDENTIALS with the same message. Use dummy hash verification for unknown accounts to reduce timing differences.

### GET /auth/me

Bearer token required. Return `{"user":{"id":"...","email":"...","fullName":"..."}}`.

Validate token signature, expiration, issuer, audience, and allowed algorithm. Reject disabled/deleted users. Store secrets in environment configuration and fail startup if essential secrets are missing. Set Cache-Control: no-store on auth responses. Apply rate limits to login/signup by IP and normalized email with Retry-After on 429. Configure trusted proxies explicitly.

No refresh-token or server logout endpoint is required for this stage. Expired credentials return 401; the future mobile uploader must request online sign-in while preserving offline drafts and local access. Do not claim that local sign-out revokes already-issued tokens.

## 3. Issue upload contract

Implement **POST /api/v1/issues** as a single bounded multipart request containing one metadata JSON part and the actual media files. This v1 endpoint creates a complete immutable upload snapshot; updates/deletes after upload are outside this task.

Authentication: `Authorization: Bearer <accessToken>`.
Required header: `Idempotency-Key: <clientIssueId>`; it must equal metadata.clientIssueId.

Multipart field `metadata` contains:

```json
{
  "clientIssueId":"1793193119352-190i1858",
  "clientCreatedAt":"2026-10-28T12:00:00.000Z",
  "clientUpdatedAt":"2026-10-28T12:10:00.000Z",
  "description":"Water leaking beside the road",
  "locationStatus":"captured",
  "locationSource":"manual",
  "location":{
    "latitude":27.67272,
    "longitude":85.34395,
    "accuracy":100,
    "timestamp":1793188800000
  },
  "attachments":[
    {
      "clientAttachmentId":"photo-1",
      "kind":"photo",
      "createdAt":"2026-10-28T12:01:00.000Z"
    },
    {
      "clientAttachmentId":"audio-1",
      "kind":"audio",
      "createdAt":"2026-10-28T12:02:00.000Z",
      "durationMs":9500
    }
  ]
}
```

Each attachment must have exactly one file part named `media:<clientAttachmentId>`, e.g. `media:photo-1` and `media:audio-1`. Match parts by id, not multipart ordering or filename. Reject missing, duplicate, undeclared, or extra parts. Do not accept ownerId, server paths, client-selected storage keys, or server workflow status in metadata.

For text-only issues use attachments: [] and no file parts. For photo/audio-only issues description may be empty. Location must be omitted or null unless captured; accepted final statuses are none, unavailable, and captured. Reject pending location uploads so callers finalize capture first. For captured location require finite coordinates, latitude -90..90, longitude -180..180, nonnegative accuracy, and a valid Unix-millisecond timestamp. Accept omitted locationSource for legacy captures; preserve it as unknown/legacy rather than inventing manual provenance. Ignore no client ownership or privilege field silently: reject unexpected metadata fields with validation errors.

Validate description up to 10,000 characters, parseable timestamps, unique attachment ids, finite nonnegative audio duration, and safe bounded client ids (1–128 ASCII letters/digits/underscore/hyphen). Preserve original device timestamps; store a separate server receivedAt timestamp. Do not reject old offline issues just because they were captured days or months earlier. Device timestamps are client-reported, not proof of event time.

Configurable default limits: 20 photos, 10 audio files, 15 MiB per photo, 30 MiB per audio file, 200 MiB total request, and 128 KiB metadata. Document these limits so the next frontend task can enforce them. Bound streaming uploads before buffering or accepting the entire body.

Accept JPEG, PNG, HEIC/HEIF images and M4A/AAC-in-MP4 audio produced by the phone. Verify file signatures/container contents, not just extensions or MIME headers. Reject empty, malformed, mislabeled, or unsupported files with actionable errors. Treat image/video HEIF brands distinctly. If using a media probing executable, package it in Docker, enforce resource/time limits, and never interpolate user input into shell commands. Do not require image transcoding or audio transcription.

### Success response

201 for the first completed upload; 200 for an identical acknowledged retry. Return this shape:

```json
{
  "issue":{
    "id":"server-issue-uuid",
    "clientIssueId":"1793193119352-190i1858",
    "clientCreatedAt":"2026-10-28T12:00:00.000Z",
    "clientUpdatedAt":"2026-10-28T12:10:00.000Z",
    "receivedAt":"2026-10-29T08:00:00.000Z",
    "description":"Water leaking beside the road",
    "locationStatus":"captured",
    "locationSource":"manual",
    "location":{"latitude":27.67272,"longitude":85.34395,"accuracy":100,"timestamp":1793188800000},
    "attachments":[
      {
        "id":"server-attachment-uuid",
        "clientAttachmentId":"photo-1",
        "kind":"photo",
        "mimeType":"image/jpeg",
        "sizeBytes":123456,
        "sha256":"hexadecimal-digest",
        "createdAt":"2026-10-28T12:01:00.000Z",
        "durationMs":null,
        "contentPath":"/api/v1/issues/server-issue-uuid/attachments/server-attachment-uuid/content"
      }
    ]
  },
  "replayed":false
}
```

The example attachment list is abbreviated; real responses include all files. Do not expose filesystem paths or credentials. A complete successful response is the future client's acknowledgement that it may mark that snapshot uploaded. Never return success before all files and metadata are durable and retrievable.

## 4. Idempotency, concurrency, and recovery

Enforce a database unique constraint on (ownerId, clientIssueId). Scope idempotency to the authenticated account; two accounts may independently use the same client id.

Compute a canonical fingerprint from normalized metadata plus verified file SHA-256 digests sorted by clientAttachmentId. Ignore multipart order, HTTP filenames, and incidental JSON key ordering. The same id and same snapshot must return the existing issue without duplicating rows or files. A different snapshot under the same owner/client id returns 409 ISSUE_CONTENT_CONFLICT; do not silently overwrite evidence. Explain that the future mobile uploader must retain its queued snapshot through retries. Changing an already-uploaded issue requires a separately designed update API later.

Use PostgreSQL constraints/locking to handle concurrent duplicate requests, not in-process memory locks alone. Verify authenticated ownership on every path, including retries.

Use durable filesystem storage behind a storage interface for v1, mounted as a Docker volume outside the public web root. Stage uploads under server-generated temporary names. Coordinate final file promotion and database visibility so incomplete issues are never returned by read APIs. PostgreSQL and filesystem operations are not one shared transaction: explicitly implement and document compensation/recovery for crashes before and after promotion/commit. Provide a cleanup/reconciliation command for abandoned staged files and failed uploads; it must never delete files belonging to committed issues. Preserve committed files across server/container restarts.

## 5. Read and media endpoints

- GET /api/v1/issues: authenticated owner's issues only; cursor pagination with default 20/max 100. Order by clientCreatedAt DESC, id DESC with the cursor using the same pair. Never sort by receivedAt or modification time. Return `{ "issues": [...], "nextCursor": "opaque-or-null" }`.
- GET /api/v1/issues/:id: return `{ "issue": ... }` for the owner.
- GET /api/v1/issues/:issueId/attachments/:attachmentId/content: authenticated owner only. Verify attachment belongs to that issue and owner. Stream bytes with correct Content-Type/Length and support HTTP Range for audio seeking (206, Content-Range, Accept-Ranges; 416 for unsatisfiable ranges). Use private caching, nosniff, and safe server-chosen Content-Disposition filenames. Handle client disconnects without leaking file handles.
- GET /api/v1/health: public `{"status":"ok"}`; expose no secrets.
- GET /api/v1/ready: readiness check for database and storage; return 503 if dependencies are unavailable.

Return 404 for both missing and other users' issues/media. Do not create unauthenticated public media URLs. The mobile player will need bearer headers or authenticated downloads when server playback is integrated.

## 6. Data model and operational requirements

Reuse the existing User table and ids. Add Issue and Attachment tables with foreign keys, indexes for owner/date pagination, and the idempotency uniqueness described above. Keep server UUIDs separate from arbitrary client ids. Store client capture timestamps separately from server received timestamps. Store issue location in typed nullable columns/validated structured data, not a localized string.

Attachment records need server id, issue id, clientAttachmentId (unique within issue), kind, verified MIME type, byte size, SHA-256, generated storage key, capture createdAt, and nullable durationMs. Never trust a client filesystem path. Validate and document how client-reported duration differs from a duration obtained by server probing.

Use versioned forward migrations without dropping existing accounts or evidence. Provide a development seed command using credentials from environment variables; do not overwrite existing passwords. No production auto-seeding.

Use a consistent error envelope:

```json
{"error":{"code":"VALIDATION_ERROR","message":"Invalid request.","details":[]},"requestId":"request-id"}
```

Define and document 400 VALIDATION_ERROR, 401 UNAUTHORIZED/INVALID_CREDENTIALS, 404 NOT_FOUND, 409 EMAIL_EXISTS/ISSUE_CONTENT_CONFLICT, 413 PAYLOAD_TOO_LARGE, 415 UNSUPPORTED_MEDIA_TYPE, 429 RATE_LIMITED, 500 INTERNAL_ERROR, and 503 SERVICE_UNAVAILABLE. Return safe error messages, clean up failed uploads, and include request ids in structured server logs. Never log passwords, tokens, multipart bodies, raw audio, full descriptions, or coordinates. Limit auth JSON bodies and authenticated upload rates. Configure CORS only if a browser client needs it; it is not native-mobile authentication.

## 7. Required tests

Use an isolated real PostgreSQL test database and temporary file-storage directory. Test:

1. Existing login compatibility, signup, email normalization, Unicode names, duplicate emails, incorrect credentials, and expired/invalid/missing tokens.
2. Text-only, one-photo, multi-photo, audio-only, mixed-evidence, and optional-location uploads.
3. Empty/whitespace-only issues, malformed coordinates, seconds-vs-milliseconds timestamp errors, missing/extra/duplicate file parts, and duplicate attachment ids.
4. Size/count limits, MIME spoofing, empty/corrupt media, safe filenames, and no path traversal.
5. Identical retries after lost responses, reordered multipart/JSON metadata, changed-content conflicts, and simultaneous duplicates.
6. Account isolation for lists, detail, media, and retries. Reject guest identities and client-supplied ownership.
7. Newest-created-first pagination with equal timestamps and no movement caused by retry/receipt time. Accept legitimately old offline captures.
8. Audio Range responses, invalid ranges, correct content types, and authenticated media streaming.
9. Disk/storage failures, interrupted multipart requests, failure between file promotion and database commit, restart recovery, and cleanup preserving committed evidence.
10. Missing startup secrets and health/readiness behavior.

Do not replace integration tests with mocked success responses. Report actual commands and results; clearly distinguish implemented, tested, and unverified behavior.

## 8. Deliverables

Deliver source code, migrations, Dockerfile, Docker Compose with PostgreSQL and persistent upload storage, `.env.example`, an OpenAPI specification, and a README with exact setup/start/migrate/test/cleanup commands.

Include working curl examples for login, text-only upload, photo+audio+location multipart upload, identical retry, list pagination, detail, and authenticated audio Range download. Include a compact FRONTEND_INTEGRATION.md mapping the actual local Issue model to the metadata/file contract. Explain error handling: retain local files on failure/timeout/401, retry identical snapshots after network errors, and never upload another account's drafts.

Preserve the working auth contract. Do not add a public issue feed, admin dashboard, maps, reverse geocoding, assignment/status workflows, notifications, anonymous server uploads, or frontend code. Run the server and integration tests and fix failures before handing off.
