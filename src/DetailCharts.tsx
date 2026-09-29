import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Search } from 'lucide-react';
import type { Comparison, Metric, Sale } from './types';
import { GROUPS, YEARS } from './types';
import { growth } from './analytics';
import { exportTable } from './exporter';

const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const fmt = (value: number) => number.format(value);
const sign = (value: number) => `${value > 0 ? '+' : ''}${fmt(value)}`;
const money = (value: number) => `${fmt(value / 1e6)} млн ₸`;
const unit = (value: number, metric: Metric) => (metric === 'amount' ? money(value) : `${fmt(value)} т`);
const COLORS = ['#246b51', '#82a88c', '#c1ce97', '#d9b87c', '#df9471', '#95b5bd', '#b0a8c8', '#c6ccbf'];
type Value = { amount: number; tons: number; rows: number };
type Annual = Record<number, Value>;
const annual = (): Annual => ({
  2024: { amount: 0, tons: 0, rows: 0 },
  2025: { amount: 0, tons: 0, rows: 0 },
  2026: { amount: 0, tons: 0, rows: 0 },
});
function add(values: Annual, sale: Sale) {
  if (!values[sale.year]) return;
  values[sale.year].amount += Number.isFinite(sale.amount) ? sale.amount : 0;
  values[sale.year].tons += Number.isFinite(sale.tons) ? sale.tons : 0;
  values[sale.year].rows++;
}
const detail = (year: number, value: Value) =>
  `${year}: ${value.rows ? `${money(value.amount)} · ${fmt(value.tons)} т` : 'нет строк в выгрузке'}`;
const changeColor = (change: number | null, delta: number, threshold: number) =>
  change !== null && Math.abs(change) <= threshold
    ? '#99a28f'
    : delta > 0
      ? '#347b5b'
      : delta < 0
        ? '#bd7861'
        : '#99a28f';

