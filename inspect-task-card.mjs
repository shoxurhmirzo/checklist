import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  await page.goto('http://localhost:5173/#/ideas', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Get computed styles for card and all parents
  const result = await page.evaluate(() => {
    const card = document.querySelector('.sort-task-card');
    if (!card) {
      return { error: 'No .sort-task-card found', debugging: {
        hasUnassignedList: !!document.querySelector('.sort-unassigned-list'),
        allElementsWithTaskCard: document.querySelectorAll('[class*="task-card"]').length,
      }};
    }

    const result = {
      card: {},
      parents: []
    };

    // Get card computed styles
    const cardComputed = getComputedStyle(card);
    result.card = {
      height: cardComputed.height,
      minHeight: cardComputed.minHeight,
      maxHeight: cardComputed.maxHeight,
      paddingTop: cardComputed.paddingTop,
      paddingBottom: cardComputed.paddingBottom,
      marginTop: cardComputed.marginTop,
      marginBottom: cardComputed.marginBottom,
      lineHeight: cardComputed.lineHeight,
      display: cardComputed.display,
      alignItems: cardComputed.alignItems,
      boxSizing: cardComputed.boxSizing,
      flex: cardComputed.flex,
      flexGrow: cardComputed.flexGrow,
      flexShrink: cardComputed.flexShrink,
      flexBasis: cardComputed.flexBasis,
      fontSize: cardComputed.fontSize,
    };

    // Walk up parents
    let el = card.parentElement;
    let depth = 0;
    while (el && el !== document.body && depth < 10) {
      const comp = getComputedStyle(el);
      const className = el.className || '(no class)';
      const tag = el.tagName.toLowerCase();

      result.parents.push({
        depth: depth,
        element: `${tag}.${className}`,
        display: comp.display,
        alignItems: comp.alignItems,
        justifyContent: comp.justifyContent,
        height: comp.height,
        minHeight: comp.minHeight,
        maxHeight: comp.maxHeight,
        flex: comp.flex,
        flexGrow: comp.flexGrow,
        flexShrink: comp.flexShrink,
        flexBasis: comp.flexBasis,
        gridTemplateRows: comp.gridTemplateRows,
        gap: comp.gap,
        overflow: comp.overflow,
      });

      el = el.parentElement;
      depth++;
    }

    return result;
  });

  console.log('\n=== RENDERED .sort-task-card COMPUTED STYLES ===');
  if (result.error) {
    console.error('ERROR:', result.error);
    console.log('Debugging info:', result.debugging);
    await browser.close();
    process.exit(1);
  }

  console.log('\nCARD ELEMENT:');
  Object.entries(result.card).forEach(([key, value]) => {
    console.log(`  ${key}: ${value}`);
  });

  console.log('\n=== PARENT HIERARCHY (bottom to top) ===');
  result.parents.forEach(p => {
    console.log(`\n[${p.depth}] ${p.element}`);
    console.log(`  display: ${p.display}`);
    console.log(`  flex: ${p.flex}`);
    console.log(`  flex-grow: ${p.flexGrow}`);
    console.log(`  flex-shrink: ${p.flexShrink}`);
    console.log(`  flex-basis: ${p.flexBasis}`);
    console.log(`  align-items: ${p.alignItems}`);
    console.log(`  justify-content: ${p.justifyContent}`);
    console.log(`  height: ${p.height}`);
    console.log(`  min-height: ${p.minHeight}`);
    console.log(`  max-height: ${p.maxHeight}`);
    console.log(`  grid-template-rows: ${p.gridTemplateRows}`);
    console.log(`  gap: ${p.gap}`);
    console.log(`  overflow: ${p.overflow}`);
  });

  await browser.close();
})();
