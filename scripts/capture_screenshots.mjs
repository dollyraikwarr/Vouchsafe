/**
 * Playwright screenshot capture script for Vouchsafe documentation
 */
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const OUTPUT_DIR = './docs/images';

async function captureScreenshots() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  console.log('Navigating to http://localhost:8000 ...');
  await page.goto('http://localhost:8000', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // 1. Full page / hero section
  await page.screenshot({
    path: path.join(OUTPUT_DIR, '00_landing_page.png'),
    fullPage: false,
  });
  console.log('✅ Screenshot 1: Landing page hero');

  // 2. Scroll to #app section (dashboard)
  await page.evaluate(() => {
    const appSection = document.getElementById('app');
    if (appSection) appSection.scrollIntoView({ behavior: 'instant' });
  });
  await page.waitForTimeout(800);
  await page.screenshot({
    path: path.join(OUTPUT_DIR, '01_wallet_connected.png'),
    fullPage: false,
  });
  console.log('✅ Screenshot 2: App dashboard - pre-connect (wallet connected state)');

  // 3. Click Connect Wallet - capture modal
  const connectBtn = page.locator('#connectWalletBtn');
  if (await connectBtn.isVisible()) {
    await connectBtn.click();
    await page.waitForTimeout(2500);
    await page.screenshot({
      path: path.join(OUTPUT_DIR, '02_wallet_modal.png'),
      fullPage: false,
    });
    console.log('✅ Screenshot 3: Wallet selection modal');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
  }

  // 4. Scroll back to dashboard - show config + form
  await page.evaluate(() => {
    const appSection = document.getElementById('app');
    if (appSection) appSection.scrollIntoView({ behavior: 'instant' });
  });
  await page.waitForTimeout(800);
  await page.screenshot({
    path: path.join(OUTPUT_DIR, '02_balance_displayed.png'),
    fullPage: false,
  });
  console.log('✅ Screenshot 4: Dashboard with Configuration, Create Engagement form');

  // 5. Full dashboard scrolled down to show tx log table
  await page.evaluate(() => window.scrollBy(0, 600));
  await page.waitForTimeout(800);
  await page.screenshot({
    path: path.join(OUTPUT_DIR, '03_successful_transaction.png'),
    fullPage: false,
  });
  console.log('✅ Screenshot 5: Dashboard with Engagement Details & Transaction Log');

  // 6. Full page screenshot
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
  await page.screenshot({
    path: path.join(OUTPUT_DIR, '04_full_app.png'),
    fullPage: true,
  });
  console.log('✅ Screenshot 6: Full page');

  await browser.close();
  console.log('\n✅ All screenshots saved to', OUTPUT_DIR);
}

captureScreenshots().catch((err) => {
  console.error('Screenshot capture failed:', err);
  process.exit(1);
});
