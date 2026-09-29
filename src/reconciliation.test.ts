import { afterEach, beforeEach, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { setTimeout as yieldToWorker } from 'node:timers/promises';
import { parseBuffer } from './importer';

function parseSource(name: string) {
  const buffer = readFileSync(`${process.env.CRM_SAMPLE_DIR || 'J:/АН PRO'}/${name}`);
  return parseBuffer(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
    name,
  );
}

// Opt-in: controls and source workbooks stay private. Each workbook has its own timeout.
if (process.env.CRM_RECONCILE === '1') {
  // Parsing is synchronous; let Vitest deliver each result before starting another large workbook.
  beforeEach(() => yieldToWorker(10));
  afterEach(() => yieldToWorker(10));
  const controls = JSON.parse(
    readFileSync(process.env.CRM_CONTROLS_FILE || '.local/reconciliation-controls.json', 'utf8'),
  ) as {
    sales: [string, number, number, number][];
    plans: [string, number][];
  };
  if (!controls.sales?.length || !controls.plans?.length)
    throw new Error('Private controls must include sales and plan workbooks');

  it.each(controls.sales)(
    'reconciles sales workbook %s against independent controls',
    (name, count, amount, tons) => {
      const data = parseSource(name);
      // Boolean assertions keep private business figures out of failure logs as well.
      expect(data.sales.length === count, 'Sales row count matches').toBe(true);
      expect(Math.abs(data.sources[0].amount! - amount) < 0.1, 'Revenue matches').toBe(true);
      expect(Math.abs(data.sources[0].tons! - tons) < 0.00001, 'Sales volume matches').toBe(true);
    },
    120000,
  );

  it.each(controls.plans)(
    'reconciles plan workbook %s against independent controls',
    (name, tons) => {
      const data = parseSource(name);
      const plannedTons = data.plans.reduce((sum, plan) => sum + (plan.tons || 0), 0);
      expect(Math.abs(plannedTons - tons) < 0.00001, 'Plan volume matches').toBe(true);
      expect(
        data.plans.every((plan) => plan.amount === null),
        'No invented revenue plan',
      ).toBe(true);
    },
    120000,
  );
} else {
  it.skip('real CRM reconciliation requires CRM_RECONCILE=1 and private controls', () => {});
}
