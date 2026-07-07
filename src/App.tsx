import {
  ChangeEvent,
  KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
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
  normalizeSheets,
  saveAppState,
} from './storage';
import type {
  CheckState,
  ChecklistSection,
  ChecklistSheet,
  DivideAndConquerBucket,
  DivideAndConquerTask,
  SectionId,
} from './types';

const A4_LANDSCAPE_RATIO = 297 / 210;
const DIVIDE_AND_CONQUER_PROTECTED_LENGTH = DEFAULT_DIVIDE_AND_CONQUER_TEXT.length;
const DIVIDE_AND_CONQUER_ROW_SUFFIX = DEFAULT_DIVIDE_AND_CONQUER_TEXT.slice(2);
const COMPLETED_MAGNETIC_DISTANCE = 60;
const MIN_DIVIDE_AND_CONQUER_TASKS_TO_SORT = 5;

type AppView = 'checklist' | 'divideAndConquer' | 'sortBoard';

const DIVIDE_AND_CONQUER_SORT_BUCKETS: Array<{
  id: Exclude<DivideAndConquerBucket, 'unassigned'>;
  title: string;
  subtitle: string;
  emphasis: string;
}> = [
  {
    id: 'productive-attractive',
    title: 'Do now',
    subtitle: 'Productive + Attractive',
    emphasis: 'Important and enjoyable work',
  },
  {
    id: 'productive-unattractive',
    title: 'Must do',
    subtitle: 'Productive + Unattractive',
    emphasis: 'Important but not enjoyable work',
  },
  {
    id: 'unproductive-attractive',
    title: 'Enjoy',
    subtitle: 'Unproductive + Attractive',
    emphasis: 'Nice, but not urgent',
  },
  {
    id: 'unproductive-unattractive',
    title: 'Eliminate',
    subtitle: 'Unproductive + Unattractive',
    emphasis: 'Low value distractions',
  },
];

