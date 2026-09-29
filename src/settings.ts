import { DEFAULT_SETTINGS, type Settings } from './types';

export function validateSettings(value: Settings): Settings {
  const thresholds = [value.neutralThreshold, value.realisticThreshold, value.stretchedThreshold];
  if (
    thresholds.some(
      (threshold) => typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 0,
    )
  )
    throw new Error('Пороги должны быть конечными числами не меньше нуля');
  if (value.realisticThreshold > value.stretchedThreshold)
    throw new Error('Напряжённый порог должен быть не меньше реалистичного');
  if (!Array.isArray(value.rules) || !Array.isArray(value.groupRules))
    throw new Error('Ожидается JSON-массив правил');
  for (const rule of value.rules) {
    if (
      !rule ||
      [rule.pattern, rule.network, rule.channel].some((field) => typeof field !== 'string' || !field.trim())
    )
      throw new Error('Правило сети: заполните pattern, network, channel');
    new RegExp(rule.pattern, 'i');
  }
  for (const rule of value.groupRules) {
    if (!rule || [rule.pattern, rule.group].some((field) => typeof field !== 'string' || !field.trim()))
      throw new Error('Правило группы: заполните pattern, group');
    new RegExp(rule.pattern, 'i');
  }
  return value;
}

export function readSettings(saved: string | null): Settings {
  try {
    return validateSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(saved || '{}') });
  } catch {
    return DEFAULT_SETTINGS;
  }
}
