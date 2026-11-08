import { ENEMIES } from '../data/enemies';
import { TOWERS } from '../data/towers';
import type { Sprite } from './batch';

const SIZE = 1024;
const PADDING = 4;

type Ctx = CanvasRenderingContext2D;

export interface Atlas {
  canvas: HTMLCanvasElement;
  solid: Sprite;
  soft: Sprite;
  ring: Sprite;
  disk: Sprite;
  spark: Sprite;
  base: Sprite;
  barricade: Sprite;
  enemies: Sprite[];
  towerPlates: Sprite[];
  /** Indexed by tower type, then level - 1. */
  turrets: Sprite[][];
  shells: Sprite[];
  digits: Sprite[];
  /** Advance width of a digit relative to its height. */
  digitAspect: number;
}

const css = ([r, g, b]: [number, number, number], shade = 1) =>
  `rgb(${Math.round(Math.min(1, r * shade) * 255)},${Math.round(Math.min(1, g * shade) * 255)},${Math.round(Math.min(1, b * shade) * 255)})`;

function body(c: Ctx, color: [number, number, number], radius: number): CanvasGradient {
  const g = c.createRadialGradient(-radius * 0.3, -radius * 0.35, radius * 0.1, 0, 0, radius);
  g.addColorStop(0, css(color, 1.35));
  g.addColorStop(0.65, css(color, 1));
  g.addColorStop(1, css(color, 0.55));
  return g;
}

function outlineFill(c: Ctx, fill: string | CanvasGradient, line = 'rgba(10,14,20,.85)', width = 3): void {
  c.fillStyle = fill;
  c.fill();
  c.lineWidth = width;
  c.strokeStyle = line;
  c.stroke();
}

function polygon(c: Ctx, sides: number, radius: number, rotation = 0): void {
  c.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = rotation + (i / sides) * Math.PI * 2;
    c.lineTo(Math.cos(a) * radius, Math.sin(a) * radius);
  }
  c.closePath();
}

// Enemies are drawn facing +x inside a 64px cell, radius about 26.
const ENEMY_ART: ((c: Ctx, color: [number, number, number]) => void)[] = [
  (c, color) => { // Grunt: rounded soldier with shoulder pads.
    c.fillStyle = css(color, 0.6);
    for (const side of [-1, 1]) {
      c.beginPath();
      c.ellipse(-2, side * 18, 9, 7, 0, 0, Math.PI * 2);
      c.fill();
    }
    c.beginPath();
    c.arc(0, 0, 21, 0, Math.PI * 2);
    outlineFill(c, body(c, color, 21));
    c.fillStyle = 'rgba(20,20,30,.8)';
    c.fillRect(8, -9, 8, 18);
  },
  (c, color) => { // Runner: swept dart.
    c.beginPath();
    c.moveTo(27, 0);
    c.lineTo(-20, 19);
    c.lineTo(-10, 0);
    c.lineTo(-20, -19);
    c.closePath();
    outlineFill(c, body(c, color, 26));
  },
  (c, color) => { // Brute: plated hexagon.
    polygon(c, 6, 27);
    outlineFill(c, body(c, color, 27));
    polygon(c, 6, 15);
    outlineFill(c, css(color, 0.65), 'rgba(255,255,255,.3)', 2);
  },
  (c, color) => { // Swarm: small triangle mite.
    polygon(c, 3, 25);
    outlineFill(c, body(c, color, 25));
  },
  (c, color) => { // Mender: orb with a cross.
    c.beginPath();
    c.arc(0, 0, 23, 0, Math.PI * 2);
    outlineFill(c, body(c, color, 23));
    c.fillStyle = 'rgba(255,255,255,.92)';
    c.fillRect(-4, -13, 8, 26);
    c.fillRect(-13, -4, 26, 8);
  },
  (c, color) => { // Wasp: winged flyer.
    c.fillStyle = 'rgba(255,255,255,.42)';
    for (const side of [-1, 1]) {
      c.beginPath();
      c.ellipse(-3, side * 17, 9, 15, side * 0.5, 0, Math.PI * 2);
      c.fill();
    }
    c.beginPath();
    c.ellipse(1, 0, 24, 10, 0, 0, Math.PI * 2);
    outlineFill(c, body(c, color, 24));
    c.fillStyle = 'rgba(20,20,30,.7)';
    c.fillRect(-10, -9, 5, 18);
    c.fillRect(1, -10, 5, 20);
  },
  (c, color) => { // Phantom: hooded wisp trailing behind.
    c.beginPath();
    c.moveTo(24, 0);
    c.quadraticCurveTo(14, -24, -8, -20);
    c.lineTo(-26, -13);
    c.lineTo(-16, -5);
    c.lineTo(-28, 0);
    c.lineTo(-16, 5);
    c.lineTo(-26, 13);
    c.lineTo(-8, 20);
    c.quadraticCurveTo(14, 24, 24, 0);
    outlineFill(c, body(c, color, 26), 'rgba(20,20,50,.6)', 2);
    c.fillStyle = 'rgba(30,20,70,.9)';
    c.beginPath();
    c.ellipse(11, 0, 5, 9, 0, 0, Math.PI * 2);
    c.fill();
  },
  (c, color) => { // Warlord: spiked crown.
    c.beginPath();
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      const r = i % 2 === 0 ? 29 : 21;
      c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    c.closePath();
    outlineFill(c, body(c, color, 29));
    c.beginPath();
    c.arc(0, 0, 11, 0, Math.PI * 2);
    outlineFill(c, '#ffe9a8', 'rgba(60,10,20,.8)', 2);
  },
];

