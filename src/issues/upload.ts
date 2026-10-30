import FS from 'react-native-fs';
import { API_BASE_URL, Session, ApiError, requireSecureApi } from '../api/auth';
import { validSession } from '../api/tokens';
import { hasContent, Issue } from './model';
import { mediaPath, mediaUri, saveIssue } from './storage';
export class UploadError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}
const running = new Set<string>();
export function metadataFor(issue: Issue) {
  return {
    clientIssueId: issue.id,
    clientCreatedAt: issue.createdAt,
    clientUpdatedAt: issue.updatedAt,
    description: issue.description,
    locationStatus: issue.locationStatus,
    ...(issue.locationStatus === 'captured'
      ? {
          location: issue.location,
          ...(issue.locationSource
            ? { locationSource: issue.locationSource }
            : {}),
        }
      : {}),
    attachments: [
      ...issue.photos.map(item => ({
        clientAttachmentId: item.id,
        kind: 'photo',
        createdAt: item.createdAt,
      })),
      ...issue.audio.map(item => ({
        clientAttachmentId: item.id,
        kind: 'audio',
        createdAt: item.createdAt,
        ...(item.durationMs === undefined
          ? {}
          : { durationMs: item.durationMs }),
      })),
    ],
  };
}
function mime(file: string) {
  const extension = file.split('.').pop()?.toLowerCase();
  const types: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    heic: 'image/heic',
    heif: 'image/heif',
    m4a: 'audio/mp4',
    mp4: 'audio/mp4',
  };
  if (!extension || !types[extension]) {
    throw new UploadError('Unsupported attachment format.');
  }
  return types[extension];
}
export async function uploadIssue(
  issue: Issue,
  session: Session,
  progress: (value: number) => void,
  registerCancel?: (cancel: (() => void) | null) => void,
): Promise<Issue> {
  if (!session.accessToken || session.user.id === 'local-guest-v1') {
    throw new UploadError(
      'Sign in online to upload. Guest issues are kept on this phone.',
      401,
    );
  }
  if (issue.ownerId !== session.user.id) {
    throw new UploadError('This issue belongs to another account.');
  }
  if (issue.status === 'uploaded') {
    return issue;
  }
  if (running.has(issue.id)) {
    throw new UploadError('This issue is already uploading.');
  }
  if (
    issue.upload?.retryAt &&
    Date.now() < issue.upload.retryAt &&
    (issue.upload.lastStatus === 429 || issue.upload.lastStatus === undefined)
  ) {
    throw new UploadError('Please wait before retrying this upload.', 429);
  }
  if (!hasContent(issue) || issue.locationStatus === 'pending') {
    throw new UploadError(
      'Add evidence and finish location capture before uploading.',
    );
  }
  running.add(issue.id);
  let frozen = issue;
  let cancelled = false;
  let cancelRequest: (() => void) | null = null;
  registerCancel?.(() => {
    cancelled = true;
    cancelRequest?.();
  });
  try {
    const all = [...issue.photos, ...issue.audio];
    if (issue.photos.length > 20 || issue.audio.length > 10) {
      throw new UploadError(
        'Maximum 20 photos and 10 voice notes per issue.',
        413,
      );
    }
    let total = 0;
    for (const item of all) {
      const size = Number((await FS.stat(mediaPath(issue, item.file))).size);
      const photo = issue.photos.some(p => p.id === item.id);
      if (!size || size > (photo ? 15 : 30) * 1024 * 1024) {
        throw new UploadError(
          photo
            ? 'Photos must be between 1 byte and 15 MiB.'
            : 'Voice notes must be between 1 byte and 30 MiB.',
          413,
        );
      }
      total += size;
      mime(item.file);
    }
    const metadata =
      issue.upload?.metadata || JSON.stringify(metadataFor(issue));
    if (
      encodeURIComponent(metadata).replace(/%[A-F\d]{2}/gi, 'x').length >
        128 * 1024 ||
      total + metadata.length + all.length * 1024 > 200 * 1024 * 1024
    ) {
      throw new UploadError(
        'This issue exceeds the server upload size limit.',
        413,
      );
    }
    frozen = {
      ...issue,
      status: 'pending_upload',
      upload: {
        ...issue.upload,
        metadata,
        retryAt: undefined,
        lastStatus: undefined,
        attempts: (issue.upload?.attempts || 0) + 1,
        error: undefined,
      },
    };
    await saveIssue(frozen); // Persist before sending: retries must use exactly this metadata and these files.
    const form = new FormData();
    form.append('metadata', metadata);
    for (const item of all) {
      form.append(`media:${item.id}`, {
        uri: mediaUri(issue, item.file),
        name: item.file,
        type: mime(item.file),
      } as unknown as Blob);
    }
    let authorized = await validSession(session);
    requireSecureApi();
    const send = (token: string) =>
      new Promise<{
        status: number;
        body: string;
        retry: string | null;
      }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        if (cancelled) {
          reject(new UploadError('Upload interrupted. Retry when online.'));
          return;
        }
        cancelRequest = () => xhr.abort();
        xhr.open('POST', `${API_BASE_URL}/issues`);
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.setRequestHeader('Idempotency-Key', issue.id);
        xhr.setRequestHeader('Accept', 'application/json');
        xhr.timeout = 600000;
        xhr.upload.onprogress = event => {
          if (event.lengthComputable) {
            progress(
              Math.min(99, Math.round((event.loaded / event.total) * 100)),
            );
          }
        };
        xhr.onload = () =>
          resolve({
            status: xhr.status,
            body: xhr.responseText,
            retry: xhr.getResponseHeader('Retry-After'),
          });
        xhr.onerror = () =>
          reject(
            new UploadError(
              'Connection failed. Your issue is safe. Retry when online.',
            ),
          );
        xhr.ontimeout = () =>
          reject(
            new UploadError(
              'Upload timed out. Retry the same issue when online.',
            ),
          );
        xhr.onabort = () =>
          reject(new UploadError('Upload interrupted. Retry when online.'));
        xhr.send(form);
      });
    let response = await send(authorized.accessToken);
    if (response.status === 401) {
      authorized = await validSession(authorized, true);
      response = await send(authorized.accessToken);
    }
    if (response.status !== 200 && response.status !== 201) {
      if (response.status === 429) {
        const seconds = Number(response.retry);
        frozen.upload!.retryAt =
          response.retry && Number.isFinite(seconds)
            ? Date.now() + Math.max(0, seconds) * 1000
            : Math.max(
                Date.now() + 60000,
                Date.parse(response.retry || '') || 0,
              );
      }
      const messages: Record<number, string> = {
        400: 'Server rejected the issue. Keep it and check its contents.',
        401: 'Sign in again online before uploading. Your issues are safe.',
        403: 'This device is unrecognized or revoked. Contact support. Your issues are safe.',
        409: 'This issue differs from the server snapshot. It has been kept locally; do not retry with changed contents.',
        413: 'This issue exceeds the server upload limits.',
        415: 'An attachment format was rejected by the server.',
        429: 'Too many uploads. Retry after the waiting period.',
        500: 'Server error. Retry later.',
        503: 'Server unavailable. Retry later.',
      };
      throw new UploadError(
        messages[response.status] ||
          'Upload failed. Your files are safe. Retry later.',
        response.status,
      );
    }
    let data;
    try {
      data = JSON.parse(response.body);
    } catch {
      throw new UploadError(
        'Invalid server acknowledgement. Retry the same issue.',
      );
    }
    const server = data.issue;
    if (
      !server?.id ||
      server.clientIssueId !== issue.id ||
      !Array.isArray(server.attachments) ||
      server.attachments.length !== all.length ||
      !all.every(item =>
        server.attachments.some(
          (a: { id?: string; clientAttachmentId?: string }) =>
            a.id && a.clientAttachmentId === item.id,
        ),
      )
    ) {
      throw new UploadError(
        'Incomplete server acknowledgement. Your files are kept for retry.',
      );
    }
    const done: Issue = {
      ...frozen,
      status: 'uploaded',
      upload: {
        metadata,
        serverIssueId: server.id,
        attachments: server.attachments,
        uploadedAt: new Date().toISOString(),
      },
    };
    await saveIssue(done);
    progress(100);
    return done;
  } catch (failure) {
    const error =
      failure instanceof ApiError
        ? new UploadError(failure.message, failure.status)
        : failure;
    if (frozen.upload) {
      const status = error instanceof UploadError ? error.status : undefined;
      frozen.upload.lastStatus = status || 0;
      if (!status || status >= 500) {
        frozen.upload.retryAt =
          Date.now() +
          Math.min(
            300000,
            15000 * 2 ** Math.min(frozen.upload.attempts || 1, 5),
          );
      }
      frozen = {
        ...frozen,
        upload: {
          ...frozen.upload,
          error: error instanceof Error ? error.message : 'Upload failed',
        },
      };
      await saveIssue(frozen);
    }
    throw error;
  } finally {
    registerCancel?.(null);
    running.delete(issue.id);
  }
}
