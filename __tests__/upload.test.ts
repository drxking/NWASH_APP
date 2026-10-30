import FS from 'react-native-fs';
import { remember } from '../src/api/tokens';
import { uploadIssue, metadataFor } from '../src/issues/upload';
import { createIssue } from '../src/issues/model';
import { saveIssue } from '../src/issues/storage';
jest.mock('react-native-fs', () => ({
  stat: jest.fn(async () => ({ size: 1000 })),
}));
jest.mock('../src/issues/storage', () => ({
  saveIssue: jest.fn(async () => {}),
  mediaPath: (_issue: unknown, file: string) => `/docs/${file}`,
  mediaUri: (_issue: unknown, file: string) => `file:///docs/${file}`,
}));
let response: { status: number; body: object; retry?: string };
let sent: object;
let headers: Record<string, string>;
const originalXHR = globalThis.XMLHttpRequest;
const testGlobals = globalThis as unknown as { FormData: typeof FormData };
const originalFormData = testGlobals.FormData;
const account = {
  accessToken: 'token',
  user: { id: 'owner', email: 'a@example.com' },
};
const draft = () => ({ ...createIssue('owner'), description: 'Broken pipe' });
beforeEach(async () => {
  await remember(account);
  testGlobals.FormData = jest.requireActual(
    'react-native/Libraries/Network/FormData',
  ).default;
  jest.clearAllMocks();
  headers = {};
  globalThis.XMLHttpRequest = class {
    upload = {};
    status = 0;
    responseText = '';
    onload = () => {};
    onerror = () => {};
    open() {}
    setRequestHeader(key: string, value: string) {
      headers[key] = value;
    }
    getResponseHeader() {
      return response.retry || null;
    }
    send(body: object) {
      sent = body;
      this.status = response.status;
      this.responseText = JSON.stringify(response.body);
      if (!response.status) {
        this.onerror();
      } else {
        this.onload();
      }
    }
  } as unknown as typeof XMLHttpRequest;
});
afterAll(() => {
  globalThis.XMLHttpRequest = originalXHR;
  testGlobals.FormData = originalFormData;
});
test('wire metadata excludes ownership, local paths, title, and waveform', () => {
  const issue = {
    ...draft(),
    audio: [
      {
        id: 'audio',
        file: 'voice.m4a',
        createdAt: 'now',
        durationMs: 1000,
        waveform: [1],
      },
    ],
  };
  const metadata = metadataFor(issue);
  expect(metadata).not.toHaveProperty('ownerId');
  expect(JSON.stringify(metadata)).not.toContain('voice.m4a');
  expect(metadata.attachments[0]).toEqual({
    clientAttachmentId: 'audio',
    kind: 'audio',
    createdAt: 'now',
    durationMs: 1000,
  });
});
test('201 acknowledgement stores server id and preserves local content', async () => {
  const issue = draft();
  response = {
    status: 201,
    body: { issue: { id: 'server', clientIssueId: issue.id, attachments: [] } },
  };
  const done = await uploadIssue(issue, account, jest.fn());
  expect(done.status).toBe('uploaded');
  expect(done.description).toBe(issue.description);
  expect(done.upload?.serverIssueId).toBe('server');
  expect(headers['Idempotency-Key']).toBe(issue.id);
  expect(sent).toBeInstanceOf(FormData);
  expect(saveIssue).toHaveBeenCalledTimes(2);
});
test('401 keeps frozen snapshot for reauthentication and retry', async () => {
  const issue = draft();
  response = { status: 401, body: {} };
  await expect(uploadIssue(issue, account, jest.fn())).rejects.toMatchObject({
    status: 401,
  });
  const frozen = jest.mocked(saveIssue).mock.calls[0][0];
  expect(frozen.upload?.metadata).toBeTruthy();
  response = {
    status: 200,
    body: {
      issue: { id: 'server', clientIssueId: issue.id, attachments: [] },
      replayed: true,
    },
  };
  const done = await uploadIssue(frozen, account, jest.fn());
  expect(done.upload?.metadata).toBe(frozen.upload?.metadata);
});
test('429 persists Retry-After and rejects early retries', async () => {
  const issue = draft();
  response = { status: 429, body: {}, retry: '60' };
  await expect(uploadIssue(issue, account, jest.fn())).rejects.toMatchObject({
    status: 429,
  });
  const frozen = jest.mocked(saveIssue).mock.calls.at(-1)![0];
  expect(frozen.upload!.retryAt).toBeGreaterThan(Date.now());
  await expect(uploadIssue(frozen, account, jest.fn())).rejects.toMatchObject({
    status: 429,
  });
});
test('rejects guest uploads and other accounts without sending', async () => {
  await expect(
    uploadIssue(draft(), { accessToken: '', user: account.user }, jest.fn()),
  ).rejects.toMatchObject({ status: 401 });
  await expect(
    uploadIssue({ ...draft(), ownerId: 'other' }, account, jest.fn()),
  ).rejects.toThrow('another account');
  expect(saveIssue).not.toHaveBeenCalled();
});
test('incomplete acknowledgements never mark issues uploaded', async () => {
  response = {
    status: 201,
    body: { issue: { id: 'server', clientIssueId: 'wrong', attachments: [] } },
  };
  await expect(uploadIssue(draft(), account, jest.fn())).rejects.toThrow(
    'Incomplete',
  );
  expect(jest.mocked(saveIssue).mock.calls.at(-1)![0].status).toBe(
    'pending_upload',
  );
});