function plate(c: Ctx, color: [number, number, number]): void {
  polygon(c, 8, 29, Math.PI / 8);
  const g = c.createLinearGradient(0, -28, 0, 28);
  g.addColorStop(0, '#4c5666');
  g.addColorStop(1, '#262c37');
  outlineFill(c, g);
  polygon(c, 8, 22, Math.PI / 8);
  c.lineWidth = 2;
  c.strokeStyle = css(color, 0.8);
  c.stroke();
}

// Turrets point along +x. Level adds visible hardware.
const TURRET_ART: ((c: Ctx, color: [number, number, number], level: number) => void)[] = [
  (c, color, level) => { // Gatling: one to three barrels.
    const offsets = level === 1 ? [0] : level === 2 ? [-5, 5] : [-8, 0, 8];
    c.fillStyle = '#c9d2de';
    for (const y of offsets) c.fillRect(2, y - 2.5, 27, 5);
    c.beginPath();
    c.arc(0, 0, 13 + level, 0, Math.PI * 2);
    outlineFill(c, body(c, color, 15));
  },
  (c, color, level) => { // Cannon: short thick barrel.
    c.fillStyle = '#39302a';
    c.fillRect(0, -6 - level, 22 + level * 2, 12 + level * 2);
    c.fillStyle = css(color, 0.7);
    c.fillRect(19 + level * 2, -7 - level, 5, 14 + level * 2);
    c.beginPath();
    c.arc(0, 0, 14 + level, 0, Math.PI * 2);
    outlineFill(c, body(c, color, 16));
  },
  (c, color, level) => { // Frost: crystal cluster.
    for (let i = 0; i < 3 + level; i++) {
      c.save();
      c.rotate((i / (3 + level)) * Math.PI * 2);
      c.beginPath();
      c.moveTo(25, 0);
      c.lineTo(6, -6);
      c.lineTo(6, 6);
      c.closePath();
      outlineFill(c, css(color, 1.1), 'rgba(20,50,80,.7)', 1.5);
      c.restore();
    }
    c.beginPath();
    c.arc(0, 0, 9 + level, 0, Math.PI * 2);
    outlineFill(c, '#eafcff', 'rgba(20,50,80,.7)', 2);
  },
  (c, color, level) => { // Tesla: coil with arcing tips.
    c.strokeStyle = css(color, 1.2);
    c.lineWidth = 3;
    for (let i = 0; i < 2 + level; i++) {
      c.beginPath();
      c.arc(0, 0, 11 + i * 5, -0.8, 0.8);
      c.stroke();
    }
    c.beginPath();
    c.arc(0, 0, 11 + level, 0, Math.PI * 2);
    outlineFill(c, body(c, color, 14));
    c.fillStyle = '#fff';
    c.beginPath();
    c.arc(0, 0, 4 + level, 0, Math.PI * 2);
    c.fill();
  },
  (c, color, level) => { // Railgun: long split rails.
    c.fillStyle = '#d7dde6';
    c.fillRect(0, -7, 30, 4);
    c.fillRect(0, 3, 30, 4);
    c.fillStyle = css(color, 1.2);
    for (let i = 0; i < level; i++) c.fillRect(6 + i * 8, -3, 4, 6);
    c.beginPath();
    c.roundRect(-14, -11, 22, 22, 5);
    outlineFill(c, body(c, color, 16));
  },
];

