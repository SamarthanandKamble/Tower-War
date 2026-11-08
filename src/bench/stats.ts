const CAPACITY = 1200;

/** Rolling frame timings. Same report shape as the baseline's, so scripts share it. */
export class FrameStats {
  private readonly frameMs = new Float64Array(CAPACITY);
  private readonly simMs = new Float64Array(CAPACITY);
  private readonly renderMs = new Float64Array(CAPACITY);
  private head = 0;
  private count = 0;

  record(frameMs: number, simMs: number, renderMs: number): void {
    this.frameMs[this.head] = frameMs;
    this.simMs[this.head] = simMs;
    this.renderMs[this.head] = renderMs;
    this.head = (this.head + 1) % CAPACITY;
    if (this.count < CAPACITY) this.count++;
  }

  reset(): void {
    this.head = 0;
    this.count = 0;
  }

  summary(): { frames: number; avgFps: number; p95Ms: number; pctOver33: number; simMs: number; renderMs: number } {
    const n = this.count;
    if (n === 0) return { frames: 0, avgFps: 0, p95Ms: 0, pctOver33: 0, simMs: 0, renderMs: 0 };
    const sorted = this.frameMs.slice(0, n).sort();
    let total = 0;
    let over = 0;
    let sim = 0;
    let render = 0;
    for (let i = 0; i < n; i++) {
      total += sorted[i];
      if (sorted[i] > 33) over++;
      sim += this.simMs[i];
      render += this.renderMs[i];
    }
    return {
      frames: n,
      avgFps: total > 0 ? (n * 1000) / total : 0,
      p95Ms: sorted[Math.min(n - 1, Math.floor(n * 0.95))],
      pctOver33: (over / n) * 100,
      simMs: sim / n,
      renderMs: render / n,
    };
  }
}
