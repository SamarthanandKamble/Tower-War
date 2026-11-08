// Measures what each optimization contributes at 5x the required load.
//   node scripts/measure-toggles.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { launch, passes, startPreview } from './lib.mjs';

const LOAD = [25000, 500, 5000];
const preview = await startPreview();
const browser = await launch();
const results = { measuredAt: new Date().toISOString(), load: LOAD, dpr: 2, cases: {} };

try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 860 }, deviceScaleFactor: 2 });
  await page.goto(`${preview.url}/`);
  await page.evaluate((load) => {
    window.__bench.setStress(...load);
    window.__bench.setOptions({ adaptiveResolution: false });
  }, LOAD);
  await page.waitForTimeout(8000);

  const measure = async (name, options) => {
    await page.evaluate((o) => window.__bench.setOptions(o), options);
    await page.waitForTimeout(2500);
    await page.evaluate(() => window.__bench.resetStats());
    await page.waitForTimeout(6000);
    const r = await page.evaluate(() => window.__bench.report());
    const row = { avgFps: +r.avgFps.toFixed(1), p95Ms: +r.p95Ms.toFixed(1), pctOver33: +r.pctOver33.toFixed(1), simMs: +r.simMs.toFixed(2), renderMs: +r.renderMs.toFixed(2), drawCalls: r.drawCalls, pass: passes(r) };
    results.cases[name] = row;
    console.log(name.padEnd(24), JSON.stringify(row));
  };

  await measure('allOn', {});
  await measure('spatialGridOff', { spatialGrid: false });
  await measure('canvas2d', { spatialGrid: true, webgl: false });
  await measure('allOnAgain', { webgl: true });
} finally {
  await browser.close();
  preview.stop();
}
mkdirSync('docs/perf', { recursive: true });
writeFileSync('docs/perf/toggles-at-5x.json', JSON.stringify(results, null, 2) + '\n');