export function buildAtlas(): Atlas {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const c = canvas.getContext('2d', { willReadFrequently: false })!;
  let penX = PADDING;
  let penY = PADDING;
  let shelf = 0;

  const add = (w: number, h: number, draw: (c: Ctx) => void, centered = true): Sprite => {
    if (penX + w + PADDING > SIZE) {
      penX = PADDING;
      penY += shelf + PADDING;
      shelf = 0;
    }
    if (penY + h + PADDING > SIZE) throw new Error('Sprite atlas is full');
    c.save();
    c.beginPath();
    c.rect(penX, penY, w, h);
    c.clip();
    c.translate(penX + (centered ? w / 2 : 0), penY + (centered ? h / 2 : 0));
    draw(c);
    c.restore();
    const sprite = { u: penX / SIZE, v: penY / SIZE, uw: w / SIZE, vh: h / SIZE };
    penX += w + PADDING;
    shelf = Math.max(shelf, h);
    return sprite;
  };

  const solid = add(8, 8, (g) => { g.fillStyle = '#fff'; g.fillRect(-4, -4, 8, 8); });
  // Sample the center so bilinear filtering never reads transparent padding.
  solid.u += 2 / SIZE;
  solid.v += 2 / SIZE;
  solid.uw = 4 / SIZE;
  solid.vh = 4 / SIZE;

  const soft = add(64, 64, (g) => {
    const grad = g.createRadialGradient(0, 0, 0, 0, 0, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.4, 'rgba(255,255,255,.45)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(-32, -32, 64, 64);
  });
  const ring = add(256, 256, (g) => {
    g.strokeStyle = '#fff';
    g.lineWidth = 4;
    g.beginPath();
    g.arc(0, 0, 124, 0, Math.PI * 2);
    g.stroke();
  });
  const disk = add(128, 128, (g) => {
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(0, 0, 62, 0, Math.PI * 2);
    g.fill();
  });
  const spark = add(32, 12, (g) => {
    const grad = g.createLinearGradient(-16, 0, 16, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = grad;
    g.beginPath();
    g.ellipse(0, 0, 16, 5, 0, 0, Math.PI * 2);
    g.fill();
  });

  const base = add(128, 128, (g) => {
    polygon(g, 8, 58, Math.PI / 8);
    const grad = g.createLinearGradient(0, -58, 0, 58);
    grad.addColorStop(0, '#6f8fb8');
    grad.addColorStop(1, '#2d4263');
    outlineFill(g, grad, 'rgba(8,12,20,.9)', 5);
    polygon(g, 8, 38, Math.PI / 8);
    outlineFill(g, '#20304a', '#9cc2f0', 3);
    g.beginPath();
    g.arc(0, 0, 18, 0, Math.PI * 2);
    outlineFill(g, '#7fd4ff', '#dff4ff', 3);
  });

  const barricade = add(64, 64, (g) => {
    g.fillStyle = '#4a3a28';
    g.fillRect(-30, -24, 60, 48);
    g.fillStyle = '#e0b040';
    for (let i = -30; i < 30; i += 20) {
      g.beginPath();
      g.moveTo(i, -24);
      g.lineTo(i + 10, -24);
      g.lineTo(i + 20, 24);
      g.lineTo(i + 10, 24);
      g.closePath();
      g.fill();
    }
    g.strokeStyle = 'rgba(10,8,5,.8)';
    g.lineWidth = 3;
    g.strokeRect(-30, -24, 60, 48);
  });

  const enemies = ENEMIES.map((def, i) => add(64, 64, (g) => ENEMY_ART[i](g, def.color)));
  const towerPlates = TOWERS.map((def) => add(64, 64, (g) => plate(g, def.color)));
  const turrets = TOWERS.map((def, i) => [1, 2, 3].map((level) => add(64, 64, (g) => TURRET_ART[i](g, def.color, level))));

  const shells = TOWERS.map((def) => add(24, 24, (g) => {
    const grad = g.createRadialGradient(0, 0, 0, 0, 0, 12);
    grad.addColorStop(0, '#fff');
    grad.addColorStop(0.4, css(def.color, 1.3));
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(-12, -12, 24, 24);
  }));

  const digitW = 22;
  const digitH = 32;
  const digits = Array.from({ length: 10 }, (_, d) => add(digitW, digitH, (g) => {
    g.font = '700 28px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 5;
    g.strokeStyle = 'rgba(0,0,0,.85)';
    g.strokeText(String(d), 0, 1);
    g.fillStyle = '#fff';
    g.fillText(String(d), 0, 1);
  }));

  return { canvas, solid, soft, ring, disk, spark, base, barricade, enemies, towerPlates, turrets, shells, digits, digitAspect: digitW / digitH };
}
