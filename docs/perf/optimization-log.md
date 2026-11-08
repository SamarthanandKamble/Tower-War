# Optimization log

Apple M5, 60 Hz display, real Chrome. Pass means 95% of frames at 45+ FPS and under 5% of frames over 33 ms. Each ramp step is the median of three samples after a warm-up. Source data is in the JSON files in this folder.

## Where the first version broke

From `baseline-breaking-point.json`:

| Series | Last pass | First fail |
|---|---|---|
| Combined mix | 3,000 / 60 / 600 at 59.7 FPS | 3,250 / 65 / 650 at 51.1 FPS, 16.2% over 33 ms |
| Projectiles (5,000 enemies, 10 towers) | none tested | 500 projectiles at 48.7 FPS |
| Towers (5,000 enemies) | 200 towers | 300 towers at 46.7 FPS |
| Enemies only | 20,000 | 30,000 at 45.5 FPS |

At the required 5,000 / 100 / 1,000 it ran at 24.8 FPS with every frame over 33 ms (`baseline-at-target.json`).

The cost was JavaScript, not the GPU: main-thread work per frame reached 40 ms at the required load, against a 16.7 ms budget at 60 FPS.

## A measurement mistake worth keeping

The first ramp said 2,000 enemies alone failed, yet 3,000 enemies plus towers and projectiles passed. More work cannot be cheaper. Repeating the same loads showed 2,000 enemies holding 60 FPS, so the failure was startup noise. The ramp now warms up first and takes a median of three samples.

## What changed

| Technique | Cost it removed |
|---|---|
| Homing projectiles with a checked target handle | Each projectile tested all enemies, every frame |
| Target retention and staggered retargeting | Each tower scanned all enemies, every frame |
| Counting-sort uniform grid | Whole-population scans for targeting, splash, chains, auras and culling |
| Path table lookup | Waypoint steering and square roots per enemy |
| Typed arrays with swap-removal | Object overhead, GC pressure and `splice` shifting |
| WebGL2 instancing | One Canvas2D draw per sprite |
| Grid-driven viewport culling | Drawing enemies outside the camera |
| Fixed timestep with interpolation | Simulation behavior tied to refresh rate |

These landed together in the simulation rewrite, so there is no separate commit-by-commit delta for each. The contributions below come from switching techniques off in the final build.

## What each technique contributes now

At 5x the required load, 25,000 / 500 / 5,000 (`toggles-at-5x.json`):

| Configuration | FPS | Sim | Render submission | Draw calls | Result |
|---|---|---|---|---|---|
| All on | 60 | 3.91 ms | 1.51 ms | 2 | Pass |
| Spatial grid off | 60 | 8.89 ms | 1.04 ms | 2 | Pass |
| Canvas2D instead of instancing | 15.7 | 9.43 ms | 45.74 ms | 77,126 | **Fail** |

Instancing is the largest single win at high counts. The spatial grid more than halves simulation cost, but its effect is smaller than expected because retargeting and single-target hit tests already removed most of the scans. At the required load, Canvas2D would still hold 60 FPS on this machine (`stress-run.json`), at 7.33 ms of render submission instead of 1.33 ms.

Simulation timings vary from run to run at low load. Sim time at the required load ranged from about 0.2 to 1.2 ms across runs, and did not rise under CPU throttling. Those readings are not precise enough to compare small differences, so pass or fail is decided from frame times.

## Final limits

From `final-breaking-point.json`, Retina resolution:

| Series | Last pass | First fail |
|---|---|---|
| Combined mix | 60,000 / 1,000 / 12,000 at 60 FPS | 70,000 / 1,000 / 14,000 at 30.7 FPS |
| Enemies only | 100,000 (highest tested) | none reached |
| Towers (5,000 enemies) | 1,000 (highest tested) | none reached |
| Projectiles (5,000 enemies, 10 towers) | 40,000 (highest tested) | none reached |

Beyond 10x the tower count stays at the 1,000 ramp cap, so loads past 50,000 / 1,000 / 10,000 are no longer the exact required mix.

The final limit is simulation time on the main thread: 29.87 ms at the failing load, compared with 2.75 ms for render submission. The next step would be moving the simulation to a worker, which the typed-array storage makes straightforward. It was not needed to meet the requirement.
