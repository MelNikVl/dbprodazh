import * as XLSX from 'xlsx';
import type { PlanRow, SourceInfo } from './types';

const MONTHS = [
  'январ',
  'феврал',
  'март',
  'апрел',
  'ма',
  'июн',
  'июл',
  'август',
  'сентябр',
  'октябр',
  'ноябр',
  'декабр',
];
const CITIES = new Set([
  'алматы',
  'астана',
  'актау',
  'актобе',
  'атырау',
  'уральск',
  'жезказган',
  'караганда',
  'павлодар',
  'павлодар+экибастуз',
  'экибастуз',
  'балхаш',
  'тараз',
  'кызылорда',
  'шымкент',
  'костанай',
  'кокшетау',
  'щучинск',
  'петропавловск',
  'семей',
  'усть-каменогорск',
  'талдыкорган',
]);
const GROUPS: Record<string, string> = {
  мука: 'Мука',
  'макаронные изделия': 'Макаронные изделия',
  крупы: 'Крупы',
  дми: 'Макароны ДМИ',
};
const normalized = (v: unknown) =>
  String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е');
const valueAt = (sheet: XLSX.WorkSheet, row: number, column: number): unknown =>
  sheet[XLSX.utils.encode_cell({ r: row, c: column })]?.v;
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
export class PlanColumnMappingError extends Error {
  constructor(
    public fileName: string,
    public availableColumns: { column: string; header: string }[],
    public headerRow: number,
  ) {
    super(`В «${fileName}» не найден заголовок «Категория А». Выберите столбец плана вручную.`);
    this.name = 'PlanColumnMappingError';
  }
}
function greenFill(cell: XLSX.CellObject | undefined): boolean {
  const style = cell?.s;
  const color = style?.fgColor ?? style?.fill?.fgColor;
  if (!color) return false;
  if (color.theme === 9) return true;
  const rgb = String(color.rgb ?? '').slice(-6);
  if (!/^[0-9a-f]{6}$/i.test(rgb)) return false;
  const red = parseInt(rgb.slice(0, 2), 16),
    green = parseInt(rgb.slice(2, 4), 16),
    blue = parseInt(rgb.slice(4, 6), 16);
  return green > red * 1.05 && green > blue * 1.05;
}

/** Read only the leaf rows of the supplied СВОД. The green A-category column is kg.
 * Workbook totals and regional subtotals are checks, never additional plan records.
 */
