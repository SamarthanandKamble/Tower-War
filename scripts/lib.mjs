// Shared helpers for the browser measurement scripts.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

export const CHROME_ARGS = [
  '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--enable-precise-memory-info',
  '--js-flags=--expose-gc',
];

export async function launch() {
  return chromium.launch({ channel: 'chrome', headless: false, args: CHROME_ARGS });
}

// Serves the production build, so measurements exclude dev-server overhead.
export async function startPreview(port = 4173) {
  const proc = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'pipe' });
  const url = `http://localhost:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return { url, stop: () => proc.kill() };
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  proc.kill();
  throw new Error('vite preview did not start');
}

// The requirement as a predicate: 95% of frames at 45+ FPS, under 5% over 33ms.
export function passes(report) {
  return report.p95Ms <= 1000 / 45 && report.pctOver33 < 5;
}
