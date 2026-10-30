import {
  clampSeek,
  compactWaveform,
  formatTime,
  meterAmplitude,
} from '../src/issues/audio';

test('formats time and clamps seeking to playable bounds', () => {
  expect(formatTime(65000)).toBe('1:05');
  expect(clampSeek(-100, 10000)).toBe(0);
  expect(clampSeek(15000, 10000)).toBe(10000);
  expect(clampSeek(7000, 10000)).toBe(7000);
});

test('compresses actual waveform peaks without inventing amplitudes', () => {
  expect(compactWaveform([0.1, 0.8, 0.2, 0.4], 2)).toEqual([0.8, 0.4]);
  expect(compactWaveform([], 32)).toEqual([]);
});

test('normalizes microphone decibels and handles missing meter values', () => {
  expect(meterAmplitude(-30)).toBe(0.5);
  expect(meterAmplitude(-100)).toBe(0.08);
  expect(meterAmplitude(10)).toBe(1);
  expect(meterAmplitude(undefined)).toBe(0.08);
});
