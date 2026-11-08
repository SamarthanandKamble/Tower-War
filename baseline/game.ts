// Tower War: initial implementation.
// A straightforward first pass: one object per entity, per-frame brute-force
// targeting and collision, immediate-mode Canvas2D, and a variable timestep.
// Kept unchanged as the reference point for docs/perf/optimization-log.md.

const TILE = 40;
const COLS = 30;
const ROWS = 18;
const WIDTH = COLS * TILE;
const HEIGHT = ROWS * TILE;

const PATH_TILES: [number, number][] = [
  [-1, 3], [6, 3], [6, 12], [13, 12], [13, 4], [21, 4], [21, 14], [27, 14], [27, 8], [29, 8],
];
const waypoints = PATH_TILES.map(([c, r]) => ({ x: c * TILE + TILE / 2, y: r * TILE + TILE / 2 }));

const pathTiles = new Set<string>();
for (let i = 0; i < PATH_TILES.length - 1; i++) {
  let [c, r] = PATH_TILES[i];
  const [ec, er] = PATH_TILES[i + 1];
  while (c !== ec || r !== er) {
    pathTiles.add(`${c},${r}`);
    c += Math.sign(ec - c);
    r += Math.sign(er - r);
  }
  pathTiles.add(`${ec},${er}`);
}

interface EnemyType { name: string; hp: number; speed: number; armor: number; reward: number; leak: number; radius: number; color: string; }
const ENEMY_TYPES: Record<string, EnemyType> = {
  grunt: { name: 'Grunt', hp: 30, speed: 50, armor: 0, reward: 4, leak: 1, radius: 9, color: '#d9534f' },
  runner: { name: 'Runner', hp: 16, speed: 100, armor: 0, reward: 4, leak: 1, radius: 7, color: '#f0c419' },
  brute: { name: 'Brute', hp: 120, speed: 32, armor: 4, reward: 10, leak: 2, radius: 12, color: '#8e5bd0' },
  swarm: { name: 'Swarm', hp: 8, speed: 70, armor: 0, reward: 1, leak: 1, radius: 5, color: '#5bc0de' },
  boss: { name: 'Boss', hp: 1500, speed: 24, armor: 6, reward: 150, leak: 20, radius: 20, color: '#ff3b6b' },
};

interface TowerType { name: string; cost: number; range: number; rate: number; damage: number; splash: number; slow: number; pierce: boolean; color: string; bullet: string; }
const TOWER_TYPES: Record<string, TowerType> = {
  gatling: { name: 'Gatling', cost: 60, range: 120, rate: 6, damage: 5, splash: 0, slow: 0, pierce: false, color: '#6fa8dc', bullet: '#ffe08a' },
  cannon: { name: 'Cannon', cost: 120, range: 130, rate: 1, damage: 30, splash: 60, slow: 0, pierce: false, color: '#b6793f', bullet: '#333' },
  frost: { name: 'Frost', cost: 90, range: 100, rate: 2, damage: 2, splash: 0, slow: 0.5, pierce: false, color: '#7fe3ff', bullet: '#bff3ff' },
  sniper: { name: 'Sniper', cost: 180, range: 260, rate: 0.7, damage: 70, splash: 0, slow: 0, pierce: true, color: '#9ccc65', bullet: '#fff' },
};

const MAX_LEVEL = 3;

class Enemy {
  x = waypoints[0].x;
  y = waypoints[0].y;
  wp = 1;
  hp: number;
  maxHp: number;
  slowTimer = 0;
  slowFactor = 1;
  progress = 0;
  dead = false;
  immortal = false;
  readonly offX = (Math.random() - 0.5) * 18;
  readonly offY = (Math.random() - 0.5) * 18;

  constructor(readonly type: EnemyType, hpScale: number) {
    this.hp = type.hp * hpScale;
    this.maxHp = this.hp;
  }

