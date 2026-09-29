import { it, expect } from 'vitest';

import { createPdfReport } from './pdfReport';
import { DEFAULT_SETTINGS } from './types';
import type { Sale, PlanRow } from './types';
import { defaultFilters } from './analytics';
it('produces a Cyrillic ten-section PDF in memory', async () => {
  const groups = ['Мука', 'Макароны КМИ', 'Макароны ДМИ', 'Жайма', 'Крупы', 'Прочее'];
  const sales: Sale[] = [];
  for (const year of [2024, 2025, 2026])
    for (let month = 1; month <= 9; month++)
      for (let network = 0; network < 24; network++)
        for (let group = 0; group < 6; group++)
          sales.push({
            year,
            month,
            day: 1,
            datePrecision: 'month',
            date: `${year}-${String(month).padStart(2, '0')}-01`,
            client: `Клиент ${network}`,
            network: `Сеть ${network}`,
            channel: network < 5 ? 'Онлайн' : network < 10 ? 'Ключевые сети' : 'Прочие клиенты',
            point: `Магазин ${network}`,
            sku: `Товар ${group} упакованный высшего сорта`,
            group: groups[group],
            region: 'Алматы',
            distributor: 'Филиал Алматы',
            amount: (year === 2026 ? 900 : 1000) * (network + 1) * (group + 1),
            tons: (year === 2026 ? 1.5 : 2) * (group + 1),
          });
  const plans: PlanRow[] = [8, 9].flatMap((month) =>
    groups.map((group) => ({
      label: `${group} / Алматы`,
      month,
      year: 2026,
      group,
      region: 'Алматы',
      amount: null,
      tons: 200,
      source: 'Synthetic.xlsx',
      comparable: true,
    })),
  );
  const output = await createPdfReport({
    sales,
    allSales: sales,
    plans,
    filters: defaultFilters(sales),
    settings: DEFAULT_SETTINGS,
  });
  expect(new TextDecoder().decode(output.slice(0, 5))).toBe('%PDF-');

  expect(new TextDecoder().decode(output).match(/\/Type \/Page\b/g)?.length).toBe(10);
}, 30000);
