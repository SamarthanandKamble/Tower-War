// Ramps entity counts in real Chrome and records where a build stops meeting
// the frame targets. Works on any page exposing the window.__bench contract.
//
//   node scripts/find-breaking-point.mjs --path /baseline/ --out baseline-breaking-point
//
// Each step is the median of several samples after a warm-up, because a single
// sample is noisy: an early run failed 2,000 enemies from JIT and startup noise
// while the same configuration held 60 FPS once repeated.
import { mkdirSync, writeFileSync } from 'node:fs';
import { launch, passes, startPreview } from './lib.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const path = arg('path', '/baseline/');
const out = arg('out', 'baseline-breaking-point');
const throttle = Number(arg('throttle', '1'));
const WARMUP_MS = 8000;
const SETTLE_MS = 1500;
const SAMPLE_MS = 3000;
const SAMPLES = 3;

const scaled = [0.2, 0.4, 0.5, 0.55, 0.6, 0.65, 0.7, 0.8, 1, 1.25, 1.5, 2, 3, 4, 6, 8, 10];
const SERIES = {
  enemies: [2000, 5000, 7500, 10000, 15000, 20000, 30000, 50000].map((e) => [e, 0, 0]),
  towers: [50, 100, 200, 300, 400].map((t) => [5000, t, 0]),
  projectiles: [500, 1000, 2000, 3000, 5000, 7500, 10000].map((p) => [5000, 10, p]),
  combined: scaled.map((s) => [Math.round(5000 * s), Math.round(100 * s), Math.round(1000 * s)]),
};

const median = (values) => [...values].sort((a, b) => a - b)[values.length >> 1];

const preview = await startPreview();
const browser = await launch();
const results = { path, throttle, method: { WARMUP_MS, SETTLE_MS, SAMPLE_MS, SAMPLES }, measuredAt: new Date().toISOString(), series: {} };

try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 860 } });
  // Time spent in rAF callbacks shows JS cost even when vsync hides it.
  await page.addInitScript(() => {
    window.__busy = [];
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => raf((t) => {
      const start = performance.now();
      cb(t);
      window.__busy.push(performance.now() - start);
    });
  });
  await page.goto(`${preview.url}${path}`);
  if (throttle > 1) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  }
  results.displayHz = await page.evaluate(() => new Promise((resolve) => {
    const times = [];
    const tick = (t) => {
      times.push(t);
      if (times.length < 61) requestAnimationFrame(tick);
      else resolve(Math.round(60000 / (times[60] - times[0])));
    };
    requestAnimationFrame(tick);
  }));
  console.log(`display ~${results.displayHz} Hz, build ${await page.evaluate(() => window.__bench.build)}, throttle ${throttle}x`);

  await page.evaluate(() => window.__bench.setStress(5000, 100, 1000));
  await page.waitForTimeout(WARMUP_MS);

  for (const [name, steps] of Object.entries(SERIES)) {
    const rows = [];
    let failuresInARow = 0;
    for (const [enemies, towers, projectiles] of steps) {
      await page.evaluate(([e, t, p]) => window.__bench.setStress(e, t, p), [enemies, towers, projectiles]);
      await page.waitForTimeout(SETTLE_MS);
      const samples = [];
      for (let i = 0; i < SAMPLES; i++) {
        await page.evaluate(() => { window.__bench.resetStats(); window.__busy.length = 0; });
        await page.waitForTimeout(SAMPLE_MS);
        const report = await page.evaluate(() => window.__bench.report());
        report.jsMs = await page.evaluate(() => {
          const sorted = window.__busy.slice().sort((a, b) => a - b);
          return sorted.length ? sorted[sorted.length >> 1] : 0;
        });
        samples.push(report);
      }
      const row = {
        enemies, towers, projectiles,
        avgFps: +median(samples.map((s) => s.avgFps)).toFixed(1),
        p95Ms: +median(samples.map((s) => s.p95Ms)).toFixed(1),
        pctOver33: +median(samples.map((s) => s.pctOver33)).toFixed(1),
        jsMs: +median(samples.map((s) => s.jsMs)).toFixed(2),
      };
      row.pass = passes(row);
      rows.push(row);
      console.log(`${name.padEnd(12)} E${enemies} T${towers} P${projectiles}  fps ${row.avgFps}  p95 ${row.p95Ms}ms  >33ms ${row.pctOver33}%  js ${row.jsMs}ms  ${row.pass ? 'PASS' : 'FAIL'}`);
      failuresInARow = row.pass ? 0 : failuresInARow + 1;
      if (failuresInARow >= 2) break;
    }
    const failIndex = rows.findIndex((r) => !r.pass);
    results.series[name] = {
      lastPass: failIndex === 0 ? null : rows[(failIndex < 0 ? rows.length : failIndex) - 1],
      firstFail: failIndex < 0 ? null : rows[failIndex],
      rows,
    };
  }
} finally {
  await browser.close();
  preview.stop();
}

mkdirSync('docs/perf', { recursive: true });
writeFileSync(`docs/perf/${out}.json`, JSON.stringify(results, null, 2) + '\n');
console.log(`wrote docs/perf/${out}.json`);
