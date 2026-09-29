import * as XLSX from 'xlsx';
import { DEFAULT_SETTINGS, type Dataset, type Sale, type Settings, type SourceInfo } from './types';
import { parsePlanWorkbook, PlanColumnMappingError } from './importPlans';
export { PlanColumnMappingError } from './importPlans';

const MONTHS = [
  'январь',
  'февраль',
  'март',
  'апрель',
  'май',
  'июнь',
  'июль',
  'август',
  'сентябрь',
  'октябрь',
  'ноябрь',
  'декабрь',
];
const normalize = (v: unknown) =>
  String(v ?? '')
    .trim()
    .replace(/\s+/g, ' ');
const key = (v: unknown) => normalize(v).toLowerCase().replace(/ё/g, 'е');
const number = (v: unknown) =>
  typeof v === 'number'
    ? v
    : Number(
        String(v ?? '')
          .replace(/[\s\u00a0]/g, '')
          .replace(',', '.'),
      );
const aliases: Record<string, string[]> = {
  region: ['Город', 'Регион', 'Территория'],
  distributor: ['Филиал', 'Дистрибутор', 'Дистрибьютор'],
  rawGroup: ['Номенклатурная группа', 'Группа'],
  product: ['Продукт'],
  geometry: ['Геометрия'],
  sku: ['Номеклатура', 'Номенклатура', 'SKU'],
  units: ['Количество, шт', 'Количество, шт.'],
  weight: ['Вес, кг', 'Количество, кг'],
  amount: ['Сумма отгрузки, с НДС, тенге', 'Сумма, ₸', 'Сумма', 'Сумма отгрузки'],
  year: ['Год'],
  month: ['Month', 'Месяц'],
  date: ['Дата', 'Дата отгрузки'],
  client: ['Название клиента', 'Клиент', 'Торговая точка'],
  network: ['Название сети', 'Сеть'],
};
export const FIELD_LABELS: Record<string, string> = {
  region: 'Город / регион',
  distributor: 'Филиал / дистрибутор',
  rawGroup: 'Группа',
  product: 'Продукт',
  geometry: 'Геометрия',
  sku: 'Номенклатура',
  weight: 'Вес, кг',
  amount: 'Сумма, ₸',
  year: 'Год',
  month: 'Месяц',
  date: 'Дата (вместо года и месяца)',
  client: 'Клиент / торговая точка',
  network: 'Сеть',
};
export interface ImportOverrides {
  columns?: Record<string, string>;
  sheet?: string;
  planColumn?: string;
}
export interface SheetColumns {
  headers: string[];
  detected: Record<string, string>;
}
function describeSheet(sheet: XLSX.WorkSheet, overrides: ImportOverrides = {}): SheetColumns {
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
  range.e.c = Math.min(range.e.c, 199);
  range.e.r = Math.min(range.e.r, range.s.r + 39);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, range, raw: true });
  const headers = (rows[findHeader(rows, overrides)] || []).map(normalize);
  const detected: Record<string, string> = {};
  for (const [field, names] of Object.entries(aliases)) {
    const value = headers.find((h) =>
      overrides.columns?.[field] ? h === overrides.columns[field] : names.some((a) => key(a) === key(h)),
    );
    if (value) detected[field] = value;
  }
  return { headers, detected };
}
function findHeader(rows: unknown[][], overrides: ImportOverrides): number {
  let best = 0,
    score = 0;
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const count = Object.entries(aliases).filter(([field, names]) =>
      rows[i]?.some((c) =>
        overrides.columns?.[field]
          ? normalize(c) === overrides.columns[field]
          : names.some((a) => key(a) === key(c)),
      ),
    ).length;
    if (count > score) {
      best = i;
      score = count;
    }
  }
  if (!score) {
    let textCount = 0;
    rows.slice(0, 40).forEach((row, index) => {
      const count = row.filter(
        (cell) => typeof cell === 'string' && normalize(cell) && !/^\d/.test(normalize(cell)),
      ).length;
      if (count > textCount) {
        best = index;
        textCount = count;
      }
    });
  }
  return best;
}
export class ImportMappingError extends Error {
  constructor(
    public fileName: string,
    public headers: string[],
    public missing: string[],
    public sheetNames: string[],
    public sheets: Record<string, SheetColumns> = {},
    public selectedSheet?: string,
  ) {
    super(
      `${fileName}: не найдены колонки ${missing.map((x) => FIELD_LABELS[x] || x).join(', ')}. Сопоставьте колонки вручную.`,
    );
    this.name = 'ImportMappingError';
  }
}
function groupOf(
  s: Pick<Sale, 'sku' | 'rawGroup' | 'product' | 'geometry' | 'needsSkuMapping'>,
  settings: Settings,
) {
  const text = [s.sku, s.rawGroup, s.product, s.geometry].join(' ');
  for (const rule of settings.groupRules) {
    try {
      if (new RegExp(rule.pattern, 'i').test(text)) return rule.group;
    } catch {
      /* validated in settings */
    }
  }
  if (s.needsSkuMapping) return 'Не распределено';
  if (/жайма|бешбармак/i.test(text)) return 'Жайма';
  if (/мука/i.test([s.product, s.rawGroup, s.sku].join(' '))) return 'Мука';
  if (/круп[аы]|рис|греч|пшено|перлов/i.test(text)) return 'Крупы';
  if (/дми/i.test(s.product || '')) return 'Макароны ДМИ';
  if (/кми/i.test(s.product || '')) return 'Макароны КМИ';
  if (/макарон/i.test(s.rawGroup || '') && /нцт/i.test(s.product || '')) return 'Не распределено';
  return s.rawGroup ? 'Прочее' : 'Не распределено';
}
function mapSale(s: Sale, settings: Settings): Sale {
  const rawNetwork = s.rawNetwork ?? s.network;
  const search = [rawNetwork, s.client].join(' ');
  // An explicitly blank original network must stay blank when a mapping rule is removed.
  let network = s.needsClientMapping ? 'Не распределено' : rawNetwork || 'Не распределено',
    channel = !s.needsClientMapping && rawNetwork ? 'Прочие клиенты' : 'Не распределено';
  for (const rule of settings.rules) {
    try {
      if (new RegExp(rule.pattern, 'i').test(search)) {
        network = rule.network;
        channel = rule.channel;
        break;
      }
    } catch {
      /* keep original */
    }
  }
  return { ...s, network, channel, group: groupOf(s, settings) };
}
export function applyRules(sales: Sale[], settings: Settings) {
  return sales.map((s) => mapSale(s, settings));
}
export function markNewEntities(incoming: Sale[], baseline: Sale[]): Sale[] {
  if (!baseline.length) return incoming;
  const clients = new Set(
    baseline.filter((s) => !s.needsClientMapping).map((s) => `${key(s.region)}\u0000${key(s.client)}`),
  );
  const skus = new Set(baseline.filter((s) => !s.needsSkuMapping).map((s) => key(s.sku)));
  return incoming.map((s) => ({
    ...s,
    needsClientMapping: !!s.needsClientMapping || !clients.has(`${key(s.region)}\u0000${key(s.client)}`),
    needsSkuMapping: !!s.needsSkuMapping || !skus.has(key(s.sku)),
  }));
}

