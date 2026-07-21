import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  await page.goto('http://localhost:5173/#/ideas', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  const result = await page.evaluate(() => {
    return {
      title: document.title,
      url: window.location.href,
      bodyClasses: document.body.className,
      allDivs: document.querySelectorAll('div[class*="sort"]').length,
      sortElements: Array.from(document.querySelectorAll('[class*="sort"]')).map(el => ({
        tag: el.tagName,
        class: el.className,
        children: el.children.length,
      })).slice(0, 20),
    };
  });

  console.log('Page state:');
  console.log(JSON.stringify(result, null, 2));

  await browser.close();
})();
