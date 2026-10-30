import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Session } from './src/api/auth';
import {
  endSession,
  guest,
  onSessionChange,
  remember,
  restore,
  transfer,
} from './src/api/session';
import AccountScreen from './src/auth/AccountScreen';
import AuthScreen from './src/auth/AuthScreen';
import { Action, message } from './src/auth/components';
import IssueWorkspace from './src/issues/IssueWorkspace';
import { MotionProvider, Transition } from './src/ui/motion';
import { colors } from './src/theme';

function AppContent() {
  const [starting, setStarting] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [returnWorkspace, setReturnWorkspace] = useState<Session | null>(null);
  const [pending, setPending] = useState<Session | null>(null);
  const [error, setError] = useState('');
  const [account, setAccount] = useState(false);
  useEffect(
    () =>
      onSessionChange(updated => {
        setSession(current =>
          current?.user.id === updated.user.id ? updated : current,
        );
        setReturnWorkspace(current =>
          current?.user.id === updated.user.id ? updated : current,
        );
      }),
    [],
  );
  async function openAccount(result: Session) {
    await remember(result);
    setPending(result);
    await transfer(result);
    setPending(null);
    setReturnWorkspace(null);
    setSession(result);
  }
  useEffect(() => {
    let alive = true;
    restore()
      .then(saved => {
        if (!alive || !saved) return;
        // Offline restore never implies server authorization. Refresh occurs before API work.
        if (saved.user.id === guest.user.id) {
          setSession(saved);
          return;
        }
        setPending(saved);
        return transfer(saved).then(() => {
          if (alive) {
            setPending(null);
            setSession(saved);
          }
        });
      })
      .catch(() => {
        if (alive)
          setError(
            'Could not restore your workspace. Retry or continue offline.',
          );
      })
      .finally(() => {
        if (alive) setStarting(false);
      });
    return () => {
      alive = false;
    };
  }, []);
  const signedOut = (confirmed = true) => {
    setAccount(false);
    if (!confirmed)
      Alert.alert(
        'Signed out locally',
        'Your local session was cleared. Server revocation was not confirmed. Connect and sign in again to manage your server session.',
      );
    setSession(null);
    setReturnWorkspace(null);
  };
  if (starting)
    return (
      <SafeAreaView style={styles.fill}>
        <ActivityIndicator color={colors.accent} />
      </SafeAreaView>
    );
  if (account && session)
    return (
      <AccountScreen
        session={session}
        onBack={() => setAccount(false)}
        onSignedOut={signedOut}
        onLogin={() => {
          setReturnWorkspace(session);
          setSession(null);
          setAccount(false);
        }}
      />
    );
  if (session)
    return (
      <Transition style={styles.fill} transitionKey="workspace">
        <IssueWorkspace
          user={session.user}
          accessToken={session.accessToken}
          onAccount={
            session.user.id !== guest.user.id
              ? () => setAccount(true)
              : undefined
          }
          onAuthenticate={() => {
            setReturnWorkspace(session);
            setSession(null);
          }}
          onSignOut={() => {
            if (session.user.id === guest.user.id) {
              setReturnWorkspace(session);
              setSession(null);
              return;
            }
            endSession(session)
              .then(result => signedOut(result.revoked))
              .catch(failure =>
                Alert.alert('Sign out failed', message(failure)),
              );
          }}
        />
      </Transition>
    );
  if (pending)
    return (
      <SafeAreaView style={styles.fill}>
        <View style={styles.recovery}>
          <Text style={styles.text}>
            Your sign-in is saved. Finish transferring guest issues to open your
            workspace.
          </Text>
          <Action
            label="Retry transfer"
            onPress={() => {
              transfer(pending)
                .then(() => {
                  setSession(pending);
                  setPending(null);
                  setReturnWorkspace(null);
                })
                .catch(failure => setError(message(failure)));
            }}
          />
          {error ? (
            <Text accessibilityRole="alert" style={styles.text}>
              {error}
            </Text>
          ) : null}
        </View>
      </SafeAreaView>
    );
  return (
    <AuthScreen
      initialError={error}
      onSession={openAccount}
      onOffline={async () => {
        await remember(guest);
        setSession(guest);
      }}
      onBack={returnWorkspace ? () => setSession(returnWorkspace) : undefined}
    />
  );
}
export default function App() {
  return (
    <SafeAreaProvider>
      <MotionProvider>
        <AppContent />
      </MotionProvider>
    </SafeAreaProvider>
  );
}
const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.background },
  recovery: { padding: 28 },
  text: { color: colors.text, fontFamily: 'Poppins-Regular', lineHeight: 22 },
});