/** New exports replace complete year/month partitions, never append duplicates. */
export function mergeDatasets(old: Dataset, incoming: Dataset, baseline: Sale[] = old.sales): Dataset {
  const periods = new Set(incoming.sales.map((s) => `${s.year}-${s.month}`));
  const sales = [
    ...old.sales.filter((s) => !periods.has(`${s.year}-${s.month}`)),
    ...markNewEntities(incoming.sales, baseline),
  ];
  const plans = [
    ...old.plans.filter((p) => !incoming.plans.some((n) => n.year === p.year && n.month === p.month)),
    ...incoming.plans,
  ];
  const summaries = new Map<string, SourceInfo>();
  for (const source of [...old.sources, ...incoming.sources])
    summaries.set(`${source.kind}:${source.name}`, source);
  const sources: SourceInfo[] = [];
  for (const source of summaries.values()) {
    const active =
      source.kind === 'sales'
        ? sales.filter((s) => s.sourceFile === source.name)
        : plans.filter((p) => (p.sourceFile || p.source.split(' · ')[0]) === source.name);
    if (!active.length) continue;
    const dates = source.kind === 'sales' ? (active as Sale[]).map((s) => s.date).sort() : [];
    sources.push({
      ...source,
      rows: active.length,
      amount: source.amount == null ? undefined : active.reduce((sum, s) => sum + (s.amount || 0), 0),
      tons: active.reduce((sum, s) => sum + (s.tons || 0), 0),
      minDate: dates[0] || source.minDate,
      maxDate: dates.at(-1) || source.maxDate,
      warnings:
        active.length === source.rows
          ? source.warnings
          : [
              ...source.warnings.filter((w) => !w.startsWith('Часть периодов заменена')),
              'Часть периодов заменена новой выгрузкой. Здесь показаны оставшиеся строки; замечания относятся к исходному файлу.',
            ],
    });
  }
  return { sales, plans, sources };
}

