import { ENEMIES } from '../data/enemies';
import { MAX_TOWER_LEVEL, PRIORITY_NAMES, TOWERS, TowerKind, type TowerDef, type TowerLevel } from '../data/towers';
import { TOTAL_WAVES, type WaveDef } from '../data/waves';
import { NORTH_ROUTE_WAVE } from '../data/map';
import type { Atlas } from '../render/atlas';
import type { Sprite } from '../render/batch';
import { TICK_RATE, type World } from '../sim/world';

export interface HudActions {
  chooseTower(type: number): void;
  upgradeSelected(): void;
  sellSelected(): void;
  setPriority(priority: number): void;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function iconUrl(atlas: Atlas, sprites: Sprite[], px = 88): string {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = px;
  const c = canvas.getContext('2d')!;
  const size = atlas.canvas.width;
  for (const s of sprites) c.drawImage(atlas.canvas, s.u * size, s.v * size, s.uw * size, s.vh * size, 0, 0, px, px);
  return canvas.toDataURL();
}

function statRows(def: TowerDef, stats: TowerLevel, next?: TowerLevel): string {
  const diff = (a: number, b: number | undefined, format: (v: number) => string) =>
    `<b>${format(a)}${b !== undefined && format(a) !== format(b) ? `<em>${format(b)}</em>` : ''}</b>`;
  const whole = (v: number) => String(Math.round(v));
  const rate = (s: TowerLevel) => 1 / s.cooldown;
  const rows = [
    `<div><span>Damage</span>${diff(stats.damage, next?.damage, whole)}</div>`,
    `<div><span>Range</span>${diff(stats.range, next?.range, whole)}</div>`,
    `<div><span>Attacks/s</span>${diff(rate(stats), next && rate(next), (v) => v.toFixed(1))}</div>`,
  ];
  if (stats.splash > 0) rows.push(`<div><span>Splash</span>${diff(stats.splash, next?.splash, whole)}</div>`);
  if (stats.chains > 0) rows.push(`<div><span>Chains</span>${diff(stats.chains, next?.chains, whole)}</div>`);
  if (def.kind === TowerKind.Aura) rows.push(`<div><span>Slow</span>${diff(1 - stats.slow, next && 1 - next.slow, (v) => `${Math.round(v * 100)}%`)}</div>`);
  return rows.join('');
}

/**
 * The DOM layer. Called every frame, but it only touches an element when the
 * displayed value changes, so DOM cost stays flat however busy the battlefield is.
 */
export class Hud {
  private readonly waveEl = $('h-wave');
  private readonly livesEl = $('h-lives');
  private readonly moneyEl = $('h-money');
  private readonly scoreEl = $('h-score');
  private readonly nextEl = $<HTMLButtonElement>('b-next');
  private readonly previewEl = $('preview');
  private readonly selectedEl = $('selected');
  private readonly bannerEl = $('banner');
  private readonly noticeEl = $('notice');
  private readonly towerButtons: HTMLButtonElement[] = [];
  private readonly tooltip = document.createElement('div');
  private readonly towerIcons: string[];
  private readonly enemyIcons: string[];

  private lastWave = '';
  private lastLives = -1;
  private lastMoney = -1;
  private lastScore = -1;
  private lastNext = '';
  private lastNextDisabled = false;
  private lastPreview = -1;
  private lastSelected = -2;
  private lastSelectedLevel = -1;
  private lastSelectedPriority = -1;
  private lastSelectedKills = -1;
  private lastAffordMoney = -1;
  private lastBuild = -2;
  private noticeTimer = 0;

  constructor(atlas: Atlas, private readonly actions: HudActions) {
    this.towerIcons = TOWERS.map((_, i) => iconUrl(atlas, [atlas.towerPlates[i], atlas.turrets[i][0]]));
    this.enemyIcons = ENEMIES.map((_, i) => iconUrl(atlas, [atlas.enemies[i]], 52));
    this.tooltip.id = 'tooltip';
    this.tooltip.hidden = true;
    document.body.appendChild(this.tooltip);

    const bar = $('bottom');
    TOWERS.forEach((def, i) => {
      const b = document.createElement('button');
      b.className = 'tower';
      b.innerHTML = `<img src="${this.towerIcons[i]}" alt="" draggable="false"><span class="name">${def.name}</span><span class="cost">$${def.levels[0].cost}</span><kbd>${def.hotkey}</kbd>`;
      b.onclick = () => actions.chooseTower(i);
      b.onpointerenter = () => this.showTooltip(b, def);
      b.onpointerleave = () => { this.tooltip.hidden = true; };
      bar.appendChild(b);
      this.towerButtons.push(b);
    });
  }

