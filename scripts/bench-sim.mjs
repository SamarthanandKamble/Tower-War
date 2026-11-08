// Measures simulation cost per tick in Node, with no rendering or browser noise.
//   node scripts/bench-sim.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const { World } = await server.ssrLoadModule('/src/sim/world.ts');

const WARMUP_TICKS = 600;
const MEASURE_TICKS = 900;
const CASES = [
  [5000, 100, 1000],
  [10000, 200, 2000],
  [25000, 200, 5000],
  [50000, 300, 10000],
  [100000, 400, 20000],
];

const results = [];
for (const [enemies, towers, projectiles] of CASES) {
  for (const spatialGrid of [true, false]) {
    if (!spatialGrid && enemies > 10000) continue;
    const world = new World(1);
    world.options.spatialGrid = spatialGrid;
    world.setStress({ enemies, towers, projectiles });
    for (let i = 0; i < WARMUP_TICKS; i++) world.step();
    const times = new Float64Array(MEASURE_TICKS);
    for (let i = 0; i < MEASURE_TICKS; i++) {
      const start = performance.now();
      world.step();
      times[i] = performance.now() - start;
      world.fx.clear();
    }
    const sorted = Array.from(times).sort((a, b) => a - b);
    const row = {
      enemies, towers, projectiles, spatialGrid,
      medianMs: +sorted[sorted.length >> 1].toFixed(3),
      p95Ms: +sorted[Math.floor(sorted.length * 0.95)].toFixed(3),
      maxMs: +sorted[sorted.length - 1].toFixed(3),
    };
    results.push(row);
    console.log(`E${enemies} T${towers} P${projectiles} grid=${spatialGrid}  median ${row.medianMs}ms  p95 ${row.p95Ms}ms  max ${row.maxMs}ms`);
  }
}
await server.close();

mkdirSync('docs/perf', { recursive: true });
writeFileSync('docs/perf/sim-bench.json', JSON.stringify({ measuredAt: new Date().toISOString(), node: process.version, WARMUP_TICKS, MEASURE_TICKS, results }, null, 2) + '\n');
console.log('wrote docs/perf/sim-bench.json');