  // Returns true when the enemy reached the base this frame.
  update(dt: number): boolean {
    if (this.slowTimer > 0) {
      this.slowTimer -= dt;
    } else {
      this.slowFactor = 1;
    }
    let remaining = this.type.speed * this.slowFactor * dt;
    while (remaining > 0) {
      const target = waypoints[this.wp];
      const dx = target.x - this.x;
      const dy = target.y - this.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= remaining) {
        this.x = target.x;
        this.y = target.y;
        remaining -= dist;
        this.wp++;
        if (this.wp >= waypoints.length) return true;
      } else {
        this.x += (dx / dist) * remaining;
        this.y += (dy / dist) * remaining;
        remaining = 0;
      }
    }
    const next = waypoints[this.wp];
    this.progress = this.wp * 100000 - Math.hypot(next.x - this.x, next.y - this.y);
    return false;
  }

  draw() {
    const px = this.x + this.offX;
    const py = this.y + this.offY;
    ctx.fillStyle = this.type.color;
    ctx.beginPath();
    ctx.arc(px, py, this.type.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
    const w = this.type.radius * 2;
    ctx.fillStyle = '#400';
    ctx.fillRect(px - w / 2, py - this.type.radius - 6, w, 3);
    ctx.fillStyle = '#5f5';
    ctx.fillRect(px - w / 2, py - this.type.radius - 6, w * Math.max(0, this.hp / this.maxHp), 3);
  }
}

class Projectile {
  dead = false;
  constructor(
    public x: number,
    public y: number,
    public target: Enemy,
    readonly damage: number,
    readonly splash: number,
    readonly slow: number,
    readonly pierce: boolean,
    readonly color: string,
  ) {}

  update(dt: number) {
    const speed = 420;
    const dx = this.target.x - this.x;
    const dy = this.target.y - this.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 0) {
      this.x += (dx / dist) * speed * dt;
      this.y += (dy / dist) * speed * dt;
    }
    // Collide with the first enemy we touch.
    for (let i = 0; i < game.enemies.length; i++) {
      const e = game.enemies[i];
      if (e.dead) continue;
      if (Math.hypot(e.x - this.x, e.y - this.y) < e.type.radius + 4) {
        this.hit(e);
        return;
      }
    }
    if (this.target.dead) this.dead = true;
  }

  hit(enemy: Enemy) {
    this.dead = true;
    if (this.splash > 0) {
      for (const e of game.enemies) {
        if (Math.hypot(e.x - this.x, e.y - this.y) <= this.splash) damage(e, this.damage, this.pierce);
      }
    } else {
      damage(enemy, this.damage, this.pierce);
      if (this.slow > 0) {
        enemy.slowFactor = this.slow;
        enemy.slowTimer = 1.5;
      }
    }
  }

  draw() {
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

class Tower {
  level = 1;
  cooldown = 0;
  angle = 0;
  spent: number;
  readonly x: number;
  readonly y: number;

  constructor(readonly type: TowerType, readonly col: number, readonly row: number) {
    this.x = col * TILE + TILE / 2;
    this.y = row * TILE + TILE / 2;
    this.spent = type.cost;
  }

  get range() { return this.type.range * (1 + (this.level - 1) * 0.1); }
  get rate() { return this.type.rate * (1 + (this.level - 1) * 0.15); }
  get damage() { return this.type.damage * Math.pow(1.6, this.level - 1); }
  get upgradeCost() { return Math.round(this.type.cost * this.level * 0.9); }

  update(dt: number) {
    this.cooldown -= dt;
    // Retarget every frame: furthest-along enemy inside range.
    let best: Enemy | null = null;
    const range = this.range;
    for (const e of game.enemies) {
      if (e.dead) continue;
      if (Math.hypot(e.x - this.x, e.y - this.y) <= range && (!best || e.progress > best.progress)) best = e;
    }
    if (!best) return;
    this.angle = Math.atan2(best.y - this.y, best.x - this.x);
    if (this.cooldown <= 0) {
      if (game.stress && game.projectiles.length >= game.stress.projectiles) return;
      this.cooldown = 1 / this.rate;
      game.projectiles.push(new Projectile(this.x, this.y, best, this.damage, this.type.splash, this.type.slow, this.type.pierce, this.type.bullet));
    }
  }

  draw(selected: boolean) {
    ctx.fillStyle = '#39414f';
    ctx.fillRect(this.x - 16, this.y - 16, 32, 32);
    ctx.fillStyle = this.type.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = this.type.color;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(this.x, this.y);
    ctx.lineTo(this.x + Math.cos(this.angle) * 18, this.y + Math.sin(this.angle) * 18);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = '11px sans-serif';
    ctx.fillText(String(this.level), this.x - 3, this.y + 4);
    if (selected) drawRange(this.x, this.y, this.range, 'rgba(255,255,255,.7)');
  }
}

function drawRange(x: number, y: number, r: number, color: string) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
}

