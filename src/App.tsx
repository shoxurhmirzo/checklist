import { ChangeEvent, MouseEvent, useEffect, useRef, useState } from 'react';
import {
  COLUMN_COUNT,
  createRow,
  createSheet,
  formatMonthValue,
  generateColumnLabelsForMonth,
  parseMonthValue,
} from './defaults';
import { createBackupPayload, isValidBackupPayload, loadSheets, normalizeSheets, saveSheets } from './storage';
import type { ChecklistSection, ChecklistSheet, SectionId } from './types';

const A4_LANDSCAPE_RATIO = 297 / 210;

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

const App = () => {
  const [sheets, setSheets] = useState<ChecklistSheet[]>([]);
  const [activeSheetId, setActiveSheetId] = useState<string>('');
  const [isLoaded, setIsLoaded] = useState(false);
  const [status, setStatus] = useState('Loading checklist...');
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const workspaceRef = useRef<HTMLElement | null>(null);
  const sheetWrapperRef = useRef<HTMLElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const [sheetScale, setSheetScale] = useState(1);
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  useEffect(() => {
    let cancelled = false;

    void loadSheets()
      .then((storedSheets) => {
        if (cancelled) {
          return;
        }

        setSheets(storedSheets);
        setActiveSheetId(storedSheets[0]?.id ?? '');
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

    void saveSheets(sheets)
      .then(() => setStatus('All changes saved locally'))
      .catch(() => setStatus('Save failed. Export a backup after your next successful save.'));
  }, [isLoaded, sheets]);

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
  }, [activeSheetId, sheets]);

  const activeSheet = sheets.find((sheet) => sheet.id === activeSheetId) ?? sheets[0] ?? null;

  useEffect(() => {
    if (activeSheet || sheets.length === 0) {
      return;
    }

    setActiveSheetId(sheets[0].id);
  }, [activeSheet, sheets]);

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
    const payload = createBackupPayload(sheets);
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

  if (!activeSheet) {
    return <div className="app-shell">Loading...</div>;
  }

  return (
    <div className="app-shell">
      <main ref={workspaceRef} className="workspace">
        <section className="top-controls">
          <div className="controls-row">
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
            <button type="button" onClick={handleCreateSheet}>
              New sheet
            </button>
            <button type="button" onClick={() => handleDeleteSheet(activeSheet.id)}>
              Delete sheet
            </button>
            <button type="button" onClick={handleExport}>
              Export
            </button>
            <button type="button" onClick={handleImportClick}>
              Import
            </button>
            <input ref={importInputRef} hidden type="file" accept="application/json" onChange={handleImport} />
            <span className="status-text">{status}</span>
          </div>
        </section>

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
                    onAddRow={() =>
                      updateSectionRows(section.id, (rows) => [...rows, createRow(rows.length)])
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
                                  [columnIndex]: true,
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
                                  [columnIndex]: 'undone',
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
  onAddRow: () => void;
  onDeleteRow: (rowId: string) => void;
  onRenameRow: (rowId: string, label: string) => void;
  onMarkDone: (rowId: string, columnIndex: number) => void;
  onMarkUndone: (rowId: string, columnIndex: number) => void;
  onClearMark: (rowId: string, columnIndex: number) => void;
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
  const handleCellTap = (event: MouseEvent<HTMLButtonElement>, rowId: string, columnIndex: number) => {
    if (event.detail >= 3) {
      onClearMark(rowId, columnIndex);
      return;
    }

    if (event.detail === 2) {
      onMarkUndone(rowId, columnIndex);
      return;
    }

    onMarkDone(rowId, columnIndex);
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
              />
              <button type="button" className="row-delete-button" onClick={() => onDeleteRow(row.id)} aria-label="Delete row">
                ×
              </button>
            </div>
          </td>

          {Array.from({ length: COLUMN_COUNT }, (_, columnIndex) => {
            const checkState = row.checksByColumn[columnIndex];
            const isDone = checkState === true;
            const isUndone = checkState === 'undone';

            return (
              <td key={columnIndex} className="checkbox-cell">
                <button
                  type="button"
                  className={`check-toggle ${isDone ? 'checked' : ''} ${isUndone ? 'undone' : ''}`}
                  onClick={(event) => handleCellTap(event, row.id, columnIndex)}
                  aria-label={`${section.title} ${row.label || 'item'} day ${columnIndex + 1}`}
                  aria-pressed={isDone}
                >
                  {isDone ? '+' : isUndone ? '-' : ''}
                </button>
              </td>
            );
          })}
        </tr>
      ))}

      <tr className="add-row-tr">
        <td className="section-spacer" />
        <td className="add-row-cell">
          <button type="button" className="plain-button" onClick={onAddRow}>
            + Row
          </button>
        </td>
        {Array.from({ length: COLUMN_COUNT }, (_, index) => (
          <td key={index} className="add-row-filler" />
        ))}
      </tr>
    </>
  );
};

export default App;
