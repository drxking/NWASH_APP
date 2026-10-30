/* eslint no-void: ["error", { "allowAsStatement": true }] */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Alert,
  AppState,
  BackHandler,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  Transition,
  TabIndicator,
  usePressMotion,
  useReducedMotion,
} from '../ui/motion';
import { SafeAreaView } from 'react-native-safe-area-context';
import { launchCamera } from 'react-native-image-picker';
import Sound from 'react-native-nitro-sound';
import FS from 'react-native-fs';
import {
  ArrowLeft,
  ArrowUpRight,
  Camera,
  Check,
  ChevronRight,
  FilePlus2,
  FileText,
  UserRound,
  MapPin,
  Mic,
  Plus,
  Square,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react-native';
import { canAutoUpload, serverReachable } from './autoUpload';
import { uploadIssue, UploadError } from './upload';
import { colors } from '../theme';
import VoiceNote, { Waveform } from './VoiceNote';
import {
  clampSeek,
  compactWaveform,
  formatTime as time,
  meterAmplitude,
} from './audio';
import { User } from '../api/auth';
import {
  Attachment,
  createIssue,
  hasContent,
  issueName,
  Issue,
  newId,
} from './model';
import {
  copyMedia,
  listIssues,
  mediaPath,
  mediaUri,
  removeIssue,
  saveIssue,
} from './storage';
import { startLocationTask, finishLocationTask } from './locationTasks';
import { captureLocation, requirePermission } from './capture';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const WHITE = colors.surface;
const BLACK = colors.text;
const failureMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : 'Something went wrong. Please try again.';

function Button({
  label,
  onPress,
  disabled = false,
  primary = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  const motion = usePressMotion();
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      onPressIn={motion.onPressIn}
      onPressOut={motion.onPressOut}
      style={[styles.button, primary && styles.primary, motion.style]}
    >
      <Text style={[styles.buttonText, primary && styles.primaryText]}>
        {label}
      </Text>
    </AnimatedPressable>
  );
}

function UploadProgress({
  value,
  onCancel,
}: {
  value: number;
  onCancel: () => void;
}) {
  return (
    <View style={styles.uploadPanel}>
      <View style={styles.uploadHeading}>
        <Text accessibilityLiveRegion="polite" style={styles.uploadLabel}>
          Uploading · {value}%
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel upload"
          style={styles.uploadCancel}
          onPress={event => {
            event.stopPropagation();
            onCancel();
          }}
        >
          <Text style={styles.uploadCancelText}>Cancel</Text>
        </Pressable>
      </View>
      <View
        accessibilityRole="progressbar"
        accessibilityLabel="Issue upload progress"
        accessibilityValue={{ min: 0, max: 100, now: value }}
        style={styles.uploadTrack}
      >
        <View
          style={[
            styles.uploadFill,
            { width: `${Math.max(0, Math.min(100, value))}%` },
          ]}
        />
      </View>
    </View>
  );
}

function IconButton({
  label,
  icon: Icon,
  onPress,
  disabled = false,
}: {
  label: string;
  icon: LucideIcon;
  onPress: () => void;
  disabled?: boolean;
}) {
  const motion = usePressMotion();
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      onPressIn={motion.onPressIn}
      onPressOut={motion.onPressOut}
      style={[styles.iconButton, motion.style]}
    >
      <Icon color={colors.accent} size={20} strokeWidth={1.7} />
    </AnimatedPressable>
  );
}