function damage(e: Enemy, amount: number, pierce: boolean) {
  if (e.dead) return;
  const dealt = pierce ? amount : Math.max(1, amount - e.type.armor);
  if (e.immortal) {
    e.hp = Math.max(e.maxHp * 0.25, e.hp - dealt);
    return;
  }
  e.hp -= dealt;
  if (e.hp <= 0) {
    e.dead = true;
    game.money += e.type.reward;
    game.score += e.type.reward * 10;
    game.kills++;
  }
}

function buildWave(n: number): { type: EnemyType; delay: number }[] {
  const list: { type: EnemyType; delay: number }[] = [];
  const add = (key: string, count: number, delay: number) => {
    for (let i = 0; i < count; i++) list.push({ type: ENEMY_TYPES[key], delay });
  };
  add('grunt', 6 + n * 2, 0.5);
  if (n >= 3 && n % 2 === 1) add('runner', 4 + n, 0.3);
  if (n >= 6 && n % 3 === 0) add('brute', 2 + Math.floor(n / 3), 1);
  if (n >= 8 && n % 4 === 0) add('swarm', 20 + n * 3, 0.1);
  if (n % 10 === 0) add('boss', n / 10, 2);
  return list;
}

function hpScaleFor(n: number) {
  return 1 + 0.16 * (n - 1) + 0.006 * (n - 1) * (n - 1);
}

interface Stress { enemies: number; towers: number; projectiles: number; }

const TOTAL_WAVES = 50;

function newGame() {
  return {
    enemies: [] as Enemy[],
    towers: [] as Tower[],
    projectiles: [] as Projectile[],
    money: 260,
    lives: 30,
    score: 0,
    kills: 0,
    wave: 0,
    queue: [] as { type: EnemyType; delay: number }[],
    spawnTimer: 0,
    hpScale: 1,
    countdown: 12,
    state: 'playing' as 'playing' | 'won' | 'lost',
    paused: false,
    speed: 1,
    build: null as TowerType | null,
    selected: null as Tower | null,
    hover: { col: -1, row: -1 },
    stress: null as Stress | null,
  };
}

let game = newGame();

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function startWave() {
  if (game.state !== 'playing' || game.queue.length > 0 || game.wave >= TOTAL_WAVES || game.stress) return;
  if (game.wave > 0 && game.countdown > 0) game.money += Math.ceil(game.countdown);
  game.wave++;
  game.queue = buildWave(game.wave);
  game.hpScale = hpScaleFor(game.wave);
  game.spawnTimer = 0;
  game.countdown = 0;
}

function canBuild(col: number, row: number) {
  if (col < 0 || row < 0 || col >= COLS || row >= ROWS) return false;
  if (pathTiles.has(`${col},${row}`)) return false;
  return !game.towers.some((t) => t.col === col && t.row === row);
}

