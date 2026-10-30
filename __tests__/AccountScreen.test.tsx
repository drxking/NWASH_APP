import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Alert } from 'react-native';
import AccountScreen from '../src/auth/AccountScreen';
import { endSession } from '../src/api/tokens';
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../src/api/tokens', () => ({
  endSession: jest.fn(),
}));
let tree: Renderer.ReactTestRenderer;
const session = { accessToken: 'token', user: { id: 'original-owner' } };
const signedOut = jest.fn();
const button = (label: string) =>
  tree.root.findAll(
    node =>
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === 'function',
  )[0];
beforeEach(async () => {
  jest.clearAllMocks();
  await act(async () => {
    tree = Renderer.create(
      <AccountScreen
        session={session}
        onBack={jest.fn()}
        onSignedOut={signedOut}
        onLogin={jest.fn()}
      />,
    );
  });
});
afterEach(async () => {
  await act(async () => tree.unmount());
  jest.restoreAllMocks();
});
test('forget-device requires an explicit confirmation and uses the separate revocation action', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.mocked(endSession).mockResolvedValue({ revoked: true });
  await act(async () => button('Forget this device').props.onPress());
  expect(endSession).not.toHaveBeenCalled();
  const confirmation = alert.mock.calls[0][2]![1];
  await act(async () => confirmation.onPress!());
  expect(endSession).toHaveBeenCalledWith(session, true);
  expect(signedOut).toHaveBeenCalledWith(true);
});
