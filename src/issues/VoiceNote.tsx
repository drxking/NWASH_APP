import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Slider from '@react-native-community/slider';
import { Pause, Play, Trash2 } from 'lucide-react-native';
import { colors } from '../theme';
import { Attachment } from './model';
import { clampSeek, formatTime } from './audio';

// A shared decorative waveform, independent of each recording's amplitude.
const WAVE_HEIGHTS = [
  0.15, 0.35, 0.6, 0.9, 0.45, 0.3, 0.65, 0.95, 0.75, 0.4, 0.2, 0.5, 0.8, 0.55,
  0.3, 0.65, 1, 0.6, 0.35, 0.18, 0.48, 0.8, 0.6, 0.3, 0.65, 0.9, 0.5, 0.25,
  0.45, 0.7, 0.4, 0.15,
];

export function Waveform({
  progress = 0,
  inverted = false,
}: {
  samples?: number[];
  progress?: number;
  inverted?: boolean;
}) {
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.wave}
    >
      {WAVE_HEIGHTS.map((height, index) => (
        <View
          key={index}
          style={[
            styles.bar,
            {
              height: 4 + height * 24,
              backgroundColor:
                (index + 0.5) / WAVE_HEIGHTS.length <= progress
                  ? inverted
                    ? colors.onAccent
                    : colors.accent
                  : inverted
                  ? colors.onAccentMuted
                  : colors.muted,
            },
          ]}
        />
      ))}
    </View>
  );
}

export default function VoiceNote({
  attachment,
  index,
  active,
  paused,
  position,
  duration,
  disabled,
  removalDisabled = disabled,
  onToggle,
  onSeek,
  onRemove,
}: {
  attachment: Attachment;
  index: number;
  active: boolean;
  paused: boolean;
  position: number;
  duration: number;
  disabled: boolean;
  removalDisabled?: boolean;
  onToggle: () => void;
  onSeek: (milliseconds: number) => void;
  onRemove: () => void;
}) {
  const [dragPosition, setDragPosition] = useState<number | null>(null);
  const total = duration || attachment.durationMs || 0;
  const displayed = clampSeek(dragPosition ?? position, total);
  return (
    <View style={styles.bubble}>
      <View style={styles.heading}>
        <Text style={styles.label}>
          Voice note {String(index + 1).padStart(2, '0')}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove recording ${index + 1}`}
          disabled={removalDisabled}
          onPress={onRemove}
          style={styles.delete}
        >
          <Trash2 size={15} color={colors.secondary} strokeWidth={1.6} />
        </Pressable>
      </View>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            active && !paused
              ? `Pause recording ${index + 1}`
              : `Play ${index + 1}`
          }
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={onToggle}
          style={styles.play}
        >
          {active && !paused ? (
            <Pause size={19} color={colors.onAccent} fill={colors.onAccent} />
          ) : (
            <Play size={19} color={colors.onAccent} fill={colors.onAccent} />
          )}
        </Pressable>
        <View style={styles.timeline}>
          <View style={styles.seekArea}>
            <Waveform
              samples={attachment.waveform}
              progress={total ? displayed / total : 0}
            />
            <Slider
              accessibilityLabel={`Seek recording ${index + 1}`}
              accessibilityValue={{
                min: 0,
                max: Math.ceil(total / 1000),
                now: Math.floor(displayed / 1000),
                text: `${formatTime(displayed)} of ${formatTime(total)}`,
              }}
              style={styles.slider}
              minimumValue={0}
              maximumValue={Math.max(total, 1)}
              value={displayed}
              disabled={disabled || total <= 0}
              minimumTrackTintColor="transparent"
              maximumTrackTintColor="transparent"
              thumbTintColor={colors.accent}
              thumbSize={10}
              tapToSeek
              onSlidingStart={value => {
                setDragPosition(value);
              }}
              onValueChange={value => setDragPosition(value)}
              onSlidingComplete={value => {
                setDragPosition(null);
                onSeek(clampSeek(value, total));
              }}
            />
          </View>
          <View style={styles.times}>
            <Text style={styles.time}>{formatTime(displayed)}</Text>
            <Text style={styles.time}>{formatTime(total)}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  bubble: {
    backgroundColor: colors.soft,
    borderRadius: 22,
    padding: 14,
    paddingTop: 4,
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    fontFamily: 'Poppins-Regular',
    fontSize: 10,
    color: colors.secondary,
  },
  delete: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  play: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeline: { flex: 1, minWidth: 0 },
  seekArea: { height: 40, justifyContent: 'center' },
  wave: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 32,
    paddingHorizontal: 10,
    gap: 2,
  },
  bar: { flex: 1, maxWidth: 4, minWidth: 1, borderRadius: 3 },
  slider: { position: 'absolute', top: -2, left: -5, right: -5, height: 44 },
  times: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  time: {
    fontFamily: 'Poppins-Regular',
    fontSize: 10,
    lineHeight: 16,
    color: colors.secondary,
    fontVariant: ['tabular-nums'],
  },
});