export default function IssueWorkspace({
  user,
  onSignOut,
  accessToken = '',
  onAuthenticate,
  onAccount,
}: {
  user: User;
  onSignOut: () => void;
  accessToken?: string;
  onAuthenticate?: () => void;
  onAccount?: () => void;
}) {
  const autoTick = useRef<() => Promise<void>>(async () => {});
  const probing = useRef(false);
  const nextProbe = useRef(0);
  const foreground = useRef(AppState.currentState !== 'background');
  const cancelledUploads = useRef(new Set<string>());
  const activeUpload = useRef<string | null>(null);
  const cancelUpload = useRef<(() => void) | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [issue, setIssue] = useState<Issue | null>(null);
  const current = useRef<Issue | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [error, setError] = useState('');
  const [saveState, setSaveState] = useState('Saved');
  const [recording, setRecording] = useState(false);
  const recordingRef = useRef<{
    attachment: Attachment;
    duration: number;
    samples: number[];
  } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState<string | null>(null);
  const playingRef = useRef(false);
  const activeAudio = useRef<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [position, setPosition] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [filter, setFilter] = useState<
    'all' | 'draft' | 'pending_upload' | 'uploaded'
  >('all');
  const descriptionScroll = useRef<FlatList<Issue>>(null);
  const descriptionFocused = useRef(false);
  function revealDescription() {
    if (descriptionFocused.current) {
      descriptionScroll.current?.scrollToEnd({ animated: true });
    }
  }
  const [tabWidth, setTabWidth] = useState(0);
  const newIssueMotion = usePressMotion();
  const reducedMotion = useReducedMotion();
  const [preview, setPreview] = useState<string | null>(null);
  const sequence = useRef(0);
  const mounted = useRef(true);
  const pendingLocations = useRef(new Set<string>());
  const stopRecordingRef = useRef<() => Promise<void>>(async () => {});
  const backRef = useRef<() => void>(() => {});

  useEffect(() => {
    mounted.current = true;
    const requests = pendingLocations.current;
    listIssues(user.id)
      .then(setIssues)
      .catch(e => setError(failureMessage(e)))
      .finally(() => setLoading(false));
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!current.current) {
        return false;
      }
      backRef.current();
      return true;
    });
    const state = AppState.addEventListener('change', next => {
      if (next !== 'active') {
        if (recordingRef.current) {
          void stopRecordingRef.current();
        }
        if (playingRef.current) {
          void stopPlayback();
        }
      }
    });
    return () => {
      mounted.current = false;
      for (const id of requests) finishLocationTask(user.id, id);
      requests.clear();
      cancelUpload.current?.();
      back.remove();
      state.remove();
      if (recordingRef.current) {
        void stopRecordingRef.current();
      }
      if (playingRef.current) {
        void Sound.stopPlayer().catch(() => {});
        Sound.removePlayBackListener();
        Sound.removePlaybackEndListener();
      }
    };
  }, [user.id]);

  async function persist(next: Issue) {
    const updated = { ...next, updatedAt: new Date().toISOString() };
    current.current = updated;
    if (mounted.current) {
      setIssue(updated);
      setSaveState('Saving…');
    }
    const revision = ++sequence.current;
    try {
      await saveIssue(updated);
      if (mounted.current && revision === sequence.current) {
        setSaveState('Saved');
      }
    } catch (e) {
      if (mounted.current) {
        setSaveState('Not saved — try again');
        setError(
          'Could not save to phone storage. Free up space and try saving again.',
        );
      }
      throw e;
    }
  }

  async function guard(action: () => Promise<void>) {
    if (locked.current) {
      return;
    }
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError(failureMessage(e));
    } finally {
      locked.current = false;
      if (mounted.current) {
        setBusy(false);
      }
    }
  }

  async function stopPlayback() {
    if (!playingRef.current) {
      return;
    }
    playingRef.current = false;
    try {
      await Sound.stopPlayer();
    } catch {
      /* Already stopped by the system. */
    }
    Sound.removePlaybackEndListener();
    Sound.removePlayBackListener();
    activeAudio.current = null;
    if (mounted.current) {
      setPosition(0);
      setAudioDuration(0);
      setPaused(false);
      setPlaying(null);
    }
  }

  async function stopRecording() {
    const active = recordingRef.current;
    const draft = current.current;
    if (!active || !draft) {
      return;
    }
    recordingRef.current = null;
    if (mounted.current) {
      setBusy(true);
    }
    try {
      await Sound.stopRecorder().catch(() => {});
      const info = await FS.stat(mediaPath(draft, active.attachment.file));
      if (Number(info.size) === 0) {
        throw new Error('No audio was captured. Please record again.');
      }
      await persist({
        ...current.current!,
        audio: [
          ...current.current!.audio,
          {
            ...active.attachment,
            durationMs: active.duration,
            waveform: compactWaveform(active.samples),
          },
        ],
      });
    } catch (e) {
      if (mounted.current) {
        setError(`Recording could not be saved. ${failureMessage(e)}`);
      }
    } finally {
      Sound.removeRecordBackListener();
      if (mounted.current) {
        setRecording(false);
        setBusy(false);
      }
    }
  }
  stopRecordingRef.current = stopRecording;

  async function leaveEditor() {
    if (locked.current) {
      return;
    }
    await guard(async () => {
      if (recordingRef.current) {
        await stopRecording();
      }
      await stopPlayback();
      if (current.current) {
        await persist(current.current);
      }
      setIssues(await listIssues(user.id));
      current.current = null;
      setIssue(null);
    });
  }
  backRef.current = () => {
    void leaveEditor();
  };

  async function takePhoto() {
    await guard(async () => {
      await stopPlayback();
      await requirePermission('camera');
      const result = await launchCamera({
        mediaType: 'photo',
        cameraType: 'back',
        quality: 0.8,
        maxWidth: 2000,
        maxHeight: 2000,
        saveToPhotos: false,
        assetRepresentationMode: 'compatible',
      });
      if (result.didCancel) {
        return;
      }
      if (result.errorCode || !result.assets?.[0]?.uri) {
        throw new Error(
          result.errorMessage || 'The camera could not capture a photo.',
        );
      }
      const draft = current.current!;
      const id = newId();
      const asset = result.assets[0];
      const extension =
        asset.type === 'image/png'
          ? 'png'
          : asset.type === 'image/heic'
          ? 'heic'
          : 'jpg';
      const photo: Attachment = {
        id,
        file: `${id}.${extension}`,
        createdAt: new Date().toISOString(),
      };
      await copyMedia(draft, asset.uri!, photo.file);
      const latest = current.current!;
      const firstPhoto =
        latest.photos.length === 0 && !latest.firstPhotoId && !latest.location;
      await persist({
        ...latest,
        photos: [...latest.photos, photo],
        ...(firstPhoto
          ? { firstPhotoId: photo.id, locationStatus: 'pending' as const }
          : {}),
      });
      if (firstPhoto) {
        pendingLocations.current.add(latest.id);
        startLocationTask(latest.ownerId, latest.id);
        void locateFirstPhoto(latest.ownerId, latest.id, photo.id);
      }
    });
  }

  async function locateFirstPhoto(
    ownerId: string,
    issueId: string,
    photoId: string,
  ) {
    try {
      let location;
      try {
        location = await captureLocation();
      } catch {
        /* The photo remains usable without GPS. */
      }
      if (!mounted.current) return;
      const isCurrent = () =>
        current.current?.ownerId === ownerId && current.current?.id === issueId;
      const saved = isCurrent()
        ? current.current
        : (await listIssues(ownerId)).find(item => item.id === issueId);
      const latest = isCurrent() ? current.current : saved;
      // Deleted issues and frozen upload snapshots must never be resurrected or rewritten.
      if (!latest || latest.firstPhotoId !== photoId || latest.upload) return;
      const updated: Issue = {
        ...latest,
        location,
        locationStatus: location ? 'captured' : 'unavailable',
        locationSource: undefined,
      };
      if (isCurrent()) await persist(updated);
      else await saveIssue({ ...updated, updatedAt: new Date().toISOString() });
    } catch (failure) {
      if (mounted.current && current.current?.id === issueId)
        setError(failureMessage(failure));
    } finally {
      pendingLocations.current.delete(issueId);
      finishLocationTask(ownerId, issueId);
      if (mounted.current) {
        try {
          const refreshed = await listIssues(ownerId);
          if (mounted.current) setIssues(refreshed);
        } catch (failure) {
          setError(failureMessage(failure));
        }
      }
    }
  }

  async function startRecording() {
    await guard(async () => {
      await stopPlayback();
      await requirePermission('audio');
      const draft = current.current!;
      await saveIssue(draft);
      const attachment: Attachment = {
        id: newId(),
        file: `${newId()}.m4a`,
        createdAt: new Date().toISOString(),
      };
      Sound.addRecordBackListener(event => {
        if (recordingRef.current) {
          recordingRef.current.duration = event.currentPosition;
          setElapsed(Math.floor(event.currentPosition / 1000) * 1000);
          recordingRef.current.samples.push(
            meterAmplitude(event.currentMetering),
          );
        }
        if (event.isRecording === false && recordingRef.current) {
          void stopRecordingRef.current();
        }
      });
      try {
        Sound.setSubscriptionDuration(0.2);
        await Sound.startRecorder(
          mediaPath(draft, attachment.file),
          undefined,
          true,
        );
        recordingRef.current = { attachment, duration: 0, samples: [] };
        setElapsed(0);
        setRecording(true);
      } catch (e) {
        Sound.removeRecordBackListener();
        throw e;
      }
    });
  }

  async function loadAudio(attachment: Attachment) {
    await stopPlayback();
    activeAudio.current = attachment.id;
    Sound.setSubscriptionDuration(0.2);
    Sound.addPlayBackListener(event => {
      if (activeAudio.current === attachment.id && mounted.current) {
        setAudioDuration(event.duration);
        setPosition(clampSeek(event.currentPosition, event.duration));
      }
    });
    Sound.addPlaybackEndListener(() => {
      if (activeAudio.current === attachment.id && mounted.current) {
        setPaused(true);
        setPosition(0);
      }
    });
    try {
      await Sound.startPlayer(mediaPath(current.current!, attachment.file));
      playingRef.current = true;
      setPlaying(attachment.id);
      setPaused(false);
      setAudioDuration(attachment.durationMs || 0);
    } catch (e) {
      activeAudio.current = null;
      Sound.removePlayBackListener();
      Sound.removePlaybackEndListener();
      throw e;
    }
  }

  async function playAudio(attachment: Attachment) {
    await guard(async () => {
      if (activeAudio.current === attachment.id && playingRef.current) {
        if (paused) {
          await Sound.seekToPlayer(position);
          await Sound.resumePlayer();
        } else {
          await Sound.pausePlayer();
        }
        setPaused(!paused);
      } else {
        await loadAudio(attachment);
      }
    });
  }

  async function seekAudio(attachment: Attachment, milliseconds: number) {
    await guard(async () => {
      const alreadyActive =
        activeAudio.current === attachment.id && playingRef.current;
      const duration = alreadyActive
        ? audioDuration || attachment.durationMs || 0
        : attachment.durationMs || 0;
      if (!alreadyActive) {
        await loadAudio(attachment);
      }
      const target = clampSeek(milliseconds, duration);
      await Sound.seekToPlayer(target);
      setPosition(target);
    });
  }

  function deleteAttachment(kind: 'photos' | 'audio', attachment: Attachment) {
    Alert.alert('Remove attachment?', 'This removes it from this issue.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          void guard(async () => {
            await stopPlayback();
            const draft = current.current!;
            await persist({
              ...draft,
              [kind]: draft[kind].filter(item => item.id !== attachment.id),
            });
            // Only remove the file once the manifest no longer references it.
            await FS.unlink(mediaPath(draft, attachment.file)).catch(() => {});
          });
        },
      },
    ]);
  }

  async function sendIssue(target: Issue) {
    await guard(async () => {
      activeUpload.current = target.id;
      setUploadProgress(0);
      try {
        const done = await uploadIssue(
          target,
          { accessToken, user },
          value => {
            if (mounted.current) {
              setUploadProgress(value);
            }
          },
          cancel => {
            cancelUpload.current = cancel;
          },
        );
        if (current.current?.id === done.id) {
          current.current = done;
          setIssue(done);
        }
      } catch (e) {
        if (
          e instanceof UploadError &&
          [400, 409, 413, 415].includes(e.status || 0)
        ) {
          cancelledUploads.current.add(target.id);
        }
        if (
          e instanceof UploadError &&
          (e.status === 401 || e.status === 403)
        ) {
          setNeedsLogin(true);
        }
        if (current.current?.id === target.id) {
          const saved = (await listIssues(user.id)).find(
            item => item.id === target.id,
          );
          if (saved) {
            current.current = saved;
            setIssue(saved);
          }
        }
        throw e;
      } finally {
        activeUpload.current = null;
        setUploadProgress(null);
        setIssues(await listIssues(user.id));
      }
    });
  }
  autoTick.current = async () => {
    if (
      !mounted.current ||
      !foreground.current ||
      loading ||
      locked.current ||
      current.current ||
      probing.current ||
      needsLogin ||
      !accessToken ||
      user.id === 'local-guest-v1' ||
      Date.now() < nextProbe.current
    ) {
      return;
    }
    const target = issues.find(
      item =>
        canAutoUpload(item, user.id) && !cancelledUploads.current.has(item.id),
    );
    if (!target) {
      return;
    }
    probing.current = true;
    try {
      const reachable = await serverReachable();
      if (!reachable) {
        nextProbe.current = Date.now() + 15000;
        return;
      }
      const latest = (await listIssues(user.id)).find(
        item => item.id === target.id,
      );
      if (
        latest &&
        canAutoUpload(latest, user.id) &&
        mounted.current &&
        foreground.current &&
        !locked.current &&
        !current.current &&
        !cancelledUploads.current.has(latest.id)
      ) {
        await sendIssue(latest);
      }
    } finally {
      probing.current = false;
    }
  };
  useEffect(() => {
    const interval = setInterval(() => {
      void autoTick.current();
    }, 15000);
    const subscription = AppState.addEventListener('change', state => {
      foreground.current = state === 'active';
      if (foreground.current) {
        nextProbe.current = 0;
        void autoTick.current();
      } else {
        cancelUpload.current?.();
      }
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [user.id, accessToken]);
  useEffect(() => {
    void autoTick.current();
  }, [issues, loading, busy, issue]);
  function cancelActiveUpload() {
    if (activeUpload.current) {
      cancelledUploads.current.add(activeUpload.current);
    }
    cancelUpload.current?.();
  }
  const blocked = busy || recording || Boolean(issue?.upload);
  const { visibleIssues, counts, issueNumbers } = useMemo(() => {
    const totals = {
      all: issues.length,
      draft: 0,
      pending_upload: 0,
      uploaded: 0,
    };
    const numbers = new Map<string, number>();
    issues.forEach((saved, index) => {
      totals[saved.status]++;
      numbers.set(saved.id, index + 1);
    });
    return {
      counts: totals,
      issueNumbers: numbers,
      visibleIssues:
        filter === 'all'
          ? issues
          : issues.filter(saved => saved.status === filter),
    };
  }, [issues, filter]);
  const editorId = issue?.id;
  useEffect(() => {
    descriptionScroll.current?.scrollToOffset({ offset: 0, animated: false });
  }, [editorId]);
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" />
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Transition
          style={styles.fill}
          transitionKey={`${issue?.id || 'list'}:${filter}`}
        >
          <FlatList
            ref={descriptionScroll}
            data={!loading && !issue ? visibleIssues : []}
            keyExtractor={saved => saved.id}
            initialNumToRender={8}
            maxToRenderPerBatch={6}
            windowSize={7}
            renderItem={({ item: saved }) => (
              <Pressable
                key={saved.id}
                accessibilityRole="button"
                accessibilityLabel={`Open issue ${issueNumbers.get(saved.id)}`}
                style={styles.issueCard}
                onPress={() => {
                  current.current = saved;
                  setIssue(saved);
                  setError('');
                  setSaveState('Saved');
                }}
              >
                <View style={styles.cardTop}>
                  <View
                    style={[
                      styles.badge,
                      saved.status === 'pending_upload' && styles.badgeFilled,
                    ]}
                  >
                    <Text
                      style={[
                        styles.badgeText,
                        saved.status === 'pending_upload' && styles.pendingText,
                      ]}
                    >
                      {uploadProgress !== null &&
                      activeUpload.current === saved.id
                        ? 'Uploading'
                        : saved.status === 'pending_upload'
                        ? 'Pending'
                        : saved.status === 'uploaded'
                        ? 'Sent'
                        : 'Draft'}
                    </Text>
                  </View>
                </View>
                <View style={styles.cardMain}>
                  {saved.photos[0] ? (
                    <Image
                      source={{
                        uri: mediaUri(saved, saved.photos[0].file),
                      }}
                      style={styles.cardPhoto}
                    />
                  ) : (
                    <View style={styles.cardFile}>
                      <FileText size={24} color={BLACK} strokeWidth={1.4} />
                    </View>
                  )}
                  <View style={styles.grow}>
                    <Text numberOfLines={2} style={styles.cardTitle}>
                      {issueName(saved.createdAt)}
                    </Text>
                    <View style={styles.cardMeta}>
                      <Camera size={12} color={BLACK} />
                      <Text style={styles.micro}>{saved.photos.length}</Text>
                      <Mic size={12} color={BLACK} />
                      <Text style={styles.micro}>{saved.audio.length}</Text>
                      {saved.location ? (
                        <MapPin size={12} color={BLACK} />
                      ) : null}
                    </View>
                  </View>
                  <ChevronRight size={18} color={colors.secondary} />
                </View>
                {uploadProgress !== null &&
                activeUpload.current === saved.id ? (
                  <UploadProgress
                    value={uploadProgress}
                    onCancel={cancelActiveUpload}
                  />
                ) : null}
              </Pressable>
            )}
            onLayout={revealDescription}
            contentContainerStyle={styles.page}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
            ListHeaderComponent={
              <>
                <View style={styles.header}>
                  {issue ? (
                    <IconButton
                      label="Back"
                      icon={ArrowLeft}
                      disabled={busy}
                      onPress={() => {
                        void leaveEditor();
                      }}
                    />
                  ) : (
                    <Text style={styles.brand}>
                      NWASH<Text style={styles.brandDot}>.</Text>
                    </Text>
                  )}
                  {issue ? (
                    <View style={styles.savedStatus}>
                      {saveState === 'Saved' ? (
                        <Check size={12} color={colors.accent} />
                      ) : null}
                      <Text
                        accessibilityLiveRegion="polite"
                        style={styles.micro}
                      >
                        {saveState}
                      </Text>
                    </View>
                  ) : (
                    <IconButton
                      label={
                        user.id === 'local-guest-v1'
                          ? 'Sign in'
                          : onAccount
                          ? 'Account'
                          : 'Sign out'
                      }
                      icon={UserRound}
                      disabled={busy}
                      onPress={onAccount || onSignOut}
                    />
                  )}
                </View>
                <Text accessibilityRole="header" style={styles.title}>
                  {issue ? 'New issue' : 'Your issues'}
                </Text>
                {error ? (
                  <Text accessibilityRole="alert" style={styles.error}>
                    {error}
                  </Text>
                ) : null}
                {needsLogin && onAuthenticate ? (
                  <Button
                    label="Sign in to upload"
                    onPress={onAuthenticate}
                    disabled={busy}
                  />
                ) : null}
                {loading ? (
                  <ActivityIndicator color={BLACK} />
                ) : !issue ? (
                  <>
                    <Text numberOfLines={1} style={styles.account}>
                      {user.fullName ||
                        user.phoneNumber ||
                        user.email ||
                        'Guest'}
                    </Text>
                    <AnimatedPressable
                      onPressIn={newIssueMotion.onPressIn}
                      onPressOut={newIssueMotion.onPressOut}
                      accessibilityRole="button"
                      accessibilityLabel="New issue"
                      disabled={busy}
                      style={[styles.newIssue, newIssueMotion.style]}
                      onPress={() => {
                        void guard(async () => {
                          await persist(createIssue(user.id));
                        });
                      }}
                    >
                      <View style={styles.newIssueTop}>
                        <View style={styles.newIssueIcon}>
                          <Plus size={23} color={WHITE} />
                        </View>
                        <ArrowUpRight size={22} color={WHITE} />
                      </View>
                      <Text style={styles.newIssueText}>New issue</Text>
                    </AnimatedPressable>
                    <View style={styles.listHeading}>
                      <Text style={styles.sectionTitle}>Issues</Text>
                      <Text style={styles.micro}>{issues.length} total</Text>
                    </View>
                    <View
                      accessibilityRole="tablist"
                      style={styles.filters}
                      onLayout={event =>
                        setTabWidth(
                          Math.max(0, event.nativeEvent.layout.width - 8) / 4,
                        )
                      }
                    >
                      <TabIndicator
                        width={tabWidth}
                        index={[
                          'all',
                          'draft',
                          'pending_upload',
                          'uploaded',
                        ].indexOf(filter)}
                      />
                      {(
                        [
                          { key: 'all', label: 'All', count: issues.length },
                          {
                            key: 'draft',
                            label: 'Drafts',
                            count: counts.draft,
                          },
                          {
                            key: 'pending_upload',
                            label: 'Pending',
                            count: counts.pending_upload,
                          },
                          {
                            key: 'uploaded',
                            label: 'Sent',
                            count: counts.uploaded,
                          },
                        ] as const
                      ).map(item => (
                        <Pressable
                          key={item.key}
                          accessibilityRole="tab"
                          accessibilityLabel={`${item.label} issues`}
                          accessibilityState={{ selected: filter === item.key }}
                          onPress={() => setFilter(item.key)}
                          style={[styles.filter]}
                        >
                          <Text
                            style={[
                              styles.filterText,
                              filter === item.key && styles.filterActiveText,
                            ]}
                          >
                            {item.label} {item.count}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                    {!visibleIssues.length ? (
                      <View style={styles.empty}>
                        <FilePlus2
                          size={30}
                          color={colors.muted}
                          strokeWidth={1.2}
                        />
                        <Text style={styles.emptyText}>
                          {issues.length
                            ? 'No matching issues'
                            : 'No issues yet'}
                        </Text>
                      </View>
                    ) : null}
                  </>
                ) : (
                  <>
                    <View
                      accessibilityLiveRegion="polite"
                      style={styles.locationCard}
                    >
                      <View style={styles.locationIcon}>
                        <MapPin
                          size={22}
                          color={colors.accent}
                          strokeWidth={1.6}
                        />
                      </View>
                      <View style={styles.grow}>
                        <Text style={styles.locationTitle}>
                          {issue.locationStatus === 'pending'
                            ? 'Capturing location…'
                            : issue.location
                            ? 'Location'
                            : 'Photo location'}
                        </Text>
                        {issue.location ? (
                          <Text style={styles.micro}>
                            {issue.location.latitude.toFixed(5)},{' '}
                            {issue.location.longitude.toFixed(5)} · ±
                            {Math.round(issue.location.accuracy)} m
                          </Text>
                        ) : (
                          <Text style={styles.micro}>
                            {issue.locationStatus === 'unavailable'
                              ? 'Location unavailable · Your photos are saved'
                              : issue.locationStatus === 'pending'
                              ? 'You can keep adding photos and notes'
                              : 'Captured automatically with your first photo'}
                          </Text>
                        )}
                      </View>
                      {issue.locationStatus === 'pending' ? (
                        <ActivityIndicator color={colors.accent} />
                      ) : null}
                    </View>

                    <View style={styles.section}>
                      <View style={styles.sectionHeading}>
                        <View style={styles.sectionName}>
                          <Text style={styles.sectionTitle}>Photos</Text>
                        </View>
                        <Text style={styles.count}>{issue.photos.length}</Text>
                      </View>
                      <View style={styles.photos}>
                        {issue.photos.map((photo, index) => (
                          <View key={photo.id} style={styles.photoItem}>
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`View photo ${index + 1}`}
                              onPress={() =>
                                setPreview(mediaUri(issue, photo.file))
                              }
                              style={styles.photoPreview}
                            >
                              <Image
                                source={{ uri: mediaUri(issue, photo.file) }}
                                style={styles.thumbnail}
                              />
                            </Pressable>
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`Remove photo ${index + 1}`}
                              disabled={blocked}
                              onPress={() => deleteAttachment('photos', photo)}
                              style={styles.photoDelete}
                            >
                              <View style={styles.photoDeleteCircle}>
                                <X size={12} color={BLACK} />
                              </View>
                            </Pressable>
                          </View>
                        ))}
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Take photo"
                          disabled={blocked}
                          style={[
                            styles.cameraTile,
                            !issue.photos.length && styles.cameraTileEmpty,
                          ]}
                          onPress={() => {
                            void takePhoto();
                          }}
                        >
                          <Camera
                            size={issue.photos.length ? 24 : 28}
                            color={BLACK}
                            strokeWidth={1.4}
                          />
                          <Text style={styles.cameraText}>
                            {issue.photos.length ? 'Add' : 'Add photos'}
                          </Text>
                          {!issue.photos.length ? (
                            <Plus size={18} color={BLACK} />
                          ) : null}
                        </Pressable>
                      </View>
                    </View>
                    <View style={styles.section}>
                      <View style={styles.sectionHeading}>
                        <View style={styles.sectionName}>
                          <Text style={styles.sectionTitle}>Voice notes</Text>
                        </View>
                        <Text style={styles.count}>{issue.audio.length}</Text>
                      </View>
                      {issue.audio.map((audio, index) => (
                        <VoiceNote
                          key={audio.id}
                          attachment={audio}
                          index={index}
                          active={playing === audio.id}
                          paused={paused}
                          position={playing === audio.id ? position : 0}
                          duration={
                            playing === audio.id
                              ? audioDuration
                              : audio.durationMs || 0
                          }
                          disabled={busy || recording}
                          removalDisabled={blocked}
                          onToggle={() => {
                            void playAudio(audio);
                          }}
                          onSeek={milliseconds => {
                            void seekAudio(audio, milliseconds);
                          }}
                          onRemove={() => deleteAttachment('audio', audio)}
                        />
                      ))}
                      {recording ? (
                        <View style={styles.recorder}>
                          <View style={styles.recorderTop}>
                            <View style={styles.recordingLabel}>
                              <View style={styles.recordDot} />
                              <Text style={styles.recordLabel}>RECORDING</Text>
                            </View>
                            <Text style={styles.recordTime}>
                              {time(elapsed)}
                            </Text>
                          </View>
                          <View style={styles.liveWave}>
                            <Waveform progress={1} inverted />
                          </View>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Stop recording · ${time(
                              elapsed,
                            )}`}
                            disabled={busy}
                            onPress={() => {
                              void stopRecording();
                            }}
                            style={styles.stopRecording}
                          >
                            <Square size={14} color={BLACK} fill={BLACK} />
                            <Text style={styles.stopText}>Stop recording</Text>
                          </Pressable>
                        </View>
                      ) : (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Record audio"
                          disabled={busy}
                          onPress={() => {
                            void startRecording();
                          }}
                          style={styles.recordButton}
                        >
                          <View style={styles.micCircle}>
                            <Mic size={18} color={WHITE} />
                          </View>
                          <Text style={styles.recordButtonText}>
                            Record a voice note
                          </Text>
                          <Plus size={18} color={BLACK} />
                        </Pressable>
                      )}
                    </View>
                    <View style={styles.section}>
                      <View style={styles.sectionHeading}>
                        <View style={styles.sectionName}>
                          <Text style={styles.sectionTitle}>Description</Text>
                        </View>
                        <FileText
                          size={16}
                          color={colors.secondary}
                          strokeWidth={1.5}
                        />
                      </View>
                      <TextInput
                        accessibilityLabel="Issue description"
                        onFocus={() => {
                          descriptionFocused.current = true;
                          requestAnimationFrame(revealDescription);
                        }}
                        onBlur={() => {
                          descriptionFocused.current = false;
                        }}
                        placeholder="What happened?"
                        placeholderTextColor={colors.secondary}
                        selectionColor={colors.accent}
                        multiline
                        maxLength={10000}
                        editable={!blocked}
                        style={styles.description}
                        value={issue.description}
                        onChangeText={description => {
                          void persist({
                            ...current.current!,
                            description,
                          }).catch(() => {});
                        }}
                      />
                    </View>
                    <View style={styles.actions}>
                      {uploadProgress !== null &&
                      activeUpload.current === issue.id ? (
                        <UploadProgress
                          value={uploadProgress}
                          onCancel={cancelActiveUpload}
                        />
                      ) : null}
                      <Button
                        label={
                          issue.status === 'uploaded'
                            ? 'Uploaded'
                            : issue.upload
                            ? 'Retry upload'
                            : 'Upload issue'
                        }
                        disabled={
                          busy ||
                          recording ||
                          issue.locationStatus === 'pending' ||
                          issue.status === 'uploaded'
                        }
                        onPress={() => {
                          void sendIssue(issue);
                        }}
                      />
                      {issue.upload ? (
                        <Text style={styles.micro}>
                          {issue.status === 'uploaded'
                            ? 'Uploaded · Read only'
                            : 'Upload snapshot · Read only'}
                        </Text>
                      ) : null}
                      <Button
                        primary
                        label="Save issue"
                        disabled={blocked}
                        onPress={() => {
                          void guard(async () => {
                            if (!hasContent(current.current!)) {
                              throw new Error(
                                'Add a photo, voice note, or description.',
                              );
                            }
                            await stopPlayback();
                            await persist({
                              ...current.current!,
                              status: 'pending_upload',
                            });
                            setIssues(await listIssues(user.id));
                            current.current = null;
                            setIssue(null);
                          });
                        }}
                      />
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Delete draft"
                        disabled={blocked || issue.locationStatus === 'pending'}
                        style={styles.deleteDraft}
                        onPress={() =>
                          Alert.alert(
                            'Delete this issue?',
                            'This removes its photos, recordings, and text.',
                            [
                              { text: 'Cancel', style: 'cancel' },
                              {
                                text: 'Delete',
                                style: 'destructive',
                                onPress: () => {
                                  void guard(async () => {
                                    await stopPlayback();
                                    await removeIssue(current.current!);
                                    setIssues(await listIssues(user.id));
                                    current.current = null;
                                    setIssue(null);
                                  });
                                },
                              },
                            ],
                          )
                        }
                      >
                        <Trash2 size={14} color={BLACK} />
                        <Text style={styles.deleteText}>Delete draft</Text>
                      </Pressable>
                    </View>
                  </>
                )}
              </>
            }
          />
        </Transition>
      </KeyboardAvoidingView>
      <Modal
        animationType={reducedMotion ? 'none' : 'fade'}
        visible={preview !== null}
        onRequestClose={() => setPreview(null)}
      >
        <SafeAreaView style={styles.safe}>
          <View style={styles.previewHeader}>
            <IconButton
              label="Close photo"
              icon={X}
              onPress={() => setPreview(null)}
            />
          </View>
          {preview ? (
            <Image
              source={{ uri: preview }}
              resizeMode="contain"
              style={styles.fill}
            />
          ) : null}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  fill: { flex: 1 },
  grow: { flex: 1, minWidth: 0 },
  page: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 30,
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 26,
  },
  brand: {
    color: BLACK,
    fontFamily: 'Poppins-Bold',
    fontSize: 19,
    letterSpacing: 1.5,
  },
  brandDot: {
    color: colors.accent,
    fontSize: 26,
  },
  iconButton: {
    backgroundColor: colors.surface,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  savedStatus: { flexDirection: 'row', gap: 5, alignItems: 'center' },
  eyebrow: {
    color: BLACK,
    fontFamily: 'Poppins-Regular',
    fontSize: 9,
    letterSpacing: 2,
    marginBottom: 7,
  },
  title: {
    color: BLACK,
    fontFamily: 'Poppins-SemiBold',
    fontSize: 34,
    lineHeight: 42,
    letterSpacing: -1,
  },
  micro: {
    color: colors.secondary,
    fontFamily: 'Poppins-Regular',
    fontSize: 10,
    lineHeight: 16,
  },
  account: {
    color: colors.secondary,
    fontFamily: 'Poppins-Regular',
    fontSize: 11,
    marginTop: 4,
  },
  newIssue: {
    backgroundColor: colors.accent,
    borderRadius: 24,
    padding: 20,
    marginTop: 26,
  },
  newIssueTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  newIssueIcon: {
    backgroundColor: colors.accent,
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newIssueText: { color: WHITE, fontFamily: 'Poppins-SemiBold', fontSize: 22 },
  listHeading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 30,
    marginBottom: 16,
  },
  filters: {
    backgroundColor: colors.soft,
    flexDirection: 'row',
    borderRadius: 14,
    padding: 4,
    marginBottom: 16,
  },
  filter: {
    flex: 1,
    borderRadius: 10,
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterText: {
    color: colors.secondary,
    fontFamily: 'Poppins-SemiBold',
    fontSize: 10,
  },
  filterActiveText: { color: colors.accent },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 170,
    gap: 14,
  },
  emptyText: { color: BLACK, fontFamily: 'Poppins-Regular', fontSize: 12 },
  uploadPanel: { marginTop: 12, gap: 3 },
  uploadHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  uploadLabel: {
    fontFamily: 'Poppins-Regular',
    fontSize: 11,
    color: colors.text,
  },
  uploadCancel: {
    minHeight: 44,
    minWidth: 60,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  uploadCancelText: {
    fontFamily: 'Poppins-SemiBold',
    fontSize: 11,
    color: colors.secondary,
  },
  uploadTrack: {
    height: 4,
    backgroundColor: colors.soft,
    borderRadius: 2,
    overflow: 'hidden',
  },
  uploadFill: {
    height: '100%',
    backgroundColor: colors.accent,
    borderRadius: 2,
  },
  issueCard: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginBottom: 14,
  },
  badge: {
    backgroundColor: colors.soft,
    borderRadius: 20,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  badgeFilled: { backgroundColor: colors.accentTint },
  pendingText: { color: colors.accent },
  badgeText: {
    color: colors.secondary,
    fontFamily: 'Poppins-Regular',
    fontSize: 9,
  },
  cardMain: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  cardPhoto: { width: 56, height: 60, borderRadius: 12 },
  cardFile: {
    backgroundColor: colors.accentTint,
    width: 56,
    height: 60,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    color: BLACK,
    fontFamily: 'Poppins-SemiBold',
    fontSize: 13,
    lineHeight: 20,
  },
  cardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  locationCard: {
    backgroundColor: colors.surface,
    borderRadius: 24,
    padding: 18,
    marginTop: 20,
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    minHeight: 78,
  },
  locationIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: colors.soft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationTitle: {
    color: colors.text,
    fontFamily: 'Poppins-SemiBold',
    fontSize: 13,
  },
  locationAction: {
    color: colors.secondary,
    fontFamily: 'Poppins-Regular',
    fontSize: 11,
  },
  section: {
    padding: 18,
    borderRadius: 24,
    backgroundColor: colors.surface,
    marginTop: 20,
    gap: 14,
  },
  sectionHeading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionName: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sectionNumber: { color: BLACK, fontFamily: 'Poppins-Regular', fontSize: 10 },
  sectionTitle: {
    color: BLACK,
    fontFamily: 'Poppins-SemiBold',
    fontSize: 17,
    letterSpacing: -0.4,
  },
  count: {
    backgroundColor: colors.soft,
    color: colors.secondary,
    fontFamily: 'Poppins-Regular',
    fontSize: 11,
    minWidth: 26,
    textAlign: 'center',
    paddingVertical: 3,
    borderRadius: 13,
  },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  photoItem: { width: '30%', aspectRatio: 1 },
  photoPreview: {
    width: '100%',
    height: '100%',
    borderRadius: 16,
    overflow: 'hidden',
  },
  thumbnail: { width: '100%', height: '100%', backgroundColor: BLACK },
  photoDelete: {
    position: 'absolute',
    top: -5,
    right: -5,
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoDeleteCircle: {
    width: 23,
    height: 23,
    borderRadius: 12,
    backgroundColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraTile: {
    backgroundColor: colors.accentTint,
    width: '30%',
    aspectRatio: 1,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  cameraTileEmpty: {
    width: '100%',
    aspectRatio: undefined,
    minHeight: 82,
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 14,
  },
  cameraText: {
    color: colors.accent,
    fontFamily: 'Poppins-Regular',
    fontSize: 11,
  },
  location: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  recordButton: {
    backgroundColor: colors.accentTint,
    borderRadius: 20,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 68,
  },
  micCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordButtonText: {
    flex: 1,
    color: colors.accent,
    fontFamily: 'Poppins-Regular',
    fontSize: 12,
  },
  recorder: { backgroundColor: colors.accent, padding: 18, borderRadius: 22 },
  recorderTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  recordingLabel: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  recordDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: WHITE },
  recordLabel: {
    color: WHITE,
    fontFamily: 'Poppins-Regular',
    fontSize: 9,
    letterSpacing: 1.5,
  },
  recordTime: {
    color: WHITE,
    fontFamily: 'Poppins-SemiBold',
    fontSize: 24,
    fontVariant: ['tabular-nums'],
  },
  liveWave: { marginVertical: 18 },
  stopRecording: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: WHITE,
    borderRadius: 14,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopText: {
    color: colors.accent,
    fontFamily: 'Poppins-SemiBold',
    fontSize: 11,
  },
  description: {
    backgroundColor: colors.soft,
    minHeight: 120,
    borderRadius: 18,
    padding: 16,
    textAlignVertical: 'top',
    color: BLACK,
    fontFamily: 'Poppins-Regular',
    fontSize: 12,
    lineHeight: 20,
  },
  actions: { marginTop: 28, gap: 8 },
  button: {
    backgroundColor: colors.soft,
    minHeight: 50,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: { backgroundColor: colors.accent },
  buttonText: { color: BLACK, fontFamily: 'Poppins-SemiBold', fontSize: 13 },
  primaryText: { color: WHITE },
  deleteDraft: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    minHeight: 44,
  },
  deleteText: {
    color: colors.secondary,
    fontFamily: 'Poppins-Regular',
    fontSize: 11,
  },
  error: {
    backgroundColor: colors.accentTint,
    borderRadius: 14,
    padding: 12,
    color: BLACK,
    fontFamily: 'Poppins-Regular',
    fontSize: 11,
    lineHeight: 18,
    paddingLeft: 12,
    marginTop: 18,
  },
  previewHeader: { padding: 20, alignItems: 'flex-end' },
});
