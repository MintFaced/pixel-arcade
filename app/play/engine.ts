/**
 * PixelArcade: SWARM — game engine (session 5a prototype).
 *
 * Pure TypeScript game logic. No React imports — this runs as a self-contained
 * game inside a Canvas element. The React wrapper just mounts the canvas,
 * starts/stops the engine, and reads score/lives for the HUD.
 *
 * Architecture:
 *   - GameEngine owns state, runs the tick loop
 *   - Entities (Player, Bullet, Enemy, Particle) are simple classes with
 *     update(dt) and render(ctx) methods
 *   - InputState tracks pressed keys via ref
 *   - HUD callbacks fire on score/lives change so React can update the chrome
 *
 * Session 5a scope: 3 waves of mfer-grunt enemies (formation entry + dives),
 * placeholder geometric sprites, single-player only.
 */

// ============================================================
// Constants
// ============================================================

const PLAYFIELD_W = 480;
const PLAYFIELD_H = 640;

const PLAYER_SPEED = 280;       // px / sec
const PLAYER_FIRE_RATE = 5;     // shots / sec
const BULLET_SPEED = 480;
const ENEMY_DIVE_SPEED = 180;
const ENEMY_FORMATION_AMPLITUDE = 24;   // px sway

const STARTING_LIVES = 3;
const ENEMY_SCORE = 50;
const STREAK_THRESHOLDS = [
  { count: 0, multiplier: 1 },
  { count: 5, multiplier: 2 },
  { count: 10, multiplier: 3 },
];

// ============================================================
// Types
// ============================================================

export interface GameStats {
  score: number;
  lives: number;
  wave: number;
  streak: number;
  multiplier: number;
}

export type GamePhase = 'pre-game' | 'wave-intro' | 'playing' | 'wave-clear' | 'game-over';

export interface GameCallbacks {
  /** Called when score/lives/wave change. Use to update React HUD. */
  onStatsChange?: (stats: GameStats) => void;
  /** Called when phase transitions. Use for wave intro text, game over screen. */
  onPhaseChange?: (phase: GamePhase, context?: { score?: number; wave?: number }) => void;
}

// ============================================================
// Entities
// ============================================================

interface Entity {
  x: number;
  y: number;
  w: number;
  h: number;
  alive: boolean;
}

class Player implements Entity {
  x: number;
  y: number;
  w = 24;
  h = 24;
  alive = true;
  invulnerable = 0; // seconds remaining of post-respawn invulnerability

  constructor() {
    this.x = PLAYFIELD_W / 2;
    this.y = PLAYFIELD_H - 60;
  }

  update(dt: number, input: InputState) {
    if (input.left) this.x -= PLAYER_SPEED * dt;
    if (input.right) this.x += PLAYER_SPEED * dt;
    this.x = Math.max(this.w / 2, Math.min(PLAYFIELD_W - this.w / 2, this.x));
    if (this.invulnerable > 0) this.invulnerable -= dt;
  }

  render(ctx: CanvasRenderingContext2D) {
    // Blink during invulnerability
    if (this.invulnerable > 0 && Math.floor(this.invulnerable * 10) % 2 === 0) return;
    ctx.save();
    ctx.translate(this.x, this.y);
    // Placeholder triangular ship (will become mfer/Noun art in 5b)
    ctx.fillStyle = '#00ffd0';
    ctx.shadowColor = '#00ffd0';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(0, -this.h / 2);
    ctx.lineTo(-this.w / 2, this.h / 2);
    ctx.lineTo(this.w / 2, this.h / 2);
    ctx.closePath();
    ctx.fill();
    // Cockpit
    ctx.fillStyle = '#ffe000';
    ctx.shadowBlur = 0;
    ctx.fillRect(-3, -2, 6, 6);
    ctx.restore();
  }
}

class Bullet implements Entity {
  x: number;
  y: number;
  w = 3;
  h = 10;
  alive = true;
  velocityY: number;
  fromPlayer: boolean;

