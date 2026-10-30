import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { AccessibilityInfo, Animated, Text } from 'react-native';
import { MotionProvider, Transition } from '../src/ui/motion';

let tree: Renderer.ReactTestRenderer;
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  jest.restoreAllMocks();
});

test('uses native transitions and cancels interrupted transitions', async () => {
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(false);
  const stop = jest.fn();
  const timing = jest
    .spyOn(Animated, 'timing')
    .mockReturnValue({ start: jest.fn(), stop, reset: jest.fn() });
  const screen = (key: string) => (
    <MotionProvider>
      <Transition transitionKey={key}>
        <Text>{key}</Text>
      </Transition>
    </MotionProvider>
  );
  await act(async () => {
    tree = Renderer.create(screen('login'));
  });
  expect(timing).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.objectContaining({ useNativeDriver: true, isInteraction: false }),
  );
  await act(async () => tree.update(screen('signup')));
  expect(stop).toHaveBeenCalled();
  expect(tree.root.findByType(Text).props.children).toBe('signup');
});

test('keeps navigation immediate and static when Reduce Motion is enabled', async () => {
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(true);
  const timing = jest.spyOn(Animated, 'timing');
  const screen = (key: string) => (
    <MotionProvider>
      <Transition transitionKey={key}>
        <Text>{key}</Text>
      </Transition>
    </MotionProvider>
  );
  await act(async () => {
    tree = Renderer.create(screen('login'));
  });
  await act(async () => tree.update(screen('signup')));
  expect(timing).not.toHaveBeenCalled();
  expect(tree.root.findByType(Text).props.children).toBe('signup');
});
