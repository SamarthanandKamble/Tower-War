// Records one build at exactly the required load, for a direct before/after.
//   node scripts/measure-target.mjs --path /baseline/ --out baseline-at-target
import { mkdirSync, writeFileSync } from 'node:fs';
import { launch, passes, startPreview } from './lib.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const path = arg('path', '/baseline/');
const out = arg('out', 'baseline-at-target');
const median = (values) => [...values].sort((a, b) => a - b)[values.length >> 1];

const preview = await startPreview();
const browser = await launch();
const samples = [];
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 860 } });
  await page.goto(`${preview.url}${path}`);
  await page.evaluate(() => window.__bench.setStress(5000, 100, 1000));
  await page.waitForTimeout(8000);
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.__bench.resetStats());
    await page.waitForTimeout(6000);
    samples.push(await page.evaluate(() => window.__bench.report()));
  }
} finally {
  await browser.close();
  preview.stop();
}
const row = {
  path, measuredAt: new Date().toISOString(),
  enemies: samples[2].enemies, towers: samples[2].towers, projectiles: samples[2].projectiles,
  avgFps: +median(samples.map((s) => s.avgFps)).toFixed(1),
  p95Ms: +median(samples.map((s) => s.p95Ms)).toFixed(1),
  pctOver33: +median(samples.map((s) => s.pctOver33)).toFixed(1),
};
row.pass = passes(row);
mkdirSync('docs/perf', { recursive: true });
writeFileSync(`docs/perf/${out}.json`, JSON.stringify(row, null, 2) + '\n');
console.log(JSON.stringify(row));