function update(dt: number) {
  if (!game.stress && game.state === 'playing') {
    if (game.queue.length > 0) {
      game.spawnTimer -= dt;
      while (game.spawnTimer <= 0 && game.queue.length > 0) {
        const next = game.queue.shift()!;
        game.enemies.push(new Enemy(next.type, game.hpScale));
        game.spawnTimer += next.delay;
      }
    } else if (game.enemies.length === 0) {
      if (game.wave >= TOTAL_WAVES) {
        game.state = 'won';
        game.score += game.lives * 500;
      } else if (game.wave > 0 && game.countdown <= 0) {
        game.money += 20 + game.wave * 4;
        game.score += game.wave * 100;
        game.countdown = 15;
      } else {
        game.countdown -= dt;
        if (game.countdown <= 0) startWave();
      }
    }
  }

  for (let i = game.enemies.length - 1; i >= 0; i--) {
    const e = game.enemies[i];
    if (e.update(dt)) {
      if (e.immortal) {
        placeAlongPath(e);
      } else {
        game.lives -= e.type.leak;
        game.enemies.splice(i, 1);
        if (game.lives <= 0) {
          game.lives = 0;
          game.state = 'lost';
        }
      }
    }
  }

  for (const t of game.towers) t.update(dt);

  for (let i = game.projectiles.length - 1; i >= 0; i--) {
    const p = game.projectiles[i];
    p.update(dt);
    if (p.dead) game.projectiles.splice(i, 1);
  }

  for (let i = game.enemies.length - 1; i >= 0; i--) {
    if (game.enemies[i].dead) game.enemies.splice(i, 1);
  }

  // Top up last so the requested counts are all present when the frame renders.
  if (game.stress) maintainStress();
}

function placeAlongPath(e: Enemy) {
  const wp = 1 + Math.floor(Math.random() * (waypoints.length - 1));
  const from = waypoints[wp - 1];
  const to = waypoints[wp];
  const t = Math.random();
  e.x = from.x + (to.x - from.x) * t;
  e.y = from.y + (to.y - from.y) * t;
  e.wp = wp;
}

function maintainStress() {
  const s = game.stress!;
  const keys = Object.keys(ENEMY_TYPES).filter((k) => k !== 'boss');
  while (game.enemies.length < s.enemies) {
    const e = new Enemy(ENEMY_TYPES[keys[Math.floor(Math.random() * keys.length)]], 1);
    e.immortal = true;
    placeAlongPath(e);
    game.enemies.push(e);
  }
  if (game.enemies.length > s.enemies) game.enemies.length = s.enemies;
  if (game.towers.length !== s.towers) placeStressTowers(s.towers);
  while (game.projectiles.length < s.projectiles && game.enemies.length > 0 && game.towers.length > 0) {
    const t = game.towers[Math.floor(Math.random() * game.towers.length)];
    const e = game.enemies[Math.floor(Math.random() * game.enemies.length)];
    game.projectiles.push(new Projectile(t.x, t.y, e, 1, 0, 0, false, t.type.bullet));
  }
  if (game.projectiles.length > s.projectiles) game.projectiles.length = s.projectiles;
}

function placeStressTowers(count: number) {
  game.towers = [];
  const free: [number, number][] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!pathTiles.has(`${c},${r}`)) free.push([c, r]);
    }
  }
  const kinds = Object.values(TOWER_TYPES);
  const n = Math.min(count, free.length);
  for (let i = 0; i < n; i++) {
    const [c, r] = free[Math.floor((i * free.length) / n)];
    game.towers.push(new Tower(kinds[i % kinds.length], c, r));
  }
}

function render() {
  ctx.fillStyle = '#2b3a2b';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.strokeStyle = 'rgba(255,255,255,.04)';
  ctx.lineWidth = 1;
  for (let c = 0; c <= COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * TILE, 0);
    ctx.lineTo(c * TILE, HEIGHT);
    ctx.stroke();
  }
  for (let r = 0; r <= ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * TILE);
    ctx.lineTo(WIDTH, r * TILE);
    ctx.stroke();
  }

  ctx.fillStyle = '#6b5a3e';
  for (const key of pathTiles) {
    const [c, r] = key.split(',').map(Number);
    ctx.fillRect(c * TILE, r * TILE, TILE, TILE);
  }

  const base = waypoints[waypoints.length - 1];
  ctx.fillStyle = '#4a7bd0';
  ctx.fillRect(base.x - 22, base.y - 22, 44, 44);

  for (const t of game.towers) t.draw(t === game.selected);
  for (const e of game.enemies) e.draw();
  for (const p of game.projectiles) p.draw();

  if (game.build && game.hover.col >= 0) {
    const x = game.hover.col * TILE + TILE / 2;
    const y = game.hover.row * TILE + TILE / 2;
    const ok = canBuild(game.hover.col, game.hover.row) && game.money >= game.build.cost;
    ctx.fillStyle = ok ? 'rgba(90,220,120,.5)' : 'rgba(230,70,70,.5)';
    ctx.fillRect(x - TILE / 2, y - TILE / 2, TILE, TILE);
    drawRange(x, y, game.build.range, ok ? 'rgba(90,220,120,.9)' : 'rgba(230,70,70,.9)');
  }
}

