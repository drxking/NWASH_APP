# Local issue capture

After signing in, choose **New issue**. Take multiple camera photos, record voice notes, and/or enter a description. **Save issue** requires at least one photo, finalized recording, or nonblank description. It returns to Home with a **Pending** issue. This label is a local queue state. Pending account issues upload automatically from foreground Home when the server is reachable. Use the issue’s upload button for manual retry.

Draft text autosaves as it changes. Photos are copied out of the camera cache into the application's private document directory immediately after capture. Audio is recorded to the issue directory and added to the draft when stopped. Recordings stop and are finalized when the app leaves the foreground. Playback stops when leaving the screen or app. Abrupt force termination during a recording may leave an unfinalized file; stop recording before closing the app.

Location starts automatically after the first camera photo is successfully copied and saved. The location card shows progress; it is no longer a capture/update button. GPS runs asynchronously so additional photos and description edits remain usable. Only the first saved photo triggers capture, and later photos do not replace the fix or retry a failed attempt. GPS/network failure preserves every photo and permits saving/uploading without location. Saving locally while GPS is pending is allowed; upload waits until the request finishes. Late callbacks update only their original issue and are abandoned when its workspace unmounts. No photo EXIF data or continuous location tracking is used.


Each account's issues are stored separately under:

`<DocumentDirectory>/issues-v1/<encoded-owner-id>/<issue-id>/`

This folder contains `issue.json`, image files, and `.m4a` audio files. Relative media filenames remain valid if iOS changes the app container path. Serialized writes and a recoverable temporary manifest protect against interrupted metadata replacement. The list shows a storage error rather than silently omitting an unreadable draft. A pending GPS operation becomes unavailable after restart.

Deleting an attachment or issue is explicit and confirmed. Signing out does not delete drafts. Sign back into the same account to see them. Removing app data or uninstalling the app removes local issues; there is no server copy yet. Files are not saved to the public photo gallery. Android backup is disabled; issue directories are excluded from iOS backups.

## Local shape for future upload

See `src/issues/model.ts`:

- `id`: local issue identifier; use as an idempotency key when uploading later.
- `ownerId`: authenticated account id; the future server must derive ownership from authentication.
- `createdAt`, `updatedAt`: ISO timestamps.
- `description`: optional text, up to 10,000 characters in the UI.
- `photos`, `audio`: arrays of attachment ids, relative filenames, creation timestamps, and optional audio duration in milliseconds.
- `location`, `locationStatus`, `locationSource`: location and availability; automatic captures omit `locationSource` because the current backend accepts only `manual` when this optional field is supplied. Existing manual provenance is preserved. `firstPhotoId` records the first saved photo and prevents repeated GPS requests.
- `status`: `draft`, `pending_upload`, or `uploaded`; `upload` retains frozen metadata, retry timing, acknowledgement and server ids.

No credentials or access tokens are stored with issues. Future uploading must send real files plus metadata, preserve files until an acknowledged successful upload, support retries/idempotency, and avoid uploading another account's drafts. Do not mark issues uploaded merely when an upload is started.

## Verify on a device

1. Sign in, create a text-only issue, and save it.
2. Use Capture location, then take two photos and verify the saved coordinates remain unchanged. Taking photos without pressing Capture location must not request location. Canceling the camera must add nothing.
3. Deny location or disable GPS: keep every photo, show location unavailable, and allow local save/upload. Slow GPS must not block photos or typing.
4. Record, stop, play, and remove voice notes. Create an audio-only issue.
5. Reopen a saved issue, change its text, go Back, and reopen it.
6. Restart the app, sign in again, and check media playback and draft persistence.
7. Sign in as a different account and check that the original account's drafts are hidden.
8. Check empty-issue validation, permission denial, insufficient storage, image preview, and delete confirmation.

On iOS run `bundle exec pod install` from `ios` on a Mac, then build with Xcode. Camera, microphone, and foreground location usage descriptions are configured. This Linux session cannot validate the iOS build.

## Voice-note controls

Voice notes use play/pause, a draggable timeline, and elapsed/total timestamps. Seeking an inactive note starts it at the selected point; seeking a paused note keeps it paused. Only one note plays at a time. Leaving the app or editor stops playback.

All voice notes use the same static decorative waveform heights. Playback and scrubbing change the progress fill and timestamps, not the bar heights. The decorative pattern does not represent audio amplitudes. Existing microphone-level metadata is retained for compatibility but is not used for display.

Home offers All, Drafts, Pending, and Sent filters. Pending denotes the local queue waiting for server acknowledgement; Sent denotes acknowledged snapshots.

Issue names display the complete creation date and time (including seconds) in the phone’s locale. The list uses a fixed newest-first creation order with an id tie-breaker; edits, saves, and status changes do not move issues. Descriptions remain editable content and are not used as names.

Upload snapshots become read-only before their first request. Files remain local on success and failure. Upload progress reports bytes sent up to 99%; only validated server acknowledgement advances to 100% and Sent. Requests use bearer auth, the client id as Idempotency-Key, and one metadata field plus media:<attachment-id> binary parts. No ownerId, local status, display name, paths, legacy photo association, or waveform is transmitted.
