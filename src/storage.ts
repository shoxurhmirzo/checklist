import { COLUMN_COUNT, createSheet, generateColumnLabelsForMonth } from './defaults';
import type { BackupPayload, ChecklistSheet, CheckState } from './types';

const DB_NAME = 'online-checklist-db';
const STORE_NAME = 'app-state';
const STORE_KEY = 'sheets';
const BACKUP_VERSION = 1;

const hasUsefulColumnLabels = (labels: string[]) =>
  labels.length === COLUMN_COUNT && labels.some((label) => label.trim().length > 0);

const normalizeCheck = (value: unknown): CheckState | null => {
  if (value === true) {
    return { mark: 'plus' };
  }

  if (value === 'undone') {
    return { mark: 'minus' };
  }

  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const check = value as Partial<CheckState>;

  if (check.mark !== 'plus' && check.mark !== 'minus') {
    return null;
  }

  return typeof check.loggedAt === 'string' && check.loggedAt.trim().length > 0
    ? { mark: check.mark, loggedAt: check.loggedAt }
    : { mark: check.mark };
};

const normalizeChecks = (checks: unknown): ChecklistSheet['sections'][number]['rows'][number]['checksByColumn'] => {
  if (typeof checks !== 'object' || checks === null) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(checks)
      .map(([columnIndex, value]) => [columnIndex, normalizeCheck(value)] as const)
      .filter((entry): entry is readonly [string, CheckState] => entry[1] !== null),
  );
};

export const normalizeSheets = (sheets: ChecklistSheet[]): ChecklistSheet[] =>
  sheets.map((sheet) => ({
    ...sheet,
    selectedYear:
      typeof sheet.selectedYear === 'number' && Number.isInteger(sheet.selectedYear)
        ? sheet.selectedYear
        : new Date(sheet.createdAt || Date.now()).getFullYear(),
    selectedMonth:
      typeof sheet.selectedMonth === 'number' &&
      Number.isInteger(sheet.selectedMonth) &&
      sheet.selectedMonth >= 0 &&
      sheet.selectedMonth < 12
        ? sheet.selectedMonth
        : new Date(sheet.createdAt || Date.now()).getMonth(),
    columnLabels:
      Array.isArray(sheet.columnLabels) && hasUsefulColumnLabels(sheet.columnLabels)
        ? sheet.columnLabels
        : generateColumnLabelsForMonth(
            typeof sheet.selectedYear === 'number' && Number.isInteger(sheet.selectedYear)
              ? sheet.selectedYear
              : new Date(sheet.createdAt || Date.now()).getFullYear(),
            typeof sheet.selectedMonth === 'number' &&
              Number.isInteger(sheet.selectedMonth) &&
              sheet.selectedMonth >= 0 &&
              sheet.selectedMonth < 12
              ? sheet.selectedMonth
              : new Date(sheet.createdAt || Date.now()).getMonth(),
          ),
    sections: sheet.sections.map((section) => {
      const rows = section.rows.map((row) => ({
        ...row,
        checksByColumn: normalizeChecks(row.checksByColumn),
      }));

      if (section.id === 'indikatorlar') {
        return {
          ...section,
          rows,
          title: 'Indikatorlar',
        };
      }

      return {
        ...section,
        id: 'amaliyotlar',
        rows,
        title: 'Amaliyotlar',
      };
    }),
  }));

const openDatabase = async (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open database'));
  });

const withStore = async <T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore, resolve: (value: T) => void, reject: (error?: unknown) => void) => void,
): Promise<T> => {
  const database = await openDatabase();

  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);

    transaction.oncomplete = () => database.close();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));

    run(store, resolve, reject);
  });
};

export const loadSheets = async (): Promise<ChecklistSheet[]> =>
  withStore<ChecklistSheet[]>('readonly', (store, resolve, reject) => {
    const request = store.get(STORE_KEY);

    request.onsuccess = () => {
      const result = request.result as ChecklistSheet[] | undefined;
      resolve(
        Array.isArray(result) && result.length > 0
          ? normalizeSheets(result)
          : [createSheet('Checklist 1')],
      );
    };

    request.onerror = () => reject(request.error ?? new Error('Failed to load data'));
  });

export const saveSheets = async (sheets: ChecklistSheet[]): Promise<void> =>
  withStore<void>('readwrite', (store, resolve, reject) => {
    const request = store.put(sheets, STORE_KEY);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('Failed to save data'));
  });

export const createBackupPayload = (sheets: ChecklistSheet[]): BackupPayload => ({
  version: BACKUP_VERSION,
  exportedAt: new Date().toISOString(),
  sheets,
});

const isValidLoggedCheckState = (value: unknown): value is CheckState => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const check = value as Partial<CheckState>;

  return (
    (check.mark === 'plus' || check.mark === 'minus') &&
    (check.loggedAt === undefined || typeof check.loggedAt === 'string')
  );
};

const isValidCheckState = (value: unknown): value is CheckState | true | 'undone' | false =>
  value === true || value === false || value === 'undone' || isValidLoggedCheckState(value);

const isValidChecks = (checks: unknown): checks is Record<number, CheckState | true | 'undone' | false> =>
  typeof checks === 'object' &&
  checks !== null &&
  Object.values(checks).every(isValidCheckState);

export const isValidBackupPayload = (value: unknown): value is BackupPayload => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const payload = value as Partial<BackupPayload>;

  return (
    payload.version === BACKUP_VERSION &&
    typeof payload.exportedAt === 'string' &&
    Array.isArray(payload.sheets) &&
    payload.sheets.every(
      (sheet) =>
        typeof sheet.id === 'string' &&
        typeof sheet.name === 'string' &&
        typeof sheet.createdAt === 'string' &&
        typeof sheet.updatedAt === 'string' &&
        (sheet.selectedYear === undefined || typeof sheet.selectedYear === 'number') &&
        (sheet.selectedMonth === undefined || typeof sheet.selectedMonth === 'number') &&
        Array.isArray(sheet.columnLabels) &&
        sheet.columnLabels.every((label) => typeof label === 'string') &&
        Array.isArray(sheet.sections) &&
        sheet.sections.every(
          (section) =>
            (section.id === 'indikatorlar' || section.id === 'amaliyotlar') &&
            typeof section.title === 'string' &&
            Array.isArray(section.rows) &&
            section.rows.every(
              (row) =>
                typeof row.id === 'string' &&
                typeof row.label === 'string' &&
                typeof row.order === 'number' &&
                isValidChecks(row.checksByColumn),
            ),
        ),
    )
  );
};
