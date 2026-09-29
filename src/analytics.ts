import type { Comparison, Filters, Metric, PlanRow, Sale, Settings, Totals } from './types';
import { YEARS } from './types';

export type Dimension =
  'network' | 'client' | 'channel' | 'group' | 'sku' | 'region' | 'distributor' | 'point';
const MONTHS = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
const finite = (value: number) => (Number.isFinite(value) ? value : 0);
const active = (sale: Sale) => sale.amount > 0 || sale.tons > 0;
const selected = (value: string) =>
  Boolean(
    value &&
    !['Все', 'Все каналы', 'Все сети', 'Все группы', 'Все регионы', 'Все дистрибуторы', 'all'].includes(
      value,
    ),
  );
const known = (value: string) =>
  Boolean(
    value?.trim() &&
      !/(?:^|·\s*)(?:(?:клиент|номенклатура|sku|филиал|дистрибьютор|дистрибутор|регион|сеть|торговая точка)\s+)?не (?:указан[ао]?|распределено)$/i.test(value.trim()),
  );
const blankTotals = (): Totals => ({ amount: 0, tons: 0, points: 0, skuCount: 0, rows: 0 });
const emptyYears = (): Record<number, Totals> =>
  Object.fromEntries(YEARS.map((year) => [year, blankTotals()]));
const FILTER_DIMENSIONS = ['channel', 'network', 'group', 'region', 'distributor'] as const;
type Aggregate = { totals: Totals; points: Set<string>; skus: Set<string> };
const accumulator = (): Aggregate => ({ totals: blankTotals(), points: new Set(), skus: new Set() });
const yearAccumulators = (): Record<number, Aggregate> =>
  Object.fromEntries(YEARS.map((year) => [year, accumulator()]));
function accumulate(result: Aggregate, sale: Sale): void {
  result.totals.amount += finite(sale.amount);
  result.totals.tons += finite(sale.tons);
  result.totals.rows++;
  if (active(sale)) {
    if (known(sale.point)) result.points.add(`${sale.region}\u0000${sale.point}`);
    if (known(sale.sku)) result.skus.add(sale.sku);
  }
}
function finish(result: Aggregate): Totals {
  result.totals.points = result.points.size;
  result.totals.skuCount = result.skus.size;
  return result.totals;
}
const finishYears = (results: Record<number, Aggregate>): Record<number, Totals> =>
  Object.fromEntries(YEARS.map((year) => [year, finish(results[year])]));

/** Returns null for a zero base, including zero-to-zero: no invented percent. */
export function growth(base: number, current: number): number | null {
  return Number.isFinite(base) && Number.isFinite(current) && base !== 0
    ? ((current - base) / base) * 100
    : null;
}

/** Supplied CRM exports contain months, not transaction days. */
export function isMonthlyData(sales: Sale[]): boolean {
  return (
    sales.length > 0 &&
    sales.every((sale) => sale.datePrecision === 'month' || (!sale.datePrecision && sale.day === 1))
  );
}