test('network failure retains a retryable frozen snapshot', async () => {
  response = { status: 0, body: {} };
  await expect(uploadIssue(draft(), account, jest.fn())).rejects.toThrow(
    'Connection failed',
  );
  expect(
    jest.mocked(saveIssue).mock.calls.at(-1)![0].upload?.metadata,
  ).toBeTruthy();
});

test('media upload uses private file URIs and exact multipart field names', async () => {
  const issue = {
    ...draft(),
    photos: [
      { id: 'photo', file: 'photo.jpg', createdAt: '2026-10-28T12:00:00Z' },
    ],
  };
  response = {
    status: 201,
    body: {
      issue: {
        id: 'server',
        clientIssueId: issue.id,
        attachments: [
          {
            id: 'server-photo',
            clientAttachmentId: 'photo',
            contentPath: '/issues/server/attachments/server-photo/content',
          },
        ],
      },
    },
  };
  const done = await uploadIssue(issue, account, jest.fn());
  const parts = (
    sent as {
      getParts: () => {
        uri?: string;
        type?: string;
        headers: Record<string, string>;
      }[];
    }
  ).getParts();
  const file = parts.find(part => part.uri);
  expect(file?.uri).toBe('file:///docs/photo.jpg');
  expect(file?.headers['content-disposition']).toContain('media:photo');
  expect(done.upload?.attachments?.[0].id).toBe('server-photo');
});

test('oversized photos fail before freezing so the draft can be corrected', async () => {
  jest
    .mocked(FS.stat)
    .mockResolvedValueOnce({ size: 16 * 1024 * 1024 } as never);
  const issue = {
    ...draft(),
    photos: [{ id: 'photo', file: 'p.jpg', createdAt: 'now' }],
  };
  await expect(uploadIssue(issue, account, jest.fn())).rejects.toMatchObject({
    status: 413,
  });
  expect(saveIssue).not.toHaveBeenCalled();
});

test('uploads refresh an expired session and send the replacement bearer without changing ownership', async () => {
  const issue = draft();
  const session = {
    ...account,
    refreshToken: 'before',
    expiresAt: Date.now() - 1000,
  };
  await remember(session);
  const fetch = jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        accessToken: 'replacement',
        refreshToken: 'after',
        expiresIn: 3600,
        tokenType: 'Bearer',
        user: account.user,
      }),
    } as Response);
  response = {
    status: 201,
    body: { issue: { id: 'server', clientIssueId: issue.id, attachments: [] } },
  };
  try {
    const done = await uploadIssue(issue, session, jest.fn());
    expect(headers.Authorization).toBe('Bearer replacement');
    expect(done.ownerId).toBe(account.user.id);
    expect(done.id).toBe(issue.id);
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally {
    fetch.mockRestore();
  }
});

test('rejects uploads belonging to a different account before sending files', async () => {
  const issue = { ...draft(), ownerId: 'another-account' };
  await expect(uploadIssue(issue, account, jest.fn())).rejects.toThrow(
    'belongs to another account',
  );
  expect(saveIssue).not.toHaveBeenCalled();
});
