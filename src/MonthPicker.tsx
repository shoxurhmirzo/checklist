import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';

const MONTHS_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

interface MonthPickerProps {
  year: number;
  month: number;
  onChange: (year: number, month: number) => void;
  /** Today's year/month, for the highlighted "current" pip and "This month" action. */
  currentYear: number;
  currentMonth: number;
}

// Apple-style month/year picker — a custom popover that replaces the browser's
// native <input type="month">, which can't be styled to match the app.
export const MonthPicker = ({ year, month, onChange, currentYear, currentMonth }: MonthPickerProps) => {
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(year);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Re-sync the popover's year to the selected value each time it opens.
  const openPicker = () => {
    setViewYear(year);
    setOpen(true);
  };

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) {
        return;
      }
      setOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const selectMonth = (monthIndex: number) => {
    onChange(viewYear, monthIndex);
    setOpen(false);
  };

  const goToThisMonth = () => {
    onChange(currentYear, currentMonth);
    setOpen(false);
  };

  return (
    <div className="month-picker" ref={rootRef}>
      <button
        type="button"
        className={`month-picker-trigger ${open ? 'is-open' : ''}`}
        onClick={() => (open ? setOpen(false) : openPicker())}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span>{`${MONTHS_FULL[month]} ${year}`}</span>
        <ChevronDown size={15} strokeWidth={2.2} aria-hidden="true" />
      </button>

      {open ? (
        <div className="month-picker-popover" role="dialog" aria-label="Select month">
          <div className="month-picker-year">
            <button
              type="button"
              className="month-picker-nav"
              onClick={() => setViewYear((current) => current - 1)}
              aria-label="Previous year"
            >
              <ChevronLeft size={18} strokeWidth={2.2} aria-hidden="true" />
            </button>
            <span className="month-picker-year-label">{viewYear}</span>
            <button
              type="button"
              className="month-picker-nav"
              onClick={() => setViewYear((current) => current + 1)}
              aria-label="Next year"
            >
              <ChevronRight size={18} strokeWidth={2.2} aria-hidden="true" />
            </button>
          </div>

          <div className="month-picker-grid">
            {MONTHS_SHORT.map((label, index) => {
              const isSelected = viewYear === year && index === month;
              const isCurrent = viewYear === currentYear && index === currentMonth;
              return (
                <button
                  key={label}
                  type="button"
                  className={`month-picker-cell ${isSelected ? 'is-selected' : ''} ${
                    isCurrent ? 'is-current' : ''
                  }`}
                  onClick={() => selectMonth(index)}
                  aria-pressed={isSelected}
                  aria-label={`${MONTHS_FULL[index]} ${viewYear}`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          <div className="month-picker-footer">
            <button type="button" className="month-picker-today" onClick={goToThisMonth}>
              This month
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};
