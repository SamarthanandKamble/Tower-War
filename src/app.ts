import { TOWERS } from './data/towers';
import { COLS, NORTH_ROUTE_WAVE } from './data/map';
import { TOTAL_WAVES, WAVES } from './data/waves';
import { AudioEngine, type SoundName } from './audio/audio';
import { FrameStats } from './bench/stats';
import { buildAtlas, type Atlas } from './render/atlas';
import { CanvasBackend, WebGLBackend, type Backend } from './render/backends';
import { Camera, type Insets } from './render/camera';
import { buildGround } from './render/ground';
import { Scene, type Overlay } from './render/scene';
import { Bot, BOT_PROFILES } from './sim/bot';
import { FxKind } from './sim/fx';
import { FixedStepper } from './sim/loop';
import { DIFFICULTIES, TICK_RATE, World, type Difficulty, type StressConfig } from './sim/world';
import { Hud } from './ui/hud';

type Mode = 'menu' | 'game' | 'lab';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const MAX_DPR = 2;
const DRAG_THRESHOLD = 6;
const ZOOM_STEP = 1.0015;
const KEY_PAN_SPEED = 900;
const STATS_REFRESH_FRAMES = 20;
const SLOW_FRAME_MS = 26;
const SLOW_FRAMES_BEFORE_DOWNSCALE = 90;
const MIN_RENDER_SCALE = 0.6;
const SCORE_KEY = 'tower-war.scores';
const MUTE_KEY = 'tower-war.muted';
const TARGET: StressConfig = { enemies: 5000, towers: 100, projectiles: 1000 };
const ATTRACT: StressConfig = { enemies: 220, towers: 24, projectiles: 30 };
const TOWER_SOUNDS: SoundName[] = ['gatling', 'cannon', 'frost', 'tesla', 'rail'];

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private windows can refuse storage. The game works without it.
  }
}

export class App {
  private readonly atlas: Atlas = buildAtlas();
  private readonly ground = buildGround();
  private readonly scene = new Scene(this.atlas);
  private readonly camera = new Camera();
  private readonly stepper = new FixedStepper();
  private readonly audio = new AudioEngine();
  private readonly stats = new FrameStats();
  private readonly hud: Hud;
  private readonly glBackend: Backend | null;
  private readonly canvasBackend: Backend;
  private backend: Backend;

  private world = new World(1);
  private mode: Mode = 'menu';
  private difficulty: Difficulty = DIFFICULTIES.normal;
  private readonly overlay: Overlay = { hoverCol: -1, hoverRow: -1, buildType: -1, selected: -1 };
  private lastFrame = performance.now();
  private frameCount = 0;
  private lastSimMs = 0;
  private lastRenderMs = 0;
  private renderScale = 1;
  private slowFrames = 0;
  private lastWave = 0;
  private endShown = false;
  private autoplay: ((world: World) => void) | null = null;
  private adaptiveResolution = true;

  private readonly pointers = new Map<number, { x: number; y: number }>();
  private dragStart: { x: number; y: number } | null = null;
  private dragging = false;
  private pinchDistance = 0;
  private readonly keysDown = new Set<string>();

