# Project Design

This document describes the design of the checklist application as it exists in the codebase today. It is meant to serve as the product and UI reference for the whole app: what the screens are, how they behave, how the data is structured, and what visual rules keep the interface consistent.

## 1. Product Overview

The app is a local-first daily planning tool built around three connected workflows:

1. Checklist tracking across a monthly grid.
2. Task capture and prioritization through a "Plan my day" flow.
3. Daily history review of completed and undone work.

The product is intentionally simple at the surface, but the checklist view is dense and highly structured. The rest of the UI exists to support that checklist with lower-friction planning and a record of what happened over time.

The current implementation is a React + TypeScript app bundled with Vite and styled through a single global stylesheet.

## 2. Core Product Goals

The design is optimized for:

- Fast daily use.
- Minimal navigation friction.
- Clear separation between planning, execution, and review.
- Local persistence without requiring sign-in.
- A paper-like checklist surface that still feels usable on screen.

The visual language keeps the interface mostly monochrome with restrained accent colors for state, feedback, and destructive actions.

## 3. Information Architecture

The app is built around four main views:

- Checklist
- Plan my day
- Task sorter
- History

These are not separate pages in a traditional app shell sense; they are view states inside one application.

### 3.1 Checklist

This is the primary workspace. It shows a sheet selector, day columns for the month, two checklist sections, and the mark totals/status controls.

### 3.2 Plan My Day

This is a task capture screen. It lets the user enter a linear list of tasks, then move into sorting once enough tasks exist.

### 3.3 Task Sorter

This is the prioritization screen. Tasks are placed into a four-quadrant matrix plus a completed zone.

### 3.4 History

This is the historical log of each day after rollover. It shows completed and undone items grouped by date.

## 4. Global Layout

The application uses a single vertical workspace with a top control strip and a main content region beneath it.

### 4.1 Top Controls

The top control area changes based on the active view.

In checklist mode it includes:

- The active sheet label.
- A "Plan my day" trigger with a dropdown menu.
- A sheet options menu.
- A persistence status indicator when loading or saving.

In other views it becomes a lighter navigation strip with back buttons, history access, and cross-view navigation.

### 4.2 Main Content

The main content area switches between:

- The checklist sheet.
- The task planning editor.
- The sorter matrix.
- The history timeline.

The views are intentionally separate in structure so each one can have its own visual rhythm.

## 5. Visual Language

The app uses a restrained, utility-first visual system with deliberate geometry.

### 5.1 Typography

The global stack uses:

- `Carlito`
- `Calibri`
- `Segoe UI`
- `Arial`
- `sans-serif`

This keeps the app close to a document-like office UI rather than a modern app with heavy brand styling.

Typography rules:

- Main titles are medium or bold and centered in most views.
- Body text stays black or near-black.
- Supporting text uses softened grays.
- Numeric or status text is smaller and secondary.

### 5.2 Color System

The default palette is intentionally neutral:

- Background: white.
- Primary text: near-black.
- Borders: black or light gray depending on hierarchy.
- Hover state: soft blue-gray fill.
- Positive state: muted green.
- Negative state: muted red.
- Destructive state: deeper red.

The app avoids decorative color use. Color should communicate state, action, or emphasis.

### 5.3 Shape and Borders

The design language is box-based and sharply edged:

- Most controls use `border-radius: 0`.
- Inputs, buttons, menus, and table cells are square or rectangular.
- The checklist itself is intentionally grid-like and paper-like.

Rounded corners are generally avoided unless they are part of a subtle shell or container treatment.

### 5.4 Motion

Motion is subtle and functional:

- Menu reveals are short and direct.
- Save feedback uses a brief loading/saved animation.
- Checklist cell menus animate in quickly.
- Hover transitions are short and consistent.

The motion is not decorative; it exists to make state changes readable.

## 6. Checklist Design

The checklist is the main product surface and defines the overall identity of the app.

### 6.1 Sheet Structure

Each checklist sheet contains:

- A name.
- A selected year and month.
- 31 possible date columns.
- Two sections:
  - `Indikatorlar`
  - `Amaliyotlar`

Each section contains rows with editable labels and day-by-day marks.

### 6.2 Table Layout

The checklist is rendered as a table, not as freeform cards.

This is intentional because:

- It preserves alignment across rows and dates.
- It reinforces the document-like, spreadsheet-like metaphor.
- It supports the monthly grid model naturally.

The left side contains:

- A vertical section label.
- A row label input with delete control.

The main grid contains:

- One cell per day column.
- A compact mark state inside each cell.

### 6.3 Marking Cells

Each checklist cell supports three states:

- Plus
- Minus
- Empty

The user opens a small contextual menu from a cell and chooses one of:

- Mark plus
- Mark minus
- Clear mark

Current state is visually displayed inside the cell. The action menu is contextual and should not crowd the sheet by default.

### 6.4 Checklist Feedback

The checklist includes several helper signals:

- A save status indicator.
- Plus/minus totals.
- A fullscreen toggle.

The plus/minus totals are intentionally minimal and should not overpower the grid.

The plus/minus totals and fullscreen action share a reserved bottom dock. The dock remains attached to the browser workspace and is excluded from checklist scaling, so browser sidebars and narrow viewports cannot make it overlap the paper.

### 6.5 Month and Date Columns

The sheet supports a selected month and year at the header level. Column labels correspond to the month days, with unused trailing columns left blank.

This keeps the design stable for months with different day counts.

### 6.6 Sheet Management

The checklist includes sheet-level operations:

- Switch sheet.
- Rename sheet.
- Create new sheet.
- Export.
- Import.
- Delete sheet.

These actions are grouped into a three-dot menu because they are important but not primary day-to-day interactions.

### 6.7 Fullscreen Checklist Mode

The checklist can expand to a fullscreen layout.

The purpose of fullscreen mode is to maximize readability on large and small screens without introducing a separate page.

Design requirements for fullscreen:

- The full checklist should remain visible and usable.
- The exit affordance must remain obvious.
- The layout should still preserve the paper/grid identity.

## 7. Plan My Day Design

The "Plan my day" flow is the app's task capture layer.

### 7.1 Purpose

It is meant for quick structured brain dump entry rather than a rich task management system.

The key design idea is to collect tasks in a simple numbered list before prioritizing them.

### 7.2 Editor Style

The editor uses:

- A centered shell.
- A clear title.
- Numbered rows.
- A task input area with ruled-line styling.

The intention is to feel like writing on paper while still being easy to edit.

### 7.3 Call to Action

The main action in this view is the prioritization button.

That button is intentionally distinct from the checklist controls because it represents a workflow transition, not a regular edit.

## 8. Task Sorter Design

The sorter view is the decision-making layer between task capture and execution.

### 8.1 Structure

The sorter contains:

- A title.
- A current focus area.
- A task backlog panel.
- A four-quadrant prioritization matrix.
- A completed task zone.

### 8.2 Matrix Model

The matrix follows a productivity/attractiveness model:

- Productive + attractive
- Productive + unattractive
- Unproductive + attractive
- Unproductive + unattractive

The matrix makes prioritization explicit by putting tasks into a spatial model instead of a flat list.

### 8.3 Focus Task

The sorter includes a special "main task now" state.

This is visually separated from the matrix so the user can commit to one task without losing the larger context.

### 8.4 Completion Zone

Completed tasks are grouped separately from the sorting matrix. This keeps the matrix about decisions, not just outcomes.

## 9. History Design

History is the review layer and is intentionally calmer than the checklist and sorter.

### 9.1 Structure

The history page shows:

- Today as a live day section.
- Prior days as dated records.

Each day is split into:

- Completed tasks.
- Undone tasks.

### 9.2 Rollup Model

History is generated by the daily rollover system. Completed tasks are archived at the end of the day and undone tasks are carried forward.

This means history is not manually authored. It is a reflection of task lifecycle and daily state changes.

## 10. Interaction Design

### 10.1 Menu Behavior

Menus are used for grouped actions that would otherwise clutter the top bar or a cell.

The design rule is:

- Primary actions stay visible.
- Secondary actions live in contextual menus.
- Destructive actions are separated and visually distinct.

### 10.2 Hover and Focus

Hover and focus states should be consistent across the app.

The current interaction language favors:

- Underlines for text-like actions.
- Soft blue-gray hover fills for controls.
- Stronger color changes for destructive or confirmatory actions.

### 10.3 Save Feedback

The app shows explicit persistence feedback:

- Loading.
- Saving.
- Saved.

This is important because the app persists locally and the user needs confidence that state has been written.

### 10.4 Keyboard and Escaping

The app supports keyboard-friendly interactions where practical:

- Escape should close menus and dialogs.
- Enter should commit obvious form actions.
- F toggles fullscreen checklist mode.

### 10.5 Drag and Drop

The sorter relies on drag and drop to move tasks between states. The design should make drop targets obvious, especially the focus area and completion zone.

## 11. Data Model