  private showTooltip(anchor: HTMLElement, def: TowerDef): void {
    const traits = [def.hitsAir ? 'Hits air' : 'Ground only', def.ignoresArmor ? 'ignores armor' : '', def.detectsStealth ? 'reveals stealth' : ''].filter(Boolean).join(', ');
    this.tooltip.innerHTML = `<b>${def.name}</b>${def.blurb}<div class="rows">${statRows(def, def.levels[0])}</div>${traits}`;
    this.tooltip.hidden = false;
    const rect = anchor.getBoundingClientRect();
    const left = Math.min(window.innerWidth - 250, Math.max(10, rect.left));
    this.tooltip.style.left = `${left}px`;
    this.tooltip.style.bottom = `${window.innerHeight - rect.top + 10}px`;
  }

  banner(text: string, sub = ''): void {
    const el = this.bannerEl;
    el.innerHTML = sub ? `${text}<small>${sub}</small>` : text;
    el.classList.remove('show');
    // Reading layout restarts the CSS animation when banners arrive back to back.
    void el.offsetWidth;
    el.classList.add('show');
  }

  notice(text: string): void {
    this.noticeEl.textContent = text;
    this.noticeEl.hidden = false;
    window.clearTimeout(this.noticeTimer);
    this.noticeTimer = window.setTimeout(() => { this.noticeEl.hidden = true; }, 1300);
  }

  private pop(el: HTMLElement): void {
    const parent = el.parentElement!;
    parent.classList.remove('pop');
    void parent.offsetWidth;
    parent.classList.add('pop');
  }

  /** Forces the next update to rewrite everything, after a new game starts. */
  invalidate(): void {
    this.lastWave = this.lastNext = '';
    this.lastLives = this.lastMoney = this.lastScore = this.lastPreview = this.lastAffordMoney = -1;
    this.lastSelected = this.lastBuild = -2;
  }

  update(world: World, selected: number, buildType: number): void {
    const wave = `${world.waveNumber}/${TOTAL_WAVES}`;
    if (wave !== this.lastWave) this.waveEl.textContent = this.lastWave = wave;

    if (world.lives !== this.lastLives) {
      if (world.lives < this.lastLives) this.pop(this.livesEl);
      this.livesEl.textContent = String(world.lives);
      this.lastLives = world.lives;
    }
    if (world.money !== this.lastMoney) {
      this.moneyEl.textContent = `$${world.money}`;
      this.lastMoney = world.money;
    }
    if (world.score !== this.lastScore) {
      this.scoreEl.textContent = world.score.toLocaleString('en-US');
      this.lastScore = world.score;
    }

    this.updateNextButton(world);
    if (world.waveNumber !== this.lastPreview) {
      this.lastPreview = world.waveNumber;
      this.renderPreview(world.nextWave);
    }
    this.updateTowerButtons(world, buildType);
    this.updateSelected(world, selected);
  }

  private updateNextButton(world: World): void {
    const canSend = world.phase === 'prep' && world.waveNumber < TOTAL_WAVES;
    const seconds = Math.ceil(world.prepTicks / TICK_RATE);
    const label = canSend ? (world.waveNumber === 0 ? `Start wave 1 (${seconds}s)` : `Send wave +$${seconds} (${seconds}s)`) : 'Wave in progress';
    if (label !== this.lastNext) this.nextEl.textContent = this.lastNext = label;
    if (!canSend !== this.lastNextDisabled) this.nextEl.disabled = this.lastNextDisabled = !canSend;
  }

