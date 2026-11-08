export interface Sprite {
  u: number;
  v: number;
  uw: number;
  vh: number;
}

/** x, y, w, h, dirX, dirY, u, v, uw, vh, color. */
export const INSTANCE_FLOATS = 11;
export const INSTANCE_BYTES = INSTANCE_FLOATS * 4;
export const MAX_INSTANCES = 1 << 18;

/**
 * Every frame is written into this one preallocated array and handed to a
 * backend. Layers are ordered by write position, and premultiplied color lets
 * additive and normal blending share a single draw call.
 */
export class InstanceBatch {
  readonly floats = new Float32Array(MAX_INSTANCES * INSTANCE_FLOATS);
  readonly uints = new Uint32Array(this.floats.buffer);
  count = 0;

  clear(): void {
    this.count = 0;
  }

  push(x: number, y: number, w: number, h: number, dirX: number, dirY: number, sprite: Sprite, color: number): void {
    if (this.count >= MAX_INSTANCES) return;
    const i = this.count++ * INSTANCE_FLOATS;
    const f = this.floats;
    f[i] = x;
    f[i + 1] = y;
    f[i + 2] = w;
    f[i + 3] = h;
    f[i + 4] = dirX;
    f[i + 5] = dirY;
    f[i + 6] = sprite.u;
    f[i + 7] = sprite.v;
    f[i + 8] = sprite.uw;
    f[i + 9] = sprite.vh;
    this.uints[i + 10] = color;
  }
}

/** Packs a color as premultiplied RGBA bytes for little-endian typed arrays. */
export function rgba(r: number, g: number, b: number, a = 1): number {
  const R = Math.round(Math.min(1, r) * a * 255);
  const G = Math.round(Math.min(1, g) * a * 255);
  const B = Math.round(Math.min(1, b) * a * 255);
  const A = Math.round(a * 255);
  return ((A << 24) | (B << 16) | (G << 8) | R) >>> 0;
}

/** Zero alpha with premultiplied color blends additively. */
export function additive(r: number, g: number, b: number, intensity = 1): number {
  const R = Math.round(Math.min(1, r * intensity) * 255);
  const G = Math.round(Math.min(1, g * intensity) * 255);
  const B = Math.round(Math.min(1, b * intensity) * 255);
  return ((B << 16) | (G << 8) | R) >>> 0;
}

export const WHITE = rgba(1, 1, 1, 1);
