import * as Keychain from 'react-native-keychain';
import FS from 'react-native-fs';
import { remember, restore, transfer, guest } from '../src/api/session';
import { listIssues, saveIssue } from '../src/issues/storage';
import { createIssue } from '../src/issues/model';
jest.mock('react-native-keychain', () => ({
  setGenericPassword: jest.fn(),
  getGenericPassword: jest.fn(),
  resetGenericPassword: jest.fn(),
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device' },
}));
jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/docs',
  exists: jest.fn(),
  readFile: jest.fn(),
  writeFile: jest.fn(),
  mkdir: jest.fn(),
  moveFile: jest.fn(),
  unlink: jest.fn(),
  copyFile: jest.fn(),
  stat: jest.fn(),
  hash: jest.fn(),
}));
jest.mock('../src/issues/storage', () => ({
  listIssues: jest.fn(),
  saveIssue: jest.fn(),
  issuePath: (issue: { ownerId: string; id: string }) =>
    `/docs/${issue.ownerId}/${issue.id}`,
}));
const account = {
  accessToken: 'token',
  user: { id: 'account', email: 'a@example.com' },
};
beforeEach(() => {
  jest.resetAllMocks();
  const files = new Set<string>();
  jest.mocked(FS.exists).mockImplementation(async path => files.has(path));
  jest.mocked(FS.writeFile).mockImplementation(async path => {
    files.add(path);
  });
  jest.mocked(FS.copyFile).mockImplementation(async (_source, path) => {
    files.add(path);
  });
  jest.mocked(FS.moveFile).mockImplementation(async (source, path) => {
    files.delete(source);
    files.add(path);
  });
  jest.mocked(FS.unlink).mockImplementation(async path => {
    files.delete(path);
  });
  jest
    .mocked(FS.stat)
    .mockResolvedValue({ size: 12, isFile: () => true } as never);
  jest.mocked(FS.hash).mockResolvedValue('checksum');
  jest.mocked(listIssues).mockResolvedValue([]);
});
test('restores remembered accounts without network calls', async () => {
  jest
    .mocked(Keychain.getGenericPassword)
    .mockResolvedValue({ password: JSON.stringify(account) } as never);
  await expect(restore()).resolves.toEqual(account);
});
test('secure persistence includes only identity and token', async () => {
  await remember(account);
  const payload = JSON.parse(
    jest.mocked(Keychain.setGenericPassword).mock.calls[0][1],
  );
  expect(payload).toEqual(account);
  expect(payload.password).toBeUndefined();
});
test('transfers media before removing the original guest issue', async () => {
  const issue = {
    ...createIssue(guest.user.id),
    photos: [{ id: 'p', file: 'p.jpg', createdAt: 'now' }],
  };
  jest.mocked(listIssues).mockResolvedValue([issue]);
  await transfer(account);
  expect(FS.copyFile).toHaveBeenCalled();
  expect(saveIssue).toHaveBeenCalledWith(
    expect.objectContaining({ ownerId: 'account', createdAt: issue.createdAt }),
  );
  expect(FS.unlink).toHaveBeenCalledWith(`/docs/${guest.user.id}/${issue.id}`);
});
test('copy failure leaves guest originals intact', async () => {
  const issue = {
    ...createIssue(guest.user.id),
    photos: [{ id: 'p', file: 'p.jpg', createdAt: 'now' }],
  };
  jest.mocked(listIssues).mockResolvedValue([issue]);
  jest.mocked(FS.copyFile).mockRejectedValue(new Error('Storage full'));
  await expect(transfer(account)).rejects.toThrow('Storage full');
  expect(FS.unlink).not.toHaveBeenCalledWith(
    `/docs/${guest.user.id}/${issue.id}`,
  );
});

test('a guest-transfer journal for another account never moves drafts to the current user', async () => {
  jest.mocked(FS.exists).mockResolvedValue(true);
  jest
    .mocked(FS.readFile)
    .mockResolvedValue(JSON.stringify({ target: 'original-account', ids: {} }));
  await expect(transfer(account)).rejects.toThrow(
    'Sign in to the original account',
  );
  expect(FS.copyFile).not.toHaveBeenCalled();
  expect(saveIssue).not.toHaveBeenCalled();
  expect(FS.unlink).not.toHaveBeenCalled();
});

