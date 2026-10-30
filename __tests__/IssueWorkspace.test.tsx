import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Text, TextInput } from 'react-native';
import { launchCamera } from 'react-native-image-picker';
import Sound from 'react-native-nitro-sound';
import * as Uploads from '../src/issues/upload';
import * as Auto from '../src/issues/autoUpload';
import IssueWorkspace from '../src/issues/IssueWorkspace';
import { captureLocation } from '../src/issues/capture';
import { copyMedia, listIssues, saveIssue } from '../src/issues/storage';
import { Issue, issueName } from '../src/issues/model';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.mock('lucide-react-native', () =>
  Object.fromEntries(
    [
      'ArrowLeft',
      'ArrowUpRight',
      'Camera',
      'Check',
      'ChevronRight',
      'FilePlus2',
      'FileText',
      'LogOut',
      'UserRound',
      'MapPin',
      'Mic',
      'Plus',
      'Square',
      'Trash2',
      'X',
      'Pause',
      'Play',
    ].map(name => [name, () => null]),
  ),
);
jest.mock('@react-native-community/slider', () => {
  const ReactModule = require('react');
  const { View } = require('react-native');
  return function MockSlider(props: object) {
    return ReactModule.createElement(View, props);
  };
});
jest.mock('react-native-image-picker', () => ({ launchCamera: jest.fn() }));
jest.mock('react-native-fs', () => ({
  stat: jest.fn(async () => ({ size: 1024 })),
  unlink: jest.fn(async () => {}),
}));
jest.mock('react-native-nitro-sound', () => ({
  setSubscriptionDuration: jest.fn(),
  addPlayBackListener: jest.fn(),
  removePlayBackListener: jest.fn(),
  pausePlayer: jest.fn(async () => ''),
  resumePlayer: jest.fn(async () => ''),
  seekToPlayer: jest.fn(async () => ''),
  startRecorder: jest.fn(async () => 'record.m4a'),
  stopRecorder: jest.fn(async () => 'record.m4a'),
  addRecordBackListener: jest.fn(),
  removeRecordBackListener: jest.fn(),
  startPlayer: jest.fn(async () => ''),
  stopPlayer: jest.fn(async () => ''),
  addPlaybackEndListener: jest.fn(),
  removePlaybackEndListener: jest.fn(),
}));
jest.mock('../src/issues/capture', () => ({
  requirePermission: jest.fn(async () => {}),
  captureLocation: jest.fn(),
}));
jest.mock('../src/issues/storage', () => ({
  listIssues: jest.fn(),
  saveIssue: jest.fn(),
  copyMedia: jest.fn(async () => {}),
  removeIssue: jest.fn(async () => {}),
  mediaPath: (_issue: Issue, file: string) => `/documents/${file}`,
  mediaUri: (_issue: Issue, file: string) => `file:///documents/${file}`,
}));
let tree: Renderer.ReactTestRenderer;
let drafts: Record<string, Issue>;
const user = { id: 'owner', email: 'user@example.com' };
const button = (label: string) =>
  tree.root.findAll(
    node =>
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === 'function',
  )[0];
function visibleText() {
  return tree.root
    .findAllByType(Text)
    .flatMap(node => [node.props.children].flat(Infinity))
    .filter(value => typeof value === 'string' || typeof value === 'number')
    .join(' ');
}
async function press(label: string) {
  await act(async () => button(label).props.onPress());
}
beforeEach(async () => {
  jest.clearAllMocks();
  drafts = {};
  jest.mocked(listIssues).mockImplementation(async () => Object.values(drafts));
  jest.mocked(saveIssue).mockImplementation(async issue => {
    drafts[issue.id] = JSON.parse(JSON.stringify(issue));
  });
  jest.mocked(captureLocation).mockResolvedValue({
    latitude: 27.7,
    longitude: 85.3,
    accuracy: 8,
    timestamp: 123,
  });
  jest.mocked(launchCamera).mockResolvedValue({
    assets: [{ uri: 'file:///camera/photo.jpg', type: 'image/jpeg' }],
  });
  await act(async () => {
    tree = Renderer.create(
      <IssueWorkspace user={user} onSignOut={jest.fn()} />,
    );
  });
});
afterEach(async () => {
  await act(async () => tree.unmount());
});

test('blocks an empty issue and saves a text-only issue locally', async () => {
  await press('New issue');
  await press('Save issue');
  expect(visibleText()).toContain('Add a photo, voice note, or description.');
  await act(async () =>
    tree.root.findByType(TextInput).props.onChangeText('A leaking water pipe'),
  );
  await press('Save issue');
  expect(Object.values(drafts)[0]).toMatchObject({
    description: 'A leaking water pipe',
    status: 'pending_upload',
  });
  expect(button('New issue')).toBeDefined();
});

