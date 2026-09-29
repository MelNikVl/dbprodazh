import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import {
  parseSalesWorkbook,
  parseBuffer,
  ImportMappingError,
  applyRules,
  markNewEntities,
  mergeDatasets,
} from './importer';
import { parsePlanWorkbook, PlanColumnMappingError } from './importPlans';
import { DEFAULT_SETTINGS } from './types';
const headers = [
  'Город',
  'Филиал',
  'Номенклатурная группа',
  'Продукт',
  'Геометрия',
  'Номеклатура',
  'Количество, шт',
  'Вес, кг',
  'Сумма отгрузки, с НДС, тенге',
  'Год',
  'Квартал',
  'Month',
  'Название клиента',
  'Тип сети',
  'Название сети',
];
function workbook(rows: unknown[][]) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Итог', 900000]]), 'Лист2');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Лист1');
  return wb;
}
const row = [
  'Алматы',
  'Филиал',
  'Макароны',
  'КМИ',
  'Рожки',
  'Рожки 2 кг',
  10,
  20,
  10000,
  2026,
  3,
  'Сентябрь',
  'Точка 1',
  'Национальная',
  'Magnum Cash&Carry',
];
describe('real CRM schema', () => {
  it('maps another sheet using its own headers and a date instead of year/month', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Обложка']]), 'Обложка');
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['Описание выгрузки'],
        ['Shipment', 'Revenue', 'Weight', 'Item', 'Buyer'],
        ['2026-09-12', 400, 2, 'Мука 2 кг', 'Точка'],
      ]),
      'Продажи',
    );
    const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    try {
      parseBuffer(buffer, 'changed.xlsx');
      expect.fail('mapping expected');
    } catch (error) {
      expect(error).toBeInstanceOf(ImportMappingError);
      expect((error as ImportMappingError).sheets['Продажи'].headers).toContain('Revenue');
    }
    const parsed = parseBuffer(buffer, 'changed.xlsx', {
      sheet: 'Продажи',
      columns: {
        date: 'Shipment',
        amount: 'Revenue',
        weight: 'Weight',
        sku: 'Item',
        client: 'Buyer',
      },
    });
    expect(parsed.sales).toHaveLength(1);
    expect(parsed.sales[0].date).toBe('2026-09-12');
  });
  it('replaces months without double counting and updates remaining source totals', () => {
    const aug = [...row];
    aug[11] = 'Август';
    const old = parseSalesWorkbook(workbook([headers, aug, row]), 'old.xlsx');
    const updated = [...row];
    updated[8] = 20000;
    const next = parseSalesWorkbook(workbook([headers, updated]), 'new.xlsx');
    const merged = mergeDatasets(old, next);
    expect(merged.sales).toHaveLength(2);
    expect(merged.sources.find((s) => s.name === 'old.xlsx')).toMatchObject({
      rows: 1,
      amount: 10000,
      maxDate: '2026-08-01',
    });
    expect(merged.sources.find((s) => s.name === 'new.xlsx')).toMatchObject({ rows: 1, amount: 20000 });
    expect(mergeDatasets(merged, next).sales).toHaveLength(2);
  });
  it('retains plan source metadata when importing only sales', () => {
    const old = parseSalesWorkbook(workbook([headers, row]), 'old.xlsx');
    old.plans = [
      {
        label: 'Мука',
        month: 9,
        year: 2026,
        amount: null,
        tons: 1,
        source: 'plan.xlsx · СВОД!AU12',
        sourceFile: 'plan.xlsx',
      },
    ];
    old.sources.push({ name: 'plan.xlsx', kind: 'plan', rows: 1, tons: 1, warnings: [] });
    const next = parseSalesWorkbook(workbook([headers, row]), 'new.xlsx');
    const merged = mergeDatasets(old, next);
    expect(merged.sources).toHaveLength(2);
    expect(merged.sources.find((s) => s.kind === 'plan')).toMatchObject({
      name: 'plan.xlsx',
      rows: 1,
      tons: 1,
    });
  });
  it('reads raw sheet rather than pivot, kg rather than pieces, and retains returns', () => {
    const ret = [...row];
    ret[7] = -2;
    ret[8] = -1000;
    const d = parseSalesWorkbook(workbook([headers, row, ret]), '2026.xlsx');
    expect(d.sales).toHaveLength(2);
    expect(d.sources[0].amount).toBe(9000);
    expect(d.sources[0].tons).toBeCloseTo(0.018);
    expect(d.sales[0].network).toBe('Magnum МСС');
    expect(d.sales[0].date).toBe('2026-09-01');
  });
  it('retains revenue when source weight and SKU are absent and flags incompleteness', () => {
    const missing = [...row];
    missing[7] = '';
    missing[5] = '';
    const d = parseSalesWorkbook(workbook([headers, missing]), '2026.xlsx');
    expect(d.sources[0].amount).toBe(10000);
    expect(d.sales[0].missingWeight).toBe(true);
    expect(d.sources[0].warnings.some((w) => w.includes('Нет веса'))).toBe(true);
  });
  it('requires mapping for renamed columns and supports a user mapping', () => {
    const renamed = [...headers];
    renamed[8] = 'Revenue';
    expect(() => parseSalesWorkbook(workbook([renamed, row]), '2026.xlsx')).toThrow(ImportMappingError);
    expect(
      parseSalesWorkbook(workbook([renamed, row]), '2026.xlsx', { columns: { amount: 'Revenue' } }).sources[0]
        .amount,
    ).toBe(10000);
  });
  it('keeps e-commerce separate from physical Magnum and reapplies custom rules', () => {
    const online = [...row];
    online[14] = 'Magnum E-commerce Kazakhstan';
    const d = parseSalesWorkbook(workbook([headers, online]), '2026.xlsx');
    expect(d.sales[0].channel).toBe('Онлайн');
    expect(
      applyRules(d.sales, {
        ...DEFAULT_SETTINGS,
        rules: [{ pattern: 'Magnum', network: 'Проверка', channel: 'Онлайн' }],
      })[0].network,
    ).toBe('Проверка');
  });
  it('rejects decimal/out-of-range months and empty amounts without changing valid totals', () => {
    const decimal = [...row];
    decimal[11] = 1.5;
    const outside = [...row];
    outside[11] = 13;
    const blank = [...row];
    blank[8] = '';
    const result = parseSalesWorkbook(workbook([headers, row, decimal, outside, blank]), '2026.xlsx');
    expect(result.sales).toHaveLength(1);
    expect(result.sources[0].amount).toBe(10000);
    expect(result.sources[0].datePrecision).toBe('month');
    expect(result.sources[0].warnings.some((w) => w.includes('Пропущено') && w.includes('3'))).toBe(true);
  });
  it('validates actual calendar dates and preserves daily precision', () => {
    const result = parseSalesWorkbook(
      workbook([
        ['Дата', ...headers],
        ['28.02.2026', ...row],
        ['31.02.2026', ...row],
        ['2026-02-30', ...row],
        ['2026-09-28', ...row],
      ]),
      '2026.xlsx',
    );
    expect(result.sales.map((s) => s.date)).toEqual(['2026-02-28', '2026-09-28']);
    expect(result.sales.every((s) => s.datePrecision === 'day')).toBe(true);
    expect(result.sources[0].datePrecision).toBe('day');
  });
  it('restores an originally empty network when a rule is removed', () => {
    const inferred = [...row];
    inferred[12] = 'Magnum торговая точка';
    inferred[14] = '';
    const parsed = parseSalesWorkbook(workbook([headers, inferred]), '2026.xlsx').sales;
    expect(parsed[0].network).toBe('Magnum МСС');
    const cleared = applyRules(parsed, { ...DEFAULT_SETTINGS, rules: [] });
    expect(cleared[0].network).toBe('Не распределено');
    expect(cleared[0].channel).toBe('Не распределено');
  });
  it('flags new points and SKU until explicit rules resolve their classification', () => {
    const baseline = parseSalesWorkbook(workbook([headers, row]), '2026.xlsx').sales;
    const incoming = [
      {
        ...baseline[0],
        client: 'Новый клиент',
        point: 'Алматы · Новый клиент',
        sku: 'Новая номенклатура',
        rawNetwork: 'Новая локальная сеть',
      },
    ];
    expect(markNewEntities(incoming, [])).toBe(incoming);
    const marked = markNewEntities(incoming, baseline);
    const unresolved = applyRules(marked, DEFAULT_SETTINGS);
    expect(unresolved[0]).toMatchObject({
      needsClientMapping: true,
      needsSkuMapping: true,
      network: 'Не распределено',
      channel: 'Не распределено',
      group: 'Не распределено',
    });
    const resolved = applyRules(marked, {
      ...DEFAULT_SETTINGS,
      rules: [{ pattern: 'Новый клиент', network: 'Подтверждённая сеть', channel: 'Прочие клиенты' }],
      groupRules: [{ pattern: 'Новая номенклатура', group: 'Макароны ДМИ' }],
    });
    expect(resolved[0]).toMatchObject({
      network: 'Подтверждённая сеть',
      group: 'Макароны ДМИ',
      needsClientMapping: true,
      needsSkuMapping: true,
    });
    expect(markNewEntities(baseline, baseline)[0]).toMatchObject({
      needsClientMapping: false,
      needsSkuMapping: false,
    });
  });
});

