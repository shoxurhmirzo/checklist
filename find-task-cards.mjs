import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  await page.goto('http://localhost:5173/#/plan', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const result = await page.evaluate(() => {
    const cards = document.querySelectorAll('.sort-task-card');
    const unassignedList = document.querySelector('.sort-unassigned-list');
    const allSort = Array.from(document.querySelectorAll('[class*="sort"]')).map(el => el.className);

    return {
      taskCardCount: cards.length,
      hasUnassignedList: !!unassignedList,
      allSortClasses: [...new Set(allSort)],
      htmlSnippet: document.body.innerHTML.substring(0, 2000),
    };
  });

  console.log('Task card search results:');
  console.log(`  Found ${result.taskCardCount} .sort-task-card elements`);
  console.log(`  Has .sort-unassigned-list: ${result.hasUnassignedList}`);
  console.log(`  All sort classes: ${result.allSortClasses.join(', ')}`);
  console.log('\nHTML snippet:');
  console.log(result.htmlSnippet);

  await browser.close();
})();