test('the first saved photo automatically captures location once', async () => {
  await press('New issue');
  expect(captureLocation).not.toHaveBeenCalled();
  expect(button('Capture location')).toBeUndefined();
  await press('Take photo');
  await press('Take photo');
  const draft = Object.values(drafts)[0];
  expect(draft.photos).toHaveLength(2);
  expect(captureLocation).toHaveBeenCalledTimes(1);
  expect(draft).toMatchObject({
    firstPhotoId: draft.photos[0].id,
    locationStatus: 'captured',
    location: { latitude: 27.7, longitude: 85.3 },
  });
  expect(draft.locationSource).toBeUndefined();
});

test('location failure preserves the photo and allows saving without a location', async () => {
  jest
    .mocked(captureLocation)
    .mockRejectedValueOnce(new Error('GPS unavailable'));
  await press('New issue');
  await press('Take photo');
  expect(Object.values(drafts)[0].photos).toHaveLength(1);
  expect(Object.values(drafts)[0].locationStatus).toBe('unavailable');
  await press('Take photo');
  expect(captureLocation).toHaveBeenCalledTimes(1);
  await press('Save issue');
  expect(Object.values(drafts)[0].status).toBe('pending_upload');
});

test('slow GPS does not block photos or typing, and completing it preserves newer edits', async () => {
  let resolveLocation!: (
    value: Awaited<ReturnType<typeof captureLocation>>,
  ) => void;
  jest.mocked(captureLocation).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        resolveLocation = resolve;
      }),
  );
  await press('New issue');
  await press('Take photo');
  expect(button('Take photo').props.disabled).toBe(false);
  expect(button('Upload issue').props.disabled).toBe(true);
  await press('Take photo');
  await act(async () =>
    tree.root.findByType(TextInput).props.onChangeText('New description'),
  );
  await act(async () =>
    resolveLocation({
      latitude: 27,
      longitude: 85,
      accuracy: 10,
      timestamp: 123,
    }),
  );
  expect(Object.values(drafts)[0]).toMatchObject({
    description: 'New description',
    locationStatus: 'captured',
  });
  expect(Object.values(drafts)[0].photos).toHaveLength(2);
  expect(captureLocation).toHaveBeenCalledTimes(1);
});

test('canceling the camera does not attempt location or add an attachment', async () => {
  jest.mocked(launchCamera).mockResolvedValue({ didCancel: true });
  await press('New issue');
  await press('Take photo');
  expect(Object.values(drafts)[0].photos).toHaveLength(0);
  expect(captureLocation).not.toHaveBeenCalled();
});

test('stops, persists, and plays a recording; audio-only issue is valid', async () => {
  await press('New issue');
  await press('Record audio');
  await press('Stop recording · 0:00');
  expect(Sound.stopRecorder).toHaveBeenCalled();
  expect(Object.values(drafts)[0].audio).toHaveLength(1);
  await press('Play 1');
  expect(Sound.startPlayer).toHaveBeenCalled();
  await press('Save issue');
  expect(Object.values(drafts)[0].status).toBe('pending_upload');
});

test('restores an edited draft when returning from Home', async () => {
  await press('New issue');
  await act(async () =>
    tree.root.findByType(TextInput).props.onChangeText('Keep this draft'),
  );
  await press('Back');
  await press('Open issue 1');
  expect(tree.root.findByType(TextInput).props.value).toBe('Keep this draft');
});

test('uploaded voice notes remain playable and seekable while removal stays locked', async () => {
  await press('New issue');
  await press('Record audio');
  await act(async () =>
    jest.mocked(Sound.addRecordBackListener).mock.calls[0][0]({
      currentPosition: 10000,
      isRecording: true,
    }),
  );
  await press('Stop recording · 0:10');
  await press('Back');
  const saved = Object.values(drafts)[0];
  drafts[saved.id] = {
    ...saved,
    status: 'uploaded',
    upload: { metadata: '{}', serverIssueId: 'server-issue' },
  };
  await act(async () => {
    tree.unmount();
    tree = Renderer.create(
      <IssueWorkspace user={user} onSignOut={jest.fn()} />,
    );
  });
  await press('Open issue 1');
  expect(button('Play 1').props.disabled).toBe(false);
  expect(button('Remove recording 1').props.disabled).toBe(true);
  await press('Play 1');
  expect(Sound.startPlayer).toHaveBeenCalledWith(
    `/documents/${saved.audio[0].file}`,
  );
  await press('Pause recording 1');
  expect(Sound.pausePlayer).toHaveBeenCalled();
  const seek = tree.root.findAll(
    node =>
      node.props.accessibilityLabel === 'Seek recording 1' &&
      node.props.onSlidingComplete,
  )[0];
  expect(seek.props.disabled).toBe(false);
  await act(async () => seek.props.onSlidingComplete(5000));
  expect(Sound.seekToPlayer).toHaveBeenCalledWith(5000);
  await press('Play 1');
  expect(Sound.resumePlayer).toHaveBeenCalled();
});

