# Motion

**Animation speed is derived, not chosen.** Every transition's duration follows from two things: how far the pixels travel and what the animation is *for*. This is Apple's actual model — there is no single "site duration."

## The grounding

Three sources, cross-checked:

1. **Apple HIG — Motion.** Principles, not numbers: *"Aim for brevity and precision in feedback animations. When animated feedback is brief and precise, it tends to feel lightweight and unobtrusive."* And: *"generally avoid adding motion to UI interactions that occur frequently."* watchOS note: system animations *"include built-in easing that plays at the start and end"* → i.e. **ease-in-out**.
2. **apple.com, measured.** Sampling 200+ interactive elements, the dominant transition is **320ms on `cubic-bezier(0.4, 0, 0.6, 1)`** (212 elements). That curve is effectively `ease-in-out` (the keyword is `0.42, 0, 0.58, 1`). Larger changes scale **up** (≈1s gallery expand); tiny ticks scale **down** (≈100ms). Duration tracks the magnitude of the change.
3. **Platform defaults.** SwiftUI's default is `easeInOut` **0.35s**; UIKit standard ≈0.25–0.35s.

## The rule

**One easing family + a duration scale keyed to function.** Defined once in `:root` (`src/styles.css`):

| Token | Value | Function — when the change is… |
|---|---|---|
| `--ease-standard` | `cubic-bezier(0.4, 0, 0.6, 1)` | in-place state change (Apple's web curve ≈ ease-in-out) |
| `--ease-entrance` | `cubic-bezier(0, 0, 0.2, 1)` | an element appearing — decelerate to rest |
| `--dur-instant` | `100ms` | tactile press (active/pressed) — **nothing travels** |
| `--dur-micro` | `150ms` | frequent hover feedback — color, opacity, border, small shadow |
| `--dur-standard` | `300ms` | visible state change **with travel** — tab thumb, reveal, menu-in |
| `--dur-large` | `440ms` | spatial entrance — dialog, backdrop, fullscreen |

We land our standard tier a touch under apple.com's 320ms because this is a dense productivity app, not a marketing page — HIG's "avoid motion on frequent interactions" pushes toward brevity.

## How to pick a duration

Ask, in order:
1. **Does anything actually move?** No (just a tint/opacity/press) → `--dur-instant` or `--dur-micro`.
2. **Is it a state change with visible travel?** (a thumb sliding, a panel revealing, a menu opening) → `--dur-standard`.
3. **Is it a spatial entrance that reorients the view?** (a dialog, a sheet, fullscreen) → `--dur-large`, with `--ease-entrance`.

Easing: `--ease-standard` for in-place changes; `--ease-entrance` for things arriving.

```css
/* hover tint — nothing travels */
transition: background-color var(--dur-micro) var(--ease-standard);
/* the tab thumb slides across — travel */
transition: transform var(--dur-standard) var(--ease-standard);
/* a dialog arrives — spatial */
animation: dialog-pop-in var(--dur-large) var(--ease-entrance);
```

## Out of scope (a different functional class)

Continuous, status, and celebration motion are **not** interaction feedback and keep their own hand-tuned timings: the loading spinner (`700ms linear infinite`), the save-state draw/fade (`360ms` / `1200ms`), and the expressive completion "pop/flash" springs (`cubic-bezier(0.2, 0.9, 0.25, 1.2)` etc.). These intentionally overshoot or loop; they are not on the interaction scale.

## Accessibility

`@media (prefers-reduced-motion: reduce)` is honored — see the block near the end of `src/styles.css`.