The app state is centered around a single persisted object with:

- Sheets
- Divide-and-conquer task text
- Parsed divide-and-conquer items
- Current focus task
- Daily history
- Last rollover date

### 11.1 Checklist Data

Each sheet stores:

- Identity and timestamps.
- Month selection.
- Column labels.
- Sections.
- Rows.

Rows store:

- Label text.
- Order.
- Per-column check states.

### 11.2 Check State

Each cell can store:

- Mark type: plus or minus.
- Optional logged timestamp.

The timestamp makes the app more than a visual tracker; it also records when the state was set.

### 11.3 Task Planning Data

The planner stores a raw multiline text draft plus a normalized task list. This supports direct text entry while still enabling task-level operations later.

### 11.4 History Data

History records are date-keyed and contain:

- Completed tasks.
- Undone tasks.

The record format is deliberately simple so it can survive imports and schema evolution.

## 12. Persistence Design

The app is local-first and uses browser persistence.

### 12.1 Storage Strategy

State is loaded from local storage mechanisms through a compatibility layer that can normalize older formats.

### 12.2 Import and Export

The app supports JSON backup export and import.

Design principles for backup flows:

- Preserve valid existing data.
- Reject malformed payloads.
- Avoid mixing incompatible versions blindly.

### 12.3 Recovery

On startup, the app should recover gracefully from:

- Empty storage.
- Legacy storage.
- Partial or malformed state.

This keeps the app safe for non-technical users.

## 13. Responsive Behavior

The app is designed to scale down and up without losing its core structure.

### 13.1 Checklist Responsiveness

The checklist is the most sensitive view because it is dense and horizontally wide. The design should prioritize:

- Preserving visible structure.
- Keeping the sheet readable.
- Avoiding unnecessary dead space.
- Maintaining usable controls on smaller screens.
- Reserving a bottom dock so totals and fullscreen controls never overlap the scaled paper.

### 13.2 Planning and Sorting Responsiveness

The planning and sorting views should remain centered and bounded so they feel stable on large monitors and do not stretch into awkward line lengths.

### 13.3 Fullscreen Responsiveness

Fullscreen checklist mode is the primary response to limited space for the grid. It should be treated as a first-class layout state, not just a visual flourish.

## 14. Accessibility Design

The app should remain keyboard and screen-reader usable.

Key accessibility rules:

- Interactive controls need clear labels.
- Menu buttons should expose open/closed state.
- Focus styles should remain visible.
- Color should never be the only signal for action state.
- Destructive actions should be labeled clearly and separated visually.

## 15. Component-Level Design Summary

### 15.1 Top Control Components

- Sheet label
- Plan menu trigger
- Sheet menu trigger
- Back navigation buttons
- History navigation buttons
- Save feedback indicator

### 15.2 Checklist Components

- Sheet table
- Section labels
- Row label input
- Delete row action
- Cell toggle
- Cell action menu
- Add row field
- Status totals
- Fullscreen button
- Bottom control dock

### 15.3 Planning Components

- Numbered task rows
- Text capture area
- Prioritize action button

### 15.4 Sorter Components

- Focus line
- Drag targets
- Quadrant cells
- Completion zone
- Clear-all action

### 15.5 History Components

- Day group
- Completed/undone lists
- Entry edit controls

## 16. Design Principles

The project should continue to follow these rules:

- Keep the checklist as the anchor of the product.
- Use structure and spacing to reduce cognitive load.
- Make secondary actions discoverable but not noisy.
- Prefer stable geometry over decorative styling.
- Use color for state, not decoration.
- Preserve a document-like, paper-like feel where it improves comprehension.
- Avoid adding visual complexity unless it improves task completion.

## 17. Implementation Notes

The current codebase expresses the design through:

- `src/App.tsx` for view logic and interaction behavior.
- `src/styles.css` for the full visual system.
- `src/defaults.ts` for sheet generation and month layout.
- `src/storage.ts` for persistence, normalization, and backups.
- `src/types.ts` for the data contract.

This means the design is intentionally code-driven. There is no separate design system package, and the source of truth is the app itself.

## 18. Suggested Future Design Direction

If the product continues to evolve, the next best improvements are likely:

- A clearer hierarchy for sheet management versus daily actions.
- Better space management on narrower viewports.
- Stronger visual differentiation between the checklist and the planning/sorting workflows.
- A more explicit icon system for secondary controls.
- A tighter set of tokens for action colors, borders, and hover states.

Those changes should preserve the current paper/grid identity rather than replacing it.