  constructor(x: number, y: number, fromPlayer: boolean) {
    this.x = x;
    this.y = y;
    this.fromPlayer = fromPlayer;
    this.velocityY = fromPlayer ? -BULLET_SPEED : BULLET_SPEED * 0.6;
  }

  update(dt: number) {
    this.y += this.velocityY * dt;
    if (this.y < -10 || this.y > PLAYFIELD_H + 10) this.alive = false;
  }

  render(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.fillStyle = this.fromPlayer ? '#ffe000' : '#ff4444';
    ctx.shadowColor = ctx.fillStyle as string;
    ctx.shadowBlur = 6;
    ctx.fillRect(this.x - this.w / 2, this.y - this.h / 2, this.w, this.h);
    ctx.restore();
  }
}

type EnemyState = 'formation-entering' | 'formation' | 'diving';

class Enemy implements Entity {
  x: number;
  y: number;
  w = 24;
  h = 22;
  alive = true;
  state: EnemyState = 'formation-entering';
  /** Target slot in the formation grid */
  formationX: number;
  formationY: number;
  /** For entry: bezier-like curve from entry point to formation slot */
  entryProgress = 0;     // 0..1
  entryStartX: number;
  entryStartY: number;
  /** For diving: path is a series of points */
  diveT = 0;             // 0..1 along dive path
  diveStartX = 0;
  diveStartY = 0;
  /** Index in wave for staggered formation entry */
  index: number;

  constructor(index: number, formationX: number, formationY: number, entryStartX: number, entryStartY: number) {
    this.index = index;
    this.formationX = formationX;
    this.formationY = formationY;
    this.entryStartX = entryStartX;
    this.entryStartY = entryStartY;
    this.x = entryStartX;
    this.y = entryStartY;
  }

  update(dt: number, t: number) {
    if (this.state === 'formation-entering') {
      this.entryProgress += dt * 0.5; // 2 sec to enter
      if (this.entryProgress >= 1) {
        this.entryProgress = 1;
        this.state = 'formation';
        this.x = this.formationX;
        this.y = this.formationY;
      } else {
        // Quadratic bezier from start to formation via a midpoint that
        // gives the curve a nice swoop
        const p = this.entryProgress;
        const mx = this.entryStartX < PLAYFIELD_W / 2 ? PLAYFIELD_W * 0.8 : PLAYFIELD_W * 0.2;
        const my = PLAYFIELD_H * 0.4;
        const oneP = 1 - p;
        this.x = oneP * oneP * this.entryStartX + 2 * oneP * p * mx + p * p * this.formationX;
        this.y = oneP * oneP * this.entryStartY + 2 * oneP * p * my + p * p * this.formationY;
      }
    } else if (this.state === 'formation') {
      // Sway in formation
      const phase = t + this.index * 0.3;
      this.x = this.formationX + Math.sin(phase * 1.5) * ENEMY_FORMATION_AMPLITUDE;
    } else if (this.state === 'diving') {
      this.diveT += dt * 0.8;
      if (this.diveT >= 1) {
        // Loop back to formation off-screen
        if (this.y > PLAYFIELD_H + 30) {
          this.state = 'formation-entering';
          this.entryProgress = 0;
          this.entryStartX = Math.random() < 0.5 ? -30 : PLAYFIELD_W + 30;
          this.entryStartY = -30;
          this.diveT = 0;
        }
      }
      // Sine-arc dive path
      const t01 = this.diveT;
      const targetX = this.formationX; // back to original X at the bottom — but offset by sine
      const xCurve = Math.sin(t01 * Math.PI * 1.5) * 80;
      this.x = this.diveStartX + (targetX - this.diveStartX) * t01 + xCurve;
      this.y = this.diveStartY + ENEMY_DIVE_SPEED * 2 * t01;
    }
  }

  startDive() {
    if (this.state !== 'formation') return;
    this.state = 'diving';
    this.diveT = 0;
    this.diveStartX = this.x;
    this.diveStartY = this.y;
  }

