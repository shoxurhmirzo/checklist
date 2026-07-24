import {
  ChangeEvent,
  ClipboardEvent as ReactClipboardEvent,
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  Suspense,
  lazy,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { track, trackError } from './analytics';
import { TopBanner } from './TopBanner';
import { getQuoteForDate } from './dailyQuotes';

// pdf.js is heavy (~600 KB); load it only when the plan page renders.
const PdfViewer = lazy(() => import('./PdfViewer').then((module) => ({ default: module.PdfViewer })));
import { flushSync } from 'react-dom';
import {
  BrushCleaning,
  Check,
  Minus,
  Pencil,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  createRow,
  createSheet,
  formatMonthValue,
  generateColumnLabelsForMonth,
  getDaysInMonth,
  parseMonthValue,
} from './defaults';
import {
  DEFAULT_DIVIDE_AND_CONQUER_TEXT,
  DEFAULT_DIVIDE_AND_CONQUER_ITEMS,
  createBackupPayload,
  isValidBackupPayload,
  loadAppState,
  MAX_CURRENT_FOCUS_TASKS,
  normalizeCurrentFocusTaskIds,
  normalizeDailyHistory,
  normalizeIdeaPlaces,
  normalizeIdeas,
  normalizeLastRolloverDate,
  normalizeRoutines,
  normalizeSheets,
  saveAppState,
} from './storage';
import { MonthPicker } from './MonthPicker';
import { SegmentedControl } from './SegmentedControl';
import type {
  AppState,
  CheckState,
  ChecklistSection,
  ChecklistSheet,
  DailyHistoryRecord,
  DivideAndConquerBucket,
  DivideAndConquerTask,
  IdeaRecord,
  RoutinePeriod,
  RoutineTask,
  SectionId,
} from './types';

const DIVIDE_AND_CONQUER_ROW_SUFFIX = DEFAULT_DIVIDE_AND_CONQUER_TEXT.slice(2);
const COMPLETED_MAGNETIC_DISTANCE = 60;
const MIN_DIVIDE_AND_CONQUER_TASKS_TO_SORT = 5;


type AppView = 'checklist' | 'routines' | 'planner' | 'sortBoard' | 'history' | 'ideas';

// Views live in the URL hash so deep links and the back button work on GitHub
// Pages, and every switch registers as a PostHog $pageview via pushState.
const VIEW_HASHES: Record<AppView, string> = {
  checklist: '#/',
  routines: '#/routines',
  planner: '#/plan',
  sortBoard: '#/sort',
  history: '#/history',
  ideas: '#/ideas',
};

const parseViewFromHash = (hash: string): AppView => {
  const match = (Object.entries(VIEW_HASHES) as [AppView, string][]).find(
    ([, viewHash]) => viewHash === hash,
  );

  return match?.[0] ?? 'checklist';
};

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

// A single hidden mirror element, reused across every caret measurement so we
// don't allocate + append + remove a fresh <div> on each Arrow key press.
let caretMeasureMirror: HTMLDivElement | null = null;
const getCaretMeasureMirror = (): HTMLDivElement => {
  if (!caretMeasureMirror) {
    caretMeasureMirror = document.createElement('div');
    caretMeasureMirror.setAttribute('aria-hidden', 'true');
    caretMeasureMirror.style.position = 'absolute';
    caretMeasureMirror.style.top = '-9999px';
    caretMeasureMirror.style.left = '-9999px';
    caretMeasureMirror.style.visibility = 'hidden';
    caretMeasureMirror.style.whiteSpace = 'pre-wrap';
    caretMeasureMirror.style.overflowWrap = 'break-word';
    caretMeasureMirror.style.height = 'auto';
  }
  return caretMeasureMirror;
};

// Detects whether the caret sits on the first / last *visual* line of a textarea
// (accounting for soft-wrapped text), so Arrow Up/Down can hand off to the
// adjacent task row only at the real edges. Falls back to treating it as a
// single line if measurement fails.
const getCaretEdgeLines = (
  textarea: HTMLTextAreaElement,
): { onFirstLine: boolean; onLastLine: boolean } => {
  try {
    const style = window.getComputedStyle(textarea);
    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
    const paddingTop = parseFloat(style.paddingTop) || 0;
    const paddingBottom = parseFloat(style.paddingBottom) || 0;

    // Fast path: when the textarea's own content is a single visual line there's
    // nothing wrapped, so the caret is on both the first and last line. Skips the
    // mirror build + forced reflow that otherwise ran on every Arrow key press.
    if (textarea.scrollHeight - paddingTop - paddingBottom < lineHeight * 1.5) {
      return { onFirstLine: true, onLastLine: true };
    }

    const mirror = getCaretMeasureMirror();
    const copyProps = [
      'box-sizing', 'width', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
      'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
      'font-family', 'font-size', 'font-weight', 'font-style', 'letter-spacing', 'text-transform',
      'line-height', 'tab-size',
    ];
    copyProps.forEach((prop) => {
      mirror.style.setProperty(prop, style.getPropertyValue(prop));
    });

    const value = textarea.value;
    const caret = textarea.selectionStart;
    mirror.textContent = value.slice(0, caret);
    const marker = document.createElement('span');
    marker.textContent = value.slice(caret) || '​';
    mirror.appendChild(marker);
    document.body.appendChild(mirror);

    const caretTop = marker.offsetTop - paddingTop;
    const textHeight = mirror.scrollHeight - paddingTop - paddingBottom;

    document.body.removeChild(mirror);

    return {
      onFirstLine: caretTop < lineHeight * 0.75,
      onLastLine: caretTop >= textHeight - lineHeight * 1.25,
    };
  } catch {
    return { onFirstLine: true, onLastLine: true };
  }
};

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

const getLocalDateString = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const LAST_EXPORT_STORAGE_KEY = 'checklist:lastExportAt';
// Stores the date the daily-quote banner was dismissed, so it stays hidden for
// the rest of that day and returns the next day with the next quote.
const BANNER_DISMISS_STORAGE_KEY = 'checklist:bannerDismissedDate';

const PLAN_PDF_URL = `${import.meta.env.BASE_URL}qarmoqlar.pdf`;
const PLAN_PDF_TITLE = 'Qarmoqlar';
const PLAN_SPLIT_STORAGE_KEY = 'checklist:planSplitPercent';
const PLAN_SPLIT_MIN_PERCENT = 25;
const PLAN_SPLIT_MAX_PERCENT = 75;

const clampPlanSplitPercent = (value: number) =>
  Math.min(PLAN_SPLIT_MAX_PERCENT, Math.max(PLAN_SPLIT_MIN_PERCENT, value));

const loadPlanSplitPercent = () => {
  const stored = Number(window.localStorage.getItem(PLAN_SPLIT_STORAGE_KEY));

  return Number.isFinite(stored) && stored > 0 ? clampPlanSplitPercent(stored) : 50;
};

const MATRIX_LABEL_MODE_STORAGE_KEY = 'checklist:matrixLabelMode';

type MatrixLabelMode = 'attraction' | 'eisenhower';

const MATRIX_QUADRANT_LABELS: Record<
  MatrixLabelMode,
  { topLeft: string; topRight: string; bottomLeft: string; bottomRight: string }
> = {
  attraction: { topLeft: 'Productive & Attractive', topRight: 'Productive & Unattractive', bottomLeft: 'Unproductive & Attractive', bottomRight: 'Unproductive & Unattractive' },
  eisenhower: {
    topLeft: 'Urgent & Important',
    topRight: 'Important, Not Urgent',
    bottomLeft: 'Urgent, Not Important',
    bottomRight: 'Not Urgent or Important',
  },
};

const loadMatrixLabelMode = (): MatrixLabelMode =>
  window.localStorage.getItem(MATRIX_LABEL_MODE_STORAGE_KEY) === 'eisenhower' ? 'eisenhower' : 'attraction';

const LAST_WORK_VIEW_STORAGE_KEY = 'checklist:lastWorkView';

const WORK_VIEWS: AppView[] = ['planner', 'sortBoard', 'ideas', 'history'];

const WORK_TAB_ITEMS: { view: AppView; label: string }[] = [
  { view: 'planner', label: 'Capture' },
  { view: 'sortBoard', label: 'Focus' },
  { view: 'ideas', label: 'Ideas' },
  { view: 'history', label: 'History' },
];

const loadLastWorkView = (): AppView => {
  const stored = window.localStorage.getItem(LAST_WORK_VIEW_STORAGE_KEY);
  return WORK_VIEWS.includes(stored as AppView) ? (stored as AppView) : 'planner';
};

const autoSizeTextArea = (element: HTMLTextAreaElement) => {
  element.style.height = 'auto';
  element.style.height = `${element.scrollHeight}px`;
};

// Focus the textarea matching `selector` within `container` on the next frame
// (after the list re-renders) and place the caret at `cursorPosition`, clamped
// to the value length. Shared by the divide-and-conquer and routine editors.
const focusRowTextArea = (
  container: HTMLElement | null,
  selector: string,
  cursorPosition?: number,
) => {
  requestAnimationFrame(() => {
    const input = container?.querySelector<HTMLTextAreaElement>(selector);

    if (!input) {
      return;
    }

    const nextCursorPosition = Math.min(cursorPosition ?? input.value.length, input.value.length);
    input.focus();
    input.setSelectionRange(nextCursorPosition, nextCursorPosition);
  });
};

// Shared split/merge surgery for the textarea-per-row editors (divide-and-conquer
// drafts and routines). Both are pure over a generic {id, text} row, so each
// handler keeps its own key routing, focus, commit, and grouping while the list
// transforms live in one place.
interface EditableRow {
  id: string;
  text: string;
}

// Splits the row `targetId` in two: it keeps `beforeText`, and `newRow` (already
// carrying the tail text plus any extra fields, e.g. a routine's period) is
// inserted right after it. Returns the list unchanged if the target is gone.
const splitEditableRow = <T extends EditableRow>(
  rows: T[],
  targetId: string,
  beforeText: string,
  newRow: T,
): T[] => {
  const targetIndex = rows.findIndex((row) => row.id === targetId);

  if (targetIndex < 0) {
    return rows;
  }

  return [
    ...rows.slice(0, targetIndex),
    { ...rows[targetIndex], text: beforeText },
    newRow,
    ...rows.slice(targetIndex + 1),
  ];
};

// Merges the row `targetId` into `previousId`: the predecessor absorbs the
// target's text and the target is removed. The caller decides which row counts
// as the predecessor (adjacent by index, or previous within the same group).
const mergeEditableRows = <T extends EditableRow>(rows: T[], targetId: string, previousId: string): T[] => {
  const targetIndex = rows.findIndex((row) => row.id === targetId);
  const previousIndex = rows.findIndex((row) => row.id === previousId);

  if (targetIndex < 0 || previousIndex < 0) {
    return rows;
  }

  const merged = { ...rows[previousIndex], text: `${rows[previousIndex].text}${rows[targetIndex].text}` };
  return rows.map((row) => (row.id === previousId ? merged : row)).filter((row) => row.id !== targetId);
};

const formatIdeaTimestamp = (isoTimestamp: string) => {
  const date = new Date(isoTimestamp);
  const includeYear = date.getFullYear() !== new Date().getFullYear();

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    ...(includeYear ? { year: 'numeric' } : {}),
  }).format(date);
};

