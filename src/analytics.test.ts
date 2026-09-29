import { describe, expect, it } from 'vitest';
import {
  aggregateMonthly,
  compareBy,
  coverage,
  defaultFilters,
  filterSales,
  growth,
  planAnalysis,
  planSummary,
  totals,
  totalsByYear,
} from './analytics';
import { DEFAULT_SETTINGS } from './types';
import type { Filters, PlanRow, Sale } from './types';

const sale = (year: number, month: number, amount: number, extra: Partial<Sale> = {}): Sale => ({
  date: `${year}-${String(month).padStart(2, '0')}-01`,
  year,
  month,
  day: 1,
  client: 'Клиент',
  network: 'Сеть A',
  channel: 'Ключевые сети',
  point: 'Точка 1',
  sku: 'Мука 2 кг',
  group: 'Мука',
  region: 'Алматы',
  distributor: 'Дистрибутор A',
  amount,
  tons: amount / 1000,
  ...extra,
});
const filters = (extra: Partial<Filters> = {}): Filters => ({
  start: '2026-01-01',
  end: '2026-09-30',
  channel: '',
  network: '',
  group: '',
  region: '',
  distributor: '',
  comparable: false,
  metric: 'amount',
  ...extra,
});

describe('comparable periods and zero bases', () => {
  it('defaults to the final loaded 2026 month without claiming a shipment day', () => {
    expect(defaultFilters([sale(2025, 12, 20), sale(2026, 8, 10)]).end).toBe('2026-08-31');
  });
  it('applies identical MM-DD cutoffs to every year for daily files', () => {
    const rows = [2024, 2025, 2026].flatMap((year) => [
      sale(year, 9, 10, { day: 20 }),
      sale(year, 9, 30, { day: 21 }),
      sale(year, 10, 100),
    ]);
    const result = filterSales(rows, filters({ end: '2026-09-20' }));
    expect(result).toHaveLength(3);
    expect(result.map((row) => row.day)).toEqual([20, 20, 20]);
    expect(totalsByYear(result)[2025].amount).toBe(10);
  });
  it('honors explicit daily precision when every transaction happens on the first', () => {
    const rows = [sale(2025, 8, 10, { datePrecision: 'day' }), sale(2026, 8, 20, { datePrecision: 'day' })];
    expect(defaultFilters(rows).end).toBe('2026-08-01');
    expect(filterSales(rows, filters({ start: '2026-08-02', end: '2026-08-31' }))).toHaveLength(0);
  });
  it('treats monthly CRM rows as whole months even if a requested day is midmonth', () => {
    const rows = [sale(2025, 8, 10), sale(2025, 9, 20), sale(2026, 8, 30), sale(2026, 9, 40)];
    expect(
      filterSales(rows, filters({ start: '2026-09-15', end: '2026-09-20' })).map((row) => row.amount),
    ).toEqual([20, 40]);
  });
  it('uses null for zero bases and -100% for a lost positive base', () => {
    expect(growth(0, 100)).toBeNull();
    expect(growth(0, 0)).toBeNull();
    expect(growth(100, 0)).toBe(-100);
    expect(growth(100, 125)).toBe(25);
  });
  it('requires BOTH network and distributor active in both periods', () => {
    const rows = [
      sale(2025, 1, 100),
      sale(2026, 1, 50),
      sale(2026, 1, 25, { distributor: 'Новый дистрибутор' }),
      sale(2026, 1, 30, { network: 'Новая сеть' }),
      sale(2024, 1, 80),
    ];
    const result = filterSales(rows, filters({ comparable: true }));
    expect(result).toHaveLength(3);
    expect(totalsByYear(result)[2026].amount).toBe(50);
    expect(totalsByYear(result)[2024].amount).toBe(80);
  });
  it('does not mistake a missing distributor identity for comparable data', () => {
    expect(
      filterSales(
        [sale(2025, 1, 10, { distributor: '' }), sale(2026, 1, 10, { distributor: '' })],
        filters({ comparable: true }),
      ),
    ).toHaveLength(0);
  });
  it('excludes importer placeholder identities from the comparable base', () => {
    const rows = [2025, 2026].map((year) => sale(year, 1, 10, { distributor: 'Филиал не указан' }));
    expect(filterSales(rows, filters({ comparable: true }))).toHaveLength(0);
  });
});

