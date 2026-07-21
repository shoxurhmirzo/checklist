import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Click the Work tab
  await page.click('button.mode-tab:not(.active)');
  await page.waitForTimeout(2000);

  // Wait for ideas view to load
  await page.waitForSelector('[class*="idea"], [class*="divide"], [class*="sort"]', { timeout: 5000 }).catch(() => {
    console.log('No sort/idea elements found after clicking Work tab');
  });

  const result = await page.evaluate(() => {
    return {
      url: window.location.href,
      hasSort: document.querySelectorAll('[class*="sort"]').length > 0,
      hasIdea: document.querySelectorAll('[class*="idea"]').length > 0,
      allClasses: Array.from(document.querySelectorAll('[class]'))
        .map(el => el.className)
        .filter((v, i, a) => a.indexOf(v) === i && v.length > 0 && (v.includes('idea') || v.includes('sort') || v.includes('divide')))
        .slice(0, 30),
    };
  });

  console.log('Work view state:', result);

  await browser.close();
})();
