// The stress requirement measured directly: 5,000 enemies, 100 towers and 1,000
// projectiles held for over a minute while a player keeps interacting.
//   node scripts/perf-stress.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { launch, passes, startPreview } from './lib.mjs';

const TARGET = [5000, 100, 1000];
const WINDOW_MS = 20000;
const WINDOWS = 4;
const DPR = 2;

async function openLab(browser, url, throttle) {
  const context = await browser.newContext({ viewport: { width: 1500, height: 860 }, deviceScaleFactor: DPR });
  const page = await context.newPage();
  await page.goto(`${url}/`);
  const cdp = await context.newCDPSession(page);
  if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  await page.evaluate(([e, t, p]) => {
    window.__bench.setStress(e, t, p);
    window.__bench.setOptions({ adaptiveResolution: false });
  }, TARGET);
  await page.waitForTimeout(6000);
  return { page, context };
}

/** Records the delay from each input event until the frame showing it has been submitted. */
const installLatencyProbe = (page) => page.evaluate(() => {
  window.__latency = [];
  const stage = document.getElementById('stage');
  for (const type of ['pointerdown', 'pointermove', 'wheel']) {
    stage.addEventListener(type, (e) => {
      requestAnimationFrame(() => {
        requestAnimationFrame((next) => window.__latency.push(next - e.timeStamp));
      });
    }, { passive: true });
  }
});

const tile = (page, c, r) => page.evaluate(([c, r]) => {
  const cam = window.__bench.camera();
  return { x: ((c + 0.5) * 40 - cam.x) * cam.zoom, y: ((r + 0.5) * 40 - cam.y) * cam.zoom };
}, [c, r]);

/** Plays like a person for one window: hover, zoom, pan, build, upgrade, sell. */
async function interact(page, durationMs) {
  const end = Date.now() + durationMs;
  let built = 0;
  let upgraded = 0;
  let sold = 0;
  let tick = 0;
  // Interior tiles along the map's upper edge that the stress layout leaves free are found live.
  const findFree = () => page.evaluate(() => {
    const w = window.__bench.world();
    for (let t = 0; t < 48 * 28; t++) if (w.blocked[t] === 0 && w.occupied[t] === 0) return [t % 48, Math.floor(t / 48)];
    return null;
  });
  while (Date.now() < end) {
    const step = tick++ % 6;
    if (step === 0) {
      await page.evaluate(() => window.__bench.fit());
      await page.mouse.move(400 + (tick % 40) * 18, 260 + (tick % 13) * 28, { steps: 6 });
    } else if (step === 1) {
      await page.mouse.wheel(0, -240);
    } else if (step === 2) {
      await page.mouse.down({ button: 'right' });
      await page.mouse.move(650, 420, { steps: 8 });
      await page.mouse.up({ button: 'right' });
    } else if (step === 3) {
      await page.evaluate(() => window.__bench.fit());
      const free = await findFree();
      if (free) {
        const before = await page.evaluate(() => window.__bench.world().towerCount);
        const spot = await tile(page, free[0], free[1]);
        await page.keyboard.press('1');
        await page.mouse.click(spot.x, spot.y);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(40);
        if ((await page.evaluate(() => window.__bench.world().towerCount)) === before + 1) built++;
      }
    } else if (step === 4) {
      const t = await page.evaluate(() => {
        const w = window.__bench.world();
        for (let d = 0; d < w.towerCount; d++) if (w.tLevel[w.tDense[d]] < 3) return [w.tCol[w.tDense[d]], w.tRow[w.tDense[d]]];
        return null;
      });
      if (t) {
        const spot = await tile(page, t[0], t[1]);
        await page.mouse.click(spot.x, spot.y);
        await page.waitForTimeout(40);
        const button = page.locator('#s-up');
        if (await button.isEnabled().catch(() => false)) {
          await button.click();
          upgraded++;
        }
      }
    } else {
      const button = page.locator('#s-sell');
      if (await button.isVisible().catch(() => false)) {
        await button.click();
        sold++;
      }
    }
    await page.waitForTimeout(150);
  }
  return { built, upgraded, sold };
}

const readWindow = (page) => page.evaluate(() => window.__bench.report());

const preview = await startPreview();
const browser = await launch();
const out = { measuredAt: new Date().toISOString(), dpr: DPR, viewport: '1500x860', target: TARGET, runs: {} };

