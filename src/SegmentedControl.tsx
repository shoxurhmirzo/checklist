import type { ReactNode } from 'react';

interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
  className?: string;
}

// Apple-style iOS segmented control: a gray track with a sliding white thumb.
// The thumb is sized and positioned inline so the same component works for any
// number of segments (2 for Morning/Evening, 4 for the Work sub-pages).
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: SegmentedControlProps<T>) {
  const activeIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const count = options.length;

  return (
    <div className={`segmented ${className ?? ''}`.trim()} role="tablist" aria-label={ariaLabel}>
      <span
        className="segmented-thumb"
        aria-hidden="true"
        style={{
          width: `calc((100% - 4px) / ${count})`,
          transform: `translateX(${activeIndex * 100}%)`,
        }}
      />
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          className={`segmented-option ${option.value === value ? 'active' : ''}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
