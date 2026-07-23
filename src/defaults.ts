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

// Real number of days in the selected month (28–31). Clamped to COLUMN_COUNT
// so a corrupt month value can never render more columns than the data holds.
export const getDaysInMonth = (year: number, month: number) =>
  Math.min(new Date(year, month + 1, 0).getDate(), COLUMN_COUNT);

export const generateColumnLabelsForMonth = (year: number, month: number) => {
  const daysInMonth = getDaysInMonth(year, month);

  // Day number only ("1"…"31"). The month lives in the "Sana:" picker, so
  // repeating it in every column is redundant — and short numbers read
  // horizontally, no vertical rotation needed.
  return Array.from({ length: COLUMN_COUNT }, (_, index) =>
    index < daysInMonth ? String(index + 1) : '',
  );
};

// Migrates legacy auto-generated labels like "1 Jul" → "1". Matches only the old
// "<day> <short-month>" shape those labels were built from (Intl en-GB short
// month names), so a custom label like "15 Payday" is never mistaken for one.
const LEGACY_DATE_LABEL = /^(\d{1,2})\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)$/i;
export const normalizeColumnLabel = (label: string) => {
  const match = label.match(LEGACY_DATE_LABEL);
  return match ? match[1] : label;
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
