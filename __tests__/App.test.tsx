import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Alert, TextInput } from 'react-native';
import App from '../App';
import {
  restore,
  remember,
  transfer,
  guest,
  endSession,
} from '../src/api/session';
import { login, signup } from '../src/api/auth';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

jest.mock('../src/issues/IssueWorkspace', () => {
  const ReactModule = require('react');
  const { View, Text, Pressable } = require('react-native');
  return function MockWorkspace({ onSignOut }: { onSignOut: () => void }) {
    return ReactModule.createElement(
      View,
      null,
      ReactModule.createElement(Text, null, 'Home'),
      ReactModule.createElement(Pressable, {
        accessibilityLabel: 'Sign out',
        onPress: onSignOut,
      }),
    );
  };
});

jest.mock('../src/api/session', () => ({
  restore: jest.fn(async () => null),
  onSessionChange: jest.fn(() => () => {}),
  endSession: jest.fn(async () => ({ revoked: true })),
  remember: jest.fn(async () => {}),
  forget: jest.fn(async () => {}),
  transfer: jest.fn(async () => {}),
  guest: { accessToken: '', user: { id: 'local-guest-v1', email: 'Guest' } },
}));
jest.mock('../src/api/auth', () => ({
  ...jest.requireActual('../src/api/auth'),
  login: jest.fn(),
  signup: jest.fn(),
}));
jest.mock('../src/api/device', () => ({ getDeviceIdentity: jest.fn() }));
const mockLogin = jest.mocked(login);
const mockSignup = jest.mocked(signup);
let renderer: ReactTestRenderer.ReactTestRenderer;

beforeEach(async () => {
  jest.mocked(restore).mockResolvedValue(null);
  jest.mocked(transfer).mockReset().mockResolvedValue(undefined);
  mockLogin.mockReset();
  mockSignup.mockReset();
  await act(async () => {
    renderer = ReactTestRenderer.create(<App />);
  });
}, 15000);
afterEach(async () => {
  await act(async () => renderer.unmount());
});

function button(label: string) {
  return renderer.root.findAll(
    node =>
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === 'function',
  )[0];
}
function input(label: string) {
  return renderer.root
    .findAllByType(TextInput)
    .find(node => node.props.accessibilityLabel === label)!;
}
async function credentials() {
  await act(async () => {
    input('Phone number').props.onChangeText('9812345678');
    if (renderer.root.findAllByType(TextInput).length === 3) {
      input('Full name').props.onChangeText('Sam Example');
      input('Address').props.onChangeText('Kathmandu');
    }
  });
}

test('invalid phone does not call the API', async () => {
  await act(async () => button('Sign in').props.onPress());
  expect(mockLogin).not.toHaveBeenCalled();
  expect(JSON.stringify(renderer.toJSON())).toContain(
    'Enter your 10-digit Nepal mobile number, for example 9812345678.',
  );
});

test('successful login opens Home and sign out returns to login', async () => {
  mockLogin.mockResolvedValue({
    accessToken: 'token',
    user: { id: '1', email: 'user@example.com' },
  });
  await credentials();
  await act(async () => button('Sign in').props.onPress());
  expect(mockLogin).toHaveBeenCalledWith('+9779812345678');
  expect(JSON.stringify(renderer.toJSON())).toContain('Home');
  expect(renderer.root.findAllByType(TextInput)).toHaveLength(0);
  const signOut = button('Sign out');
  await act(async () => signOut.props.onPress());
  expect(renderer.root.findAllByType(TextInput)).toHaveLength(1);
  expect(input('Phone number').props.value).toBeDefined();
});

test('failed login stays on login and shows the error', async () => {
  mockLogin.mockRejectedValue(new Error('Email or password is incorrect.'));
  await credentials();
  await act(async () => button('Sign in').props.onPress());
  expect(JSON.stringify(renderer.toJSON())).toContain(
    'Email or password is incorrect.',
  );
  expect(renderer.root.findAllByType(TextInput)).toHaveLength(1);
});