describe('aggregation and contributions', () => {
  it('distinguishes a missing year-month from genuine zero sales in monthly charts and exports', () => {
    const result = aggregateMonthly([
      sale(2025, 1, 100),
      sale(2026, 1, 50),
      sale(2025, 2, 100),
      sale(2025, 2, -100),
    ]);
    expect(result[0]).toMatchObject({ 2024: null, 2025: 100, 2026: 50 });
    expect(result[1]).toMatchObject({ 2024: null, 2025: 0, 2026: null });
  });
  it('reconciles dimension sums to facts without introducing subtotal rows', () => {
    const rows = [
      sale(2025, 1, 100),
      sale(2025, 1, 40, { network: 'Сеть B' }),
      sale(2026, 1, 80),
      sale(2026, 1, 60, { network: 'Сеть B' }),
    ];
    const result = compareBy(rows, 'network');
    expect(result.reduce((sum, row) => sum + row.values[2025].amount, 0)).toBe(140);
    expect(result.reduce((sum, row) => sum + row.values[2026].amount, 0)).toBe(140);
    expect(result.reduce((sum, row) => sum + row.delta, 0)).toBe(0);
  });
  it('computes share changes in percentage points, not relative percentages', () => {
    const rows = [
      sale(2025, 1, 50),
      sale(2025, 1, 50, { network: 'B' }),
      sale(2026, 1, 75),
      sale(2026, 1, 25, { network: 'B' }),
    ];
    expect(compareBy(rows, 'network').find((row) => row.name === 'Сеть A')?.shareChange).toBe(25);
  });
  it('sorts largest money losses first even in tons mode', () => {
    const rows = [
      sale(2025, 1, 100, { tons: 1 }),
      sale(2026, 1, 50, { tons: 2 }),
      sale(2025, 1, 100, { network: 'B', tons: 3 }),
      sale(2026, 1, 90, { network: 'B', tons: 1 }),
    ];
    const result = compareBy(rows, 'network', 'tons');
    expect(result[0].name).toBe('Сеть A');
    expect(result[0].delta).toBe(1);
    expect(result[0].growth).toBe(100);
  });
  it('keeps tons as tons, deduplicates active points and SKUs, includes returns in money', () => {
    const rows = [
      sale(2026, 1, 1000, { tons: 1.5 }),
      sale(2026, 2, -100, { tons: -0.1 }),
      sale(2026, 2, 50, { tons: 0.2 }),
    ];
    expect(totals(rows)).toMatchObject({ amount: 950, points: 1, skuCount: 1, rows: 3 });
    expect(totals(rows).tons).toBeCloseTo(1.6);
    expect(aggregateMonthly(rows, 'tons')[0][2026]).toBe(1.5);
  });
  it('retains revenue without counting missing client or SKU placeholders as active entities', () => {
    const result = totals([
      sale(2026, 1, 100, {
        client: 'Клиент не указан',
        point: 'Алматы · Клиент не указан',
        sku: 'Номенклатура не указана',
      }),
    ]);
    expect(result).toMatchObject({ amount: 100, rows: 1, points: 0, skuCount: 0 });
  });
  it('shows missing months per entity rather than assuming zero means complete', () => {
    const rows = [sale(2025, 1, 10), sale(2025, 2, 10), sale(2026, 1, 10)];
    const result = coverage(rows, 'network', filters({ end: '2026-02-28' }))[0];
    expect(result.missingMonths).toEqual(['Фев 2026']);
    expect(result.months).toHaveLength(6);
  });
  it('flags a selected month even when no entity has data in it', () => {
    const rows = [sale(2025, 1, 10), sale(2026, 1, 10)];
    expect(compareBy(rows, 'network', 'amount', [1, 2])[0].missingMonths).toEqual(['Фев 2025', 'Фев 2026']);
    expect(coverage(rows, 'network', filters({ end: '2026-02-28' }))[0].missingMonths).toEqual([
      'Фев 2025',
      'Фев 2026',
    ]);
  });
  it('finds lifetime dates outside the selected window and identifies lost entities', () => {
    const rows = [
      sale(2024, 12, 10, { date: '2024-12-01' }),
      sale(2025, 1, 10),
      sale(2025, 9, 10, { date: '2025-09-01' }),
    ];
    const result = coverage(rows, 'network', filters({ end: '2026-01-31' }))[0];
    expect(result.firstDate).toBe('2024-12-01');
    expect(result.lastDate).toBe('2025-09-01');
    expect(result.status).toBe('lost');
    expect(result.delta).toBe(-10);
  });
});

