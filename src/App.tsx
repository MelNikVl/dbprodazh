import DataCoverage from './DataCoverage';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  Legend,
  ReferenceLine,
} from 'recharts';
import {
  LayoutDashboard,
  ChartNoAxesCombined,
  Layers3,
  Package,
  Monitor,
  Building2,
  Users,
  UserRoundCheck,
  Grid2X2,
  Target,
  ShieldCheck,
  SlidersHorizontal,
  ChevronDown,
  ChevronRight,
  ArrowUpRight,
  ArrowDownRight,
  Upload,
  Download,
  Search,
  X,
  Check,
  FileSpreadsheet,
  AlertTriangle,
  LoaderCircle,
  ArrowRight,
  Menu,
  RefreshCw,
  CircleHelp,
  Printer,
  CheckCircle2,
  Database,
  CalendarDays,
  Compass,
} from 'lucide-react';
import type { Dataset, Sale, Filters, Settings, Comparison, Metric } from './types';
import { DEFAULT_SETTINGS, YEARS } from './types';
import {
  defaultFilters,
  filterSales,
  totals,
  totalsByYear,
  compareBy,
  aggregateMonthly,
  planAnalysis,
  planSummary,
  periodMonths,
  growth,
} from './analytics';
import {
  loadLocalSamples,
  importFiles,
  applyRules,
  ImportMappingError,
  PlanColumnMappingError,
  mergeDatasets,
  type ImportOverrides,
} from './importer';
import MappingDialog from './MappingDialog';
import { GroupHeatmap, ShareStack, SignedChanges } from './DetailCharts';
import { ActiveBaseView, SkuMatrixView } from './CustomerViews';
import { exportTable, downloadFile } from './exporter';
import { readSettings, validateSettings } from './settings';
import './styles.css';

type Tab =
  | 'overview'
  | 'dynamics'
  | 'structure'
  | 'products'
  | 'online'
  | 'networks'
  | 'clients'
  | 'akb'
  | 'sku'
  | 'plan'
  | 'data'
  | 'settings';
