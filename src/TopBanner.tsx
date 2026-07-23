import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, X } from 'lucide-react';

interface TopBannerProps {
  children: ReactNode;
  /** Optional leading icon that signals the banner's kind (quote, reminder, …). */
  icon?: ReactNode;
  /** Fires after the banner is dismissed with the close button. */
  onDismiss?: () => void;
  ariaLabel?: string;
  className?: string;
}

// Apple-style announcement bar: centered content with a dismiss control. When
// the content is longer than one line it collapses to a single line with a
// chevron to unfold/fold it back.
export function TopBanner({ children, icon, onDismiss, ariaLabel = 'Announcement', className }: TopBannerProps) {
  const [visible, setVisible] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // While collapsed, the content is clamped to one line, so a horizontal
  // overflow tells us there's more to reveal. Re-measure on resize.
  useLayoutEffect(() => {
    const element = contentRef.current;

    if (!element || expanded) {
      return;
    }

    const measure = () => setOverflowing(element.scrollWidth > element.clientWidth + 1);

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);

    return () => observer.disconnect();
  }, [children, expanded]);

  if (!visible) {
    return null;
  }

  const handleDismiss = () => {
    setVisible(false);
    onDismiss?.();
  };

  const showToggle = overflowing || expanded;

  return (
    <div className={`top-banner ${className ?? ''}`.trim()} role="region" aria-label={ariaLabel}>
      <div className="top-banner-inner">
        <div ref={contentRef} className={`top-banner-content ${expanded ? '' : 'clamped'}`}>
          {icon ? (
            <span className="top-banner-icon" aria-hidden="true">
              {icon}
            </span>
          ) : null}
          {children}
        </div>
        {showToggle ? (
          <button
            type="button"
            className="top-banner-toggle"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            aria-label={expanded ? 'Fold' : 'Unfold'}
          >
            <ChevronDown
              size={20}
              strokeWidth={2}
              aria-hidden="true"
              className={`top-banner-chevron ${expanded ? 'is-open' : ''}`}
            />
          </button>
        ) : null}
        <button type="button" className="top-banner-dismiss" onClick={handleDismiss} aria-label="Dismiss">
          <X size={20} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