test('voice notes pause, resume, seek, and persist real waveform samples', async () => {
  await press('New issue');
  await press('Record audio');
  await act(async () =>
    jest.mocked(Sound.addRecordBackListener).mock.calls[0][0]({
      currentPosition: 10000,
      currentMetering: -20,
      isRecording: true,
    }),
  );
  await press('Stop recording · 0:10');
  expect(Object.values(drafts)[0].audio[0].waveform![0]).toBeGreaterThan(0.5);
  await press('Play 1');
  await act(async () =>
    jest
      .mocked(Sound.addPlayBackListener)
      .mock.calls[0][0]({ currentPosition: 2000, duration: 10000 }),
  );
  await press('Pause recording 1');
  expect(Sound.pausePlayer).toHaveBeenCalledTimes(1);
  const seek = tree.root.findAll(
    node =>
      node.props.accessibilityLabel === 'Seek recording 1' &&
      node.props.onSlidingComplete,
  )[0];
  await act(async () => seek.props.onSlidingComplete(7000));
  expect(Sound.seekToPlayer).toHaveBeenCalledWith(7000);
  expect(Sound.resumePlayer).not.toHaveBeenCalled();
  await press('Play 1');
  expect(Sound.resumePlayer).toHaveBeenCalledTimes(1);
  expect(Sound.startPlayer).toHaveBeenCalledTimes(1);
});

test('home filters drafts and pending issues without extra instructional copy', async () => {
  await press('New issue');
  await act(async () =>
    tree.root.findByType(TextInput).props.onChangeText('Draft example'),
  );
  await press('Back');
  await press('New issue');
  await act(async () =>
    tree.root.findByType(TextInput).props.onChangeText('Pending example'),
  );
  await press('Save issue');
  await press('Drafts issues');
  expect(button('Open issue 1')).toBeDefined();
  expect(button('Open issue 2')).toBeUndefined();
  await press('Pending issues');
  expect(button('Open issue 2')).toBeDefined();
  expect(button('Open issue 1')).toBeUndefined();
  expect(visibleText()).not.toContain('Issues stay on this phone');
});

test('seeking a different note uses that note’s duration and switches playback', async () => {
  await press('New issue');
  await press('Record audio');
  await act(async () =>
    jest.mocked(Sound.addRecordBackListener).mock.calls[0][0]({
      currentPosition: 10000,
      currentMetering: -30,
      isRecording: true,
    }),
  );
  await press('Stop recording · 0:10');
  await press('Record audio');
  await act(async () =>
    jest.mocked(Sound.addRecordBackListener).mock.calls[1][0]({
      currentPosition: 20000,
      currentMetering: -15,
      isRecording: true,
    }),
  );
  await press('Stop recording · 0:20');
  await press('Play 1');
  const seek = tree.root.findAll(
    node =>
      node.props.accessibilityLabel === 'Seek recording 2' &&
      node.props.onSlidingComplete,
  )[0];
  await act(async () => seek.props.onSlidingComplete(15000));
  expect(Sound.seekToPlayer).toHaveBeenCalledWith(15000);
  expect(Sound.stopPlayer).toHaveBeenCalledTimes(1);
  expect(Sound.startPlayer).toHaveBeenCalledTimes(2);
});

test('issue names use the full creation timestamp rather than description', async () => {
  await press('New issue');
  await act(async () =>
    tree.root
      .findByType(TextInput)
      .props.onChangeText('Do not use as the issue name'),
  );
  await press('Back');
  const saved = Object.values(drafts)[0];
  const content = visibleText();
  expect(content).toContain(issueName(saved.createdAt));
  expect(content).not.toContain('Do not use as the issue name');
});