export function defaultFilters(sales: Sale[]): Filters {
  const current = sales.filter((sale) => sale.year === 2026);
  const latest = (current.length ? current : sales).reduce<Sale | undefined>(
    (last, sale) => (!last || sale.month * 100 + sale.day > last.month * 100 + last.day ? sale : last),
    undefined,
  );
  const month = latest?.month ?? 12;
  const day = latest
    ? isMonthlyData(sales)
      ? new Date(Date.UTC(2026, month, 0)).getUTCDate()
      : latest.day
    : 31;
  return {
    start: '2026-01-01',
    end: `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    channel: '',
    network: '',
    group: '',
    region: '',
    distributor: '',
    comparable: false,
    metric: 'amount',
  };
}

function dateParts(value: string, fallback: [number, number]): [number, number] {
  const match = /^\d{4}-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return fallback;
  const month = Number(match[1]),
    day = Number(match[2]);
  return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? [month, day] : fallback;
}

export function periodMonths(filters: Pick<Filters, 'start' | 'end'>): number[] {
  const [start] = dateParts(filters.start, [1, 1]);
  const [end] = dateParts(filters.end, [12, 31]);
  return Array.from({ length: 12 }, (_, index) => index + 1).filter((month) =>
    start <= end ? month >= start && month <= end : month >= start || month <= end,
  );
}

function periodBounds(filters: Pick<Filters, 'start' | 'end'>, monthly: boolean): [number, number] {
  const [startMonth, startDay] = dateParts(filters.start, [1, 1]);
  const [endMonth, endDay] = dateParts(filters.end, [12, 31]);
  const start = startMonth * 100 + (monthly ? 1 : startDay);
  const end = endMonth * 100 + (monthly ? 31 : endDay);
  return [start, end];
}

/** A single month/day window is applied to every year; comparable means both identities existed in both years. */
export function filterSales(sales: Sale[], filters: Filters): Sale[] {
  const monthly = isMonthlyData(sales);
  const [start, end] = periodBounds(filters, monthly);
  const dimensions = FILTER_DIMENSIONS.filter((key) => selected(filters[key]));
  const filtered = sales.filter((sale) => {
    const value = sale.month * 100 + sale.day;
    return (
      sale.year >= 2024 &&
      sale.year <= 2026 &&
      (start <= end ? value >= start && value <= end : value >= start || value <= end) &&
      dimensions.every((key) => sale[key] === filters[key])
    );
  });
  if (!filters.comparable) return filtered;
  const networks25 = new Set<string>(),
    networks26 = new Set<string>(),
    distributors25 = new Set<string>(),
    distributors26 = new Set<string>();
  for (const sale of filtered) {
    if (!active(sale)) continue;
    if (sale.year === 2025) {
      if (known(sale.network)) networks25.add(sale.network);
      if (known(sale.distributor)) distributors25.add(sale.distributor);
    } else if (sale.year === 2026) {
      if (known(sale.network)) networks26.add(sale.network);
      if (known(sale.distributor)) distributors26.add(sale.distributor);
    }
  }
  const networks = new Set([...networks25].filter((name) => networks26.has(name)));
  const distributors = new Set([...distributors25].filter((name) => distributors26.has(name)));
  return filtered.filter((sale) => networks.has(sale.network) && distributors.has(sale.distributor));
}

export function totals(sales: Sale[]): Totals {
  const result = accumulator();
  for (const sale of sales) accumulate(result, sale);
  return finish(result);
}

export function totalsByYear(sales: Sale[]): Record<number, Totals> {
  const results = yearAccumulators();
  for (const sale of sales) if (results[sale.year]) accumulate(results[sale.year], sale);
  return finishYears(results);
}

export function compareBy(
  sales: Sale[],
  dimension: Dimension,
  metric: Metric = 'amount',
  expectedMonths?: number[],
): Comparison[] {
  const grouped = new Map<string, { values: Record<number, Aggregate>; months: Set<number> }>();
  const all = emptyYears();
  const observedMonths = new Set<number>();
  for (const sale of sales) {
    if (!all[sale.year]) continue;
    const name = sale[dimension] || 'Не указано';
    let own = grouped.get(name);
    if (!own) {
      own = { values: yearAccumulators(), months: new Set() };
      grouped.set(name, own);
    }
    accumulate(own.values[sale.year], sale);
    own.months.add(sale.year * 100 + sale.month);
    observedMonths.add(sale.month);
    all[sale.year].amount += finite(sale.amount);
    all[sale.year].tons += finite(sale.tons);
  }
  const expected = [...new Set(expectedMonths ?? observedMonths)].sort((a, b) => a - b);
  return [...grouped]
    .map(([name, own]): Comparison => {
      const values = finishYears(own.values);
      const missingMonths = [2025, 2026].flatMap((year) =>
        expected
          .filter((month) => !own.months.has(year * 100 + month))
          .map((month) => `${MONTHS[month - 1]} ${year}`),
      );
      const share = (year: number) =>
        all[year][metric] !== 0 ? (values[year][metric] / all[year][metric]) * 100 : 0;
      return {
        name,
        values,
        delta: values[2026][metric] - values[2025][metric],
        growth: growth(values[2025][metric], values[2026][metric]),
        shareChange: share(2026) - share(2025),
        missingMonths,
      };
    })
    .sort(
      (a, b) =>
        a.values[2026].amount - a.values[2025].amount - (b.values[2026].amount - b.values[2025].amount) ||
        a.name.localeCompare(b.name, 'ru'),
    );
}

export interface MonthlyRow {
  month: number;
  label: string;
  2024: number | null;
  2025: number | null;
  2026: number | null;
}
export function aggregateMonthly(sales: Sale[], metric: Metric = 'amount'): MonthlyRow[] {
  const months = new Map<number, MonthlyRow>();
  for (const sale of sales) {
    if (sale.year < 2024 || sale.year > 2026) continue;
    let row = months.get(sale.month);
    if (!row) {
      row = { month: sale.month, label: MONTHS[sale.month - 1], 2024: null, 2025: null, 2026: null };
      months.set(sale.month, row);
    }
    const year = sale.year as 2024 | 2025 | 2026;
    row[year] = (row[year] ?? 0) + finite(sale[metric]);
  }
  return [...months.values()].sort((a, b) => a.month - b.month);
}

export interface CoverageMonth {
  key: string;
  label: string;
  year: number;
  month: number;
  hasData: boolean;
}
export interface CoverageRow {
  name: string;
  firstDate: string;
  lastDate: string;
  delta: number;
  months: CoverageMonth[];
  missingMonths: string[];
  status: 'new' | 'lost' | 'active';
}
export function coverage(sales: Sale[], dimension: Dimension = 'network', filters?: Filters): CoverageRow[] {
  const rows = filters ? filterSales(sales, { ...filters, comparable: false }) : sales;
  const grouped = new Map<
    string,
    { months: Set<number>; amount25: number; amount26: number; active25: boolean; active26: boolean }
  >();
  const observed = new Set<number>();
  for (const sale of rows) {
    const name = sale[dimension] || 'Не указано';
    let own = grouped.get(name);
    if (!own) {
      own = { months: new Set(), amount25: 0, amount26: 0, active25: false, active26: false };
      grouped.set(name, own);
    }
    own.months.add(sale.year * 100 + sale.month);
    observed.add(sale.month);
    if (sale.year === 2025) {
      own.amount25 += finite(sale.amount);
      own.active25 ||= active(sale);
    }
    if (sale.year === 2026) {
      own.amount26 += finite(sale.amount);
      own.active26 ||= active(sale);
    }
  }
  const bounds = new Map<string, { firstDate: string; lastDate: string }>();
  for (const sale of sales) {
    if (!active(sale)) continue;
    const name = sale[dimension] || 'Не указано';
    if (!grouped.has(name)) continue;
    const current = bounds.get(name);
    if (!current) bounds.set(name, { firstDate: sale.date, lastDate: sale.date });
    else {
      if (sale.date < current.firstDate) current.firstDate = sale.date;
      if (sale.date > current.lastDate) current.lastDate = sale.date;
    }
  }
  const expected = filters ? periodMonths(filters) : [...observed].sort((a, b) => a - b);
  return [...grouped]
    .map(([name, own]): CoverageRow => {
      const months = YEARS.flatMap((year) =>
        expected.map((month) => ({
          key: `${year}-${String(month).padStart(2, '0')}`,
          label: `${MONTHS[month - 1]} ${year}`,
          year,
          month,
          hasData: own.months.has(year * 100 + month),
        })),
      );
      return {
        name,
        firstDate: bounds.get(name)?.firstDate ?? '',
        lastDate: bounds.get(name)?.lastDate ?? '',
        delta: own.amount26 - own.amount25,
        months,
        missingMonths: months
          .filter((month) => month.year !== 2024 && !month.hasData)
          .map((month) => month.label),
        status: !own.active25 && own.active26 ? 'new' : own.active25 && !own.active26 ? 'lost' : 'active',
      };
    })
    .sort((a, b) => a.delta - b.delta || a.name.localeCompare(b.name, 'ru'));
}

type ScopedPlan = PlanRow & {
  region?: string;
  channel?: string;
  distributor?: string;
  comparable?: boolean;
  mappingWarning?: string;
};
export interface PlanAnalysisRow {
  plan: PlanRow;
  label: string;
  month: number;
  year: number;
  values: Record<number, Totals>;
  planned: number | null;
  actual: number;
  historicalGrowth: number | null;
  plannedGrowth: number | null;
  actualGrowth: number | null;
  completion: number | null;
  gap: number | null;
  ytdGrowth: number | null;
  assessment: 'Реалистичный' | 'Напряжённый' | 'Нереалистичный' | 'Нет базы';
  warning: string | null;
  forecast: number | null;
  comparable: boolean;
  partial: boolean;
}

interface PlanScope {
  indices: number[];
  rows: Sale[];
}
/** One pass per dimension combination, not one pass per plan row. Shared month scopes reuse the same indices. */
function indexPlanScopes(sales: Sale[], plans: PlanRow[]): Map<PlanRow, PlanScope> {
  const indicesByDimensions = new Map<string, Map<string, number[]>>();
  const scopes = new Map<string, PlanScope>();
  const result = new Map<PlanRow, PlanScope>();
  for (const rawPlan of plans) {
    const plan = rawPlan as ScopedPlan;
    const dimensions = FILTER_DIMENSIONS.filter((key) => Boolean(plan[key]));
    const signature = dimensions.join('|');
    let index = indicesByDimensions.get(signature);
    if (!index) {
      index = new Map();
      for (let i = 0; i < sales.length; i++) {
        const key = JSON.stringify(dimensions.map((dimension) => sales[i][dimension]));
        let items = index.get(key);
        if (!items) {
          items = [];
          index.set(key, items);
        }
        items.push(i);
      }
      indicesByDimensions.set(signature, index);
    }
    let combinations: string[][] = [[]];
    for (const dimension of dimensions) {
      const value = plan[dimension]!;
      const alternatives =
        dimension === 'group' && value === 'Макаронные изделия'
          ? ['Макароны КМИ', 'Жайма']
          : dimension === 'region' && value.includes('+')
            ? [...new Set(value.split('+').map((part) => part.trim()))]
            : [value];
      combinations = combinations.flatMap((prefix) => alternatives.map((option) => [...prefix, option]));
    }
    const keys = combinations.map((combination) => JSON.stringify(combination));
    const scopeKey = signature + JSON.stringify(keys);
    let scope = scopes.get(scopeKey);
    if (!scope) {
      const indices =
        keys.length === 1
          ? (index.get(keys[0]) ?? [])
          : keys.flatMap((key) => index.get(key) ?? []).sort((a, b) => a - b);
      scope = { indices, rows: indices.map((i) => sales[i]) };
      scopes.set(scopeKey, scope);
    }
    result.set(rawPlan, scope);
  }
  return result;
}

function compatiblePlan(plan: ScopedPlan, scope: Sale[], filters: Filters): boolean {
  // A plan without a dimension cannot be allocated to a selected subset of that dimension.
  return FILTER_DIMENSIONS.every((key) => {
    if (!selected(filters[key])) return true;
    if (plan[key]) return plan[key] === filters[key];
    return scope.length > 0 && scope.every((sale) => sale[key] === filters[key]);
  });
}

/** Plan percentages use the plan's month and scope, never a YTD or subset actual against a full-month plan. */
export function planAnalysis(
  sales: Sale[],
  plans: PlanRow[],
  filters: Filters,
  settings: Settings,
): PlanAnalysisRow[] {
  const months = periodMonths(filters);
  const monthly = isMonthlyData(sales);
  const cutoff = defaultFilters(sales).end;
  const [cutoffMonth, cutoffDay] = dateParts(cutoff, [12, 31]);
  const selectedPlans = plans.filter((plan) => months.includes(plan.month));
  const scopes = indexPlanScopes(sales, selectedPlans);
  const networkPlans = new Map<string, Set<string>>();
  for (const plan of selectedPlans)
    if (plan.network) {
      const key = `${plan.year}-${plan.month}`;
      const networks = networkPlans.get(key) ?? new Set<string>();
      networks.add(plan.network);
      networkPlans.set(key, networks);
    }
  return selectedPlans.flatMap((rawPlan) => {
    const plan = rawPlan as ScopedPlan;
    const scope = scopes.get(rawPlan)!.rows;
    if (!compatiblePlan(plan, scope, filters)) return [];
    const monthlyRows = scope.filter((sale) => sale.month === plan.month);
    let values = totalsByYear(monthlyRows);
    const planned = plan[filters.metric];
    const hasCurrent = monthlyRows.some((sale) => sale.year === 2026);
    const historicalAvailable = [2024, 2025].every((year) => monthlyRows.some((sale) => sale.year === year));
    const partial =
      !monthly &&
      hasCurrent &&
      plan.month === cutoffMonth &&
      cutoffDay < new Date(Date.UTC(2026, cutoffMonth, 0)).getUTCDate();
    let warning: string | null = plan.mappingWarning ?? null;
    let comparable = plan.comparable !== false;
    if (!scope.length) {
      comparable = false;
      warning = warning ?? 'Не найден факт для измерений строки плана.';
    }
    if (filters.comparable) {
      comparable = false;
      warning = 'План задан для полной базы. Отключите сопоставимую базу для сравнения.';
    }
    if (planned === null)
      warning = warning ?? `В файле нет плана в ${filters.metric === 'amount' ? 'деньгах' : 'тоннах'}.`;
    if (!hasCurrent) warning = warning ?? 'Факт 2026 за этот месяц не загружен; выполнение не рассчитано.';
    if (partial)
      warning =
        warning ?? `Выполнение на ${cutoffDay}-е число; рост факта сравнивается за одинаковые дни месяца.`;
    if (!historicalAvailable)
      warning = warning ?? 'Не загружен один из исторических месяцев; оценка ограничена.';
    const overlappingNetworks = networkPlans.get(`${plan.year}-${plan.month}`);
    if (
      plan.region &&
      !plan.network &&
      overlappingNetworks &&
      scope.some((sale) => overlappingNetworks.has(sale.network))
    ) {
      const overlap =
        'Городской факт может включать Small, для которого план задан отдельно. Факты строк не суммируются; используйте итог месяца.';
      warning = warning ? `${warning} ${overlap}` : overlap;
    }
    const ytd = filterSales(scope, { ...filters, start: '2026-01-01', end: cutoff, comparable: false });
    const ytdValues = totalsByYear(ytd);
    const ytdGrowth = comparable
      ? growth(ytdValues[2025][filters.metric], ytdValues[2026][filters.metric])
      : null;
    const historicalGrowth =
      comparable && historicalAvailable
        ? growth(values[2024][filters.metric], values[2025][filters.metric])
        : null;
    const plannedGrowth =
      comparable && planned !== null && monthlyRows.some((sale) => sale.year === 2025)
        ? growth(values[2025][filters.metric], planned)
        : null;
    let actualGrowth =
      comparable && hasCurrent && monthlyRows.some((sale) => sale.year === 2025)
        ? growth(values[2025][filters.metric], values[2026][filters.metric])
        : null;
    if (partial) {
      const lfl = totalsByYear(monthlyRows.filter((sale) => sale.day <= cutoffDay));
      actualGrowth = comparable ? growth(lfl[2025][filters.metric], lfl[2026][filters.metric]) : null;
    }
    const actual = values[2026][filters.metric];
    const completion =
      comparable && hasCurrent && planned !== null && planned > 0 ? (actual / planned) * 100 : null;
    const gap = plannedGrowth !== null && actualGrowth !== null ? plannedGrowth - actualGrowth : null;
    let assessment: PlanAnalysisRow['assessment'] = 'Нет базы';
    if (plannedGrowth !== null && historicalGrowth !== null) {
      const excess = plannedGrowth - historicalGrowth;
      assessment =
        (plannedGrowth > 0 && ytdGrowth !== null && ytdGrowth < 0) || excess > settings.stretchedThreshold
          ? 'Нереалистичный'
          : excess > settings.realisticThreshold
            ? 'Напряжённый'
            : 'Реалистичный';
    }
    const forecast =
      comparable && partial
        ? (actual / cutoffDay) * new Date(Date.UTC(2026, cutoffMonth, 0)).getUTCDate()
        : null;
    if (!comparable) values = emptyYears();
    return [
      {
        plan: rawPlan,
        label: rawPlan.label,
        month: plan.month,
        year: plan.year,
        values,
        planned,
        actual: comparable ? actual : 0,
        historicalGrowth,
        plannedGrowth,
        actualGrowth,
        completion,
        gap,
        ytdGrowth,
        assessment,
        warning,
        forecast,
        comparable,
        partial,
      },
    ];
  });
}

/** Monthly plan totals reconcile to the workbook; each fact row enters the union of plan scopes only once. */
export function planSummary(
  sales: Sale[],
  plans: PlanRow[],
  filters: Filters,
  settings: Settings,
): PlanAnalysisRow[] {
  const months = periodMonths(filters);
  const selectedPlans = plans.filter((plan) => months.includes(plan.month));
  const scopes = indexPlanScopes(sales, selectedPlans);
  const eligible = selectedPlans.filter((plan) => compatiblePlan(plan, scopes.get(plan)!.rows, filters));
  const keys = [...new Set(eligible.map((plan) => `${plan.year}-${plan.month}`))];
  return keys.flatMap((key) => {
    const own = eligible.filter((plan) => `${plan.year}-${plan.month}` === key);
    const first = own[0];
    const metricExists = own.every((plan) => plan[filters.metric] !== null);
    const planned = metricExists ? own.reduce((sum, plan) => sum + (plan[filters.metric] ?? 0), 0) : null;
    const syntheticPlan: PlanRow = {
      label: `Итого · ${MONTHS[first.month - 1]}`,
      month: first.month,
      year: first.year,
      amount: filters.metric === 'amount' ? planned : null,
      tons: filters.metric === 'tons' ? planned : null,
      source: [...new Set(own.map((plan) => plan.source.split(' · ')[0]))].join(', '),
      comparable: own.every((plan) => plan.comparable !== false),
    };
    // Index positions preserve separate fact rows even if callers reuse the same Sale object.
    const included = new Uint8Array(sales.length);
    for (const plan of own) for (const index of scopes.get(plan)!.indices) included[index] = 1;
    const scope = sales.filter((_, index) => included[index] === 1);
    // Dimension selection was validated at leaf-plan level. The union is already the requested scope.
    const result = planAnalysis(
      scope,
      [syntheticPlan],
      { ...filters, network: '', group: '', region: '', channel: '', distributor: '' },
      settings,
    )[0];
    if (!result) return [];
    const notes = [
      ...new Set(own.map((plan) => plan.mappingWarning).filter((note): note is string => Boolean(note))),
    ];
    if (notes.length) result.warning = [result.warning, ...notes].filter(Boolean).join(' ');
    return [result];
  });
}
