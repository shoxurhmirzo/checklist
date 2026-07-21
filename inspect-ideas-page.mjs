import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  await page.goto('http://localhost:5173/#/ideas', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const result = await page.evaluate(() => {
    return {
      bodyClasses: document.body.className,
      mainClasses: document.querySelector('main')?.className,
      mainHTML: document.querySelector('main')?.innerHTML.substring(0, 3000),
      allElements: Array.from(document.querySelectorAll('*')).map(el => ({
        tag: el.tagName,
        class: el.className,
      })).slice(0, 50),
    };
  });

  console.log('Ideas page structure:');
  console.log(result.mainHTML);

  await browser.close();
})();
