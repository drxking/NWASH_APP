import { Issue } from './model';
import { API_BASE_URL } from '../api/auth';
export function canAutoUpload(issue: Issue, ownerId: string, now = Date.now()) {
  if (
    issue.ownerId !== ownerId ||
    ownerId === 'local-guest-v1' ||
    issue.status !== 'pending_upload' ||
    issue.locationStatus === 'pending'
  ) {
    return false;
  }
  if (issue.upload?.retryAt && issue.upload.retryAt > now) {
    return false;
  }
  return (
    !issue.upload?.lastStatus ||
    issue.upload.lastStatus === 401 ||
    issue.upload.lastStatus === 429 ||
    issue.upload.lastStatus >= 500
  );
}
export async function serverReachable() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(`${API_BASE_URL}/ready`, {
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