  constructor() {
    const glCanvas = $<HTMLCanvasElement>('gl');
    const canvas2d = $<HTMLCanvasElement>('c2d');
    this.glBackend = WebGLBackend.create(glCanvas, this.atlas, this.ground);
    this.canvasBackend = new CanvasBackend(canvas2d, this.atlas, this.ground);
    this.backend = this.glBackend ?? this.canvasBackend;
    if (!this.glBackend) {
      glCanvas.hidden = true;
      canvas2d.hidden = false;
      $<HTMLInputElement>('o-backend').checked = false;
      $<HTMLInputElement>('o-backend').disabled = true;
    }

    this.hud = new Hud(this.atlas, {
      chooseTower: (type) => this.chooseTower(type),
      upgradeSelected: () => this.upgradeSelected(),
      sellSelected: () => this.sellSelected(),
      setPriority: (p) => this.world.setPriority(this.overlay.selected, p),
    });

    this.scene.reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.scene.onFx = (kind, a, c) => this.playFx(kind, a, c);
    if (readStorage(MUTE_KEY) === '1') this.toggleMute();

    this.bindControls();
    this.bindPointer();
    this.bindKeyboard();
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      // Auto-pause so a hidden tab cannot lose the game while nobody is watching.
      if (document.hidden && this.mode === 'game' && !this.stepper.paused && !this.gameOver) this.setPaused(true);
    });

    this.resize();
    this.camera.fit();
    this.showMenu();
    this.exposeBench();

    const stress = new URLSearchParams(location.search).get('stress');
    if (stress) {
      const [enemies, towers, projectiles] = stress.split(',').map(Number);
      this.startLab({ enemies, towers, projectiles });
    }
    requestAnimationFrame(this.frame);
  }

  private get gameOver(): boolean {
    return this.world.phase === 'won' || this.world.phase === 'lost';
  }

  // ---- Frame ----------------------------------------------------------------

  private readonly stepWorld = (): void => {
    this.autoplay?.(this.world);
    this.world.step();
  };

  private readonly frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    const elapsed = now - this.lastFrame;
    this.lastFrame = now;
    const seconds = elapsed / 1000;

    const simStart = performance.now();
    if (!this.gameOver) this.stepper.advance(seconds, this.stepWorld);
    const simEnd = performance.now();

    this.applyKeyboardPan(seconds);
    const sceneDt = this.stepper.paused ? 0 : Math.min(seconds, 0.1) * this.stepper.speed;
    this.scene.update(this.world, sceneDt);

    const shakeX = this.scene.shakeX;
    const shakeY = this.scene.shakeY;
    this.camera.x += shakeX;
    this.camera.y += shakeY;
    this.scene.build(this.world, this.camera, this.stepper.paused ? 1 : this.stepper.alpha, this.overlay);
    this.backend.present(this.scene.batch, this.camera);
    this.camera.x -= shakeX;
    this.camera.y -= shakeY;
    const renderEnd = performance.now();

    this.lastSimMs = simEnd - simStart;
    this.lastRenderMs = renderEnd - simEnd;
    this.stats.record(elapsed, this.lastSimMs, this.lastRenderMs);

    if (this.mode !== 'menu') {
      this.hud.update(this.world, this.overlay.selected, this.overlay.buildType);
      if (this.mode === 'game') this.watchGameState();
    }
    if (this.frameCount++ % STATS_REFRESH_FRAMES === 0) this.renderMetrics();
    this.adaptResolution(elapsed);
  };

  /** Trades resolution for frame rate on GPUs that cannot keep up. */
  private adaptResolution(elapsed: number): void {
    this.slowFrames = elapsed > SLOW_FRAME_MS ? this.slowFrames + 1 : 0;
    if (!this.adaptiveResolution || this.slowFrames < SLOW_FRAMES_BEFORE_DOWNSCALE || this.renderScale <= MIN_RENDER_SCALE || this.backend !== this.glBackend) return;
    this.slowFrames = 0;
    this.renderScale = Math.max(MIN_RENDER_SCALE, this.renderScale * 0.8);
    this.resize();
  }

  private renderMetrics(): void {
    const el = $('metrics');
    if (el.hidden) return;
    const r = this.stats.summary();
    const pass = r.p95Ms <= 1000 / 45 && r.pctOver33 < 5;
    const fmt = (n: number) => n.toLocaleString('en-US');
    el.innerHTML =
      `<span class="big">${r.avgFps.toFixed(0)} FPS</span>  <span class="${pass ? 'pass' : 'fail'}">${pass ? 'PASS' : 'FAIL'}</span>\n` +
      `p95 ${r.p95Ms.toFixed(1)}ms   &gt;33ms ${r.pctOver33.toFixed(1)}%\n` +
      `sim ${r.simMs.toFixed(2)}ms   render ${r.renderMs.toFixed(2)}ms\n` +
      `enemies ${fmt(this.world.enemyCount)}  towers ${fmt(this.world.towerCount)}  shots ${fmt(this.world.projectileCount)}\n` +
      `drawn ${fmt(this.scene.drawnEnemies)}  culled ${fmt(this.scene.culledEnemies)}\n` +
      `${fmt(this.backend.drawCalls)} draw calls   ${fmt(this.scene.batch.count)} sprites   ${this.backend.name}`;
  }

  // ---- Game flow ------------------------------------------------------------

  private showOnly(screen: 'title' | 'pause' | 'end' | null): void {
    for (const id of ['title', 'pause', 'end']) $(id).hidden = id !== screen;
  }

  private setGameHud(visible: boolean): void {
    $('top').hidden = !visible;
    $('bottom').hidden = !visible;
    if (!visible) $('selected').hidden = true;
  }

  private newWorld(difficulty: Difficulty, seed: number): void {
    this.world = new World(seed, difficulty);
    this.scene.reset();
    this.stepper.reset();
    this.stepper.paused = false;
    this.overlay.selected = -1;
    this.overlay.buildType = -1;
    this.lastWave = 0;
    this.endShown = false;
    this.hud.invalidate();
    this.camera.fit();
  }

  private showMenu(): void {
    this.mode = 'menu';
    this.autoplay = null;
    this.newWorld(DIFFICULTIES.normal, 7);
    this.world.setStress({ ...ATTRACT });
    this.setSpeed(1);
    this.setGameHud(false);
    $('lab').hidden = true;
    $('metrics').hidden = true;
    this.showOnly('title');
    this.renderScores();
  }

  private startGame(difficulty: Difficulty): void {
    this.difficulty = difficulty;
    this.mode = 'game';
    this.autoplay = null;
    this.newWorld(difficulty, (Date.now() & 0x7fffffff) | 1);
    this.setSpeed(1);
    this.setGameHud(true);
    $('lab').hidden = true;
    $('metrics').hidden = true;
    this.showOnly(null);
    this.resize();
    this.camera.fit();
  }

  private startLab(config: StressConfig): void {
    this.mode = 'lab';
    this.autoplay = null;
    this.newWorld(DIFFICULTIES.normal, 11);
    this.setSpeed(1);
    this.setGameHud(false);
    this.showOnly(null);
    $('lab').hidden = false;
    $('metrics').hidden = false;
    this.applyStress(config);
    this.stats.reset();
    this.resize();
    this.camera.fit();
  }

  private applyStress(config: StressConfig): void {
    this.world.money = 1_000_000_000;
    this.world.setStress({ ...config });
    this.syncLabControls(config);
  }

  private syncLabControls(config: StressConfig): void {
    const fmt = (n: number) => n.toLocaleString('en-US');
    for (const [key, value] of [['e', config.enemies], ['t', config.towers], ['p', config.projectiles]] as const) {
      $<HTMLInputElement>(`l-${key}`).value = String(value);
      $(`l-${key}-v`).textContent = fmt(value);
    }
  }

  private setPaused(paused: boolean): void {
    if (this.mode !== 'game' || this.gameOver) return;
    this.stepper.paused = paused;
    $('b-pause').textContent = paused ? 'Resume' : 'Pause';
    this.showOnly(paused ? 'pause' : null);
  }

  private setSpeed(speed: number): void {
    this.stepper.speed = speed;
    document.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((b) => b.classList.toggle('active', Number(b.dataset.speed) === speed));
  }

  private cycleSpeed(): void {
    this.setSpeed(this.stepper.speed === 4 ? 1 : this.stepper.speed * 2);
  }

  private toggleMute(): void {
    this.audio.setMuted(!this.audio.muted);
    $('b-mute').textContent = this.audio.muted ? 'Sound off' : 'Sound on';
    writeStorage(MUTE_KEY, this.audio.muted ? '1' : '0');
  }

  private sendWave(): void {
    if (this.mode === 'game' && !this.stepper.paused && this.world.startNextWave()) this.audio.play('wave');
  }

  private watchGameState(): void {
    const world = this.world;
    if (world.waveNumber !== this.lastWave) {
      this.lastWave = world.waveNumber;
      const wave = WAVES[world.waveNumber - 1];
      if (world.waveNumber === NORTH_ROUTE_WAVE) this.hud.banner(`Wave ${world.waveNumber}`, 'The North Gate has opened!');
      else if (world.waveNumber === TOTAL_WAVES) this.hud.banner('Final wave', 'Everything they have left');
      else this.hud.banner(`Wave ${world.waveNumber}`, wave.isBoss ? 'Warlord approaching' : '');
    }
    if (this.gameOver && !this.endShown) this.showEnd();
  }

  private showEnd(): void {
    this.endShown = true;
    const world = this.world;
    const won = world.phase === 'won';
    const scores = this.saveScore(world.score);
    this.audio.play(won ? 'win' : 'lose');
    $('e-title').textContent = won ? 'Victory' : 'Base destroyed';
    $('e-sub').textContent = won ? `All ${TOTAL_WAVES} waves defeated on ${this.difficulty.name}.` : `You fell on wave ${world.waveNumber} of ${TOTAL_WAVES}.`;
    const best = scores[0] === world.score ? `${world.score.toLocaleString('en-US')} (new best)` : scores[0].toLocaleString('en-US');
    const rows: [string, string][] = [
      ['Score', world.score.toLocaleString('en-US')],
      ['Best', best],
      ['Waves survived', `${won ? TOTAL_WAVES : Math.max(0, world.waveNumber - 1)} / ${TOTAL_WAVES}`],
      ['Enemies destroyed', world.kills.toLocaleString('en-US')],
      ['Lives remaining', String(world.lives)],
    ];
    $('e-stats').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    this.showOnly('end');
    this.overlay.buildType = -1;
  }

  private loadScores(): number[] {
    try {
      const parsed: unknown = JSON.parse(readStorage(SCORE_KEY) ?? '[]');
      return Array.isArray(parsed) ? parsed.filter((n): n is number => typeof n === 'number') : [];
    } catch {
      return [];
    }
  }

  private saveScore(score: number): number[] {
    const scores = [...this.loadScores(), score].sort((a, b) => b - a).slice(0, 5);
    writeStorage(SCORE_KEY, JSON.stringify(scores));
    return scores;
  }

  private renderScores(): void {
    $('scores').innerHTML = this.loadScores().map((s, i) => `<li><span>${i + 1}.</span><span>${s.toLocaleString('en-US')}</span></li>`).join('');
  }

  // ---- Commands -------------------------------------------------------------

  private chooseTower(type: number): void {
    this.audio.unlock();
    if (this.mode !== 'game' && this.mode !== 'lab') return;
    this.overlay.buildType = this.overlay.buildType === type ? -1 : type;
    this.overlay.selected = -1;
  }

  private upgradeSelected(): void {
    const t = this.overlay.selected;
    if (t < 0) return;
    this.audio.play(this.world.upgradeTower(t) ? 'upgrade' : 'error');
  }

  private sellSelected(): void {
    const t = this.overlay.selected;
    if (t < 0) return;
    this.world.sellTower(t);
    this.audio.play('sell');
    this.overlay.selected = -1;
    this.syncStressTowers();
  }

  /** Keeps the lab from rebuilding its layout after a manual change. */
  private syncStressTowers(): void {
    if (!this.world.stress) return;
    this.world.stress.towers = this.world.towerCount;
    this.syncLabControls(this.world.stress);
  }

  private clickTile(col: number, row: number): void {
    const { world, overlay } = this;
    if (overlay.buildType >= 0) {
      if (world.placeTower(overlay.buildType, col, row) >= 0) {
        this.audio.play('place');
        this.syncStressTowers();
      } else {
        this.audio.play('error');
        if (col >= 0 && world.canBuild(col, row)) this.hud.notice('Not enough money');
        else if (col >= 0) this.hud.notice("Can't build there");
      }
      return;
    }
    if (col < 0) {
      overlay.selected = -1;
      return;
    }
    overlay.selected = world.occupied[row * COLS + col] - 1;
  }

  private playFx(kind: FxKind, a: number, c: number): void {
    if (this.mode !== 'game') return;
    switch (kind) {
      case FxKind.Muzzle: this.audio.play(TOWER_SOUNDS[a]); break;
      case FxKind.Beam: this.audio.play(TOWER_SOUNDS[c]); break;
      case FxKind.Arc: this.audio.play('tesla'); break;
      case FxKind.Pulse: this.audio.play('frost'); break;
      case FxKind.Explosion: this.audio.play('explosion'); break;
      case FxKind.Kill: this.audio.play('kill'); break;
      case FxKind.Leak: this.audio.play('leak'); break;
      case FxKind.WaveClear:
        this.audio.play('clear');
        if (a < TOTAL_WAVES) this.hud.banner('Wave clear', `+$${30 + a * 5}`);
        break;
      default: break;
    }
  }

  // ---- Input ----------------------------------------------------------------

  private bindControls(): void {
    const click = (id: string, handler: () => void) => {
      $(id).addEventListener('click', () => {
        this.audio.unlock();
        handler();
      });
    };
    click('m-normal', () => this.startGame(DIFFICULTIES.normal));
    click('m-hard', () => this.startGame(DIFFICULTIES.hard));
    click('m-lab', () => this.startLab(TARGET));
    click('b-next', () => this.sendWave());
    click('b-pause', () => this.setPaused(!this.stepper.paused));
    click('b-mute', () => this.toggleMute());
    click('p-resume', () => this.setPaused(false));
    click('p-restart', () => this.startGame(this.difficulty));
    click('p-quit', () => this.showMenu());
    click('e-again', () => this.startGame(this.difficulty));
    click('e-menu', () => this.showMenu());
    click('l-exit', () => this.showMenu());

    document.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((b) => {
      b.addEventListener('click', () => this.setSpeed(Number(b.dataset.speed)));
    });
    document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((b) => {
      b.addEventListener('click', () => {
        const m = Number(b.dataset.preset);
        this.applyStress({ enemies: TARGET.enemies * m, towers: TARGET.towers * m, projectiles: TARGET.projectiles * m });
        this.stats.reset();
      });
    });
    for (const key of ['e', 't', 'p']) {
      $(`l-${key}`).addEventListener('input', () => {
        const read = (k: string) => Number($<HTMLInputElement>(`l-${k}`).value);
        const config = { enemies: read('e'), towers: read('t'), projectiles: read('p') };
        if (this.world.stress) Object.assign(this.world.stress, config);
        this.syncLabControls(config);
        this.stats.reset();
      });
    }
    $<HTMLInputElement>('o-backend').addEventListener('change', (e) => this.setBackend((e.target as HTMLInputElement).checked));
    $<HTMLInputElement>('o-grid').addEventListener('change', (e) => {
      this.world.options.spatialGrid = (e.target as HTMLInputElement).checked;
      this.stats.reset();
    });
    $<HTMLInputElement>('o-cull').addEventListener('change', (e) => {
      this.scene.options.culling = (e.target as HTMLInputElement).checked;
      this.stats.reset();
    });
  }

  private setBackend(webgl: boolean): void {
    if (!this.glBackend) return;
    this.backend = webgl ? this.glBackend : this.canvasBackend;
    this.glBackend.canvas.hidden = !webgl;
    this.canvasBackend.canvas.hidden = webgl;
    this.resize();
    this.stats.reset();
  }

  private updateHover(x: number, y: number): void {
    const { col, row } = Scene.tileAt(this.camera.worldX(x), this.camera.worldY(y));
    this.overlay.hoverCol = col;
    this.overlay.hoverRow = row;
  }

  private bindPointer(): void {
    const stage = $('stage');
    stage.addEventListener('contextmenu', (e) => e.preventDefault());

    stage.addEventListener('pointerdown', (e) => {
      this.audio.unlock();
      stage.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.updateHover(e.clientX, e.clientY);
      if (e.button === 2) {
        // Right click cancels a build first. Otherwise it starts a pan.
        if (this.overlay.buildType >= 0) this.overlay.buildType = -1;
      }
      this.dragStart = { x: e.clientX, y: e.clientY };
      this.dragging = e.button === 1 || e.button === 2;
      this.pinchDistance = 0;
    });

    stage.addEventListener('pointermove', (e) => {
      const previous = this.pointers.get(e.pointerId);
      this.updateHover(e.clientX, e.clientY);
      if (!previous) return;
      if (this.pointers.size === 2) {
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        this.handlePinch(e.clientX - previous.x, e.clientY - previous.y);
        return;
      }
      if (!this.dragging && this.dragStart && Math.hypot(e.clientX - this.dragStart.x, e.clientY - this.dragStart.y) > DRAG_THRESHOLD) this.dragging = true;
      if (this.dragging) this.camera.panBy(e.clientX - previous.x, e.clientY - previous.y);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    });

    const release = (e: PointerEvent) => {
      const wasTap = !this.dragging && this.pointers.size === 1 && e.button === 0 && e.type === 'pointerup';
      this.pointers.delete(e.pointerId);
      if (wasTap && !this.stepper.paused && !this.gameOver && this.mode !== 'menu') {
        const { col, row } = Scene.tileAt(this.camera.worldX(e.clientX), this.camera.worldY(e.clientY));
        this.clickTile(col, row);
      }
      if (this.pointers.size === 0) {
        this.dragging = false;
        this.dragStart = null;
      }
    };
    stage.addEventListener('pointerup', release);
    stage.addEventListener('pointercancel', release);
    stage.addEventListener('pointerleave', () => { this.overlay.hoverCol = this.overlay.hoverRow = -1; });

    stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (this.mode !== 'menu') this.camera.zoomAt(e.clientX, e.clientY, Math.pow(ZOOM_STEP, -e.deltaY));
    }, { passive: false });
  }

  private handlePinch(dx: number, dy: number): void {
    this.dragging = true;
    const [a, b] = [...this.pointers.values()];
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    if (this.pinchDistance > 0) this.camera.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, distance / this.pinchDistance);
    this.pinchDistance = distance;
    this.camera.panBy(dx / 2, dy / 2);
  }

  private bindKeyboard(): void {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement && e.target.type !== 'range' && e.target.type !== 'checkbox') return;
      this.keysDown.add(e.key);
      if (e.repeat) return;
      if (e.key === ' ') e.preventDefault();
      const inPlay = this.mode === 'game' || this.mode === 'lab';
      if (e.key >= '1' && e.key <= String(TOWERS.length) && inPlay) this.chooseTower(Number(e.key) - 1);
      else if (e.key === 'Escape') this.handleEscape();
      else if (e.key === ' ' && this.mode === 'game') this.setPaused(!this.stepper.paused);
      else if (e.key === 'f' || e.key === 'F') this.cycleSpeed();
      else if (e.key === 'n' || e.key === 'N') this.sendWave();
      else if (e.key === 'u' || e.key === 'U') this.upgradeSelected();
      else if (e.key === 'x' || e.key === 'X' || e.key === 'Delete') this.sellSelected();
      else if (e.key === 't' || e.key === 'T') this.cyclePriority();
      else if (e.key === 'm' || e.key === 'M') this.toggleMute();
      else if (e.key === '`') $('metrics').hidden = !$('metrics').hidden;
      else if (e.key === '0') this.camera.fit();
    });
    window.addEventListener('keyup', (e) => this.keysDown.delete(e.key));
    window.addEventListener('blur', () => this.keysDown.clear());
  }

  private handleEscape(): void {
    if (this.overlay.buildType >= 0 || this.overlay.selected >= 0) {
      this.overlay.buildType = -1;
      this.overlay.selected = -1;
    } else if (this.mode === 'game') {
      this.setPaused(!this.stepper.paused);
    }
  }

  private cyclePriority(): void {
    const t = this.overlay.selected;
    if (t >= 0) this.world.setPriority(t, (this.world.tPriority[t] + 1) % 4);
  }

  private applyKeyboardPan(seconds: number): void {
    if (this.keysDown.size === 0) return;
    const step = KEY_PAN_SPEED * seconds;
    const dx = (this.keysDown.has('ArrowLeft') ? step : 0) - (this.keysDown.has('ArrowRight') ? step : 0);
    const dy = (this.keysDown.has('ArrowUp') ? step : 0) - (this.keysDown.has('ArrowDown') ? step : 0);
    if (dx !== 0 || dy !== 0) this.camera.panBy(dx, dy);
  }

  private resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR) * this.renderScale;
    this.backend.resize(Math.round(width * dpr), Math.round(height * dpr));
    const top = $('top').hidden ? 12 : $('top').offsetHeight + 8;
    const bottom = $('bottom').hidden ? 12 : $('bottom').offsetHeight + 18;
    const left = $('lab').hidden ? 12 : $('lab').offsetWidth + 24;
    const insets: Insets = { top, right: 12, bottom, left };
    this.camera.resize(width, height, insets);
    this.camera.fit();
  }

  // ---- Measurement ----------------------------------------------------------

  /** Automation contract used by scripts/, matching the baseline's. */
  private exposeBench(): void {
    (window as unknown as { __bench: unknown }).__bench = {
      build: 'final',
      setStress: (enemies: number, towers: number, projectiles: number) => {
        const config = { enemies, towers, projectiles };
        if (this.mode === 'lab') {
          this.applyStress(config);
          this.stats.reset();
        } else {
          this.startLab(config);
        }
      },
      resetStats: () => this.stats.reset(),
      report: () => ({
        ...this.stats.summary(),
        enemies: this.world.enemyCount,
        towers: this.world.towerCount,
        projectiles: this.world.projectileCount,
        drawCalls: this.backend.drawCalls,
        sprites: this.scene.batch.count,
        drawnEnemies: this.scene.drawnEnemies,
        culledEnemies: this.scene.culledEnemies,
        renderScale: this.renderScale,
        backend: this.backend.name,
      }),
      setOptions: (options: { spatialGrid?: boolean; culling?: boolean; webgl?: boolean; adaptiveResolution?: boolean }) => {
        if (options.adaptiveResolution !== undefined) this.adaptiveResolution = options.adaptiveResolution;
        if (options.spatialGrid !== undefined) this.world.options.spatialGrid = options.spatialGrid;
        if (options.culling !== undefined) this.scene.options.culling = options.culling;
        if (options.webgl !== undefined) this.setBackend(options.webgl);
      },
      zoomTo: (factor: number) => {
        this.camera.fit();
        this.camera.zoomAt(this.camera.width / 2, this.camera.height / 2, factor);
      },
      fit: () => this.camera.fit(),
      startGame: (hard = false) => this.startGame(hard ? DIFFICULTIES.hard : DIFFICULTIES.normal),
      setSpeed: (speed: number) => this.setSpeed(speed),
      startAutoplay: (profile: keyof typeof BOT_PROFILES = 'strong') => {
        const bot = new Bot(BOT_PROFILES[profile]);
        this.autoplay = (world) => bot.act(world);
      },
      world: () => this.world,
      camera: () => this.camera,
      speed: () => this.stepper.speed,
      ticksPerSecond: TICK_RATE,
    };
  }
}