describe('plan analysis respects granularity and scope', () => {
  const plan: PlanRow = {
    label: 'Мука',
    month: 8,
    year: 2026,
    group: 'Мука',
    amount: 150,
    tons: 3,
    source: 'Август.xlsx',
  };
  it('compares the full month and does not include other months in the plan base', () => {
    const rows = [
      sale(2024, 8, 80),
      sale(2025, 8, 100),
      sale(2026, 8, 120),
      sale(2025, 1, 1000),
      sale(2026, 1, 1000),
    ];
    const result = planAnalysis(rows, [plan], filters(), DEFAULT_SETTINGS)[0];
    expect(result.plannedGrowth).toBe(50);
    expect(result.historicalGrowth).toBe(25);
    expect(result.actualGrowth).toBe(20);
    expect(result.completion).toBe(80);
    expect(result.gap).toBe(30);
    expect(result.assessment).toBe('Напряжённый');
    expect(result.forecast).toBeNull();
  });
  it('does not allocate a company plan to a filtered network subset', () => {
    const rows = [sale(2025, 8, 100), sale(2026, 8, 100), sale(2025, 8, 100, { network: 'B' })];
    expect(planAnalysis(rows, [plan], filters({ network: 'Сеть A' }), DEFAULT_SETTINGS)).toHaveLength(0);
  });
  it('does not label a not-yet-loaded plan month as zero completion', () => {
    const result = planAnalysis(
      [sale(2024, 8, 100), sale(2025, 8, 100), sale(2026, 7, 100)],
      [plan],
      filters(),
      DEFAULT_SETTINGS,
    )[0];
    expect(result.completion).toBeNull();
    expect(result.actualGrowth).toBeNull();
    expect(result.warning).toContain('не загружен');
  });
  it('does not invent a money plan for a volume-only spreadsheet', () => {
    const result = planAnalysis(
      [sale(2024, 8, 100), sale(2025, 8, 100), sale(2026, 8, 100)],
      [{ ...plan, amount: null }],
      filters(),
      DEFAULT_SETTINGS,
    )[0];
    expect(result.planned).toBeNull();
    expect(result.plannedGrowth).toBeNull();
    expect(result.completion).toBeNull();
  });
  it('marks rising plans against falling YTD as unrealistic', () => {
    const rows = [sale(2024, 8, 100), sale(2025, 8, 100), sale(2026, 8, 80)];
    expect(planAnalysis(rows, [{ ...plan, amount: 105 }], filters(), DEFAULT_SETTINGS)[0].assessment).toBe(
      'Нереалистичный',
    );
  });
  it('uses saved assessment thresholds including their exact boundaries', () => {
    const rows = [sale(2024, 8, 100), sale(2025, 8, 100), sale(2026, 8, 100)];
    const assess = (amount: number, realisticThreshold = 10, stretchedThreshold = 25) =>
      planAnalysis(rows, [{ ...plan, amount }], filters(), {
        ...DEFAULT_SETTINGS,
        realisticThreshold,
        stretchedThreshold,
      })[0].assessment;
    expect(assess(110)).toBe('Реалистичный');
    expect(assess(111)).toBe('Напряжённый');
    expect(assess(125)).toBe('Напряжённый');
    expect(assess(126)).toBe('Нереалистичный');
    expect(assess(126, 30, 40)).toBe('Реалистичный');
  });
  it('compares daily partial actual growth LFL and calculates a separately labeled forecast', () => {
    const rows = [
      sale(2024, 8, 80, { day: 15 }),
      sale(2025, 8, 40, { day: 15 }),
      sale(2025, 8, 60, { day: 31 }),
      sale(2026, 8, 50, { day: 15 }),
    ];
    const result = planAnalysis(rows, [plan], filters(), DEFAULT_SETTINGS)[0];
    expect(result.partial).toBe(true);
    expect(result.plannedGrowth).toBe(50);
    expect(result.actualGrowth).toBe(25);
    expect(result.completion).toBeCloseTo(100 / 3);
    expect(result.forecast).toBeCloseTo((50 / 15) * 31);
  });
  it('counts each actual once in monthly plan totals despite city and network scope overlap', () => {
    const rows = [
      sale(2024, 8, 80, { network: 'Small' }),
      sale(2025, 8, 100, { network: 'Small' }),
      sale(2026, 8, 120, { network: 'Small' }),
    ];
    const plans: PlanRow[] = [
      { ...plan, region: 'Алматы', amount: 100 },
      { ...plan, network: 'Small', amount: 50 },
    ];
    const result = planSummary(rows, plans, filters(), DEFAULT_SETTINGS)[0];
    expect(result.planned).toBe(150);
    expect(result.actual).toBe(120);
    expect(result.values[2025].amount).toBe(100);
    expect(result.completion).toBe(80);
  });
  it('preserves separate input positions when fact rows reference the same object', () => {
    const current = sale(2026, 8, 60, { network: 'Small' });
    const rows = [sale(2025, 8, 100, { network: 'Small' }), current, current];
    const plans: PlanRow[] = [
      { ...plan, region: 'Алматы', amount: 100 },
      { ...plan, network: 'Small', amount: 50 },
    ];
    expect(planSummary(rows, plans, filters(), DEFAULT_SETTINGS)[0].actual).toBe(120);
  });
  it('matches combined plan product groups and cities without distributing the plan artificially', () => {
    const rows = [
      sale(2025, 8, 100, { group: 'Макароны КМИ', region: 'Павлодар' }),
      sale(2026, 8, 50, { group: 'Жайма', region: 'Экибастуз' }),
    ];
    const combined = { ...plan, group: 'Макаронные изделия', region: 'Павлодар+Экибастуз' };
    const result = planAnalysis(rows, [combined], filters(), DEFAULT_SETTINGS)[0];
    expect(result.values[2025].amount).toBe(100);
    expect(result.actual).toBe(50);
    expect(planAnalysis(rows, [combined], filters({ group: 'Жайма' }), DEFAULT_SETTINGS)).toHaveLength(0);
  });
});
