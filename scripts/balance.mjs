// Plays complete games headlessly to check that the difficulty curve is sensible.
//   node scripts/balance.mjs
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const { World, DIFFICULTIES } = await server.ssrLoadModule('/src/sim/world.ts');
const { Bot, BOT_PROFILES } = await server.ssrLoadModule('/src/sim/bot.ts');

const MAX_TICKS = 60 * 60 * 60 * 4;

function play(profile, difficulty, seed) {
  const world = new World(seed, DIFFICULTIES[difficulty]);
  const bot = new Bot(BOT_PROFILES[profile]);
  let peak = 0;
  const start = performance.now();
  while (world.phase !== 'won' && world.phase !== 'lost' && world.tick < MAX_TICKS) {
    bot.act(world);
    world.step();
    world.fx.clear();
    if (world.enemyCount > peak) peak = world.enemyCount;
  }
  return { profile, difficulty, seed, phase: world.phase, wave: world.waveNumber, lives: world.lives, kills: world.kills, money: world.money, towers: world.towerCount, score: world.score, peakEnemies: peak, gameMinutes: +(world.tick / 3600).toFixed(1), wallSeconds: +((performance.now() - start) / 1000).toFixed(1) };
}

for (const [profile, difficulty] of [['strong', 'normal'], ['average', 'normal'], ['weak', 'normal'], ['strong', 'hard'], ['average', 'hard']]) {
  for (const seed of [1, 2, 3]) {
    const r = play(profile, difficulty, seed);
    console.log(`${profile.padEnd(8)} ${difficulty.padEnd(7)} seed ${seed}: ${r.phase.padEnd(5)} wave ${String(r.wave).padStart(2)}  lives ${String(r.lives).padStart(2)}  kills ${String(r.kills).padStart(6)}  peak ${String(r.peakEnemies).padStart(5)}  towers ${String(r.towers).padStart(2)}  $${r.money}  ${r.gameMinutes}min  (${r.wallSeconds}s)`);
  }
}
await server.close();
