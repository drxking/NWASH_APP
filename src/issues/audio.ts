export const formatTime = (milliseconds: number) => {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

export function meterAmplitude(decibels?: number) {
  if (typeof decibels !== 'number' || !Number.isFinite(decibels)) {
    return 0.08;
  }
  return Math.max(0.08, Math.min(1, (decibels + 60) / 60));
}

// Keep actual recording peaks while bounding metadata size for long voice notes.
export function compactWaveform(samples: number[], bars = 40): number[] {
  if (samples.length <= bars) {
    return [...samples];
  }
  return Array.from({ length: bars }, (_, index) => {
    const start = Math.floor((index * samples.length) / bars);
    const end = Math.max(
      start + 1,
      Math.floor(((index + 1) * samples.length) / bars),
    );
    return Math.max(...samples.slice(start, end));
  });
}

export const clampSeek = (position: number, duration: number) =>
  Math.min(
    Math.max(0, Number.isFinite(position) ? position : 0),
    Math.max(0, duration),
  );