interface ConfirmState {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
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

const normalizeDivideAndConquerText = (value: string) => {
  const text = value.trimStart();

  if (!text) {
    return DEFAULT_DIVIDE_AND_CONQUER_TEXT;
  }

  if (text.startsWith(DEFAULT_DIVIDE_AND_CONQUER_TEXT)) {
    return text;
  }

  if (text.startsWith('1.')) {
    return `${DEFAULT_DIVIDE_AND_CONQUER_TEXT}${text.slice(2).trimStart()}`;
  }

  if (text.startsWith('1')) {
    return `${DEFAULT_DIVIDE_AND_CONQUER_TEXT}${text.slice(1).replace(/^[.\s]*/, '')}`;
  }

  return `${DEFAULT_DIVIDE_AND_CONQUER_TEXT}${text}`;
};

const buildDivideAndConquerLine = (lineNumber: number, content: string) =>
  `${lineNumber}.${DIVIDE_AND_CONQUER_ROW_SUFFIX}${content}`;

const renumberDivideAndConquerText = (value: string) => {
  const lines = value.split('\n');

  if (lines.length === 0) {
    return DEFAULT_DIVIDE_AND_CONQUER_TEXT;
  }

  return lines
    .map((line, index) => buildDivideAndConquerLine(index + 1, line.replace(/^\s*\d+\.\s*/, '')))
    .join('\n');
};

const makeDivideAndConquerTaskId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const getDivideAndConquerTaskTexts = (value: string) =>
  value
    .split('\n')
    .map((line) => line.replace(/^\s*\d+\.\s*/, '').trim())
    .filter((line) => line.length > 0);

const parseDivideAndConquerTasks = (value: string): DivideAndConquerTask[] =>
  getDivideAndConquerTaskTexts(value).map((text) => ({
    id: makeDivideAndConquerTaskId(),
    text,
    bucket: 'unassigned' as const,
  }));

const formatDivideAndConquerTasksText = (tasks: DivideAndConquerTask[]) =>
  tasks.map((task, index) => buildDivideAndConquerLine(index + 1, task.text)).join('\n');

const App = () => {
  const [sheets, setSheets] = useState<ChecklistSheet[]>([]);
  const [activeSheetId, setActiveSheetId] = useState<string>('');
  const [activeView, setActiveView] = useState<AppView>('checklist');
  const [divideAndConquerText, setDivideAndConquerText] = useState(DEFAULT_DIVIDE_AND_CONQUER_TEXT);
  const [divideAndConquerItems, setDivideAndConquerItems] = useState<DivideAndConquerTask[]>(
    DEFAULT_DIVIDE_AND_CONQUER_ITEMS,
  );
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [editingDivideAndConquerTaskId, setEditingDivideAndConquerTaskId] = useState<string | null>(null);
  const [isCompletedMagnetic, setIsCompletedMagnetic] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [status, setStatus] = useState('Loading checklist...');
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const workspaceRef = useRef<HTMLElement | null>(null);
  const sheetWrapperRef = useRef<HTMLElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const divideAndConquerRef = useRef<HTMLTextAreaElement | null>(null);
  const completedZoneRef = useRef<HTMLElement | null>(null);
  const [sheetScale, setSheetScale] = useState(1);
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  const resizeDivideAndConquerEditor = () => {
    const editor = divideAndConquerRef.current;

    if (!editor) {
      return;
    }

    editor.style.height = 'auto';
    editor.style.height = `${editor.scrollHeight}px`;
  };

  useEffect(() => {
    let cancelled = false;

    void loadAppState()
      .then((storedState) => {
        if (cancelled) {
          return;
        }

        setSheets(storedState.sheets);
        setActiveSheetId(storedState.sheets[0]?.id ?? '');
        setDivideAndConquerText(normalizeDivideAndConquerText(storedState.divideAndConquerText));
        setDivideAndConquerItems(storedState.divideAndConquerItems);
        setStatus('Checklist loaded');
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        const fallback = [createSheet('Checklist 1')];
        setSheets(fallback);
        setActiveSheetId(fallback[0].id);
        setStatus('Started with a fresh checklist');
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoaded(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isLoaded) {
      return;
    }

    void saveAppState({ sheets, divideAndConquerText, divideAndConquerItems })
      .then(() => setStatus('All changes saved locally'))
      .catch(() => setStatus('Save failed. Export a backup after your next successful save.'));
  }, [divideAndConquerItems, divideAndConquerText, isLoaded, sheets]);

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
      const availableHeight = window.innerHeight - (wrapperTop - workspaceTop) - 12;

      if (availableWidth === 0 || naturalWidth === 0 || naturalHeight === 0 || availableHeight <= 0) {
        return;
      }

      const widthLimitedWidth = availableWidth;
      const widthLimitedHeight = widthLimitedWidth / A4_LANDSCAPE_RATIO;
      const heightLimitedHeight = availableHeight;
      const heightLimitedWidth = heightLimitedHeight * A4_LANDSCAPE_RATIO;
      const nextFrameWidth = widthLimitedHeight > availableHeight ? heightLimitedWidth : widthLimitedWidth;
      const nextFrameHeight = widthLimitedHeight > availableHeight ? heightLimitedHeight : widthLimitedHeight;
      const nextScale = Math.min(nextFrameWidth / naturalWidth, nextFrameHeight / naturalHeight);

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

  const divideAndConquerBuckets = {
    unassigned: divideAndConquerItems.filter((item) => item.bucket === 'unassigned'),
    'productive-attractive': divideAndConquerItems.filter((item) => item.bucket === 'productive-attractive'),
    'productive-unattractive': divideAndConquerItems.filter((item) => item.bucket === 'productive-unattractive'),
    'unproductive-attractive': divideAndConquerItems.filter((item) => item.bucket === 'unproductive-attractive'),
    'unproductive-unattractive': divideAndConquerItems.filter(
      (item) => item.bucket === 'unproductive-unattractive',
    ),
    completed: divideAndConquerItems.filter((item) => item.bucket === 'completed'),
  } as const;
  const completedTasks = divideAndConquerBuckets.completed;
  const divideAndConquerTaskCount = getDivideAndConquerTaskTexts(divideAndConquerText).length;
  const canSortDivideAndConquerTasks = divideAndConquerTaskCount >= MIN_DIVIDE_AND_CONQUER_TASKS_TO_SORT;

  const updateDivideAndConquerTaskText = (taskId: string, text: string) => {
    const nextItems = divideAndConquerItems.map((item) => (item.id === taskId ? { ...item, text } : item));
    setDivideAndConquerItems(nextItems);
    setDivideAndConquerText(formatDivideAndConquerTasksText(nextItems));
  };

  const deleteDivideAndConquerTask = (taskId: string) => {
    const nextItems = divideAndConquerItems.filter((item) => item.id !== taskId);
    setDivideAndConquerItems(nextItems);
    setDivideAndConquerText(formatDivideAndConquerTasksText(nextItems));

    if (editingDivideAndConquerTaskId === taskId) {
      setEditingDivideAndConquerTaskId(null);
    }
  };

  const renderDivideAndConquerTaskCard = (task: DivideAndConquerTask) => {
    const isSourceTaskPlaceholder = task.bucket === 'unassigned' && draggedTaskId === task.id;
    const isEditing = editingDivideAndConquerTaskId === task.id && !isSourceTaskPlaceholder;

    return (
      <div
        key={task.id}
        role="group"
        className={`sort-task-card ${task.bucket === 'completed' ? 'completed' : ''} ${
          draggedTaskId === task.id ? 'dragging' : ''
        } ${isSourceTaskPlaceholder ? 'source-placeholder' : ''}`}
        draggable={!isEditing}
        onDragStart={(event) => handleDivideAndConquerDragStart(event, task.id)}
        onDragEnd={handleDivideAndConquerDragEnd}
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
              >
                edit
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
              >
                delete
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
    if (activeView !== 'divideAndConquer') {
      return;
    }

    const normalizedText = normalizeDivideAndConquerText(divideAndConquerText);

    if (normalizedText !== divideAndConquerText) {
      setDivideAndConquerText(normalizedText);
    }

    requestAnimationFrame(() => {
      const editor = divideAndConquerRef.current;

      if (!editor) {
        return;
      }

      const cursorPosition = Math.max(DIVIDE_AND_CONQUER_PROTECTED_LENGTH, editor.value.length);
      editor.focus();
      editor.setSelectionRange(cursorPosition, cursorPosition);
    });
  }, [activeView]);

  useLayoutEffect(() => {
    if (activeView !== 'divideAndConquer') {
      return;
    }

    resizeDivideAndConquerEditor();
  }, [activeView, divideAndConquerText]);

  useEffect(() => {
    if (activeView !== 'divideAndConquer') {
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

        if (activeSheetId === sheetId) {
          const remaining = sheets.find((sheet) => sheet.id !== sheetId);
          if (remaining) {
            setActiveSheetId(remaining.id);
          }
        }

        setStatus('Sheet deleted');
      },
    });
  };

  const handleExport = () => {
    const payload = createBackupPayload({ sheets, divideAndConquerText, divideAndConquerItems });
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

      const normalizedSheets = normalizeSheets(parsed.sheets);
      setSheets(normalizedSheets);
      setActiveSheetId(normalizedSheets[0]?.id ?? '');
      if (typeof parsed.divideAndConquerText === 'string') {
        setDivideAndConquerText(normalizeDivideAndConquerText(parsed.divideAndConquerText));
      }
      if (Array.isArray((parsed as { divideAndConquerItems?: unknown }).divideAndConquerItems)) {
        setDivideAndConquerItems(
          (parsed as { divideAndConquerItems?: DivideAndConquerTask[] }).divideAndConquerItems ?? [],
        );
      }
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

  const handleDivideAndConquerChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const editor = event.currentTarget;
    const rawValue = editor.value;
    const normalizedValue = normalizeDivideAndConquerText(rawValue);
    const cursorShift = normalizedValue.length - rawValue.length;
    const nextCursorPosition = Math.max(
      DIVIDE_AND_CONQUER_PROTECTED_LENGTH,
      editor.selectionStart + cursorShift,
    );

    setDivideAndConquerText(normalizedValue);

    if (normalizedValue !== rawValue || editor.selectionStart < DIVIDE_AND_CONQUER_PROTECTED_LENGTH) {
      requestAnimationFrame(() => {
        divideAndConquerRef.current?.setSelectionRange(nextCursorPosition, nextCursorPosition);
      });
    }
  };

  const keepDivideAndConquerCursorPastPrefix = () => {
    const editor = divideAndConquerRef.current;

    if (!editor || editor.selectionStart >= DIVIDE_AND_CONQUER_PROTECTED_LENGTH) {
      return;
    }

    editor.setSelectionRange(
      DIVIDE_AND_CONQUER_PROTECTED_LENGTH,
      Math.max(editor.selectionEnd, DIVIDE_AND_CONQUER_PROTECTED_LENGTH),
    );
  };

  const handleDivideAndConquerKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    const { selectionStart, selectionEnd, value } = event.currentTarget;
    const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
    const lineEnd = value.indexOf('\n', lineStart);
    const currentLine = value.slice(lineStart, lineEnd === -1 ? value.length : lineEnd);
    const lineMatch = currentLine.match(/^(\s*)(\d+)\.\s*/);
    const linePrefixLength = lineMatch?.[0].length ?? 0;
    const lineNumber = lineMatch ? Number(lineMatch[2]) : 1;
    const selectionTouchesPrefix = selectionStart < DIVIDE_AND_CONQUER_PROTECTED_LENGTH;

    if (
      event.key === 'Backspace' &&
      selectionStart === selectionEnd &&
      lineNumber > 1 &&
      selectionStart <= lineStart + linePrefixLength
    ) {
      event.preventDefault();

      const lines = value.split('\n');
      const currentLineIndex = value.slice(0, lineStart).split('\n').length - 1;
      lines.splice(currentLineIndex, 1);

      const nextValue = lines.length > 0 ? renumberDivideAndConquerText(lines.join('\n')) : DEFAULT_DIVIDE_AND_CONQUER_TEXT;
      const nextCursorPosition = Math.max(DIVIDE_AND_CONQUER_PROTECTED_LENGTH, lineStart - 1);

      setDivideAndConquerText(nextValue);

      requestAnimationFrame(() => {
        divideAndConquerRef.current?.setSelectionRange(nextCursorPosition, nextCursorPosition);
      });

      return;
    }

    if (
      (event.key === 'Backspace' &&
        (selectionStart <= DIVIDE_AND_CONQUER_PROTECTED_LENGTH || selectionTouchesPrefix)) ||
      (event.key === 'Delete' && selectionTouchesPrefix)
    ) {
      event.preventDefault();
      keepDivideAndConquerCursorPastPrefix();
      return;
    }

    if (event.key !== 'Enter' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }

    if (!lineMatch) {
      return;
    }

    event.preventDefault();

    const [, indentation, currentNumber] = lineMatch;
    const nextLine = `\n${indentation}${Number(currentNumber) + 1}.        `;
    const nextValue = `${value.slice(0, selectionStart)}${nextLine}${value.slice(selectionEnd)}`;
    const nextCursorPosition = selectionStart + nextLine.length;

    setDivideAndConquerText(nextValue);

    requestAnimationFrame(() => {
      divideAndConquerRef.current?.setSelectionRange(nextCursorPosition, nextCursorPosition);
    });
  };

  const handleStartSorting = () => {
    const tasks = parseDivideAndConquerTasks(divideAndConquerText);

    if (tasks.length < MIN_DIVIDE_AND_CONQUER_TASKS_TO_SORT) {
      setStatus(`Add at least ${MIN_DIVIDE_AND_CONQUER_TASKS_TO_SORT} tasks before sorting`);
      return;
    }

    setDivideAndConquerItems(tasks);
    setActiveView('sortBoard');
    setStatus('Tasks ready to sort');
  };

  const moveDivideAndConquerTask = (taskId: string, bucket: DivideAndConquerBucket) => {
    setDivideAndConquerItems((currentItems) =>
      currentItems.map((item) => (item.id === taskId ? { ...item, bucket } : item)),
    );
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
    setIsCompletedMagnetic(false);
  };

  const handleDivideAndConquerDrop = (event: React.DragEvent<HTMLElement>, bucket: DivideAndConquerBucket) => {
    event.preventDefault();
    const taskId = event.dataTransfer.getData('text/plain') || draggedTaskId;

    if (!taskId) {
      return;
    }

    moveDivideAndConquerTask(taskId, bucket);
    setDraggedTaskId(null);
    setIsCompletedMagnetic(false);

    if (bucket === 'completed') {
      setStatus('Task completed');
    }
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
    return <div className="app-shell">Loading...</div>;
  }

  return (
    <div className="app-shell">
      <main ref={workspaceRef} className="workspace">
        <section className="top-controls">
          <div className="controls-row">
            {activeView === 'checklist' ? (
              <>
                <label className="inline-field">
                  <span>Sheet</span>
                  <select value={activeSheetId} onChange={(event) => setActiveSheetId(event.target.value)}>
                    {sheets.map((sheet) => (
                      <option key={sheet.id} value={sheet.id}>
                        {sheet.name || 'Untitled sheet'}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="inline-field sheet-name-field">
                  <span>Name</span>
                  <input
                    type="text"
                    value={activeSheet.name}
                    onChange={(event) =>
                      updateActiveSheet((sheet) => ({
                        ...sheet,
                        name: event.target.value,
                      }))
                    }
                  />
                </label>
                <button type="button" className="new-sheet-button" onClick={handleCreateSheet}>
                  New sheet
                </button>
                <button type="button" className="delete-sheet-button" onClick={() => handleDeleteSheet(activeSheet.id)}>
                  Delete sheet
                </button>
                <button type="button" className="nav-link-button" onClick={() => setActiveView('divideAndConquer')}>
                  D&amp;Q
                </button>
                <button type="button" className="export-button" onClick={handleExport}>
                  Export
                </button>
                <button type="button" className="import-button" onClick={handleImportClick}>
                  Import
                </button>
                <input ref={importInputRef} hidden type="file" accept="application/json" onChange={handleImport} />
                <span
                  className="mark-totals"
                  aria-label={`Plus total ${markTotals.plus}, minus total ${markTotals.minus}`}
                >
                  <span className="mark-total plus-total">+ {markTotals.plus}</span>
                  <span className="mark-total minus-total">- {markTotals.minus}</span>
                </span>
                <span className="status-text">{status}</span>
              </>
            ) : activeView === 'divideAndConquer' ? (
              <button type="button" className="nav-text-link" onClick={() => setActiveView('checklist')}>
                Checklist
              </button>
            ) : (
              <>
                <button type="button" className="nav-link-button" onClick={() => setActiveView('divideAndConquer')}>
                  Back to tasks
                </button>
                <button type="button" className="nav-link-button" onClick={() => setActiveView('checklist')}>
                  Checklist
                </button>
              </>
            )}
          </div>
        </section>

        {activeView === 'divideAndConquer' ? (
          <section className="dq-page" aria-labelledby="dq-title">
            <div className="dq-editor-shell">
              <h1 id="dq-title">Dump your tasks</h1>
              <textarea
                ref={divideAndConquerRef}
                className="dq-task-editor"
                rows={1}
                value={divideAndConquerText}
                onChange={handleDivideAndConquerChange}
                onKeyDown={handleDivideAndConquerKeyDown}
                onSelect={keepDivideAndConquerCursorPastPrefix}
                aria-label="D&Q tasks"
                spellCheck
              />
              <div className="dq-editor-actions">
                <button
                  type="button"
                  className="sort-out-button"
                  onClick={handleStartSorting}
                  disabled={!canSortDivideAndConquerTasks}
                  title={
                    canSortDivideAndConquerTasks
                      ? 'Sort tasks'
                      : `Add at least ${MIN_DIVIDE_AND_CONQUER_TASKS_TO_SORT} tasks to sort`
                  }
                >
                  Sort them out
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
                <h1 id="sort-board-title">Sort them out</h1>
                <p>Drag each task into the box that fits it best.</p>
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
                  <div className="sort-matrix-wrap">
                    <div className="sort-matrix-top-labels" aria-hidden="true">
                      <span className="sort-column-header">Unattractive</span>
                      <span className="sort-column-header">Attractive</span>
                    </div>
                    <div className="sort-axis-labels" aria-hidden="true">
                      <span className="sort-axis-label">Productive</span>
                      <span className="sort-axis-label">Unproductive</span>
                    </div>
                    <div className="sort-matrix" role="application" aria-label="Divide and conquer matrix">
                      <div className="sort-matrix-body">
                        <div
                          className={`sort-cell sort-cell-top-left ${draggedTaskId ? 'drop-ready' : ''}`}
                          onDragOver={handleDivideAndConquerDragOver}
                          onDrop={(event) => handleDivideAndConquerDrop(event, 'productive-attractive')}
                        >
                          <div className="sort-cell-items">
                            {renderDivideAndConquerQuadrantItems(divideAndConquerBuckets['productive-attractive'])}
                          </div>
                          <div className="sort-cell-footer">(Must To-Do)</div>
                        </div>
                        <div
                          className={`sort-cell sort-cell-top-right ${draggedTaskId ? 'drop-ready' : ''}`}
                          onDragOver={handleDivideAndConquerDragOver}
                          onDrop={(event) => handleDivideAndConquerDrop(event, 'productive-unattractive')}
                        >
                          <div className="sort-cell-items">
                            {renderDivideAndConquerQuadrantItems(divideAndConquerBuckets['productive-unattractive'])}
                          </div>
                          <div className="sort-cell-footer">(Enjoy)</div>
                        </div>
                        <div
                          className={`sort-cell sort-cell-bottom-left ${draggedTaskId ? 'drop-ready' : ''}`}
                          onDragOver={handleDivideAndConquerDragOver}
                          onDrop={(event) => handleDivideAndConquerDrop(event, 'unproductive-attractive')}
                        >
                          <div className="sort-cell-items">
                            {renderDivideAndConquerQuadrantItems(divideAndConquerBuckets['unproductive-attractive'])}
                          </div>
                          <div className="sort-cell-footer">(Avoid)</div>
                        </div>
                        <div
                          className={`sort-cell sort-cell-bottom-right ${draggedTaskId ? 'drop-ready' : ''}`}
                          onDragOver={handleDivideAndConquerDragOver}
                          onDrop={(event) => handleDivideAndConquerDrop(event, 'unproductive-unattractive')}
                        >
                          <div className="sort-cell-items">
                            {renderDivideAndConquerQuadrantItems(divideAndConquerBuckets['unproductive-unattractive'])}
                          </div>
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
                      <div className="sort-completion-title">Completed</div>
                      <div className="sort-completion-list">
                        {completedTasks.map(renderDivideAndConquerTaskCard)}
                      </div>
                    </section>
                  </div>
                </div>
              </div>
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
            <table>
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
          >
            <h2 id="confirm-title">{confirmState.title}</h2>
            <p>{confirmState.message}</p>
            <div className="confirm-actions">
              <button type="button" className="plain-button" onClick={closeConfirm}>
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
                    {isDone ? '+' : isUndone ? '-' : ''}
                  </button>
                  {isMenuOpen ? (
                    <div className="cell-mark-menu" role="menu" aria-label="Cell mark options">
                      <button
                        type="button"
                        className="cell-mark-option plus-option"
                        role="menuitem"
                        onClick={() => handleMarkDone(row.id, columnIndex)}
                        aria-label="Mark plus"
                      >
                        +
                      </button>
                      <button
                        type="button"
                        className="cell-mark-option minus-option"
                        role="menuitem"
                        onClick={() => handleMarkUndone(row.id, columnIndex)}
                        aria-label="Mark minus"
                      >
                        -
                      </button>
                      <button
                        type="button"
                        className="cell-mark-option clear-option"
                        role="menuitem"
                        onClick={() => handleClearMark(row.id, columnIndex)}
                        aria-label="Clear mark"
                      >
                        ×
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
            <button type="button" className="plain-button" onClick={saveNewRow} aria-label={`Save ${section.title} row`}>
              +
            </button>
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
