export type Year = 2024 | 2025 | 2026;
export type Metric = 'amount' | 'tons';
export interface Sale {
  sourceFile?: string;
  date: string;
  year: number;
  month: number;
  day: number;
  datePrecision?: 'month' | 'day';
  client: string;
  network: string;
  channel: string;
  point: string;
  sku: string;
  group: string;
  region: string;
  distributor: string;
  amount: number;
  tons: number;
  rawNetwork?: string;
  rawGroup?: string;
  product?: string;
  geometry?: string;
  missingWeight?: boolean;
  needsClientMapping?: boolean;
  needsSkuMapping?: boolean;
}
export interface PlanRow {
  sourceFile?: string;
  label: string;
  month: number;
  year: number;
  network?: string;
  group?: string;
  region?: string;
  channel?: string;
  mappingWarning?: string;
  comparable?: boolean;
  amount: number | null;
  tons: number | null;
  source: string;
}
export interface SourceInfo {
  name: string;
  kind: 'sales' | 'plan';
  rows: number;
  minDate?: string;
  maxDate?: string;
  amount?: number;
  tons?: number;
  warnings: string[];
  datePrecision?: 'month' | 'day' | 'mixed';
}
export interface Dataset {
  sales: Sale[];
  plans: PlanRow[];
  sources: SourceInfo[];
}
export interface Filters {
  start: string;
  end: string;
  channel: string;
  network: string;
  group: string;
  region: string;
  distributor: string;
  comparable: boolean;
  metric: Metric;
}
export interface Rule {
  pattern: string;
  network: string;
  channel: string;
}
export interface Settings {
  neutralThreshold: number;
  realisticThreshold: number;
  stretchedThreshold: number;
  rules: Rule[];
  groupRules: { pattern: string; group: string }[];
}
export interface Totals {
  amount: number;
  tons: number;
  points: number;
  skuCount: number;
  rows: number;
}
export interface Comparison {
  name: string;
  values: Record<number, Totals>;
  delta: number;
  growth: number | null;
  shareChange: number;
  missingMonths: string[];
}
export const YEARS = [2024, 2025, 2026] as const;
export const GROUPS = ['Мука', 'Макароны КМИ', 'Макароны ДМИ', 'Жайма', 'Крупы', 'Прочее', 'Не распределено'];
export const DEFAULT_SETTINGS: Settings = {
  neutralThreshold: 1,
  realisticThreshold: 10,
  stretchedThreshold: 25,
  rules: [
    {
      pattern: 'e-commerce|ecommerce|e commerce|магнум.*онлайн',
      network: 'Magnum E-commerce',
      channel: 'Онлайн',
    },
    { pattern: 'арбуз|arbuz', network: 'Арбуз', channel: 'Онлайн' },
    { pattern: 'wolt|волт', network: 'Wolt', channel: 'Онлайн' },
    { pattern: 'indrive|индр', network: 'inDrive', channel: 'Онлайн' },
    { pattern: 'яндекс|yandex', network: 'Яндекс Лавка', channel: 'Онлайн' },
    { pattern: 'magnum|магнум', network: 'Magnum МСС', channel: 'Ключевые сети' },
    { pattern: 'small|смол|скиф', network: 'Small', channel: 'Ключевые сети' },
    { pattern: 'анвар|anvar', network: 'Анвар', channel: 'Ключевые сети' },
  ],
  groupRules: [],
};
