/* eslint no-void: ["error", { "allowAsStatement": true }] */
import React, { useRef, useState } from 'react';
import { Alert, Text } from 'react-native';
import { ApiError, Session } from '../api/auth';
import { endSession } from '../api/tokens';
import { Action, Page, message, styles } from './components';
import { useRetryDelay } from './useRetryDelay';

export default function AccountScreen({
  session,
  onBack,
  onSignedOut,
  onLogin,
}: {
  session: Session;
  onBack: () => void;
  onSignedOut: (confirmed: boolean) => void;
  onLogin: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [needsLogin, setNeedsLogin] = useState(false);
  const locked = useRef(false);
  const retry = useRetryDelay();
  const run = async (action: () => Promise<void>) => {
    if (locked.current || retry.remaining) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (failure) {
      setError(message(failure));
      if (failure instanceof ApiError) {
        if (failure.status === 401) setNeedsLogin(true);
        if (failure.retryAt) retry.deferUntil(failure.retryAt);
      }
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  const blocked = busy || retry.remaining > 0;
  return (
    <Page title="Account" transitionKey="account" error={error} busy={busy}>
      <Text style={styles.label}>Name</Text>

      <Text style={styles.tt}>{session.user.fullName || 'Your account'}</Text>
      <Text style={styles.label}>Phone number</Text>
      <Text style={styles.tt}>
        {session.user.phoneNumber || 'Unavailable'}
      </Text>
      <Text style={styles.label}>Address</Text>
      <Text style={styles.tt}>{session.user.address || 'Unavailable'}</Text>
      {retry.remaining ? (
        <Text accessibilityLiveRegion="polite" style={styles.hint}>
          Try again in {retry.remaining}s.
        </Text>
      ) : null}
      {needsLogin ? (
        <Action
          label="Sign in again"
          secondary
          disabled={busy}
          onPress={onLogin}
        />
      ) : null}
      
      <Action
        label="Sign out"
        secondary
        disabled={busy}
        onPress={() => {
          if (locked.current) return;
          locked.current = true;
          setBusy(true);
          endSession(session)
            .then(result => onSignedOut(result.revoked))
            .catch(failure => {
              setError(message(failure));
            })
            .finally(() => {
              locked.current = false;
              setBusy(false);
            });
        }}
      />
      <Action
        label="Forget this device"
        secondary
        disabled={blocked}
        onPress={() =>
          Alert.alert(
            'Forget this device?',
            'This revokes this device and all its sessions. Your local drafts remain on this phone. Signing in again may require support.',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Forget device',
                style: 'destructive',
                onPress: () => {
                  void run(async () => {
                    const result = await endSession(session, true);
                    onSignedOut(result.revoked);
                  });
                },
              },
            ],
          )
        }
      />
      <Action
        label="Back to workspace"
        secondary
        disabled={busy}
        onPress={onBack}
      />
      <Text style={styles.lable}>
        If this device is unrecognized or revoked, contact your organization’s
        support. This app does not automatically register another device to an
        existing account.
      </Text>
    </Page>
  );
}
