import { colors } from '../theme';
import React, {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleProp,
  StyleSheet,
  ViewStyle,
} from 'react-native';

const ReducedMotion = createContext(true);

export function useReducedMotion() {
  return useContext(ReducedMotion);
}

export function MotionProvider({ children }: { children: React.ReactNode }) {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let active = true;
    let changed = false;
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      value => {
        changed = true;
        setReduced(value);
      },
    );
    AccessibilityInfo.isReduceMotionEnabled()
      .then(value => {
        if (active && !changed) setReduced(value);
      })
      .catch(() => {});
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  return (
    <ReducedMotion.Provider value={reduced}>{children}</ReducedMotion.Provider>
  );
}

// Animate transforms and opacity on the UI thread; never animate layout or delay navigation.
export function Transition({
  children,
  transitionKey,
  style,
}: {
  children: React.ReactNode;
  transitionKey: string;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useContext(ReducedMotion);
  const progress = useRef(new Animated.Value(1)).current;
  useLayoutEffect(() => {
    progress.stopAnimation();
    if (reduced) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 210,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
      isInteraction: false,
    });
    animation.start();
    return () => animation.stop();
  }, [transitionKey, reduced, progress]);
  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress.interpolate({
            inputRange: [0, 1],
            outputRange: [0.65, 1],
          }),
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [12, 0],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

export function usePressMotion() {
  const reduced = useContext(ReducedMotion);
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduced) {
      scale.stopAnimation();
      scale.setValue(1);
    }
    return () => scale.stopAnimation();
  }, [reduced, scale]);
  const animate = (toValue: number) => {
    if (reduced) return;
    Animated.spring(scale, {
      toValue,
      speed: 35,
      bounciness: 0,
      useNativeDriver: true,
      isInteraction: false,
    }).start();
  };
  return {
    style: { transform: [{ scale }] },
    onPressIn: () => animate(0.97),
    onPressOut: () => animate(1),
  };
}

export function TabIndicator({
  index,
  width,
}: {
  index: number;
  width: number;
}) {
  const reduced = useContext(ReducedMotion);
  const position = useRef(new Animated.Value(index * width)).current;
  useEffect(() => {
    if (reduced) {
      position.setValue(index * width);
      return;
    }
    const animation = Animated.spring(position, {
      toValue: index * width,
      speed: 25,
      bounciness: 0,
      useNativeDriver: true,
      isInteraction: false,
    });
    animation.start();
    return () => animation.stop();
  }, [index, width, reduced, position]);
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.indicator,
        { width, transform: [{ translateX: position }] },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  indicator: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    left: 4,
    borderRadius: 10,
    backgroundColor: colors.surface,
  },
});
