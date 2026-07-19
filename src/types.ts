export type SectionId = 'indikatorlar' | 'amaliyotlar';
export type CheckMark = 'plus' | 'minus';
export type DivideAndConquerBucket =
  | 'unassigned'
  | 'productive-attractive'
  | 'productive-unattractive'
  | 'unproductive-attractive'
  | 'unproductive-unattractive'
  | 'completed';

export interface CheckState {
  mark: CheckMark;
  loggedAt?: string;
}

export interface ChecklistRow {
  id: string;
  label: string;
  order: number;
  checksByColumn: Record<number, CheckState>;
}

export interface ChecklistSection {
  id: SectionId;
  title: string;
  rows: ChecklistRow[];
}

export interface ChecklistSheet {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  selectedYear: number;
  selectedMonth: number;
  columnLabels: string[];
  sections: ChecklistSection[];
}

export interface DivideAndConquerTask {
  id: string;
  text: string;
  bucket: DivideAndConquerBucket;
}

export interface DailyHistoryEntry {
  id: string;
  text: string;
}

export interface DailyHistoryRecord {
  date: string;
  completed: DailyHistoryEntry[];
  undone: DailyHistoryEntry[];
}

export interface SleepLogRecord {
  date: string;
  bedtime: string;
  wakeTime: string;
}

export interface IdeaRecord {
  id: string;
  number: number;
  text: string;
  place?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface AppState {
  sheets: ChecklistSheet[];
  divideAndConquerText: string;
  divideAndConquerItems: DivideAndConquerTask[];
  currentFocusTaskIds: string[];
  dailyHistory: DailyHistoryRecord[];
  sleepLogRecords: SleepLogRecord[];
  ideas: IdeaRecord[];
  ideaPlaces: string[];
  lastRolloverDate: string | null;
}

export interface BackupPayload {
  version: number;
  exportedAt: string;
  sheets: ChecklistSheet[];
  divideAndConquerText?: string;
  divideAndConquerItems?: DivideAndConquerTask[];
  /** Single-focus field written by backups up to version 8. */
  currentFocusTaskId?: string | null;
  currentFocusTaskIds?: string[];
  dailyHistory?: DailyHistoryRecord[];
  sleepLogRecords?: SleepLogRecord[];
  ideas?: IdeaRecord[];
  ideaPlaces?: string[];
  lastRolloverDate?: string | null;
}