const daysAgoFromToday = (date: string) =>
  Math.round(
    (new Date(`${getLocalDateString()}T00:00:00`).getTime() - new Date(`${date}T00:00:00`).getTime()) /
      (24 * 60 * 60 * 1000),
  );

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
  currentFocusTaskIds: string[];
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
      currentFocusTaskIds: [],
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
  const [activeView, setActiveView] = useState<AppView>(() => parseViewFromHash(window.location.hash));
  const [matrixLabelMode, setMatrixLabelMode] = useState<MatrixLabelMode>(loadMatrixLabelMode);
  const lastWorkViewRef = useRef<AppView>(loadLastWorkView());
  const [divideAndConquerText, setDivideAndConquerText] = useState(DEFAULT_DIVIDE_AND_CONQUER_TEXT);
  const [divideAndConquerDraftRows, setDivideAndConquerDraftRows] = useState<DivideAndConquerDraftRow[]>(() =>
    parseDivideAndConquerDraftRows(DEFAULT_DIVIDE_AND_CONQUER_TEXT),
  );
  const divideAndConquerDraftRowsRef = useRef(divideAndConquerDraftRows);
  const [divideAndConquerItems, setDivideAndConquerItems] = useState<DivideAndConquerTask[]>(
    DEFAULT_DIVIDE_AND_CONQUER_ITEMS,
  );
  const [currentFocusTaskIds, setCurrentFocusTaskIds] = useState<string[]>([]);
  const [dailyHistory, setDailyHistory] = useState<DailyHistoryRecord[]>([]);
  const [ideas, setIdeas] = useState<IdeaRecord[]>([]);
  const [ideaDraft, setIdeaDraft] = useState('');
  const [editingIdeaId, setEditingIdeaId] = useState<string | null>(null);
  const [ideaEditDraft, setIdeaEditDraft] = useState('');
  const ideaInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [ideaPlaces, setIdeaPlaces] = useState<string[]>([]);
  const [placePicker, setPlacePicker] = useState<{ mode: 'new'; text: string } | { mode: 'existing'; ideaId: string } | null>(null);
  const [newPlaceDraft, setNewPlaceDraft] = useState('');
  const [isEditingPlaces, setIsEditingPlaces] = useState(false);
  const [routines, setRoutines] = useState<RoutineTask[]>([]);
  const [routinePeriod, setRoutinePeriod] = useState<RoutinePeriod>('morning');
  const [isEditingRoutines, setIsEditingRoutines] = useState(false);
  const routinesListRef = useRef<HTMLDivElement | null>(null);
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
  const focusSetAtByTaskIdRef = useRef(new Map<string, number>());

  const toggleMatrixLabelMode = () => {
    const nextMode: MatrixLabelMode = matrixLabelMode === 'attraction' ? 'eisenhower' : 'attraction';
    setMatrixLabelMode(nextMode);
    window.localStorage.setItem(MATRIX_LABEL_MODE_STORAGE_KEY, nextMode);
    track('matrix_label_mode_toggled', { mode: nextMode });
  };

  useEffect(() => {
    if (activeView !== 'sortBoard') {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'm' && event.key !== 'M') {
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      const nextMode: MatrixLabelMode = matrixLabelMode === 'attraction' ? 'eisenhower' : 'attraction';
      setMatrixLabelMode(nextMode);
      window.localStorage.setItem(MATRIX_LABEL_MODE_STORAGE_KEY, nextMode);
      track('matrix_label_mode_toggled', { mode: nextMode, via: 'keyboard' });
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [activeView, matrixLabelMode]);

  useEffect(() => {
    if (WORK_VIEWS.includes(activeView)) {
      lastWorkViewRef.current = activeView;
      window.localStorage.setItem(LAST_WORK_VIEW_STORAGE_KEY, activeView);
    }
  }, [activeView]);

  // pushState (not location.hash) so PostHog's history_change pageview
  // capture sees every view switch; popstate covers back/forward.
  const navigateToView = (view: AppView) => {
    if (view === activeView) {
      return;
    }

    setActiveView(view);
    window.history.pushState(null, '', VIEW_HASHES[view]);
  };

  useEffect(() => {
    const handlePopState = () => {
      setActiveView(parseViewFromHash(window.location.hash));
    };

    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  const [status, setStatus] = useState('Loading…');
  const [bannerDismissedToday, setBannerDismissedToday] = useState(
    () => window.localStorage.getItem(BANNER_DISMISS_STORAGE_KEY) === getLocalDateString(),
  );
  const dailyQuote = getQuoteForDate();
  const showBanner = !bannerDismissedToday && dailyQuote !== null;
  const [isRenamingSheet, setIsRenamingSheet] = useState(false);
  const [sheetNameDraft, setSheetNameDraft] = useState('');
  const [isSheetMenuOpen, setIsSheetMenuOpen] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const sheetNameInputRef = useRef<HTMLInputElement | null>(null);
  const sheetMenuRef = useRef<HTMLDivElement | null>(null);
  const renameCancelledRef = useRef(false);
  const workspaceRef = useRef<HTMLElement | null>(null);
  const sheetWrapperRef = useRef<HTMLElement | null>(null);
  const checklistDockRef = useRef<HTMLDivElement | null>(null);
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
  const historyEditRef = useRef<HTMLLIElement | null>(null);
  const [planSplitPercent, setPlanSplitPercent] = useState(loadPlanSplitPercent);
  const [isPlanSplitDragging, setIsPlanSplitDragging] = useState(false);
  const planSplitRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    window.localStorage.setItem(PLAN_SPLIT_STORAGE_KEY, String(Math.round(planSplitPercent)));
  }, [planSplitPercent]);

  const handlePlanSplitPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsPlanSplitDragging(true);
    const startPercent = planSplitPercent;
    let latestPercent = planSplitPercent;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const container = planSplitRef.current;

      if (!container) {
        return;
      }

      const rect = container.getBoundingClientRect();

      if (rect.width > 0) {
        latestPercent = clampPlanSplitPercent(((moveEvent.clientX - rect.left) / rect.width) * 100);
        setPlanSplitPercent(latestPercent);
      }
    };
    const handlePointerUp = () => {
      setIsPlanSplitDragging(false);
      if (Math.round(latestPercent) !== Math.round(startPercent)) {
        track('plan_split_resized', { split_percent: Math.round(latestPercent) });
      }
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
  };

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

  const focusDivideAndConquerDraftRow = (rowIndex: number, cursorPosition?: number) =>
    focusRowTextArea(
      divideAndConquerEditorRef.current,
      `[data-dq-row-index="${rowIndex}"]`,
      cursorPosition,
    );

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
        track('checklist_fullscreen_toggled', { entering: false });
      } else {
        await wrapper.requestFullscreen();
        track('checklist_fullscreen_toggled', { entering: true });
      }
    } catch {
      setStatus('Fullscreen isn\'t available in this browser.');
    }
  };

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
    setIsRenamingSheet(false);
  }, [activeSheetId, activeView]);

  useEffect(() => {
    if (!isSheetMenuOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (sheetMenuRef.current && !sheetMenuRef.current.contains(event.target as Node)) {
        setIsSheetMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isSheetMenuOpen]);

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
            currentFocusTaskIds: storedState.currentFocusTaskIds,
            dailyHistory: storedState.dailyHistory,
            lastRolloverDate: storedState.lastRolloverDate,
          },
          getLocalDateString(),
        );
        setDivideAndConquerItems(rolled.slice.divideAndConquerItems);
        setCurrentFocusTaskIds(rolled.slice.currentFocusTaskIds);
        setDailyHistory(rolled.slice.dailyHistory);
        setIdeas(storedState.ideas);
        setIdeaPlaces(storedState.ideaPlaces);
        // A real day change resets the morning routine so it starts fresh; a
        // same-day reload leaves checks intact (applyDailyRollover returns
        // didRollover === false when today <= lastRolloverDate).
        setRoutines(
          rolled.didRollover && storedState.lastRolloverDate !== null
            ? storedState.routines.map((routine) => ({ ...routine, completed: false }))
            : storedState.routines,
        );
        setLastRolloverDate(rolled.slice.lastRolloverDate);
        // First-ever launch also reports didRollover; only a real day change counts.
        if (rolled.didRollover && storedState.lastRolloverDate !== null) {
          track('daily_rollover', {
            completed_count: rolled.completedTexts.length,
            undone_count: storedState.divideAndConquerItems.filter((item) => item.bucket !== 'completed').length,
          });
        }
        if (rolled.completedTexts.length > 0) {
          commitDivideAndConquerDraftRows(
            removeTextsFromDraftRows(divideAndConquerDraftRowsRef.current, rolled.completedTexts),
          );
        }
        setStatus('Ready.');
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }

        trackError(error, { stage: 'load_app_state' });
        const fallback = [createSheet('Checklist 1')];
        setSheets(fallback);
        setActiveSheetId(fallback[0].id);
        // Loading failed, which is not the same as no data existing: autosaving
        // this fresh state would overwrite whatever is still stored.
        setPersistenceBlocked(true);
        setStatus('Couldn\'t load your data — autosave is paused. Reload to try again.');
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
      currentFocusTaskIds,
      dailyHistory,
      ideas,
      ideaPlaces,
      routines,
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
        .catch((error: unknown) => {
          trackError(error, { stage: 'save_app_state' });
          setPersistenceFeedback('idle');
          setStatus('Save failed. Export a backup to protect your data.');
        });
    }, 400);

    return () => window.clearTimeout(timeoutId);
  }, [
    currentFocusTaskIds,
    dailyHistory,
    divideAndConquerItems,
    divideAndConquerText,
    ideaPlaces,
    ideas,
    isLoaded,
    lastRolloverDate,
    persistenceBlocked,
    routines,
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
        { divideAndConquerItems, currentFocusTaskIds, dailyHistory, lastRolloverDate },
        getLocalDateString(),
      );

      if (!result.didRollover) {
        return;
      }

      setDivideAndConquerItems(result.slice.divideAndConquerItems);
      setCurrentFocusTaskIds(result.slice.currentFocusTaskIds);
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
        // A new day wipes the morning routine's checks so it can be run again.
        setRoutines((current) => current.map((routine) => ({ ...routine, completed: false })));
        // The dismissal flag was stamped with the previous day, so a session left
        // open past midnight surfaces the new day's quote instead of staying hidden.
        setBannerDismissedToday(
          window.localStorage.getItem(BANNER_DISMISS_STORAGE_KEY) === getLocalDateString(),
        );
        setStatus('New day. Your task list is ready.');
        track('daily_rollover', {
          completed_count: result.completedTexts.length,
          undone_count: divideAndConquerItems.filter((item) => item.bucket !== 'completed').length,
        });
      }
    };
  }, [currentFocusTaskIds, dailyHistory, divideAndConquerItems, lastRolloverDate]);

  // Warm the PDF stack (pdf.js chunk, worker, document parse) during idle
  // time so the Capture page opens instantly instead of loading on demand.
  useEffect(() => {
    if (!isLoaded) {
      return;
    }

    const preload = () => {
      void import('./PdfViewer').then((module) => module.preloadPdf(PLAN_PDF_URL)).catch(() => {});
    };

    if (typeof window.requestIdleCallback === 'function') {
      const idleId = window.requestIdleCallback(preload, { timeout: 4000 });
      return () => window.cancelIdleCallback(idleId);
    }

    const timeoutId = window.setTimeout(preload, 1500);
    return () => window.clearTimeout(timeoutId);
  }, [isLoaded]);

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
    const dock = checklistDockRef.current;
    const sheet = sheetRef.current;

    if (!workspace || !wrapper || !dock || !sheet) {
      return;
    }

    const updateScale = () => {
      const availableWidth = wrapper.clientWidth;
      const naturalWidth = sheet.scrollWidth;
      const naturalHeight = sheet.scrollHeight;
      const wrapperTop = wrapper.getBoundingClientRect().top;
      const isFullscreen = document.fullscreenElement === wrapper;
      const availableHeight = isFullscreen
        ? wrapper.clientHeight - dock.offsetHeight
        : window.innerHeight - wrapperTop - dock.offsetHeight - 8;

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
    observer.observe(dock);
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
  // Only render the days the selected month actually has (28/29 for Feb, 30, or 31).
  const visibleColumnCount = activeSheet
    ? getDaysInMonth(activeSheet.selectedYear, activeSheet.selectedMonth)
    : 0;
  const markTotals = activeSheet
    ? activeSheet.sections.reduce(
        (totals, section) => {
          section.rows.forEach((row) => {
            Object.entries(row.checksByColumn).forEach(([column, checkState]) => {
              // Ignore marks in columns the current month doesn't render, so the
              // totals always match the visible grid.
              if (Number(column) >= visibleColumnCount) {
                return;
              }
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

  const currentFocusTasks = currentFocusTaskIds
    .map((taskId) => divideAndConquerItems.find((item) => item.id === taskId))
    .filter((item): item is DivideAndConquerTask => item !== undefined);
  const visibleDivideAndConquerItems =
    currentFocusTaskIds.length > 0
      ? divideAndConquerItems.filter((item) => !currentFocusTaskIds.includes(item.id))
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
    setStatus('Marked complete.');
    track('history_task_completed', { days_ago: daysAgoFromToday(date) });
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

  // Clicking anywhere outside the open editor abandons the edit — matching Escape,
  // so users don't have to hunt for the Cancel button.
  useEffect(() => {
    if (!editingHistoryTask) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && historyEditRef.current?.contains(event.target)) {
        return;
      }
      setEditingHistoryTask(null);
      setHistoryTaskDraft('');
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [editingHistoryTask]);

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
    setStatus('Updated.');
    track('history_task_edited', { days_ago: daysAgoFromToday(editingHistoryTask.date) });
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
        {title} <span className="history-column-count">{entries.length}</span>
      </h3>
      {entries.length > 0 ? (
        <ul className="history-task-list">
          {entries.map((entry) => {
            const isEditingThis =
              !!editContext &&
              editingHistoryTask?.date === editContext.date &&
              editingHistoryTask.kind === editContext.kind &&
              editingHistoryTask.taskId === entry.id;

            return (
              <li
                key={entry.id}
                className="history-task"
                ref={isEditingThis ? historyEditRef : undefined}
              >
                {isEditingThis ? (
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
            );
          })}
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
  const hasSortableStateToClear = hasMatrixQuadrantTasks || currentFocusTasks.length > 0;

  useEffect(() => {
    if (currentFocusTaskIds.length === currentFocusTasks.length) {
      return;
    }

    setCurrentFocusTaskIds((taskIds) =>
      taskIds.filter((taskId) => divideAndConquerItems.some((item) => item.id === taskId)),
    );
  }, [currentFocusTaskIds, currentFocusTasks.length, divideAndConquerItems]);

  useLayoutEffect(() => {
    if (activeView !== 'sortBoard') {
      return;
    }

    const animationFrame = window.requestAnimationFrame(updateAllQuadrantScrollStates);

    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [activeView, currentFocusTaskIds, divideAndConquerItems, editingDivideAndConquerTaskId]);

  useEffect(() => {
    if (activeView !== 'sortBoard') {
      return;
    }

    window.addEventListener('resize', updateAllQuadrantScrollStates);

    return () => {
      window.removeEventListener('resize', updateAllQuadrantScrollStates);
    };
  }, [activeView]);

  // Board edits touch only the one planner row matching the task's text;
  // rebuilding every row from the task list would wipe planner lines that
  // were typed after the last "Prioritize tasks" and never became tasks.
  const updateDraftRowMatchingText = (taskText: string, replacement: string | null) => {
    const rows = divideAndConquerDraftRowsRef.current;
    const rowIndex = rows.findIndex((row) => row.text.trim() === taskText.trim());

    if (rowIndex < 0) {
      return;
    }

    commitDivideAndConquerDraftRows(
      replacement === null
        ? rows.filter((_, index) => index !== rowIndex)
        : rows.map((row, index) => (index === rowIndex ? { ...row, text: replacement } : row)),
    );
  };

  const updateDivideAndConquerTaskText = (taskId: string, text: string) => {
    const previousTask = divideAndConquerItems.find((item) => item.id === taskId);
    setDivideAndConquerItems(
      divideAndConquerItems.map((item) => (item.id === taskId ? { ...item, text } : item)),
    );

    if (previousTask) {
      updateDraftRowMatchingText(previousTask.text, text);
    }
  };

  const deleteDivideAndConquerTask = (taskId: string) => {
    const deletedTask = divideAndConquerItems.find((item) => item.id === taskId);
    setDivideAndConquerItems(divideAndConquerItems.filter((item) => item.id !== taskId));

    if (deletedTask) {
      updateDraftRowMatchingText(deletedTask.text, null);
      track('task_deleted', { bucket: deletedTask.bucket });
    }

    if (editingDivideAndConquerTaskId === taskId) {
      setEditingDivideAndConquerTaskId(null);
    }

    if (currentFocusTaskIds.includes(taskId)) {
      setCurrentFocusTaskIds((taskIds) => taskIds.filter((id) => id !== taskId));
    }
  };

  const renderDivideAndConquerTaskCard = (task: DivideAndConquerTask, index?: number) => {
    const isSourceTaskPlaceholder = draggedTaskId === task.id;
    // Only the numbered task list is editable; quadrant and completed cards
    // stay drag-only (edit them from the list or the Focus zone).
    const canEdit = typeof index === 'number';
    const isEditing = canEdit && editingDivideAndConquerTaskId === task.id && !isSourceTaskPlaceholder;
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
        onDoubleClick={() => {
          if (canEdit && !isEditing) {
            setEditingDivideAndConquerTaskId(task.id);
          }
        }}
      >
        <span className="sort-task-card-grip" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
        </span>
        {canEdit ? (
          <button
            type="button"
            className="row-done-circle"
            draggable={false}
            onClick={(event) => {
              event.stopPropagation();
              completeTaskFromList(task.id);
            }}
            onDragStart={(event) => event.preventDefault()}
            aria-label={`Mark ${task.text} done`}
            title="Mark done"
          >
            <Check className="row-done-circle-check" size={13} strokeWidth={2.5} aria-hidden="true" />
          </button>
        ) : null}
        {typeof index === 'number' ? (
          <span className="sort-task-number" aria-hidden="true">
            {index + 1}.
          </span>
        ) : null}
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
              {canEdit ? (
                <button
                  type="button"
                  className="sort-task-card-action text-action"
                  aria-label="Edit task"
                  draggable={false}
                  onClick={(event) => {
                    event.stopPropagation();
                    setEditingDivideAndConquerTaskId(task.id);
                  }}
                  onDragStart={(event) => event.preventDefault()}
                >
                  Edit
                </button>
              ) : null}
              <button
                type="button"
                className="sort-task-card-action text-action danger"
                aria-label="Delete task"
                draggable={false}
                onClick={(event) => {
                  event.stopPropagation();
                  deleteDivideAndConquerTask(task.id);
                }}
                onDragStart={(event) => event.preventDefault()}
              >
                Delete
              </button>
            </span>
          </>
        )}
      </div>
    );
  };

  const renderDivideAndConquerQuadrantItems = (tasks: DivideAndConquerTask[]) =>
    tasks.length > 0 ? (
      // Don't forward map's index: an index marks the card editable.
      tasks.map((task) => renderDivideAndConquerTaskCard(task))
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

  useLayoutEffect(() => {
    if (activeView !== 'routines') {
      return;
    }

    routinesListRef.current
      ?.querySelectorAll<HTMLTextAreaElement>('.routine-item-input')
      .forEach(autoSizeTextArea);
  }, [activeView, routines]);

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
      setStatus('Renamed.');
      track('checklist_sheet_renamed');
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
    setStatus('Sheet added.');
    track('checklist_sheet_created', { sheet_number: nextSheetNumber });
  };

  const handleDeleteSheet = (sheetId: string) => {
    if (sheets.length === 1) {
      window.alert('You need at least one sheet.');
      return;
    }

    setConfirmState({
      title: 'Delete sheet',
      message: 'This will permanently delete the sheet.',
      confirmLabel: 'Delete',
      onConfirm: () => {
        setSheets((currentSheets) => currentSheets.filter((sheet) => sheet.id !== sheetId));
        setStatus('Deleted.');
        track('checklist_sheet_deleted');
      },
    });
  };

  const renderModeTabs = () => {
    const inWork = WORK_VIEWS.includes(activeView);
    const mode = activeView === 'routines' ? 'routines' : inWork ? 'work' : 'habits';

    return (
      <div className="mode-bar-row">
        <div className="mode-tabs" data-mode={mode}>
          <span className="mode-tabs-thumb" aria-hidden="true" />
          <button
            type="button"
            className={`mode-tab ${mode === 'habits' ? 'active' : ''}`}
            aria-current={mode === 'habits' ? 'page' : undefined}
            onClick={() => navigateToView('checklist')}
          >
            Habits
          </button>
          <button
            type="button"
            className={`mode-tab ${mode === 'routines' ? 'active' : ''}`}
            aria-current={mode === 'routines' ? 'page' : undefined}
            onClick={() => navigateToView('routines')}
          >
            Routines
          </button>
          <button
            type="button"
            className={`mode-tab ${mode === 'work' ? 'active' : ''}`}
            aria-current={mode === 'work' ? 'page' : undefined}
            onClick={() => navigateToView(lastWorkViewRef.current)}
          >
            Work
          </button>
        </div>
      </div>
    );
  };

  const renderWorkTabs = (currentView: AppView) => (
    <SegmentedControl
      className="segmented-work"
      ariaLabel="Work pages"
      options={WORK_TAB_ITEMS.map(({ view, label }) => ({ value: view, label }))}
      value={currentView}
      onChange={(view) => navigateToView(view)}
    />
  );

  const handleExport = () => {
    const payload = createBackupPayload({
      sheets,
      divideAndConquerText,
      divideAndConquerItems,
      currentFocusTaskIds,
      dailyHistory,
      ideas,
      ideaPlaces,
      routines,
      lastRolloverDate,
    });
    const timeStamp = new Date().toISOString().slice(0, 10);
    downloadTextFile(JSON.stringify(payload, null, 2), `checklist-backup-${timeStamp}.json`);
    setStatus('Exported.');
    // localStorage, not AppState: a tracking timestamp doesn't belong in backups.
    const lastExportDate = window.localStorage.getItem(LAST_EXPORT_STORAGE_KEY);
    track('checklist_exported', {
      sheet_count: sheets.length,
      days_since_last_export: lastExportDate ? daysAgoFromToday(lastExportDate) : null,
    });
    window.localStorage.setItem(LAST_EXPORT_STORAGE_KEY, getLocalDateString());
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
      setCurrentFocusTaskIds(
        normalizeCurrentFocusTaskIds(
          parsed.currentFocusTaskIds ?? parsed.currentFocusTaskId,
          nextDivideAndConquerItems,
        ),
      );
      setDailyHistory(normalizeDailyHistory(parsed.dailyHistory));
      setIdeas(normalizeIdeas(parsed.ideas));
      setIdeaPlaces(normalizeIdeaPlaces(parsed.ideaPlaces));
      setRoutines(normalizeRoutines(parsed.routines));
      // Old backups carry no rollover date; stamping today keeps the imported
      // tasks from being swept into history on the next rollover check.
      setLastRolloverDate(normalizeLastRolloverDate(parsed.lastRolloverDate) ?? getLocalDateString());
      setStatus('Imported.');
      track('checklist_imported', { sheet_count: normalizedSheets.length });
    } catch {
      window.alert('This file doesn\'t look like a checklist backup.');
      setStatus('Import failed');
      track('import_failed');
    } finally {
      event.target.value = '';
    }
  };

  const handleMonthChange = (value: string) => {
    const parsedMonth = parseMonthValue(value);

    if (!parsedMonth) {
      return;
    }

    if (activeSheet && (activeSheet.selectedYear !== parsedMonth.year || activeSheet.selectedMonth !== parsedMonth.month)) {
      const isPast =
        parsedMonth.year < activeSheet.selectedYear ||
        (parsedMonth.year === activeSheet.selectedYear && parsedMonth.month < activeSheet.selectedMonth);
      track('checklist_month_changed', {
        direction: isPast ? 'past' : 'future',
        target_month: formatMonthValue(parsedMonth.year, parsedMonth.month),
      });
    }

    // Drop checks for days the new month doesn't have (e.g. day 31 when moving
    // to February), so hidden columns can't retain marks that reappear on the
    // next switch back or silently inflate totals and backups.
    const daysInNewMonth = getDaysInMonth(parsedMonth.year, parsedMonth.month);

    updateActiveSheet((sheet) => ({
      ...sheet,
      selectedYear: parsedMonth.year,
      selectedMonth: parsedMonth.month,
      columnLabels: generateColumnLabelsForMonth(parsedMonth.year, parsedMonth.month),
      sections: sheet.sections.map((section) => ({
        ...section,
        rows: section.rows.map((row) => {
          const checksByColumn: Record<number, CheckState> = {};
          for (const [column, checkState] of Object.entries(row.checksByColumn)) {
            if (Number(column) < daysInNewMonth) {
              checksByColumn[Number(column)] = checkState;
            }
          }
          return { ...row, checksByColumn };
        }),
      })),
    }));
  };

  const commitIdea = (text: string, place: string | null) => {
    setIdeas((currentIdeas) => [
      {
        id: makeDivideAndConquerTaskId(),
        number:
          currentIdeas.reduce(
            (max, idea) => (Number.isInteger(idea.number) && idea.number > max ? idea.number : max),
            0,
          ) + 1,
        text,
        ...(place ? { place } : {}),
        createdAt: new Date().toISOString(),
      },
      ...currentIdeas,
    ]);
    setStatus('Idea added.');
    track('idea_added', { has_place: place !== null });
  };

  // Writing an idea first asks where it is; the text waits in the picker state.
  const addIdea = () => {
    const text = ideaDraft.trim();

    if (!text) {
      return;
    }

    setIdeaDraft('');
    window.requestAnimationFrame(() => {
      if (ideaInputRef.current) {
        autoSizeTextArea(ideaInputRef.current);
      }
    });
    setNewPlaceDraft('');
    setIsEditingPlaces(false);
    setPlacePicker({ mode: 'new', text });
  };

  const choosePlace = (place: string | null) => {
    if (!placePicker) {
      return;
    }

    if (placePicker.mode === 'new') {
      commitIdea(placePicker.text, place);
    } else {
      const targetId = placePicker.ideaId;
      setIdeas((currentIdeas) =>
        currentIdeas.map((idea) => (idea.id === targetId ? { ...idea, place: place ?? undefined } : idea)),
      );
      setStatus(place ? 'Place updated.' : 'Place removed.');
      track('idea_place_changed', { removed: place === null });
    }

    setPlacePicker(null);
  };

  // Dismissing the picker must never lose a written idea — it saves placeless.
  const dismissPlacePicker = () => {
    if (!placePicker) {
      return;
    }

    if (placePicker.mode === 'new') {
      commitIdea(placePicker.text, null);
    }

    setPlacePicker(null);
  };

  const openPlacePickerForIdea = (ideaId: string) => {
    setNewPlaceDraft('');
    setIsEditingPlaces(false);
    setPlacePicker({ mode: 'existing', ideaId });
  };

  const addPlace = () => {
    const name = newPlaceDraft.trim();

    if (!name) {
      return;
    }

    const existing = ideaPlaces.find((place) => place.toLowerCase() === name.toLowerCase());

    if (!existing) {
      setIdeaPlaces((currentPlaces) => [...currentPlaces, name]);
      track('idea_place_created', { place_count: ideaPlaces.length + 1 });
    }

    setNewPlaceDraft('');

    if (!isEditingPlaces) {
      choosePlace(existing ?? name);
    }
  };

  const renamePlace = (index: number, rawName: string) => {
    const name = rawName.trim();
    const oldName = ideaPlaces[index];

    if (!name || !oldName || name === oldName) {
      return;
    }

    setIdeaPlaces((currentPlaces) => currentPlaces.map((place, placeIndex) => (placeIndex === index ? name : place)));
    // Tagged ideas follow the rename so the list and the tags never diverge.
    setIdeas((currentIdeas) => currentIdeas.map((idea) => (idea.place === oldName ? { ...idea, place: name } : idea)));
  };

  const deletePlace = (index: number) => {
    setIdeaPlaces((currentPlaces) => currentPlaces.filter((_, placeIndex) => placeIndex !== index));
  };

  const startIdeaEdit = (idea: IdeaRecord) => {
    setEditingIdeaId(idea.id);
    setIdeaEditDraft(idea.text);
  };

  const cancelIdeaEdit = () => {
    setEditingIdeaId(null);
    setIdeaEditDraft('');
  };

  const saveIdeaEdit = () => {
    const text = ideaEditDraft.trim();
    const editedIdea = editingIdeaId ? ideas.find((idea) => idea.id === editingIdeaId) : null;

    // An unchanged text is a browse, not an edit — no timestamp, no event.
    if (!editedIdea || !text || text === editedIdea.text) {
      cancelIdeaEdit();
      return;
    }

    setIdeas((currentIdeas) =>
      currentIdeas.map((idea) =>
        idea.id === editingIdeaId ? { ...idea, text, updatedAt: new Date().toISOString() } : idea,
      ),
    );
    cancelIdeaEdit();
    setStatus('Updated.');
    track('idea_edited');
  };

  const deleteIdea = (ideaId: string) => {
    setConfirmState({
      title: 'Delete idea',
      message: 'This will delete the idea.',
      confirmLabel: 'Delete',
      onConfirm: () => {
        setIdeas((currentIdeas) => currentIdeas.filter((idea) => idea.id !== ideaId));
        setStatus('Deleted.');
        track('idea_deleted');
      },
    });
  };

  const focusRoutineRow = (routineId: string, cursorPosition?: number) =>
    focusRowTextArea(routinesListRef.current, `[data-routine-id="${routineId}"]`, cursorPosition);

  const addRoutine = (period: RoutinePeriod) => {
    const newRoutine: RoutineTask = { id: makeDivideAndConquerTaskId(), text: '', completed: false, period };
    setRoutines((current) => [...current, newRoutine]);
    focusRoutineRow(newRoutine.id);
    track('routine_added', { period });
  };

  const updateRoutineText = (routineId: string, text: string) => {
    setRoutines((current) => current.map((routine) => (routine.id === routineId ? { ...routine, text } : routine)));
  };

  const toggleRoutine = (routine: RoutineTask) => {
    setRoutines((current) =>
      current.map((item) => (item.id === routine.id ? { ...item, completed: !item.completed } : item)),
    );
    if (!routine.completed) {
      track('routine_completed');
    }
  };

  const deleteRoutine = (routineId: string) => {
    setRoutines((current) => current.filter((routine) => routine.id !== routineId));
    track('routine_deleted');
  };

  const handleRoutineKeyDown = (
    event: ReactKeyboardEvent<HTMLTextAreaElement>,
    routine: RoutineTask,
  ) => {
    const { selectionStart, selectionEnd, value } = event.currentTarget;

    if (event.key === 'Enter') {
      event.preventDefault();

      // New line inherits the current routine's period so it lands in the same panel.
      const nextRoutine: RoutineTask = {
        id: makeDivideAndConquerTaskId(),
        text: value.slice(selectionEnd),
        completed: false,
        period: routine.period,
      };

      setRoutines((current) => splitEditableRow(current, routine.id, value.slice(0, selectionStart), nextRoutine));
      focusRoutineRow(nextRoutine.id, 0);
      return;
    }

    if (event.key === 'Backspace' && selectionStart === 0 && selectionEnd === 0) {
      // Merge into the previous routine *within the same panel* (period).
      const samePeriod = routines.filter((item) => item.period === routine.period);
      const positionInPanel = samePeriod.findIndex((item) => item.id === routine.id);

      if (positionInPanel <= 0) {
        return;
      }

      event.preventDefault();
      const previous = samePeriod[positionInPanel - 1];

      setRoutines((current) => mergeEditableRows(current, routine.id, previous.id));
      focusRoutineRow(previous.id, previous.text.length);
    }
  };

  const renderRoutineItem = (routine: RoutineTask, displayIndex: number, isEditing: boolean) => (
    <div key={routine.id} className={`routine-item ${routine.completed ? 'completed' : ''}`}>
      <button
        type="button"
        className="row-done-circle"
        onClick={() => toggleRoutine(routine)}
        aria-pressed={routine.completed}
        aria-label={
          routine.completed
            ? `Mark ${routine.text || 'routine'} not done`
            : `Mark ${routine.text || 'routine'} done`
        }
        title={routine.completed ? 'Mark not done' : 'Mark done'}
      >
        <Check className="row-done-circle-check" size={13} strokeWidth={2.5} aria-hidden="true" />
      </button>
      <textarea
        className="routine-item-input"
        data-routine-id={routine.id}
        rows={1}
        value={routine.text}
        placeholder="New routine…"
        readOnly={!isEditing}
        tabIndex={isEditing ? undefined : -1}
        onChange={(event) => {
          updateRoutineText(routine.id, event.target.value);
          autoSizeTextArea(event.target);
        }}
        onKeyDown={isEditing ? (event) => handleRoutineKeyDown(event, routine) : undefined}
        aria-label={`${routine.period} routine ${displayIndex + 1}`}
        spellCheck={isEditing}
      />
      {isEditing ? (
        <button
          type="button"
          className="routine-item-delete text-action danger"
          onClick={() => deleteRoutine(routine.id)}
          aria-label="Delete routine"
        >
          Delete
        </button>
      ) : null}
    </div>
  );

  const renderRoutinePanel = (period: RoutinePeriod, isEditing: boolean) => {
    const items = routines.filter((routine) => routine.period === period);

    return (
      <div className={`routine-panel ${isEditing ? 'is-editing' : ''}`}>
        {items.length > 0 ? (
          <div className="routine-list">
            {items.map((routine, index) => renderRoutineItem(routine, index, isEditing))}
          </div>
        ) : (
          <p className="routine-empty">No routines yet</p>
        )}
        {isEditing ? (
          <button type="button" className="routine-add-button" onClick={() => addRoutine(period)}>
            <Plus size={16} aria-hidden="true" />
            <span>{`Add ${period} routine`}</span>
          </button>
        ) : null}
      </div>
    );
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

    // Arrow Up/Down cross into the adjacent task row when the caret is already on
    // the first / last visual line (so wrapped rows still navigate internally first).
    if (event.key === 'ArrowUp' && selectionStart === selectionEnd && rowIndex > 0) {
      if (getCaretEdgeLines(event.currentTarget).onFirstLine) {
        event.preventDefault();
        const previousRow = currentRows[rowIndex - 1];
        focusDivideAndConquerDraftRow(rowIndex - 1, Math.min(selectionStart, previousRow.text.length));
      }
      return;
    }

    if (
      event.key === 'ArrowDown' &&
      selectionStart === selectionEnd &&
      rowIndex < currentRows.length - 1
    ) {
      if (getCaretEdgeLines(event.currentTarget).onLastLine) {
        event.preventDefault();
        const nextRow = currentRows[rowIndex + 1];
        focusDivideAndConquerDraftRow(rowIndex + 1, Math.min(selectionStart, nextRow.text.length));
      }
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();

      // A read-only row hands over its committed text when the DOM value is empty,
      // so a split at the very end still produces the trailing empty row.
      const sourceText = value.length > 0 || currentRow.text.length === 0 ? value : currentRow.text;
      const splitStart = value.length > 0 ? selectionStart : sourceText.length;
      const splitEnd = value.length > 0 ? selectionEnd : sourceText.length;
      const nextRow = createDivideAndConquerDraftRow(sourceText.slice(splitEnd));
      const nextRows = splitEditableRow(currentRows, currentRow.id, sourceText.slice(0, splitStart), nextRow);

      commitDivideAndConquerDraftRows(nextRows, true);
      focusDivideAndConquerDraftRow(rowIndex + 1, 0);
      return;
    }

    if (event.key === 'Backspace' && selectionStart === 0 && selectionEnd === 0 && rowIndex > 0) {
      event.preventDefault();

      const previousRow = currentRows[rowIndex - 1];
      const nextRows = mergeEditableRows(currentRows, currentRow.id, previousRow.id);

      commitDivideAndConquerDraftRows(nextRows, true);
      focusDivideAndConquerDraftRow(rowIndex - 1, previousRow.text.length);
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
      setStatus(`Add at least ${MIN_DIVIDE_AND_CONQUER_TASKS_TO_SORT} tasks to sort.`);
      return;
    }

    const reconciledItems = reconcileDivideAndConquerItemsWithDraftRows(draftRows, divideAndConquerItems);
    const knownIds = new Set(divideAndConquerItems.map((item) => item.id));
    const newTaskCount = reconciledItems.filter((item) => !knownIds.has(item.id)).length;
    // Completed tasks no longer have a draft row (they're removed on completion),
    // so reconcile can't re-emit them. Carry them forward explicitly to keep the
    // completed zone and daily-history rollover intact.
    const reconciledIds = new Set(reconciledItems.map((item) => item.id));
    const preservedCompletedItems = divideAndConquerItems.filter(
      (item) => item.bucket === 'completed' && !reconciledIds.has(item.id),
    );
    setDivideAndConquerItems([...reconciledItems, ...preservedCompletedItems]);
    navigateToView('sortBoard');
    setStatus('Ready to sort.');
    track('task_sorting_started', { task_count: taskCount });
    if (newTaskCount > 0) {
      track('tasks_added', { new_task_count: newTaskCount });
    }
  };

  const clearMatrixQuadrants = () => {
    setDivideAndConquerItems((currentItems) =>
      currentItems.map((item) =>
        currentFocusTaskIds.includes(item.id) || isDivideAndConquerQuadrantBucket(item.bucket)
          ? { ...item, bucket: 'unassigned' }
          : item,
      ),
    );
    setCurrentFocusTaskIds([]);
    focusSetAtByTaskIdRef.current.clear();
    setDraggedTaskId(null);
    setDragInsertionTarget(null);
    setIsCompletedMagnetic(false);
    setStatus('Board cleared.');
    track('sort_board_cleared', {
      cleared_task_count: divideAndConquerItems.filter(
        (item) => currentFocusTaskIds.includes(item.id) || isDivideAndConquerQuadrantBucket(item.bucket),
      ).length,
    });
  };

  const handleClearMatrixQuadrants = () => {
    if (!hasSortableStateToClear) {
      return;
    }

    setConfirmState({
      title: 'Clear all tasks?',
      message: 'Every task will return to the list, and focus will be cleared.',
      confirmLabel: 'Clear All',
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
    const priorTask = divideAndConquerItems.find((item) => item.id === taskId);

    // 'completed' is covered by task_completed; reordering inside a bucket is noise.
    if (priorTask && priorTask.bucket !== bucket && isDivideAndConquerQuadrantBucket(bucket)) {
      track('task_moved_to_quadrant', { bucket, from_bucket: priorTask.bucket });
    }

    // Dragging a focused task into any bucket takes it out of the focus area;
    // it can't sit in both places at once.
    setCurrentFocusTaskIds((taskIds) => taskIds.filter((id) => id !== taskId));
    focusSetAtByTaskIdRef.current.delete(taskId);

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

    setDraggedTaskId(null);
    setIsCompletedMagnetic(false);

    if (currentFocusTaskIds.includes(taskId)) {
      return;
    }

    // The area holds up to two tasks; a drop beyond that completes the oldest
    // focus to make room, matching the single-focus replace behavior.
    const displacedTaskId =
      currentFocusTaskIds.length >= MAX_CURRENT_FOCUS_TASKS ? currentFocusTaskIds[0] : null;
    const displacedTask = displacedTaskId
      ? divideAndConquerItems.find((item) => item.id === displacedTaskId)
      : null;

    if (displacedTask && displacedTask.bucket !== 'completed') {
      showCompletedDropFeedback(todayCompletedTasks.length + 1);
      track('task_completed', { completion_method: 'focus_displaced' });
      removeCompletedTaskFromDraftRows(displacedTask.text);
    }

    if (displacedTaskId) {
      setDivideAndConquerItems((currentItems) =>
        currentItems.map((item) =>
          item.id === displacedTaskId ? { ...item, bucket: 'completed' } : item,
        ),
      );
      focusSetAtByTaskIdRef.current.delete(displacedTaskId);
    }

    setCurrentFocusTaskIds((taskIds) =>
      [...taskIds.filter((id) => id !== displacedTaskId), taskId].slice(-MAX_CURRENT_FOCUS_TASKS),
    );
    focusSetAtByTaskIdRef.current.set(taskId, Date.now());
    setStatus('Focus set.');
    track('task_set_as_focus');
  };

  // Completing a task drops its matching row from Plan Your Day so the daily
  // plan only ever lists work that's still outstanding.
  const removeCompletedTaskFromDraftRows = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }

    const currentRows = divideAndConquerDraftRowsRef.current;
    const nextRows = removeTextsFromDraftRows(currentRows, [trimmed]);

    if (nextRows.length !== currentRows.length) {
      commitDivideAndConquerDraftRows(nextRows);
    }
  };

  const completeFocusTask = (taskId: string) => {
    if (!currentFocusTaskIds.includes(taskId)) {
      return;
    }

    const focusTask = divideAndConquerItems.find((item) => item.id === taskId);

    if (focusTask && focusTask.bucket !== 'completed') {
      showCompletedDropFeedback(todayCompletedTasks.length + 1);
      removeCompletedTaskFromDraftRows(focusTask.text);
    }

    setDivideAndConquerItems((currentItems) =>
      currentItems.map((item) => (item.id === taskId ? { ...item, bucket: 'completed' } : item)),
    );
    setCurrentFocusTaskIds((taskIds) => taskIds.filter((id) => id !== taskId));
    setStatus('Done.');
    const focusSetAt = focusSetAtByTaskIdRef.current.get(taskId);
    focusSetAtByTaskIdRef.current.delete(taskId);
    track('task_completed', {
      completion_method: 'focus_button',
      // Only meaningful when focus was set this session; persisted focus has no timestamp.
      ...(focusSetAt !== undefined ? { seconds_since_focus: Math.round((Date.now() - focusSetAt) / 1000) } : {}),
    });
  };

  const clearFocusTask = (taskId: string) => {
    if (!currentFocusTaskIds.includes(taskId)) {
      return;
    }

    setCurrentFocusTaskIds((taskIds) => taskIds.filter((id) => id !== taskId));
    focusSetAtByTaskIdRef.current.delete(taskId);
    setStatus('Focus cleared.');
    track('task_focus_cleared');
  };

  const completeTaskFromList = (taskId: string) => {
    const task = divideAndConquerItems.find((item) => item.id === taskId);

    if (!task || task.bucket === 'completed') {
      return;
    }

    showCompletedDropFeedback(todayCompletedTasks.length + 1);
    moveDivideAndConquerTask(taskId, 'completed');
    removeCompletedTaskFromDraftRows(task.text);
    setStatus('Done.');
    track('task_completed', { completion_method: 'done_circle' });
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
        track('task_completed', { completion_method: 'drag_and_drop' });
        removeCompletedTaskFromDraftRows(movingTask.text);
      }
      setStatus('Done.');
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
      setStatus('Done.');
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
        <span>Loading</span>
      </div>
    );
  }

  return (
    <div className="app-shell">
      {showBanner && dailyQuote ? (
        <TopBanner
          ariaLabel="Quote of the day"
          icon="✨"
          onDismiss={() => {
            window.localStorage.setItem(BANNER_DISMISS_STORAGE_KEY, getLocalDateString());
            setBannerDismissedToday(true);
          }}
        >
          <span className="banner-quote">
            {dailyQuote.text}
            {dailyQuote.author ? <span className="banner-quote-author"> — {dailyQuote.author}</span> : null}
          </span>
        </TopBanner>
      ) : null}
      <main ref={workspaceRef} className="workspace">
        <section className="top-controls">
          {renderModeTabs()}
          <div
            className={`controls-row ${activeView === 'checklist' ? 'checklist-controls-row' : ''}`}
          >
            {activeView === 'checklist' ? (
              <>
                <div className="sheet-actions" aria-label="Sheet actions">
                  <select
                    className="sheet-switch-select"
                    aria-label="Switch sheet"
                    value={activeSheetId}
                    onChange={(event) => setActiveSheetId(event.target.value)}
                  >
                    {sheets.map((sheet) => (
                      <option key={sheet.id} value={sheet.id}>
                        {sheet.name || 'Untitled'}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="page-nav-link" onClick={handleCreateSheet}>
                    New Sheet
                  </button>
                  <button type="button" className="page-nav-link" onClick={handleExport}>
                    Export
                  </button>
                  <div className="sheet-menu-wrapper" ref={sheetMenuRef}>
                    <button
                      type="button"
                      className="page-nav-link"
                      onClick={() => setIsSheetMenuOpen(!isSheetMenuOpen)}
                      aria-expanded={isSheetMenuOpen}
                      aria-label="More sheet options"
                    >
                      ⋯
                    </button>
                    {isSheetMenuOpen && (
                      <div className="sheet-menu">
                        {isRenamingSheet ? (
                          <span className="sheet-rename-inline">
                            <input
                              ref={sheetNameInputRef}
                              type="text"
                              value={sheetNameDraft}
                              onChange={(event) => setSheetNameDraft(event.target.value)}
                              onBlur={commitSheetRename}
                              onKeyDown={handleSheetRenameKeyDown}
                              aria-label="New sheet name"
                            />
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
                          </span>
                        ) : (
                          <button type="button" className="sheet-menu-item" onClick={startSheetRename}>
                            <Pencil size={16} />
                            <span>Rename</span>
                          </button>
                        )}
                        <button type="button" className="sheet-menu-item" onClick={handleImportClick}>
                          <Upload size={16} />
                          <span>Import</span>
                        </button>
                        <button
                          type="button"
                          className="sheet-menu-item sheet-menu-item-danger"
                          onClick={() => handleDeleteSheet(activeSheet.id)}
                        >
                          <Trash2 size={16} />
                          <span>Delete</span>
                        </button>
                      </div>
                    )}
                  </div>
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
            ) : activeView === 'routines' ? (
              persistenceFeedback !== 'idle' ? (
                <span
                  className={`save-feedback-indicator save-feedback-${persistenceFeedback}`}
                  role="status"
                  aria-live="polite"
                  aria-label={persistenceFeedback === 'saved' ? 'Changes saved' : 'Saving changes'}
                >
                  {persistenceFeedback === 'saved' ? (
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                      <path d="m5 12 4.2 4.2L19 6.5" />
                    </svg>
                  ) : (
                    <span className="loading-spinner" aria-hidden="true" />
                  )}
                </span>
              ) : null
            ) : activeView === 'planner' ? (
              renderWorkTabs('planner')
            ) : activeView === 'sortBoard' ? (
              renderWorkTabs('sortBoard')
            ) : activeView === 'ideas' ? (
              <>
                {renderWorkTabs('ideas')}
                {persistenceFeedback !== 'idle' ? (
                  <span
                    className={`save-feedback-indicator save-feedback-${persistenceFeedback}`}
                    role="status"
                    aria-live="polite"
                    aria-label={persistenceFeedback === 'saved' ? 'Changes saved' : 'Saving changes'}
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
            ) : (
              renderWorkTabs('history')
            )}
          </div>
        </section>

        {activeView === 'planner' ? (
          <section className="dq-page" aria-labelledby="dq-title">
            <div
              ref={planSplitRef}
              className={`dq-split${isPlanSplitDragging ? ' is-dragging' : ''}`}
              style={{ '--dq-split-left': `${planSplitPercent}%` } as CSSProperties}
            >
              <div className="dq-split-tasks">
                <div className="dq-editor-shell">
              <h1 id="dq-title">Plan Your Day</h1>
              <div
                ref={divideAndConquerEditorRef}
                className="dq-task-editor"
                role="list"
                aria-label="Daily plan tasks"
              >
                {divideAndConquerDraftRows.map((row, index) => (
                  <div key={row.id} className={`dq-task-row${row.text.trim() ? ' has-text' : ''}`} role="listitem">
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
                      ? 'Prioritize'
                      : `Add at least ${MIN_DIVIDE_AND_CONQUER_TASKS_TO_SORT} tasks to sort`
                  }
                >
                  Prioritize
                </button>
              </div>
                </div>
              </div>
              <div
                className="dq-split-divider"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize task and PDF panels"
                aria-valuenow={Math.round(planSplitPercent)}
                aria-valuemin={PLAN_SPLIT_MIN_PERCENT}
                aria-valuemax={PLAN_SPLIT_MAX_PERCENT}
                tabIndex={0}
                onPointerDown={handlePlanSplitPointerDown}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                    event.preventDefault();
                    setPlanSplitPercent((current) =>
                      clampPlanSplitPercent(current + (event.key === 'ArrowLeft' ? -4 : 4)),
                    );
                  }
                }}
              >
                <span className="dq-split-divider-grip" aria-hidden="true" />
              </div>
              <div className="dq-split-pdf">
                <Suspense
                  fallback={
                    <div className="pdf-viewer">
                      <p className="pdf-loading" role="status">
                        Loading PDF…
                      </p>
                    </div>
                  }
                >
                  <PdfViewer src={PLAN_PDF_URL} title={PLAN_PDF_TITLE} />
                </Suspense>
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
                <h1 id="sort-board-title">Prioritize</h1>
                <div className="sort-board-intro-actions">
                  <span className="sort-focus-label" id="sort-focus-label">
                    Focus
                  </span>
                  <p
                    className={`sort-focus-line ${currentFocusTasks.length > 0 ? 'has-focus' : ''} ${
                      draggedTaskId ? 'drop-ready' : ''
                    }`}
                    onDragOver={handleDivideAndConquerDragOver}
                    onDrop={handleCurrentFocusDrop}
                    aria-live="polite"
                    aria-labelledby="sort-focus-label"
                  >
                    {currentFocusTasks.length > 0 ? (
                      currentFocusTasks.map((task) =>
                        editingDivideAndConquerTaskId === task.id ? (
                          <span key={task.id} className="sort-focus-item">
                            <input
                              className="sort-focus-input"
                              value={task.text}
                              aria-label="Edit focus task"
                              autoFocus
                              onChange={(event) => updateDivideAndConquerTaskText(task.id, event.target.value)}
                              onBlur={() => setEditingDivideAndConquerTaskId(null)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === 'Escape') {
                                  event.currentTarget.blur();
                                }
                              }}
                            />
                          </span>
                        ) : (
                          <span
                            key={task.id}
                            className={`sort-focus-item ${draggedTaskId === task.id ? 'dragging' : ''}`}
                            draggable
                            onDragStart={(event) => handleDivideAndConquerDragStart(event, task.id)}
                            onDragEnd={handleDivideAndConquerDragEnd}
                            onDoubleClick={() => setEditingDivideAndConquerTaskId(task.id)}
                          >
                            <button
                              type="button"
                              className="row-done-circle"
                              onClick={() => completeFocusTask(task.id)}
                              onDragStart={(event) => event.preventDefault()}
                              draggable={false}
                              aria-label={`Complete focus task ${task.text}`}
                              title="Mark done"
                            >
                              <Check className="row-done-circle-check" size={13} strokeWidth={2.5} aria-hidden="true" />
                            </button>
                            <span className="sort-focus-text" title={task.text}>
                              {task.text}
                            </span>
                            <span className="sort-focus-actions" aria-label={`Focus actions for ${task.text}`}>
                              <button
                                type="button"
                                className="sort-focus-action-button edit"
                                onClick={() => setEditingDivideAndConquerTaskId(task.id)}
                                onDragStart={(event) => event.preventDefault()}
                                aria-label={`Edit focus task ${task.text}`}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className="sort-focus-action-button clear"
                                onClick={() => clearFocusTask(task.id)}
                                onDragStart={(event) => event.preventDefault()}
                                aria-label={`Clear focus task ${task.text}`}
                              >
                                Remove
                              </button>
                            </span>
                          </span>
                        ),
                      )
                    ) : (
                      <span className="sort-focus-text">Drag a task here.</span>
                    )}
                  </p>
                </div>
              </div>

              <div className="sort-board-layout">
                <div className="sort-tasks-shell">
                  <h2 className="sort-tasks-title">Tasks</h2>
                  <div
                    className="sort-unassigned-list"
                    onDragOver={handleDivideAndConquerDragOver}
                    onDrop={(event) => handleDivideAndConquerDrop(event, 'unassigned')}
                    aria-label="Unassigned tasks"
                  >
                    {divideAndConquerBuckets.unassigned.length > 0 ? (
                      divideAndConquerBuckets.unassigned.map((task, index) =>
                        renderDivideAndConquerTaskCard(task, index)
                      )
                    ) : (
                      <span className="sort-unassigned-empty">All tasks sorted.</span>
                    )}
                  </div>
                </div>

                <div className="sort-matrix-and-completion">
                  <div className="sort-board-toolbar">
                  </div>
                  <div className={`sort-matrix-wrap ${matrixLabelMode === 'eisenhower' ? 'mode-eisenhower' : ''}`}>
                    <div className="sort-matrix-top-labels" aria-hidden="true">
                      {matrixLabelMode === 'eisenhower' ? (
                        <>
                          <span className="sort-column-header sort-outer-label-red">
                            {MATRIX_QUADRANT_LABELS.eisenhower.topLeft}
                          </span>
                          <span className="sort-column-header sort-outer-label-orange">
                            {MATRIX_QUADRANT_LABELS.eisenhower.topRight}
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="sort-column-header">Productive &amp; Unattractive</span>
                          <span className="sort-column-header">Productive &amp; Attractive</span>
                        </>
                      )}
                    </div>
                    <div className="sort-matrix" role="application" aria-label="Daily planning matrix">
                      <div className="sort-matrix-body">
                        <div
                          className={`sort-cell sort-cell-top-left ${draggedTaskId ? 'drop-ready' : ''}`}
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
                          <div className="sort-cell-footer">{matrixLabelMode === 'eisenhower' ? MATRIX_QUADRANT_LABELS.eisenhower.topLeft : MATRIX_QUADRANT_LABELS.attraction.topRight}</div>
                        </div>
                        <div
                          className={`sort-cell sort-cell-top-right ${draggedTaskId ? 'drop-ready' : ''}`}
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
                          <div className="sort-cell-footer">{matrixLabelMode === 'eisenhower' ? MATRIX_QUADRANT_LABELS.eisenhower.topRight : MATRIX_QUADRANT_LABELS.attraction.topLeft}</div>
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
                          <div className="sort-cell-footer">{matrixLabelMode === 'eisenhower' ? MATRIX_QUADRANT_LABELS.eisenhower.bottomLeft : MATRIX_QUADRANT_LABELS.attraction.bottomLeft}</div>
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
                          <div className="sort-cell-footer">{matrixLabelMode === 'eisenhower' ? MATRIX_QUADRANT_LABELS.eisenhower.bottomRight : MATRIX_QUADRANT_LABELS.attraction.bottomRight}</div>
                        </div>
                      </div>
                    </div>
                    <div className="sort-matrix-bottom-labels" aria-hidden="true">
                      {matrixLabelMode === 'eisenhower' ? (
                        <>
                          <span className="sort-column-header sort-outer-label-blue">
                            {MATRIX_QUADRANT_LABELS.eisenhower.bottomLeft}
                          </span>
                          <span className="sort-column-header sort-outer-label-green">
                            {MATRIX_QUADRANT_LABELS.eisenhower.bottomRight}
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="sort-column-header">Unproductive &amp; Unattractive</span>
                          <span className="sort-column-header">Unproductive &amp; Attractive</span>
                        </>
                      )}
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
                        {completedTasks.map((task) => renderDivideAndConquerTaskCard(task))}
                      </div>
                    </section>
                  </div>
                </div>
              </div>
            </div>
          </section>
        ) : activeView === 'routines' ? (
          <section className="routines-page" aria-labelledby="routines-title">
            <div className="routines-shell">
              <header className="routines-heading">
                <span aria-hidden="true" />
                <h1 id="routines-title">Routines</h1>
                <button
                  type="button"
                  className="routine-edit-toggle"
                  onClick={() => setIsEditingRoutines((editing) => !editing)}
                  aria-pressed={isEditingRoutines}
                >
                  {isEditingRoutines ? 'Done' : 'Edit'}
                </button>
              </header>
              <SegmentedControl
                className="segmented-routines"
                ariaLabel="Routine period"
                options={[
                  { value: 'morning', label: 'Morning' },
                  { value: 'evening', label: 'Evening' },
                ]}
                value={routinePeriod}
                onChange={setRoutinePeriod}
              />
              <div className="routine-single" ref={routinesListRef}>
                {renderRoutinePanel(routinePeriod, isEditingRoutines)}
              </div>
            </div>
          </section>
        ) : activeView === 'ideas' ? (
          <section className="ideas-page" aria-labelledby="ideas-title">
            <div className="ideas-shell">
              <header className="ideas-heading">
                <div className="ideas-heading-row">
                  <h1 id="ideas-title">Ideas</h1>
                </div>
              </header>
              <form
                className="idea-add-row"
                onSubmit={(event) => {
                  event.preventDefault();
                  addIdea();
                }}
              >
                <textarea
                  className="idea-input"
                  ref={ideaInputRef}
                  rows={1}
                  value={ideaDraft}
                  onChange={(event) => {
                    setIdeaDraft(event.target.value);
                    autoSizeTextArea(event.target);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      addIdea();
                    }
                  }}
                  placeholder="New idea…"
                  aria-label="New idea"
                />
                <button type="submit" className="idea-add-button" disabled={!ideaDraft.trim()}>
                  Add
                </button>
              </form>
              <div className="idea-list">
                {ideas.length === 0 ? (
                  <p className="idea-empty">Your ideas live here.</p>
                ) : (
                  ideas.map((idea) => (
                    <div key={idea.id} className="idea-item">
                      <div className="idea-meta">
                        <span className="idea-number">
                          {idea.number}
                          <button
                            type="button"
                            className={`idea-place${idea.place ? '' : ' is-empty'}`}
                            onClick={() => openPlacePickerForIdea(idea.id)}
                            title={idea.place ? 'Change place' : 'Add place'}
                          >
                            {idea.place ? `· ${idea.place}` : '· add place'}
                          </button>
                        </span>
                      </div>
                      {editingIdeaId === idea.id ? (
                        <textarea
                          className="idea-edit-input"
                          rows={1}
                          value={ideaEditDraft}
                          ref={(element) => {
                            if (element) {
                              autoSizeTextArea(element);
                            }
                          }}
                          onChange={(event) => {
                            setIdeaEditDraft(event.target.value);
                            autoSizeTextArea(event.target);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' && !event.shiftKey) {
                              event.preventDefault();
                              saveIdeaEdit();
                            } else if (event.key === 'Escape') {
                              cancelIdeaEdit();
                            }
                          }}
                          onBlur={saveIdeaEdit}
                          aria-label="Edit idea"
                          autoFocus
                        />
                      ) : (
                        <button
                          type="button"
                          className="idea-text"
                          onClick={() => startIdeaEdit(idea)}
                          title="Edit idea"
                        >
                          {idea.text}
                        </button>
                      )}
                      <div className="idea-footer">
                        <span className="idea-times">
                          <time dateTime={idea.createdAt}>{formatIdeaTimestamp(idea.createdAt)}</time>
                          {idea.updatedAt ? (
                            <time dateTime={idea.updatedAt}>edited {formatIdeaTimestamp(idea.updatedAt)}</time>
                          ) : null}
                        </span>
                        <button
                          type="button"
                          className="idea-delete"
                          onClick={() => deleteIdea(idea.id)}
                          aria-label="Delete idea"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        ) : activeView === 'history' ? (
          <section className="history-page" aria-labelledby="history-title">
            <div className="history-shell">
              <h1 id="history-title">History</h1>
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
                      'Nothing completed.',
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
                  No history yet. Completed and unfinished tasks appear here each day.
                </div>
              ) : null}
            </div>
          </section>
        ) : (
        <section ref={sheetWrapperRef} className="sheet-wrapper">
            <div
              className="checklist-sheet-viewport"
            >
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
                {Array.from({ length: visibleColumnCount }, (_, index) => (
                  <col key={index} className="checklist-day-column" />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th className="section-spacer" />
                  <th className="label-header">
                    <div className="sana-header">
                      <span>Sana:</span>
                      <MonthPicker
                        year={activeSheet.selectedYear}
                        month={activeSheet.selectedMonth}
                        currentYear={new Date().getFullYear()}
                        currentMonth={new Date().getMonth()}
                        onChange={(year, month) =>
                          handleMonthChange(formatMonthValue(year, month))
                        }
                      />
                    </div>
                  </th>
                  {Array.from({ length: visibleColumnCount }, (_, index) => (
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
                    columnCount={visibleColumnCount}
                    onAddRow={(label) =>
                      updateSectionRows(section.id, (rows) => [...rows, { ...createRow(rows.length), label }])
                    }
                    onDeleteRow={(rowId) => {
                      setConfirmState({
                        title: 'Delete row',
                        message: 'This will remove the row.',
                        confirmLabel: 'Delete',
                        onConfirm: () => {
                          updateSectionRows(section.id, (rows) =>
                            rows
                              .filter((row) => row.id !== rowId)
                              .map((row, order) => ({ ...row, order })),
                          );
                          track('checklist_row_deleted', { section_id: section.id });
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
            </div>
          <div ref={checklistDockRef} className="checklist-bottom-dock">
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
              title={isChecklistFullscreen ? 'Exit fullscreen — F' : 'Fullscreen checklist — F'}
            >
              F
            </button>
          </div>
        </section>
        )}
      </main>

      {placePicker ? (
        <div className="confirm-backdrop" role="presentation" onClick={dismissPlacePicker}>
          <div
            className="confirm-dialog place-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="place-picker-title"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                dismissPlacePicker();
              }
            }}
          >
            <button
              type="button"
              className="dialog-close-button"
              onClick={dismissPlacePicker}
              aria-label="Close dialog"
            >
              ✕
            </button>
            <div className="place-dialog-header">
              <h2 id="place-picker-title">Choose a Place</h2>
            </div>
            {ideaPlaces.length === 0 ? (
              <p className="place-empty">Add a place — it'll be here next time.</p>
            ) : (
              <div className="place-list">
                {ideaPlaces.map((place, index) =>
                  isEditingPlaces ? (
                    <div key={`${place}-${index}`} className="place-edit-row">
                      <input
                        type="text"
                        className="place-edit-input"
                        defaultValue={place}
                        aria-label={`Rename ${place}`}
                        onBlur={(event) => {
                          renamePlace(index, event.target.value);
                          setIsEditingPlaces(false);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.currentTarget.blur();
                          }
                          if (event.key === 'Escape') {
                            setIsEditingPlaces(false);
                          }
                        }}
                        autoFocus
                      />
                      <button
                        type="button"
                        className="place-delete"
                        onClick={() => deletePlace(index)}
                        aria-label={`Delete ${place}`}
                      >
                        ×
                      </button>
                    </div>
                  ) : (
                    <div key={`${place}-${index}`} className="place-option-row">
                      <button
                        type="button"
                        className="place-option"
                        onClick={() => choosePlace(place)}
                      >
                        {place}
                      </button>
                      <button
                        type="button"
                        className="place-edit-button"
                        onClick={() => setIsEditingPlaces(true)}
                        aria-label={`Edit ${place}`}
                      >
                        Edit
                      </button>
                    </div>
                  ),
                )}
              </div>
            )}
            <form
              className="place-add-row"
              onSubmit={(event) => {
                event.preventDefault();
                addPlace();
              }}
            >
              <input
                type="text"
                className="place-add-input"
                value={newPlaceDraft}
                onChange={(event) => setNewPlaceDraft(event.target.value)}
                placeholder="Add a place…"
                aria-label="New place"
                autoFocus={ideaPlaces.length === 0}
              />
              <button type="submit" className="idea-add-button" disabled={!newPlaceDraft.trim()}>
                Add
              </button>
            </form>
            {placePicker.mode === 'new' ? (
              <div className="confirm-actions">
                <button type="button" className="plain-button" onClick={() => dismissPlacePicker()}>
                  Skip
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
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
            <button
              type="button"
              className="dialog-close-button"
              onClick={closeConfirm}
              aria-label="Close dialog"
            >
              ✕
            </button>
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
  columnCount: number;
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
  columnCount,
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
    track('checklist_row_marked', { mark: 'plus', section_id: section.id });
  };

  const handleMarkUndone = (rowId: string, columnIndex: number) => {
    onMarkUndone(rowId, columnIndex);
    setOpenMenuCell(null);
    track('checklist_row_marked', { mark: 'minus', section_id: section.id });
  };

  const handleClearMark = (rowId: string, columnIndex: number) => {
    onClearMark(rowId, columnIndex);
    setOpenMenuCell(null);
    track('checklist_mark_cleared', { section_id: section.id });
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
    track('checklist_row_added', { section_id: section.id });
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

          {Array.from({ length: columnCount }, (_, columnIndex) => {
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
                        columnIndex >= columnCount - 2 ? 'cell-mark-menu-left' : ''
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
        {Array.from({ length: columnCount }, (_, index) => (
          <td key={index} className="add-row-filler" />
        ))}
      </tr>
    </>
  );
};

export default App;