function setStat(id: string, label: string, value: string) {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    el.innerHTML = `<span>${label}</span><b></b>`;
    $('stats').appendChild(el);
  }
  el.querySelector('b')!.textContent = value;
}

function updateHud() {
  setStat('st-wave', 'Wave', game.stress ? 'stress' : `${game.wave} / ${TOTAL_WAVES}`);
  setStat('st-lives', 'Lives', String(game.lives));
  setStat('st-money', 'Money', String(game.money));
  setStat('st-score', 'Score', String(game.score));
  setStat('st-next', 'Next wave', game.queue.length || game.enemies.length ? '-' : `${Math.max(0, game.countdown).toFixed(0)}s`);
  ($('next') as HTMLButtonElement).disabled = game.queue.length > 0 || game.enemies.length > 0 || game.wave >= TOTAL_WAVES;
  $('pause').textContent = game.paused ? 'Resume' : 'Pause';
  $('speed').textContent = `Speed ${game.speed}x`;
  const end = $('end');
  end.style.display = game.state === 'playing' ? 'none' : 'flex';
  if (game.state !== 'playing') $('end-text').textContent = `${game.state === 'won' ? 'Victory!' : 'Game over'} Score ${game.score}`;
}

function renderSelected() {
  const panel = $('selected');
  const t = game.selected;
  if (!t) {
    panel.textContent = 'Nothing selected';
    return;
  }
  const canUpgrade = t.level < MAX_LEVEL;
  panel.innerHTML = `<div><b>${t.type.name}</b> level ${t.level}</div>
    <div>Damage ${t.damage.toFixed(0)} | Range ${t.range.toFixed(0)}</div>
    <div class="row" style="margin-top:6px">
      <button id="up" ${canUpgrade ? '' : 'disabled'}>${canUpgrade ? `Upgrade $${t.upgradeCost}` : 'Max level'}</button>
      <button id="sell">Sell $${Math.floor(t.spent * 0.7)}</button>
    </div>`;
  document.getElementById('up')!.onclick = () => {
    if (t.level < MAX_LEVEL && game.money >= t.upgradeCost) {
      game.money -= t.upgradeCost;
      t.spent += t.upgradeCost;
      t.level++;
      renderSelected();
    }
  };
  document.getElementById('sell')!.onclick = () => {
    game.money += Math.floor(t.spent * 0.7);
    game.towers = game.towers.filter((x) => x !== t);
    game.selected = null;
    renderSelected();
  };
}

function renderTowerButtons() {
  const box = $('towers');
  box.innerHTML = '';
  for (const type of Object.values(TOWER_TYPES)) {
    const b = document.createElement('button');
    b.textContent = `${type.name} $${type.cost}`;
    b.onclick = () => {
      game.build = game.build === type ? null : type;
      game.selected = null;
      renderSelected();
      for (const other of Array.from(box.children)) other.classList.remove('active');
      if (game.build) b.classList.add('active');
    };
    box.appendChild(b);
  }
}

function tileFromEvent(ev: MouseEvent) {
  const rect = canvas.getBoundingClientRect();
  const x = ((ev.clientX - rect.left) / rect.width) * WIDTH;
  const y = ((ev.clientY - rect.top) / rect.height) * HEIGHT;
  return { col: Math.floor(x / TILE), row: Math.floor(y / TILE) };
}

