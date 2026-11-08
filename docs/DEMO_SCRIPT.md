# Demo video script (about 3.5 minutes)

Camera on, English, recording the browser.

**Before recording**
- Open two tabs and let each load:
  - Game: https://samarthanandkamble.github.io/Tower-War/
  - Baseline: https://samarthanandkamble.github.io/Tower-War/baseline/
- Close heavy apps and do one rehearsal. Screen recording uses CPU, so your numbers may differ a little from the ones here. Say what the screen shows on the day.

---

## 1. Intro (15 seconds)

> "This is Tower War, a 50-wave tower defense game that runs entirely in the browser. The goal was 5,000 enemies, 100 towers and 1,000 projectiles at a steady 45 FPS or better. I'll show where the first version broke, how I fixed it, and how far it goes now."

Play for a few seconds if you like: click **Play: Normal**, place a tower, send a wave.

## 2. Where the first version breaks (60 seconds)

Go to the **Baseline** tab. The FPS readout is at the top left.

Set the sliders to **3,000 enemies, 60 towers, 600 projectiles**, then click **Run stress**.

> "This is the first implementation, written the straightforward way. At 3,000 enemies, 60 towers and 600 projectiles it just holds 60 FPS."

Move the sliders to **3,500 / 70 / 700** and wait a few seconds.

> "A small increase and it falls below target, around 45 FPS, with lots of frames over 33 milliseconds. That's the breaking point."

Move the sliders to **5,000 / 100 / 1,000**.

> "At the actual requirement it runs at about 25 FPS, and every frame misses the budget. You can see it stuttering."

## 3. How it was optimized (70 seconds)

> "Profiling showed the cost was in JavaScript. Every projectile checked every enemy each frame, and every tower scanned every enemy each frame. That's multiplication: thousands times thousands of distance checks."

> "So first, the simulation. Projectiles now track a single target, so a hit test is one check. Towers keep their target and re-check on a staggered schedule. Everything else uses a uniform spatial grid, rebuilt every step in linear time. Entities live in flat typed arrays, so there's no garbage collection pressure, and enemy movement is just a table lookup along the path."

> "Second, rendering. Instead of thousands of Canvas draw calls, every sprite goes into one buffer and WebGL2 draws it with instancing."

> "And a fixed 60 Hz timestep means the game plays identically on any display."

Go to the **Game** tab, open **Stress Lab**, and click **5x** (25,000 / 500 / 5,000). Point to the 60 FPS and **2 draw calls** at the bottom right.

Uncheck **WebGL2 instancing**.

> "I can turn each optimization off live. Without instancing, at this load, draw calls jump to about 77,000 and it collapses to about 16 FPS."

Check it again.

> "And back to 60."

Scroll to zoom in on part of the map. Point to the **culled** count.

> "Enemies outside the view are culled, so render cost follows what's on screen."

## 4. The final limits (45 seconds)

Click **Target**.

> "Here's the actual requirement: 5,000, 100 and 1,000, at a locked 60 FPS on a Retina canvas, using about a millisecond each for simulation and rendering."

Click **10x**.

> "Ten times the requirement: 50,000 enemies, 1,000 towers, 10,000 projectiles. Still 60."

Drag the sliders to **60,000 enemies** and **12,000 projectiles**.

> "60,000 enemies and 12,000 projectiles still holds."

Drag them to **70,000** and **14,000**.

> "And at 70,000 it finally breaks, to around 30 FPS. The limit now is simulation time on the main thread."

> "So the first version broke at 3,000 enemies and the final one holds 60,000: twenty times more, while also meeting the memory and input targets. Thanks for watching."

---

**Numbers behind this script** are in `docs/perf/`. Measured on an Apple M5 with a 60 Hz display.