test('saving an account issue automatically uploads it from Home without an Upload next button', async () => {
  const ready = jest.spyOn(Auto, 'serverReachable').mockResolvedValue(true);
  const upload = jest
    .spyOn(Uploads, 'uploadIssue')
    .mockImplementation(async issue => {
      const done = { ...issue, status: 'uploaded' as const };
      await saveIssue(done);
      return done;
    });
  await act(async () => {
    tree.unmount();
    tree = Renderer.create(
      <IssueWorkspace user={user} accessToken="token" onSignOut={jest.fn()} />,
    );
  });
  await press('New issue');
  await act(async () =>
    tree.root.findByType(TextInput).props.onChangeText('Auto upload'),
  );
  await press('Save issue');
  expect(upload).toHaveBeenCalledTimes(1);
  expect(Object.values(drafts)[0].status).toBe('uploaded');
  expect(button('Upload next')).toBeUndefined();
  ready.mockRestore();
  upload.mockRestore();
});

test('an unreachable server leaves pending issues local for later upload', async () => {
  const ready = jest.spyOn(Auto, 'serverReachable').mockResolvedValue(false);
  const upload = jest.spyOn(Uploads, 'uploadIssue');
  await act(async () => {
    tree.unmount();
    tree = Renderer.create(
      <IssueWorkspace user={user} accessToken="token" onSignOut={jest.fn()} />,
    );
  });
  await press('New issue');
  await act(async () =>
    tree.root.findByType(TextInput).props.onChangeText('Offline issue'),
  );
  await press('Save issue');
  expect(upload).not.toHaveBeenCalled();
  expect(Object.values(drafts)[0].status).toBe('pending_upload');
  ready.mockRestore();
  upload.mockRestore();
});

test('upload progress and cancellation belong to the uploading card', async () => {
  const ready = jest.spyOn(Auto, 'serverReachable').mockResolvedValue(true);
  const upload = jest
    .spyOn(Uploads, 'uploadIssue')
    .mockImplementation(async (_issue, _session, progress, registerCancel) => {
      progress(42);
      return new Promise((_resolve, reject) => {
        registerCancel?.(() =>
          reject(new Uploads.UploadError('Upload interrupted.')),
        );
      });
    });
  await act(async () => {
    tree.unmount();
    tree = Renderer.create(
      <IssueWorkspace user={user} accessToken="token" onSignOut={jest.fn()} />,
    );
  });
  await press('New issue');
  await act(async () =>
    tree.root.findByType(TextInput).props.onChangeText('Card upload'),
  );
  await press('Save issue');
  const card = button('Open issue 1');
  expect(
    card.findAll(node => node.props.accessibilityRole === 'progressbar').length,
  ).toBeGreaterThan(0);
  expect(
    card.findAll(node => node.props.accessibilityLabel === 'Cancel upload')
      .length,
  ).toBeGreaterThan(0);
  expect(
    card.findAll(node => node.props.accessibilityValue?.now === 42).length,
  ).toBeGreaterThan(0);
  const stopPropagation = jest.fn();
  await act(async () =>
    button('Cancel upload').props.onPress({ stopPropagation }),
  );
  expect(stopPropagation).toHaveBeenCalled();
  expect(upload).toHaveBeenCalledTimes(1);
  expect(button('New issue')).toBeDefined();
  ready.mockRestore();
  upload.mockRestore();
});

test('a failed photo save does not request location', async () => {
  jest.mocked(copyMedia).mockRejectedValueOnce(new Error('Storage full'));
  await press('New issue');
  await press('Take photo');
  expect(captureLocation).not.toHaveBeenCalled();
  expect(Object.values(drafts)[0].photos).toHaveLength(0);
});

test('location completion after saving updates the original issue without touching a new editor', async () => {
  let finish!: (value: Awaited<ReturnType<typeof captureLocation>>) => void;
  jest.mocked(captureLocation).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  await press('New issue');
  await press('Take photo');
  const original = Object.values(drafts)[0];
  await press('Save issue');
  await press('New issue');
  const newerId = Object.keys(drafts).find(id => id !== original.id)!;
  await act(async () =>
    finish({ latitude: 27, longitude: 85, accuracy: 10, timestamp: 123 }),
  );
  expect(drafts[original.id]).toMatchObject({
    status: 'pending_upload',
    locationStatus: 'captured',
  });
  expect(drafts[newerId].locationStatus).toBe('none');
  expect(drafts[newerId].photos).toHaveLength(0);
});

test('an abandoned location callback does not rewrite a guest draft after its workspace unmounts', async () => {
  let finish!: (value: Awaited<ReturnType<typeof captureLocation>>) => void;
  jest.mocked(captureLocation).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  await press('New issue');
  await press('Take photo');
  await act(async () => tree.unmount());
  const writes = jest.mocked(saveIssue).mock.calls.length;
  await act(async () =>
    finish({ latitude: 27, longitude: 85, accuracy: 10, timestamp: 123 }),
  );
  expect(saveIssue).toHaveBeenCalledTimes(writes);
});
