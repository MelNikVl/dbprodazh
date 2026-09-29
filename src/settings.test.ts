import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './types';
import { readSettings, validateSettings } from './settings';

describe('analysis settings', () => {
  it('rejects negative, non-finite and reversed thresholds before saving', () => {
    for (const value of [-1, NaN, Infinity])
      expect(() => validateSettings({ ...DEFAULT_SETTINGS, neutralThreshold: value })).toThrow();
    expect(() =>
      validateSettings({ ...DEFAULT_SETTINGS, realisticThreshold: 30, stretchedThreshold: 20 }),
    ).toThrow('Напряжённый');
    expect(
      validateSettings({ ...DEFAULT_SETTINGS, neutralThreshold: 0, realisticThreshold: 0 }),
    ).toBeTruthy();
  });
  it('recovers from damaged browser settings and validates rule fields and expressions', () => {
    for (const saved of [
      '{',
      '{"rules":null}',
      '{"rules":[null]}',
      '{"groupRules":[{"pattern":"[","group":"Мука"}]}',
    ])
      expect(readSettings(saved)).toEqual(DEFAULT_SETTINGS);
    expect(() =>
      validateSettings({ ...DEFAULT_SETTINGS, rules: [{ pattern: '', network: 'A', channel: 'B' }] }),
    ).toThrow();
    expect(readSettings('{"neutralThreshold":2}').neutralThreshold).toBe(2);
  });
});
