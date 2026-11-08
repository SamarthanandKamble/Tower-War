# Tower War

A browser tower defense game. Hold the line for 50 waves with five tower types against eight enemy types. It has no runtime dependencies and needs no external services: all art and sound are generated in code.

**Play:** https://samarthanandkamble.github.io/Tower-War/
**Unoptimized first version, for comparison:** https://samarthanandkamble.github.io/Tower-War/baseline/

```
npm install
npm run dev      # development server
npm test         # rules, determinism and balance
npm run build    # production build in dist/
```

Controls: `1`-`5` build, `U` upgrade, `X` sell, `T` targeting, `N` next wave, `F` speed, `Space` pause, scroll to zoom, right-drag to pan. The Stress Lab is on the main menu.

## Architecture

| Folder | Role |
|---|---|
| `src/data/` | Towers, enemies, waves and map, as plain data |
| `src/sim/` | The simulation. No DOM access, so it also runs in Node for tests and the balance bot |
| `src/render/` | Turns simulation state into one sprite stream each frame |
| `src/ui/`, `src/audio/` | DOM HUD and synthesized sound |
| `src/bench/`, `scripts/` | Frame statistics and browser measurement |
| `baseline/` | The first implementation, frozen at tag `v0-baseline` |

The simulation advances in fixed 1/60 s steps from one `requestAnimationFrame` loop. There are no per-entity timers or loops. Rendering interpolates between the last two steps, so refresh rate changes smoothness but never the outcome. Tests confirm identical game state at 30, 60, 75, 120, 144 and 240 Hz and under irregular frame timing.

Entities live in preallocated typed arrays, addressed by a slot number and a generation counter so stale references are detected safely. The simulation sends visual events through a one-way queue and never reads them back, so effects cannot change a game's result.

## Rendering

WebGL2 with instancing. Each frame writes every sprite into one array, uploaded to a ring of three GPU buffers, and draws the whole scene in **2 draw calls**: one for the pre-rendered ground and one for all sprites. Premultiplied color lets normal and additive blending share that call. Sprites come from an atlas drawn in code at startup.

A Canvas2D backend replays the same sprite stream, as a fallback when WebGL2 is unavailable and as a live comparison in the Stress Lab.

Enemy rendering walks only the spatial grid cells touching the camera, so off-screen enemies cost nothing to draw.

## Major bottlenecks

Found by ramping each entity type separately in the first version (details in [the optimization log](docs/perf/optimization-log.md)):

1. **Projectile collision.** Every projectile tested every enemy, every frame. 5,000 enemies with only 500 projectiles already failed.
2. **Tower targeting.** Every tower scanned every enemy, every frame. 5,000 enemies failed at 300 towers.
3. **Draw calls.** One Canvas2D path and fill per entity, plus health bars. Enemies alone failed at 30,000.
4. **Variable timestep and per-entity objects.** Behavior depended on frame rate, and removals used `splice`.

## Optimizations

- Projectiles home on one target through a checked handle, so a hit test is one distance check instead of a scan.
- A counting-sort uniform grid is rebuilt each step in O(n) with no allocation, and serves targeting, splash, chains, auras and culling.
- Towers keep their target and re-evaluate on a staggered schedule, spreading search cost across steps.
- Enemy movement is a table lookup: one distance value along a route baked into evenly spaced samples.
- Typed arrays and swap-removal keep memory contiguous, with no allocation in hot loops.
- Instanced rendering replaces thousands of draw calls with one.
- The HUD writes to the DOM only when a displayed value changes.
- Enemy direction is passed unnormalized to the shader, avoiding a trigonometry call per enemy.

## How performance was measured

All numbers come from real Chrome with GPU rendering, driven by the scripts in `scripts/` against the production build. Raw results are in [`docs/perf/`](docs/perf/). Each ramp step is the median of three samples after a warm-up.

Pass means **95% of frames at 45+ FPS and under 5% of frames over 33 ms**.

Test machine: Apple M5 on a 60 Hz display, so FPS cannot read above 60. The final build was measured at Retina resolution (device pixel ratio 2), filling a 1500x860 window with adaptive resolution disabled. The baseline draws to a fixed 1200x720 canvas.

| Load (enemies / towers / projectiles) | First version | Final |
|---|---|---|
| 3,000 / 60 / 600 | 59.7 FPS, pass | 60 FPS, pass |
| 3,500 / 70 / 700 | 44.8 FPS, **fail** | 60 FPS, pass |
| **5,000 / 100 / 1,000 (required)** | **24.8 FPS, fail** | **60 FPS, pass** |
| 50,000 / 1,000 / 10,000 | not reachable | 60 FPS, pass |
| 60,000 / 1,000 / 12,000 | not reachable | 60 FPS, pass (last pass) |
| 70,000 / 1,000 / 14,000 | not reachable | 30.7 FPS, fail |

The first version's last passing load was 3,000 / 60 / 600. The final build holds 16x those enemies and projectiles at the same mix up to 50,000 / 1,000 / 10,000, then 60,000 / 1,000 / 12,000 once towers stop growing at the 1,000 ramp cap.

Other results at the required load, over 80 seconds of continuous building, upgrading, selling, panning and zooming:

| Check | Result |
|---|---|
| Frame rate, worst 20 s window | 59.6 FPS, p95 17.3 ms, 0.08% of frames over 33 ms |
| With 6x CPU throttling (calibrated) | 60 FPS, p95 17.6 ms, 0% over 33 ms |
| Input until its frame is submitted | Median 32 ms, p95 42 ms |
| Memory, full 50-wave run | JS heap 1.69 to 1.89 MB after forced GC, level from about wave 21 |
| Off-screen cost, 40,000 enemies | Zooming in 6x cut render time from 2.04 ms to 0.35 ms, and sprites from 104,752 to 4,103 |

The memory figure is the JS heap. Entity storage is in typed arrays allocated once at startup, whose backing memory sits outside that figure and does not grow during play.