export function parseSalesWorkbook(
  wb: XLSX.WorkBook,
  name: string,
  overrides: ImportOverrides = {},
): Dataset {
  const sheetName = overrides.sheet || wb.SheetNames.find((s) => s === 'Лист1') || wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  if (!sheet) throw new Error(`Лист «${sheetName}» не найден в ${name}`);
  // Limit formatted empty columns; the audited export has 15 meaningful fields.
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
  range.e.c = Math.min(range.e.c, 199);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, range, raw: true });
  if (!rows.length) throw new Error(`${name}: лист «${sheetName}» пуст.`);
  const headerIndex = findHeader(rows, overrides);
  const headers = rows[headerIndex].map(normalize);
  const columns: Record<string, number> = {};
  for (const [field, names] of Object.entries(aliases))
    columns[field] = headers.findIndex((h) =>
      overrides.columns?.[field] ? h === overrides.columns[field] : names.some((a) => key(a) === key(h)),
    );
  const required = ['amount', 'weight', 'sku', 'client'];
  if (columns.date < 0) required.push('year', 'month');
  const missing = required.filter((f) => columns[f] < 0);
  if (missing.length)
    throw new ImportMappingError(
      name,
      headers,
      missing,
      wb.SheetNames,
      Object.fromEntries(
        Object.entries(wb.Sheets).map(([n, s]) => [n, describeSheet(s, n === sheetName ? overrides : {})]),
      ),
      sheetName,
    );
  const sales: Sale[] = [];
  let skipped = 0,
    missingWeight = 0,
    missingSku = 0,
    negative = 0,
    missingNetwork = 0,
    unknownGroup = 0;
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row?.some((v) => v !== null && v !== '')) continue;
    const get = (f: string) => (columns[f] >= 0 ? row[columns[f]] : null);
    let year = number(get('year')),
      month =
        typeof get('month') === 'number'
          ? number(get('month'))
          : MONTHS.findIndex((x) => key(get('month')).startsWith(x)) + 1,
      day = 1;
    if (columns.date >= 0) {
      const value = get('date');
      year = Number.NaN;
      month = Number.NaN;
      day = Number.NaN;
      if (value instanceof Date && !isNaN(value.getTime())) {
        year = value.getFullYear();
        month = value.getMonth() + 1;
        day = value.getDate();
      } else if (typeof value === 'number') {
        const c = XLSX.SSF.parse_date_code(value);
        if (c) {
          year = c.y;
          month = c.m;
          day = c.d;
        }
      } else {
        const text = normalize(value),
          local = /^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:$|\s)/.exec(text),
          iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|[T\s])/.exec(text);
        if (local) {
          year = +local[3];
          month = +local[2];
          day = +local[1];
        } else if (iso) {
          year = +iso[1];
          month = +iso[2];
          day = +iso[3];
        }
      }
    }
    if (!month && /^\d+$/.test(normalize(get('month')))) month = number(get('month'));
    const amount = number(get('amount')),
      weight = number(get('weight'));
    const validDate =
      [2024, 2025, 2026].includes(year) &&
      Number.isInteger(month) &&
      month >= 1 &&
      month <= 12 &&
      Number.isInteger(day) &&
      day >= 1 &&
      day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (!validDate || normalize(get('amount')) === '' || !Number.isFinite(amount)) {
      skipped++;
      continue;
    }
    const client = normalize(get('client')) || 'Клиент не указан',
      region = normalize(get('region')) || 'Регион не указан';
    const weightMissing = normalize(get('weight')) === '' || !Number.isFinite(weight);
    if (weightMissing) missingWeight++;
    if (!get('sku')) missingSku++;
    if (amount < 0 || weight < 0) negative++;
    if (!get('network')) missingNetwork++;
    const sale = mapSale(
      {
        sourceFile: name,
        date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        year,
        month,
        day,
        datePrecision: columns.date >= 0 ? 'day' : 'month',
        client,
        point: `${region} · ${client}`,
        region,
        distributor: normalize(get('distributor')) || 'Филиал не указан',
        sku: normalize(get('sku')) || 'Номенклатура не указана',
        rawGroup: normalize(get('rawGroup')),
        product: normalize(get('product')),
        geometry: normalize(get('geometry')),
        rawNetwork: normalize(get('network')),
        network: '',
        channel: '',
        group: '',
        amount,
        tons: weightMissing ? 0 : weight / 1000,
        missingWeight: weightMissing,
      },
      DEFAULT_SETTINGS,
    );
    if (sale.group === 'Не распределено') unknownGroup++;
    sales.push(sale);
  }
  if (!sales.length)
    throw new Error(`${name}: не найдено строк продаж за 2024–2026. Проверьте лист и сопоставление колонок.`);
  let amount = 0,
    tons = 0,
    minDate = sales[0].date,
    maxDate = minDate;
  for (const s of sales) {
    amount += s.amount;
    tons += s.tons;
    if (s.date < minDate) minDate = s.date;
    if (s.date > maxDate) maxDate = s.date;
  }
  const warnings = [
    'Сумма отгрузки с НДС. Отрицательные строки возвратов включены в итог.',
    'АКБ рассчитана по сочетанию города и названия клиента: отдельного кода торговой точки нет.',
  ];
  if (columns.date < 0)
    warnings.push(
      'Источник содержит месяцы без дат отгрузок. Последний месяц может быть неполным; дневной LFL и дневной прогноз недоступны.',
    );
  if (skipped) warnings.push(`Пропущено строк с некорректным периодом или суммой: ${skipped}.`);
  if (missingWeight)
    warnings.push(`Нет веса в ${missingWeight} строках: выручка сохранена, общий тоннаж неполон.`);
  if (missingSku) warnings.push(`Нет номенклатуры в ${missingSku} строках.`);
  if (missingNetwork)
    warnings.push(`Не указана сеть в ${missingNetwork} строках: проверьте «Не распределено».`);
  if (unknownGroup)
    warnings.push(`Группа не определена для ${unknownGroup} строк. Правила можно изменить в настройках.`);
  const source: SourceInfo = {
    name,
    kind: 'sales',
    rows: sales.length,
    minDate,
    maxDate,
    amount,
    tons,
    warnings,
    datePrecision: columns.date >= 0 ? 'day' : 'month',
  };
  return { sales, plans: [], sources: [source] };
}
export function parseBuffer(buffer: ArrayBuffer, name: string, overrides: ImportOverrides = {}): Dataset {
  const info = XLSX.read(buffer, { type: 'array', bookSheets: true });
  const plan =
    /план/i.test(name) ||
    (!info.SheetNames.includes('Лист1') && info.SheetNames.some((s) => key(s) === 'свод'));
  const sheet =
    overrides.sheet ||
    (plan ? info.SheetNames.find((s) => key(s) === 'свод') : info.SheetNames.find((s) => s === 'Лист1')) ||
    info.SheetNames[0];
  const wb = XLSX.read(buffer, { type: 'array', sheets: [sheet], cellStyles: plan, cellDates: false });
  if (plan) {
    const result = parsePlanWorkbook(wb, name, overrides);
    return { sales: [], plans: result.plans, sources: [result.source] };
  }
  try {
    return parseSalesWorkbook(wb, name, overrides);
  } catch (error) {
    if (error instanceof ImportMappingError) {
      const preview = XLSX.read(buffer, { type: 'array', sheetRows: 40 });
      error.sheetNames = preview.SheetNames;
      error.sheets = Object.fromEntries(
        Object.entries(preview.Sheets).map(([n, s]) => [n, describeSheet(s, n === sheet ? overrides : {})]),
      );
    }
    throw error;
  }
}
function parseAsync(buffer: ArrayBuffer, name: string, overrides: ImportOverrides = {}): Promise<Dataset> {
  if (typeof Worker === 'undefined') return Promise.resolve(parseBuffer(buffer, name, overrides));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./import.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      worker.terminate();
      if (e.data.error) {
        const err = e.data.mapping
          ? new ImportMappingError(
              name,
              e.data.mapping.headers,
              e.data.mapping.missing,
              e.data.mapping.sheetNames,
              e.data.mapping.sheets,
              e.data.mapping.selectedSheet,
            )
          : e.data.planMapping
            ? new PlanColumnMappingError(
                name,
                e.data.planMapping.availableColumns,
                e.data.planMapping.headerRow,
              )
            : new Error(e.data.error);
        reject(err);
      } else resolve(e.data.result);
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(`Не удалось прочитать ${name}: ${e.message}`));
    };
    worker.postMessage({ buffer, name, overrides }, [buffer]);
  });
}
export async function importFiles(
  files: File[],
  onProgress?: (message: string) => void,
  overrides: Record<string, ImportOverrides> = {},
): Promise<Dataset> {
  const result: Dataset = { sales: [], plans: [], sources: [] };
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    onProgress?.(`Чтение ${i + 1} из ${files.length}: ${file.name}`);
    const parsed = await parseAsync(await file.arrayBuffer(), file.name, overrides[file.name]);
    result.sales = result.sales.concat(parsed.sales);
    result.plans = result.plans.concat(parsed.plans);
    result.sources.push(...parsed.sources);
  }
  return result;
}
let localSamplesPromise: Promise<Dataset> | undefined;
let localProgress = 'Чтение файлов CRM…';
const progressListeners = new Set<(message: string) => void>();
export async function loadLocalSamples(onProgress: (message: string) => void): Promise<Dataset> {
  progressListeners.add(onProgress);
  onProgress(localProgress);
  localSamplesPromise ??= readLocalSamples((message) => {
    localProgress = message;
    for (const listener of progressListeners) listener(message);
  }).catch((error) => {
    localSamplesPromise = undefined;
    throw error;
  });
  try {
    return await localSamplesPromise;
  } finally {
    progressListeners.delete(onProgress);
  }
}
async function readLocalSamples(onProgress: (message: string) => void): Promise<Dataset> {
  const response = await fetch('/local-samples');
  if (!response.ok)
    throw new Error('Локальные файлы недоступны. Загрузите Excel через кнопку «Загрузить данные».');
  let sources: { name: string; url: string; available: boolean }[];
  try {
    sources = await response.json();
  } catch {
    throw new Error('Загрузите исходные Excel-файлы, чтобы начать анализ.');
  }
  const result: Dataset = { sales: [], plans: [], sources: [] };
  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    if (!source.available) continue;
    onProgress(`Чтение ${i + 1} из ${sources.length}: ${source.name}`);
    const response = await fetch(source.url);
    if (!response.ok) throw new Error(`Не удалось открыть ${source.name}`);
    const parsed = await parseAsync(await response.arrayBuffer(), source.name);
    result.sales = result.sales.concat(parsed.sales);
    result.plans = result.plans.concat(parsed.plans);
    result.sources.push(...parsed.sources);
  }
  if (!result.sales.length) throw new Error('Исходные файлы не найдены. Загрузите Excel-файлы продаж.');
  return result;
}
export { exportTable } from './exporter';
