import { parseBuffer, ImportMappingError, PlanColumnMappingError } from './importer';
self.onmessage = (event: MessageEvent) => {
  try {
    const { buffer, name, overrides } = event.data;
    self.postMessage({ result: parseBuffer(buffer, name, overrides) });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
      mapping:
        error instanceof ImportMappingError
          ? {
              headers: error.headers,
              missing: error.missing,
              sheetNames: error.sheetNames,
              sheets: error.sheets,
              selectedSheet: error.selectedSheet,
            }
          : undefined,
      planMapping:
        error instanceof PlanColumnMappingError
          ? { availableColumns: error.availableColumns, headerRow: error.headerRow }
          : undefined,
    });
  }
};
