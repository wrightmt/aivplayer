import { describe, expect, it } from 'vitest';
import { formatDb, formatTime } from '../../src/renderer/src/lib/format';

describe('format', () => {
  it('formats seconds as m:ss', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(61.9)).toBe('1:01');
    expect(formatTime(754)).toBe('12:34');
    expect(formatTime(-3)).toBe('0:00');
    expect(formatTime(NaN)).toBe('0:00');
  });

  it('formats decibels with sign', () => {
    expect(formatDb(3)).toBe('+3 dB');
    expect(formatDb(0)).toBe('0 dB');
    expect(formatDb(-12.4)).toBe('-12 dB');
  });
});