  private renderPreview(next: WaveDef | null): void {
    if (!next) {
      this.previewEl.innerHTML = '<span class="title">Final wave</span>';
      return;
    }
    const counts = new Map<number, number>();
    for (const g of next.groups) counts.set(g.type, (counts.get(g.type) ?? 0) + g.count);
    const units = [...counts].map(([type, count]) => `<span class="unit" title="${ENEMIES[type].name}: ${ENEMIES[type].blurb}"><img src="${this.enemyIcons[type]}" alt="${ENEMIES[type].name}">${count}</span>`).join('');
    const gate = next.number === NORTH_ROUTE_WAVE ? '<span class="boss">NORTH GATE OPENS</span>' : '';
    this.previewEl.innerHTML = `<span class="title">Next</span>${units}${next.isBoss ? '<span class="boss">BOSS</span>' : ''}${gate}`;
  }

  private updateTowerButtons(world: World, buildType: number): void {
    if (buildType !== this.lastBuild) {
      this.lastBuild = buildType;
      this.towerButtons.forEach((b, i) => b.classList.toggle('active', i === buildType));
    }
    if (world.money !== this.lastAffordMoney) {
      this.lastAffordMoney = world.money;
      this.towerButtons.forEach((b, i) => b.classList.toggle('poor', world.money < TOWERS[i].levels[0].cost));
    }
  }

  private updateSelected(world: World, t: number): void {
    const valid = t >= 0 && world.tDenseIndex[t] >= 0;
    const id = valid ? t : -1;
    if (id === -1) {
      if (this.lastSelected !== -1) {
        this.lastSelected = -1;
        this.selectedEl.hidden = true;
      }
      return;
    }
    const level = world.tLevel[t];
    const priority = world.tPriority[t];
    const rebuilt = id !== this.lastSelected || level !== this.lastSelectedLevel || priority !== this.lastSelectedPriority;
    if (rebuilt) {
      this.lastSelected = id;
      this.lastSelectedLevel = level;
      this.lastSelectedPriority = priority;
      this.lastSelectedKills = -1;
      this.renderSelected(world, t);
    }
    if (world.tKills[t] !== this.lastSelectedKills) {
      this.lastSelectedKills = world.tKills[t];
      this.selectedEl.querySelector('#s-kills')!.textContent = String(world.tKills[t]);
    }
    const up = this.selectedEl.querySelector<HTMLButtonElement>('#s-up')!;
    const cost = world.upgradeCost(t);
    const disabled = cost === null || world.money < cost;
    if (up.disabled !== disabled) up.disabled = disabled;
  }

  private renderSelected(world: World, t: number): void {
    const def = TOWERS[world.tType[t]];
    const level = world.tLevel[t];
    const stats = def.levels[level - 1];
    const next = level < MAX_TOWER_LEVEL ? def.levels[level] : undefined;
    const cost = world.upgradeCost(t);
    const pips = Array.from({ length: MAX_TOWER_LEVEL }, (_, i) => `<i class="${i < level ? 'on' : ''}"></i>`).join('');
    const priorities = def.kind === TowerKind.Aura
      ? ''
      : `<div class="prio">${PRIORITY_NAMES.map((name, i) => `<button data-p="${i}" class="${i === world.tPriority[t] ? 'active' : ''}">${name}</button>`).join('')}</div>`;
    this.selectedEl.innerHTML = `
      <h3><img src="${this.towerIcons[world.tType[t]]}" alt="">${def.name}<span class="pips">${pips}</span></h3>
      <div class="rows">${statRows(def, stats, next)}<div><span>Kills</span><b id="s-kills">0</b></div></div>
      ${priorities}
      <div class="actions">
        <button id="s-up" class="primary">${cost === null ? 'Max level' : `Upgrade $${cost}`}</button>
        <button id="s-sell">Sell $${world.sellValue(t)}</button>
      </div>`;
    this.selectedEl.hidden = false;
    this.selectedEl.querySelector<HTMLButtonElement>('#s-up')!.onclick = () => this.actions.upgradeSelected();
    this.selectedEl.querySelector<HTMLButtonElement>('#s-sell')!.onclick = () => this.actions.sellSelected();
    this.selectedEl.querySelectorAll<HTMLButtonElement>('.prio button').forEach((b) => {
      b.onclick = () => this.actions.setPriority(Number(b.dataset.p));
    });
  }
}