  render(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.translate(this.x, this.y);
    // Placeholder mfer-grunt enemy (will be real mfer sprite in 5b)
    ctx.fillStyle = '#ff1ad9';
    ctx.shadowColor = '#ff1ad9';
    ctx.shadowBlur = 6;
    ctx.fillRect(-this.w / 2, -this.h / 2, this.w, this.h);
    // Eyes
    ctx.fillStyle = '#ffffff';
    ctx.shadowBlur = 0;
    ctx.fillRect(-7, -5, 4, 4);
    ctx.fillRect(3, -5, 4, 4);
    // Mouth (smirk)
    ctx.fillStyle = '#000';
    ctx.fillRect(-5, 4, 10, 2);
    ctx.restore();
  }
}

class Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  alive = true;

  constructor(x: number, y: number, color: string) {
    this.x = x;
    this.y = y;
    this.vx = (Math.random() - 0.5) * 240;
    this.vy = (Math.random() - 0.5) * 240;
    this.maxLife = 0.4 + Math.random() * 0.3;
    this.life = this.maxLife;
    this.color = color;
  }

  update(dt: number) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vx *= 0.9;
    this.vy *= 0.9;
    this.life -= dt;
    if (this.life <= 0) this.alive = false;
  }

  render(ctx: CanvasRenderingContext2D) {
    const alpha = this.life / this.maxLife;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = this.color;
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 6;
    const size = 3 + alpha * 3;
    ctx.fillRect(this.x - size / 2, this.y - size / 2, size, size);
    ctx.restore();
  }
}

// ============================================================
// Input
// ============================================================

interface InputState {
  left: boolean;
  right: boolean;
  fire: boolean;
}

// ============================================================
// Game Engine
// ============================================================