type Dimension = 'network' | 'client' | 'channel' | 'group' | 'sku' | 'region' | 'distributor' | 'point';
const NAV: { id: Tab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'Где теряем', icon: LayoutDashboard },
  { id: 'dynamics', label: 'Динамика продаж', icon: ChartNoAxesCombined },
  { id: 'structure', label: 'Структура продаж', icon: Layers3 },
  { id: 'products', label: 'Товарные группы', icon: Package },
  { id: 'online', label: 'Онлайн', icon: Monitor },
  { id: 'networks', label: 'Ключевые сети', icon: Building2 },
  { id: 'clients', label: 'Прочие клиенты', icon: Users },
  { id: 'akb', label: 'Клиентская база', icon: UserRoundCheck },
  { id: 'sku', label: 'SKU-матрица', icon: Grid2X2 },
  { id: 'plan', label: 'План продаж', icon: Target },
  { id: 'data', label: 'Качество данных', icon: ShieldCheck },
  { id: 'settings', label: 'Настройки', icon: SlidersHorizontal },
];
const MONTHS = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
];
const SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const COLORS = ['#246b51', '#82a88c', '#c1ce97', '#d9b87c', '#df9471', '#95b5bd', '#b0a8c8'];
const EMPTY: Dataset = { sales: [], plans: [], sources: [] };
const nf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const num = (v: number) => nf.format(v);
function compact(v: number, metric: Metric = 'amount') {
  const fixed = (n: number) =>
    n.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return metric === 'tons' ? `${fixed(v)} т` : `${fixed(v / 1e6)} млн ₸`;
}
function signed(v: number) {
  return `${v > 0 ? '+' : ''}${num(v)}`;
}
function pct(v: number | null | undefined) {
  return v == null ? '—' : `${signed(v)}%`;
}
function dateLabel(v: string) {
  const [y, m] = v.split('-');
  return `${MONTHS[Number(m) - 1] || ''} ${y}`;
}
const zero = { amount: 0, tons: 0, points: 0, skuCount: 0, rows: 0 };
function Delta({ value, caption = 'к 2025' }: { value: number | null; caption?: string }) {
  return (
    <span className={`delta ${value == null ? 'muted' : value >= 0 ? 'positive' : 'negative'}`}>
      {value == null ? (
        'Нет базы'
      ) : (
        <>
          {value >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />} {pct(value)}
        </>
      )}
      <span>{caption}</span>
    </span>
  );
}
function Panel({
  title,
  sub,
  children,
  action,
  className = '',
}: {
  title: string;
  sub?: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-heading">
        <div>
          <h3>{title}</h3>
          {sub && <p>{sub}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
function Empty({ text = 'В выбранном периоде нет данных' }: { text?: string }) {
  return (
    <div className="empty-inline">
      <Database size={26} />
      <p>{text}</p>
      <small>Измените фильтры или загрузите выгрузку CRM.</small>
    </div>
  );
}
function ExportButton({ name, rows }: { name: string; rows: Record<string, unknown>[] }) {
  return (
    <button
      className="icon-button"
      title="Экспорт таблицы в Excel"
      disabled={!rows.length}
      onClick={() => exportTable(name, rows)}
    >
      <Download size={16} />
    </button>
  );
}

function ComparisonTable({
  rows,
  metric,
  onClick,
  title = 'Сравнение',
  limit = 10,
  threshold = 1,
  showShares = false,
}: {
  rows: Comparison[];
  metric: Metric;
  onClick?: (name: string) => void;
  title?: string;
  limit?: number;
  threshold?: number;
  showShares?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [order, setOrder] = useState<'delta' | 'current' | 'name' | 'source'>(
    title === 'Потери продаж' ? 'source' : 'current',
  );
  const selected = useMemo(
    () =>
      rows
        .filter((r) => r.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
        .sort((a, b) =>
          order === 'source'
            ? 0
            : order === 'delta'
              ? a.delta - b.delta
              : order === 'name'
                ? a.name.localeCompare(b.name, 'ru')
                : (b.values[2026]?.[metric] || 0) - (a.values[2026]?.[metric] || 0),
        ),
    [rows, query, order, metric],
  );
  const shareTotals = Object.fromEntries(
    YEARS.map((y) => [y, rows.reduce((sum, r) => sum + (r.values[y]?.[metric] || 0), 0)]),
  );
  const pageCount = Math.max(1, Math.ceil(selected.length / limit));
  const safePage = Math.min(page, pageCount - 1);
  const exported = selected.map((r) => ({
    Наименование: r.name,
    '2024': r.values[2024]?.[metric] || 0,
    '2025': r.values[2025]?.[metric] || 0,
    '2026': r.values[2026]?.[metric] || 0,
    Изменение: r.delta,
    'Изменение, %': r.growth,
    'Доля, п.п.': r.shareChange,
  }));
  return (
    <>
      <div className="table-tools">
        <label className="table-search">
          <Search size={15} />
          <input
            placeholder="Найти в таблице"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
          />
        </label>
        <div className="table-tools-right">
          <select
            aria-label="Сортировка"
            value={order}
            onChange={(e) => setOrder(e.target.value as typeof order)}
          >
            <option value="source">Исходный порядок</option>
            <option value="current">По продажам 2026</option>
            <option value="delta">По изменению</option>
            <option value="name">По названию</option>
          </select>
          <ExportButton name={title} rows={exported} />
        </div>
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Наименование</th>
              {YEARS.map((y) => (
                <th key={y}>
                  {y}
                  {y === 2026 && <span className="tiny-label">ФАКТ</span>}
                </th>
              ))}
              <th>Δ к 2025</th>
              <th>Изменение</th>
              <th>Доля, п.п.</th>
              <th>Цена, ₸/кг</th>
              {onClick && <th />}
            </tr>
          </thead>
          <tbody>
            {selected.slice(safePage * limit, (safePage + 1) * limit).map((r) => (
              <tr key={r.name} className={onClick ? 'clickable' : ''} onClick={() => onClick?.(r.name)}>
                <td className="name-cell">
                  {r.name || 'Не указано'}
                  {r.missingMonths.length > 0 && (
                    <span
                      className="coverage-flag"
                      title={`Нет строк в месяцах: ${r.missingMonths.join(', ')}`}
                    >
                      <AlertTriangle size={12} />
                    </span>
                  )}
                </td>
                {YEARS.map((y) => (
                  <td key={y}>
                    {r.values[y]?.rows ? (
                      <>
                        <span>{compact(r.values[y][metric], metric)}</span>
                        <small className="secondary-value">
                          {compact(
                            r.values[y][metric === 'amount' ? 'tons' : 'amount'],
                            metric === 'amount' ? 'tons' : 'amount',
                          )}
                          {showShares &&
                            ` · ${num(((r.values[y]?.[metric] || 0) / (shareTotals[y] || 1)) * 100)}%`}
                        </small>
                      </>
                    ) : (
                      <span className="no-data">—</span>
                    )}
                  </td>
                ))}
                <td className={r.delta >= 0 ? 'text-positive' : 'text-negative'}>
                  {r.delta > 0 ? '+' : ''}
                  {compact(r.delta, metric)}
                </td>
                <td>
                  <span
                    className={`change-pill ${r.growth == null ? 'neutral' : Math.abs(r.growth) <= threshold ? 'neutral' : r.growth >= 0 ? 'up' : 'down'}`}
                  >
                    {r.growth == null ? (r.values[2026]?.rows ? 'Новый' : 'Нет базы') : pct(r.growth)}
                  </span>
                </td>
                <td className="muted">{signed(r.shareChange)}</td>
                <td
                  title={`2025: ${(r.values[2025]?.tons || 0) > 0 ? num(r.values[2025].amount / (r.values[2025].tons * 1000)) : '—'} ₸/кг`}
                >
                  {(r.values[2026]?.tons || 0) > 0
                    ? num(r.values[2026].amount / (r.values[2026].tons * 1000))
                    : '—'}
                </td>
                {onClick && (
                  <td>
                    <ChevronRight size={15} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {!selected.length && <Empty />}
      </div>
      <div className="table-footer">
        <span>
          {selected.length
            ? `${safePage * limit + 1}–${Math.min((safePage + 1) * limit, selected.length)} из ${selected.length}`
            : 'Нет строк'}
        </span>
        <span className="subtle">Одинаковые месяцы каждого года</span>
        {pageCount > 1 && (
          <div>
            <button disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
              Назад
            </button>
            <button disabled={safePage === pageCount - 1} onClick={() => setPage(safePage + 1)}>
              Далее
            </button>
          </div>
        )}
      </div>
    </>
  );
}

function TrendChart({
  rows,
  metric,
  height = 260,
  months,
}: {
  rows: Sale[];
  metric: Metric;
  height?: number;
  months?: number[];
}) {
  const observed = new Set(rows.map((r) => `${r.year}-${r.month}`));
  const data = aggregateMonthly(rows, metric)
    .filter((r) => !months || months.includes(r.month))
    .map((r) => ({
      ...r,
      ...Object.fromEntries(YEARS.map((y) => [y, observed.has(`${y}-${r.month}`) ? r[y] : null])),
    }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 12, right: 18, left: 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="#e9ece5" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#839084' }} />
        <YAxis
          width={62}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 10, fill: '#839084' }}
          tickFormatter={(v) => (metric === 'amount' ? `${num(v / 1e6)} млн` : num(v))}
        />
        <Tooltip
          formatter={(value) => compact(Number(value), metric)}
          contentStyle={{ border: '1px solid #e4e9df', borderRadius: 12, fontSize: 12 }}
        />
        <Line
          isAnimationActive={false}
          name="2024"
          type="monotone"
          dataKey="2024"
          stroke="#ccd4bb"
          strokeWidth={2}
          dot={false}
          connectNulls={false}
        />
        <Line
          isAnimationActive={false}
          name="2025"
          type="monotone"
          dataKey="2025"
          stroke="#dfb071"
          strokeWidth={2.3}
          dot={false}
          connectNulls={false}
        />
        <Line
          isAnimationActive={false}
          name="2026"
          type="monotone"
          dataKey="2026"
          stroke="#266a50"
          strokeWidth={3}
          dot={{ r: 3, strokeWidth: 2, fill: '#fff' }}
          connectNulls={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
function LegendYears() {
  return (
    <div className="custom-legend">
      <span>
        <i style={{ background: '#ccd4bb' }} />
        2024
      </span>
      <span>
        <i style={{ background: '#dfb071' }} />
        2025
      </span>
      <span>
        <i style={{ background: '#266a50' }} />
        2026
      </span>
    </div>
  );
}

function Heatmap({
  rows,
  dimension,
  metric,
  filters,
  onClick,
}: {
  rows: Sale[];
  dimension: Dimension;
  metric: Metric;
  filters: Filters;
  onClick?: (name: string) => void;
}) {
  const names = [...new Set(rows.map((r) => r[dimension]))].sort();
  const lookup = new Map<string, number>();
  for (const r of rows) {
    const key = `${r[dimension]}|${r.year}|${r.month}`;
    lookup.set(key, (lookup.get(key) || 0) + r[metric]);
  }
  const [query, setQuery] = useState('');
  const filtered = names.filter((n) => n.toLowerCase().includes(query.toLowerCase())).slice(0, 60);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const selectedYear = Number(filters.end.slice(0, 4)) || 2026;
  const max = Math.max(1, ...lookup.values());
  return (
    <>
      <div className="table-tools">
        <label className="table-search">
          <Search size={15} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Найти сеть или клиента"
          />
        </label>
        <span className="subtle">{selectedYear} · интенсивность продаж</span>
        <ExportButton
          name="Тепловая карта"
          rows={names.map((n) =>
            Object.fromEntries([
              ['Наименование', n],
              ...months.map((m) => [MONTHS[m - 1], lookup.get(`${n}|${selectedYear}|${m}`) ?? null]),
            ]),
          )}
        />
      </div>
      <div className="table-scroll">
        <table className="heatmap">
          <thead>
            <tr>
              <th>Наименование</th>
              {months.map((m) => (
                <th key={m}>{SHORT[m - 1]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((n) => (
              <tr key={n}>
                <td onClick={() => onClick?.(n)} className={onClick ? 'clickable' : ''}>
                  {n || 'Не указано'}
                </td>
                {months.map((m) => {
                  const value = lookup.get(`${n}|${selectedYear}|${m}`);
                  const intensity =
                    value == null ? 0 : Math.max(0.1, Math.min(0.9, Math.sqrt(Math.abs(value) / max)));
                  return (
                    <td
                      key={m}
                      title={`${MONTHS[m - 1]}: ${value == null ? 'нет данных' : compact(value, metric)}`}
                    >
                      <span
                        className={value == null ? 'heat-missing' : 'heat-cell'}
                        style={
                          value == null
                            ? {}
                            : {
                                background: `rgba(45,112,81,${intensity})`,
                                color: intensity > 0.55 ? 'white' : '#284331',
                              }
                        }
                      >
                        {value == null ? '—' : metric === 'amount' ? num(value / 1e6) : num(value)}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {!names.length && <Empty />}
      </div>
      <p className="chart-note">
        {metric === 'amount' ? 'Суммы в млн ₸.' : 'Объём в тоннах.'} Прочерк означает отсутствие строк в
        выгрузке, а не нулевые продажи.
      </p>
    </>
  );
}

export default function App() {
  const [raw, setRaw] = useState<Dataset>(EMPTY);
  const [tab, setTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState('Читаем выгрузки CRM…');
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [sidebar, setSidebar] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [settings, setSettings] = useState<Settings>(() => {
    try {
      return readSettings(localStorage.getItem('sales-compass-settings'));
    } catch {
      return DEFAULT_SETTINGS;
    }
  });
  const [filters, setFilters] = useState<Filters>({
    start: '2026-01-01',
    end: '2026-12-31',
    channel: '',
    network: '',
    group: '',
    region: '',
    distributor: '',
    comparable: false,
    metric: 'amount',
  });
  const [drill, setDrill] = useState<{ dimension: Dimension; name: string }[]>([]);
  const [structureDim, setStructureDim] = useState<Dimension>('channel');
  const [lossDimension, setLossDimension] = useState<'network' | 'group' | 'sku'>('network');
  const [declinesOnly, setDeclinesOnly] = useState(false);
  const [akbTab, setAkbTab] = useState<'all' | 'new' | 'lost'>('all');
  const [ruleDraft, setRuleDraft] = useState(JSON.stringify(settings.rules, null, 2));
  const [groupDraft, setGroupDraft] = useState(JSON.stringify(settings.groupRules, null, 2));
  const [thresholdDraft, setThresholdDraft] = useState({
    neutralThreshold: String(settings.neutralThreshold),
    realisticThreshold: String(settings.realisticThreshold),
    stretchedThreshold: String(settings.stretchedThreshold),
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const baselineRef = useRef<Sale[]>([]);
  const pendingFiles = useRef<File[]>([]);
  const overridesRef = useRef<Record<string, ImportOverrides>>({});
  const [mappingError, setMappingError] = useState<ImportMappingError | null>(null);
  const [printing, setPrinting] = useState(false);
  const [planMappingError, setPlanMappingError] = useState<PlanColumnMappingError | null>(null);
  const [planColumn, setPlanColumn] = useState('');
  const sales = useMemo(() => applyRules(raw.sales, settings), [raw.sales, settings]);
  const selected = useMemo(() => filterSales(sales, filters), [sales, filters]);
  const byYear = useMemo(() => totalsByYear(selected), [selected]);
  const current = byYear[2026] || zero,
    previous = byYear[2025] || zero;
  const metric = filters.metric;
  const allMonths = useMemo(
    () => filterSales(sales, { ...filters, start: '2026-01-01', end: '2026-12-31' }),
    [sales, filters],
  );
  const networkRows = useMemo(
    () => compareBy(selected, 'network', metric, periodMonths(filters)),
    [selected, metric, filters],
  );
  const groupRows = useMemo(
    () => compareBy(selected, 'group', metric, periodMonths(filters)),
    [selected, metric, filters],
  );
  const channelRows = useMemo(
    () => compareBy(selected, 'channel', metric, periodMonths(filters)),
    [selected, metric, filters],
  );
  const baseGrowth = useMemo(() => {
    const other = totalsByYear(filterSales(sales, { ...filters, comparable: !filters.comparable }));
    const full = filters.comparable ? other : byYear;
    const same = filters.comparable ? byYear : other;
    return {
      full: growth(full[2025][metric], full[2026][metric]),
      same: growth(same[2025][metric], same[2026][metric]),
    };
  }, [sales, filters, byYear, metric]);
  const overviewLosses = useMemo(
    () =>
      compareBy(selected, lossDimension, metric, periodMonths(filters))
        .filter((r) => r.values[2026].amount - r.values[2025].amount < 0)
        .slice(0, 10),
    [selected, lossDimension, metric, filters],
  );
  const planRows = useMemo(
    () => (tab === 'plan' ? planAnalysis(sales, raw.plans, { ...filters, metric: 'tons' }, settings) : []),
    [sales, raw.plans, filters, settings, tab],
  );
  const planTotals = useMemo(
    () => planSummary(sales, raw.plans, { ...filters, metric: 'tons' }, settings),
    [sales, raw.plans, filters, settings],
  );
  const options = useMemo(
    () =>
      Object.fromEntries(
        (['channel', 'network', 'group', 'region', 'distributor'] as const).map((k) => [
          k,
          [...new Set(sales.map((r) => r[k]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru')),
        ]),
      ) as Record<string, string[]>,
    [sales],
  );
  const sourceWarnings = raw.sources.flatMap((s) => s.warnings.map((w) => ({ name: s.name, message: w })));
  const latest = sales.reduce((m, r) => (r.date > m ? r.date : m), '');
  useEffect(() => {
    let active = true;
    loadLocalSamples((m) => active && setProgress(m))
      .then((d) => {
        if (!active) return;
        baselineRef.current = d.sales;
        setRaw(d);
        setFilters(defaultFilters(d.sales));
        setLoading(false);
      })
      .catch((e) => {
        if (active) {
          setError(String(e.message || e));
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);
  async function printReport() {
    setPrinting(true);
    try {
      const { createPdfReport } = await import('./pdfReport');
      const bytes = await createPdfReport({
        sales: selected,
        allSales: sales,
        plans: raw.plans,
        filters,
        settings,
      });
      downloadFile(
        `АН PRO · Продажи ${filters.start.slice(0, 7)} — ${filters.end.slice(0, 7)}.pdf`,
        bytes,
        'application/pdf',
      );
    } catch (error) {
      setToast(`Не удалось создать PDF: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setPrinting(false);
    }
  }
  function choosePeriod(mode: 'month' | 'quarter' | 'ytd') {
    const month = sales.reduce((max, r) => (r.year === 2026 ? Math.max(max, r.month) : max), 1);
    const start = mode === 'month' ? month : mode === 'quarter' ? Math.floor((month - 1) / 3) * 3 + 1 : 1;
    setFilters((f) => ({
      ...f,
      start: `2026-${String(start).padStart(2, '0')}-01`,
      end: `2026-${String(month).padStart(2, '0')}-${new Date(2026, month, 0).getDate()}`,
    }));
    setDrill([]);
  }
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(''), 5000);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  function setFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    const next = { ...filters, [key]: value };
    if (key === 'start' || key === 'end') {
      next.start = `2026${next.start.slice(4)}`;
      next.end = `2026${next.end.slice(4)}`;
      if (next.start > next.end) {
        setToast('Начало периода должно быть не позже конца');
        return;
      }
    }
    setFilters(next);
    setDrill([]);
  }
  async function upload(files: FileList | File[] | null, retry = false) {
    if (!files?.length) return;
    if (!retry) {
      pendingFiles.current = Array.from(files);
      overridesRef.current = {};
    }
    setLoading(true);
    setError('');
    try {
      const d = await importFiles(Array.from(files), setProgress, overridesRef.current);
      const merged = mergeDatasets(raw, d, baselineRef.current);
      if (!baselineRef.current.length && d.sales.length) baselineRef.current = d.sales;
      setRaw(merged);
      if (d.sales.length) setFilters(defaultFilters(merged.sales));
      setDrill([]);
      setMappingError(null);
      setPlanMappingError(null);
      setToast(`Импортировано ${integer.format(d.sales.length)} строк продаж, ${d.plans.length} строк плана`);
    } catch (e) {
      if (e instanceof ImportMappingError) setMappingError(e);
      else if (e instanceof PlanColumnMappingError) {
        setPlanMappingError(e);
        setPlanColumn(e.availableColumns[0]?.column || '');
      } else setError(String((e as Error).message || e));
      setTab('data');
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }
  function saveSettings() {
    try {
      if (Object.values(thresholdDraft).some((value) => !value.trim()))
        throw new Error('Заполните все числовые пороги');
      const updated = validateSettings({
        neutralThreshold: Number(thresholdDraft.neutralThreshold),
        realisticThreshold: Number(thresholdDraft.realisticThreshold),
        stretchedThreshold: Number(thresholdDraft.stretchedThreshold),
        rules: JSON.parse(ruleDraft),
        groupRules: JSON.parse(groupDraft),
      });
      localStorage.setItem('sales-compass-settings', JSON.stringify(updated));
      setSettings(updated);
      setToast('Настройки сохранены, данные пересчитаны');
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function drillNetwork(name: string) {
    setFilter('network', name);
    setTab('products');
    setDrill([]);
  }
  const comparisonExport = (rows: Comparison[]) =>
    rows.map((r) => ({
      Наименование: r.name,
      '2024': r.values[2024]?.[metric] || 0,
      '2025': r.values[2025]?.[metric] || 0,
      '2026': r.values[2026]?.[metric] || 0,
      Δ: r.delta,
      'Δ %': r.growth,
    }));
  const periodText =
    filters.start.slice(0, 7) === filters.end.slice(0, 7)
      ? dateLabel(filters.end)
      : `${SHORT[Number(filters.start.slice(5, 7)) - 1]} — ${SHORT[Number(filters.end.slice(5, 7)) - 1]} ${filters.end.slice(0, 4)}`;
  const activeFilters = (['channel', 'network', 'group', 'region', 'distributor'] as const).filter(
    (k) => filters[k],
  );
  const channelPie = channelRows
    .map((r) => ({ name: r.name, value: r.values[2026]?.[metric] || 0 }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);
  const positive = networkRows.filter((r) => r.delta > 0).sort((a, b) => b.delta - a.delta);
  const lossesByMoney = useMemo(
    () =>
      compareBy(selected, 'network', 'amount', periodMonths(filters))
        .filter((r) => r.delta < 0)
        .sort((a, b) => a.delta - b.delta),
    [selected, filters],
  );
  const negative = lossesByMoney.map((r) => networkRows.find((n) => n.name === r.name)!).filter(Boolean);
  const latestPlanMonth = Math.max(0, ...planTotals.filter((p) => p.planned != null).map((p) => p.month));
  const plansWithValue = planTotals.filter((p) => p.planned != null && p.month === latestPlanMonth);
  const totalPlan = plansWithValue.reduce((s, p) => s + (p.planned || 0), 0);
  const totalPlanActual = plansWithValue.reduce((s, p) => s + p.actual, 0);
  const planCompletion = plansWithValue[0]?.completion ?? null;
  function kpis() {
    return (
      <div className="kpi-grid">
        <div className="kpi-card primary">
          <div className="kpi-label">
            Выручка с НДС <span>2026</span>
          </div>
          <div className="kpi-value">{compact(current.amount)}</div>
          <Delta value={growth(previous.amount, current.amount)} />
          <div className="kpi-foot">
            {compact(previous.amount)} <span>в 2025 году</span>
          </div>
          <div className="kpi-decoration">
            <ChartNoAxesCombined size={55} />
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">
            Объём продаж <Package size={17} />
          </div>
          <div className="kpi-value">
            {current.tons.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
            <small> т</small>
          </div>
          <Delta value={growth(previous.tons, current.tons)} />
          <div className="kpi-foot">
            {num(previous.tons)} т <span>в 2025 году</span>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">
            АКБ · по названиям <Users size={17} />
          </div>
          <div className="kpi-value">
            {integer.format(current.points)}
            <small> точек</small>
          </div>
          <Delta value={growth(previous.points, current.points)} />
          <div className="kpi-foot">
            {integer.format(current.skuCount)} SKU <span>в продажах</span>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">
            План · {latestPlanMonth ? SHORT[latestPlanMonth - 1] : 'объём'} <Target size={17} />
          </div>
          <div className="kpi-value">{planCompletion != null ? `${num(planCompletion)}%` : '—'}</div>
          {planCompletion != null ? (
            <>
              <div className="progress-track">
                <i style={{ width: `${Math.max(0, Math.min(100, planCompletion || 0))}%` }} />
              </div>
              <div className="kpi-foot">План {compact(totalPlan, 'tons')}</div>
            </>
          ) : (
            <>
              <span className="tag neutral">
                {totalPlan ? 'Нет сопоставимой базы' : 'План за период не загружен'}
              </span>
              <div className="kpi-foot">Доступно планов: {raw.plans.length}</div>
            </>
          )}
        </div>
      </div>
    );
  }
  function overview() {
    const groupLoss = groupRows.slice().sort((a, b) => a.delta - b.delta)[0];
    return (
      <>
        <div className="overview-intro">
          <div className="eyebrow">
            <span /> ПУЛЬС БИЗНЕСА
          </div>
          <span className="muted">Суммы с НДС · период может быть неполным</span>
        </div>
        {kpis()}
        <div className="insights-bar">
          <div className="insight-icon">
            <Compass size={21} />
          </div>
          <div>
            <strong>
              Выручка {pct(growth(previous.amount, current.amount))} · объём{' '}
              {pct(growth(previous.tons, current.tons))} к 2025
            </strong>
            <p>
              {groupLoss && groupLoss.delta < 0
                ? `Наибольшие потери в группе «${groupLoss.name}»: ${compact(groupLoss.delta, metric)}. `
                : ''}
              {negative.length} сетей и клиентов снизили выручку.{' '}
              {filters.comparable ? 'Включена сопоставимая база.' : 'В расчёт включены новые и ушедшие сети.'}
            </p>
            <p>
              Общий прирост {pct(baseGrowth.full)} · на сопоставимой базе {pct(baseGrowth.same)}
              {baseGrowth.full !== null && baseGrowth.same !== null
                ? ` · эффект изменений базы ${signed(baseGrowth.full - baseGrowth.same)} п.п.`
                : ''}
            </p>
          </div>
          <button className="text-button" onClick={() => setTab('products')}>
            Открыть группы <ArrowRight size={15} />
          </button>
        </div>
        <Panel
          title="Где теряем продажи"
          sub="Топ-10 по абсолютному снижению выручки к 2025 · нажмите для детализации"
          action={
            <select
              aria-label="Разрез потерь"
              value={lossDimension}
              onChange={(e) => setLossDimension(e.target.value as typeof lossDimension)}
            >
              <option value="network">Сети</option>
              <option value="group">Товарные группы</option>
              <option value="sku">Номенклатура SKU</option>
            </select>
          }
        >
          <ComparisonTable
            rows={overviewLosses}
            metric={metric}
            onClick={(name) => {
              if (lossDimension === 'network') drillNetwork(name);
              else {
                setTab('products');
                setDrill(
                  lossDimension === 'group'
                    ? [{ dimension: 'group', name }]
                    : [
                        { dimension: 'group', name: selected.find((r) => r.sku === name)?.group || '' },
                        { dimension: 'sku', name },
                      ],
                );
              }
            }}
            title="Потери продаж"
            threshold={settings.neutralThreshold}
          />
        </Panel>
        <div className="content-grid equal">
          <Panel title="Динамика продаж" sub="Одинаковые месяцы трёх лет" action={<LegendYears />}>
            <TrendChart rows={selected} metric={metric} months={periodMonths(filters)} />
          </Panel>
          <Panel title="Вклад товарных групп" sub="Из чего складывается изменение к 2025 году">
            <Waterfall
              rows={groupRows}
              previous={previous[metric]}
              current={current[metric]}
              metric={metric}
            />
          </Panel>
        </div>
      </>
    );
  }
  function dynamics() {
    const monthData = aggregateMonthly(selected, metric).filter((r) =>
      periodMonths(filters).includes(r.month),
    );
    return (
      <>
        {kpis()}
        <Panel
          title="История продаж · 2024–2026"
          sub="Три года рядом за одинаковые месяцы; отсутствующие значения не заменяются нулём"
          action={<LegendYears />}
        >
          <ResponsiveContainer width="100%" height={360}>
            <BarChart data={monthData} margin={{ top: 10, right: 20, bottom: 10, left: 5 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 5" stroke="#e5e9df" />
              <XAxis dataKey="label" />
              <YAxis
                width={75}
                tickFormatter={(v) => (metric === 'amount' ? `${num(v / 1e6)} млн` : num(v))}
              />
              <Tooltip formatter={(v) => compact(Number(v), metric)} />
              <Bar
                isAnimationActive={false}
                dataKey="2024"
                name="2024"
                fill="#b7c7a8"
                radius={[3, 3, 0, 0]}
              />
              <Bar
                isAnimationActive={false}
                dataKey="2025"
                name="2025"
                fill="#dfb071"
                radius={[3, 3, 0, 0]}
              />
              <Bar
                isAnimationActive={false}
                dataKey="2026"
                name="2026"
                fill="#266a50"
                radius={[3, 3, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="Изменение продаж по товарным группам" sub="Абсолютный вклад в разницу к прошлому году">
          <Waterfall rows={groupRows} previous={previous[metric]} current={current[metric]} metric={metric} />
        </Panel>
        <Panel
          title="Помесячные результаты"
          action={
            <ExportButton
              name="Продажи по месяцам"
              rows={monthData as unknown as Record<string, unknown>[]}
            />
          }
        >
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Месяц</th>
                  {YEARS.map((y) => (
                    <th key={y}>{y}</th>
                  ))}
                  <th>Δ 2025 / 2024</th>
                  <th>Δ 2026 / 2025</th>
                </tr>
              </thead>
              <tbody>
                {monthData.map((r) => (
                  <tr key={r.month}>
                    <td>{MONTHS[r.month - 1]}</td>
                    {YEARS.map((y) => (
                      <td key={y}>{r[y] == null ? '—' : compact(r[y], metric)}</td>
                    ))}
                    <td>{r[2025] == null || r[2024] == null ? '—' : pct(growth(r[2024], r[2025]))}</td>
                    <td>{r[2026] == null || r[2025] == null ? '—' : pct(growth(r[2025], r[2026]))}</td>
                  </tr>
                ))}
                <tr>
                  <td>
                    <strong>Итого за период</strong>
                  </td>
                  {YEARS.map((y) => (
                    <td key={y}>
                      <strong>{compact(byYear[y][metric], metric)}</strong>
                      <small className="secondary-value">
                        {compact(
                          byYear[y][metric === 'amount' ? 'tons' : 'amount'],
                          metric === 'amount' ? 'tons' : 'amount',
                        )}
                      </small>
                    </td>
                  ))}
                  <td>{pct(growth(byYear[2024][metric], byYear[2025][metric]))}</td>
                  <td>{pct(growth(byYear[2025][metric], byYear[2026][metric]))}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Panel>
      </>
    );
  }
  function structure() {
    const rows = compareBy(selected, structureDim, metric, periodMonths(filters));
    return (
      <>
        <Panel
          title="Как меняется структура бизнеса"
          sub="Доля каждого канала или сети в продажах выбранного периода"
          action={
            <select value={structureDim} onChange={(e) => setStructureDim(e.target.value as Dimension)}>
              <option value="channel">По каналам</option>
              <option value="network">По сетям</option>
            </select>
          }
        >
          <ShareStack
            rows={selected}
            dimension={structureDim === 'network' ? 'network' : 'channel'}
            metric={metric}
          />
        </Panel>
        <Panel title="Продажи и изменение доли" sub="Доля каждого года указана под показателем продаж">
          <ComparisonTable
            rows={rows}
            metric={metric}
            title="Структура продаж"
            showShares
            threshold={settings.neutralThreshold}
          />
        </Panel>
      </>
    );
  }
  function products() {
    const dims: Dimension[] = ['group', 'sku', 'network', 'point'];
    const depth = drill.filter((item) => item.dimension !== 'client').length;
    const filtered = selected.filter((r) => drill.every((d) => r[d.dimension] === d.name));
    const dim = dims[Math.min(depth, 3)];
    const rows = compareBy(filtered, dim, metric, periodMonths(filters));
    const yearTotals = totalsByYear(filtered);
    const skuRows = compareBy(filtered, 'sku', metric, periodMonths(filters));
    const skuLosses = compareBy(filtered, 'sku', 'amount', periodMonths(filters))
      .filter((r) => r.delta < 0)
      .sort((a, b) => a.delta - b.delta)
      .slice(0, 10)
      .map((r) => skuRows.find((x) => x.name === r.name)!)
      .filter(Boolean);
    return (
      <>
        <div className="breadcrumbs">
          <button onClick={() => setDrill([])}>Все товары</button>
          {drill.map((d, i) => (
            <span key={`${d.dimension}-${d.name}`}>
              <ChevronRight size={14} />
              <button onClick={() => setDrill(drill.slice(0, i + 1))}>{d.name}</button>
            </span>
          ))}
        </div>
        <div className="mini-kpis">
          {YEARS.map((y) => (
            <div key={y}>
              <span>Продажи {y}</span>
              <strong>{compact(yearTotals[y]?.[metric] || 0, metric)}</strong>
            </div>
          ))}
        </div>
        <Panel
          title={
            ['Товарные группы', 'Номенклатура SKU', 'Сети и клиенты', 'Торговые точки'][Math.min(depth, 3)]
          }
          sub="Последовательно откройте группу → SKU → сеть → торговую точку"
        >
          <ComparisonTable
            rows={rows}
            metric={metric}
            onClick={depth < 3 ? (name) => setDrill([...drill, { dimension: dim, name }]) : undefined}
            title="Детализация товаров"
            showShares
            limit={15}
            threshold={settings.neutralThreshold}
          />
        </Panel>
        {depth < 2 && (
          <details className="panel declining-skus">
            <summary>
              SKU с наибольшим снижением выручки <span>{skuLosses.length} позиций</span>
            </summary>
            <ComparisonTable
              rows={skuLosses}
              metric={metric}
              title="Потери продаж"
              onClick={(name) => {
                const group = filtered.find((r) => r.sku === name)?.group || '';
                setDrill([
                  ...drill.filter((item) => item.dimension === 'client'),
                  { dimension: 'group', name: group },
                  { dimension: 'sku', name },
                ]);
              }}
              threshold={settings.neutralThreshold}
            />
          </details>
        )}
      </>
    );
  }
  function segment(channel: string, title: string) {
    const rows = selected.filter((r) => r.channel === channel);
    const full = allMonths.filter((r) => r.channel === channel);
    const compare = compareBy(rows, 'network', metric);
    const t = totalsByYear(rows);
    return (
      <>
        <div className="mini-kpis">
          <div>
            <span>{title} · 2026</span>
            <strong>{compact(t[2026]?.[metric] || 0, metric)}</strong>
          </div>
          <div>
            <span>Изменение к 2025</span>
            <strong
              className={
                (t[2026]?.[metric] || 0) >= (t[2025]?.[metric] || 0) ? 'text-positive' : 'text-negative'
              }
            >
              {pct(growth(t[2025]?.[metric] || 0, t[2026]?.[metric] || 0))}
            </strong>
          </div>
          <div>
            <span>Активных торговых точек</span>
            <strong>{t[2026]?.points || 0}</strong>
          </div>
        </div>
        <Panel
          title={`${title}: сети × товарные группы`}
          sub="Изменение к 2025 году за выбранный период; отсутствие базы отмечено отдельно"
        >
          <GroupHeatmap
            rows={rows}
            metric={metric}
            onClick={drillNetwork}
            threshold={settings.neutralThreshold}
          />
        </Panel>
        <Panel title="Сравнение сетей" sub="Деньги, объёмы и изменение к прошлому году">
          <ComparisonTable
            rows={compare}
            metric={metric}
            onClick={drillNetwork}
            title={title}
            threshold={settings.neutralThreshold}
          />
        </Panel>
        <Panel title="Какие группы формируют канал">
          <ComparisonTable
            rows={compareBy(rows, 'group', metric)}
            metric={metric}
            onClick={(name) => {
              setFilter('channel', channel);
              setDrill([{ dimension: 'group', name }]);
              setTab('products');
            }}
            title={`${title} по группам`}
            threshold={settings.neutralThreshold}
          />
        </Panel>
      </>
    );
  }
  function clients() {
    const rows = selected.filter((r) => !['Онлайн', 'Ключевые сети'].includes(r.channel));
    const comp = compareBy(rows, 'client', metric);
    const losses = comp
      .filter((r) => r.delta < 0)
      .sort((a, b) => a.delta - b.delta)
      .slice(0, 7);
    const gains = comp
      .filter((r) => r.delta > 0)
      .sort((a, b) => b.delta - a.delta)
      .slice(0, 7);
    return (
      <>
        <div className="content-grid equal">
          <Panel title="Клиенты с падением" sub="Наибольшее абсолютное снижение">
            <SignedChanges rows={losses} metric={metric} threshold={settings.neutralThreshold} />
          </Panel>
          <Panel title="Клиенты с ростом" sub="Наибольший абсолютный прирост">
            <SignedChanges rows={gains} metric={metric} threshold={settings.neutralThreshold} />
          </Panel>
        </div>
        <Panel
          title="Прочие клиенты и дистрибьюторы"
          sub="Клиенты вне каналов «Онлайн» и «Ключевые сети»"
          action={
            <label>
              <input
                type="checkbox"
                checked={declinesOnly}
                onChange={(e) => setDeclinesOnly(e.target.checked)}
              />{' '}
              Только падающие
            </label>
          }
        >
          <ComparisonTable
            rows={declinesOnly ? comp.filter((r) => r.delta < 0) : comp}
            metric={metric}
            title="Прочие клиенты"
            onClick={(name) => {
              setDrill([{ dimension: 'client', name }]);
              setTab('products');
            }}
            limit={15}
            threshold={settings.neutralThreshold}
          />
        </Panel>
      </>
    );
  }
  function akb() {
    const old = new Map<string, Sale[]>(),
      now = new Map<string, Sale[]>();
    for (const r of selected) {
      if (r.amount <= 0 && r.tons <= 0) continue;
      const key = `${r.region} · ${r.point}`;
      const m = r.year === 2025 ? old : r.year === 2026 ? now : null;
      if (m) {
        if (!m.has(key)) m.set(key, []);
        m.get(key)!.push(r);
      }
    }
    const newly = [...now.keys()].filter((k) => !old.has(k)),
      lost = [...old.keys()].filter((k) => !now.has(k)),
      retained = [...now.keys()].filter((k) => old.has(k));
    const keys =
      akbTab === 'new' ? newly : akbTab === 'lost' ? lost : [...new Set([...now.keys(), ...old.keys()])];
    const groups = groupRows.map((g) => {
      const r = selected.filter((s) => s.group === g.name);
      const t = totalsByYear(r);
      return { name: g.name, '2025': t[2025]?.points || 0, '2026': t[2026]?.points || 0 };
    });
    const exportRows = keys.map((key) => ({
      Точка: key,
      '2025': totals(old.get(key) || [])[metric],
      '2026': totals(now.get(key) || [])[metric],
      Статус: !old.has(key) ? 'Новая' : !now.has(key) ? 'Ушла' : 'Сохранена',
    }));
    return (
      <>
        <div className="mini-kpis four">
          <div>
            <span>Активных точек · 2026</span>
            <strong>{integer.format(now.size)}</strong>
          </div>
          <div>
            <span>Новые точки</span>
            <strong className="text-positive">+{integer.format(newly.length)}</strong>
          </div>
          <div>
            <span>Ушедшие точки</span>
            <strong className="text-negative">−{integer.format(lost.length)}</strong>
          </div>
          <div>
            <span>Сохранено от базы 2025</span>
            <strong>{old.size ? `${num((retained.length / old.size) * 100)}%` : '—'}</strong>
          </div>
        </div>
        <Panel title="АКБ по товарным группам" sub="Одна точка может покупать несколько групп">
          <ResponsiveContainer width="100%" height={290}>
            <BarChart data={groups} margin={{ left: 0, right: 12 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 5" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis tickLine={false} axisLine={false} />
              <Tooltip />
              <Legend />
              <Bar isAnimationActive={false} dataKey="2025" fill="#d7c4a5" radius={[4, 4, 0, 0]} />
              <Bar isAnimationActive={false} dataKey="2026" fill="#347b5b" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
        <Panel
          title="Движение клиентской базы"
          sub="Прокси точки: город + название клиента. Уникальный код точки в CRM отсутствует"
          action={<ExportButton name="Клиентская база" rows={exportRows} />}
        >
          <div className="segmented inline">
            {(
              [
                ['all', 'Все точки'],
                ['new', 'Новые'],
                ['lost', 'Ушедшие'],
              ] as const
            ).map(([id, label]) => (
              <button className={akbTab === id ? 'active' : ''} key={id} onClick={() => setAkbTab(id)}>
                {label}
              </button>
            ))}
          </div>
          <SimpleTable rows={exportRows} limit={30} />
          <p className="chart-note">
            «Ушла» означает отсутствие продаж в выбранных месяцах 2026 при наличии продаж в тех же месяцах
            2025.
          </p>
        </Panel>
      </>
    );
  }
  function sku() {
    const rows = compareBy(selected, 'sku', metric);
    const matrices = new Map<string, Set<string>>();
    for (const r of selected.filter((r) => r.year === 2026)) {
      if (!matrices.has(r.network)) matrices.set(r.network, new Set());
      matrices.get(r.network)!.add(r.sku);
    }
    const oldMatrices = new Map<string, Set<string>>();
    for (const r of selected.filter((r) => r.year === 2025)) {
      if (!oldMatrices.has(r.network)) oldMatrices.set(r.network, new Set());
      oldMatrices.get(r.network)!.add(r.sku);
    }
    const matrixRows = [...new Set([...matrices.keys(), ...oldMatrices.keys()])]
      .map((n) => ({
        Сеть: n,
        'SKU 2025': oldMatrices.get(n)?.size || 0,
        'SKU 2026': matrices.get(n)?.size || 0,
        Добавлено: [...(matrices.get(n) || [])].filter((s) => !oldMatrices.get(n)?.has(s)).length,
        Выбыло: [...(oldMatrices.get(n) || [])].filter((s) => !matrices.get(n)?.has(s)).length,
      }))
      .sort((a, b) => b['SKU 2026'] - a['SKU 2026']);
    return (
      <>
        <div className="mini-kpis">
          <div>
            <span>SKU в 2026</span>
            <strong>{current.skuCount}</strong>
          </div>
          <div>
            <span>SKU в 2025</span>
            <strong>{previous.skuCount}</strong>
          </div>
          <div>
            <span>Среднее SKU на сеть</span>
            <strong>
              {matrices.size
                ? num([...matrices.values()].reduce((s, v) => s + v.size, 0) / matrices.size)
                : '—'}
            </strong>
          </div>
        </div>
        <Panel
          title="Ширина ассортиментной матрицы"
          sub="Число продаваемых SKU по сетям"
          action={<ExportButton name="Ассортиментная матрица" rows={matrixRows} />}
        >
          <SimpleTable rows={matrixRows} />
        </Panel>
        <Panel title="Эффективность SKU" sub="Нажмите на SKU, чтобы увидеть распределение продаж по сетям">
          <ComparisonTable
            rows={rows}
            metric={metric}
            title="Эффективность SKU"
            onClick={(name) => {
              const group = selected.find((r) => r.sku === name)?.group || '';
              setDrill([
                { dimension: 'group', name: group },
                { dimension: 'sku', name },
              ]);
              setTab('products');
            }}
            limit={20}
          />
        </Panel>
      </>
    );
  }
  function plan() {
    const rows = planRows.map((p) => ({
      Показатель: p.label,
      Период: `${MONTHS[p.month - 1]} ${p.year}`,
      'Факт 2025, т': p.values[2025]?.tons ?? null,
      'План 2026, т': p.planned,
      'Факт 2026, т': p.comparable && p.completion != null ? p.actual : null,
      'Рост 2025/2024, %': p.historicalGrowth,
      'План / 2025, %': p.plannedGrowth,
      'Рост факта 2026, %': p.actualGrowth,
      'Выполнение, %': p.completion,
      'Разрыв роста, п.п.': p.gap,
      Оценка: p.assessment,
    }));
    return (
      <>
        <div className="notice">
          <CircleHelp size={19} />
          <div>
            <strong>Оценка плана на основе сопоставимой базы</strong>
            <p>
              В исходных планах категория А задана только в килограммах: план-факт показан в тоннах. Денежного
              плана нет. Месячные выгрузки не позволяют рассчитать дневной темп и прогноз.
            </p>
          </div>
        </div>
        <div className="mini-kpis">
          <div>
            <span>План · последний месяц периода</span>
            <strong>{totalPlan ? compact(totalPlan, 'tons') : '—'}</strong>
          </div>
          <div>
            <span>Выполнение</span>
            <strong>{planCompletion != null ? `${num(planCompletion)}%` : '—'}</strong>
          </div>
          <div>
            <span>Отклонение факта от плана</span>
            <strong className={totalPlanActual >= totalPlan ? 'text-positive' : 'text-negative'}>
              {planCompletion != null ? compact(totalPlanActual - totalPlan, 'tons') : '—'}
            </strong>
          </div>
        </div>
        <Panel
          title="План и факт продаж"
          sub="План учитывается только там, где найдена однозначная связь с продажами"
          action={<ExportButton name="План-факт" rows={rows} />}
        >
          <SimpleTable rows={rows} limit={30} />
        </Panel>
        {planRows.some((p) => p.warning) && (
          <Panel title="Что требует проверки">
            <div className="warning-list">
              {planRows
                .filter((p) => p.warning)
                .map((p, i) => (
                  <div key={i}>
                    <AlertTriangle size={16} />
                    <p>
                      <strong>{p.label}</strong> — {p.warning}
                    </p>
                  </div>
                ))}
            </div>
          </Panel>
        )}
        <Panel title="Правила оценки реалистичности" sub="Настраиваются в разделе «Настройки»">
          <div className="assessment-grid">
            <div>
              <span className="tag up">Реалистичный</span>
              <p>Рост плана превышает исторический рост не более чем на {settings.realisticThreshold} п.п.</p>
            </div>
            <div>
              <span className="tag warning">Напряжённый</span>
              <p>
                Превышение исторического роста от {settings.realisticThreshold} до{' '}
                {settings.stretchedThreshold} п.п.
              </p>
            </div>
            <div>
              <span className="tag down">Нереалистичный</span>
              <p>Превышение более {settings.stretchedThreshold} п.п. или рост плана при снижении факта YTD</p>
            </div>
          </div>
        </Panel>
      </>
    );
  }
  function data() {
    return (
      <>
        <div
          className="upload-zone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            upload(e.dataTransfer.files);
          }}
        >
          <div className="upload-zone-icon">
            <Upload size={25} />
          </div>
          <h3>Добавьте выгрузки CRM и планы</h3>
          <p>Перетащите Excel-файлы сюда или выберите на компьютере</p>
          <button className="button primary" onClick={() => fileRef.current?.click()}>
            <Upload size={16} />
            Выбрать файлы
          </button>
          <small>.xlsx, .xls, .csv · продажи за совпадающий месяц заменяют предыдущую загрузку</small>
        </div>
        <Panel
          title="Источники данных"
          sub={`${raw.sources.length} файлов · ${integer.format(raw.sales.length)} строк продаж`}
          action={
            <ExportButton
              name="Источники"
              rows={raw.sources.map((s) => ({
                Файл: s.name,
                Тип: s.kind,
                Строк: s.rows,
                Сумма: s.amount,
                Тонны: s.tons,
                Начало: s.minDate,
                Конец: s.maxDate,
                Предупреждения: s.warnings.join('; '),
              }))}
            />
          }
        >
          <div className="source-list">
            {raw.sources.map((s, i) => (
              <div className="source-row" key={`${s.name}-${i}`}>
                <div className={`source-icon ${s.kind}`}>
                  <FileSpreadsheet size={22} />
                </div>
                <div className="source-name">
                  <strong>{s.name}</strong>
                  <span>
                    {s.kind === 'sales' ? 'Продажи CRM' : 'План продаж'} · {integer.format(s.rows)} строк
                    {s.minDate ? ` · ${dateLabel(s.minDate)} — ${dateLabel(s.maxDate || s.minDate)}` : ''}
                  </span>
                </div>
                <span className="source-amount">
                  {s.amount != null ? compact(s.amount) : '—'}
                  <small>{s.tons != null ? `${num(s.tons)} т` : ''}</small>
                </span>
                <span className={`status-badge ${s.warnings.length ? 'warning' : 'success'}`}>
                  {s.warnings.length ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />}{' '}
                  {s.warnings.length ? `${s.warnings.length} замечаний` : 'Проверено'}
                </span>
              </div>
            ))}
          </div>
        </Panel>
        {sourceWarnings.length > 0 && (
          <Panel
            title="Замечания к данным"
            sub="Отражены особенности реальных выгрузок, которые влияют на расчёты"
          >
            <div className="warning-list">
              {sourceWarnings.map((w, i) => (
                <div key={i}>
                  <AlertTriangle size={16} />
                  <p>
                    <strong>{w.name}</strong>
                    <br />
                    {w.message}
                  </p>
                </div>
              ))}
            </div>
          </Panel>
        )}
        <DataCoverage sales={sales} filters={filters} />
        <Panel title="Как читаются файлы" sub="Правила импорта">
          <div className="method-grid">
            <div>
              <strong>Месячная точность</strong>
              <p>
                В CRM-выгрузках периоды заданы по месяцам. Дни и ежедневная динамика не восстанавливаются.
              </p>
            </div>
            <div>
              <strong>Без двойного счёта</strong>
              <p>Итоговые строки и промежуточные суммы отделяются от строк с товарами и продажами.</p>
            </div>
            <div>
              <strong>Прозрачное сопоставление</strong>
              <p>Правила объединения клиентов в сети и группы доступны для редактирования в настройках.</p>
            </div>
          </div>
        </Panel>
      </>
    );
  }
  function settingsPage() {
    return (
      <>
        <Panel
          title="Параметры анализа"
          sub="Изменения сохраняются в этом браузере и применяются ко всему дашборду"
        >
          <div className="settings-grid">
            <label>
              Нейтральная зона изменения, %
              <input
                type="number"
                min="0"
                step="0.1"
                value={thresholdDraft.neutralThreshold}
                onChange={(e) => setThresholdDraft({ ...thresholdDraft, neutralThreshold: e.target.value })}
              />
              <small>Изменения в пределах порога отмечаются нейтральным цветом.</small>
            </label>
            <label>
              Реалистичный разрыв роста, п.п.
              <input
                type="number"
                min="0"
                value={thresholdDraft.realisticThreshold}
                onChange={(e) => setThresholdDraft({ ...thresholdDraft, realisticThreshold: e.target.value })}
              />
              <small>Допустимое превышение роста плана над ростом 2025/2024.</small>
            </label>
            <label>
              Напряжённый разрыв роста, п.п.
              <input
                type="number"
                min="0"
                value={thresholdDraft.stretchedThreshold}
                onChange={(e) => setThresholdDraft({ ...thresholdDraft, stretchedThreshold: e.target.value })}
              />
              <small>Выше этого превышения исторического роста план нереалистичен.</small>
            </label>
          </div>
        </Panel>
        <Panel
          title="Объединение клиентов в сети и каналы"
          sub="JSON-массив: pattern — регулярное выражение, network — сеть, channel — канал"
        >
          <textarea
            className="code-editor"
            spellCheck={false}
            value={ruleDraft}
            onChange={(e) => setRuleDraft(e.target.value)}
            rows={19}
          />
          <p className="chart-note">
            Правила применяются по порядку. Более точные названия размещайте выше общих.
          </p>
        </Panel>
        <Panel
          title="Распределение SKU по товарным группам"
          sub="JSON-массив: pattern — регулярное выражение по названию SKU, group — группа"
        >
          <textarea
            className="code-editor"
            spellCheck={false}
            value={groupDraft}
            onChange={(e) => setGroupDraft(e.target.value)}
            rows={7}
          />
          <p className="chart-note">
            Пример: [{JSON.stringify({ pattern: 'греч', group: 'Крупы' })}]. Пустой массив сохраняет группы
            исходной выгрузки.
          </p>
        </Panel>
        <div className="settings-actions">
          <button
            className="button"
            onClick={() => {
              setThresholdDraft({
                neutralThreshold: String(DEFAULT_SETTINGS.neutralThreshold),
                realisticThreshold: String(DEFAULT_SETTINGS.realisticThreshold),
                stretchedThreshold: String(DEFAULT_SETTINGS.stretchedThreshold),
              });
              setRuleDraft(JSON.stringify(DEFAULT_SETTINGS.rules, null, 2));
              setGroupDraft('[]');
            }}
          >
            <RefreshCw size={15} />
            По умолчанию
          </button>
          <button className="button primary" onClick={saveSettings}>
            <Check size={16} />
            Сохранить и пересчитать
          </button>
        </div>
      </>
    );
  }
  const views: Record<Tab, () => ReactNode> = {
    overview,
    dynamics,
    structure,
    products,
    online: () => segment('Онлайн', 'Онлайн'),
    networks: () => segment('Ключевые сети', 'Ключевые сети'),
    clients,
    akb: () => <ActiveBaseView rows={selected} threshold={settings.neutralThreshold} />,
    sku: () => <SkuMatrixView rows={selected} threshold={settings.neutralThreshold} />,
    plan,
    data,
    settings: settingsPage,
  };
  const subtitles: Record<Tab, string> = {
    overview: 'Главные цифры. Причины изменений. Возможности роста.',
    dynamics: 'Три года продаж в единой системе координат.',
    structure: 'Как меняется вклад каналов, сетей и товарных групп.',
    products: 'От товарной группы до конкретной торговой точки.',
    online: 'Продажи и ассортимент в цифровых каналах.',
    networks: 'Результаты ключевых сетей и покрытие по месяцам.',
    clients: 'Динамика клиентов вне ключевых сетей и онлайн-канала.',
    akb: 'Какие клиенты приходят, остаются и перестают покупать.',
    sku: 'Глубина ассортимента и эффективность каждой позиции.',
    plan: 'Выполнение и реалистичность плана продаж.',
    data: 'Источники, полнота выгрузок и прозрачность расчётов.',
    settings: 'Правила сопоставления и параметры вашей аналитики.',
  };
  return (
    <div className={`app-shell ${sidebar ? 'sidebar-open' : ''}`}>
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setTab('overview');
          }}
        >
          <div className="brand-mark">
            <ChartNoAxesCombined size={23} />
          </div>
          <div>
            <strong>АНАЛИТИКА</strong>
            <span>ПРОДАЖИ / 2024–2026</span>
          </div>
        </a>
        <div className="workspace-card">
          <div className="workspace-avatar">АН</div>
          <div>
            <strong>АН PRO</strong>
            <span>Коммерческий отдел</span>
          </div>
          <ChevronDown size={14} />
        </div>
        <span className="nav-caption">РАБОЧЕЕ ПРОСТРАНСТВО</span>
        <nav>
          {NAV.slice(0, 10).map((item) => (
            <button
              key={item.id}
              className={tab === item.id ? 'active' : ''}
              onClick={() => {
                setTab(item.id);
                setSidebar(false);
                setDrill([]);
              }}
            >
              <item.icon size={18} />
              <span>{item.label}</span>
              {item.id === 'overview' && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="nav-caption">УПРАВЛЕНИЕ</span>
          <nav>
            {NAV.slice(10).map((item) => (
              <button
                key={item.id}
                className={tab === item.id ? 'active' : ''}
                onClick={() => {
                  setTab(item.id);
                  setSidebar(false);
                }}
              >
                <item.icon size={17} />
                <span>{item.label}</span>
                {item.id === 'data' && sourceWarnings.length > 0 && (
                  <span className="nav-count">{sourceWarnings.length}</span>
                )}
              </button>
            ))}
          </nav>
          <div className="sidebar-status">
            <span className="online-dot" />
            <div>
              <strong>Локальное приложение</strong>
              <span>Расчёты в вашем браузере</span>
            </div>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button mobile-menu" onClick={() => setSidebar(!sidebar)}>
              <Menu size={20} />
            </button>
            <span>Рабочее пространство</span>
            <ChevronRight size={13} />
            <strong>{NAV.find((n) => n.id === tab)?.label}</strong>
          </div>
          <div className="topbar-right">
            <span className="local-indicator">
              <span />
              CRM · {latest ? dateLabel(latest) : 'нет данных'}
            </span>
            <div className="avatar">М</div>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">АНАЛИТИКА ПРОДАЖ</div>
              <h1>{tab === 'overview' ? 'Где теряем продажи' : NAV.find((n) => n.id === tab)?.label}</h1>
              <p>{subtitles[tab]}</p>
            </div>
            <div className="page-actions">
              <button
                className="button"
                aria-label="Отчёт PDF"
                disabled={loading || printing || !sales.length}
                onClick={printReport}
              >
                <Printer size={16} />
                <span>{printing ? 'Формируем PDF…' : 'Отчёт PDF'}</span>
              </button>
              <button
                className="button primary"
                aria-label="Загрузить данные"
                disabled={loading || printing}
                onClick={() => fileRef.current?.click()}
              >
                <Upload size={16} />
                <span>Загрузить данные</span>
              </button>
            </div>
          </div>
          <input
            type="file"
            multiple
            accept=".xlsx,.xls,.csv"
            ref={fileRef}
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              e.target.value = '';
              void upload(files);
            }}
          />
          {!['settings', 'data'].includes(tab) && (
            <div className="filters-card">
              <div className="filter-main-row">
                <div className="period-control">
                  <CalendarDays size={17} />
                  <label>
                    <span>ПЕРИОД</span>
                    <select
                      aria-label="Начало периода"
                      value={filters.start.slice(0, 7)}
                      onChange={(e) => e.target.value && setFilter('start', `${e.target.value}-01`)}
                    >
                      {Array.from({ length: 12 }, (_, i) => (
                        <option key={i} value={`2026-${String(i + 1).padStart(2, '0')}`}>
                          {new Date(2026, i, 1).toLocaleDateString('ru-RU', {
                            month: 'short',
                            year: 'numeric',
                          })}
                        </option>
                      ))}
                    </select>
                  </label>
                  <span className="period-dash">—</span>
                  <label>
                    <span>ПО</span>
                    <select
                      aria-label="Конец периода"
                      value={filters.end.slice(0, 7)}
                      onChange={(e) => {
                        if (e.target.value) {
                          const [y, m] = e.target.value.split('-').map(Number);
                          setFilter('end', `${e.target.value}-${new Date(y, m, 0).getDate()}`);
                        }
                      }}
                    >
                      {Array.from({ length: 12 }, (_, i) => (
                        <option key={i} value={`2026-${String(i + 1).padStart(2, '0')}`}>
                          {new Date(2026, i, 1).toLocaleDateString('ru-RU', {
                            month: 'short',
                            year: 'numeric',
                          })}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="filter-divider" />
                <div className="metric-control">
                  <span className="filter-label">ПОКАЗАТЕЛЬ</span>
                  <div className="segmented">
                    <button
                      className={metric === 'amount' ? 'active' : ''}
                      onClick={() => setFilter('metric', 'amount')}
                    >
                      ₸ Деньги
                    </button>
                    <button
                      className={metric === 'tons' ? 'active' : ''}
                      onClick={() => setFilter('metric', 'tons')}
                    >
                      Тонны
                    </button>
                  </div>
                </div>
                <label className="lfl-control">
                  <button
                    role="switch"
                    aria-checked={filters.comparable}
                    className={`switch ${filters.comparable ? 'on' : ''}`}
                    onClick={() => setFilter('comparable', !filters.comparable)}
                  >
                    <span />
                  </button>
                  <span>
                    Сопоставимая база<small>сети и дистрибьюторы</small>
                  </span>
                </label>
                <button
                  className={`button filter-button ${filterOpen ? 'selected' : ''}`}
                  onClick={() => setFilterOpen(!filterOpen)}
                >
                  <SlidersHorizontal size={15} />
                  Фильтры{activeFilters.length > 0 && <b>{activeFilters.length}</b>}
                  <ChevronDown size={14} />
                </button>
              </div>
              {filterOpen && (
                <div className="expanded-filters">
                  {(
                    [
                      ['channel', 'Канал'],
                      ['network', 'Сеть'],
                      ['group', 'Товарная группа'],
                      ['region', 'Регион'],
                      ['distributor', 'Дистрибьютор'],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key}>
                      {label}
                      <select value={filters[key]} onChange={(e) => setFilter(key, e.target.value)}>
                        <option value="">Все</option>
                        {options[key]?.map((v) => (
                          <option value={v} key={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              )}
              {activeFilters.length > 0 && (
                <div className="filter-chips">
                  {activeFilters.map((key) => (
                    <button key={key} onClick={() => setFilter(key, '')}>
                      {filters[key]}
                      <X size={12} />
                    </button>
                  ))}
                  <button
                    className="reset"
                    onClick={() =>
                      setFilters((f) => ({
                        ...f,
                        channel: '',
                        network: '',
                        group: '',
                        region: '',
                        distributor: '',
                      }))
                    }
                  >
                    Сбросить всё
                  </button>
                </div>
              )}
              <div className="filter-note">
                <div className="period-presets">
                  <button onClick={() => choosePeriod('ytd')}>YTD</button>
                  <button onClick={() => choosePeriod('month')}>Месяц</button>
                  <button onClick={() => choosePeriod('quarter')}>Квартал</button>
                </div>
                <span>
                  <span className="small-dot" />
                  {periodText}
                </span>
                <span>Сравнение с теми же месяцами 2024 и 2025</span>
                <span className="filter-records">{integer.format(selected.length)} строк</span>
              </div>
            </div>
          )}
          {error && (
            <div className="error-banner">
              <AlertTriangle size={19} />
              <div>
                <strong>Не удалось завершить действие</strong>
                <p>{error}</p>
                {tab === 'data' && (
                  <p>
                    Проверьте заголовки: месяц, клиент, торговая точка, номенклатура, сумма, количество. Для
                    нестандартного файла переименуйте колонки и загрузите повторно.
                  </p>
                )}
              </div>
              <button className="icon-button" onClick={() => setError('')}>
                <X size={16} />
              </button>
            </div>
          )}
          {loading ? (
            <div className="loading-state">
              <LoaderCircle size={35} className="spin" />
              <h3>{progress}</h3>
              <p>Подготавливаем реальные данные для анализа</p>
            </div>
          ) : !sales.length && !['data', 'settings'].includes(tab) ? (
            <Panel title="Начните с загрузки данных">
              <Empty text="Продажи ещё не загружены" />
              <button className="button primary" onClick={() => setTab('data')}>
                Открыть источники данных
              </button>
            </Panel>
          ) : (
            <div className="view-content" key={tab}>
              {views[tab]()}
            </div>
          )}
          <footer className="main-footer">
            <span>АН PRO · Аналитика продаж</span>
            <span>
              2024 — 2026 <i /> CRM-выгрузки · точность до месяца
            </span>
          </footer>
        </main>
      </div>
      {mappingError && (
        <MappingDialog
          error={mappingError}
          onClose={() => setMappingError(null)}
          onConfirm={(mapping) => {
            overridesRef.current[mappingError.fileName] = {
              ...overridesRef.current[mappingError.fileName],
              ...mapping,
            };
            setMappingError(null);
            upload(pendingFiles.current, true);
          }}
        />
      )}
      {planMappingError && (
        <div className="modal-backdrop">
          <section
            className="mapping-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="plan-mapping-title"
          >
            <h2 id="plan-mapping-title">Выберите колонку плана</h2>
            <p>{planMappingError.fileName}</p>
            <p>Заголовок «Категория А» не найден. Укажите колонку с планом в килограммах.</p>
            <label>
              Столбец плана
              <select value={planColumn} onChange={(e) => setPlanColumn(e.target.value)}>
                {planMappingError.availableColumns.map((c) => (
                  <option key={c.column} value={c.column}>
                    {c.column} · {c.header}
                  </option>
                ))}
              </select>
            </label>
            <div className="mapping-actions">
              <button onClick={() => setPlanMappingError(null)}>Отмена</button>
              <button
                disabled={!planColumn}
                onClick={() => {
                  overridesRef.current[planMappingError.fileName] = {
                    ...overridesRef.current[planMappingError.fileName],
                    planColumn,
                  };
                  setPlanMappingError(null);
                  upload(pendingFiles.current, true);
                }}
              >
                Применить и загрузить
              </button>
            </div>
          </section>
        </div>
      )}
      {toast && (
        <div className="toast">
          <CheckCircle2 size={19} />
          {toast}
          <button onClick={() => setToast('')}>
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

function Waterfall({
  rows,
  previous,
  current,
  metric,
}: {
  rows: Comparison[];
  previous: number;
  current: number;
  metric: Metric;
}) {
  let cursor = previous;
  const items = [
    { name: '2025', base: 0, value: previous, color: '#bdcbb7' },
    ...rows.map((r) => {
      const start = cursor;
      cursor += r.delta;
      return {
        name: r.name,
        base: Math.min(start, cursor),
        value: Math.abs(r.delta),
        delta: r.delta,
        color: r.delta >= 0 ? '#4e8c6b' : '#d2947e',
      };
    }),
    { name: '2026', base: 0, value: current, color: '#2c7253' },
  ];
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={items} margin={{ top: 12, right: 15, left: 0, bottom: 15 }} barCategoryGap="26%">
        <CartesianGrid vertical={false} strokeDasharray="3 5" stroke="#e7ece3" />
        <XAxis
          dataKey="name"
          tick={{ fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          interval={0}
          tickFormatter={(v: string) => (v.length > 10 ? `${v.slice(0, 9)}…` : v)}
        />
        <YAxis
          width={64}
          tickFormatter={(v) => (metric === 'amount' ? `${num(v / 1e6)} млн` : num(v))}
          tick={{ fontSize: 10 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <div className="chart-tooltip">
                <strong>{label}</strong>
                <p>{compact(payload[0].payload.delta ?? payload[0].payload.value, metric)}</p>
              </div>
            ) : null
          }
        />
        <Bar isAnimationActive={false} dataKey="base" stackId="a" fill="transparent" />
        <Bar isAnimationActive={false} dataKey="value" stackId="a" radius={[4, 4, 0, 0]}>
          {items.map((r, i) => (
            <Cell key={i} fill={r.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
function HorizontalChanges({ rows, metric }: { rows: Comparison[]; metric: Metric }) {
  if (!rows.length) return <Empty />;
  return (
    <div className="change-bars">
      {rows.map((r) => (
        <div key={r.name}>
          <div>
            <strong>{r.name}</strong>
            <span className={r.delta >= 0 ? 'text-positive' : 'text-negative'}>
              {r.delta > 0 ? '+' : ''}
              {compact(r.delta, metric)}
            </span>
          </div>
          <div className="bar-track">
            <i
              style={{
                width: `${(Math.abs(r.delta) / Math.max(...rows.map((x) => Math.abs(x.delta)))) * 100}%`,
                background: r.delta >= 0 ? '#609575' : '#d5967e',
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
function SimpleTable({ rows, limit = 20 }: { rows: Record<string, unknown>[]; limit?: number }) {
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState('');
  const keys = rows.length ? Object.keys(rows[0]) : [];
  const filtered = rows.filter((r) =>
    Object.values(r).some((v) =>
      String(v ?? '')
        .toLowerCase()
        .includes(query.toLowerCase()),
    ),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / limit));
  const selectedPage = Math.min(page, pages - 1);
  return (
    <>
      <div className="table-tools">
        <label className="table-search">
          <Search size={15} />
          <input
            placeholder="Поиск по таблице"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
          />
        </label>
        <span className="subtle">{filtered.length} строк</span>
      </div>
      <div className="table-scroll">
        <table className="data-table simple-table">
          <thead>
            <tr>
              {keys.map((k) => (
                <th key={k}>{k}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.slice(selectedPage * limit, (selectedPage + 1) * limit).map((r, i) => (
              <tr key={i}>
                {keys.map((k, j) => (
                  <td key={k} className={j === 0 ? 'name-cell' : ''}>
                    {r[k] == null ? '—' : typeof r[k] === 'number' ? num(r[k] as number) : String(r[k])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && <Empty />}
      </div>
      {pages > 1 && (
        <div className="table-footer">
          <span>
            Страница {selectedPage + 1} из {pages}
          </span>
          <div>
            <button disabled={selectedPage === 0} onClick={() => setPage(selectedPage - 1)}>
              Назад
            </button>
            <button disabled={selectedPage === pages - 1} onClick={() => setPage(selectedPage + 1)}>
              Далее
            </button>
          </div>
        </div>
      )}
    </>
  );
}
