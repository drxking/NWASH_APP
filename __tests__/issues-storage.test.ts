import FS from 'react-native-fs';
import {
  startLocationTask,
  finishLocationTask,
} from '../src/issues/locationTasks';
import { createIssue, hasContent } from '../src/issues/model';
import { issuePath, listIssues, saveIssue } from '../src/issues/storage';

jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/documents',
  mkdir: jest.fn(),
  exists: jest.fn(),
  writeFile: jest.fn(),
  moveFile: jest.fn(),
  readDir: jest.fn(),
  readFile: jest.fn(),
  unlink: jest.fn(),
}));
const fs = jest.mocked(FS);
let files: Map<string, string>;
beforeEach(() => {
  jest.clearAllMocks();
  files = new Map();
  fs.exists.mockImplementation(async path => files.has(path));
  fs.writeFile.mockImplementation(async (path, data) => {
    files.set(path, data);
  });
  fs.readFile.mockImplementation(async path => {
    if (!files.has(path)) {
      throw new Error('Missing');
    }
    return files.get(path)!;
  });
  fs.unlink.mockImplementation(async path => {
    files.delete(path);
  });
  fs.moveFile.mockImplementation(async (from, to) => {
    if (files.has(to)) {
      throw new Error('Destination exists');
    }
    files.set(to, files.get(from)!);
    files.delete(from);
  });
});

test('requires any one type of evidence', () => {
  const issue = createIssue('owner');
  expect(hasContent(issue)).toBe(false);
  expect(hasContent({ ...issue, description: '   ' })).toBe(false);
  expect(hasContent({ ...issue, description: 'Broken pipe' })).toBe(true);
  const attachment = { id: 'a', file: 'a.jpg', createdAt: issue.createdAt };
  expect(hasContent({ ...issue, photos: [attachment] })).toBe(true);
  expect(hasContent({ ...issue, audio: [attachment] })).toBe(true);
});

test('serializes writes and replaces existing manifests on both platforms', async () => {
  const issue = createIssue('owner');
  await Promise.all([
    saveIssue({ ...issue, description: 'old' }),
    saveIssue({ ...issue, description: 'latest' }),
  ]);
  expect(
    JSON.parse(files.get(`${issuePath(issue)}/issue.json`)!).description,
  ).toBe('latest');
  expect(files.has(`${issuePath(issue)}/issue.tmp`)).toBe(false);
});

test('restores drafts and media references after restart; scopes by owner', async () => {
  const issue = {
    ...createIssue('owner'),
    photos: [{ id: 'photo', file: 'photo.jpg', createdAt: 'now' }],
  };
  await saveIssue(issue);
  files.set('/documents/issues-v1/owner', 'directory');
  fs.readDir.mockResolvedValue([
    { path: issuePath(issue), name: issue.id, isDirectory: () => true },
  ] as never);
  expect((await listIssues('owner'))[0].photos[0].file).toBe('photo.jpg');
  expect(await listIssues('another-owner')).toEqual([]);
});

test('recovers a completed temp snapshot after an interrupted replacement', async () => {
  const issue = { ...createIssue('owner'), locationStatus: 'pending' as const };
  files.set('/documents/issues-v1/owner', 'directory');
  files.set(`${issuePath(issue)}/issue.tmp`, JSON.stringify(issue));
  fs.readDir.mockResolvedValue([
    { path: issuePath(issue), name: issue.id, isDirectory: () => true },
  ] as never);
  expect((await listIssues('owner'))[0].locationStatus).toBe('unavailable');
});

test('reports unreadable drafts rather than silently dropping them', async () => {
  const issue = createIssue('owner');
  files.set('/documents/issues-v1/owner', 'directory');
  files.set(`${issuePath(issue)}/issue.json`, '{incomplete');
  fs.readDir.mockResolvedValue([
    { path: issuePath(issue), name: issue.id, isDirectory: () => true },
  ] as never);
  await expect(listIssues('owner')).rejects.toThrow('could not be read');
});

test('issue positions stay fixed after edits and directory enumeration changes', async () => {
  const first = {
    ...createIssue('owner'),
    id: 'first',
    createdAt: '2026-10-28T01:00:00.000Z',
    updatedAt: '2026-10-28T02:00:00.000Z',
  };
  const second = {
    ...createIssue('owner'),
    id: 'second',
    createdAt: '2026-10-28T02:00:00.000Z',
    updatedAt: '2026-10-28T03:00:00.000Z',
  };
  await saveIssue(first);
  await saveIssue(second);
  files.set('/documents/issues-v1/owner', 'directory');
  const entries = [second, first].map(issue => ({
    path: issuePath(issue),
    name: issue.id,
    isDirectory: () => true,
  }));
  fs.readDir.mockResolvedValue(entries as never);
  expect((await listIssues('owner')).map(issue => issue.id)).toEqual([
    'second',
    'first',
  ]);
  await saveIssue({
    ...first,
    description: 'Edited',
    status: 'pending_upload',
    updatedAt: '2026-10-28T20:00:00.000Z',
  });
  fs.readDir.mockResolvedValue([...entries].reverse() as never);
  expect((await listIssues('owner')).map(issue => issue.id)).toEqual([
    'second',
    'first',
  ]);
});

test('an interrupted location update restores the previously saved fix', async () => {
  const issue = {
    ...createIssue('owner'),
    locationStatus: 'pending' as const,
    location: { latitude: 27, longitude: 85, accuracy: 10, timestamp: 123 },
  };
  await saveIssue(issue);
  files.set('/documents/issues-v1/owner', 'directory');
  fs.readDir.mockResolvedValue([
    { path: issuePath(issue), name: issue.id, isDirectory: () => true },
  ] as never);
  expect((await listIssues('owner'))[0]).toMatchObject({
    locationStatus: 'captured',
    location: { latitude: 27, longitude: 85 },
  });
});

test('an active first-photo location request stays pending when issues are listed', async () => {
  const issue = {
    ...createIssue('owner'),
    id: 'location-pending',
    locationStatus: 'pending' as const,
  };
  await saveIssue(issue);
  files.set('/documents/issues-v1/owner', 'directory');
  fs.readDir.mockResolvedValue([
    { name: issue.id, path: issuePath(issue), isDirectory: () => true },
  ] as never);
  startLocationTask(issue.ownerId, issue.id);
  try {
    expect((await listIssues('owner'))[0].locationStatus).toBe('pending');
  } finally {
    finishLocationTask(issue.ownerId, issue.id);
  }
  expect((await listIssues('owner'))[0].locationStatus).toBe('unavailable');
});
