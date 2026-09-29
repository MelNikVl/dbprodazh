import * as XLSX from 'xlsx';

export function tableWorkbook(name: string, rows: Record<string, unknown>[]): Uint8Array {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows);
  const headers = Object.keys(rows[0] || {});
  sheet['!cols'] = headers.map((_, index) => ({ wch: index === 0 ? 45 : 22 }));
  if (sheet['!ref']) {
    const range = XLSX.utils.decode_range(sheet['!ref']);
    sheet['!autofilter'] = { ref: sheet['!ref'] };
    for (let row = 1; row <= range.e.r; row++) {
      for (let column = 0; column <= range.e.c; column++) {
        const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
        if (cell?.t !== 'n') continue;
        // Percentages in the analytical tables already use a 0–100 scale.
        cell.z = /%/.test(headers[column] || '')
          ? '0.0"%"'
          : /п\.п\./.test(headers[column] || '')
            ? '0.0" п.п."'
            : '#,##0.###';
      }
    }
  }
  const sheetName =
    name
      .replace(/[\\/?*\[\]:]/g, ' ')
      .replace(/^'+|'+$/g, '')
      .trim()
      .slice(0, 31) || 'Данные';
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  return new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx', compression: true }));
}

export function exportTable(name: string, rows: Record<string, unknown>[]): void {
  if (!rows.length) return;
  const bytes = tableWorkbook(name, rows);
  downloadFile(`${name}.xlsx`, bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

/** Keep an actual download link available when automatic downloads are suppressed. */
export function downloadFile(name: string, bytes: Uint8Array, type: string): void {
  const blob = new Blob([bytes.slice().buffer], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').trim() || 'Отчёт';
  anchor.textContent = `Скачать ${anchor.download}`;
  const notice = document.createElement('div');
  notice.className = 'download-notice';
  notice.setAttribute('role', 'status');
  const label = document.createElement('span');
  label.textContent = 'Отчёт готов. Если скачивание не началось, нажмите ссылку.';
  const close = document.createElement('button');
  close.textContent = 'Закрыть';
  close.onclick = () => {
    notice.remove();
    URL.revokeObjectURL(url);
  };
  notice.append(label, anchor, close);
  document.body.appendChild(notice);
  anchor.click();
}
