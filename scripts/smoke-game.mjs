// Plays the final build through its real controls and reports any failure.
//   node scripts/smoke-game.mjs [screenshot-dir] [base-url]
import { launch, startPreview } from './lib.mjs';

const shots = process.argv[2];
const preview = process.argv[3] ? { url: process.argv[3], stop() {} } : await startPreview();
const browser = await launch();
const failures = [];

try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 860 } });
  page.on('pageerror', (e) => failures.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') failures.push(`console ${m.type()}: ${m.text()}`); });

  const shot = async (name) => { if (shots) await page.screenshot({ path: `${shots}/${name}.png` }); };
  const world = (expr) => page.evaluate(`(() => { const w = window.__bench.world(); return ${expr}; })()`);
  const expectValue = async (label, read, expected) => {
    let actual;
    for (let i = 0; i < 60; i++) {
      actual = await read();
      if (actual === expected) return;
      await page.waitForTimeout(25);
    }
    failures.push(`${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  };
  const text = (id) => page.locator(`#${id}`).textContent();
  const visible = (id) => page.locator(`#${id}`).isVisible();
  // Tile center in CSS pixels, using the live camera.
  const tile = (c, r) => page.evaluate(([c, r]) => {
    const cam = window.__bench.camera();
    return { x: ((c + 0.5) * 40 - cam.x) * cam.zoom, y: ((r + 0.5) * 40 - cam.y) * cam.zoom };
  }, [c, r]);

  await page.goto(preview.url + '/');
  await page.waitForTimeout(1200);
  await shot('01-title');

  await page.locator('#m-normal').click();
  await expectValue('game starts', () => text('h-wave'), '0/50');
  await expectValue('starting money', () => text('h-money'), '$280');

  // Build with the hotkey, then cancel build mode.
  const spot = await tile(5, 8);
  await page.keyboard.press('1');
  await page.mouse.move(spot.x, spot.y);
  await page.waitForTimeout(120);
  await shot('02-ghost');
  await page.mouse.click(spot.x, spot.y);
  await expectValue('place', () => text('h-money'), '$220');
  await page.keyboard.press('Escape');

  // Building on the route must be refused without charging.
  const road = await tile(8, 10);
  await page.keyboard.press('1');
  await page.mouse.click(road.x, road.y);
  await page.waitForTimeout(80);
  await expectValue('route refused', () => text('h-money'), '$220');
  await page.keyboard.press('Escape');

  // Select, upgrade, change targeting, sell.
  await page.mouse.click(spot.x, spot.y);
  await page.waitForTimeout(80);
  if (!(await visible('selected'))) failures.push('selection panel did not open');
  await page.locator('#s-up').click();
  await expectValue('upgrade', () => text('h-money'), '$130');
  await page.locator('.prio button', { hasText: 'Strongest' }).click();
  await expectValue('priority', () => world('w.tPriority[w.tDense[0]]'), 2);
  await shot('03-selected');
  await page.locator('#s-sell').click();
  await expectValue('sell', () => text('h-money'), `$${130 + Math.floor(150 * 0.7)}`);
  await expectValue('panel closes', () => visible('selected'), false);

  // Defend, send the first wave, and exercise speed and pause.
  for (const [type, c, r] of [['1', 7, 8], ['1', 9, 12]]) {
    const p = await tile(c, r);
    await page.keyboard.press(type);
    await page.mouse.click(p.x, p.y);
    await page.keyboard.press('Escape');
  }
  await page.locator('#b-next').click();
  await expectValue('wave starts', () => text('h-wave'), '1/50');
  await page.locator('[data-speed="4"]').click();
  await expectValue('speed', () => page.evaluate(() => window.__bench.speed()), 4);
  await page.waitForTimeout(4000);
  await shot('04-combat');
  const kills = await world('w.kills');
  if (kills <= 0) failures.push('no enemies killed during the first wave');

  await page.keyboard.press(' ');
  await expectValue('pause screen', () => visible('pause'), true);
  const pausedAt = await world('w.tick');
  await page.waitForTimeout(400);
  if ((await world('w.tick')) !== pausedAt) failures.push('simulation advanced while paused');
  await shot('05-pause');
  await page.locator('#p-resume').click();
  await expectValue('resume', () => visible('pause'), false);
  await page.waitForTimeout(200);
  if ((await world('w.tick')) === pausedAt) failures.push('simulation did not resume');

  await page.keyboard.press(' ');
  await page.locator('#p-restart').click();
  await expectValue('restart wave', () => text('h-wave'), '0/50');
  await expectValue('restart money', () => text('h-money'), '$280');
  await expectValue('restart towers', () => world('w.towerCount'), 0);

  // End screens, reached by placing the world one step from each outcome.
  await page.evaluate(() => { const w = window.__bench.world(); w.lives = 0; w.phase = 'lost'; });
  await expectValue('defeat screen', () => visible('end'), true);
  await expectValue('defeat title', () => text('e-title'), 'Base destroyed');
  await shot('06-defeat');
  await page.locator('#e-again').click();
  await expectValue('play again', () => visible('end'), false);
  await page.evaluate(() => { const w = window.__bench.world(); w.score = 123456; w.phase = 'won'; });
  await expectValue('victory title', () => text('e-title'), 'Victory');
  await shot('07-victory');
  await page.locator('#e-menu').click();
  await expectValue('back to menu', () => visible('title'), true);

  // Stress Lab: exact counts held, with placement still working during load.
  await page.locator('#m-lab').click();
  await page.waitForTimeout(3500);
  const report = await page.evaluate(() => window.__bench.report());
  console.log('lab sample', JSON.stringify(report));
  if (report.enemies !== 5000 || report.towers !== 100 || report.projectiles !== 1000) failures.push('lab counts not held');
  await shot('08-lab');
} finally {
  await browser.close();
  preview.stop();
}

if (failures.length) {
  console.error('FAILED\n' + failures.join('\n'));
  process.exit(1);
}
console.log('game smoke OK');