describe('Category A plan mapping', () => {
  function planWorkbook() {
    const rows: unknown[][] = Array.from({ length: 12 }, () => []);
    rows[7][0] = 'TOTAL';
    rows[7][18] = 'Ген план Август 2026 кг';
    rows[7][43] = 'Опер план Август';
    rows[7][46] = 'Категория А';
    rows[8][46] = 1000;
    rows[9][0] = 'Мука';
    rows[9][46] = 1000;
    rows[10][0] = 'Алматы';
    rows[10][46] = 1000;
    rows[11][0] = 'РК';
    rows[11][46] = 1000;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'СВОД');
    wb.Sheets['СВОД'].AU8.s = { patternType: 'solid', fgColor: { rgb: '548235' } };
    return wb;
  }
  it('counts leaf cities once and never infers revenue from the volume plan', () => {
    const result = parsePlanWorkbook(planWorkbook(), 'план Август.xlsx');
    expect(result.plans).toHaveLength(1);
    expect(result.plans[0]).toMatchObject({
      group: 'Мука',
      region: 'Алматы',
      tons: 1,
      amount: null,
      month: 8,
      year: 2026,
    });
    expect(result.source.tons).toBe(1);
    expect(result.source.warnings.some((w) => w.includes('отличается от итога'))).toBe(false);
  });
  it('offers and accepts explicit mapping when the green header was renamed', () => {
    const wb = planWorkbook();
    wb.Sheets['СВОД'].AU8.v = 'Новый заголовок';
    let error: unknown;
    try {
      parsePlanWorkbook(wb, 'план Август.xlsx');
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(PlanColumnMappingError);
    expect((error as PlanColumnMappingError).headerRow).toBe(8);
    expect((error as PlanColumnMappingError).availableColumns).toContainEqual({
      column: 'AU',
      header: 'Новый заголовок',
    });
    const result = parsePlanWorkbook(wb, 'план Август.xlsx', { planColumn: 'AU' });
    expect(result.plans).toHaveLength(1);
    expect(result.source.tons).toBe(1);
    expect(result.source.warnings.some((w) => w.includes('вручную'))).toBe(true);
  });
});
