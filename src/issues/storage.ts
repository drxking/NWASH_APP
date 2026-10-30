import FS from 'react-native-fs';
import { locationIsActive } from './locationTasks';
import { Issue } from './model';

const root = `${FS.DocumentDirectoryPath}/issues-v1`;
const ownerPath = (ownerId: string) => `${root}/${encodeURIComponent(ownerId)}`;
export const issuePath = (issue: Issue) =>
  `${ownerPath(issue.ownerId)}/${issue.id}`;
export const mediaPath = (issue: Issue, file: string) =>
  `${issuePath(issue)}/${file}`;
export const mediaUri = (issue: Issue, file: string) =>
  `file://${mediaPath(issue, file)}`;
let writes: Promise<unknown> = Promise.resolve();

// Serialize immutable snapshots so an older autosave cannot replace newer edits.
export function saveIssue(issue: Issue): Promise<void> {
  const snapshot = JSON.stringify(issue);
  const folder = issuePath(issue);
  const operation = writes
    .catch(() => {})
    .then(async () => {
      await FS.mkdir(folder, { NSURLIsExcludedFromBackupKey: true });
      await FS.writeFile(`${folder}/issue.tmp`, snapshot, 'utf8');
      // Keep a complete recoverable temp snapshot while replacing the manifest (iOS move does not overwrite).
      if (await FS.exists(`${folder}/issue.json`)) {
        await FS.unlink(`${folder}/issue.json`);
      }
      await FS.moveFile(`${folder}/issue.tmp`, `${folder}/issue.json`);
    });
  writes = operation;
  return operation;
}

export async function listIssues(ownerId: string): Promise<Issue[]> {
  await writes.catch(() => {});
  const path = ownerPath(ownerId);
  if (!(await FS.exists(path))) {
    return [];
  }
  const result: Issue[] = [];
  for (const entry of await FS.readDir(path)) {
    if (!entry.isDirectory()) {
      continue;
    }
    let loaded = false;
    for (const name of ['issue.tmp', 'issue.json']) {
      if (!(await FS.exists(`${entry.path}/${name}`))) {
        continue;
      }
      try {
        const issue: Issue = JSON.parse(
          await FS.readFile(`${entry.path}/${name}`, 'utf8'),
        );
        if (
          issue.ownerId !== ownerId ||
          issue.id !== entry.name ||
          !Array.isArray(issue.photos) ||
          !Array.isArray(issue.audio)
        ) {
          throw new Error('Invalid issue');
        }
        // A process exit while acquiring GPS must not leave the UI waiting forever.
        if (
          issue.locationStatus === 'pending' &&
          !locationIsActive(ownerId, issue.id)
        ) {
          issue.locationStatus = issue.location ? 'captured' : 'unavailable';
        }
        result.push(issue);
        loaded = true;
        break;
      } catch {
        /* Try the recoverable temp snapshot before reporting failure. */
      }
    }
    if (!loaded) {
      throw new Error(
        'A saved issue could not be read. Its files are still on this phone.',
      );
    }
  }
  // Immutable creation order: editing, saving, or changing status never moves a row.
  return result.sort(
    (a, b) =>
      b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
  );
}

export async function copyMedia(
  issue: Issue,
  source: string,
  filename: string,
) {
  await FS.mkdir(issuePath(issue), { NSURLIsExcludedFromBackupKey: true });
  await FS.copyFile(
    source.replace(/^file:\/\//, ''),
    mediaPath(issue, filename),
  );
}

export async function removeIssue(issue: Issue) {
  await writes.catch(() => {});
  await FS.unlink(issuePath(issue));
}