export class GameEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private callbacks: GameCallbacks;

  // State
  private phase: GamePhase = 'pre-game';
  private wave = 0;
  private score = 0;
  private lives = STARTING_LIVES;
  private streak = 0;
  private bestStreak = 0;

  // Entities
  private player: Player = new Player();
  private bullets: Bullet[] = [];
  private enemies: Enemy[] = [];
  private particles: Particle[] = [];

  // Loop
  private lastTime = 0;
  private rafId: number | null = null;
  private running = false;
  private elapsed = 0;       // total game time
  private phaseTime = 0;     // time in current phase
  private fireCooldown = 0;
  private diveTimer = 0;     // time until next enemy dives

  // Input ref — set externally by React
  private input: InputState = { left: false, right: false, fire: false };

  constructor(canvas: HTMLCanvasElement, callbacks: GameCallbacks = {}) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get canvas 2D context');
    this.ctx = ctx;
    this.callbacks = callbacks;
  }

  setInput(input: Partial<InputState>) {
    this.input = { ...this.input, ...input };
  }

  start() {
    this.reset();
    this.running = true;
    this.lastTime = performance.now();
    this.loop();
  }

  stop() {
    this.running = false;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
  }

  reset() {
    this.phase = 'wave-intro';
    this.phaseTime = 0;
    this.wave = 1;
    this.score = 0;
    this.lives = STARTING_LIVES;
    this.streak = 0;
    this.bestStreak = 0;
    this.player = new Player();
    this.bullets = [];
    this.enemies = [];
    this.particles = [];
    this.elapsed = 0;
    this.emitStats();
    this.emitPhase();
  }

  private loop = () => {
    if (!this.running) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.elapsed += dt;
    this.phaseTime += dt;

    this.update(dt);
    this.render();

    this.rafId = requestAnimationFrame(this.loop);
  };

  private update(dt: number) {
    if (this.phase === 'wave-intro') {
      // Hold for ~1.5 sec then spawn formation
      if (this.phaseTime > 1.5) {
        this.spawnFormation();
        this.phase = 'playing';
        this.phaseTime = 0;
        this.diveTimer = 1.5;
        this.emitPhase();
      }
      // Render only — player is interactive but no enemies yet
      this.player.update(dt, this.input);
      this.updateBullets(dt);
      this.updateParticles(dt);
      return;
    }

    if (this.phase === 'playing') {
      this.player.update(dt, this.input);

      // Fire
      this.fireCooldown -= dt;
      if (this.input.fire && this.fireCooldown <= 0) {
        this.bullets.push(new Bullet(this.player.x, this.player.y - 14, true));
        this.fireCooldown = 1 / PLAYER_FIRE_RATE;
      }

      this.updateBullets(dt);
      this.updateParticles(dt);

      // Update enemies
      for (const e of this.enemies) e.update(dt, this.elapsed);

      // Trigger dives periodically
      this.diveTimer -= dt;
      if (this.diveTimer <= 0) {
        const formationMembers = this.enemies.filter((e) => e.state === 'formation' && e.alive);
        if (formationMembers.length > 0) {
          const picker = formationMembers[Math.floor(Math.random() * formationMembers.length)];
          picker.startDive();
        }
        this.diveTimer = 1.0 + Math.random() * 0.8;
      }

      this.checkCollisions();

      // Wave clear check — only if at least one enemy was ever spawned
      const aliveEnemies = this.enemies.filter((e) => e.alive);
      if (aliveEnemies.length === 0) {
        this.phase = 'wave-clear';
        this.phaseTime = 0;
        // Wave clear bonus
        this.score += 100 * this.wave;
        this.emitStats();
        this.emitPhase();
      }
      return;
    }

    if (this.phase === 'wave-clear') {
      // Show wave clear briefly, then next wave (or end if 3 waves done in 5a)
      if (this.phaseTime > 2) {
        if (this.wave >= 3) {
          // End of demo
          this.phase = 'game-over';
          this.phaseTime = 0;
          this.emitPhase();
        } else {
          this.wave += 1;
          this.phase = 'wave-intro';
          this.phaseTime = 0;
          this.emitStats();
          this.emitPhase();
        }
      }
      // Still update player/bullets/particles
      this.player.update(dt, this.input);
      this.updateBullets(dt);
      this.updateParticles(dt);
      return;
    }

    if (this.phase === 'game-over') {
      this.updateParticles(dt);
      return;
    }
  }

  private updateBullets(dt: number) {
    for (const b of this.bullets) b.update(dt);
    this.bullets = this.bullets.filter((b) => b.alive);
  }

  private updateParticles(dt: number) {
    for (const p of this.particles) p.update(dt);
    this.particles = this.particles.filter((p) => p.alive);
  }

  private spawnFormation() {
    // Grid: 6 cols × 3 rows = 18 enemies, scaled with wave
    const cols = 6;
    const rows = Math.min(3 + Math.floor(this.wave / 3), 5);
    const slotW = 56;
    const slotH = 44;
    const gridW = cols * slotW;
    const startX = (PLAYFIELD_W - gridW) / 2 + slotW / 2;
    const startY = 80;

    let index = 0;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const fx = startX + col * slotW;
        const fy = startY + row * slotH;
        // Entry from alternating sides
        const fromLeft = (row + col) % 2 === 0;
        const exStart = fromLeft ? -30 : PLAYFIELD_W + 30;
        const eyStart = -30 - index * 8;
        this.enemies.push(new Enemy(index, fx, fy, exStart, eyStart));
        index++;
      }
    }
  }

  private checkCollisions() {
    // Player bullets vs enemies
    for (const b of this.bullets) {
      if (!b.fromPlayer || !b.alive) continue;
      for (const e of this.enemies) {
        if (!e.alive) continue;
        if (rectsOverlap(b, e)) {
          b.alive = false;
          e.alive = false;
          this.score += ENEMY_SCORE * this.currentMultiplier();
          this.streak += 1;
          this.bestStreak = Math.max(this.bestStreak, this.streak);
          this.explode(e.x, e.y, '#ff1ad9');
          this.emitStats();
          break;
        }
      }
    }

    // Enemies vs player
    if (this.player.invulnerable <= 0) {
      for (const e of this.enemies) {
        if (!e.alive) continue;
        if (rectsOverlap(this.player, e)) {
          this.onPlayerHit();
          e.alive = false;
          this.explode(e.x, e.y, '#ff1ad9');
          break;
        }
      }
    }
  }

  private currentMultiplier(): number {
    let m = 1;
    for (const t of STREAK_THRESHOLDS) {
      if (this.streak >= t.count) m = t.multiplier;
    }
    return m;
  }

  private onPlayerHit() {
    this.lives -= 1;
    this.streak = 0;
    this.explode(this.player.x, this.player.y, '#00ffd0');
    this.emitStats();
    if (this.lives <= 0) {
      this.phase = 'game-over';
      this.phaseTime = 0;
      this.emitPhase();
    } else {
      this.player = new Player();
      this.player.invulnerable = 1.5;
    }
  }

  private explode(x: number, y: number, color: string) {
    for (let i = 0; i < 14; i++) {
      this.particles.push(new Particle(x, y, color));
    }
  }

  private render() {
    const ctx = this.ctx;
    // Fit canvas with scaling — game uses logical 480x640
    const scale = Math.min(this.canvas.width / PLAYFIELD_W, this.canvas.height / PLAYFIELD_H);
    const ox = (this.canvas.width - PLAYFIELD_W * scale) / 2;
    const oy = (this.canvas.height - PLAYFIELD_H * scale) / 2;

    ctx.save();
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.translate(ox, oy);
    ctx.scale(scale, scale);

    // Star field background
    this.renderStars(ctx);

    // Entities
    for (const e of this.enemies) if (e.alive) e.render(ctx);
    for (const b of this.bullets) b.render(ctx);
    for (const p of this.particles) p.render(ctx);
    if (this.player.alive && this.phase !== 'game-over') this.player.render(ctx);

    // Phase text overlays
    if (this.phase === 'wave-intro') {
      this.renderCenterText(ctx, `WAVE ${this.wave}`, `★ MFER SWARM INCOMING ★`);
    } else if (this.phase === 'wave-clear') {
      this.renderCenterText(ctx, `WAVE ${this.wave} CLEAR`, `+${100 * this.wave} BONUS`);
    } else if (this.phase === 'game-over') {
      this.renderCenterText(ctx, `GAME OVER`, `SCORE ${this.score}`);
    }

    ctx.restore();
  }

  private renderStars(ctx: CanvasRenderingContext2D) {
    // Pseudo-random static field
    ctx.save();
    for (let i = 0; i < 60; i++) {
      const x = (i * 73 + 37) % PLAYFIELD_W;
      const y = ((i * 113 + 191 + this.elapsed * 30) % PLAYFIELD_H);
      const size = (i % 5) === 0 ? 2 : 1;
      ctx.fillStyle = (i % 7) === 0 ? '#ff1ad9' : '#ffffff';
      ctx.globalAlpha = 0.3 + ((i % 3) * 0.2);
      ctx.fillRect(x, y, size, size);
    }
    ctx.restore();
  }

  private renderCenterText(ctx: CanvasRenderingContext2D, title: string, sub: string) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffe000';
    ctx.shadowColor = '#ffe000';
    ctx.shadowBlur = 10;
    ctx.font = 'bold 28px "Press Start 2P", monospace';
    ctx.fillText(title, PLAYFIELD_W / 2, PLAYFIELD_H / 2);
    ctx.fillStyle = '#00ffd0';
    ctx.shadowColor = '#00ffd0';
    ctx.font = '12px "Press Start 2P", monospace';
    ctx.fillText(sub, PLAYFIELD_W / 2, PLAYFIELD_H / 2 + 30);
    ctx.restore();
  }

  // Public
  getPhase(): GamePhase { return this.phase; }
  getStats(): GameStats {
    return {
      score: this.score,
      lives: this.lives,
      wave: this.wave,
      streak: this.streak,
      multiplier: this.currentMultiplier(),
    };
  }

  private emitStats() {
    this.callbacks.onStatsChange?.(this.getStats());
  }
  private emitPhase() {
    this.callbacks.onPhaseChange?.(this.phase, { score: this.score, wave: this.wave });
  }
}

function rectsOverlap(a: Entity, b: Entity): boolean {
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2;
}

export { PLAYFIELD_W, PLAYFIELD_H };
