import FS from 'react-native-fs';
import { newId } from '../issues/model';
import { Session } from './auth';
import { guest } from './tokens';
import { listIssues, issuePath, saveIssue } from '../issues/storage';
export {
  remember,
  restore,
  forget,
  guest,
  endSession,
  onSessionChange,
} from './tokens';
let activeTransfer: { accountId: string; promise: Promise<void> } | null = null;
export function transfer(session: Session): Promise<void> {
  if (session.user.id === guest.user.id) return Promise.resolve();
  if (activeTransfer) {
    return activeTransfer.accountId === session.user.id
      ? activeTransfer.promise
      : Promise.reject(
          new Error('Finish transferring to the original account first.'),
        );
  }
  const promise = transferGuestIssues(session).finally(() => {
    activeTransfer = null;
  });
  activeTransfer = { accountId: session.user.id, promise };
  return promise;
}

async function fingerprint(file: string) {
  const stat = await FS.stat(file);
  if (!stat.isFile())
    throw new Error('An attachment is not a file. Guest original preserved.');
  return `${stat.size}:${await FS.hash(file, 'sha256')}`;
}
async function matches(file: string, expected: string) {
  if (!(await FS.exists(file))) return false;
  return (await fingerprint(file)) === expected;
}
async function transferGuestIssues(session: Session) {
  const journal = `${FS.DocumentDirectoryPath}/guest-transfer.json`;
  let state: { target: string; ids: Record<string, string> } = {
    target: session.user.id,
    ids: {},
  };
  let target = session.user.id;
  const journalTemp = `${journal}.tmp`;
  async function checkpoint() {
    await FS.writeFile(journalTemp, JSON.stringify(state), 'utf8');
    if (await FS.exists(journal)) {
      await FS.unlink(journal);
    }
    await FS.moveFile(journalTemp, journal);
  }
  if ((await FS.exists(journalTemp)) || (await FS.exists(journal))) {
    let recovered = false;
    for (const file of [journalTemp, journal]) {
      if (!(await FS.exists(file))) {
        continue;
      }
      try {
        const candidate = JSON.parse(await FS.readFile(file, 'utf8'));
        if (
          typeof candidate.target !== 'string' ||
          !candidate.target ||
          !candidate.ids ||
          typeof candidate.ids !== 'object' ||
          Array.isArray(candidate.ids) ||
          !Object.values(candidate.ids).every(
            id => typeof id === 'string' && /^[a-zA-Z0-9_-]+$/.test(id),
          )
        ) {
          continue;
        }
        state = candidate;
        recovered = true;
        break;
      } catch {
        /* An interrupted temp write can fall back to the committed journal. */
      }
    }
    if (!recovered) {
      throw new Error(
        'Transfer journal could not be restored. Guest issues are preserved.',
      );
    }
    target = state.target;
  }
  if (target !== session.user.id) {
    throw new Error(
      'Sign in to the original account to finish transferring guest issues.',
    );
  }
  await checkpoint();
  for (const issue of await listIssues(guest.user.id)) {
    if (!state.ids[issue.id]) {
      const candidate = { ...issue, ownerId: target };
      state.ids[issue.id] = (await FS.exists(issuePath(candidate)))
        ? newId()
        : issue.id;
      await checkpoint();
    }
    const destination = { ...issue, id: state.ids[issue.id], ownerId: target };
    const folder = issuePath(destination);
    const stage = `${FS.DocumentDirectoryPath}/transfer-${issue.id}`;
    await FS.mkdir(stage, { NSURLIsExcludedFromBackupKey: true });
    // RNFS.moveFile is not a portable directory move: Android may fall back to
    // file streams when rename fails (e.g. a missing destination parent).
    await FS.mkdir(folder, { NSURLIsExcludedFromBackupKey: true });
    for (const item of [...issue.photos, ...issue.audio]) {
      const source = `${issuePath(issue)}/${item.file}`;
      const staged = `${stage}/${item.file}`;
      const copied = `${folder}/${item.file}`;
      const expected = await fingerprint(source);
      // A process exit can leave either copy incomplete. Reuse only a verified
      // file, including when corruption has left its byte count unchanged.
      if (!(await matches(staged, expected))) await FS.copyFile(source, staged);
      if (!(await matches(staged, expected))) {
        throw new Error(
          'Attachment transfer incomplete. Guest original preserved. Retry transfer.',
        );
      }
      if (!(await matches(copied, expected))) await FS.copyFile(staged, copied);
      if (!(await matches(copied, expected))) {
        throw new Error(
          'Attachment verification failed. Guest original preserved. Retry transfer.',
        );
      }
    }
    await saveIssue(destination);
    await FS.unlink(issuePath(issue));
    if (await FS.exists(stage)) {
      await FS.unlink(stage);
    }
  }
  await FS.unlink(journal);
}