test('sign up creates an account and opens Home', async () => {
  mockSignup.mockResolvedValue({
    accessToken: 'token',
    user: { id: '2', phoneNumber: '+9779812345678' },
  });
  await act(async () => button('Go to sign up').props.onPress());
  await credentials();
  await act(async () => button('Create account').props.onPress());
  expect(mockSignup).toHaveBeenCalledWith(
    'Sam Example',
    '+9779812345678',
    'Kathmandu',
  );
  expect(mockLogin).not.toHaveBeenCalled();
  expect(JSON.stringify(renderer.toJSON())).toContain('Home');
});

test('signup requires an address', async () => {
  await act(async () => button('Go to sign up').props.onPress());
  await credentials();
  await act(async () => input('Address').props.onChangeText('   '));
  await act(async () => button('Create account').props.onPress());
  expect(mockSignup).not.toHaveBeenCalled();
  expect(JSON.stringify(renderer.toJSON())).toContain('Enter your address');
});

test('switching modes preserves phone and clears signup details', async () => {
  await credentials();
  await act(async () => button('Go to sign up').props.onPress());
  expect(input('Phone number').props.value).toBe('9812345678');
  await act(async () => button('Go to sign in').props.onPress());
  expect(renderer.root.findAllByType(TextInput)).toHaveLength(1);
});

test('signup requires a full name', async () => {
  await act(async () => button('Go to sign up').props.onPress());
  await credentials();
  await act(async () => input('Full name').props.onChangeText('   '));
  await act(async () => button('Create account').props.onPress());
  expect(mockSignup).not.toHaveBeenCalled();
  expect(JSON.stringify(renderer.toJSON())).toContain('Enter your full name');
});

test('guest access opens Home without calling login', async () => {
  await act(async () => button('Continue offline').props.onPress());
  expect(mockLogin).not.toHaveBeenCalled();
  expect(remember).toHaveBeenCalledWith(guest);
  expect(JSON.stringify(renderer.toJSON())).toContain('Home');
});

test('remembered account opens offline without server authentication', async () => {
  await act(async () => renderer.unmount());
  jest.mocked(restore).mockResolvedValue({
    accessToken: 'expired-token',
    user: { id: 'account', email: 'a@example.com' },
  });
  await act(async () => {
    renderer = ReactTestRenderer.create(<App />);
  });
  expect(mockLogin).not.toHaveBeenCalled();
  expect(JSON.stringify(renderer.toJSON())).toContain('Home');
});

test('offline logout explicitly reports that server revocation is unconfirmed', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.mocked(endSession).mockResolvedValueOnce({ revoked: false });
  mockLogin.mockResolvedValue({ accessToken: 'token', user: { id: '1' } });
  await credentials();
  await act(async () => button('Sign in').props.onPress());
  await act(async () => button('Sign out').props.onPress());
  expect(alert).toHaveBeenCalledWith(
    'Signed out locally',
    expect.stringContaining('Server revocation was not confirmed'),
  );
  expect(button('Sign in')).toBeDefined();
  alert.mockRestore();
});

test('duplicate signup offers login without attempting to register or sign in automatically', async () => {
  const { ApiError } = jest.requireActual('../src/api/auth');
  mockSignup.mockRejectedValueOnce(
    new ApiError(
      'An account with this phone number already exists. Sign in instead.',
      409,
    ),
  );
  await act(async () => button('Go to sign up').props.onPress());
  await credentials();
  await act(async () => button('Create account').props.onPress());
  expect(button('Go to sign in')).toBeDefined();
  expect(mockLogin).not.toHaveBeenCalled();
  await act(async () => button('Go to sign in').props.onPress());
  expect(input('Phone number').props.value).toBe('9812345678');
});

test('pasting a complete Nepal phone number keeps the prefix fixed and submits it only once', async () => {
  mockLogin.mockResolvedValue({ accessToken: 'token', user: { id: '1' } });
  await act(async () =>
    input('Phone number').props.onChangeText('+977 9812345678'),
  );
  expect(input('Phone number').props.value).toBe('9812345678');
  await act(async () => button('Sign in').props.onPress());
  expect(mockLogin).toHaveBeenCalledWith('+9779812345678');
});

test('a foreign country prefix is not silently converted to a Nepal account', async () => {
  await act(async () =>
    input('Phone number').props.onChangeText('+919812345678'),
  );
  await act(async () => button('Sign in').props.onPress());
  expect(mockLogin).not.toHaveBeenCalled();
  expect(JSON.stringify(renderer.toJSON())).toContain(
    '10-digit Nepal mobile number',
  );
});