// Model Android's file-only move fallback: directory moves throw EISDIR and
// copying a file requires its destination parent to have been created first.
function transferDisk() {
  const issue = {
    ...createIssue(guest.user.id),
    id: 'guest-draft',
    photos: [{ id: 'p', file: 'p.jpg', createdAt: 'now' }],
  };
  const source = `/docs/${guest.user.id}/${issue.id}`;
  const files = new Map<string, string>([
    [`${source}/p.jpg`, 'photo-content'],
    [`${source}/issue.json`, JSON.stringify(issue)],
  ]);
  const directories = new Set(['/docs', `/docs/${guest.user.id}`, source]);
  const mkdir = (path: string) => {
    const parts = path.split('/').filter(Boolean);
    for (let index = 1; index <= parts.length; index++)
      directories.add(`/${parts.slice(0, index).join('/')}`);
  };
  const parent = (path: string) => path.slice(0, path.lastIndexOf('/'));
  jest
    .mocked(FS.exists)
    .mockImplementation(async path => files.has(path) || directories.has(path));
  jest.mocked(FS.mkdir).mockImplementation(async path => {
    mkdir(path);
  });
  jest.mocked(FS.writeFile).mockImplementation(async (path, contents) => {
    if (!directories.has(parent(path))) throw new Error('ENOENT parent');
    files.set(path, String(contents));
  });
  jest.mocked(FS.readFile).mockImplementation(async path => {
    if (directories.has(path)) throw new Error('EISDIR');
    if (!files.has(path)) throw new Error('ENOENT');
    return files.get(path)!;
  });
  jest.mocked(FS.copyFile).mockImplementation(async (from, to) => {
    if (!directories.has(parent(to))) throw new Error('ENOENT parent');
    if (!files.has(from)) throw new Error('Not a file');
    files.set(to, files.get(from)!);
  });
  jest.mocked(FS.moveFile).mockImplementation(async (from, to) => {
    if (directories.has(from))
      throw new Error('EISDIR: illegal operation on a directory');
    if (!files.has(from)) throw new Error('ENOENT');
    if (!directories.has(parent(to))) throw new Error('ENOENT parent');
    files.set(to, files.get(from)!);
    files.delete(from);
  });
  jest.mocked(FS.stat).mockImplementation(async path => {
    if (!files.has(path) && !directories.has(path)) throw new Error('ENOENT');
    return {
      size: files.get(path)?.length || 0,
      isFile: () => files.has(path),
      isDirectory: () => directories.has(path),
    } as never;
  });
  jest.mocked(FS.hash).mockImplementation(async path => {
    if (!files.has(path)) throw new Error('Not a file');
    return files.get(path)!;
  });
  jest.mocked(FS.unlink).mockImplementation(async path => {
    for (const key of files.keys())
      if (key === path || key.startsWith(`${path}/`)) files.delete(key);
    for (const key of directories)
      if (key === path || key.startsWith(`${path}/`)) directories.delete(key);
  });
  jest
    .mocked(listIssues)
    .mockImplementation(async () => (directories.has(source) ? [issue] : []));
  jest.mocked(saveIssue).mockImplementation(async saved => {
    const path = `/docs/${saved.ownerId}/${saved.id}`;
    mkdir(path);
    files.set(`${path}/issue.json`, JSON.stringify(saved));
  });
  return {
    issue,
    source,
    files,
    directories,
    mkdir,
    destination: `/docs/${account.user.id}/${issue.id}`,
    stage: `/docs/transfer-${issue.id}`,
  };
}

test('transfers into a new account directory without ever moving a directory as a file', async () => {
  const disk = transferDisk();
  await transfer(account);
  expect(disk.files.get(`${disk.destination}/p.jpg`)).toBe('photo-content');
  expect(
    JSON.parse(disk.files.get(`${disk.destination}/issue.json`)!),
  ).toMatchObject({ ownerId: account.user.id, id: disk.issue.id });
  expect(disk.directories.has(disk.source)).toBe(false);
  for (const [source] of jest.mocked(FS.moveFile).mock.calls)
    expect(source).toBe('/docs/guest-transfer.json.tmp');
});

test('resumes the existing EISDIR staging directory and repairs same-size corrupted copies', async () => {
  const disk = transferDisk();
  disk.mkdir(disk.stage);
  disk.mkdir(disk.destination);
  disk.files.set(
    '/docs/guest-transfer.json',
    JSON.stringify({
      target: account.user.id,
      ids: { [disk.issue.id]: disk.issue.id },
    }),
  );
  disk.files.set(`${disk.stage}/p.jpg`, 'wrong-content');
  disk.files.set(`${disk.destination}/p.jpg`, 'wrong-content');
  await transfer(account);
  expect(disk.files.get(`${disk.destination}/p.jpg`)).toBe('photo-content');
  expect(disk.directories.has(disk.stage)).toBe(false);
  expect(disk.files.has('/docs/guest-transfer.json')).toBe(false);
});

test('an interrupted destination copy keeps guest originals and succeeds on retry', async () => {
  const disk = transferDisk();
  const copy = jest.mocked(FS.copyFile).getMockImplementation()!;
  let interrupted = false;
  jest.mocked(FS.copyFile).mockImplementation(async (from, to, ...options) => {
    if (!interrupted && to === `${disk.destination}/p.jpg`) {
      interrupted = true;
      disk.files.set(to, 'partial');
      throw new Error('Storage interrupted');
    }
    return copy(from, to, ...options);
  });
  await expect(transfer(account)).rejects.toThrow('Storage interrupted');
  expect(disk.files.get(`${disk.source}/p.jpg`)).toBe('photo-content');
  expect(disk.files.has(`${disk.source}/issue.json`)).toBe(true);
  await transfer(account);
  expect(disk.files.get(`${disk.destination}/p.jpg`)).toBe('photo-content');
  expect(disk.directories.has(disk.source)).toBe(false);
});

test('failed destination manifest save never deletes the guest issue', async () => {
  const disk = transferDisk();
  jest.mocked(saveIssue).mockRejectedValueOnce(new Error('Storage full'));
  await expect(transfer(account)).rejects.toThrow('Storage full');
  expect(disk.files.get(`${disk.source}/p.jpg`)).toBe('photo-content');
  expect(disk.files.has(`${disk.source}/issue.json`)).toBe(true);
});

test('repeated retry taps share one transfer and another account cannot join it', async () => {
  transferDisk();
  const first = transfer(account);
  expect(transfer(account)).toBe(first);
  await expect(
    transfer({ accessToken: 'other', user: { id: 'someone-else' } }),
  ).rejects.toThrow('original account');
  await first;
  expect(saveIssue).toHaveBeenCalledTimes(1);
});
