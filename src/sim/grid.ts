/**
 * Uniform grid rebuilt with a counting sort. Entities in a cell end up adjacent
 * in one flat array, so a rebuild is O(n), allocates nothing, and queries read
 * contiguous memory.
 */
export class UniformGrid {
  readonly cols: number;
  readonly rows: number;
  readonly cellSize: number;
  readonly invCell: number;
  /** cellStart[c]..cellStart[c + 1] indexes items in cell c. */
  readonly cellStart: Int32Array;
  readonly items: Int32Array;
  private readonly cellOf: Int32Array;

  constructor(width: number, height: number, cellSize: number, capacity: number) {
    this.cellSize = cellSize;
    this.invCell = 1 / cellSize;
    this.cols = Math.ceil(width / cellSize);
    this.rows = Math.ceil(height / cellSize);
    this.cellStart = new Int32Array(this.cols * this.rows + 1);
    this.items = new Int32Array(capacity);
    this.cellOf = new Int32Array(capacity);
  }

  rebuild(ids: Int32Array, count: number, xs: Float32Array, ys: Float32Array): void {
    const { cols, rows, invCell, cellStart, items, cellOf } = this;
    cellStart.fill(0);
    for (let i = 0; i < count; i++) {
      const id = ids[i];
      let cx = (xs[id] * invCell) | 0;
      let cy = (ys[id] * invCell) | 0;
      // Enemies enter from off the map, so positions are clamped into the grid.
      if (cx < 0) cx = 0;
      else if (cx >= cols) cx = cols - 1;
      if (cy < 0) cy = 0;
      else if (cy >= rows) cy = rows - 1;
      const cell = cy * cols + cx;
      cellOf[i] = cell;
      cellStart[cell + 1]++;
    }
    const cells = cols * rows;
    for (let c = 0; c < cells; c++) cellStart[c + 1] += cellStart[c];
    // Fill back to front so cellStart ends up holding each cell's start index.
    for (let i = count - 1; i >= 0; i--) {
      const cell = cellOf[i];
      items[--cellStart[cell + 1]] = ids[i];
    }
    // The fill moved every boundary down by one cell. Shift them back.
    cellStart.copyWithin(0, 1);
    cellStart[cells] = count;
  }

  clampCol(x: number): number {
    const c = (x * this.invCell) | 0;
    return c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c;
  }

  clampRow(y: number): number {
    const r = (y * this.invCell) | 0;
    return r < 0 ? 0 : r >= this.rows ? this.rows - 1 : r;
  }
}
