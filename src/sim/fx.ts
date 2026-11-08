export const enum FxKind {
  Muzzle,
  Hit,
  Explosion,
  Kill,
  Damage,
  Beam,
  Arc,
  Pulse,
  Leak,
  WaveClear,
}

const STRIDE = 6;
const CAPACITY = 8192;

/**
 * One-way ring of visual events from the simulation to the presentation layer.
 * Nothing in the simulation reads it back, so dropping events under load can
 * never change the outcome of a game.
 */
export class FxQueue {
  readonly data = new Float32Array(CAPACITY * STRIDE);
  readonly stride = STRIDE;
  private head = 0;
  private count = 0;

  push(kind: FxKind, x: number, y: number, a = 0, b = 0, c = 0): void {
    if (this.count === CAPACITY) return;
    const i = ((this.head + this.count) % CAPACITY) * STRIDE;
    this.data[i] = kind;
    this.data[i + 1] = x;
    this.data[i + 2] = y;
    this.data[i + 3] = a;
    this.data[i + 4] = b;
    this.data[i + 5] = c;
    this.count++;
  }

  /** Offset of the next event in `data`, or -1 when the queue is empty. */
  shift(): number {
    if (this.count === 0) return -1;
    const offset = this.head * STRIDE;
    this.head = (this.head + 1) % CAPACITY;
    this.count--;
    return offset;
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
  }
}