export function parsePlanWorkbook(
  wb: XLSX.WorkBook,
  name: string,
  overrides: { planColumn?: string } = {},
): { plans: PlanRow[]; source: SourceInfo } {
  const sheetName = wb.SheetNames.find((n) => normalized(n) === 'свод');
  if (!sheetName) throw new Error(`В файле «${name}» нет листа «СВОД». План категории А не найден.`);
  const sheet = wb.Sheets[sheetName];
  if (!sheet['!ref']) throw new Error(`Лист «${sheetName}» пуст.`);
  const range = XLSX.utils.decode_range(sheet['!ref']);
  let headerRow = -1;
  let planColumn = -1;
  let inferredHeader = 0;
  let highestScore = -1;
  const candidates: { row: number; column: number; green: boolean }[] = [];
  for (let r = 0; r <= Math.min(range.e.r, 29); r++) {
    let score = 0;
    for (let c = 0; c <= Math.min(range.e.c, 150); c++) {
      const label = normalized(valueAt(sheet, r, c));
      if (/опер.?\s*план/.test(label)) score += 5;
      if (/^horeca$|^трад.*розница$|^ген\s*план/.test(label)) score++;
      if (/^категория\s*[аa]$/.test(label))
        candidates.push({ row: r, column: c, green: greenFill(sheet[XLSX.utils.encode_cell({ r, c })]) });
    }
    if (score > highestScore) {
      highestScore = score;
      inferredHeader = r;
    }
  }
  const candidate = candidates.find((c) => c.green) ?? candidates[0];
  if (candidate) {
    headerRow = candidate.row;
    planColumn = candidate.column;
  } else headerRow = inferredHeader;
  const availableColumns = Array.from({ length: Math.min(range.e.c + 1, 151) }, (_, c) => ({
    column: XLSX.utils.encode_col(c),
    header: String(valueAt(sheet, headerRow, c) ?? '').trim(),
  })).filter((c) => c.header);
  if (!candidate && !overrides.planColumn?.trim())
    throw new PlanColumnMappingError(name, availableColumns, headerRow + 1);
  if (overrides.planColumn?.trim()) {
    const column = overrides.planColumn.trim().toUpperCase();
    if (!/^[A-Z]{1,3}$/.test(column)) throw new Error('Столбец плана задаётся буквами Excel, например AU.');
    planColumn = XLSX.utils.decode_col(column);
    if (planColumn > range.e.c) throw new Error(`Столбец ${column} отсутствует на листе «СВОД».`);
  }
  const header = normalized(valueAt(sheet, headerRow, planColumn));
  if (!header) throw new Error(`У выбранного столбца ${XLSX.utils.encode_col(planColumn)} нет заголовка.`);
  const manualRenamed = !candidate && !!overrides.planColumn?.trim();
  const isCategoryA = /^категория\s*[аa]$/.test(header) || manualRenamed;
  const isMoney = /kzt|тенге|₸/.test(header);
  if (!isCategoryA && !isMoney && !/план|кг|тонн|тн/.test(header))
    throw new Error('Выбранный столбец не содержит план или единицу измерения.');

  const normalizedName = normalized(name);
  let month = MONTHS.findIndex((m) => normalizedName.includes(m)) + 1;
  const headerValues = Array.from({ length: Math.min(range.e.c + 1, 151) }, (_, c) =>
    normalized(valueAt(sheet, headerRow, c)),
  );
  const operationalHeader = headerValues.find((v) => /опер.?\s*план/.test(v)) ?? '';
  if (!month) month = MONTHS.findIndex((m) => operationalHeader.includes(m)) + 1;
  if (!month) throw new Error('Не удалось определить месяц плана. Укажите месяц в имени файла.');
  const yearText =
    name.match(/20\d{2}/)?.[0] ??
    headerValues.find((v) => /ген\s*план.*20\d{2}/.test(v))?.match(/20\d{2}/)?.[0];
  const year = yearText ? Number(yearText) : 2026;
  const warnings = new Set<string>();
  if (!greenFill(sheet[XLSX.utils.encode_cell({ r: headerRow, c: planColumn })]))
    warnings.add('Зелёная заливка выбранного столбца не обнаружена. Проверьте, что выбран план категории А.');
  if (manualRenamed)
    warnings.add(
      `Столбец ${XLSX.utils.encode_col(planColumn)} сопоставлен вручную с планом категории А. ${isMoney ? 'Единица — тенге.' : 'Единица принята — кг.'}`,
    );
  if (!yearText) warnings.add('Год в заголовке не указан. Для предоставленного плана принят 2026 год.');
  if (isCategoryA && !isMoney)
    warnings.add('План категории А из «СВОД» задан в кг. Денежного плана категории А в этой колонке нет.');
  else
    warnings.add(
      `Выбран столбец ${XLSX.utils.encode_col(planColumn)} «${String(valueAt(sheet, headerRow, planColumn))}». Его охват может отличаться от категории А.`,
    );

  const plans: PlanRow[] = [];
  let currentGroup: string | undefined;
  let blanks = 0;
  for (let r = headerRow + 1; r <= Math.min(range.e.r, 9999); r++) {
    const label = String(valueAt(sheet, r, 0) ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    const key = normalized(label);
    if (GROUPS[key]) {
      currentGroup = GROUPS[key];
      continue;
    }
    if (/^комбикорма|^согласовано/.test(key)) break;
    if (!currentGroup || (!CITIES.has(key) && key !== 'small')) continue;
    const value = valueAt(sheet, r, planColumn);
    if (value === undefined || value === null || value === '') {
      blanks++;
      continue;
    }
    if (!isNumber(value)) {
      warnings.add(`Нечисловой план в ${XLSX.utils.encode_cell({ r, c: planColumn })}: строка пропущена.`);
      continue;
    }
    const notes: string[] = [];
    if (currentGroup === 'Макаронные изделия')
      notes.push('План объединяет Макароны КМИ и Жайму; отдельного распределения нет.');
    if (key === 'павлодар+экибастуз')
      notes.push('План объединяет Павлодар и Экибастуз; распределения между городами нет.');
    if (key === 'small') notes.push('План Small задан отдельно без распределения по городам.');
    const source = `${name} · ${sheetName}!${XLSX.utils.encode_cell({ r, c: planColumn })}`;
    plans.push({
      sourceFile: name,
      label: `${currentGroup} · ${label}`,
      month,
      year,
      group: currentGroup,
      ...(key === 'small' ? { network: 'Small' } : { region: label }),
      amount: isMoney ? value : null,
      tons: isMoney ? null : value / (/тонн|\bтн\b/.test(header) ? 1 : 1000),
      source,
      comparable: isCategoryA,
      ...(notes.length ? { mappingWarning: notes.join(' ') } : {}),
    });
  }
  if (!plans.length)
    throw new Error(`В столбце ${XLSX.utils.encode_col(planColumn)} не найдено числовых планов по городам.`);
  if (blanks) warnings.add(`В ${blanks} строках городов план не заполнен. Пустые ячейки не заменены нулём.`);
  if (plans.some((p) => p.group === 'Макаронные изделия'))
    warnings.add('«Макаронные изделия» объединяют КМИ и Жайму. Раздельный план этих групп отсутствует.');
  if (plans.some((p) => p.network === 'Small'))
    warnings.add(
      'Small содержит отдельный план без города. Планы остальных сетей по городским строкам не распределены.',
    );
  const total = plans.reduce((sum, p) => sum + (isMoney ? (p.amount ?? 0) : (p.tons ?? 0)), 0);
  const control = valueAt(sheet, headerRow + 1, planColumn);
  if (isNumber(control)) {
    const expected = isMoney ? control : control / (/тонн|\bтн\b/.test(header) ? 1 : 1000);
    if (Math.abs(total - expected) > Math.max(0.000001, Math.abs(expected) * 1e-9)) {
      warnings.add(
        `Сумма строк ${total.toLocaleString('ru-RU', { maximumFractionDigits: 3 })} ${isMoney ? '₸' : 'т'} отличается от итога ${expected.toLocaleString('ru-RU', { maximumFractionDigits: 3 })} в ${XLSX.utils.encode_cell({ r: headerRow + 1, c: planColumn })}.`,
      );
    }
  } else warnings.add('Итоговая контрольная ячейка отсутствует; сверка суммы плана недоступна.');
  const source: SourceInfo = {
    name,
    kind: 'plan',
    rows: plans.length,
    warnings: [...warnings],
    datePrecision: 'month',
    minDate: `${year}-${String(month).padStart(2, '0')}-01`,
    maxDate: `${year}-${String(month).padStart(2, '0')}-${new Date(Date.UTC(year, month, 0)).getUTCDate()}`,
    ...(isMoney ? { amount: total } : { tons: total }),
  };
  return { plans, source };
}
