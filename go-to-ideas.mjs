import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  await page.goto('http://localhost:5173/#/plan', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Click the Ideas tab
  const ideasBtn = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('.page-nav-link'));
    const ideasBtn = buttons.find(btn => btn.textContent === 'Ideas');
    return ideasBtn ? true : false;
  });

  if (ideasBtn) {
    await page.click('button.page-nav-link:has-text("Ideas")').catch(() => {
      // Fallback: click by text content
      return page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('.page-nav-link'));
        const btn = buttons.find(b => b.textContent === 'Ideas');
        if (btn) btn.click();
      });
    });
  }

  await page.waitForTimeout(2000);

  const result = await page.evaluate(() => {
    const cards = document.querySelectorAll('.sort-task-card');
    const unassignedList = document.querySelector('.sort-unassigned-list');

    return {
      url: window.location.href,
      taskCardCount: cards.length,
      hasUnassignedList: !!unassignedList,
      pageTitle: document.querySelector('[id*="title"]')?.textContent,
    };
  });

  console.log('After clicking Ideas:');
  console.log(JSON.stringify(result, null, 2));

  await browser.close();
})();