/** Growth is computed over the already-filtered identical periods, for every network × group. */
export function GroupHeatmap({
  rows,
  metric,
  onClick,
  threshold = 1,
}: {
  rows: Sale[];
  metric: Metric;
  onClick?: (name: string) => void;
  threshold?: number;
}) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const { networks, groups, cells } = useMemo(() => {
    const cells = new Map<string, Map<string, Annual>>();
    const names = new Set<string>();
    for (const sale of rows) {
      const network = sale.network || 'Не указано',
        group = sale.group || 'Не распределено';
      names.add(group);
      let own = cells.get(network);
      if (!own) {
        own = new Map();
        cells.set(network, own);
      }
      let values = own.get(group);
      if (!values) {
        values = annual();
        own.set(group, values);
      }
      add(values, sale);
    }
    const groups = [...names].sort((a, b) => {
      const ia = GROUPS.indexOf(a),
        ib = GROUPS.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b, 'ru');
    });
    return { networks: [...cells.keys()].sort((a, b) => a.localeCompare(b, 'ru')), groups, cells };
  }, [rows]);
  const filtered = networks.filter((name) => name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const pages = Math.max(1, Math.ceil(filtered.length / 30)),
    safePage = Math.min(page, pages - 1);
  if (!networks.length)
    return (
      <div className="empty-inline">
        <p>Нет данных выбранного канала</p>
      </div>
    );
  return (
    <>
      <div className="table-tools">
        <label className="table-search">
          <Search size={15} />
          <input
            aria-label="Поиск сети в тепловой карте"
            placeholder="Найти сеть"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
          />
        </label>
        <span className="subtle">Рост 2026 к 2025 · {metric === 'amount' ? '₸' : 'тонны'} · %</span>
        <button
          className="text-button"
          disabled={!filtered.length}
          onClick={() =>
            exportTable(
              'Сети и товарные группы',
              filtered.flatMap((network) =>
                groups.map((group) => {
                  const v = cells.get(network)?.get(group) ?? annual();
                  return {
                    Сеть: network,
                    Группа: group,
                    '2025, ₸': v[2025].amount,
                    '2026, ₸': v[2026].amount,
                    '2025, т': v[2025].tons,
                    '2026, т': v[2026].tons,
                    'Прирост в деньгах, %': growth(v[2025].amount, v[2026].amount),
                    'Прирост в тоннах, %': growth(v[2025].tons, v[2026].tons),
                  };
                }),
              ),
            )
          }
        >
          Excel
        </button>
      </div>
      <div className="table-scroll">
        <table className="heatmap">
          <thead>
            <tr>
              <th>Сеть</th>
              {groups.map((group) => (
                <th key={group}>{group}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.slice(safePage * 30, (safePage + 1) * 30).map((network) => (
              <tr key={network}>
                <td>
                  {onClick ? (
                    <button onClick={() => onClick(network)} className="text-button">
                      {network}
                    </button>
                  ) : (
                    network
                  )}
                </td>
                {groups.map((group) => {
                  const values = cells.get(network)?.get(group) ?? annual();
                  const base = values[2025][metric],
                    current = values[2026][metric];
                  const change = growth(base, current),
                    delta = current - base;
                  const missing = !values[2025].rows && !values[2026].rows;
                  const label = missing
                    ? '—'
                    : change === null
                      ? current > 0
                        ? 'Новое'
                        : 'Нет базы'
                      : `${sign(change)}%`;
                  const neutral =
                    missing ||
                    (change === null && delta === 0) ||
                    (change !== null && Math.abs(change) <= threshold);
                  const opacity = neutral ? 0.1 : Math.min(0.88, 0.16 + Math.abs(change ?? 100) / 125);
                  const rgb = neutral ? '135,145,130' : delta < 0 ? '181,99,74' : '45,112,81';
                  const title = `${network} · ${group}\n${detail(2025, values[2025])}\n${detail(2026, values[2026])}\n${change === null ? 'Процент не рассчитан: база равна нулю.' : '(Факт 2026 − факт 2025) / факт 2025 × 100.'}${!values[2026].rows && values[2025].rows ? '\nНет строк 2026: проверьте полноту выгрузки.' : ''}`;
                  return (
                    <td key={group} title={title}>
                      <span
                        className={missing ? 'heat-missing' : 'heat-cell'}
                        style={
                          missing
                            ? {}
                            : {
                                background: `rgba(${rgb},${opacity})`,
                                color:
                                  opacity > 0.55
                                    ? '#fff'
                                    : neutral
                                      ? '#64715d'
                                      : delta < 0
                                        ? '#854f3b'
                                        : '#284331',
                              }
                        }
                      >
                        {label}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-footer">
        <span>{filtered.length} сетей · зелёный — рост, красный — снижение</span>
        {pages > 1 && (
          <div>
            <button disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
              Назад
            </button>
            <button disabled={safePage === pages - 1} onClick={() => setPage(safePage + 1)}>
              Далее
            </button>
          </div>
        )}
      </div>
      <p className="chart-note">
        «Новое» — положительные продажи при нулевой базе. Прочерк — нет строк обоих лет. Наведение показывает
        деньги и тонны каждого года.
      </p>
    </>
  );
}

/** All entities enter the denominator and historical stacks, including entities outside the seven displayed leaders. */
export function ShareStack({
  rows,
  dimension,
  metric,
}: {
  rows: Sale[];
  dimension: 'network' | 'channel';
  metric: Metric;
}) {
  const { entries, totals } = useMemo(() => {
    const grouped = new Map<string, Annual>(),
      totals = annual();
    for (const sale of rows) {
      const name = sale[dimension] || 'Не указано';
      let values = grouped.get(name);
      if (!values) {
        values = annual();
        grouped.set(name, values);
      }
      add(values, sale);
      add(totals, sale);
    }
    const ordered = [...grouped].sort((a, b) => b[1][2026][metric] - a[1][2026][metric]);
    const entries = ordered.slice(0, 7).map(([name, values], index) => ({ key: `s${index}`, name, values }));
    if (ordered.length > 7) {
      const rest = annual();
      for (const [, values] of ordered.slice(7))
        for (const year of YEARS) {
          rest[year].amount += values[year].amount;
          rest[year].tons += values[year].tons;
          rest[year].rows += values[year].rows;
        }
      entries.push({ key: 'rest', name: `Остальные (${ordered.length - 7})`, values: rest });
    }
    return { entries, totals };
  }, [rows, dimension, metric]);
  const share = (values: Annual, year: number) =>
    totals[year].rows && totals[year][metric] !== 0
      ? (values[year][metric] / totals[year][metric]) * 100
      : null;
  const data = YEARS.map((year) => ({
    year: String(year),
    ...Object.fromEntries(entries.map((entry) => [entry.key, share(entry.values, year)])),
  }));
  const negativeShare = entries.some((entry) => YEARS.some((year) => (share(entry.values, year) ?? 0) < 0));
  if (!entries.length)
    return (
      <div className="empty-inline">
        <p>Нет данных для структуры продаж</p>
      </div>
    );
  return (
    <>
      <div className="table-tools">
        <span className="subtle">Доли за одинаковые периоды</span>
        <button
          className="text-button"
          onClick={() =>
            exportTable(
              'Доли продаж',
              entries.map((entry) => ({
                Наименование: entry.name,
                '2024, %': share(entry.values, 2024),
                '2025, %': share(entry.values, 2025),
                '2026, %': share(entry.values, 2026),
                'Изменение, п.п.':
                  share(entry.values, 2026) === null || share(entry.values, 2025) === null
                    ? null
                    : share(entry.values, 2026)! - share(entry.values, 2025)!,
              })),
            )
          }
        >
          Excel
        </button>
      </div>
      <ResponsiveContainer width="100%" height={310}>
        <BarChart data={data} barSize={86} margin={{ top: 10, right: 15, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="#e9ece5" />
          <XAxis dataKey="year" axisLine={false} tickLine={false} />
          <YAxis
            domain={negativeShare ? ['auto', 'auto'] : [0, 100]}
            tickFormatter={(value) => `${fmt(Number(value))}%`}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            formatter={(value, name) => [`${fmt(Number(value))}%`, name]}
            contentStyle={{ border: '1px solid #e4e9df', borderRadius: 10, fontSize: 12 }}
          />
          <Legend />
          {entries.map((entry, index) => (
            <Bar
              isAnimationActive={false}
              key={entry.key}
              dataKey={entry.key}
              name={entry.name}
              stackId="share"
              fill={COLORS[index]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>{dimension === 'network' ? 'Сеть' : 'Канал'}</th>
              {YEARS.map((year) => (
                <th key={year}>Доля {year}, %</th>
              ))}
              <th>Δ доли, п.п.</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const previous = share(entry.values, 2025),
                current = share(entry.values, 2026);
              return (
                <tr key={entry.key}>
                  <td className="name-cell">{entry.name}</td>
                  {YEARS.map((year) => (
                    <td key={year} title={detail(year, entry.values[year])}>
                      {share(entry.values, year) === null ? '—' : `${fmt(share(entry.values, year)!)}%`}
                    </td>
                  ))}
                  <td>{previous === null || current === null ? '—' : sign(current - previous)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="chart-note">
        Доля в {metric === 'amount' ? 'деньгах' : 'тоннах'} рассчитана от всех продаж выбранного периода. Сети
        за пределами первой семёрки входят в «Остальные». Изменение доли — в процентных пунктах.
        {negativeShare ? ' Отрицательные доли отражают чистые возвраты.' : ''}
      </p>
    </>
  );
}

/** Positive and negative contributions share the same centered zero and scale. */
export function SignedChanges({
  rows,
  metric,
  threshold = 1,
}: {
  rows: Comparison[];
  metric: Metric;
  threshold?: number;
}) {
  const data = useMemo(
    () =>
      rows.map((row) => {
        const base = row.values[2025]?.[metric] ?? 0,
          current = row.values[2026]?.[metric] ?? 0;
        return { ...row, delta: current - base, change: growth(base, current) };
      }),
    [rows, metric],
  );
  const bound = Math.max(1, ...data.map((row) => Math.abs(row.delta))) * 1.08;
  if (!data.length)
    return (
      <div className="empty-inline">
        <p>Нет изменений за выбранный период</p>
      </div>
    );
  return (
    <>
      <ResponsiveContainer width="100%" height={Math.max(210, data.length * 39 + 55)}>
        <BarChart data={data} layout="vertical" margin={{ top: 6, right: 25, left: 0, bottom: 8 }}>
          <CartesianGrid horizontal={false} strokeDasharray="3 5" stroke="#e9ece5" />
          <XAxis
            type="number"
            domain={[-bound, bound]}
            tickFormatter={(value) =>
              metric === 'amount' ? `${fmt(Number(value) / 1e6)} млн` : `${fmt(Number(value))} т`
            }
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={155}
            tick={{ fontSize: 10 }}
            tickFormatter={(name) =>
              String(name).length > 24 ? `${String(name).slice(0, 23)}…` : String(name)
            }
            tickLine={false}
            axisLine={false}
          />
          <ReferenceLine x={0} stroke="#71846b" strokeWidth={1.3} />
          <Tooltip
            content={({ active, payload }) => {
              const row = payload?.[0]?.payload as (typeof data)[number] | undefined;
              return active && row ? (
                <div className="chart-tooltip">
                  <strong>{row.name}</strong>
                  <p>
                    Изменение: {unit(row.delta, metric)}
                    {row.change === null ? ' · нет базы' : ` · ${sign(row.change)}%`}
                  </p>
                  <p>{detail(2025, row.values[2025])}</p>
                  <p>{detail(2026, row.values[2026])}</p>
                </div>
              ) : null;
            }}
          />
          <Bar
            isAnimationActive={false}
            dataKey="delta"
            name="Изменение к 2025"
            radius={[3, 3, 3, 3]}
            barSize={17}
          >
            {data.map((row) => (
              <Cell key={row.name} fill={changeColor(row.change, row.delta, threshold)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="chart-note">
        Снижение — слева от нуля, рост — справа. Наведение показывает оба года в деньгах и тоннах.
      </p>
    </>
  );
}
