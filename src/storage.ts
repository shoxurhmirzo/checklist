import { COLUMN_COUNT, createSheet, generateColumnLabelsForMonth } from './defaults';
import type {
  AppState,
  BackupPayload,
  ChecklistSheet,
  CheckState,
  DivideAndConquerBucket,
  DivideAndConquerTask,
} from './types';

const DB_NAME = 'online-checklist-db';
const STORE_NAME = 'app-state';
const LEGACY_SHEETS_STORE_KEY = 'sheets';
const APP_STATE_STORE_KEY = 'state';
const BACKUP_VERSION = 4;

export const DEFAULT_DIVIDE_AND_CONQUER_TEXT = '1.        ';
export const DEFAULT_DIVIDE_AND_CONQUER_ITEMS: DivideAndConquerTask[] = [];

const DIVIDE_AND_CONQUER_BUCKETS: DivideAndConquerBucket[] = [
  'unassigned',
  'productive-attractive',
  'productive-unattractive',
  'unproductive-attractive',
  'unproductive-unattractive',
  'completed',
];

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

const normalizeSavedSheets = (sheets: ChecklistSheet[]): ChecklistSheet[] =>
  sheets.length > 0 ? normalizeSheets(sheets) : [createSheet('Checklist 1')];

const normalizeDivideAndConquerText = (value: unknown) =>
  typeof value === 'string' ? value : DEFAULT_DIVIDE_AND_CONQUER_TEXT;

const isValidDivideAndConquerBucket = (value: unknown): value is DivideAndConquerBucket =>
  typeof value === 'string' && DIVIDE_AND_CONQUER_BUCKETS.includes(value as DivideAndConquerBucket);

const normalizeDivideAndConquerItems = (value: unknown): DivideAndConquerTask[] => {
  if (!Array.isArray(value)) {
    return DEFAULT_DIVIDE_AND_CONQUER_ITEMS;
  }

  return value
    .filter(
      (item): item is DivideAndConquerTask =>
        typeof item === 'object' &&
        item !== null &&
        typeof item.id === 'string' &&
        typeof item.text === 'string' &&
        isValidDivideAndConquerBucket((item as DivideAndConquerTask).bucket),
    )
    .map((item) => ({
      id: item.id,
      text: item.text,
      bucket: item.bucket,
    }));
};

const normalizeAppState = (value: unknown): AppState | null => {
  if (Array.isArray(value)) {
    return {
      sheets: normalizeSavedSheets(value as ChecklistSheet[]),
      divideAndConquerText: DEFAULT_DIVIDE_AND_CONQUER_TEXT,
      divideAndConquerItems: DEFAULT_DIVIDE_AND_CONQUER_ITEMS,
    };
  }

  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const state = value as Partial<AppState>;

  if (!Array.isArray(state.sheets)) {
    return null;
  }

  return {
    sheets: normalizeSavedSheets(state.sheets),
    divideAndConquerText: normalizeDivideAndConquerText(state.divideAndConquerText),
    divideAndConquerItems: normalizeDivideAndConquerItems(state.divideAndConquerItems),
  };
};

const createDefaultAppState = (): AppState => ({
  sheets: [createSheet('Checklist 1')],
  divideAndConquerText: DEFAULT_DIVIDE_AND_CONQUER_TEXT,
  divideAndConquerItems: DEFAULT_DIVIDE_AND_CONQUER_ITEMS,
});

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

const readStoreValue = async <T>(key: string): Promise<T | undefined> =>
  withStore<T | undefined>('readonly', (store, resolve, reject) => {
    const request = store.get(key);

    request.onsuccess = () => {
      resolve(request.result as T | undefined);
    };

    request.onerror = () => reject(request.error ?? new Error('Failed to load data'));
  });

export const loadAppState = async (): Promise<AppState> => {
  const storedState = normalizeAppState(await readStoreValue<unknown>(APP_STATE_STORE_KEY));

  if (storedState) {
    return storedState;
  }

  const legacySheets = normalizeAppState(await readStoreValue<unknown>(LEGACY_SHEETS_STORE_KEY));

  return legacySheets ?? createDefaultAppState();
};

export const saveAppState = async (state: AppState): Promise<void> =>
  withStore<void>('readwrite', (store, resolve, reject) => {
    const normalizedState: AppState = {
      sheets: normalizeSavedSheets(state.sheets),
      divideAndConquerText: state.divideAndConquerText,
      divideAndConquerItems: normalizeDivideAndConquerItems(state.divideAndConquerItems),
    };
    const request = store.put(normalizedState, APP_STATE_STORE_KEY);

    request.onsuccess = () => {
      const legacyRequest = store.put(normalizedState.sheets, LEGACY_SHEETS_STORE_KEY);

      legacyRequest.onsuccess = () => resolve();
      legacyRequest.onerror = () => reject(legacyRequest.error ?? new Error('Failed to save data'));
    };
    request.onerror = () => reject(request.error ?? new Error('Failed to save data'));
  });

export const createBackupPayload = (state: AppState): BackupPayload => ({
  version: BACKUP_VERSION,
  exportedAt: new Date().toISOString(),
  sheets: state.sheets,
  divideAndConquerText: state.divideAndConquerText,
  divideAndConquerItems: state.divideAndConquerItems,
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
    (payload.version === 1 || payload.version === 2 || payload.version === BACKUP_VERSION) &&
    typeof payload.exportedAt === 'string' &&
    (payload.divideAndConquerText === undefined || typeof payload.divideAndConquerText === 'string') &&
    (payload.divideAndConquerItems === undefined ||
      (Array.isArray(payload.divideAndConquerItems) &&
        payload.divideAndConquerItems.every(
          (item) =>
            typeof item === 'object' &&
            item !== null &&
            typeof item.id === 'string' &&
            typeof item.text === 'string' &&
            isValidDivideAndConquerBucket((item as DivideAndConquerTask).bucket),
        ))) &&
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
