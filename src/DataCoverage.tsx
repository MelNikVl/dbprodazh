import { useMemo, useState } from 'react';
import type { Filters, Sale } from './types';
import { coverage } from './analytics';
import { exportTable } from './exporter';

export default function DataCoverage({ sales, filters }: { sales: Sale[]; filters: Filters }) {
  const [dimension, setDimension] = useState<'network' | 'distributor' | 'region'>('network');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const rows = useMemo(() => coverage(sales, dimension, filters), [sales, dimension, filters]);
  const filtered = rows.filter((r) => r.name.toLowerCase().includes(query.toLowerCase()));
  const pages = Math.max(1, Math.ceil(filtered.length / 15)),
    safePage = Math.min(page, pages - 1);
  const months = rows[0]?.months || [];
  const number = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const label = (status: string) =>
    status === 'new' ? 'Новая в периоде' : status === 'lost' ? 'Нет в 2026' : 'В обоих годах';
  const exported = filtered.map((r) => ({
    Наименование: r.name,
    'Первая отгрузка': r.firstDate.slice(0, 7),
    'Последняя отгрузка': r.lastDate.slice(0, 7),
    Статус: label(r.status),
    'Изменение, ₸': r.delta,
    ...Object.fromEntries(r.months.map((m) => [m.label, m.hasData ? 'Есть данные' : 'Нет данных'])),
  }));
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h3>Полнота данных и изменения базы</h3>
          <p>Отсутствие строк может означать отсутствие продаж или неполную выгрузку.</p>
        </div>
        <select
          aria-label="Сущность для проверки данных"
          value={dimension}
          onChange={(e) => {
            setDimension(e.target.value as typeof dimension);
            setPage(0);
          }}
        >
          <option value="network">Сети</option>
          <option value="distributor">Дистрибьюторы / филиалы</option>
          <option value="region">Регионы</option>
        </select>
      </div>
      <div className="table-tools">
        <input
          aria-label="Поиск в полноте данных"
          placeholder="Найти наименование"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
        />
        <button
          className="text-button"
          disabled={!exported.length}
          onClick={() => exportTable('Полнота данных', exported)}
        >
          Экспорт в Excel
        </button>
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Наименование</th>
              <th>Первая / последняя отгрузка</th>
              <th>Изменение базы</th>
              <th>Вклад, млн ₸</th>
              {months.map((m) => (
                <th key={m.key}>{m.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.slice(safePage * 15, (safePage + 1) * 15).map((r) => (
              <tr key={r.name}>
                <td className="name-cell">{r.name}</td>
                <td>
                  {r.firstDate.slice(0, 7) || '—'} / {r.lastDate.slice(0, 7) || '—'}
                </td>
                <td>{label(r.status)}</td>
                <td className={r.delta < 0 ? 'text-negative' : 'text-positive'}>
                  {number.format(r.delta / 1e6)}
                </td>
                {r.months.map((m) => (
                  <td
                    key={m.key}
                    title={`${r.name} · ${m.label}: ${m.hasData ? 'есть строки' : 'нет данных'}`}
                    style={{
                      textAlign: 'center',
                      background: m.hasData ? '#eef5e9' : '#fff0df',
                      color: m.hasData ? '#286543' : '#a36721',
                    }}
                  >
                    {m.hasData ? '●' : '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!filtered.length && <div className="empty-inline">Нет подходящих строк</div>}
      <div className="table-footer">
        <span>{filtered.length} наименований · ● есть строки · — нет данных</span>
        <div>
          <button disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
            Назад
          </button>
          <span>
            {safePage + 1} / {pages}
          </span>
          <button disabled={safePage === pages - 1} onClick={() => setPage(safePage + 1)}>
            Далее
          </button>
        </div>
      </div>
      <p className="chart-note">
        Статус определяется по активности в одинаковых периодах 2025 и 2026. Первая и последняя отгрузки — за
        все загруженные месяцы. Полнота проверяется до исключения несопоставимых сетей.
      </p>
    </section>
  );
}
