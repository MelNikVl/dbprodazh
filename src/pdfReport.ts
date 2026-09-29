import type { Content, TDocumentDefinitions, TableCell, CanvasElement } from 'pdfmake/interfaces';
import type { Comparison, Filters, PlanRow, Sale, Settings, Totals } from './types';
import { YEARS } from './types';
import {
  aggregateMonthly,
  compareBy,
  growth,
  periodMonths,
  planAnalysis,
  planSummary,
  totalsByYear,
} from './analytics';

export interface PdfReportInput {
  /** Already filtered with the same period applied to each comparison year. */
  sales: Sale[];
  /** Full dataset for correctly scoped whole-month plan comparisons. */
  allSales: Sale[];
  plans: PlanRow[];
  filters: Filters;
  settings: Settings;
}

const GREEN = '#276c51',
  RED = '#b55f48',
  MUTED = '#68776b',
  PALE = '#eef3ed';
const MONTHS = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
const nf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const int = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const number = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? '-' : nf.format(value).replace(/\u00a0/g, ' ');
const money = (value: number | null | undefined) => (value == null ? '-' : number(value / 1e6));
const percent = (value: number | null | undefined) =>
  value == null ? 'Нет базы' : `${value > 0 ? '+' : ''}${number(value)}%`;
const label = (value: string, limit = 65) => (value.length > limit ? `${value.slice(0, limit - 1)}…` : value);
const valid = (value: string) =>
  Boolean(value?.trim()) &&
  !/(?:^|·\s*)(?:(?:клиент|номенклатура|sku|филиал|дистрибьютор|дистрибутор|регион|сеть|торговая точка)\s+)?не (?:указан[ао]?|распределено)$/i.test(
    value.trim(),
  );
const active = (row: Sale) => row.amount > 0 || row.tons > 0;
const yearsSets = (): Record<number, Set<string>> => ({ 2024: new Set(), 2025: new Set(), 2026: new Set() });
const fold = (text: string) => text.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru');

