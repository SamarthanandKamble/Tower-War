import { TILE, type TilePoint } from '../data/map';

const SAMPLE_SPACING = 4;
/** Normals are averaged over this distance so lanes bend smoothly at corners. */
const NORMAL_SMOOTHING = 24;

/**
 * A route baked into evenly spaced samples. An enemy's position is a single
 * distance value, so moving it is a table lookup instead of waypoint steering.
 */
export class BakedPath {
  readonly length: number;
  readonly invSpacing = 1 / SAMPLE_SPACING;
  readonly xs: Float32Array;
  readonly ys: Float32Array;
  readonly nx: Float32Array;
  readonly ny: Float32Array;
  readonly lastIndex: number;

  constructor(tiles: TilePoint[]) {
    const points = tiles.map(([c, r]) => [c * TILE + TILE / 2, r * TILE + TILE / 2]);
    let total = 0;
    const cumulative = [0];
    for (let i = 1; i < points.length; i++) {
      total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
      cumulative.push(total);
    }
    this.length = total;

    const count = Math.ceil(total / SAMPLE_SPACING) + 2;
    this.lastIndex = count - 2;
    this.xs = new Float32Array(count);
    this.ys = new Float32Array(count);
    this.nx = new Float32Array(count);
    this.ny = new Float32Array(count);

    let segment = 0;
    for (let i = 0; i < count; i++) {
      const s = Math.min(i * SAMPLE_SPACING, total);
      while (segment < points.length - 2 && s > cumulative[segment + 1]) segment++;
      const span = cumulative[segment + 1] - cumulative[segment];
      const t = span > 0 ? (s - cumulative[segment]) / span : 0;
      this.xs[i] = points[segment][0] + (points[segment + 1][0] - points[segment][0]) * t;
      this.ys[i] = points[segment][1] + (points[segment + 1][1] - points[segment][1]) * t;
    }

    const reach = Math.max(1, Math.round(NORMAL_SMOOTHING / SAMPLE_SPACING));
    for (let i = 0; i < count; i++) {
      const a = Math.max(0, i - reach);
      const b = Math.min(count - 1, i + reach);
      const dx = this.xs[b] - this.xs[a];
      const dy = this.ys[b] - this.ys[a];
      const len = Math.hypot(dx, dy) || 1;
      this.nx[i] = -dy / len;
      this.ny[i] = dx / len;
    }
  }
}
