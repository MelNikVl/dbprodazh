import { useState } from 'react';
import { FIELD_LABELS, type ImportOverrides, type ImportMappingError } from './importer';
export default function MappingDialog({
  error,
  onConfirm,
  onClose,
}: {
  error: ImportMappingError;
  onConfirm: (mapping: ImportOverrides) => void;
  onClose: () => void;
}) {
  const initialSheet =
    error.selectedSheet || error.sheetNames.find((x) => x === 'Лист1') || error.sheetNames[0];
  const [columns, setColumns] = useState<Record<string, string>>(error.sheets[initialSheet]?.detected || {});
  const [sheet, setSheet] = useState(initialSheet);
  const headers = error.sheets[sheet]?.headers || error.headers;
  const valid =
    ['amount', 'weight', 'sku', 'client'].every((field) => columns[field]) &&
    !!(columns.date || (columns.year && columns.month));
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="mapping-dialog" role="dialog" aria-modal="true" aria-labelledby="mapping-title">
        <h2 id="mapping-title">Сопоставление колонок</h2>
        <p>{error.fileName}</p>
        <p>
          Проверьте поля выбранного листа. Для периода укажите дату либо год и месяц. Сумма, вес, номенклатура
          и клиент обязательны.
        </p>
        <label>
          Лист
          <select
            value={sheet}
            onChange={(e) => {
              setSheet(e.target.value);
              setColumns(error.sheets[e.target.value]?.detected || {});
            }}
          >
            {error.sheetNames.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        {Object.keys(FIELD_LABELS).map((field) => (
          <label key={field}>
            {FIELD_LABELS[field] || field}
            <select
              value={columns[field] || ''}
              onChange={(e) => setColumns({ ...columns, [field]: e.target.value })}
            >
              <option value="">Не выбрано</option>
              {headers.filter(Boolean).map((header, i) => (
                <option key={i}>{header}</option>
              ))}
            </select>
          </label>
        ))}
        <div className="mapping-actions">
          <button onClick={onClose}>Отмена</button>
          <button disabled={!valid} onClick={() => onConfirm({ columns, sheet })}>
            Применить и загрузить
          </button>
        </div>
      </section>
    </div>
  );
}
