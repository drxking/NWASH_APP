import React, { useRef, useState } from 'react';
import { Text } from 'react-native';
import { ApiError, Session, login, signup } from '../api/auth';
import { NEPAL_CALLING_CODE, nepalPhoneInput, nepalPhoneNumber } from './phone';
import { useRetryDelay } from './useRetryDelay';
import { Action, Field, Page, message, styles } from './components';

export default function AuthScreen({
  onSession,
  onOffline,
  onBack,
  initialError,
}: {
  onSession: (session: Session) => Promise<void>;
  onOffline: () => Promise<void>;
  onBack?: () => void;
  initialError?: string;
}) {
  const [isSignup, setIsSignup] = useState(false);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError || '');
  const retry = useRetryDelay();
  const locked = useRef(false);
  const run = async (action: () => Promise<void>) => {
    if (locked.current || retry.remaining) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (failure) {
      setError(message(failure));
      if (failure instanceof ApiError && failure.retryAt)
        retry.deferUntil(failure.retryAt);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  const submit = () =>
    run(async () => {
      if (isSignup && (!name.trim() || name.trim().length > 100))
        throw new Error('Enter your full name (up to 100 characters).');
      const phoneNumber = nepalPhoneNumber(phone);
      if (!phoneNumber)
        throw new Error(
          'Enter your 10-digit Nepal mobile number, for example 9812345678.',
        );
      if (isSignup && (!address.trim() || address.trim().length > 500))
        throw new Error('Enter your address (up to 500 characters).');
      await onSession(
        isSignup
          ? await signup(name, phoneNumber, address)
          : await login(phoneNumber),
      );
    });
  return (
    <Page
      title={isSignup ? 'Create account' : 'Sign in'}
      transitionKey={isSignup ? 'signup' : 'login'}
      error={error}
      busy={busy}
    >
      {isSignup ? (
        <Field
          label="Full name"
          value={name}
          onChangeText={setName}
          autoComplete="name"
          textContentType="name"
          autoCapitalize="words"
          maxLength={100}
          editable={!busy}
        />
      ) : null}
      <Field
        label="Phone number"
        value={phone}
        prefix={NEPAL_CALLING_CODE}
        onChangeText={value => setPhone(nepalPhoneInput(value))}
        placeholder="9812345678"
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        maxLength={14}
        editable={!busy}
        onSubmitEditing={submit}
      />
      {isSignup ? (
        <Field
          label="Address"
          value={address}
          onChangeText={setAddress}
          autoComplete="street-address"
          textContentType="fullStreetAddress"
          maxLength={500}
          editable={!busy}
          onSubmitEditing={submit}
        />
      ) : null}
      <Text style={styles.hint}>
        We use this device’s identifier to recognize your device when you sign
        in.
      </Text>
      <Action
        label={isSignup ? 'Create account' : 'Sign in'}
        disabled={busy || retry.remaining > 0}
        onPress={submit}
      />
      {retry.remaining > 0 ? (
        <Text accessibilityLiveRegion="polite" style={styles.hint}>
          Try again in {retry.remaining}s.
        </Text>
      ) : null}
      <Action
        label={isSignup ? 'Go to sign in' : 'Go to sign up'}
        secondary
        disabled={busy}
        onPress={() => {
          setIsSignup(!isSignup);
          setName('');
          setAddress('');
          setError('');
        }}
      />
      <Action
        label="Continue offline"
        secondary
        disabled={busy}
        onPress={() => {
          if (locked.current) return;
          locked.current = true;
          setBusy(true);
          onOffline()
            .catch(failure => setError(message(failure)))
            .finally(() => {
              locked.current = false;
              setBusy(false);
            });
        }}
      />
      {onBack ? (
        <Action
          label="Back to workspace"
          secondary
          disabled={busy}
          onPress={onBack}
        />
      ) : null}
    </Page>
  );
}
