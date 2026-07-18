import {
  ChangeEvent,
  ClipboardEvent as ReactClipboardEvent,
  KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import { Brain, BrushCleaning, Check, Download, Folder, Minus, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import {
  COLUMN_COUNT,
  createRow,
  createSheet,
  formatMonthValue,
  generateColumnLabelsForMonth,
  parseMonthValue,
} from './defaults';
import {
  DEFAULT_DIVIDE_AND_CONQUER_TEXT,
  DEFAULT_DIVIDE_AND_CONQUER_ITEMS,
  createBackupPayload,
  isValidBackupPayload,
  loadAppState,
  normalizeCurrentFocusTaskId,
  normalizeDailyHistory,
  normalizeLastRolloverDate,
  normalizeSheets,
  saveAppState,
} from './storage';
import type {
  AppState,
  CheckState,
  ChecklistSection,
  ChecklistSheet,
  DailyHistoryRecord,
  DivideAndConquerBucket,
  DivideAndConquerTask,
  SectionId,
} from './types';

const DIVIDE_AND_CONQUER_ROW_SUFFIX = DEFAULT_DIVIDE_AND_CONQUER_TEXT.slice(2);
const COMPLETED_MAGNETIC_DISTANCE = 60;
const MIN_DIVIDE_AND_CONQUER_TASKS_TO_SORT = 5;

const BrainDumpMenuIcon = () => (
  <Brain className="plan-menu-icon brain-dump-menu-icon" size={18} strokeWidth={1.8} aria-hidden="true" />
);

const TaskSorterMenuIcon = () => (
  <Folder className="plan-menu-icon task-sorter-menu-icon" size={18} strokeWidth={1.8} aria-hidden="true" />
);


type AppView = 'checklist' | 'planner' | 'sortBoard' | 'history';
type PersistenceFeedback = 'idle' | 'loading' | 'saving' | 'saved';
type DivideAndConquerQuadrantBucket = Exclude<DivideAndConquerBucket, 'unassigned' | 'completed'>;
type DivideAndConquerDropPlacement = 'before' | 'after';

interface DivideAndConquerDraftRow {
  id: string;
  text: string;
}

interface QuadrantScrollState {
  isScrollable: boolean;
  isAtBottom: boolean;
}

interface DragInsertionTarget {
  taskId: string;
  placement: DivideAndConquerDropPlacement;
}

interface CompletedDropFeedback {
  phase: 'check' | 'count';
  count: number;
  sequence: number;
}

const DIVIDE_AND_CONQUER_QUADRANT_BUCKETS: DivideAndConquerQuadrantBucket[] = [
  'productive-attractive',
  'productive-unattractive',
  'unproductive-attractive',
  'unproductive-unattractive',
];

interface ConfirmState {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
}

interface HistoryTaskEdit {
  date: string;
  kind: 'completed' | 'undone';
  taskId: string;
}

const downloadTextFile = (content: string, fileName: string) => {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
};

const formatLogTime = (checkState: CheckState) => {
  if (!checkState.loggedAt) {
    return 'Log time not recorded';
  }

  const date = new Date(checkState.loggedAt);

  if (Number.isNaN(date.getTime())) {
    return 'Log time not recorded';
  }

  return `Logged: ${new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
    hour12: false,
  }).format(date)}`;
};

const buildDivideAndConquerLine = (lineNumber: number, content: string) =>
  `${lineNumber}.${DIVIDE_AND_CONQUER_ROW_SUFFIX}${content}`;

const makeDivideAndConquerTaskId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const stripDivideAndConquerLinePrefix = (line: string) => line.replace(/^\s*\d+\.\s*/, '');

const createDivideAndConquerDraftRow = (text = ''): DivideAndConquerDraftRow => ({
  id: makeDivideAndConquerTaskId(),
  text,
});

const parseDivideAndConquerDraftRows = (value: string): DivideAndConquerDraftRow[] => {
  const rows = value.split('\n').map((line) => createDivideAndConquerDraftRow(stripDivideAndConquerLinePrefix(line)));

  return rows.length > 0 ? rows : [createDivideAndConquerDraftRow()];
};

const formatDivideAndConquerDraftRowsText = (rows: DivideAndConquerDraftRow[]) =>
  rows.length > 0
    ? rows.map((row, index) => buildDivideAndConquerLine(index + 1, row.text)).join('\n')
    : DEFAULT_DIVIDE_AND_CONQUER_TEXT;

const normalizeDivideAndConquerText = (value: string) =>
  formatDivideAndConquerDraftRowsText(parseDivideAndConquerDraftRows(value));

const getDivideAndConquerDraftTaskTexts = (rows: DivideAndConquerDraftRow[]) =>
  rows.map((row) => row.text.trim()).filter((text) => text.length > 0);

const createDefaultQuadrantScrollState = (): Record<DivideAndConquerQuadrantBucket, QuadrantScrollState> => ({
  'productive-attractive': { isScrollable: false, isAtBottom: true },
  'productive-unattractive': { isScrollable: false, isAtBottom: true },
  'unproductive-attractive': { isScrollable: false, isAtBottom: true },
  'unproductive-unattractive': { isScrollable: false, isAtBottom: true },
});

const isDivideAndConquerQuadrantBucket = (bucket: DivideAndConquerBucket): bucket is DivideAndConquerQuadrantBucket =>
  DIVIDE_AND_CONQUER_QUADRANT_BUCKETS.includes(bucket as DivideAndConquerQuadrantBucket);

const reconcileDivideAndConquerItemsWithDraftRows = (
  rows: DivideAndConquerDraftRow[],
  currentItems: DivideAndConquerTask[],
): DivideAndConquerTask[] => {
  const existingItemsByText = new Map<string, DivideAndConquerTask[]>();

  currentItems.forEach((item) => {
    const matchingItems = existingItemsByText.get(item.text) ?? [];
    matchingItems.push(item);
    existingItemsByText.set(item.text, matchingItems);
  });

  return getDivideAndConquerDraftTaskTexts(rows).map((text) => {
    const matchingItems = existingItemsByText.get(text);
    const existingItem = matchingItems?.shift();

    return existingItem ?? { id: makeDivideAndConquerTaskId(), text, bucket: 'unassigned' as const };
  });
};

const formatDivideAndConquerTasksText = (tasks: DivideAndConquerTask[]) =>
  tasks.map((task, index) => buildDivideAndConquerLine(index + 1, task.text)).join('\n');

const getLocalDateString = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const formatHistoryDate = (date: string) =>
  new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(`${date}T00:00:00`));

const formatHistoryWeekday = (date: string) =>
  new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(new Date(`${date}T00:00:00`));

interface DailyRolloverSlice {
  divideAndConquerItems: DivideAndConquerTask[];
  currentFocusTaskId: string | null;
  dailyHistory: DailyHistoryRecord[];
  lastRolloverDate: string | null;
}

const applyDailyRollover = (
  slice: DailyRolloverSlice,
  today: string,
): { slice: DailyRolloverSlice; didRollover: boolean; completedTexts: string[] } => {
  if (slice.lastRolloverDate === null) {
    return { slice: { ...slice, lastRolloverDate: today }, didRollover: true, completedTexts: [] };
  }

  // Guards against a same-day re-check and a clock that moved backwards.
  if (today <= slice.lastRolloverDate) {
    return { slice, didRollover: false, completedTexts: [] };
  }

  const record: DailyHistoryRecord | null =
    slice.divideAndConquerItems.length > 0
      ? {
          // The record belongs to the day being closed, not the day the app woke up.
          date: slice.lastRolloverDate,
          completed: slice.divideAndConquerItems
            .filter((item) => item.bucket === 'completed')
            .map((item) => ({ id: item.id, text: item.text })),
          undone: slice.divideAndConquerItems
            .filter((item) => item.bucket !== 'completed')
            .map((item) => ({ id: item.id, text: item.text })),
        }
      : null;

  return {
    slice: {
      // Completed tasks live on only in the history record; undone tasks carry
      // over into the new day as unassigned.
      divideAndConquerItems: slice.divideAndConquerItems
        .filter((item) => item.bucket !== 'completed')
        .map((item) => ({ ...item, bucket: 'unassigned' as const })),
      currentFocusTaskId: null,
      dailyHistory: record ? [record, ...slice.dailyHistory] : slice.dailyHistory,
      lastRolloverDate: today,
    },
    didRollover: true,
    completedTexts: record ? record.completed.map((entry) => entry.text) : [],
  };
};

// Drops one draft row per completed occurrence so "Start sorting" cannot
// resurrect archived tasks, while rows that never became items survive.
const removeTextsFromDraftRows = (rows: DivideAndConquerDraftRow[], texts: string[]) => {
  const remaining = new Map<string, number>();
  texts.forEach((text) => remaining.set(text, (remaining.get(text) ?? 0) + 1));

  return rows.filter((row) => {
    const text = row.text.trim();
    const count = remaining.get(text) ?? 0;

    if (count === 0) {
      return true;
    }

    remaining.set(text, count - 1);
    return false;
  });
};

const App = () => {
  const [sheets, setSheets] = useState<ChecklistSheet[]>([]);
  const [activeSheetId, setActiveSheetId] = useState<string>('');
  const [activeView, setActiveView] = useState<AppView>('checklist');
  const [divideAndConquerText, setDivideAndConquerText] = useState(DEFAULT_DIVIDE_AND_CONQUER_TEXT);
  const [divideAndConquerDraftRows, setDivideAndConquerDraftRows] = useState<DivideAndConquerDraftRow[]>(() =>
    parseDivideAndConquerDraftRows(DEFAULT_DIVIDE_AND_CONQUER_TEXT),
  );
  const divideAndConquerDraftRowsRef = useRef(divideAndConquerDraftRows);
  const [divideAndConquerItems, setDivideAndConquerItems] = useState<DivideAndConquerTask[]>(
    DEFAULT_DIVIDE_AND_CONQUER_ITEMS,
  );
  const [currentFocusTaskId, setCurrentFocusTaskId] = useState<string | null>(null);
  const [dailyHistory, setDailyHistory] = useState<DailyHistoryRecord[]>([]);
  const [lastRolloverDate, setLastRolloverDate] = useState<string | null>(null);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragInsertionTarget, setDragInsertionTarget] = useState<DragInsertionTarget | null>(null);
  const [editingDivideAndConquerTaskId, setEditingDivideAndConquerTaskId] = useState<string | null>(null);
  const [isCompletedMagnetic, setIsCompletedMagnetic] = useState(false);
  const [completedDropFeedback, setCompletedDropFeedback] = useState<CompletedDropFeedback | null>(null);
  const completedDropFeedbackSequenceRef = useRef(0);
  const completedDropFeedbackTimeoutsRef = useRef<number[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [persistenceBlocked, setPersistenceBlocked] = useState(false);
  const [persistenceFeedback, setPersistenceFeedback] = useState<PersistenceFeedback>('loading');
  const latestAppStateRef = useRef<AppState | null>(null);
  const saveFeedbackTimeoutRef = useRef<number | null>(null);
  const rolloverCheckRef = useRef<() => void>(() => {});
  const historyReturnViewRef = useRef<AppView>('checklist');
  const [status, setStatus] = useState('Loading checklist...');
  const [isSheetMenuOpen, setIsSheetMenuOpen] = useState(false);
  const [isPlanMenuOpen, setIsPlanMenuOpen] = useState(false);
  const [isRenamingSheet, setIsRenamingSheet] = useState(false);
  const [sheetNameDraft, setSheetNameDraft] = useState('');
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const sheetMenuRef = useRef<HTMLDivElement | null>(null);
  const planMenuRef = useRef<HTMLDivElement | null>(null);
  const sheetNameInputRef = useRef<HTMLInputElement | null>(null);
  const renameCancelledRef = useRef(false);
  const workspaceRef = useRef<HTMLElement | null>(null);
  const sheetWrapperRef = useRef<HTMLElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const divideAndConquerEditorRef = useRef<HTMLDivElement | null>(null);
  const completedZoneRef = useRef<HTMLElement | null>(null);
  const quadrantListRefs = useRef<Record<DivideAndConquerQuadrantBucket, HTMLDivElement | null>>({
    'productive-attractive': null,
    'productive-unattractive': null,
    'unproductive-attractive': null,
    'unproductive-unattractive': null,
  });
  const [quadrantScrollStates, setQuadrantScrollStates] = useState(createDefaultQuadrantScrollState);
  const [sheetScale, setSheetScale] = useState(1);
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });
  const [isChecklistFullscreen, setIsChecklistFullscreen] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [editingHistoryTask, setEditingHistoryTask] = useState<HistoryTaskEdit | null>(null);
  const [historyTaskDraft, setHistoryTaskDraft] = useState('');

  useEffect(
    () => () => {
      completedDropFeedbackTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    },
    [],
  );

  const resizeDivideAndConquerEditor = () => {
    const editor = divideAndConquerEditorRef.current;

    if (!editor) {
      return;
    }

    editor.querySelectorAll<HTMLTextAreaElement>('.dq-task-input').forEach((input) => {
      input.style.height = 'auto';
      input.style.height = `${input.scrollHeight}px`;
    });
  };

  const focusDivideAndConquerDraftRow = (rowIndex: number, cursorPosition?: number) => {
    requestAnimationFrame(() => {
      const input = divideAndConquerEditorRef.current?.querySelector<HTMLTextAreaElement>(
        `[data-dq-row-index="${rowIndex}"]`,
      );

      if (!input) {
        return;
      }

      const nextCursorPosition = Math.min(cursorPosition ?? input.value.length, input.value.length);
      input.focus();
      input.setSelectionRange(nextCursorPosition, nextCursorPosition);
    });
  };

  const commitDivideAndConquerDraftRows = (rows: DivideAndConquerDraftRow[], flush = false) => {
    const nextRows = rows.length > 0 ? rows : [createDivideAndConquerDraftRow()];
    const applyRows = () => {
      setDivideAndConquerDraftRows(nextRows);
      setDivideAndConquerText(formatDivideAndConquerDraftRowsText(nextRows));
    };

    divideAndConquerDraftRowsRef.current = nextRows;

    if (flush) {
      flushSync(applyRows);
      return;
    }

    applyRows();
  };

  const syncDivideAndConquerDraftRowsFromText = (value: string) => {
    const normalizedText = normalizeDivideAndConquerText(value);

    commitDivideAndConquerDraftRows(parseDivideAndConquerDraftRows(normalizedText));
  };

  const getQuadrantScrollState = (element: HTMLElement | null): QuadrantScrollState => {
    if (!element) {
      return { isScrollable: false, isAtBottom: true };
    }

    const maxScrollTop = element.scrollHeight - element.clientHeight;
    const isScrollable = maxScrollTop > 1;

    return {
      isScrollable,
      isAtBottom: !isScrollable || element.scrollTop >= maxScrollTop - 2,
    };
  };

  const updateQuadrantScrollState = (bucket: DivideAndConquerQuadrantBucket) => {
    const nextScrollState = getQuadrantScrollState(quadrantListRefs.current[bucket]);

    setQuadrantScrollStates((currentStates) => {
      const currentScrollState = currentStates[bucket];

      if (
        currentScrollState.isScrollable === nextScrollState.isScrollable &&
        currentScrollState.isAtBottom === nextScrollState.isAtBottom
      ) {
        return currentStates;
      }

      return {
        ...currentStates,
        [bucket]: nextScrollState,
      };
    });
  };

  const updateAllQuadrantScrollStates = () => {
    DIVIDE_AND_CONQUER_QUADRANT_BUCKETS.forEach(updateQuadrantScrollState);
  };

  const toggleChecklistFullscreen = async () => {
    const wrapper = sheetWrapperRef.current;

    if (!wrapper) {
      return;
    }

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await wrapper.requestFullscreen();
      }
    } catch {
      setStatus('Fullscreen is not available in this browser');
    }
  };

  useEffect(() => {
    if (!isSheetMenuOpen && !isPlanMenuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;

      if (
        target instanceof Node &&
        (sheetMenuRef.current?.contains(target) || planMenuRef.current?.contains(target))
      ) {
        return;
      }

      setIsSheetMenuOpen(false);
      setIsPlanMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsSheetMenuOpen(false);
        setIsPlanMenuOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isPlanMenuOpen, isSheetMenuOpen]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsChecklistFullscreen(document.fullscreenElement === sheetWrapperRef.current);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => {
    if (activeView !== 'checklist') {
      return;
    }

    const handleFullscreenShortcut = (event: KeyboardEvent) => {
      const target = event.target;

      if (
        event.code !== 'KeyF' ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        (target instanceof HTMLElement &&
          (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName)))
      ) {
        return;
      }

      event.preventDefault();
      void toggleChecklistFullscreen();
    };

    window.addEventListener('keydown', handleFullscreenShortcut);
    return () => window.removeEventListener('keydown', handleFullscreenShortcut);
  }, [activeView]);

  useEffect(() => {
    if (!isRenamingSheet) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      sheetNameInputRef.current?.focus();
      sheetNameInputRef.current?.select();
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [isRenamingSheet]);

  useEffect(() => {
    setIsSheetMenuOpen(false);
    setIsPlanMenuOpen(false);
    setIsRenamingSheet(false);
  }, [activeSheetId, activeView]);

  useEffect(() => {
    if (
      !status ||
      status === 'Loading checklist...' ||
      status.includes('failed') ||
      status.startsWith('Could not')
    ) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setStatus((currentStatus) => (currentStatus === status ? '' : currentStatus));
    }, 2500);

    return () => window.clearTimeout(timeoutId);
  }, [status]);

  useEffect(() => {
    let cancelled = false;

    void loadAppState()
      .then((storedState) => {
        if (cancelled) {
          return;
        }

        setSheets(storedState.sheets);
        setActiveSheetId(storedState.sheets[0]?.id ?? '');
        syncDivideAndConquerDraftRowsFromText(storedState.divideAndConquerText);

        const rolled = applyDailyRollover(
          {
            divideAndConquerItems: storedState.divideAndConquerItems,
            currentFocusTaskId: storedState.currentFocusTaskId,
            dailyHistory: storedState.dailyHistory,
            lastRolloverDate: storedState.lastRolloverDate,
          },
          getLocalDateString(),
        );
        setDivideAndConquerItems(rolled.slice.divideAndConquerItems);
        setCurrentFocusTaskId(rolled.slice.currentFocusTaskId);
        setDailyHistory(rolled.slice.dailyHistory);
        setLastRolloverDate(rolled.slice.lastRolloverDate);
        if (rolled.completedTexts.length > 0) {
          commitDivideAndConquerDraftRows(
            removeTextsFromDraftRows(divideAndConquerDraftRowsRef.current, rolled.completedTexts),
          );
        }
        setStatus('Checklist loaded');
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        const fallback = [createSheet('Checklist 1')];
        setSheets(fallback);
        setActiveSheetId(fallback[0].id);
        // Loading failed, which is not the same as no data existing: autosaving
        // this fresh state would overwrite whatever is still stored.
        setPersistenceBlocked(true);
        setStatus('Could not load saved data — autosave is paused to protect it. Reload to retry.');
      })
      .finally(() => {
        if (!cancelled) {
          setPersistenceFeedback('idle');
          setIsLoaded(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isLoaded || persistenceBlocked) {
      return;
    }

    const state: AppState = {
      sheets,
      divideAndConquerText,
      divideAndConquerItems,
      currentFocusTaskId,
      dailyHistory,
      lastRolloverDate,
    };
    latestAppStateRef.current = state;

    // Debounced so a burst of keystrokes becomes one IndexedDB write; the
    // pagehide/hidden flush below covers the tail if the tab closes first.
    const timeoutId = window.setTimeout(() => {
      setPersistenceFeedback('saving');
      void saveAppState(state)
        .then(() => {
          setPersistenceFeedback('saved');
          if (saveFeedbackTimeoutRef.current !== null) {
            window.clearTimeout(saveFeedbackTimeoutRef.current);
          }
          saveFeedbackTimeoutRef.current = window.setTimeout(() => {
            setPersistenceFeedback('idle');
            saveFeedbackTimeoutRef.current = null;
          }, 1200);
        })
        .catch(() => {
          setPersistenceFeedback('idle');
          setStatus('Save failed. Export a backup after your next successful save.');
        });
    }, 400);

    return () => window.clearTimeout(timeoutId);
  }, [
    currentFocusTaskId,
    dailyHistory,
    divideAndConquerItems,
    divideAndConquerText,
    isLoaded,
    lastRolloverDate,
    persistenceBlocked,
    sheets,
  ]);

  useEffect(
    () => () => {
      if (saveFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(saveFeedbackTimeoutRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!isLoaded || persistenceBlocked) {
      return;
    }

    const flush = () => {
      if (latestAppStateRef.current) {
        void saveAppState(latestAppStateRef.current).catch(() => {});
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flush();
      }
    };

    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isLoaded, persistenceBlocked]);

  useEffect(() => {
    rolloverCheckRef.current = () => {
      const previousRolloverDate = lastRolloverDate;
      const result = applyDailyRollover(
        { divideAndConquerItems, currentFocusTaskId, dailyHistory, lastRolloverDate },
        getLocalDateString(),
      );

      if (!result.didRollover) {
        return;
      }

      setDivideAndConquerItems(result.slice.divideAndConquerItems);
      setCurrentFocusTaskId(result.slice.currentFocusTaskId);
      setDailyHistory(result.slice.dailyHistory);
      setLastRolloverDate(result.slice.lastRolloverDate);
      if (result.completedTexts.length > 0) {
        commitDivideAndConquerDraftRows(
          removeTextsFromDraftRows(divideAndConquerDraftRowsRef.current, result.completedTexts),
        );
      }
      // The rollover can land mid-drag and unmount the dragged card, in which
      // case dragend never fires — drop any in-flight drag UI state with it.
      setDraggedTaskId(null);
      setDragInsertionTarget(null);
      setIsCompletedMagnetic(false);

      if (previousRolloverDate !== null) {
        setStatus('New day — task list renewed');
      }
    };
  }, [currentFocusTaskId, dailyHistory, divideAndConquerItems, lastRolloverDate]);

  useEffect(() => {
    if (!isLoaded) {
      return;
    }

    const checkForRollover = () => rolloverCheckRef.current();

    // A short interval plus wake/focus listeners is more reliable than one long
    // timeout to midnight, which drifts or never fires after the machine sleeps.
    const intervalId = window.setInterval(checkForRollover, 60_000);
    document.addEventListener('visibilitychange', checkForRollover);
    window.addEventListener('focus', checkForRollover);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', checkForRollover);
      window.removeEventListener('focus', checkForRollover);
    };
  }, [isLoaded]);

  useEffect(() => {
    const workspace = workspaceRef.current;
    const wrapper = sheetWrapperRef.current;
    const sheet = sheetRef.current;

    if (!workspace || !wrapper || !sheet) {
      return;
    }

    const updateScale = () => {
      const availableWidth = wrapper.clientWidth;
      const naturalWidth = sheet.scrollWidth;
      const naturalHeight = sheet.scrollHeight;
      const wrapperTop = wrapper.getBoundingClientRect().top;
      const workspaceTop = workspace.getBoundingClientRect().top;
      const isFullscreen = document.fullscreenElement === wrapper;
      const availableHeight = isFullscreen
        ? wrapper.clientHeight - 12
        : window.innerHeight - (wrapperTop - workspaceTop) - 12;

      if (availableWidth === 0 || naturalWidth === 0 || naturalHeight === 0 || availableHeight <= 0) {
        return;
      }

      const nextScale = Math.min(availableWidth / naturalWidth, availableHeight / naturalHeight);
      const nextFrameWidth = naturalWidth * nextScale;
      const nextFrameHeight = naturalHeight * nextScale;

      setSheetScale(nextScale);
      setFrameSize({
        width: nextFrameWidth,
        height: nextFrameHeight,
      });
    };

    updateScale();

    const observer = new ResizeObserver(() => {
      updateScale();
    });

    observer.observe(workspace);
    observer.observe(wrapper);
    observer.observe(sheet);
    window.addEventListener('resize', updateScale);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateScale);
    };
  }, [activeSheetId, activeView, sheets]);

  // Keeps the sheet selector honest whenever the active id goes dangling
  // (sheet deleted from a stale dialog, import replacing the list, ...).
  useEffect(() => {
    if (sheets.length > 0 && !sheets.some((sheet) => sheet.id === activeSheetId)) {
      setActiveSheetId(sheets[0].id);
    }
  }, [activeSheetId, sheets]);

  const activeSheet = sheets.find((sheet) => sheet.id === activeSheetId) ?? sheets[0] ?? null;
  const markTotals = activeSheet
    ? activeSheet.sections.reduce(
        (totals, section) => {
          section.rows.forEach((row) => {
            Object.values(row.checksByColumn).forEach((checkState) => {
              if (checkState.mark === 'plus') {
                totals.plus += 1;
              } else if (checkState.mark === 'minus') {
                totals.minus += 1;
              }
            });
          });

          return totals;
        },
        { plus: 0, minus: 0 },
    )
    : { plus: 0, minus: 0 };

  const currentFocusTask = currentFocusTaskId
    ? divideAndConquerItems.find((item) => item.id === currentFocusTaskId) ?? null
    : null;
  const visibleDivideAndConquerItems = currentFocusTaskId
    ? divideAndConquerItems.filter((item) => item.id !== currentFocusTaskId)
    : divideAndConquerItems;
  const divideAndConquerBuckets = {
    unassigned: visibleDivideAndConquerItems.filter((item) => item.bucket === 'unassigned'),
    'productive-attractive': visibleDivideAndConquerItems.filter((item) => item.bucket === 'productive-attractive'),
    'productive-unattractive': visibleDivideAndConquerItems.filter(
      (item) => item.bucket === 'productive-unattractive',
    ),
    'unproductive-attractive': visibleDivideAndConquerItems.filter(
      (item) => item.bucket === 'unproductive-attractive',
    ),
    'unproductive-unattractive': visibleDivideAndConquerItems.filter(
      (item) => item.bucket === 'unproductive-unattractive',
    ),
    completed: visibleDivideAndConquerItems.filter((item) => item.bucket === 'completed'),
  } as const;
  const completedTasks = divideAndConquerBuckets.completed;
  const todayCompletedTasks = divideAndConquerItems.filter((item) => item.bucket === 'completed');

  const markHistoryTaskComplete = (date: string, taskId: string) => {
    setDailyHistory((records) =>
      records.map((record) => {
        if (record.date !== date) {
          return record;
        }

        const task = record.undone.find((entry) => entry.id === taskId);

        if (!task) {
          return record;
        }

        return {
          ...record,
          completed: [...record.completed, task],
          undone: record.undone.filter((entry) => entry.id !== taskId),
        };
      }),
    );
    setStatus('Past task marked complete');
  };

  const startHistoryTaskEdit = (
    date: string,
    kind: 'completed' | 'undone',
    entry: { id: string; text: string },
  ) => {
    setEditingHistoryTask({ date, kind, taskId: entry.id });
    setHistoryTaskDraft(entry.text);
  };

  const cancelHistoryTaskEdit = () => {
    setEditingHistoryTask(null);
    setHistoryTaskDraft('');
  };

  const saveHistoryTaskEdit = () => {
    const text = historyTaskDraft.trim();

    if (!editingHistoryTask || !text) {
      return;
    }

    setDailyHistory((records) =>
      records.map((record) =>
        record.date === editingHistoryTask.date
          ? {
              ...record,
              [editingHistoryTask.kind]: record[editingHistoryTask.kind].map((entry) =>
                entry.id === editingHistoryTask.taskId ? { ...entry, text } : entry,
              ),
            }
          : record,
      ),
    );
    setEditingHistoryTask(null);
    setHistoryTaskDraft('');
    setStatus('Past task updated');
  };

  const handleHistoryEditKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      saveHistoryTaskEdit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelHistoryTaskEdit();
    }
  };

  const renderHistoryColumn = (
    kind: 'completed' | 'undone',
    title: string,
    entries: Array<{ id: string; text: string }>,
    emptyText: string,
    editContext?: { date: string; kind: 'completed' | 'undone' },
    onMarkComplete?: (taskId: string) => void,
  ) => (
    <div className={`history-column ${kind}`}>
      <h3>
        {title} <span className="history-column-count">({entries.length})</span>
      </h3>
      {entries.length > 0 ? (
        <ul className="history-task-list">
          {entries.map((entry) => (
            <li key={entry.id} className="history-task">
              {editContext &&
              editingHistoryTask?.date === editContext.date &&
              editingHistoryTask.kind === editContext.kind &&
              editingHistoryTask.taskId === entry.id ? (
                <>
                  <input
                    className="history-task-edit-input"
                    value={historyTaskDraft}
                    onChange={(event) => setHistoryTaskDraft(event.target.value)}
                    onKeyDown={handleHistoryEditKeyDown}
                    aria-label="Edit history task"
                    autoFocus
                  />
                  <span className="history-task-actions">
                    <button type="button" className="history-save-button" onClick={saveHistoryTaskEdit} disabled={!historyTaskDraft.trim()}>
                      Save
                    </button>
                    <button type="button" className="history-cancel-button" onClick={cancelHistoryTaskEdit}>
                      Cancel
                    </button>
                  </span>
                </>
              ) : (
                <>
                  <span className="history-task-text">{entry.text}</span>
                  {editContext ? (
                    <span className="history-task-actions">
                      <button
                        type="button"
                        className="history-edit-button"
                        onClick={() => startHistoryTaskEdit(editContext.date, editContext.kind, entry)}
                      >
                        Edit
                      </button>
                      {onMarkComplete ? (
                        <button
                          type="button"
                          className="history-complete-button"
                          onClick={() => onMarkComplete(entry.id)}
                        >
                          Mark complete
                        </button>
                      ) : null}
                    </span>
                  ) : null}
                </>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="history-column-empty">{emptyText}</p>
      )}
    </div>
  );
  const divideAndConquerTaskCount = getDivideAndConquerDraftTaskTexts(divideAndConquerDraftRows).length;
  const canSortDivideAndConquerTasks = divideAndConquerTaskCount >= MIN_DIVIDE_AND_CONQUER_TASKS_TO_SORT;
  const hasMatrixQuadrantTasks = DIVIDE_AND_CONQUER_QUADRANT_BUCKETS.some(
    (bucket) => divideAndConquerBuckets[bucket].length > 0,
  );
  const hasSortableStateToClear = hasMatrixQuadrantTasks || currentFocusTask !== null;

  useEffect(() => {
    if (!currentFocusTaskId || currentFocusTask) {
      return;
    }

    setCurrentFocusTaskId(null);
  }, [currentFocusTask, currentFocusTaskId]);

  useLayoutEffect(() => {
    if (activeView !== 'sortBoard') {
      return;
    }

    const animationFrame = window.requestAnimationFrame(updateAllQuadrantScrollStates);

    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [activeView, currentFocusTaskId, divideAndConquerItems, editingDivideAndConquerTaskId]);

  useEffect(() => {
    if (activeView !== 'sortBoard') {
      return;
    }

    window.addEventListener('resize', updateAllQuadrantScrollStates);

    return () => {
      window.removeEventListener('resize', updateAllQuadrantScrollStates);
    };
  }, [activeView]);

  const syncDivideAndConquerDraftRowsFromTasks = (tasks: DivideAndConquerTask[]) => {
    const nextText = formatDivideAndConquerTasksText(tasks);

    syncDivideAndConquerDraftRowsFromText(nextText || DEFAULT_DIVIDE_AND_CONQUER_TEXT);
  };

  const updateDivideAndConquerTaskText = (taskId: string, text: string) => {
    const nextItems = divideAndConquerItems.map((item) => (item.id === taskId ? { ...item, text } : item));
    setDivideAndConquerItems(nextItems);
    syncDivideAndConquerDraftRowsFromTasks(nextItems);
  };

  const deleteDivideAndConquerTask = (taskId: string) => {
    const nextItems = divideAndConquerItems.filter((item) => item.id !== taskId);
    setDivideAndConquerItems(nextItems);
    syncDivideAndConquerDraftRowsFromTasks(nextItems);

    if (editingDivideAndConquerTaskId === taskId) {
      setEditingDivideAndConquerTaskId(null);
    }

    if (currentFocusTaskId === taskId) {
      setCurrentFocusTaskId(null);
    }
  };

  const renderDivideAndConquerTaskCard = (task: DivideAndConquerTask) => {
    const isSourceTaskPlaceholder = draggedTaskId === task.id;
    const isEditing = editingDivideAndConquerTaskId === task.id && !isSourceTaskPlaceholder;
    const insertionClass =
      dragInsertionTarget?.taskId === task.id ? `insert-${dragInsertionTarget.placement}` : '';

    return (
      <div
        key={task.id}
        role="group"
        className={`sort-task-card ${task.bucket === 'completed' ? 'completed' : ''} ${
          draggedTaskId === task.id ? 'dragging' : ''
        } ${isSourceTaskPlaceholder ? 'source-placeholder' : ''} ${insertionClass}`}
        draggable={!isEditing}
        onDragStart={(event) => handleDivideAndConquerDragStart(event, task.id)}
        onDragEnd={handleDivideAndConquerDragEnd}
        onDragOver={(event) => handleDivideAndConquerTaskCardDragOver(event, task)}
        onDragLeave={(event) => handleDivideAndConquerTaskCardDragLeave(event, task.id)}
        onDrop={(event) => handleDivideAndConquerTaskCardDrop(event, task)}
      >
        <span className="sort-task-card-grip" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
        </span>
        {isEditing ? (
          <input
            className="sort-task-card-input"
            value={task.text}
            aria-label="Edit task"
            draggable={false}
            autoFocus
            onChange={(event) => updateDivideAndConquerTaskText(task.id, event.target.value)}
            onBlur={() => setEditingDivideAndConquerTaskId(null)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === 'Escape') {
                event.currentTarget.blur();
              }
            }}
            onDragStart={(event) => event.preventDefault()}
          />
        ) : (
          <>
            <span className="sort-task-card-text">{task.text}</span>
            <span className="sort-task-card-actions">
              <button
                type="button"
                className="sort-task-card-action"
                aria-label="Edit task"
                draggable={false}
                onClick={(event) => {
                  event.stopPropagation();
                  setEditingDivideAndConquerTaskId(task.id);
                }}
                onDragStart={(event) => event.preventDefault()}
                title="Edit task"
              >
                <Pencil className="sort-task-card-action-icon" size={15} strokeWidth={2} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="sort-task-card-action danger"
                aria-label="Delete task"
                draggable={false}
                onClick={(event) => {
                  event.stopPropagation();
                  deleteDivideAndConquerTask(task.id);
                }}
                onDragStart={(event) => event.preventDefault()}
                title="Delete task"
              >
                <Trash2 className="sort-task-card-action-icon" size={15} strokeWidth={2} aria-hidden="true" />
              </button>
            </span>
          </>
        )}
      </div>
    );
  };

  const renderDivideAndConquerQuadrantItems = (tasks: DivideAndConquerTask[]) =>
    tasks.length > 0 ? (
      tasks.map(renderDivideAndConquerTaskCard)
    ) : (
      <div className="sort-cell-empty-state" aria-hidden="true">
        {Array.from({ length: 3 }, (_, index) => (
          <span key={index} className="sort-cell-empty-slot" />
        ))}
      </div>
    );

  useEffect(() => {
    if (activeSheet || sheets.length === 0) {
      return;
    }

    setActiveSheetId(sheets[0].id);
  }, [activeSheet, sheets]);

  useEffect(() => {
    if (activeView !== 'planner') {
      return;
    }

    focusDivideAndConquerDraftRow(Math.max(0, divideAndConquerDraftRows.length - 1));
  }, [activeView]);

  useLayoutEffect(() => {
    if (activeView !== 'planner') {
      return;
    }

    resizeDivideAndConquerEditor();
  }, [activeView, divideAndConquerDraftRows]);

  useEffect(() => {
    if (activeView !== 'planner') {
      return;
    }

    window.addEventListener('resize', resizeDivideAndConquerEditor);

    return () => {
      window.removeEventListener('resize', resizeDivideAndConquerEditor);
    };
  }, [activeView]);

  const updateActiveSheet = (updater: (sheet: ChecklistSheet) => ChecklistSheet) => {
    setSheets((currentSheets) =>
      currentSheets.map((sheet) =>
        sheet.id === activeSheetId ? { ...updater(sheet), updatedAt: new Date().toISOString() } : sheet,
      ),
    );
  };

  const startSheetRename = () => {
    renameCancelledRef.current = false;
    setSheetNameDraft(activeSheet?.name ?? '');
    setIsRenamingSheet(true);
  };

  const cancelSheetRename = () => {
    renameCancelledRef.current = true;
    setIsRenamingSheet(false);
  };

  const commitSheetRename = () => {
    if (renameCancelledRef.current) {
      renameCancelledRef.current = false;
      return;
    }

    if (activeSheet && sheetNameDraft !== activeSheet.name) {
      updateActiveSheet((sheet) => ({ ...sheet, name: sheetNameDraft }));
      setStatus('Sheet renamed');
    }

    setIsRenamingSheet(false);
  };

  const handleSheetRenameKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.blur();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      renameCancelledRef.current = true;
      setIsRenamingSheet(false);
    }
  };

  const runSheetMenuAction = (action: () => void) => {
    setIsSheetMenuOpen(false);
    action();
  };

  const updateSectionRows = (
    sectionId: SectionId,
    updater: (rows: ChecklistSection['rows']) => ChecklistSection['rows'],
  ) => {
    updateActiveSheet((sheet) => ({
      ...sheet,
      sections: sheet.sections.map((section) =>
        section.id === sectionId ? { ...section, rows: updater(section.rows) } : section,
      ),
    }));
  };

  const handleCreateSheet = () => {
    const nextSheetNumber = sheets.length + 1;
    const nextSheet = createSheet(`Checklist ${nextSheetNumber}`);
    setSheets((currentSheets) => [nextSheet, ...currentSheets]);
    setActiveSheetId(nextSheet.id);
    setStatus('New sheet created');
  };

  const handleDeleteSheet = (sheetId: string) => {
    if (sheets.length === 1) {
      window.alert('At least one sheet must stay available.');
      return;
    }

    setConfirmState({
      title: 'Delete sheet',
      message: 'Delete this sheet permanently from local storage?',
      confirmLabel: 'Delete',
      onConfirm: () => {
        setSheets((currentSheets) => currentSheets.filter((sheet) => sheet.id !== sheetId));
        setStatus('Sheet deleted');
      },
    });
  };

  const openHistoryView = () => {
    historyReturnViewRef.current = activeView;
    setActiveView('history');
  };

  const handleExport = () => {
    const payload = createBackupPayload({
      sheets,
      divideAndConquerText,
      divideAndConquerItems,
      currentFocusTaskId,
      dailyHistory,
      lastRolloverDate,
    });
    const timeStamp = new Date().toISOString().slice(0, 10);
    downloadTextFile(JSON.stringify(payload, null, 2), `checklist-backup-${timeStamp}.json`);
    setStatus('Backup exported');
  };

  const handleImportClick = () => {
    importInputRef.current?.click();
  };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;

      if (!isValidBackupPayload(parsed)) {
        throw new Error('Invalid backup format');
      }

      // Restore exactly what the backup contains; fields absent from older
      // backup versions reset to defaults instead of mixing with current state.
      const normalizedSheets =
        parsed.sheets.length > 0 ? normalizeSheets(parsed.sheets) : [createSheet('Checklist 1')];
      setSheets(normalizedSheets);
      setActiveSheetId(normalizedSheets[0]?.id ?? '');
      syncDivideAndConquerDraftRowsFromText(
        typeof parsed.divideAndConquerText === 'string'
          ? parsed.divideAndConquerText
          : DEFAULT_DIVIDE_AND_CONQUER_TEXT,
      );
      const nextDivideAndConquerItems = Array.isArray(parsed.divideAndConquerItems)
        ? parsed.divideAndConquerItems
        : DEFAULT_DIVIDE_AND_CONQUER_ITEMS;
      setDivideAndConquerItems(nextDivideAndConquerItems);
      setCurrentFocusTaskId(normalizeCurrentFocusTaskId(parsed.currentFocusTaskId, nextDivideAndConquerItems));
      setDailyHistory(normalizeDailyHistory(parsed.dailyHistory));
      // Old backups carry no rollover date; stamping today keeps the imported
      // tasks from being swept into history on the next rollover check.
      setLastRolloverDate(normalizeLastRolloverDate(parsed.lastRolloverDate) ?? getLocalDateString());
      setStatus('Backup imported');
    } catch {
      window.alert('The selected file is not a valid checklist backup.');
      setStatus('Import failed');
    } finally {
      event.target.value = '';
    }
  };

  const handleMonthChange = (value: string) => {
    const parsedMonth = parseMonthValue(value);

    if (!parsedMonth) {
      return;
    }

    updateActiveSheet((sheet) => ({
      ...sheet,
      selectedYear: parsedMonth.year,
      selectedMonth: parsedMonth.month,
      columnLabels: generateColumnLabelsForMonth(parsedMonth.year, parsedMonth.month),
    }));
  };

  const closeConfirm = () => {
    setConfirmState(null);
  };

  const runConfirm = () => {
    if (!confirmState) {
      return;
    }

    confirmState.onConfirm();
    setConfirmState(null);
  };

  const handleDivideAndConquerDraftChange = (rowId: string, text: string) => {
    const currentRows = divideAndConquerDraftRowsRef.current;

    // Plain typing needs no flushSync — only the structural handlers
    // (Enter/Backspace/paste) that reposition the cursor do.
    commitDivideAndConquerDraftRows(currentRows.map((row) => (row.id === rowId ? { ...row, text } : row)));
  };

  const handleDivideAndConquerDraftKeyDown = (
    event: ReactKeyboardEvent<HTMLTextAreaElement>,
    rowIndex: number,
  ) => {
    const currentRows = divideAndConquerDraftRowsRef.current;
    const currentRow = currentRows[rowIndex];

    if (!currentRow) {
      return;
    }

    const { selectionStart, selectionEnd, value } = event.currentTarget;

    if (event.key === 'Enter') {
      event.preventDefault();

      const sourceText = value.length > 0 || currentRow.text.length === 0 ? value : currentRow.text;
      const splitStart = value.length > 0 ? selectionStart : sourceText.length;
      const splitEnd = value.length > 0 ? selectionEnd : sourceText.length;
      const nextRow = createDivideAndConquerDraftRow(sourceText.slice(splitEnd));
      const nextRows = [
        ...currentRows.slice(0, rowIndex),
        { ...currentRow, text: sourceText.slice(0, splitStart) },
        nextRow,
        ...currentRows.slice(rowIndex + 1),
      ];

      commitDivideAndConquerDraftRows(nextRows, true);
      focusDivideAndConquerDraftRow(rowIndex + 1, 0);
      return;
    }

    if (event.key === 'Backspace' && selectionStart === 0 && selectionEnd === 0 && rowIndex > 0) {
      event.preventDefault();

      const previousRow = currentRows[rowIndex - 1];
      const nextCursorPosition = previousRow.text.length;
      const nextRows = [
        ...currentRows.slice(0, rowIndex - 1),
        { ...previousRow, text: `${previousRow.text}${currentRow.text}` },
        ...currentRows.slice(rowIndex + 1),
      ];

      commitDivideAndConquerDraftRows(nextRows, true);
      focusDivideAndConquerDraftRow(rowIndex - 1, nextCursorPosition);
      return;
    }

    if (
      event.key === 'Delete' &&
      currentRow.text.length === 0 &&
      currentRows.length > 1
    ) {
      event.preventDefault();

      const nextRows = currentRows.filter((row) => row.id !== currentRow.id);
      const nextFocusIndex = Math.min(rowIndex, nextRows.length - 1);

      commitDivideAndConquerDraftRows(nextRows, true);
      focusDivideAndConquerDraftRow(nextFocusIndex, 0);
    }
  };

  const handleDivideAndConquerDraftPaste = (
    event: ReactClipboardEvent<HTMLTextAreaElement>,
    rowIndex: number,
  ) => {
    const pastedText = event.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n');

    if (!pastedText.includes('\n')) {
      return;
    }

    const currentRows = divideAndConquerDraftRowsRef.current;
    const currentRow = currentRows[rowIndex];

    if (!currentRow) {
      return;
    }

    event.preventDefault();

    const lines = pastedText.split('\n').map(stripDivideAndConquerLinePrefix);
    const { selectionStart, selectionEnd, value } = event.currentTarget;
    const beforeSelection = value.slice(0, selectionStart);
    const afterSelection = value.slice(selectionEnd);
    const lastLineIndex = lines.length - 1;
    const pastedRows = lines.slice(1).map((line, index) =>
      createDivideAndConquerDraftRow(index === lastLineIndex - 1 ? `${line}${afterSelection}` : line),
    );
    const nextRows = [
      ...currentRows.slice(0, rowIndex),
      { ...currentRow, text: `${beforeSelection}${lines[0] ?? ''}` },
      ...pastedRows,
      ...currentRows.slice(rowIndex + 1),
    ];

    commitDivideAndConquerDraftRows(nextRows, true);
    focusDivideAndConquerDraftRow(rowIndex + pastedRows.length, lines[lastLineIndex]?.length ?? 0);
  };

  const handleStartSorting = () => {
    const draftRows = divideAndConquerDraftRowsRef.current;
    const taskCount = getDivideAndConquerDraftTaskTexts(draftRows).length;

    if (taskCount < MIN_DIVIDE_AND_CONQUER_TASKS_TO_SORT) {
      setStatus(`Add at least ${MIN_DIVIDE_AND_CONQUER_TASKS_TO_SORT} tasks before sorting`);
      return;
    }

    setDivideAndConquerItems((currentItems) => reconcileDivideAndConquerItemsWithDraftRows(draftRows, currentItems));
    setActiveView('sortBoard');
    setStatus('Tasks ready to sort');
  };

  const clearMatrixQuadrants = () => {
    setDivideAndConquerItems((currentItems) =>
      currentItems.map((item) =>
        item.id === currentFocusTaskId || isDivideAndConquerQuadrantBucket(item.bucket)
          ? { ...item, bucket: 'unassigned' }
          : item,
      ),
    );
    setCurrentFocusTaskId(null);
    setDraggedTaskId(null);
    setDragInsertionTarget(null);
    setIsCompletedMagnetic(false);
    setStatus('Sorting board cleared');
  };

  const handleClearMatrixQuadrants = () => {
    if (!hasSortableStateToClear) {
      return;
    }

    setConfirmState({
      title: 'Clear all sorted tasks?',
      message: 'This will move every task back to the unassigned list and clear the current focus.',
      confirmLabel: 'Clear all',
      onConfirm: clearMatrixQuadrants,
    });
  };

  const scrollQuadrantTaskListToBottom = (bucket: DivideAndConquerQuadrantBucket) => {
    const taskList = quadrantListRefs.current[bucket];

    if (!taskList) {
      return;
    }

    taskList.scrollTo({
      top: taskList.scrollHeight,
      behavior: 'smooth',
    });

    window.setTimeout(() => updateQuadrantScrollState(bucket), 320);
  };

  const renderQuadrantScrollIndicator = (
    bucket: DivideAndConquerQuadrantBucket,
    tasks: DivideAndConquerTask[],
  ) => {
    const scrollState = quadrantScrollStates[bucket];
    const isVisible = tasks.length > 0 && scrollState.isScrollable && !scrollState.isAtBottom;

    return (
      <button
        type="button"
        className={`sort-cell-scroll-indicator ${isVisible ? 'visible' : ''}`}
        aria-label={`Scroll ${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'} to bottom`}
        aria-hidden={!isVisible}
        tabIndex={isVisible ? 0 : -1}
        disabled={!isVisible}
        onClick={(event) => {
          event.stopPropagation();
          scrollQuadrantTaskListToBottom(bucket);
        }}
        onDragStart={(event) => event.preventDefault()}
      >
        {tasks.length}
      </button>
    );
  };

  const moveDivideAndConquerTask = (
    taskId: string,
    bucket: DivideAndConquerBucket,
    targetTaskId?: string,
    placement: DivideAndConquerDropPlacement = 'after',
  ) => {
    setDivideAndConquerItems((currentItems) => {
      const movingTask = currentItems.find((item) => item.id === taskId);

      if (!movingTask) {
        return currentItems;
      }

      const nextMovingTask = { ...movingTask, bucket };
      const itemsWithoutMovingTask = currentItems.filter((item) => item.id !== taskId);

      if (targetTaskId && targetTaskId !== taskId) {
        const targetIndex = itemsWithoutMovingTask.findIndex((item) => item.id === targetTaskId);

        if (targetIndex >= 0) {
          const insertIndex = placement === 'before' ? targetIndex : targetIndex + 1;

          return [
            ...itemsWithoutMovingTask.slice(0, insertIndex),
            nextMovingTask,
            ...itemsWithoutMovingTask.slice(insertIndex),
          ];
        }
      }

      const lastBucketIndex = itemsWithoutMovingTask.reduce(
        (lastIndex, item, index) => (item.bucket === bucket ? index : lastIndex),
        -1,
      );

      if (lastBucketIndex < 0) {
        return [...itemsWithoutMovingTask, nextMovingTask];
      }

      return [
        ...itemsWithoutMovingTask.slice(0, lastBucketIndex + 1),
        nextMovingTask,
        ...itemsWithoutMovingTask.slice(lastBucketIndex + 1),
      ];
    });
  };

  const showCompletedDropFeedback = (count: number) => {
    completedDropFeedbackTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    completedDropFeedbackTimeoutsRef.current = [];

    const sequence = completedDropFeedbackSequenceRef.current + 1;
    completedDropFeedbackSequenceRef.current = sequence;
    setCompletedDropFeedback({ phase: 'check', count, sequence });

    const countTimeoutId = window.setTimeout(() => {
      setCompletedDropFeedback((currentFeedback) =>
        currentFeedback?.sequence === sequence ? { ...currentFeedback, phase: 'count' } : currentFeedback,
      );
    }, 520);
    const hideTimeoutId = window.setTimeout(() => {
      setCompletedDropFeedback((currentFeedback) =>
        currentFeedback?.sequence === sequence ? null : currentFeedback,
      );
      completedDropFeedbackTimeoutsRef.current = [];
    }, 1450);

    completedDropFeedbackTimeoutsRef.current = [countTimeoutId, hideTimeoutId];
  };

  const focusDivideAndConquerTask = (taskId: string) => {
    if (!divideAndConquerItems.some((item) => item.id === taskId)) {
      return;
    }

    const previousFocusTask = currentFocusTaskId
      ? divideAndConquerItems.find((item) => item.id === currentFocusTaskId)
      : null;

    if (previousFocusTask && previousFocusTask.id !== taskId && previousFocusTask.bucket !== 'completed') {
      showCompletedDropFeedback(todayCompletedTasks.length + 1);
    }

    setDivideAndConquerItems((currentItems) =>
      currentItems.map((item) =>
        currentFocusTaskId && item.id === currentFocusTaskId && item.id !== taskId
          ? { ...item, bucket: 'completed' }
          : item,
      ),
    );
    setCurrentFocusTaskId(taskId);
    setDraggedTaskId(null);
    setIsCompletedMagnetic(false);
    setStatus('Current focus set');
  };

  const completeCurrentFocusTask = () => {
    if (!currentFocusTaskId) {
      return;
    }

    const focusTask = divideAndConquerItems.find((item) => item.id === currentFocusTaskId);

    if (focusTask && focusTask.bucket !== 'completed') {
      showCompletedDropFeedback(todayCompletedTasks.length + 1);
    }

    setDivideAndConquerItems((currentItems) =>
      currentItems.map((item) => (item.id === currentFocusTaskId ? { ...item, bucket: 'completed' } : item)),
    );
    setCurrentFocusTaskId(null);
    setStatus('Task completed');
  };

  const clearCurrentFocusTask = () => {
    if (!currentFocusTaskId) {
      return;
    }

    setCurrentFocusTaskId(null);
    setStatus('Current focus cleared');
  };

  const handleDivideAndConquerDragStart = (event: React.DragEvent<HTMLElement>, taskId: string) => {
    setDraggedTaskId(taskId);
    setIsCompletedMagnetic(false);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', taskId);

    const source = event.currentTarget;
    const dragPreview = source.cloneNode(true) as HTMLElement;

    dragPreview.style.position = 'fixed';
    dragPreview.style.top = '-1000px';
    dragPreview.style.left = '-1000px';
    dragPreview.style.width = '320px';
    dragPreview.style.minHeight = '56px';
    dragPreview.style.boxSizing = 'border-box';
    dragPreview.style.pointerEvents = 'none';
    dragPreview.style.margin = '0';
    dragPreview.style.transform = 'none';
    dragPreview.style.opacity = '1';
    dragPreview.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.12)';

    document.body.appendChild(dragPreview);
    event.dataTransfer.setDragImage(dragPreview, 24, 28);

    window.setTimeout(() => {
      dragPreview.remove();
    }, 0);
  };

  const handleDivideAndConquerDragEnd = () => {
    setDraggedTaskId(null);
    setDragInsertionTarget(null);
    setIsCompletedMagnetic(false);
  };

  const handleDivideAndConquerDrop = (event: React.DragEvent<HTMLElement>, bucket: DivideAndConquerBucket) => {
    event.preventDefault();
    const taskId = event.dataTransfer.getData('text/plain') || draggedTaskId;

    setDraggedTaskId(null);
    setDragInsertionTarget(null);
    setIsCompletedMagnetic(false);

    // The dataTransfer text can be anything dragged in from outside the app.
    const movingTask = taskId ? divideAndConquerItems.find((item) => item.id === taskId) : null;

    if (!taskId || !movingTask) {
      return;
    }

    moveDivideAndConquerTask(taskId, bucket);

    if (bucket === 'completed') {
      if (movingTask.bucket !== 'completed') {
        showCompletedDropFeedback(todayCompletedTasks.length + 1);
      }
      setStatus('Task completed');
    }
  };

  const getTaskCardDropPlacement = (event: React.DragEvent<HTMLElement>): DivideAndConquerDropPlacement => {
    const targetRect = event.currentTarget.getBoundingClientRect();

    return event.clientY < targetRect.top + targetRect.height / 2 ? 'before' : 'after';
  };

  const handleDivideAndConquerTaskCardDragOver = (
    event: React.DragEvent<HTMLElement>,
    targetTask: DivideAndConquerTask,
  ) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';

    if (!draggedTaskId || draggedTaskId === targetTask.id) {
      setDragInsertionTarget(null);
      return;
    }

    const placement = getTaskCardDropPlacement(event);
    setDragInsertionTarget((currentTarget) =>
      currentTarget?.taskId === targetTask.id && currentTarget.placement === placement
        ? currentTarget
        : { taskId: targetTask.id, placement },
    );
  };

  const handleDivideAndConquerTaskCardDragLeave = (
    event: React.DragEvent<HTMLElement>,
    targetTaskId: string,
  ) => {
    const relatedTarget = event.relatedTarget;

    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) {
      return;
    }

    setDragInsertionTarget((currentTarget) =>
      currentTarget?.taskId === targetTaskId ? null : currentTarget,
    );
  };

  const handleDivideAndConquerTaskCardDrop = (
    event: React.DragEvent<HTMLElement>,
    targetTask: DivideAndConquerTask,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const taskId = event.dataTransfer.getData('text/plain') || draggedTaskId;

    setDraggedTaskId(null);
    setDragInsertionTarget(null);
    setIsCompletedMagnetic(false);

    if (
      !taskId ||
      taskId === targetTask.id ||
      !divideAndConquerItems.some((item) => item.id === taskId)
    ) {
      return;
    }

    const placement = getTaskCardDropPlacement(event);

    moveDivideAndConquerTask(taskId, targetTask.bucket, targetTask.id, placement);

    if (targetTask.bucket === 'completed') {
      setStatus('Task completed');
    }
  };

  const handleCurrentFocusDrop = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    const taskId = event.dataTransfer.getData('text/plain') || draggedTaskId;

    if (!taskId) {
      return;
    }

    focusDivideAndConquerTask(taskId);
    setDragInsertionTarget(null);
  };

  const handleDivideAndConquerDragOver = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  };

  const handleCompletedMagneticDragMove = (event: React.DragEvent<HTMLElement>) => {
    if (!draggedTaskId) {
      setIsCompletedMagnetic(false);
      return;
    }

    const completedZone = completedZoneRef.current;

    if (!completedZone) {
      setIsCompletedMagnetic(false);
      return;
    }

    const rect = completedZone.getBoundingClientRect();
    const isNearCompletedZone =
      event.clientX >= rect.left - COMPLETED_MAGNETIC_DISTANCE &&
      event.clientX <= rect.right + COMPLETED_MAGNETIC_DISTANCE &&
      event.clientY >= rect.top - COMPLETED_MAGNETIC_DISTANCE &&
      event.clientY <= rect.bottom + COMPLETED_MAGNETIC_DISTANCE;

    setIsCompletedMagnetic((currentValue) =>
      currentValue === isNearCompletedZone ? currentValue : isNearCompletedZone,
    );
  };

  if (!isLoaded || !activeSheet) {
    return (
      <div className="app-shell loading-screen" role="status" aria-live="polite">
        <span className="loading-spinner" aria-hidden="true" />
        <span>Loading checklist</span>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <main ref={workspaceRef} className="workspace">
        <section className="top-controls">
          <div className={`controls-row ${activeView === 'checklist' ? 'checklist-controls-row' : ''}`}>
            {activeView === 'checklist' ? (
              <>
                <div ref={planMenuRef} className={`plan-menu-root ${isPlanMenuOpen ? 'menu-open' : ''}`}>
                  <button
                    type="button"
                    className="plan-menu-trigger"
                    onClick={() => {
                      setIsSheetMenuOpen(false);
                      setIsPlanMenuOpen((isOpen) => !isOpen);
                    }}
                    aria-haspopup="menu"
                    aria-expanded={isPlanMenuOpen}
                  >
                    Daily plan
                  </button>
                  <div className="plan-options-menu" role="menu" aria-label="Daily plan">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setIsPlanMenuOpen(false);
                        setActiveView('planner');
                      }}
                    >
                      <span>Brain dump</span>
                      <BrainDumpMenuIcon />
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setIsPlanMenuOpen(false);
                        setActiveView('sortBoard');
                      }}
                    >
                      <span>Task sorter</span>
                      <TaskSorterMenuIcon />
                    </button>
                  </div>
                </div>
                <div ref={sheetMenuRef} className={`sheet-menu-root ${isSheetMenuOpen ? 'menu-open' : ''}`}>
                  <button
                    type="button"
                    className="sheet-menu-toggle"
                    onClick={() => {
                      setIsPlanMenuOpen(false);
                      setIsSheetMenuOpen((isOpen) => !isOpen);
                    }}
                    aria-label="Sheet options"
                    aria-haspopup="menu"
                    aria-expanded={isSheetMenuOpen}
                    title="Sheet options"
                  >
                    ⋯
                  </button>
                  {isSheetMenuOpen ? (
                    <div className="sheet-options-menu" role="menu" aria-label="Sheet options">
                      <label className="sheet-switch-menu-item">
                        <span>Switch sheet</span>
                        <select
                          aria-label="Switch sheet"
                          value={activeSheetId}
                          onChange={(event) => setActiveSheetId(event.target.value)}
                        >
                          {sheets.map((sheet) => (
                            <option key={sheet.id} value={sheet.id}>
                              {sheet.name || 'Untitled sheet'}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="sheet-options-divider" role="separator" />
                      {isRenamingSheet ? (
                        <div className="sheet-rename-menu-item">
                          <span>Rename sheet</span>
                          <input
                            ref={sheetNameInputRef}
                            type="text"
                            value={sheetNameDraft}
                            onChange={(event) => setSheetNameDraft(event.target.value)}
                            onBlur={commitSheetRename}
                            onKeyDown={handleSheetRenameKeyDown}
                            aria-label="New sheet name"
                          />
                          <div className="sheet-rename-actions">
                            <button
                              type="button"
                              className="save-action-button"
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={commitSheetRename}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              className="cancel-action-button"
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={cancelSheetRename}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button type="button" role="menuitem" onClick={startSheetRename}>
                          Rename
                          <Pencil className="menu-item-icon" size={18} strokeWidth={1.8} aria-hidden="true" />
                        </button>
                      )}
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => runSheetMenuAction(handleCreateSheet)}
                      >
                        New sheet
                        <Plus className="menu-item-icon" size={18} strokeWidth={1.8} aria-hidden="true" />
                      </button>
                      <div className="sheet-options-divider" role="separator" />
                      <button type="button" role="menuitem" onClick={() => runSheetMenuAction(handleExport)}>
                        Export
                        <Upload className="menu-item-icon" size={18} strokeWidth={1.8} aria-hidden="true" />
                      </button>
                      <button type="button" role="menuitem" onClick={() => runSheetMenuAction(handleImportClick)}>
                        Import
                        <Download className="menu-item-icon" size={18} strokeWidth={1.8} aria-hidden="true" />
                      </button>
                      <div className="sheet-options-divider" role="separator" />
                      <button
                        type="button"
                        className="danger-menu-item"
                        role="menuitem"
                        onClick={() => runSheetMenuAction(() => handleDeleteSheet(activeSheet.id))}
                      >
                        Delete sheet
                        <Trash2 className="menu-item-icon" size={18} strokeWidth={1.8} aria-hidden="true" />
                      </button>
                    </div>
                  ) : null}
                </div>
                <input ref={importInputRef} hidden type="file" accept="application/json" onChange={handleImport} />
                {persistenceFeedback !== 'idle' ? (
                  <span
                    className={`save-feedback-indicator save-feedback-${persistenceFeedback}`}
                    role="status"
                    aria-live="polite"
                    aria-label={
                      persistenceFeedback === 'saved'
                        ? 'Changes saved'
                        : persistenceFeedback === 'loading'
                          ? 'Loading checklist'
                          : 'Saving changes'
                    }
                  >
                    {persistenceFeedback === 'saved' ? (
                      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path d="m5 12 4.2 4.2L19 6.5" />
                      </svg>
                    ) : (
                      <span className="loading-spinner" aria-hidden="true" />
                    )}
                  </span>
                ) : null}
              </>
            ) : activeView === 'planner' ? (
              <>
                <button
                  type="button"
                  className="back-icon-button"
                  onClick={() => setActiveView('checklist')}
                  aria-label="Back to checklist"
                  title="Back to checklist"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M19 12H5M11 18l-6-6 6-6" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="history-icon-button"
                  onClick={openHistoryView}
                  aria-label="History"
                  title="History"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                    <path d="M3 3v5h5" />
                    <path d="M12 7v5l3 2" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="forward-icon-button"
                  onClick={() => setActiveView('sortBoard')}
                  aria-label="Open task sorter"
                  title="Open task sorter"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </button>
              </>
            ) : activeView === 'sortBoard' ? (
              <>
                <button
                  type="button"
                  className="back-icon-button"
                  onClick={() => setActiveView('planner')}
                  aria-label="Back to daily plan"
                  title="Back to daily plan"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M19 12H5M11 18l-6-6 6-6" />
                  </svg>
                </button>
                <button type="button" className="nav-link-button" onClick={() => setActiveView('checklist')}>
                  Checklist
                </button>
                <button
                  type="button"
                  className="history-icon-button"
                  onClick={openHistoryView}
                  aria-label="History"
                  title="History"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                    <path d="M3 3v5h5" />
                    <path d="M12 7v5l3 2" />
                  </svg>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="back-icon-button"
                  onClick={() => setActiveView(historyReturnViewRef.current)}
                  aria-label="Back"
                  title="Back"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M19 12H5M11 18l-6-6 6-6" />
                  </svg>
                </button>
                <button type="button" className="nav-link-button" onClick={() => setActiveView('checklist')}>
                  Checklist
                </button>
              </>
            )}
          </div>
        </section>

        {activeView === 'planner' ? (
          <section className="dq-page" aria-labelledby="dq-title">
            <div className="dq-editor-shell">
              <h1 id="dq-title">Daily plan</h1>
              <div
                ref={divideAndConquerEditorRef}
                className="dq-task-editor"
                role="list"
                aria-label="Daily plan tasks"
              >
                {divideAndConquerDraftRows.map((row, index) => (
                  <div key={row.id} className="dq-task-row" role="listitem">
                    <span className="dq-task-number" aria-hidden="true">
                      {index + 1}.
                    </span>
                    <textarea
                      className="dq-task-input"
                      data-dq-row-index={index}
                      rows={1}
                      value={row.text}
                      placeholder={index === 0 ? 'What do you need to do today?' : 'Add another task…'}
                      onChange={(event) => handleDivideAndConquerDraftChange(row.id, event.target.value)}
                      onKeyDown={(event) => handleDivideAndConquerDraftKeyDown(event, index)}
                      onPaste={(event) => handleDivideAndConquerDraftPaste(event, index)}
                      aria-label={`Task ${index + 1}`}
                      spellCheck
                    />
                  </div>
                ))}
              </div>
              <div className="dq-editor-actions">
                <span className="dq-task-count" aria-live="polite">
                  {divideAndConquerTaskCount} {divideAndConquerTaskCount === 1 ? 'task' : 'tasks'} added
                </span>
                <button
                  type="button"
                  className="sort-out-button"
                  onClick={handleStartSorting}
                  disabled={!canSortDivideAndConquerTasks}
                  title={
                    canSortDivideAndConquerTasks
                      ? 'Prioritize tasks'
                      : `Add at least ${MIN_DIVIDE_AND_CONQUER_TASKS_TO_SORT} tasks to prioritize`
                  }
                >
                  Prioritize tasks
                  <img
                    className="sort-out-button-icon"
                    src="https://cdn-icons-png.flaticon.com/512/8989/8989469.png"
                    alt=""
                    aria-hidden="true"
                  />
                </button>
              </div>
            </div>
          </section>
        ) : activeView === 'sortBoard' ? (
          <section
            className="sort-board-page"
            aria-labelledby="sort-board-title"
            onDragOver={handleCompletedMagneticDragMove}
          >
            <div className="sort-board-shell">
              <div className="sort-board-intro">
                <h1 id="sort-board-title">Prioritize your day</h1>
                <div className="sort-board-intro-actions">
                  <p
                    className={`sort-focus-line ${currentFocusTask ? 'has-focus' : ''} ${
                      draggedTaskId ? 'drop-ready' : ''
                    }`}
                    onDragOver={handleDivideAndConquerDragOver}
                    onDrop={handleCurrentFocusDrop}
                    aria-live="polite"
                  >
                    <span className="sort-focus-label">Main task now:</span>
                    <span className="sort-focus-text">{currentFocusTask?.text || 'drag a task here.'}</span>
                  </p>
                  {currentFocusTask ? (
                    <span className="sort-focus-actions" aria-label="Current focus actions">
                      <button
                        type="button"
                        className="sort-focus-action-button complete"
                        onClick={completeCurrentFocusTask}
                        onDragStart={(event) => event.preventDefault()}
                        aria-label="Complete current focus"
                        title="Complete current focus"
                      >
                        <span aria-hidden="true">✓</span>
                      </button>
                      <button
                        type="button"
                        className="sort-focus-action-button clear"
                        onClick={clearCurrentFocusTask}
                        onDragStart={(event) => event.preventDefault()}
                        aria-label="Clear current focus"
                        title="Clear current focus"
                      >
                        <span aria-hidden="true">×</span>
                      </button>
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="sort-board-layout">
                <aside
                  className="sort-task-panel"
                  onDragOver={handleDivideAndConquerDragOver}
                  onDrop={(event) => handleDivideAndConquerDrop(event, 'unassigned')}
                  aria-label="Task list"
                >
                  <div className="sort-task-panel-title">Tasks</div>
                  <div className="sort-task-list">
                    {divideAndConquerBuckets.unassigned.length > 0 ? (
                      divideAndConquerBuckets.unassigned.map(renderDivideAndConquerTaskCard)
                    ) : (
                      <div className="sort-empty-state" role="status" aria-live="polite">
                        <strong>No tasks left.</strong>
                        <span>Go ahead and do them.</span>
                      </div>
                    )}
                  </div>
                </aside>

                <div className="sort-matrix-and-completion">
                  <div className="sort-board-toolbar">
                    <button
                      type="button"
                      className="sort-clear-all-button"
                      onClick={handleClearMatrixQuadrants}
                      disabled={!hasSortableStateToClear}
                      aria-label="Clear all sorted tasks"
                      title="Clear all sorted tasks"
                    >
                      clear all
                    </button>
                  </div>
                  <div className="sort-matrix-wrap">
                    <div className="sort-matrix-top-labels" aria-hidden="true">
                      <span className="sort-column-header">Unattractive</span>
                      <span className="sort-column-header">Attractive</span>
                    </div>
                    <div className="sort-axis-labels" aria-hidden="true">
                      <span className="sort-axis-label">Productive</span>
                      <span className="sort-axis-label">Unproductive</span>
                    </div>
                    <div className="sort-matrix" role="application" aria-label="Daily planning matrix">
                      <div className="sort-matrix-body">
                        <div
                          className={`sort-cell sort-cell-top-left ${draggedTaskId ? 'drop-ready' : ''}`}
                          onDragOver={handleDivideAndConquerDragOver}
                          onDrop={(event) => handleDivideAndConquerDrop(event, 'productive-attractive')}
                        >
                          <div
                            ref={(element) => {
                              quadrantListRefs.current['productive-attractive'] = element;
                            }}
                            className="sort-cell-items"
                            onScroll={() => updateQuadrantScrollState('productive-attractive')}
                          >
                            {renderDivideAndConquerQuadrantItems(divideAndConquerBuckets['productive-attractive'])}
                          </div>
                          {renderQuadrantScrollIndicator(
                            'productive-attractive',
                            divideAndConquerBuckets['productive-attractive'],
                          )}
                          <div className="sort-cell-footer">(Must To-Do)</div>
                        </div>
                        <div
                          className={`sort-cell sort-cell-top-right ${draggedTaskId ? 'drop-ready' : ''}`}
                          onDragOver={handleDivideAndConquerDragOver}
                          onDrop={(event) => handleDivideAndConquerDrop(event, 'productive-unattractive')}
                        >
                          <div
                            ref={(element) => {
                              quadrantListRefs.current['productive-unattractive'] = element;
                            }}
                            className="sort-cell-items"
                            onScroll={() => updateQuadrantScrollState('productive-unattractive')}
                          >
                            {renderDivideAndConquerQuadrantItems(divideAndConquerBuckets['productive-unattractive'])}
                          </div>
                          {renderQuadrantScrollIndicator(
                            'productive-unattractive',
                            divideAndConquerBuckets['productive-unattractive'],
                          )}
                          <div className="sort-cell-footer">(Enjoy)</div>
                        </div>
                        <div
                          className={`sort-cell sort-cell-bottom-left ${draggedTaskId ? 'drop-ready' : ''}`}
                          onDragOver={handleDivideAndConquerDragOver}
                          onDrop={(event) => handleDivideAndConquerDrop(event, 'unproductive-attractive')}
                        >
                          <div
                            ref={(element) => {
                              quadrantListRefs.current['unproductive-attractive'] = element;
                            }}
                            className="sort-cell-items"
                            onScroll={() => updateQuadrantScrollState('unproductive-attractive')}
                          >
                            {renderDivideAndConquerQuadrantItems(divideAndConquerBuckets['unproductive-attractive'])}
                          </div>
                          {renderQuadrantScrollIndicator(
                            'unproductive-attractive',
                            divideAndConquerBuckets['unproductive-attractive'],
                          )}
                          <div className="sort-cell-footer">(Avoid)</div>
                        </div>
                        <div
                          className={`sort-cell sort-cell-bottom-right ${draggedTaskId ? 'drop-ready' : ''}`}
                          onDragOver={handleDivideAndConquerDragOver}
                          onDrop={(event) => handleDivideAndConquerDrop(event, 'unproductive-unattractive')}
                        >
                          <div
                            ref={(element) => {
                              quadrantListRefs.current['unproductive-unattractive'] = element;
                            }}
                            className="sort-cell-items"
                            onScroll={() => updateQuadrantScrollState('unproductive-unattractive')}
                          >
                            {renderDivideAndConquerQuadrantItems(divideAndConquerBuckets['unproductive-unattractive'])}
                          </div>
                          {renderQuadrantScrollIndicator(
                            'unproductive-unattractive',
                            divideAndConquerBuckets['unproductive-unattractive'],
                          )}
                          <div className="sort-cell-footer">(Eliminate)</div>
                        </div>
                      </div>
                    </div>
                    <section
                      ref={completedZoneRef}
                      className={`sort-completion-zone ${isCompletedMagnetic ? 'magnetic' : ''}`}
                      onDragOver={handleDivideAndConquerDragOver}
                      onDrop={(event) => handleDivideAndConquerDrop(event, 'completed')}
                      aria-label="Completed tasks"
                    >
                      <div className="sort-completion-header">
                        <div className="sort-completion-title">Completed</div>
                        <div className="sort-completion-feedback-slot" aria-live="polite" aria-atomic="true">
                          {completedDropFeedback?.phase === 'check' ? (
                            <div
                              key={`check-${completedDropFeedback.sequence}`}
                              className="sort-completion-feedback sort-completion-feedback-check"
                              role="status"
                              aria-label="Task completed"
                            >
                              <Check size={27} strokeWidth={2.7} aria-hidden="true" />
                            </div>
                          ) : completedDropFeedback?.phase === 'count' ? (
                            <div
                              key={`count-${completedDropFeedback.sequence}`}
                              className="sort-completion-feedback sort-completion-feedback-count"
                              role="status"
                              aria-label={`${completedDropFeedback.count} tasks completed`}
                            >
                              <span aria-hidden="true">x{completedDropFeedback.count}</span>
                            </div>
                          ) : null}
                        </div>
                      </div>
                      <div className="sort-completion-list">
                        {completedTasks.map(renderDivideAndConquerTaskCard)}
                      </div>
                    </section>
                  </div>
                </div>
              </div>
            </div>
          </section>
        ) : activeView === 'history' ? (
          <section className="history-page" aria-labelledby="history-title">
            <div className="history-shell">
              <h1 id="history-title">Daily history</h1>
              <article className="history-day is-today">
                <header className="history-day-header">
                  <h2>Today</h2>
                  <span className="history-day-date">{formatHistoryDate(getLocalDateString())}</span>
                </header>
                {/* Unfinished tasks are not listed while the day is still running —
                    they only become "undone" once the midnight rollover closes the day. */}
                <div className="history-columns history-columns-single">
                  {renderHistoryColumn('completed', 'Completed', todayCompletedTasks, 'Nothing completed yet.')}
                </div>
              </article>
              {dailyHistory.map((record) => (
                <article className="history-day" key={record.date}>
                  <header className="history-day-header">
                    <h2>{formatHistoryWeekday(record.date)}</h2>
                    <span className="history-day-date">{formatHistoryDate(record.date)}</span>
                  </header>
                  <div className="history-columns">
                    {renderHistoryColumn(
                      'completed',
                      'Completed',
                      record.completed,
                      'Nothing was completed.',
                      { date: record.date, kind: 'completed' },
                    )}
                    {renderHistoryColumn(
                      'undone',
                      'Undone',
                      record.undone,
                      'Nothing was left undone.',
                      { date: record.date, kind: 'undone' },
                      (taskId) => markHistoryTaskComplete(record.date, taskId),
                    )}
                  </div>
                </article>
              ))}
              {dailyHistory.length === 0 ? (
                <div className="history-empty" role="status">
                  No past days recorded yet. History appears after the first midnight renewal.
                </div>
              ) : null}
            </div>
          </section>
        ) : (
        <section ref={sheetWrapperRef} className="sheet-wrapper">
          <div
            className="sheet-fit-frame"
            style={{
              width: frameSize.width > 0 ? `${frameSize.width}px` : undefined,
              height: frameSize.height > 0 ? `${frameSize.height}px` : undefined,
            }}
          >
            <div
              ref={sheetRef}
              className="checklist-sheet"
              style={{ transform: `scale(${sheetScale})` }}
            >
            <table className="checklist-table">
              <colgroup>
                <col className="checklist-section-column" />
                <col className="checklist-label-column" />
                {Array.from({ length: COLUMN_COUNT }, (_, index) => (
                  <col key={index} className="checklist-day-column" />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th className="section-spacer" />
                  <th className="label-header">
                    <div className="sana-header">
                      <span>Sana:</span>
                      <input
                        type="month"
                        aria-label="Select month"
                        value={formatMonthValue(activeSheet.selectedYear, activeSheet.selectedMonth)}
                        onChange={(event) => handleMonthChange(event.target.value)}
                      />
                    </div>
                  </th>
                  {Array.from({ length: COLUMN_COUNT }, (_, index) => (
                    <th key={index} className="date-cell">
                      <input
                        type="text"
                        aria-label={`Date column ${index + 1}`}
                        value={activeSheet.columnLabels[index] ?? ''}
                        onChange={(event) =>
                          updateActiveSheet((sheet) => {
                            const columnLabels = [...sheet.columnLabels];
                            columnLabels[index] = event.target.value;
                            return { ...sheet, columnLabels };
                          })
                        }
                      />
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {activeSheet.sections.map((section) => (
                  <SectionBlock
                    key={section.id}
                    section={section}
                    onAddRow={(label) =>
                      updateSectionRows(section.id, (rows) => [...rows, { ...createRow(rows.length), label }])
                    }
                    onDeleteRow={(rowId) => {
                      setConfirmState({
                        title: 'Delete row',
                        message: 'Delete this row from the checklist?',
                        confirmLabel: 'Delete',
                        onConfirm: () => {
                          updateSectionRows(section.id, (rows) =>
                            rows
                              .filter((row) => row.id !== rowId)
                              .map((row, order) => ({ ...row, order })),
                          );
                        },
                      });
                    }}
                    onRenameRow={(rowId, label) =>
                      updateSectionRows(section.id, (rows) =>
                        rows.map((row) => (row.id === rowId ? { ...row, label } : row)),
                      )
                    }
                    onMarkDone={(rowId, columnIndex) =>
                      updateSectionRows(section.id, (rows) =>
                        rows.map((row) =>
                          row.id === rowId
                            ? {
                                ...row,
                                checksByColumn: {
                                  ...row.checksByColumn,
                                  [columnIndex]: {
                                    mark: 'plus',
                                    loggedAt: new Date().toISOString(),
                                  },
                                },
                              }
                            : row,
                        ),
                      )
                    }
                    onMarkUndone={(rowId, columnIndex) =>
                      updateSectionRows(section.id, (rows) =>
                        rows.map((row) =>
                          row.id === rowId
                            ? {
                                ...row,
                                checksByColumn: {
                                  ...row.checksByColumn,
                                  [columnIndex]: {
                                    mark: 'minus',
                                    loggedAt: new Date().toISOString(),
                                  },
                                },
                              }
                            : row,
                        ),
                      )
                    }
                    onClearMark={(rowId, columnIndex) =>
                      updateSectionRows(section.id, (rows) =>
                        rows.map((row) => {
                          if (row.id !== rowId) {
                            return row;
                          }

                          const checksByColumn = { ...row.checksByColumn };
                          delete checksByColumn[columnIndex];

                          return {
                            ...row,
                            checksByColumn,
                          };
                        }),
                      )
                    }
                  />
                ))}
              </tbody>
            </table>
            </div>
          </div>
          <div
            className="checklist-status-bar"
            aria-label={`Checklist totals: plus ${markTotals.plus}, minus ${markTotals.minus}`}
          >
            <span className="mark-totals">
              <span className="mark-total plus-total" title="Completed tasks marked as plus">
                + {markTotals.plus}
              </span>
              <span className="mark-total minus-total" title="Tasks marked as minus">
                - {markTotals.minus}
              </span>
            </span>
          </div>
          <button
            type="button"
            className="checklist-fullscreen-button"
            onClick={() => void toggleChecklistFullscreen()}
            aria-label={isChecklistFullscreen ? 'Exit fullscreen checklist' : 'Open fullscreen checklist'}
            title={isChecklistFullscreen ? 'Exit fullscreen (F)' : 'Fullscreen checklist (F)'}
          >
            F
          </button>
        </section>
        )}
      </main>

      {confirmState ? (
        <div className="confirm-backdrop" role="presentation" onClick={closeConfirm}>
          <div
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                closeConfirm();
              }
            }}
          >
            <h2 id="confirm-title">{confirmState.title}</h2>
            <p>{confirmState.message}</p>
            <div className="confirm-actions">
              <button type="button" className="plain-button cancel-action-button" onClick={closeConfirm} autoFocus>
                Cancel
              </button>
              <button type="button" className="confirm-delete-button" onClick={runConfirm}>
                {confirmState.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

interface SectionBlockProps {
  section: ChecklistSection;
  onAddRow: (label: string) => void;
  onDeleteRow: (rowId: string) => void;
  onRenameRow: (rowId: string, label: string) => void;
  onMarkDone: (rowId: string, columnIndex: number) => void;
  onMarkUndone: (rowId: string, columnIndex: number) => void;
  onClearMark: (rowId: string, columnIndex: number) => void;
}

interface OpenCellMenu {
  rowId: string;
  columnIndex: number;
}

const SectionBlock = ({
  section,
  onAddRow,
  onDeleteRow,
  onRenameRow,
  onMarkDone,
  onMarkUndone,
  onClearMark,
}: SectionBlockProps) => {
  const [openMenuCell, setOpenMenuCell] = useState<OpenCellMenu | null>(null);
  const [newRowLabel, setNewRowLabel] = useState('');
  const openCellRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!openMenuCell) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;

      if (target instanceof Node && openCellRef.current?.contains(target)) {
        return;
      }

      setOpenMenuCell(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenMenuCell(null);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [openMenuCell]);

  const isCellMenuOpen = (rowId: string, columnIndex: number) =>
    openMenuCell?.rowId === rowId && openMenuCell.columnIndex === columnIndex;

  const handleCellMenuToggle = (rowId: string, columnIndex: number) => {
    setOpenMenuCell((currentCell) =>
      currentCell?.rowId === rowId && currentCell.columnIndex === columnIndex ? null : { rowId, columnIndex },
    );
  };

  const handleMarkDone = (rowId: string, columnIndex: number) => {
    onMarkDone(rowId, columnIndex);
    setOpenMenuCell(null);
  };

  const handleMarkUndone = (rowId: string, columnIndex: number) => {
    onMarkUndone(rowId, columnIndex);
    setOpenMenuCell(null);
  };

  const handleClearMark = (rowId: string, columnIndex: number) => {
    onClearMark(rowId, columnIndex);
    setOpenMenuCell(null);
  };

  const handleRowLabelKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.blur();
    }
  };

  const saveNewRow = () => {
    const label = newRowLabel.trim();

    if (!label) {
      return;
    }

    onAddRow(label);
    setNewRowLabel('');
  };

  const handleNewRowKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      saveNewRow();
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setNewRowLabel('');
    }
  };

  return (
    <>
      {section.rows.map((row, rowIndex) => (
        <tr key={row.id}>
          {rowIndex === 0 ? (
            <th className="vertical-section" rowSpan={section.rows.length}>
              <span>{section.title}</span>
            </th>
          ) : null}
          <td className="row-label-cell">
            <div className="row-label-wrap">
              <input
                type="text"
                value={row.label}
                onChange={(event) => onRenameRow(row.id, event.target.value)}
                onKeyDown={handleRowLabelKeyDown}
              />
              <button type="button" className="row-delete-button" onClick={() => onDeleteRow(row.id)} aria-label="Delete row">
                ×
              </button>
            </div>
          </td>

          {Array.from({ length: COLUMN_COUNT }, (_, columnIndex) => {
            const checkState = row.checksByColumn[columnIndex];
            const isDone = checkState?.mark === 'plus';
            const isUndone = checkState?.mark === 'minus';
            const isMenuOpen = isCellMenuOpen(row.id, columnIndex);

            return (
              <td key={columnIndex} className={`checkbox-cell ${isMenuOpen ? 'menu-open' : ''}`}>
                <div className="cell-action-root" ref={isMenuOpen ? openCellRef : null}>
                  <button
                    type="button"
                    className={`check-toggle ${isDone ? 'checked' : ''} ${isUndone ? 'undone' : ''}`}
                    onClick={() => handleCellMenuToggle(row.id, columnIndex)}
                    aria-haspopup="menu"
                    aria-expanded={isMenuOpen}
                    aria-label={`${section.title} ${row.label || 'item'} day ${columnIndex + 1}${
                      isDone ? ', marked plus' : isUndone ? ', marked minus' : ', empty'
                    }`}
                    title={checkState ? formatLogTime(checkState) : undefined}
                  >
                    {isDone ? (
                      <Plus className="cell-mark-icon" size={16} strokeWidth={2.2} aria-hidden="true" />
                    ) : isUndone ? (
                      <Minus className="cell-mark-icon" size={16} strokeWidth={2.2} aria-hidden="true" />
                    ) : null}
                  </button>
                  {isMenuOpen ? (
                    <div
                      className={`cell-mark-menu ${rowIndex < 2 ? 'cell-mark-menu-down' : ''} ${
                        columnIndex >= COLUMN_COUNT - 2 ? 'cell-mark-menu-left' : ''
                      }`}
                      role="menu"
                      aria-label="Cell mark options"
                    >
                      <button
                        type="button"
                        className="cell-mark-option plus-option"
                        role="menuitem"
                        onClick={() => handleMarkDone(row.id, columnIndex)}
                        aria-label="Mark plus"
                      >
                        <Plus className="cell-mark-icon" size={17} strokeWidth={2.1} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="cell-mark-option minus-option"
                        role="menuitem"
                        onClick={() => handleMarkUndone(row.id, columnIndex)}
                        aria-label="Mark minus"
                      >
                        <Minus className="cell-mark-icon" size={17} strokeWidth={2.1} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="cell-mark-option clear-option"
                        role="menuitem"
                        onClick={() => handleClearMark(row.id, columnIndex)}
                        aria-label="Clear mark"
                      >
                        <BrushCleaning className="cell-mark-icon" size={17} strokeWidth={2.1} aria-hidden="true" />
                      </button>
                    </div>
                  ) : null}
                </div>
              </td>
            );
          })}
        </tr>
      ))}

      <tr className="add-row-tr">
        <td className="section-spacer" />
        <td className="add-row-cell">
          <div className="add-row-form">
            <input
              type="text"
              value={newRowLabel}
              onChange={(event) => setNewRowLabel(event.target.value)}
              onKeyDown={handleNewRowKeyDown}
              placeholder="+ Row"
              aria-label={`Add ${section.title} row`}
            />
          </div>
        </td>
        {Array.from({ length: COLUMN_COUNT }, (_, index) => (
          <td key={index} className="add-row-filler" />
        ))}
      </tr>
    </>
  );
};

export default App;