function note(text: string): Content {
  return { text, fontSize: 8.2, color: MUTED, margin: [0, 5, 0, 9] };
}
function subheading(text: string): Content {
  return { text, fontSize: 11, bold: true, color: GREEN, margin: [0, 10, 0, 6] };
}
function table(
  headers: string[],
  rows: (string | number | null)[][],
  widths?: (number | '*' | 'auto')[],
): Content {
  const header: TableCell[] = headers.map((text) => ({
    text,
    bold: true,
    color: '#ffffff',
    fillColor: GREEN,
    fontSize: 7.5,
  }));
  const body: TableCell[][] = rows.length
    ? rows.map((row) =>
        row.map((value, i) => ({
          text: value == null ? '-' : typeof value === 'number' ? number(value) : value,
          alignment: i === 0 ? 'left' : 'right',
          fontSize: 7.6,
        })),
      )
    : [
        [
          { text: 'Нет данных за выбранный период', colSpan: headers.length, color: MUTED },
          ...headers.slice(1).map(() => ''),
        ],
      ];
  return {
    table: {
      headerRows: 1,
      keepWithHeaderRows: 1,
      dontBreakRows: true,
      widths: widths ?? headers.map((_, i) => (i === 0 ? '*' : 'auto')),
      body: [header, ...body],
    },
    layout: {
      fillColor: (rowIndex: number) => (rowIndex > 0 && rowIndex % 2 === 0 ? '#f2f5f0' : null),
      hLineWidth: (index: number) => (index <= 1 ? 0 : 0.3),
      vLineWidth: () => 0,
      hLineColor: () => '#dce5dc',
      paddingLeft: () => 5,
      paddingRight: () => 5,
      paddingTop: () => 4,
      paddingBottom: () => 4,
    },
    margin: [0, 1, 0, 6],
  };
}
function comparisons(rows: Comparison[], limit = 20): Content {
  return table(
    [
      'Наименование',
      '2025\nмлн KZT',
      '2026\nмлн KZT',
      'Δ\nмлн KZT',
      '2025\nт',
      '2026\nт',
      'Рост KZT\n%',
      'Рост т\n%',
    ],
    rows
      .slice(0, limit)
      .map((row) => [
        label(row.name),
        money(row.values[2025].amount),
        money(row.values[2026].amount),
        money(row.values[2026].amount - row.values[2025].amount),
        number(row.values[2025].tons),
        number(row.values[2026].tons),
        percent(growth(row.values[2025].amount, row.values[2026].amount)),
        percent(growth(row.values[2025].tons, row.values[2026].tons)),
      ]),
    ['*', 66, 66, 66, 63, 63, 59, 59],
  );
}
function totalsTable(values: Record<number, Totals>): Content {
  return table(
    ['Год', 'Выручка, млн KZT', 'Объём, т', 'Активных точек', 'Активных SKU'],
    YEARS.map((year) => [
      String(year),
      money(values[year].amount),
      number(values[year].tons),
      int.format(values[year].points),
      int.format(values[year].skuCount),
    ]),
    ['*', 155, 145, 145, 145],
  );
}
function lossChart(rows: Comparison[]): Content {
  const own = rows.slice(0, 5),
    maximum = Math.max(1, ...own.map((row) => Math.abs(row.values[2026].amount - row.values[2025].amount)));
  return {
    stack: own.map((row) => {
      const delta = row.values[2026].amount - row.values[2025].amount;
      const width = Math.max(1, (Math.abs(delta) / maximum) * 330);
      return {
        columns: [
          { text: label(row.name, 37), width: 205, fontSize: 8 },
          {
            width: 345,
            canvas: [
              { type: 'rect', x: 0, y: 1, w: width, h: 9, color: delta < 0 ? RED : GREEN } as CanvasElement,
            ],
          },
          {
            text: `${delta > 0 ? '+' : ''}${money(delta)} млн KZT`,
            width: '*',
            alignment: 'right',
            fontSize: 8,
            color: delta < 0 ? RED : GREEN,
          },
        ],
        margin: [0, 3, 0, 3],
      } as Content;
    }),
    margin: [0, 3, 0, 5],
  };
}
function monthlyChart(rows: ReturnType<typeof aggregateMonthly>): Content {
  if (!rows.length) return note('Нет помесячных данных для графика.');
  const height = 92,
    width = 740,
    slot = width / rows.length,
    bar = Math.min(14, slot / 5);
  const maximum = Math.max(1, ...rows.flatMap((row) => YEARS.map((year) => Math.abs(row[year] ?? 0))));
  const colors = ['#b9c8b2', '#d8b480', GREEN];
  const canvas: CanvasElement[] = [
    { type: 'line', x1: 0, y1: height, x2: width, y2: height, lineWidth: 0.5, lineColor: '#9caf9a' },
  ];
  rows.forEach((row, i) =>
    YEARS.forEach((year, j) => {
      const value = row[year];
      if (value == null) return;
      const h = (Math.abs(value) / maximum) * (height - 8);
      canvas.push({
        type: 'rect',
        x: i * slot + slot / 2 - 1.5 * bar + j * bar,
        y: value >= 0 ? height - h : height,
        w: bar - 1,
        h,
        color: value < 0 ? RED : colors[j],
      });
    }),
  );
  return {
    stack: [
      { canvas, margin: [0, 0, 0, 4] },
      { columns: rows.map((row) => ({ text: row.label, alignment: 'center', width: slot, fontSize: 7.2 })) },
      {
        text: 'Выручка по месяцам: 2024 - светло-зелёный; 2025 - песочный; 2026 - зелёный. Точные значения ниже, в млн KZT.',
        fontSize: 7.6,
        color: MUTED,
        margin: [0, 5, 0, 6],
      },
    ],
  };
}

