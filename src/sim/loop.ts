import { DT } from './world';

/** Longest real time one frame may simulate, so a stall cannot spiral. */
const MAX_FRAME_SECONDS = 0.25;
/** Cap on simulation steps per frame at 1x speed. Scales with game speed. */
const MAX_STEPS_AT_1X = 8;

/**
 * Converts variable display frames into fixed simulation steps. The simulation
 * always advances by DT, so a 30 Hz and a 240 Hz display play the same game.
 * Leftover time becomes `alpha`, used only to interpolate what is drawn.
 */
export class FixedStepper {
  speed = 1;
  paused = false;
  /** Fraction of a step between the last two simulation states, in [0, 1). */
  alpha = 0;
  private accumulator = 0;

  /** Advances by a frame's real duration and returns how many steps were run. */
  advance(frameSeconds: number, step: () => void): number {
    if (this.paused) return 0;
    const clamped = frameSeconds > MAX_FRAME_SECONDS ? MAX_FRAME_SECONDS : frameSeconds;
    this.accumulator += clamped * this.speed;
    const maxSteps = MAX_STEPS_AT_1X * this.speed;
    let steps = 0;
    while (this.accumulator >= DT && steps < maxSteps) {
      step();
      this.accumulator -= DT;
      steps++;
    }
    // Over budget: shed the backlog so the game slows down instead of locking up.
    if (this.accumulator >= DT) this.accumulator = 0;
    this.alpha = this.accumulator / DT;
    return steps;
  }

  reset(): void {
    this.accumulator = 0;
    this.alpha = 0;
  }
}
