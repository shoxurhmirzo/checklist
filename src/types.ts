export type SectionId = 'indikatorlar' | 'amaliyotlar';

export interface ChecklistRow {
  id: string;
  label: string;
  order: number;
  checksByColumn: Record<number, boolean>;
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

export interface BackupPayload {
  version: number;
  exportedAt: string;
  sheets: ChecklistSheet[];
}
