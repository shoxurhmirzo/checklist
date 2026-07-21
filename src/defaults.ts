import type { ChecklistRow, ChecklistSection, ChecklistSheet, SectionId } from './types';

export const COLUMN_COUNT = 31;

const SECTION_TITLES: Record<SectionId, string> = {
  indikatorlar: 'Indikatorlar',
  amaliyotlar: 'Amaliyotlar',
};

const DEFAULT_ROWS: Record<SectionId, number> = {
  indikatorlar: 10,
  amaliyotlar: 11,
};

const makeId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const formatMonthValue = (year: number, month: number) =>
  `${year}-${String(month + 1).padStart(2, '0')}`;

export const parseMonthValue = (value: string) => {
  const [year, month] = value.split('-').map(Number);

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }

  return { year, month: month - 1 };
};

export const generateColumnLabelsForMonth = (year: number, month: number) => {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
  });
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  return Array.from({ length: COLUMN_COUNT }, (_, index) =>
    index < daysInMonth ? formatter.format(new Date(year, month, index + 1)) : '',
  );
};

export const createRow = (order: number): ChecklistRow => ({
  id: makeId(),
  label: '',
  order,
  checksByColumn: {},
});

export const createSection = (id: SectionId): ChecklistSection => ({
  id,
  title: SECTION_TITLES[id],
  rows: Array.from({ length: DEFAULT_ROWS[id] }, (_, index) => createRow(index)),
});

export const createSheet = (name?: string): ChecklistSheet => {
  const now = new Date().toISOString();
  const currentDate = new Date();
  const selectedYear = currentDate.getFullYear();
  const selectedMonth = currentDate.getMonth();

  return {
    id: makeId(),
    name: name?.trim() || 'My Checklist',
    createdAt: now,
    updatedAt: now,
    selectedYear,
    selectedMonth,
    columnLabels: generateColumnLabelsForMonth(selectedYear, selectedMonth),
    sections: [createSection('indikatorlar'), createSection('amaliyotlar')],
  };
};
