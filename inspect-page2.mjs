import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const result = await page.evaluate(() => {
    return {
      url: window.location.href,
      bodyHTML: document.body.innerHTML.substring(0, 1000),
      allClasses: Array.from(document.querySelectorAll('[class]'))
        .map(el => el.className)
        .filter((v, i, a) => a.indexOf(v) === i && v.length > 0)
        .slice(0, 30),
    };
  });

  console.log('Initial page:');
  console.log(JSON.stringify(result, null, 2));

  // Try to click the ideas button
  await page.waitForSelector('a, button', { timeout: 5000 }).catch(() => null);
  const links = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a, button'))
      .slice(0, 10)
      .map(el => ({ text: el.textContent.substring(0, 30), href: el.href || el.className }));
  });

  console.log('\nAvailable links/buttons:', links);

  await browser.close();
})();