try {
  for (const throttle of [1, 6]) {
    const { page, context } = await openLab(browser, preview.url, throttle);
    // Proof the throttle is really applied: a fixed workload must slow down in step.
    const calibrationMs = await page.evaluate(() => {
      const times = [];
      for (let n = 0; n < 15; n++) {
        const start = performance.now();
        let x = 0;
        for (let i = 0; i < 12_000_000; i++) x = (x + Math.imul(i, 31)) | 0;
        times.push(performance.now() - start + (x & 0));
      }
      return times.sort((a, b) => a - b)[7];
    });
    console.log(`${throttle}x CPU calibration workload ${calibrationMs.toFixed(1)}ms`);
    await installLatencyProbe(page);
    const windows = [];
    const actions = { built: 0, upgraded: 0, sold: 0 };
    for (let i = 0; i < WINDOWS; i++) {
      await page.evaluate(() => window.__bench.resetStats());
      const result = await interact(page, WINDOW_MS);
      Object.keys(actions).forEach((k) => { actions[k] += result[k]; });
      const r = await readWindow(page);
      windows.push(r);
      console.log(`${throttle}x CPU window ${i + 1}: fps ${r.avgFps.toFixed(1)}  p95 ${r.p95Ms.toFixed(1)}ms  >33ms ${r.pctOver33.toFixed(2)}%  sim ${r.simMs.toFixed(2)}ms  render ${r.renderMs.toFixed(2)}ms  E${r.enemies} T${r.towers} P${r.projectiles}  ${passes(r) ? 'PASS' : 'FAIL'}`);
    }
    const latency = await page.evaluate(() => window.__latency.slice().sort((a, b) => a - b));
    out.runs[`cpu${throttle}x`] = {
      calibrationMs: +calibrationMs.toFixed(1),
      windows: windows.map((r) => ({ avgFps: +r.avgFps.toFixed(1), p95Ms: +r.p95Ms.toFixed(1), pctOver33: +r.pctOver33.toFixed(2), simMs: +r.simMs.toFixed(2), renderMs: +r.renderMs.toFixed(2), frames: r.frames, enemies: r.enemies, towers: r.towers, projectiles: r.projectiles, pass: passes(r) })),
      allWindowsPass: windows.every(passes),
      actions,
      inputToFrameMs: { samples: latency.length, median: +latency[latency.length >> 1].toFixed(1), p95: +latency[Math.floor(latency.length * 0.95)].toFixed(1) },
    };
    console.log(`  input-to-frame median ${out.runs[`cpu${throttle}x`].inputToFrameMs.median}ms  p95 ${out.runs[`cpu${throttle}x`].inputToFrameMs.p95}ms  actions ${JSON.stringify(actions)}`);
    await context.close();
  }

  // What each technique contributes, and whether off-screen enemies cost anything.
  const { page, context } = await openLab(browser, preview.url, 1);
  const measure = async () => {
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.__bench.resetStats());
    await page.waitForTimeout(6000);
    const r = await readWindow(page);
    return { avgFps: +r.avgFps.toFixed(1), p95Ms: +r.p95Ms.toFixed(1), pctOver33: +r.pctOver33.toFixed(1), simMs: +r.simMs.toFixed(2), renderMs: +r.renderMs.toFixed(2), sprites: r.sprites, drawnEnemies: r.drawnEnemies, culledEnemies: r.culledEnemies, drawCalls: r.drawCalls, pass: passes(r) };
  };
  const set = (options) => page.evaluate((o) => window.__bench.setOptions(o), options);
  const stress = (e, t, p) => page.evaluate(([e, t, p]) => window.__bench.setStress(e, t, p), [e, t, p]);
  const report = (label, r) => console.log(`${label.padEnd(44)} fps ${r.avgFps}  p95 ${r.p95Ms}ms  sim ${r.simMs}ms  render ${r.renderMs}ms  sprites ${r.sprites}  drawn ${r.drawnEnemies}  calls ${r.drawCalls}`);

  out.toggles = {};
  out.toggles.allOn = await measure();
  report('target, all optimizations', out.toggles.allOn);
  await set({ spatialGrid: false });
  out.toggles.noGrid = await measure();
  report('target, spatial grid off', out.toggles.noGrid);
  await set({ spatialGrid: true, webgl: false });
  out.toggles.canvas2d = await measure();
  report('target, Canvas2D instead of instancing', out.toggles.canvas2d);
  await set({ webgl: true });

  await stress(40000, 100, 1000);
  await page.evaluate(() => window.__bench.fit());
  out.offscreen = {};
  out.offscreen.fullMap = await measure();
  report('40k enemies, whole map visible', out.offscreen.fullMap);
  await page.evaluate(() => window.__bench.zoomTo(6));
  out.offscreen.zoomedIn = await measure();
  report('40k enemies, zoomed in 6x, culling on', out.offscreen.zoomedIn);
  await set({ culling: false });
  out.offscreen.zoomedInNoCull = await measure();
  report('40k enemies, zoomed in 6x, culling off', out.offscreen.zoomedInNoCull);
  await context.close();
} finally {
  await browser.close();
  preview.stop();
}

mkdirSync('docs/perf', { recursive: true });
writeFileSync('docs/perf/stress-run.json', JSON.stringify(out, null, 2) + '\n');
console.log('wrote docs/perf/stress-run.json');
