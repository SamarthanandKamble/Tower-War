import { COLS, GROUND_ROUTES, ROUTES, ROWS, TILE, WORLD_HEIGHT, WORLD_WIDTH } from '../data/map';
import { Rng } from '../sim/rng';

/** Paints the static map once. It costs a single textured quad per frame after that. */
export function buildGround(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = WORLD_WIDTH;
  canvas.height = WORLD_HEIGHT;
  const c = canvas.getContext('2d')!;
  const rng = new Rng(20240611);

  const grass = c.createLinearGradient(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
  grass.addColorStop(0, '#2c4a35');
  grass.addColorStop(1, '#233d31');
  c.fillStyle = grass;
  c.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

  for (let r = 0; r < ROWS; r++) {
    for (let col = 0; col < COLS; col++) {
      const shade = rng.next();
      c.fillStyle = shade > 0.5 ? `rgba(255,255,220,${(shade - 0.5) * 0.05})` : `rgba(0,10,5,${(0.5 - shade) * 0.1})`;
      c.fillRect(col * TILE, r * TILE, TILE, TILE);
    }
  }

  for (let i = 0; i < 2600; i++) {
    c.fillStyle = rng.next() > 0.5 ? 'rgba(130,180,110,.16)' : 'rgba(15,35,25,.22)';
    c.fillRect(rng.next() * WORLD_WIDTH, rng.next() * WORLD_HEIGHT, 2, 2 + rng.next() * 5);
  }

  const trace = (route: [number, number][]) => {
    c.beginPath();
    route.forEach(([col, r], i) => {
      const x = col * TILE + TILE / 2;
      const y = r * TILE + TILE / 2;
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    });
  };
  c.lineJoin = 'round';
  c.lineCap = 'round';
  const stroke = (style: string, width: number) => {
    for (const id of GROUND_ROUTES) {
      trace(ROUTES[id]);
      c.strokeStyle = style;
      c.lineWidth = width;
      c.stroke();
    }
  };
  stroke('rgba(15,20,15,.5)', TILE + 10);
  stroke('#6a563c', TILE + 2);
  stroke('#7d6848', TILE - 12);

  for (let i = 0; i < 900; i++) {
    const id = GROUND_ROUTES[rng.int(GROUND_ROUTES.length)];
    const route = ROUTES[id];
    const seg = rng.int(route.length - 1);
    const t = rng.next();
    const x = (route[seg][0] + (route[seg + 1][0] - route[seg][0]) * t) * TILE + TILE / 2 + rng.range(-16, 16);
    const y = (route[seg][1] + (route[seg + 1][1] - route[seg][1]) * t) * TILE + TILE / 2 + rng.range(-16, 16);
    c.fillStyle = rng.next() > 0.5 ? 'rgba(40,30,20,.3)' : 'rgba(170,150,110,.22)';
    c.fillRect(x, y, 1 + rng.next() * 3, 1 + rng.next() * 3);
  }

  c.strokeStyle = 'rgba(255,255,255,.028)';
  c.lineWidth = 1;
  c.beginPath();
  for (let col = 0; col <= COLS; col++) {
    c.moveTo(col * TILE + 0.5, 0);
    c.lineTo(col * TILE + 0.5, WORLD_HEIGHT);
  }
  for (let r = 0; r <= ROWS; r++) {
    c.moveTo(0, r * TILE + 0.5);
    c.lineTo(WORLD_WIDTH, r * TILE + 0.5);
  }
  c.stroke();

  return canvas;
}
