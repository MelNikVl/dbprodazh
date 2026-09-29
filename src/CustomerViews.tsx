import { useMemo, useState, type ReactNode } from 'react';
import { Check, ChevronLeft, ChevronRight, Download, Search } from 'lucide-react';
import type { Sale } from './types';
import { YEARS } from './types';
import { growth } from './analytics';
import { exportTable } from './exporter';

const COUNT = new Intl.NumberFormat('ru-RU');
const PERCENT = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const PAGE_SIZE = 15;
const active = (row: Sale) => row.amount > 0 || row.tons > 0;
const fold = (text: string) => text.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru');
const validSku = (sku: string) =>
  !!sku.trim() && !/^(номенклатура не указана|sku не указан|не указано|не распределено)$/i.test(sku.trim());
const pointId = (row: Sale) => `${fold(row.region)}\u0000${fold(row.point || row.client)}`;
const sets = () => ({ 2024: new Set<string>(), 2025: new Set<string>(), 2026: new Set<string>() });
type YearSets = ReturnType<typeof sets>;
type CountRow = { name: string; counts: Record<2024 | 2025 | 2026, number> };
type ChangeRow = { id: string; name: string; region: string; network: string; status: 'Новый' | 'Выпал' };

function Panel({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h3>{title}</h3>
          {sub && <p>{sub}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}
function Change({ base, current, threshold }: { base: number; current: number; threshold: number }) {
  const value = growth(base, current);
  return (
    <span
      className={`change-pill ${value == null || Math.abs(value) <= threshold ? 'neutral' : value > 0 ? 'up' : 'down'}`}
    >
      {value == null
        ? current > 0
          ? 'Новый'
          : 'Нет базы'
        : `${value > 0 ? '+' : ''}${PERCENT.format(value)}%`}
    </span>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="empty-inline">
      <p>{text}</p>
      <small>Измените фильтры или выбранный период.</small>
    </div>
  );
}
function Pager({ page, total, onPage }: { page: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <div className="table-footer">
      <span>
        {total
          ? `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)} из ${COUNT.format(total)}`
          : 'Нет строк'}
      </span>
      {pages > 1 && (
        <div>
          <button aria-label="Предыдущая страница" disabled={!page} onClick={() => onPage(page - 1)}>
            <ChevronLeft size={14} />
          </button>
          <span>
            {page + 1} / {pages}
          </span>
          <button
            aria-label="Следующая страница"
            disabled={page + 1 >= pages}
            onClick={() => onPage(page + 1)}
          >
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
function Export({ name, rows }: { name: string; rows: Record<string, unknown>[] }) {
  return (
    <button
      className="icon-button"
      title="Экспорт всех найденных строк в Excel"
      aria-label="Экспорт таблицы в Excel"
      disabled={!rows.length}
      onClick={() => exportTable(name, rows)}
    >
      <Download size={16} />
    </button>
  );
}
function CountTable({
  rows,
  title,
  onSelect,
  threshold,
}: {
  rows: CountRow[];
  title: string;
  onSelect?: (name: string) => void;
  threshold: number;
}) {
  const [query, setQuery] = useState(''),
    [page, setPage] = useState(0);
  const selected = useMemo(
    () =>
      rows
        .filter((r) => fold(r.name).includes(fold(query)))
        .sort((a, b) => b.counts[2026] - a.counts[2026] || a.name.localeCompare(b.name, 'ru')),
    [rows, query],
  );
  const safePage = Math.min(page, Math.max(0, Math.ceil(selected.length / PAGE_SIZE) - 1));
  const exported = selected.map((r) => ({
    Сеть: r.name,
    '2024': r.counts[2024],
    '2025': r.counts[2025],
    '2026': r.counts[2026],
    'Прирост 2025 к 2024, %': growth(r.counts[2024], r.counts[2025]),
    'Прирост 2026 к 2025, %': growth(r.counts[2025], r.counts[2026]),
  }));
  return (
    <>
      <div className="table-tools">
        <label className="table-search">
          <Search size={15} />
          <input
            aria-label={`Поиск: ${title}`}
            placeholder="Найти сеть"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
          />
        </label>
        <Export name={title} rows={exported} />
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Сеть</th>
              {YEARS.map((y) => (
                <th key={y}>{y}</th>
              ))}
              <th>2025 к 2024</th>
              <th>2026 к 2025</th>
              {onSelect && <th />}
            </tr>
          </thead>
          <tbody>
            {selected.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE).map((r) => (
              <tr key={r.name} className={onSelect ? 'clickable' : ''} onClick={() => onSelect?.(r.name)}>
                <td className="name-cell">
                  {onSelect ? (
                    <button
                      className="text-button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(r.name);
                      }}
                    >
                      {r.name}
                    </button>
                  ) : (
                    r.name
                  )}
                </td>
                {YEARS.map((y) => (
                  <td key={y}>{COUNT.format(r.counts[y])}</td>
                ))}
                <td>
                  <Change base={r.counts[2024]} current={r.counts[2025]} threshold={threshold} />
                </td>
                <td>
                  <Change base={r.counts[2025]} current={r.counts[2026]} threshold={threshold} />
                </td>
                {onSelect && (
                  <td>
                    <ChevronRight size={15} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {!selected.length && <Empty text="Нет активных сетей по выбранным условиям" />}
      </div>
      <Pager page={safePage} total={selected.length} onPage={setPage} />
    </>
  );
}

export function ActiveBaseView({ rows, threshold = 1 }: { rows: Sale[]; threshold?: number }) {
  const [entity, setEntity] = useState<'points' | 'networks'>('points'),
    [status, setStatus] = useState<'all' | 'Новый' | 'Выпал'>('all'),
    [query, setQuery] = useState(''),
    [page, setPage] = useState(0);
  const data = useMemo(() => {
    const points = sets(),
      networks = sets(),
      byNetwork = new Map<string, YearSets>();
    const detail = new Map<string, { name: string; region: string; networks: Set<string> }>();
    for (const r of rows) {
      if (!active(r) || !YEARS.includes(r.year as (typeof YEARS)[number])) continue;
      const year = r.year as (typeof YEARS)[number],
        network = r.network || 'Не распределено';
      // Missing outlet names are not invented outlets; network presence can still be known.
      if (network !== 'Не распределено') networks[year].add(network);
      if ((!r.point && !r.client) || /клиент не указан/i.test(r.point || r.client)) continue;
      const id = pointId(r);
      points[year].add(id);
      if (!byNetwork.has(network)) byNetwork.set(network, sets());
      byNetwork.get(network)![year].add(id);
      if (!detail.has(id))
        detail.set(id, { name: r.point || r.client, region: r.region, networks: new Set() });
      detail.get(id)!.networks.add(network);
    }
    const pointChanges: ChangeRow[] = [],
      networkChanges: ChangeRow[] = [];
    for (const id of new Set([...points[2025], ...points[2026]])) {
      const previous = points[2025].has(id),
        current = points[2026].has(id);
      if (previous === current) continue;
      const info = detail.get(id)!;
      pointChanges.push({
        id,
        name: info.name,
        region: info.region,
        network: [...info.networks].sort().join(', '),
        status: current ? 'Новый' : 'Выпал',
      });
    }
    for (const network of new Set([...networks[2025], ...networks[2026]])) {
      const previous = networks[2025].has(network),
        current = networks[2026].has(network);
      if (previous !== current)
        networkChanges.push({
          id: network,
          name: network,
          region: '—',
          network,
          status: current ? 'Новый' : 'Выпал',
        });
    }
    return {
      points,
      pointChanges,
      networkChanges,
      networkRows: [...byNetwork].map(([name, values]) => ({
        name,
        counts: { 2024: values[2024].size, 2025: values[2025].size, 2026: values[2026].size },
      })),
    };
  }, [rows]);
  const changes = entity === 'points' ? data.pointChanges : data.networkChanges;
  const selected = useMemo(
    () =>
      changes
        .filter(
          (r) =>
            (status === 'all' || r.status === status) &&
            fold(`${r.name} ${r.region} ${r.network}`).includes(fold(query)),
        )
        .sort((a, b) => a.status.localeCompare(b.status, 'ru') || a.name.localeCompare(b.name, 'ru')),
    [changes, status, query],
  );
  const safePage = Math.min(page, Math.max(0, Math.ceil(selected.length / PAGE_SIZE) - 1));
  const exported = selected.map((r) => ({
    Наименование: r.name,
    Город: r.region,
    Сеть: r.network,
    'Статус 2026 к 2025': r.status,
  }));
  return (
    <>
      <div className="mini-kpis four">
        {YEARS.map((year) => (
          <div key={year}>
            <span>Активные точки · {year}</span>
            <strong>{COUNT.format(data.points[year].size)}</strong>
          </div>
        ))}
        <div>
          <span>Прирост АКБ · 2026 к 2025</span>
          <strong>
            {growth(data.points[2025].size, data.points[2026].size) == null
              ? 'Нет базы'
              : `${PERCENT.format(growth(data.points[2025].size, data.points[2026].size)!)}%`}
          </strong>
        </div>
      </div>
      <Panel
        title="Активные торговые точки по сетям"
        sub="Точка активна, если есть строка с положительной суммой или тоннажем. Возвраты сами по себе не создают активность."
      >
        <CountTable rows={data.networkRows} title="АКБ по сетям" threshold={threshold} />
        <p className="chart-note">
          Идентификатор точки — город и название клиента из CRM. Отдельного кода точки в источнике нет. Одна
          точка может быть связана с несколькими сетями, поэтому сумма строк сетей может превышать общий итог.
        </p>
      </Panel>
      <Panel
        title="Новые и выпавшие из базы"
        sub="Сравнение активности в выбранных одинаковых периодах 2025 и 2026. Статус отражает наличие отгрузок, а не подтверждённое закрытие клиента."
      >
        <div className="table-tools">
          <label className="table-search">
            <Search size={15} />
            <input
              placeholder="Точка, сеть или город"
              aria-label="Поиск изменений клиентской базы"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
            />
          </label>
          <div className="table-tools-right">
            <select
              aria-label="Сущность клиентской базы"
              value={entity}
              onChange={(e) => {
                setEntity(e.target.value as typeof entity);
                setPage(0);
              }}
            >
              <option value="points">Торговые точки</option>
              <option value="networks">Сети</option>
            </select>
            <select
              aria-label="Статус активности"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as typeof status);
                setPage(0);
              }}
            >
              <option value="all">Все изменения</option>
              <option value="Новый">Новые ({changes.filter((r) => r.status === 'Новый').length})</option>
              <option value="Выпал">Выпавшие ({changes.filter((r) => r.status === 'Выпал').length})</option>
            </select>
            <Export
              name={entity === 'points' ? 'Новые и выпавшие точки' : 'Новые и выпавшие сети'}
              rows={exported}
            />
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>{entity === 'points' ? 'Торговая точка' : 'Сеть'}</th>
                {entity === 'points' && (
                  <>
                    <th>Город</th>
                    <th>Сеть</th>
                  </>
                )}
                <th>Статус к 2025</th>
              </tr>
            </thead>
            <tbody>
              {selected.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE).map((r) => (
                <tr key={r.id}>
                  <td className="name-cell">{r.name}</td>
                  {entity === 'points' && (
                    <>
                      <td>{r.region}</td>
                      <td>{r.network}</td>
                    </>
                  )}
                  <td>
                    <span className={`change-pill ${r.status === 'Новый' ? 'up' : 'down'}`}>{r.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!selected.length && (
            <Empty
              text={
                changes.length
                  ? 'Нет совпадений по поиску'
                  : 'Новых и выпавших сущностей в выбранном периоде нет'
              }
            />
          )}
        </div>
        <Pager page={safePage} total={selected.length} onPage={setPage} />
      </Panel>
    </>
  );
}

export function SkuMatrixView({ rows, threshold = 1 }: { rows: Sale[]; threshold?: number }) {
  const [network, setNetwork] = useState(''),
    [query, setQuery] = useState(''),
    [status, setStatus] = useState(''),
    [page, setPage] = useState(0);
  const data = useMemo(() => {
    const networks = new Map<string, YearSets>();
    for (const row of rows) {
      if (!active(row) || !validSku(row.sku) || !YEARS.includes(row.year as (typeof YEARS)[number])) continue;
      const name = row.network || 'Не распределено';
      if (!networks.has(name)) networks.set(name, sets());
      networks.get(name)![row.year as (typeof YEARS)[number]].add(row.sku);
    }
    return {
      networks,
      counts: [...networks].map(([name, value]) => ({
        name,
        counts: { 2024: value[2024].size, 2025: value[2025].size, 2026: value[2026].size },
      })),
    };
  }, [rows]);
  const selectedNetwork = network && data.networks.has(network) ? network : '';
  const detail = useMemo(() => {
    const values = selectedNetwork ? data.networks.get(selectedNetwork) : undefined;
    if (!values) return [];
    return [...new Set([...values[2024], ...values[2025], ...values[2026]])]
      .map((sku) => {
        const y2024 = values[2024].has(sku),
          y2025 = values[2025].has(sku),
          y2026 = values[2026].has(sku);
        return {
          sku,
          y2024,
          y2025,
          y2026,
          status: y2026 ? (y2025 ? 'Продаётся' : 'Новый') : y2025 ? 'Выпал' : 'Только 2024',
        };
      })
      .sort((a, b) => a.sku.localeCompare(b.sku, 'ru'));
  }, [data, selectedNetwork]);
  const selected = detail.filter(
    (r) => fold(r.sku).includes(fold(query)) && (!status || r.status === status),
  );
  const safePage = Math.min(page, Math.max(0, Math.ceil(selected.length / PAGE_SIZE) - 1));
  const exported = selected.map((r) => ({
    Сеть: selectedNetwork,
    SKU: r.sku,
    '2024': r.y2024 ? 'Да' : 'Нет',
    '2025': r.y2025 ? 'Да' : 'Нет',
    '2026': r.y2026 ? 'Да' : 'Нет',
    Статус: r.status,
  }));
  const openNetwork = (name: string) => {
    setNetwork(name);
    setQuery('');
    setStatus('');
    setPage(0);
  };
  return (
    <>
      <Panel
        title="Количество активных SKU по сетям"
        sub="Уникальные товары с положительной суммой или тоннажем. Нажмите на сеть, чтобы увидеть состав ассортимента."
      >
        <CountTable
          rows={data.counts}
          title="SKU-матрица по сетям"
          onSelect={openNetwork}
          threshold={threshold}
        />
        <p className="chart-note">
          Отсутствующая номенклатура не считается отдельным SKU. Новые и выпавшие товары определяются
          относительно выбранного периода 2025 года.
        </p>
      </Panel>
      {selectedNetwork ? (
        <Panel
          title={`Ассортимент · ${selectedNetwork}`}
          sub={`Всего уникальных SKU за три года: ${COUNT.format(detail.length)}. Новый — есть в 2026 и нет в 2025; выпал — есть в 2025 и нет в 2026.`}
        >
          <div className="table-tools">
            <label className="table-search">
              <Search size={15} />
              <input
                value={query}
                aria-label="Поиск SKU в сети"
                placeholder="Найти SKU"
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(0);
                }}
              />
            </label>
            <div className="table-tools-right">
              <select
                aria-label="Статус SKU"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(0);
                }}
              >
                <option value="">Все статусы</option>
                {['Новый', 'Выпал', 'Продаётся', 'Только 2024'].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
              <Export name={`SKU ${selectedNetwork}`} rows={exported} />
              <button className="text-button" onClick={() => setNetwork('')}>
                Закрыть
              </button>
            </div>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Номенклатура</th>
                  {YEARS.map((y) => (
                    <th key={y}>{y}</th>
                  ))}
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {selected.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE).map((r) => (
                  <tr key={r.sku}>
                    <td className="name-cell">{r.sku}</td>
                    {([r.y2024, r.y2025, r.y2026] as boolean[]).map((present, i) => (
                      <td key={i} aria-label={present ? 'Есть продажи' : 'Нет продаж'}>
                        {present ? (
                          <Check size={16} className="text-positive" />
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    ))}
                    <td>
                      <span
                        className={`change-pill ${r.status === 'Новый' ? 'up' : r.status === 'Выпал' ? 'down' : 'neutral'}`}
                      >
                        {r.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!selected.length && <Empty text="SKU с выбранным статусом не найдены" />}
          </div>
          <Pager page={safePage} total={selected.length} onPage={setPage} />
        </Panel>
      ) : (
        <Panel title="Состав ассортимента">
          <Empty
            text={
              data.counts.length
                ? 'Выберите сеть в таблице, чтобы увидеть SKU и их статусы'
                : 'Нет активных SKU в выбранных данных'
            }
          />
        </Panel>
      )}
    </>
  );
}
