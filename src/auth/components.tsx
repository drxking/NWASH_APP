import React from 'react';
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { Transition, usePressMotion } from '../ui/motion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
export const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Unable to complete the request.';
export function Action({
  label,
  onPress,
  disabled = false,
  secondary = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
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
      style={[styles.button, secondary && styles.secondary, motion.style]}
    >
      <Text style={[styles.buttonText, secondary && styles.secondaryText]}>
        {label}
      </Text>
    </AnimatedPressable>
  );
}
export function Field({
  label,
  prefix,
  ...props
}: React.ComponentProps<typeof TextInput> & {
  label: string;
  prefix?: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={prefix ? styles.phoneRow : undefined}>
        {prefix ? (
          <Text
            accessibilityLabel={`Country code ${prefix}`}
            style={styles.phonePrefix}
          >
            {prefix}
          </Text>
        ) : null}
        <TextInput
          accessibilityLabel={label}
          accessibilityHint={
            prefix ? `Country code ${prefix} is already included` : undefined
          }
          placeholderTextColor={colors.secondary}
          selectionColor={colors.accent}
          style={[styles.input, prefix ? styles.phoneInput : undefined]}
          {...props}
        />
      </View>
    </View>
  );
}
export function Page({
  title,
  transitionKey,
  children,
  error,
  busy,
}: {
  title: string;
  transitionKey: string;
  children: React.ReactNode;
  error?: string;
  busy?: boolean;
}) {
  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.page}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <Text style={styles.brand}>NWASH</Text>
          <Transition transitionKey={transitionKey}>
            <Text accessibilityRole="header" style={styles.title}>
              {title}
            </Text>
            {children}
            {busy ? (
              <ActivityIndicator
                style={styles.activity}
                color={colors.accent}
              />
            ) : null}
            {error ? (
              <Text
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
                style={styles.error}
              >
                {error}
              </Text>
            ) : null}
          </Transition>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
export const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  fill: { flex: 1 },
  page: {
    flexGrow: 1,
    padding: 28,
    maxWidth: 520,
    width: '100%',
    alignSelf: 'center',
  },
  brand: {
    fontFamily: 'Poppins-Bold',
    fontSize: 16,
    letterSpacing: 2,
    color: colors.text,
    marginBottom: 24,
  },
  title: {
    fontFamily: 'Poppins-SemiBold',
    fontSize: 30,
    color: colors.text,
    marginBottom: 12,
  },
  field: { marginTop: 16 },
  label: {
    fontFamily: 'Poppins-SemiBold',
    fontSize: 12,
    color: colors.secondary,
    marginBottom: 6,
    marginTop:10
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 48,
    color: colors.text,
    fontFamily: 'Poppins-Regular',
    fontSize: 14,
  },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 14,
  },
  phonePrefix: {
    color: colors.text,
    fontFamily: 'Poppins-SemiBold',
    fontSize: 14,
    paddingLeft: 14,
    paddingRight: 12,
  },
  phoneInput: { flex: 1, minWidth: 0, paddingLeft: 0 },
  button: {
    marginTop: 18,
    borderRadius: 14,
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.accent,
    paddingHorizontal: 12,
  },
  buttonText: {
    color: colors.onAccent,
    fontFamily: 'Poppins-SemiBold',
    fontSize: 13,
    textAlign: 'center',
  },
  secondary: { backgroundColor: colors.surface },
  secondaryText: { color: colors.text },
  hint: {
    color: colors.secondary,
    fontFamily: 'Poppins-Regular',
    fontSize: 13,
    lineHeight: 21,
    marginTop: 12,
  },
  error: {
    color: colors.text,
    fontFamily: 'Poppins-Regular',
    fontSize: 13,
    lineHeight: 20,
    marginTop: 18,
  },
  activity: { marginTop: 16 },
  lable:{
    fontSize:10,
    marginTop:10,
    color: colors.secondary,
  },
  tt:{
    fontSize:15,
    color: colors.text,
    fontFamily: 'Poppins-Regular',
    lineHeight: 20,
    marginLeft:10
  }
});