/** Generates a real downloadable PDF, without popup windows, print dialogs, screenshots or network requests. */
export async function createPdfReport(input: PdfReportInput): Promise<Uint8Array> {
  const { sales, allSales, plans, filters, settings } = input;
  const periods = periodMonths(filters),
    values = totalsByYear(sales);
  const networks = compareBy(sales, 'network', 'amount', periods);
  const groups = compareBy(sales, 'group', 'amount', periods);
  const channels = compareBy(sales, 'channel', 'amount', periods);
  const skus = compareBy(sales, 'sku', 'amount', periods);
  const losses = networks.filter((row) => row.values[2026].amount < row.values[2025].amount);
  const amountMonths = aggregateMonthly(sales, 'amount'),
    tonMonths = new Map(aggregateMonthly(sales, 'tons').map((row) => [row.month, row]));
  const period = `${filters.start.slice(0, 7)} - ${filters.end.slice(0, 7)}`;
  const latest = allSales
    .filter((row) => row.year === 2026)
    .reduce((date, row) => (row.date > date ? row.date : date), '');
  const cut = latest ? latest.slice(0, 7) : 'нет данных 2026';
  const created = new Date().toLocaleString('ru-RU');
  const dimensions = [
    ['channel', 'Канал'],
    ['network', 'Сеть'],
    ['group', 'Группа'],
    ['region', 'Регион'],
    ['distributor', 'Дистрибутор'],
  ] as const;
  const filterText = dimensions.map(([key, name]) => `${name}: ${filters[key] || 'все'}`).join(' · ');
  const content: Content[] = [];
  const page = (title: string, summary: string, body: Content[]) =>
    content.push({
      stack: [{ text: title, style: 'title' }, { text: summary, style: 'summary' }, ...body],
      ...(content.length ? { pageBreak: 'before' as const } : {}),
    });
  const changeSummary = (own: Sale[]) => {
    const year = totalsByYear(own);
    return `2026: ${money(year[2026].amount)} млн KZT и ${number(year[2026].tons)} т. Изменение к 2025: ${percent(growth(year[2025].amount, year[2026].amount))} в деньгах, ${percent(growth(year[2025].tons, year[2026].tons))} в объёме.`;
  };

  page('01 / Где теряем продажи', changeSummary(sales), [
    note(`Сформирован: ${created}. Период сравнения: ${period}. Последний месяц данных 2026: ${cut}.`),
    note(
      `${filterText}. База: ${filters.comparable ? 'сопоставимые сети и дистрибуторы' : 'полная'}. Все разделы используют эти фильтры.`,
    ),
    totalsTable(values),
    subheading('Пять крупнейших потерь по сетям - абсолютное изменение выручки'),
    losses.length ? lossChart(losses) : note('Отрицательных изменений по сетям за выбранный период нет.'),
    comparisons(losses, 5),
    note(
      'Выручка указана с НДС; возвраты сохранены. Деньги - млн KZT, объём - тонны. Отсутствие строк может означать неполную выгрузку. Месячные данные не подтверждают закрытие последнего месяца. Таблицы отчёта ограничены указанным числом строк.',
    ),
  ]);

  page(
    '02 / Динамика продаж',
    'Одинаковые месяцы для 2024, 2025 и 2026. Отсутствующие месяцы не заменяются фактическими продажами.',
    [
      monthlyChart(amountMonths),
      table(
        [
          'Месяц',
          '2024\nмлн KZT',
          '2025\nмлн KZT',
          '2026\nмлн KZT',
          '2024\nт',
          '2025\nт',
          '2026\nт',
          'Рост KZT\n26/25',
        ],
        amountMonths.map((row) => {
          const tons = tonMonths.get(row.month)!;
          return [
            row.label,
            money(row[2024]),
            money(row[2025]),
            money(row[2026]),
            number(tons[2024]),
            number(tons[2025]),
            number(tons[2026]),
            row[2025] == null || row[2026] == null ? '-' : percent(growth(row[2025]!, row[2026]!)),
          ];
        }),
        ['*', 83, 83, 83, 79, 79, 79, 73],
      ),
    ],
  );

  const shareRows = (own: Comparison[]) =>
    own.map((row) => {
      const share = (year: number, metric: 'amount' | 'tons') =>
        values[year][metric] !== 0 ? (row.values[year][metric] / values[year][metric]) * 100 : null;
      const delta = (metric: 'amount' | 'tons') =>
        share(2025, metric) == null || share(2026, metric) == null
          ? null
          : share(2026, metric)! - share(2025, metric)!;
      return [
        label(row.name, 46),
        ...YEARS.map((year) => number(share(year, 'amount'))),
        number(delta('amount')),
        ...YEARS.map((year) => number(share(year, 'tons'))),
        number(delta('tons')),
      ];
    });
  const shareHeaders = [
    'Сущность',
    'KZT 2024\n%',
    'KZT 2025\n%',
    'KZT 2026\n%',
    'Δ KZT\nп.п.',
    'т 2024\n%',
    'т 2025\n%',
    'т 2026\n%',
    'Δ т\nп.п.',
  ];
  page(
    '03 / Структура продаж',
    'Доли считаются от всех продаж выбранного периода и фильтров. Изменение доли указано в процентных пунктах.',
    [
      subheading('Каналы'),
      table(shareHeaders, shareRows(channels), ['*', 59, 59, 59, 59, 59, 59, 59, 59]),
      subheading('Сети - первые 12 по выручке 2026'),
      table(
        shareHeaders,
        shareRows([...networks].sort((a, b) => b.values[2026].amount - a.values[2026].amount).slice(0, 12)),
        ['*', 59, 59, 59, 59, 59, 59, 59, 59],
      ),
      note(
        'Сети за пределами показанных строк входят в знаменатель доли. Поэтому доли показанных сетей могут составлять менее 100%.',
      ),
    ],
  );

  page(
    '04 / Товарные группы и SKU',
    'Группы и позиции отсортированы по абсолютной потере в деньгах. Падение объёма и выручки показано отдельно.',
    [
      subheading('Товарные группы'),
      comparisons(groups, 8),
      subheading('SKU в падении - первые 10 по потере выручки'),
      comparisons(
        skus.filter((row) => row.values[2026].amount < row.values[2025].amount),
        10,
      ),
    ],
  );

  const segment = (channel: string, title: string) => {
    const own = sales.filter((row) => row.channel === channel);
    const segmentNetworks = compareBy(own, 'network', 'amount', periods);
    const segmentGroups = compareBy(own, 'group', 'amount', periods);
    page(title, changeSummary(own), [
      subheading('Сети канала'),
      comparisons(segmentNetworks, 10),
      subheading('Вклад товарных групп'),
      comparisons(segmentGroups, 8),
      note(
        segmentGroups.length
          ? `Наибольшее снижение / минимальный вклад: ${segmentGroups[0].name}, ${money(segmentGroups[0].values[2026].amount - segmentGroups[0].values[2025].amount)} млн KZT. Сравнение включает только выбранный канал и глобальные фильтры.`
          : 'В выбранном срезе нет строк этого канала.',
      ),
    ]);
  };
  segment('Онлайн', '05 / Онлайн');
  segment('Ключевые сети', '06 / Ключевые сети');

  const other = sales.filter((row) => !['Онлайн', 'Ключевые сети'].includes(row.channel));
  page('07 / Прочие клиенты', changeSummary(other), [
    note('Первые 20 клиентов по абсолютному изменению выручки: наиболее крупные потери в начале таблицы.'),
    comparisons(compareBy(other, 'client', 'amount', periods), 20),
  ]);

  const points = yearsSets();
  for (const row of sales)
    if (points[row.year] && active(row) && valid(row.point))
      points[row.year].add(`${fold(row.region)}\u0000${fold(row.point)}`);
  const addedPoints = [...points[2026]].filter((point) => !points[2025].has(point));
  const lostPoints = [...points[2025]].filter((point) => !points[2026].has(point));
  page(
    '08 / Активная клиентская база',
    `Новых точек: ${int.format(addedPoints.length)}. Ушедших точек: ${int.format(lostPoints.length)}. Активность - положительная отгрузка в деньгах или тоннах.`,
    [
      table(
        ['Показатель', '2024', '2025', '2026', 'Рост 26/25'],
        [
          [
            'Активные точки',
            points[2024].size,
            points[2025].size,
            points[2026].size,
            percent(growth(points[2025].size, points[2026].size)),
          ],
        ],
        ['*', 100, 100, 100, 100],
      ),
      subheading('АКБ по сетям - первые 12 по активным точкам 2026'),
      table(
        ['Сеть', 'Точки 2024', 'Точки 2025', 'Точки 2026', 'Рост 26/25'],
        [...networks]
          .sort((a, b) => b.values[2026].points - a.values[2026].points)
          .slice(0, 12)
          .map((row) => [
            label(row.name),
            row.values[2024].points,
            row.values[2025].points,
            row.values[2026].points,
            percent(growth(row.values[2025].points, row.values[2026].points)),
          ]),
        ['*', 90, 90, 90, 90],
      ),
      note(
        'АКБ - приближение по городу и названию клиента: устойчивого идентификатора торговой точки нет. «Ушла» означает отсутствие положительных отгрузок в выбранном периоде, а не подтверждённое прекращение договора.',
      ),
      note(
        `Примеры новых: ${
          addedPoints
            .slice(0, 4)
            .map((point) => point.replace('\u0000', ' / '))
            .join('; ') || 'нет'
        }. Примеры ушедших: ${
          lostPoints
            .slice(0, 4)
            .map((point) => point.replace('\u0000', ' / '))
            .join('; ') || 'нет'
        }.`,
      ),
    ],
  );

  const matrix = new Map<string, Record<number, Set<string>>>();
  for (const row of sales) {
    if (!active(row) || !valid(row.sku) || !YEARS.includes(row.year as 2024 | 2025 | 2026)) continue;
    let sets = matrix.get(row.network);
    if (!sets) {
      sets = yearsSets();
      matrix.set(row.network, sets);
    }
    sets[row.year].add(fold(row.sku));
  }
  page(
    '09 / Ассортиментная матрица SKU',
    'Уникальные SKU с положительной отгрузкой. Первые 20 сетей по ширине матрицы 2026.',
    [
      table(
        [
          'Сеть',
          'SKU\n2024',
          'SKU\n2025',
          'SKU\n2026',
          'Рост\n25/24',
          'Рост\n26/25',
          'Новые\n2026',
          'Выбыли\n2026',
        ],
        [...matrix]
          .sort((a, b) => b[1][2026].size - a[1][2026].size)
          .slice(0, 20)
          .map(([name, sets]) => [
            label(name),
            sets[2024].size,
            sets[2025].size,
            sets[2026].size,
            percent(growth(sets[2024].size, sets[2025].size)),
            percent(growth(sets[2025].size, sets[2026].size)),
            [...sets[2026]].filter((sku) => !sets[2025].has(sku)).length,
            [...sets[2025]].filter((sku) => !sets[2026].has(sku)).length,
          ]),
        ['*', 60, 60, 60, 78, 78, 62, 62],
      ),
      note(
        'Новые и выбывшие SKU сравниваются внутри одной сети за одинаковые периоды. Возврат без положительной отгрузки не делает SKU активным.',
      ),
    ],
  );

  const planFilters = { ...filters, metric: 'tons' as const };
  const summary = planSummary(allSales, plans, planFilters, settings);
  const details = planAnalysis(allSales, plans, planFilters, settings);
  page(
    '10 / План продаж',
    'План категории А доступен в тоннах. Денежный план отсутствует и не восстанавливается из цен факта.',
    [
      subheading('Итог по месяцам - каждая строка факта учитывается один раз'),
      table(
        [
          'Месяц',
          'Факт 2024\nт',
          'Факт 2025\nт',
          'План\nт',
          'Факт 2026\nт',
          'План/25\n%',
          'Факт/25\n%',
          'Выполнено\n%',
          'Разрыв\nп.п.',
        ],
        summary.map((row) => [
          MONTHS[row.month - 1],
          number(row.values[2024].tons),
          number(row.values[2025].tons),
          number(row.planned),
          row.comparable && row.completion != null ? number(row.actual) : '-',
          percent(row.plannedGrowth),
          percent(row.actualGrowth),
          number(row.completion),
          number(row.gap),
        ]),
        ['*', 70, 70, 70, 70, 70, 70, 70, 70],
      ),
      subheading('Строки плана - первые 14 по плановому объёму'),
      table(
        ['Строка / месяц', 'План, т', 'Факт, т', 'Выполнено, %', 'Истор. рост, %', 'Оценка'],
        [...details]
          .sort((a, b) => (b.planned ?? 0) - (a.planned ?? 0))
          .slice(0, 14)
          .map((row) => [
            `${MONTHS[row.month - 1]} / ${label(row.label, 48)}`,
            number(row.planned),
            row.comparable && row.completion != null ? number(row.actual) : '-',
            number(row.completion),
            percent(row.historicalGrowth),
            row.assessment,
          ]),
        ['*', 66, 66, 74, 76, 112],
      ),
      note(
        `Пороги превышения исторического роста: ${settings.realisticThreshold} и ${settings.stretchedThreshold} п.п. Рост плана при отрицательном YTD также считается нереалистичным. План сравнивается с фактом полного месяца, доступные фильтры учитываются по охвату плана.`,
      ),
      note(
        'Объединённые группы и регионы, отдельные строки Small могут ограничивать детализацию. Факты пересекающихся строк плана нельзя складывать вручную. Месячные выгрузки не позволяют рассчитать дневной прогноз. При неподходящем охвате или отсутствии факта выполнение не рассчитывается.',
      ),
    ],
  );

  const definition: TDocumentDefinitions = {
    pageSize: 'A4',
    pageOrientation: 'landscape',
    pageMargins: [40, 45, 40, 35],
    info: {
      title: `АН PRO - отчёт о продажах ${period}`,
      author: 'АН PRO',
      subject: 'Аналитика продаж за сопоставимые периоды',
      creator: 'АН PRO / browser PDF export',
    },
    defaultStyle: { font: 'Roboto', fontSize: 9, color: '#263e2e', lineHeight: 1.08 },
    styles: {
      title: { fontSize: 21, bold: true, color: GREEN, margin: [0, 0, 0, 8] },
      summary: { fontSize: 10, color: MUTED, margin: [0, 0, 0, 9] },
    },
    header: {
      text: `АН PRO / АНАЛИТИКА ПРОДАЖ 2024-2026                                      ПЕРИОД: ${period}`,
      color: MUTED,
      fontSize: 8,
      margin: [40, 20, 40, 0],
    },
    footer: (currentPage, pageCount) => ({
      columns: [
        { text: 'Внутренний отчёт · деньги с НДС · объём в тоннах', width: '*' },
        { text: `${currentPage} / ${pageCount}`, alignment: 'right', width: 70 },
      ],
      color: MUTED,
      fontSize: 7.5,
      margin: [40, 12, 40, 0],
    }),
    content,
  };
  const [{ default: pdfMake }, { default: fonts }] = await Promise.all([
    import('pdfmake/build/pdfmake'),
    import('pdfmake/build/vfs_fonts'),
  ]);
  pdfMake.addVirtualFileSystem(fonts);
  const buffer = await pdfMake.createPdf(definition).getBuffer();
  return new Uint8Array(buffer);
}
