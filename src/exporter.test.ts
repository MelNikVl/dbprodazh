import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { tableWorkbook } from './exporter';

describe('downloadable Excel reports', () => {
  it('round-trips raw monetary values, volumes, percentage points and missing bases', () => {
    const bytes = tableWorkbook('Продажи / 2024:2026', [
      { Клиент: '=ACME', '2026, ₸': 1234567.89, '2026, т': 1.2345, 'Рост, %': -12.5, 'Доля, п.п.': 2.5 },
      { Клиент: 'Новый', '2026, ₸': 100, '2026, т': 0.001, 'Рост, %': null, 'Доля, п.п.': 0 },
    ]);
    expect(bytes).toBeInstanceOf(Uint8Array);
    const book = XLSX.read(bytes, { type: 'array', cellNF: true });
    const sheet = book.Sheets[book.SheetNames[0]];
    expect(book.SheetNames[0]).not.toMatch(/[\\/?*\[\]:]/);
    expect(sheet.A2).toMatchObject({ t: 's', v: '=ACME' });
    expect(sheet.A2.f).toBeUndefined();
    expect(sheet.B2.v).toBe(1234567.89);
    expect(sheet.C2.v).toBe(1.2345);
    expect(sheet.D2).toMatchObject({ t: 'n', v: -12.5, z: '0.0"%"' });
    expect(sheet.D2.w).toBe('-12.5%');
    expect(sheet.E2.w).toBe('2.5 п.п.');
    expect(sheet.D3?.v).toBeUndefined();
    expect(sheet['!autofilter']?.ref).toBe('A1:E3');
  });

  it('creates a valid workbook even when the supplied sheet title is empty', () => {
    const book = XLSX.read(tableWorkbook('[]:*?', []), { type: 'array' });
    expect(book.SheetNames).toEqual(['Данные']);
  });
});
