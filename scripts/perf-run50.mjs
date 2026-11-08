// Plays a complete 50-wave game in Chrome and tracks memory after forced GC.
//   node scripts/perf-run50.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { launch, startPreview } from './lib.mjs';

const SPEED = 16;
const POLL_MS = 400;
const TIMEOUT_MS = 20 * 60 * 1000;
const SKIP_WAVES = 5;

const preview = await startPreview();
const browser = await launch();
const samples = [];
let outcome;

try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 860 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${preview.url}/`);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');

  await page.evaluate((speed) => {
    window.__bench.startGame(false);
    window.__bench.startAutoplay('strong');
    window.__bench.setSpeed(speed);
  }, SPEED);

  const started = Date.now();
  let lastWave = 0;
  for (;;) {
    const state = await page.evaluate(() => {
      const w = window.__bench.world();
      return { wave: w.waveNumber, phase: w.phase, enemies: w.enemyCount, lives: w.lives };
    });
    if (state.wave !== lastWave || state.phase === 'won' || state.phase === 'lost') {
      lastWave = state.wave;
      await cdp.send('HeapProfiler.collectGarbage');
      const { usedSize } = await cdp.send('Runtime.getHeapUsage');
      samples.push({ wave: state.wave, heapMB: +(usedSize / 1048576).toFixed(2), enemies: state.enemies });
      console.log(`wave ${String(state.wave).padStart(2)}  heap ${(usedSize / 1048576).toFixed(2)} MB  enemies ${state.enemies}  lives ${state.lives}  ${state.phase}`);
    }
    if (state.phase === 'won' || state.phase === 'lost') {
      outcome = state;
      break;
    }
    if (Date.now() - started > TIMEOUT_MS) throw new Error(`Timed out at wave ${state.wave}`);
    await page.waitForTimeout(POLL_MS);
  }
  if (errors.length) throw new Error(`Page errors: ${errors.join('; ')}`);
} finally {
  await browser.close();
  preview.stop();
}

// A leak shows up as a positive slope once startup allocation has settled.
const settled = samples.filter((s) => s.wave > SKIP_WAVES);
const n = settled.length;
const meanX = settled.reduce((a, s) => a + s.wave, 0) / n;
const meanY = settled.reduce((a, s) => a + s.heapMB, 0) / n;
const slope = settled.reduce((a, s) => a + (s.wave - meanX) * (s.heapMB - meanY), 0) / settled.reduce((a, s) => a + (s.wave - meanX) ** 2, 0);
const heaps = settled.map((s) => s.heapMB);
const summary = {
  measuredAt: new Date().toISOString(), outcome, speed: SPEED,
  minHeapMB: Math.min(...heaps), maxHeapMB: Math.max(...heaps),
  slopeKBPerWave: +(slope * 1024).toFixed(2),
  samples,
};
mkdirSync('docs/perf', { recursive: true });
writeFileSync('docs/perf/memory-run.json', JSON.stringify(summary, null, 2) + '\n');
console.log(`outcome ${outcome.phase} at wave ${outcome.wave}. heap ${summary.minHeapMB}-${summary.maxHeapMB} MB, slope ${summary.slopeKBPerWave} KB/wave`);