canvas.addEventListener('mousemove', (ev) => { game.hover = tileFromEvent(ev); });
canvas.addEventListener('click', (ev) => {
  const { col, row } = tileFromEvent(ev);
  if (game.build) {
    if (canBuild(col, row) && game.money >= game.build.cost) {
      game.money -= game.build.cost;
      game.towers.push(new Tower(game.build, col, row));
    }
    return;
  }
  game.selected = game.towers.find((t) => t.col === col && t.row === row) ?? null;
  renderSelected();
});

function restart() {
  game = newGame();
  renderSelected();
  renderTowerButtons();
}

$('next').onclick = startWave;
$('pause').onclick = () => { game.paused = !game.paused; };
$('speed').onclick = () => { game.speed = game.speed === 4 ? 1 : game.speed * 2; };
$('restart').onclick = restart;
$('end-restart').onclick = restart;

function startStress(enemies: number, towers: number, projectiles: number) {
  const fresh = newGame();
  fresh.stress = { enemies, towers, projectiles };
  game = fresh;
  renderSelected();
  renderTowerButtons();
}

for (const key of ['e', 't', 'p']) {
  const input = $<HTMLInputElement>(`s-${key}`);
  input.oninput = () => {
    $(`s-${key}-v`).textContent = input.value;
    if (game.stress) applySliders();
  };
}
function applySliders() {
  game.stress = {
    enemies: Number($<HTMLInputElement>('s-e').value),
    towers: Number($<HTMLInputElement>('s-t').value),
    projectiles: Number($<HTMLInputElement>('s-p').value),
  };
}
$('s-go').onclick = () => {
  startStress(Number($<HTMLInputElement>('s-e').value), Number($<HTMLInputElement>('s-t').value), Number($<HTMLInputElement>('s-p').value));
};
$('s-stop').onclick = restart;

// Frame statistics, shared contract with the final build (see scripts/).
const SAMPLE_CAPACITY = 1200;
const samples = new Float64Array(SAMPLE_CAPACITY);
let sampleCount = 0;
let sampleHead = 0;

function report() {
  const n = Math.min(sampleCount, SAMPLE_CAPACITY);
  const sorted = Array.from(samples.subarray(0, n)).sort((a, b) => a - b);
  const total = sorted.reduce((sum, v) => sum + v, 0);
  const over33 = sorted.filter((v) => v > 33).length;
  return {
    frames: n,
    avgFps: n && total ? (n * 1000) / total : 0,
    p95Ms: n ? sorted[Math.min(n - 1, Math.floor(n * 0.95))] : 0,
    pctOver33: n ? (over33 / n) * 100 : 0,
    enemies: game.enemies.length,
    towers: game.towers.length,
    projectiles: game.projectiles.length,
  };
}

function updateOverlay() {
  const r = report();
  $('fps').textContent =
    `FPS ${r.avgFps.toFixed(1)}   p95 ${r.p95Ms.toFixed(1)}ms   >33ms ${r.pctOver33.toFixed(1)}%\n` +
    `Enemies ${r.enemies}   Towers ${r.towers}   Projectiles ${r.projectiles}\n` +
    `BASELINE (Canvas2D, brute force)`;
}

(window as unknown as { __bench: unknown }).__bench = {
  build: 'baseline',
  setStress: startStress,
  resetStats() { sampleCount = 0; sampleHead = 0; },
  report,
};

const params = new URLSearchParams(location.search).get('stress');
if (params) {
  const [e, t, p] = params.split(',').map(Number);
  startStress(e, t, p);
}

let last = performance.now();
let frame = 0;

function loop(now: number) {
  const elapsed = now - last;
  last = now;
  samples[sampleHead] = elapsed;
  sampleHead = (sampleHead + 1) % SAMPLE_CAPACITY;
  sampleCount++;

  // Variable timestep scaled by the current game speed.
  const dt = Math.min(elapsed / 1000, 0.1) * game.speed;
  if (!game.paused && (game.state === 'playing' || game.stress)) update(dt);
  render();
  updateHud();
  if (frame++ % 20 === 0) updateOverlay();
  requestAnimationFrame(loop);
}

renderTowerButtons();
renderSelected();
requestAnimationFrame(loop);
