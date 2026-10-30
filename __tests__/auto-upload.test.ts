import { canAutoUpload } from '../src/issues/autoUpload';
import { createIssue } from '../src/issues/model';
const pending = { ...createIssue('owner'), status: 'pending_upload' as const };
test('only the owner’s finalized pending issues are eligible', () => {
  expect(canAutoUpload(pending, 'owner')).toBe(true);
  expect(canAutoUpload(pending, 'other')).toBe(false);
  expect(canAutoUpload(createIssue('owner'), 'owner')).toBe(false);
  expect(canAutoUpload({ ...pending, status: 'uploaded' }, 'owner')).toBe(
    false,
  );
  expect(
    canAutoUpload({ ...pending, locationStatus: 'pending' }, 'owner'),
  ).toBe(false);
  expect(
    canAutoUpload({ ...pending, ownerId: 'local-guest-v1' }, 'local-guest-v1'),
  ).toBe(false);
});
test('respects backoff and stops automatically retrying content errors', () => {
  expect(
    canAutoUpload(
      { ...pending, upload: { metadata: '{}', retryAt: Date.now() + 60000 } },
      'owner',
    ),
  ).toBe(false);
  for (const lastStatus of [400, 409, 413, 415]) {
    expect(
      canAutoUpload(
        { ...pending, upload: { metadata: '{}', lastStatus } },
        'owner',
      ),
    ).toBe(false);
  }
  for (const lastStatus of [0, 401, 429, 500, 503]) {
    expect(
      canAutoUpload(
        {
          ...pending,
          upload: { metadata: '{}', lastStatus, retryAt: Date.now() - 1000 },
        },
        'owner',
      ),
    ).toBe(true);
  }
});
