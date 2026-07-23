# Apple Design System Guide
*A comprehensive analysis of Apple's web design principles, patterns, and best practices*

---

## Table of Contents
1. [Core Principles](#core-principles)
2. [Color Palette](#color-palette)
3. [Typography](#typography)
4. [Spacing & Layout](#spacing--layout)
5. [Components](#components)
6. [Interactions & Animations](#interactions--animations)
7. [Navigation Patterns](#navigation-patterns)
8. [Visual Hierarchy](#visual-hierarchy)
9. [Accessibility](#accessibility)
10. [Best Practices](#best-practices)

---

## Core Principles

### 1. **Simplicity & Minimalism**
- Maximum whitespace, minimum elements
- Every element serves a clear purpose
- No decorative borders or unnecessary visual chrome
- Clean, uncluttered layouts with generous breathing room

### 2. **Content First**
- Products and content are the hero
- UI gets out of the way
- Large, immersive imagery with minimal interface overlay
- Focus on what matters: the product, not the interface

### 3. **Consistency**
- Unified design language across all pages
- Predictable patterns and interactions
- Consistent spacing, colors, and typography throughout
- Familiar navigation and component behavior

### 4. **Clarity**
- Clear visual hierarchy
- Obvious call-to-actions
- Readable typography with excellent contrast
- Intuitive information architecture

### 5. **Elegance**
- Premium feel through restraint
- Quality over quantity
- Refined details and polish
- Timeless design that won't feel dated

### 6. **Motion with Purpose**
- Subtle, smooth animations
- Movement communicates state changes
- No animation for decoration—only function
- Respects reduced-motion preferences

---

## Color Palette

### Primary Colors
| Color | Hex | RGB | Usage |
|-------|-----|-----|-------|
| Black | #1D1D1F | 29, 29, 31 | Primary text, core interface |
| White | #FFFFFF | 255, 255, 255 | Backgrounds, card surfaces |
| Light Gray | #F5F5F7 | 245, 245, 247 | Subtle backgrounds, separators |

### Secondary Colors
| Color | Hex | RGB | Usage |
|-------|-----|-----|-------|
| Medium Gray | #E8E8ED | 232, 232, 237 | Borders, subtle dividers |
| Dark Gray | #D2D2D7 | 210, 210, 215 | Hover states, secondary elements |
| Text Gray | #6E6E73 | 110, 110, 115 | Secondary text, subtle labels |

### Accent Colors (System Blue)
| Color | Hex | RGB | Usage |
|-------|-----|-----|-------|
| Apple Blue | #0071E3 | 0, 113, 227 | Primary buttons, links, CTAs |
| Light Blue | #E8F5FF | 232, 245, 255 | Link hover backgrounds |

### Guidelines
- **Avoid pure #000000** — always use #1D1D1F for softer appearance
- **Minimal color usage** — typically only 3-4 colors maximum per page
- **Color has meaning** — blue for actions, grays for secondary, blacks for primary
- **No unnecessary colors** — resist brand colors unless critical
- **Contrast first** — all text must pass WCAG AA minimum

---

## Typography

### Font Family
```css
font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
```
**Notes:**
- Uses native system fonts for each OS
- macOS gets San Francisco
- Windows gets Segoe UI
- Fallbacks to familiar sans-serifs
- No web fonts loaded (performance + system consistency)

### Type Scale

#### Headlines
```
H1: 2.5rem (40px) | weight: 700 | letter-spacing: -0.02em | line-height: 1.1
H2: 2rem (32px) | weight: 700 | letter-spacing: -0.01em | line-height: 1.2
H3: 1.5rem (24px) | weight: 600 | letter-spacing: 0 | line-height: 1.25
H4: 1.25rem (20px) | weight: 600 | letter-spacing: 0 | line-height: 1.3
```

#### Body Text
```
Regular: 1rem (16px) | weight: 400 | line-height: 1.5
Small: 0.875rem (14px) | weight: 400 | line-height: 1.4
Tiny: 0.75rem (12px) | weight: 400 | line-height: 1.3
```

#### Buttons & Labels
```
Button: 1rem (16px) | weight: 500 | letter-spacing: 0.01em
Label: 0.875rem (14px) | weight: 600 | letter-spacing: 0.02em
```

### Text Color Hierarchy
- **Primary Text:** #1D1D1F (main content)
- **Secondary Text:** #6E6E73 (supporting info)
- **Disabled Text:** #A1A1A6 (inactive elements)
- **Link Text:** #0071E3 (interactive elements)

### Line Height
- Headlines: 1.1-1.2 (tight, confident)
- Body: 1.5-1.6 (readable, spacious)
- Captions: 1.3-1.4

### Font Weight Usage
- **700:** Main headlines, emphasis
- **600:** Secondary headlines, labels
- **500:** Buttons, strong emphasis
- **400:** Body text, regular content

### Letter Spacing
- Headlines: -0.01em to -0.02em (tighter, more impactful)
- Body: normal (0)
- Small text: +0.01em (easier to read)
- ALL CAPS: +0.05em to +0.1em (prevent crowding)

---

## Spacing & Layout

### Spacing Scale
Apple uses a base unit of 8px with consistent increments:

```
4px   — minimal gaps, icon spacing
8px   — tight spacing, internal padding
12px  — standard padding for small elements
16px  — default spacing, most common
24px  — section spacing, breathing room
32px  — major section breaks
40px  — hero spacing, large separations
48px  — full-page sections
56px  — maximum internal page spacing
```

### Padding by Component
```css
/* Large cards/containers */
padding: 32px;

/* Medium cards */
padding: 24px;

/* Small cards/buttons */
padding: 16px;

/* Tight spacing */
padding: 12px 16px;

/* Form fields */
padding: 12px 16px; height: 40px;
```

### Margins
```css
/* Section spacing */
margin-bottom: 40px;
margin-top: 40px;

/* Component spacing */
margin-bottom: 16px;

/* List items */
margin-bottom: 12px;

/* Zero where possible */
Use gap property in flexbox instead of margins
```

### Gap Property (Flexbox)
```css
/* Navigation items */
gap: 32px;

/* List items */
gap: 16px;

/* Inline elements */
gap: 8px;
```

### Max-Width Constraints
- **Hero sections:** 100% (full width)
- **Content sections:** 1440px max (largest product pages)
- **Typical sections:** 1280px max
- **Narrow content:** 800-920px (article-like layouts)
- **Full bleed:** 100% (backgrounds extend edge-to-edge)

### Container Padding (Responsive)
```css
/* Desktop */
padding: 0 40px;

/* Tablet */
@media (max-width: 1024px) {
  padding: 0 32px;
}

/* Mobile */
@media (max-width: 640px) {
  padding: 0 16px;
}
```

### Grid & Columns
- **Desktop:** 12-column grid with 32px gutters
- **Tablet:** 8-column grid with 24px gutters
- **Mobile:** 4-column grid with 16px gutters
- Columns always flexible with max-width container

### Aspect Ratios
```css
/* Hero images: 16:9 */
aspect-ratio: 16 / 9;

/* Product cards: 1:1 or 4:3 */
aspect-ratio: 1 / 1;
aspect-ratio: 4 / 3;

/* Video: 16:9 */
aspect-ratio: 16 / 9;
```

---

## Components

### Buttons

#### Primary Button
```css
padding: 12px 24px;
border-radius: 8px;
background: #0071E3;
color: #FFFFFF;
font-weight: 500;
font-size: 1rem;
border: 0;
cursor: pointer;
transition: background-color 150ms ease-out;

&:hover {
  background: #0056b3;
}

&:active {
  background: #003c99;
}

&:disabled {
  background: #D2D2D7;
  cursor: not-allowed;
  color: #A1A1A6;
}
```

#### Secondary Button
```css
padding: 12px 24px;
border-radius: 8px;
background: #F5F5F7;
color: #1D1D1F;
font-weight: 500;
font-size: 1rem;
border: 0;
cursor: pointer;
transition: background-color 150ms ease-out;

&:hover {
  background: #E8E8ED;
}

&:active {
  background: #D2D2D7;
}
```

#### Text Button
```css
padding: 8px 12px;
background: transparent;
color: #0071E3;
font-weight: 500;
font-size: 1rem;
border: 0;
cursor: pointer;
text-decoration: none;
transition: color 150ms ease-out;

&:hover {
  color: #0056b3;
  text-decoration: underline;
  text-underline-offset: 4px;
}
```

### Cards

```css
.card {
  background: #FFFFFF;
  border: 1px solid #F5F5F7;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  transition: box-shadow 150ms ease-out;
}

.card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
}
```

### Input Fields

```css
.input-field {
  padding: 12px 16px;
  border: 1px solid #D2D2D7;
  border-radius: 8px;
  font-size: 1rem;
  font-family: inherit;
  background: #FFFFFF;
  color: #1D1D1F;
  transition: border-color 150ms ease-out;
}

.input-field:focus {
  outline: 0;
  border-color: #0071E3;
  box-shadow: 0 0 0 3px rgba(0, 113, 227, 0.1);
}

.input-field::placeholder {
  color: #A1A1A6;
}

.input-field:disabled {
  background: #F5F5F7;
  color: #A1A1A6;
  cursor: not-allowed;
}
```

### Dropdowns

```css
.dropdown {
  padding: 12px 16px;
  padding-right: 40px;
  border: 1px solid #D2D2D7;
  border-radius: 8px;
  font-size: 1rem;
  background: #FFFFFF;
  color: #1D1D1F;
  appearance: none;
  background-image: url("data:image/svg+xml...");
  background-repeat: no-repeat;
  background-position: right 12px center;
  cursor: pointer;
}

.dropdown:hover {
  border-color: #A1A1A6;
}

.dropdown:focus {
  outline: 0;
  border-color: #0071E3;
}
```

### Cards in Grid

```css
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 32px;
  padding: 40px 0;
}

.card-grid-item {
  background: #FFFFFF;
  border: 1px solid #E8E8ED;
  border-radius: 12px;
  overflow: hidden;
  transition: all 200ms ease-out;
}

.card-grid-item:hover {
  border-color: #D2D2D7;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
}
```

### Navigation Menu

```css
.nav-menu {
  display: flex;
  gap: 32px;
  align-items: center;
  padding: 16px 0;
  border-bottom: 1px solid #E8E8ED;
}

.nav-item {
  color: #1D1D1F;
  text-decoration: none;
  font-size: 1rem;
  font-weight: 400;
  position: relative;
  transition: color 150ms ease-out;
}

.nav-item:hover {
  color: #6E6E73;
}

.nav-item.active::after {
  content: '';
  position: absolute;
  bottom: -16px;
  left: 0;
  right: 0;
  height: 2px;
  background: #0071E3;
}
```

### Hero Section

```css
.hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: linear-gradient(135deg, #FFFFFF 0%, #F5F5F7 100%);
  padding: 40px 0;
  text-align: center;
}

.hero-image {
  width: 100%;
  max-width: 1200px;
  height: auto;
  margin-bottom: 40px;
  object-fit: cover;
  border-radius: 12px;
}

.hero-content {
  max-width: 800px;
  padding: 0 40px;
}

.hero-headline {
  font-size: 3.5rem;
  font-weight: 700;
  margin-bottom: 24px;
  letter-spacing: -0.02em;
}

.hero-subheading {
  font-size: 1.5rem;
  color: #6E6E73;
  margin-bottom: 40px;
  line-height: 1.4;
}

.hero-ctas {
  display: flex;
  gap: 16px;
  justify-content: center;
}
```

---

## Interactions & Animations

### Transitions
```css
/* Standard transition duration */
transition: all 150ms ease-out;

/* Specific properties */
transition: background-color 150ms ease-out;
transition: color 150ms ease-out;
transition: border-color 150ms ease-out;
transition: box-shadow 200ms ease-out;

/* Hover states */
&:hover {
  /* Instant visual feedback */
  opacity: 0.8;
}

&:active {
  /* Tactile feedback */
  transform: scale(0.98);
}
```

### Easing Functions
```css
/* Ease-out: smooth deceleration (most common) */
transition-timing-function: ease-out;

/* Ease-in-out: natural motion */
transition-timing-function: ease-in-out;

/* Custom cubic-bezier for Apple-like motion */
transition-timing-function: cubic-bezier(0.25, 0.46, 0.45, 0.94);
```

### Focus States
```css
.interactive:focus-visible {
  outline: 2px solid #0071E3;
  outline-offset: 4px;
}
```

### Hover States
```css
/* Buttons */
&:hover {
  opacity: 0.9;
}

/* Links */
&:hover {
  text-decoration: underline;
  text-underline-offset: 4px;
}

/* Cards */
&:hover {
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
}
```

### Active/Pressed States
```css
&:active {
  transform: scale(0.97);
  opacity: 0.85;
}
```

### Disabled States
```css
&:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  color: #A1A1A6;
}
```

### Animation Principles
- **No auto-play:** Animations require user interaction
- **Short duration:** 150-300ms preferred (never > 500ms)
- **Subtle:** Movement should be minimal and purposeful
- **Responsive:** Respects prefers-reduced-motion
- **Consistent:** Same interaction always performs same animation

### Scroll Animations
- Fade-in on scroll (very subtle)
- Parallax (minimal depth, not distracting)
- Stagger delays (max 50ms between elements)
- No jarring transitions

---

## Navigation Patterns

### Top Navigation Bar
```css
.top-nav {
  position: sticky;
  top: 0;
  z-index: 100;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid rgba(0, 0, 0, 0.1);
  padding: 0 40px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 32px;
}
```

### Breadcrumb Navigation
```css
.breadcrumb {
  display: flex;
  gap: 12px;
  align-items: center;
  font-size: 0.875rem;
  color: #6E6E73;
}

.breadcrumb-item {
  display: flex;
  align-items: center;
}

.breadcrumb-separator {
  margin: 0 8px;
  color: #D2D2D7;
}

.breadcrumb-link {
  color: #0071E3;
  text-decoration: none;
}

.breadcrumb-link:hover {
  text-decoration: underline;
}
```

### Footer Navigation
```css
.footer {
  background: #F5F5F7;
  padding: 40px;
  border-top: 1px solid #E8E8ED;
  margin-top: 80px;
}

.footer-columns {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 40px;
  margin-bottom: 40px;
}

.footer-column-title {
  font-weight: 600;
  font-size: 0.875rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #1D1D1F;
  margin-bottom: 16px;
}

.footer-link {
  display: block;
  color: #6E6E73;
  text-decoration: none;
  font-size: 0.875rem;
  line-height: 1.8;
  transition: color 150ms ease-out;
}

.footer-link:hover {
  color: #1D1D1F;
}
```

### Mobile Navigation
- Hamburger menu with animated icon
- Full-screen overlay menu
- Touch-friendly spacing (min 44px height)
- Clear hierarchy with indentation
- Smooth slide-in animation

---

## Visual Hierarchy

### Size Hierarchy
```
Hero Headlines: 2.5rem-4rem
Section Headlines: 2rem-2.5rem
Subsection Headlines: 1.5rem-2rem
Body Text: 1rem
Secondary Text: 0.875rem-0.95rem
Captions: 0.75rem
```

### Color Hierarchy
```
Primary (Action): #0071E3 (blue)
Primary (Text): #1D1D1F (black)
Secondary (Text): #6E6E73 (gray)
Tertiary (Text): #A1A1A6 (light gray)
Background: #FFFFFF or #F5F5F7
```

### Weight Hierarchy
```
Bold (700): Main headlines, emphasis
Semibold (600): Secondary headlines, labels
Medium (500): Buttons, strong emphasis
Regular (400): Body content
```

### Whitespace Hierarchy
- Large sections separated by 40-56px
- Components separated by 24-32px
- Related items separated by 12-16px
- Internal element padding: 16-24px

### Visual Emphasis
1. **Size:** Larger = more important
2. **Color:** Unique colors draw attention (use sparingly)
3. **Weight:** Bold text = emphasized
4. **Whitespace:** More space = more prominent
5. **Position:** Center or top = more prominent
6. **Contrast:** Higher contrast = more prominent

---

## Accessibility

### Color Contrast
- **All text:** Minimum WCAG AA (4.5:1)
- **Large text:** Minimum WCAG AA (3:1)
- **UI components:** Minimum WCAG AA (3:1)
- **Test with:** WebAIM Contrast Checker, Accessible Colors

### Focus Management
```css
/* Always visible focus indicators */
:focus-visible {
  outline: 2px solid #0071E3;
  outline-offset: 4px;
}

/* Never use outline: none without replacement */
```

### Semantic HTML
```html
<!-- Use proper heading hierarchy -->
<h1>Main Page Title</h1>
<h2>Section Title</h2>
<h3>Subsection Title</h3>

<!-- Use semantic buttons -->
<button type="button">Click Me</button>

<!-- Use semantic links -->
<a href="/page">Link Text</a>

<!-- Use proper form labels -->
<label for="email">Email</label>
<input id="email" type="email" />

<!-- Use ARIA when needed -->
<nav aria-label="Main navigation">
  <ul>
    <li><a href="/">Home</a></li>
  </ul>
</nav>
```

### Screen Reader Support
- All images need alt text
- Form fields need labels
- List items should use semantic `<ul>/<ol>`
- Interactive elements need proper ARIA roles
- Announce state changes with aria-live regions

### Keyboard Navigation
- All interactive elements must be keyboard accessible
- Logical tab order (top-to-bottom, left-to-right)
- Skip links for navigation
- Keyboard shortcuts properly labeled

### Motion & Animation
```css
/* Always respect reduced motion */
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## Best Practices

### 1. **Spacing**
✅ Use consistent spacing scale (8px base unit)
✅ Use gap property in flexbox (not margins)
✅ Increase padding for visual importance
✅ Group related content with tighter spacing
✗ Avoid margin collapsing—use padding or gap
✗ Don't mix margin and gap on same element

### 2. **Typography**
✅ Use system font stack for performance
✅ Maintain 1.5-1.6 line-height for body text
✅ Use letter-spacing for headlines (tight)
✅ Limit headline sizes to 4 total levels
✅ Keep line length 50-75 characters for readability
✗ Don't use pure black (#000) for text
✗ Don't use all-caps for body text
✗ Avoid thin font weights (< 400)

### 3. **Colors**
✅ Use a limited palette (3-5 colors max)
✅ Test contrast ratios (WCAG AA minimum)
✅ Use blue (#0071E3) for primary actions only
✅ Use grays for secondary content
✅ Use meaningful colors (green for success, red for danger)
✗ Avoid color-only information (add text/icons)
✗ Don't use saturated bright colors
✗ Avoid color combinations that clash

### 4. **Borders & Shadows**
✅ Use subtle borders (#E8E8ED or #F5F5F7)
✅ Use light shadows for depth (0 4px 12px rgba(0,0,0,0.12))
✅ Increase shadow on hover
✅ Remove border on interactive states
✗ Avoid dark borders (#000 or #333)
✗ Avoid heavy shadows (too much depth)
✗ Don't use borders and shadows together

### 5. **Buttons**
✅ Minimum 44px height for touch targets
✅ Use blue for primary actions
✅ Use gray for secondary actions
✅ Use text buttons for tertiary actions
✅ Show visible hover/focus states
✅ Disabled state with reduced opacity
✗ Don't use underlined text as buttons
✗ Don't make buttons too small
✗ Avoid white buttons on white backgrounds

### 6. **Responsive Design**
✅ Use mobile-first approach
✅ Stack vertically on small screens
✅ Hide less important content on mobile
✅ Adjust padding and spacing for screen size
✅ Use flexible images (max-width: 100%)
✗ Don't use fixed widths
✗ Avoid horizontal scroll
✗ Don't hide critical content

### 7. **Performance**
✅ Use system fonts (no web fonts)
✅ Optimize images (WebP, lazy loading)
✅ Minimize CSS (no unnecessary rules)
✅ Use CSS variables for repeated values
✅ Defer non-critical JavaScript
✗ Don't load heavy font libraries
✗ Avoid inline styles
✗ Don't use deprecated HTML/CSS

### 8. **Navigation**
✅ Sticky navigation with blur background
✅ Clear active state indicator
✅ Logical grouping of menu items
✅ Breadcrumb for subpages
✅ Footer navigation for secondary links
✗ Don't hide navigation on mobile (use hamburger)
✗ Avoid dropdown menus with many items
✗ Don't use auto-expanding navigation

### 9. **Forms**
✅ Label above input field
✅ Clear error messages
✅ Show field validation in real-time
✅ Use placeholder text for hints only
✅ Focus outline for keyboard users
✗ Don't use placeholder as label
✗ Avoid dependent dropdowns
✗ Don't use multiple column layouts on mobile

### 10. **Images**
✅ Use high-quality imagery
✅ 16:9 aspect ratio for hero images
✅ Add alt text to all images
✅ Optimize for different screen sizes
✅ Use SVG for icons and logos
✗ Don't use low-resolution images
✗ Avoid auto-playing video
✗ Don't require specific viewport width

---

## Implementation Quick-Start

### Copy-Paste CSS Variables
```css
:root {
  /* Colors */
  --color-black: #1D1D1F;
  --color-white: #FFFFFF;
  --color-light-gray: #F5F5F7;
  --color-medium-gray: #E8E8ED;
  --color-dark-gray: #D2D2D7;
  --color-text-gray: #6E6E73;
  --color-blue: #0071E3;
  --color-blue-dark: #0056B3;
  --color-disabled: #A1A1A6;

  /* Typography */
  --font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  
  /* Sizing */
  --size-4: 4px;
  --size-8: 8px;
  --size-12: 12px;
  --size-16: 16px;
  --size-24: 24px;
  --size-32: 32px;
  --size-40: 40px;
  
  /* Shadows */
  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.08);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.12);
  --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.12);
  
  /* Transitions */
  --transition-fast: 150ms ease-out;
  --transition-base: 200ms ease-out;
}
```

### Common Component Patterns
```css
/* Card */
.card {
  background: var(--color-white);
  border: 1px solid var(--color-medium-gray);
  border-radius: 12px;
  padding: var(--size-24);
  box-shadow: var(--shadow-sm);
  transition: box-shadow var(--transition-base);
}

.card:hover {
  box-shadow: var(--shadow-md);
}

/* Button */
.btn {
  padding: 12px 24px;
  border-radius: 8px;
  border: 0;
  font-weight: 500;
  cursor: pointer;
  transition: background-color var(--transition-fast);
}

.btn-primary {
  background: var(--color-blue);
  color: var(--color-white);
}

.btn-primary:hover {
  background: var(--color-blue-dark);
}

/* Section */
.section {
  padding: var(--size-40) 0;
  border-top: 1px solid var(--color-medium-gray);
}

.section:first-child {
  border-top: 0;
  padding-top: 0;
}
```

---

## Summary: The Apple Way

**In one sentence:** Apple's design philosophy is "less is more" — every element is intentional, spacing is generous, typography is clear, colors are minimal, and interactions are subtle.

**Key Takeaways:**
1. Whitespace is a first-class design element, not empty space
2. Typography carries hierarchy—use size, weight, and color strategically
3. Borders and shadows are subtle—barely visible but present
4. Colors mean something—blue for actions, grays for hierarchy
5. Animations are purposeful—smooth and quick, never decorative
6. Navigation is predictable—users always know where they are
7. Mobile comes first—scale up to desktop, not down
8. Accessibility is built-in—not an afterthought
9. Performance matters—no bloated libraries or web fonts
10. Consistency wins—the design language is unified across all pages

**Apply These Principles to Any Project:**
- Start with whitespace and typography
- Choose 3-4 colors maximum
- Use consistent spacing scale
- Make interactions smooth but quick
- Test on real devices
- Validate accessibility
- Optimize for performance
- Iterate based on real usage

---

*Last Updated: 2026-07-21*
*Source: apple.com homepage, Mac page, iPhone page, and Store page*
