// Drives the baseline build through real play controls and reports any failure.
import { launch, startPreview } from './lib.mjs';

const shot = process.argv[2];
const preview = await startPreview();
const browser = await launch();
const failures = [];

try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 860 } });
  page.on('pageerror', (e) => failures.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') failures.push(`console: ${m.text()}`); });

  await page.goto(`${preview.url}/baseline/`);
  const box = await page.locator('#game').boundingBox();
  const tile = (c, r) => ({ x: box.x + ((c + 0.5) / 30) * box.width, y: box.y + ((r + 0.5) / 18) * box.height });
  const stat = async (id) => (await page.locator(`#${id} b`).textContent()).trim();
  const gatling = page.getByRole('button', { name: /Gatling/ });

  // The HUD refreshes on the next animation frame, so checks poll briefly.
  const expectValue = async (label, read, expected) => {
    let actual;
    for (let i = 0; i < 40; i++) {
      actual = await read();
      if (actual === expected) return;
      await page.waitForTimeout(25);
    }
    failures.push(`${label}: got ${actual}, expected ${expected}`);
  };
  const money = () => stat('st-money');

  const spot = tile(5, 5);
  await gatling.click();
  await page.mouse.click(spot.x, spot.y);
  await expectValue('place', money, '200');
  await gatling.click();

  await page.mouse.click(spot.x, spot.y);
  await page.locator('#up').click();
  await expectValue('upgrade', money, '146');
  await page.locator('#sell').click();
  await expectValue('sell', money, String(146 + Math.floor(114 * 0.7)));

  await gatling.click();
  await page.mouse.click(spot.x, spot.y);
  await gatling.click();
  await page.locator('#next').click();
  await expectValue('wave start', () => stat('st-wave'), '1 / 50');
  await page.locator('#speed').click();
  await expectValue('speed', () => page.locator('#speed').textContent(), 'Speed 2x');
  await page.locator('#pause').click();
  await expectValue('pause', () => page.locator('#pause').textContent(), 'Resume');
  await page.locator('#pause').click();
  await page.waitForTimeout(1000);

  await page.locator('#restart').click();
  await expectValue('restart', () => stat('st-wave'), '0 / 50');
  await expectValue('restart money', money, '260');

  await page.evaluate(() => window.__bench.setStress(5000, 100, 1000));
  await page.waitForTimeout(3000);
  const report = await page.evaluate(() => window.__bench.report());
  console.log('stress sample', JSON.stringify(report));
  if (report.enemies !== 5000 || report.towers !== 100 || report.projectiles !== 1000) failures.push('stress counts not held');
  if (shot) await page.screenshot({ path: shot });
} finally {
  await browser.close();
  preview.stop();
}

if (failures.length) {
  console.error('FAILED\n' + failures.join('\n'));
  process.exit(1);
}
console.log('baseline smoke OK');
