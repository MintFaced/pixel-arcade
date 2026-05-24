/**
 * PixelArcade: SWARM — game engine (session 5b).
 *
 * Full crypto-native build. Player ship = XNoun 468. Enemies = mfers (4 tiers
 * with distinct behaviors). Bosses every 5 waves = XCOPY-styled pieces.
 * Power-ups = 6 XNoun heads with timed effects.
 *
 * Architecture overview:
 *
 *   GameEngine                Owns the loop, dispatches phase
 *   ├─ Player                Sprite-rendered, power-up state attached
 *   ├─ Bullet[]              Player + enemy projectiles
 *   ├─ Enemy[]               Grunt/Runner/Sniper/Bomber + Boss subclasses
 *   ├─ PowerUp[]             Falling Noun pickups
 *   └─ Particle[]            Explosion debris
 *
 * Engine reads sprites from an AssetBundle passed at construction. Sprites
 * are HTMLImageElements ready for direct ctx.drawImage().
 *
 * Wave structure (30 waves):
 *   Waves 1-4:   mfer-grunt swarms (low intensity ramp)
 *   Wave 5:      BOSS — Damager
 *   Waves 6-9:   grunt + runner mix
 *   Wave 10:     BOSS — Doomed Red
 *   Waves 11-14: + sniper added
 *   Wave 15:     BOSS — Rage (red filled)
 *   Waves 16-19: + bomber added (full roster)
 *   Wave 20:     BOSS — Special Operation
 *   Waves 21-24: high density, all types
 *   Wave 25:     BOSS — Beast Mode
 *   Waves 26-29: max density, faster dives
 *   Wave 30:     BOSS — Max Pain (FINAL)
 */

import type { AssetBundle, SpriteKey } from './assets';
import { getAudio, musicForWave, type BossVoiceId } from './audio';

// ============================================================
// Constants — all tunables in one place for easy iteration
// ============================================================

const PLAYFIELD_W = 480;
const PLAYFIELD_H = 640;

const PLAYER_SPEED = 300;
const PLAYER_BASE_FIRE_RATE = 5;          // shots/sec
const BULLET_SPEED = 540;
const ENEMY_BULLET_SPEED = 260;

const STARTING_LIVES = 3;
const RESPAWN_INVULN_SEC = 1.5;

// Power-up durations (seconds)
const POWERUP_DURATION = {
  shield: Infinity,                       // until used
  firerate: 8,
  slowmo: 6,
  multiplier: 10,
  invincible: 4,
  // life: instant +1
} as const;

const FIRERATE_BOOST = 2.5;               // 5/sec → 12.5/sec
const SLOWMO_FACTOR = 0.45;
const SCORE_MULTIPLIER_BOOST = 2;

// Enemy stats
const ENEMY_STATS = {
  grunt:  { hp: 1, score:  50, dive_score_bonus: 1.5, speed_mult: 1.0, drop_chance: 0.04, can_fire: false },
  runner: { hp: 1, score: 100, dive_score_bonus: 2.0, speed_mult: 1.5, drop_chance: 0.08, can_fire: false },
  sniper: { hp: 2, score: 200, dive_score_bonus: 1.5, speed_mult: 0.8, drop_chance: 0.20, can_fire: true },
  bomber: { hp: 2, score: 300, dive_score_bonus: 1.5, speed_mult: 1.1, drop_chance: 0.30, can_fire: true },
  // Titan (Geodetic) — rare, fast double-shooter, high HP
  titan:  { hp: 5, score: 800, dive_score_bonus: 1.5, speed_mult: 1.3, drop_chance: 0.55, can_fire: true },
} as const;

// Streak thresholds
const STREAK_THRESHOLDS = [
  { count:  0, multiplier: 1 },
  { count:  5, multiplier: 2 },
  { count: 10, multiplier: 3 },
  { count: 20, multiplier: 4 },
];

const POWERUP_SCORE = 500;                // noun-multiplier instant bonus

// ============================================================
// Types
// ============================================================

export interface GameStats {
  score: number;
  lives: number;
  wave: number;
  streak: number;
  multiplier: number;
  activeBoosts: ActiveBoost[];
  bossHp: { current: number; max: number; name: string } | null;
  // Two-player mode info
  mode: 'single' | 'twoPlayer';
  currentPlayer: 1 | 2;
  /** Captured score for P1 once their turn ends (0 before) */
  p1Score: number;
  /** Wave P1 reached when they finished */
  p1Wave: number;
  /** Captured score for P2 once their turn ends (0 before) */
  p2Score: number;
  p2Wave: number;
}

export type GamePhase =
  | 'pre-game' | 'wave-intro' | 'playing' | 'boss-incoming'
  | 'wave-clear' | 'victory' | 'mintface-incoming' | 'true-victory' | 'game-over'
  // Two-player hot-seat phases
  | 'p2-ready'        // P1 done, P2 press to start
  | 'match-over';     // Both players done, show comparison

export interface GameCallbacks {
  onStatsChange?: (stats: GameStats) => void;
  onPhaseChange?: (phase: GamePhase, ctx?: { score?: number; wave?: number; bossName?: string }) => void;
}

interface ActiveBoost {
  type: PowerUpType;
  remaining: number;     // sec, Infinity for shield
}

type PowerUpType = 'shield' | 'life' | 'firerate' | 'slowmo' | 'multiplier' | 'invincible';

const POWERUP_SPRITE: Record<PowerUpType, SpriteKey> = {
  shield:      'noun-shield',
  life:        'noun-life',
  firerate:    'noun-firerate',
  slowmo:      'noun-slowmo',
  multiplier:  'noun-multiplier',
  invincible:  'noun-invincible',
};

type EnemyTier = 'grunt' | 'runner' | 'sniper' | 'bomber' | 'titan';

const ENEMY_SPRITE: Record<EnemyTier, SpriteKey> = {
  grunt:  'mfer-grunt',
  runner: 'mfer-runner',
  sniper: 'mfer-sniper',
  bomber: 'mfer-bomber',
  titan:  'mfer-titan',
};

interface BossDescriptor {
  name: string;
  sprite: SpriteKey;
  hp: number;
  pattern: 'spiral' | 'sweep' | 'beam' | 'rain' | 'rage' | 'mixed' | 'transcend';
  /** Color used for boss HP bar */
  color: string;
  /** Phrases boss occasionally shouts in a speech bubble. Random pick each time. */
  taunts: string[];
  /** Voice ID for audio taunts (maps to /swarm/audio/voice/taunt-{voiceId}-N.mp3) */
  voiceId: BossVoiceId;
}

const BOSSES: Record<number, BossDescriptor> = {
  5:  {
    name: 'DAMAGER', sprite: 'boss-damager', hp: 30, pattern: 'spiral', color: '#ff1ad9',
    voiceId: 'damager',
    taunts: [
      'BATTERY LOW',
      'POWER DRAIN INITIATED',
      'YOU CANT CHARGE OUT',
      'SYSTEM FAILURE IMMINENT',
    ],
  },
  10: {
    name: '6529 PUNK', sprite: 'boss-doomed-red', hp: 50, pattern: 'sweep', color: '#7eb8d4',
    voiceId: '6529-punk',
    taunts: [
      'SEIZE THE MEMES!',
      'YOU ARE NOT BULLISH ENOUGH!',
      'FREEDOM TO TRANSACT',
      'DONT LET THEM!',
    ],
  },
  15: {
    name: 'RAGE', sprite: 'boss-rage', hp: 70, pattern: 'rain', color: '#ff0000',
    voiceId: 'rage',
    taunts: [
      'RAGE MODE ACTIVATED',
      'NO MERCY',
      'BURN IT DOWN',
      'YOU CHOSE WRONG',
    ],
  },
  20: {
    name: 'SPECIAL OP', sprite: 'boss-spec-ops', hp: 95, pattern: 'beam', color: '#3a55ff',
    voiceId: 'spec-ops',
    taunts: [
      'ORDERS ARE ORDERS',
      'COMPLIANCE IS MANDATORY',
      'RESISTANCE IS NOISE',
      'STEP IN LINE',
    ],
  },
  25: {
    name: 'BEAST MODE', sprite: 'boss-beast', hp: 120, pattern: 'rage', color: '#00d5cc',
    voiceId: 'beast-mode',
    taunts: [
      'FEED ME',
      'ALPHA DETECTED',
      'I HUNGER',
      'YOU SMELL LIKE EXIT LIQUIDITY',
    ],
  },
  30: {
    name: 'MAX PAIN', sprite: 'boss-maxpain', hp: 200, pattern: 'mixed', color: '#ff1ad9',
    voiceId: 'max-pain',
    taunts: [
      'THIS IS THE BOTTOM',
      'JUST KIDDING',
      'MAXIMUM PAIN PROTOCOL',
      'EVERYONE GETS REKT',
      'I AM INEVITABLE',
      'THERE IS NO ESCAPE',
    ],
  },
  // Secret final boss — only unlocked by clearing wave 30
  31: {
    name: 'MINTFACE', sprite: 'boss-mintface', hp: 300, pattern: 'transcend', color: '#ffe000',
    voiceId: 'mintface',
    taunts: [
      'I AM THE ARTIST',
      'THIS IS MY ARCADE',
      'YOU MADE IT THIS FAR',
      'NOW PROVE IT',
      '64 PAINTINGS. ONE CHANCE.',
      'PRESS START TO TRANSCEND',
      'THE LINE NEW ZEALAND',
    ],
  },
};

/** The secret final boss wave — only reachable by beating wave 30 */
const SECRET_FINAL_WAVE = 31;
const FINAL_WAVE = 30;

// ============================================================
// Entity interfaces
// ============================================================

interface Entity {
  x: number;
  y: number;
  w: number;
  h: number;
  alive: boolean;
}

// ============================================================
// Player
// ============================================================

class Player implements Entity {
  x: number;
  y: number;
  w = 32;
  h = 32;
  alive = true;
  invulnerable = 0;
  boosts: Map<PowerUpType, number> = new Map();   // type -> remaining sec
  sprite: HTMLImageElement;

  constructor(sprite: HTMLImageElement) {
    this.x = PLAYFIELD_W / 2;
    this.y = PLAYFIELD_H - 60;
    this.sprite = sprite;
  }

  update(dt: number, input: InputState) {
    const speedMult = this.boosts.has('slowmo') ? 1.4 : 1; // player can dodge faster during slow-mo on enemies
    if (input.left) this.x -= PLAYER_SPEED * speedMult * dt;
    if (input.right) this.x += PLAYER_SPEED * speedMult * dt;
    this.x = Math.max(this.w / 2, Math.min(PLAYFIELD_W - this.w / 2, this.x));
    if (this.invulnerable > 0) this.invulnerable -= dt;
    // Tick down boosts
    for (const [type, remaining] of this.boosts) {
      if (remaining === Infinity) continue;
      const next = remaining - dt;
      if (next <= 0) this.boosts.delete(type);
      else this.boosts.set(type, next);
    }
  }

  getFireRate(): number {
    return this.boosts.has('firerate')
      ? PLAYER_BASE_FIRE_RATE * FIRERATE_BOOST
      : PLAYER_BASE_FIRE_RATE;
  }

  isInvincible(): boolean {
    return this.invulnerable > 0 || this.boosts.has('invincible');
  }

  hasShield(): boolean {
    return this.boosts.has('shield');
  }

  consumeShield() {
    this.boosts.delete('shield');
  }

  applyPowerUp(type: PowerUpType): boolean {
    if (type === 'life') return false; // caller handles life as engine-state
    const duration = POWERUP_DURATION[type as Exclude<PowerUpType, 'life'>];
    this.boosts.set(type, duration);
    return true;
  }

  render(ctx: CanvasRenderingContext2D) {
    if (this.invulnerable > 0 && Math.floor(this.invulnerable * 12) % 2 === 0) return;
    ctx.save();
    ctx.translate(this.x, this.y);
    // Halo if shield
    if (this.hasShield() || this.boosts.has('invincible')) {
      ctx.fillStyle = 'rgba(0, 255, 240, 0.35)';
      ctx.beginPath();
      ctx.arc(0, 0, this.w * 0.85, 0, Math.PI * 2);
      ctx.fill();
    }
    // Multiplier glow
    if (this.boosts.has('multiplier')) {
      ctx.shadowColor = '#ffe000';
      ctx.shadowBlur = 12;
    }
    ctx.drawImage(this.sprite, -this.w / 2, -this.h / 2, this.w, this.h);
    ctx.restore();
  }
}

// ============================================================
// Bullets
// ============================================================

class Bullet implements Entity {
  x: number;
  y: number;
  w: number;
  h: number;
  alive = true;
  vx: number;
  vy: number;
  fromPlayer: boolean;
  color: string;
  piercing: boolean;

  constructor(x: number, y: number, fromPlayer: boolean, vx = 0, vy?: number, color?: string, piercing = false) {
    this.x = x;
    this.y = y;
    this.fromPlayer = fromPlayer;
    this.w = 4;
    this.h = 12;
    this.vx = vx;
    this.vy = vy ?? (fromPlayer ? -BULLET_SPEED : ENEMY_BULLET_SPEED);
    this.color = color ?? (fromPlayer ? '#ffe000' : '#ff4444');
    this.piercing = piercing;
  }

  update(dt: number) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    if (this.y < -20 || this.y > PLAYFIELD_H + 20 || this.x < -20 || this.x > PLAYFIELD_W + 20) {
      this.alive = false;
    }
  }

  render(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.fillStyle = this.color;
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 8;
    ctx.fillRect(this.x - this.w / 2, this.y - this.h / 2, this.w, this.h);
    ctx.restore();
  }
}

// ============================================================
// Enemies
// ============================================================

type EnemyState = 'formation-entering' | 'formation' | 'diving';

class Enemy implements Entity {
  x: number;
  y: number;
  w: number;
  h: number;
  alive = true;
  tier: EnemyTier;
  hp: number;
  state: EnemyState = 'formation-entering';
  formationX: number;
  formationY: number;
  entryProgress = 0;
  entryStartX: number;
  entryStartY: number;
  diveT = 0;
  diveStartX = 0;
  diveStartY = 0;
  fireCooldown = 1 + Math.random() * 2;
  index: number;
  sprite: HTMLImageElement;

  constructor(
    tier: EnemyTier,
    index: number,
    formationX: number, formationY: number,
    entryStartX: number, entryStartY: number,
    sprite: HTMLImageElement,
  ) {
    this.tier = tier;
    this.index = index;
    this.formationX = formationX;
    this.formationY = formationY;
    this.entryStartX = entryStartX;
    this.entryStartY = entryStartY;
    this.x = entryStartX;
    this.y = entryStartY;
    this.hp = ENEMY_STATS[tier].hp;
    this.sprite = sprite;
    // Titan is visually larger to feel like a threat
    if (tier === 'titan') {
      this.w = 40;
      this.h = 40;
    } else {
      this.w = 28;
      this.h = 28;
    }
  }

  update(dt: number, t: number, playerX: number, fireCallback: (bullets: Bullet[]) => void) {
    const speedMult = ENEMY_STATS[this.tier].speed_mult;

    if (this.state === 'formation-entering') {
      this.entryProgress += dt * 0.5 * speedMult;
      if (this.entryProgress >= 1) {
        this.entryProgress = 1;
        this.state = 'formation';
        this.x = this.formationX;
        this.y = this.formationY;
      } else {
        const p = this.entryProgress;
        const mx = this.entryStartX < PLAYFIELD_W / 2 ? PLAYFIELD_W * 0.8 : PLAYFIELD_W * 0.2;
        const my = PLAYFIELD_H * 0.4;
        const oneP = 1 - p;
        this.x = oneP * oneP * this.entryStartX + 2 * oneP * p * mx + p * p * this.formationX;
        this.y = oneP * oneP * this.entryStartY + 2 * oneP * p * my + p * p * this.formationY;
      }
    } else if (this.state === 'formation') {
      const phase = t + this.index * 0.3;
      this.x = this.formationX + Math.sin(phase * 1.5) * 24;

      // Snipers fire from formation
      if (ENEMY_STATS[this.tier].can_fire) {
        this.fireCooldown -= dt;
        if (this.fireCooldown <= 0) {
          // Sniper fires straight down at player's x
          if (this.tier === 'sniper') {
            fireCallback([new Bullet(this.x, this.y + 14, false, 0, ENEMY_BULLET_SPEED, '#ff4444')]);
          } else if (this.tier === 'bomber') {
            // 3-spread shot
            fireCallback([
              new Bullet(this.x, this.y + 14, false, -60, ENEMY_BULLET_SPEED * 0.8, '#ff8800'),
              new Bullet(this.x, this.y + 14, false,   0, ENEMY_BULLET_SPEED * 0.8, '#ff8800'),
              new Bullet(this.x, this.y + 14, false,  60, ENEMY_BULLET_SPEED * 0.8, '#ff8800'),
            ]);
          } else if (this.tier === 'titan') {
            // Twin parallel shots — fast, white-on-black mech aesthetic
            fireCallback([
              new Bullet(this.x - 10, this.y + 18, false, 0, ENEMY_BULLET_SPEED * 1.2, '#ffffff'),
              new Bullet(this.x + 10, this.y + 18, false, 0, ENEMY_BULLET_SPEED * 1.2, '#ffffff'),
            ]);
          }
          // Titan fires faster than other tiers
          const cooldownBase = this.tier === 'titan' ? 1.2 : 2.5;
          const cooldownRange = this.tier === 'titan' ? 1.5 : 3;
          this.fireCooldown = cooldownBase + Math.random() * cooldownRange;
        }
      }
    } else if (this.state === 'diving') {
      this.diveT += dt * 0.8 * speedMult;
      // Loop back if went off-screen
      if (this.y > PLAYFIELD_H + 30) {
        this.state = 'formation-entering';
        this.entryProgress = 0;
        this.entryStartX = Math.random() < 0.5 ? -30 : PLAYFIELD_W + 30;
        this.entryStartY = -30;
        this.diveT = 0;
        return;
      }
      const t01 = this.diveT;
      const targetX = this.tier === 'runner' ? playerX : this.formationX;
      const xCurve = Math.sin(t01 * Math.PI * 1.5) * (this.tier === 'runner' ? 40 : 80);
      this.x = this.diveStartX + (targetX - this.diveStartX) * t01 + xCurve;
      this.y = this.diveStartY + 200 * 2 * t01 * speedMult;
    }
  }

  startDive() {
    if (this.state !== 'formation') return;
    this.state = 'diving';
    this.diveT = 0;
    this.diveStartX = this.x;
    this.diveStartY = this.y;
  }

  takeDamage(dmg: number): boolean {
    this.hp -= dmg;
    if (this.hp <= 0) {
      this.alive = false;
      return true;
    }
    return false;
  }

  render(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.drawImage(this.sprite, -this.w / 2, -this.h / 2, this.w, this.h);
    ctx.restore();
  }

  /** Score reward when killed in current state (dive vs formation) */
  getScoreReward(): number {
    const base = ENEMY_STATS[this.tier].score;
    if (this.state === 'diving') return base;
    return Math.floor(base * ENEMY_STATS[this.tier].dive_score_bonus);
  }

  getDropChance(): number {
    return ENEMY_STATS[this.tier].drop_chance;
  }
}

// ============================================================
// Boss
// ============================================================

class Boss implements Entity {
  x: number;
  y: number;
  w = 80;
  h = 80;
  alive = true;
  hp: number;
  maxHp: number;
  name: string;
  pattern: BossDescriptor['pattern'];
  sprite: HTMLImageElement;
  color: string;
  // Movement
  moveT = 0;
  // Firing
  fireCooldown = 1.0;
  spiralAngle = 0;
  // Taunts
  taunts: string[];
  voiceId: BossVoiceId;
  /** State machine: idle → fading-in → holding → fading-out → idle */
  tauntPhase: 'idle' | 'fading-in' | 'holding' | 'fading-out' = 'idle';
  /** Seconds left in current phase */
  tauntTimer = 0;
  /** Current phrase being shown (only valid when not idle) */
  currentTaunt = '';
  /** Index of the current taunt within the boss's taunts array — used to fetch matching voice clip */
  currentTauntIdx = 0;
  /** Time until next taunt fires (when idle) */
  tauntCooldown = 0;

  constructor(desc: BossDescriptor, sprite: HTMLImageElement) {
    this.x = PLAYFIELD_W / 2;
    this.y = 100;
    this.hp = desc.hp;
    this.maxHp = desc.hp;
    this.name = desc.name;
    this.pattern = desc.pattern;
    this.sprite = sprite;
    this.color = desc.color;
    this.taunts = desc.taunts;
    this.voiceId = desc.voiceId;
    // First taunt comes ~2 sec after boss appears (so the wave-intro overlay clears first)
    this.tauntCooldown = 2.0;
  }

  update(dt: number, t: number, playerX: number, fireCallback: (bullets: Bullet[]) => void) {
    this.moveT += dt;
    this.tickTaunt(dt);
    // Horizontal swaying
    this.x = PLAYFIELD_W / 2 + Math.sin(this.moveT * 0.7) * (PLAYFIELD_W * 0.3);
    // Slight vertical bob
    this.y = 100 + Math.sin(this.moveT * 0.4) * 20;

    this.fireCooldown -= dt;
    if (this.fireCooldown <= 0) {
      const bullets: Bullet[] = [];
      switch (this.pattern) {
        case 'spiral': {
          // Damager: rotating spiral spread
          for (let i = 0; i < 5; i++) {
            const angle = this.spiralAngle + (i * Math.PI * 2 / 5);
            bullets.push(new Bullet(
              this.x, this.y + 30, false,
              Math.cos(angle) * 200,
              Math.sin(angle) * 200 + 80,
              '#ff1ad9',
            ));
          }
          this.spiralAngle += 0.4;
          this.fireCooldown = 0.5;
          break;
        }
        case 'sweep': {
          // Doomed Red: wide horizontal sweep
          for (let i = -3; i <= 3; i++) {
            bullets.push(new Bullet(
              this.x + i * 18, this.y + 30, false,
              i * 40,
              ENEMY_BULLET_SPEED,
              '#ff3355',
            ));
          }
          this.fireCooldown = 1.2;
          break;
        }
        case 'rain': {
          // Rage: random rain from above
          for (let i = 0; i < 4; i++) {
            bullets.push(new Bullet(
              this.x + (Math.random() - 0.5) * 200,
              this.y + 30, false,
              (Math.random() - 0.5) * 80,
              ENEMY_BULLET_SPEED + Math.random() * 80,
              '#ff0000',
            ));
          }
          this.fireCooldown = 0.4;
          break;
        }
        case 'beam': {
          // Special Op: aimed beam at player + 2 flankers
          const dx = playerX - this.x;
          const dy = (PLAYFIELD_H - 60) - this.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const nx = dx / dist;
          const ny = dy / dist;
          const speed = 320;
          for (let i = -1; i <= 1; i++) {
            bullets.push(new Bullet(
              this.x, this.y + 30, false,
              nx * speed + i * 50,
              ny * speed,
              '#3a55ff',
            ));
          }
          this.fireCooldown = 0.8;
          break;
        }
        case 'rage': {
          // Beast: alternating spirals + occasional spread
          for (let i = 0; i < 6; i++) {
            const angle = this.spiralAngle + (i * Math.PI * 2 / 6);
            bullets.push(new Bullet(
              this.x, this.y + 30, false,
              Math.cos(angle) * 220,
              Math.sin(angle) * 220 + 60,
              '#00d5cc',
            ));
          }
          this.spiralAngle += 0.5;
          this.fireCooldown = 0.4;
          break;
        }
        case 'mixed': {
          // Max Pain: rotates through patterns
          const subPattern = Math.floor(this.moveT * 0.5) % 3;
          if (subPattern === 0) {
            for (let i = 0; i < 7; i++) {
              const a = this.spiralAngle + (i * Math.PI * 2 / 7);
              bullets.push(new Bullet(this.x, this.y + 30, false, Math.cos(a) * 240, Math.sin(a) * 240 + 80, '#ff1ad9'));
            }
            this.spiralAngle += 0.3;
          } else if (subPattern === 1) {
            for (let i = -4; i <= 4; i++) {
              bullets.push(new Bullet(this.x + i * 14, this.y + 30, false, i * 30, ENEMY_BULLET_SPEED * 1.2, '#00ffd0'));
            }
          } else {
            const dx = playerX - this.x;
            const dy = (PLAYFIELD_H - 60) - this.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            for (let i = -2; i <= 2; i++) {
              bullets.push(new Bullet(this.x, this.y + 30, false, (dx / dist) * 360 + i * 40, (dy / dist) * 360, '#ffe000'));
            }
          }
          this.fireCooldown = 0.4;
          break;
        }
        case 'transcend': {
          // MintFace: cycles through 4 phases — the artist's signature
          // Each phase = different "brushstroke" pattern, yellow-themed
          const phase = Math.floor(this.moveT * 0.4) % 4;
          if (phase === 0) {
            // "Halo ring" — 12-spoke spiral expanding outward
            for (let i = 0; i < 12; i++) {
              const a = this.spiralAngle + (i * Math.PI * 2 / 12);
              bullets.push(new Bullet(this.x, this.y, false, Math.cos(a) * 200, Math.sin(a) * 200, '#ffe000'));
            }
            this.spiralAngle += 0.2;
          } else if (phase === 1) {
            // "Brushstroke" — fast horizontal sweep, painterly
            for (let i = -5; i <= 5; i++) {
              bullets.push(new Bullet(this.x + i * 16, this.y + 30, false, i * 25, ENEMY_BULLET_SPEED * 1.3, '#ff5533'));
            }
          } else if (phase === 2) {
            // "Pink eye" — aimed burst at player, pink (his eye color)
            const dx = playerX - this.x;
            const dy = (PLAYFIELD_H - 60) - this.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            for (let i = -3; i <= 3; i++) {
              bullets.push(new Bullet(this.x, this.y + 30, false, (dx / dist) * 380 + i * 35, (dy / dist) * 380, '#ff66cc'));
            }
          } else {
            // "Blue eye" — straight column rain
            for (let i = -3; i <= 3; i++) {
              bullets.push(new Bullet(this.x + i * 22, this.y + 30, false, 0, ENEMY_BULLET_SPEED * 1.1, '#3a99ff'));
            }
          }
          this.fireCooldown = 0.35;
          break;
        }
      }
      fireCallback(bullets);
    }
  }

  takeDamage(dmg: number): boolean {
    this.hp -= dmg;
    if (this.hp <= 0) {
      this.alive = false;
      return true;
    }
    return false;
  }

  /**
   * Taunt state machine. Idle → cooldown ticks down → fire phrase → fade in
   * (0.3s) → hold (3s) → fade out (0.5s) → idle. Next cooldown is random
   * 4–8 sec so taunts don't feel mechanical.
   */
  private tickTaunt(dt: number) {
    if (this.taunts.length === 0) return;
    this.tauntTimer -= dt;
    if (this.tauntTimer > 0) return;

    switch (this.tauntPhase) {
      case 'idle': {
        this.tauntCooldown -= dt;
        if (this.tauntCooldown <= 0) {
          this.currentTauntIdx = Math.floor(Math.random() * this.taunts.length);
          this.currentTaunt = this.taunts[this.currentTauntIdx];
          this.tauntPhase = 'fading-in';
          this.tauntTimer = 0.3;
          // Fire the matching voice clip — silently no-ops if no recording exists yet
          void getAudio().playBossTaunt(this.voiceId, this.currentTauntIdx);
        }
        break;
      }
      case 'fading-in':
        this.tauntPhase = 'holding';
        this.tauntTimer = 3.0;
        break;
      case 'holding':
        this.tauntPhase = 'fading-out';
        this.tauntTimer = 0.5;
        break;
      case 'fading-out':
        this.tauntPhase = 'idle';
        this.tauntCooldown = 4 + Math.random() * 4;   // 4–8 sec between taunts
        this.currentTaunt = '';
        break;
    }
  }

  /** Returns 0..1 opacity for the current taunt bubble, or 0 if idle */
  private getTauntAlpha(): number {
    switch (this.tauntPhase) {
      case 'idle':        return 0;
      case 'fading-in':   return 1 - (this.tauntTimer / 0.3);
      case 'holding':     return 1;
      case 'fading-out':  return this.tauntTimer / 0.5;
    }
  }

  render(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.translate(this.x, this.y);
    // Subtle scale pulse when low HP
    const lowHp = this.hp / this.maxHp < 0.3;
    const scale = lowHp ? 1 + Math.sin(this.moveT * 8) * 0.05 : 1;
    ctx.scale(scale, scale);

    // MintFace gets a rotating yellow halo aura behind him — the signature
    if (this.name === 'MINTFACE') {
      ctx.save();
      ctx.rotate(this.moveT * 0.6);
      ctx.strokeStyle = '#ffe000';
      ctx.shadowColor = '#ffe000';
      ctx.shadowBlur = 18;
      ctx.lineWidth = 4;
      // Three concentric arcs offset, giving a brushstroke vibe
      for (let i = 0; i < 3; i++) {
        ctx.globalAlpha = 0.7 - i * 0.15;
        ctx.beginPath();
        const r = this.w * (0.7 + i * 0.12);
        const offset = i * 0.3;
        ctx.arc(0, 0, r, offset, offset + Math.PI * 1.7);
        ctx.stroke();
      }
      ctx.restore();
    }

    ctx.shadowColor = this.color;
    ctx.shadowBlur = lowHp ? 24 : 12;
    ctx.drawImage(this.sprite, -this.w / 2, -this.h / 2, this.w, this.h);
    ctx.restore();

    // Taunt bubble — rendered AFTER sprite so it overlays
    this.renderTaunt(ctx);
  }

  private renderTaunt(ctx: CanvasRenderingContext2D) {
    const alpha = this.getTauntAlpha();
    if (alpha <= 0 || !this.currentTaunt) return;

    ctx.save();
    ctx.globalAlpha = alpha;

    // Measure text to size the bubble
    ctx.font = 'bold 10px "Press Start 2P", monospace';
    const textW = ctx.measureText(this.currentTaunt).width;
    const padX = 10;
    const padY = 7;
    const bubbleW = textW + padX * 2;
    const bubbleH = 22;
    // Position above boss head with a small gap
    const bubbleY = this.y - this.h / 2 - bubbleH - 14;
    const bubbleX = this.x - bubbleW / 2;

    // Bubble background (translucent dark with colored border)
    ctx.fillStyle = 'rgba(10, 4, 30, 0.92)';
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 2;
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 8;
    ctx.fillRect(bubbleX, bubbleY, bubbleW, bubbleH);
    ctx.strokeRect(bubbleX, bubbleY, bubbleW, bubbleH);

    // Triangle tail pointing down toward boss
    ctx.beginPath();
    ctx.moveTo(this.x - 5, bubbleY + bubbleH);
    ctx.lineTo(this.x + 5, bubbleY + bubbleH);
    ctx.lineTo(this.x, bubbleY + bubbleH + 7);
    ctx.closePath();
    ctx.fillStyle = 'rgba(10, 4, 30, 0.92)';
    ctx.shadowBlur = 0;
    ctx.fill();
    ctx.strokeStyle = this.color;
    ctx.stroke();

    // Text
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 4;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.currentTaunt, this.x, bubbleY + bubbleH / 2);

    ctx.restore();
  }
}

// ============================================================
// PowerUp drop
// ============================================================

class PowerUpDrop implements Entity {
  x: number;
  y: number;
  w = 24;
  h = 24;
  alive = true;
  type: PowerUpType;
  sprite: HTMLImageElement;
  spawnT = 0;

  constructor(x: number, y: number, type: PowerUpType, sprite: HTMLImageElement) {
    this.x = x;
    this.y = y;
    this.type = type;
    this.sprite = sprite;
  }

  update(dt: number) {
    this.y += 80 * dt;
    this.spawnT += dt;
    if (this.y > PLAYFIELD_H + 30) this.alive = false;
  }

  render(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.translate(this.x, this.y);
    const bob = Math.sin(this.spawnT * 4) * 2;
    ctx.translate(0, bob);
    ctx.shadowColor = '#00ffd0';
    ctx.shadowBlur = 10;
    ctx.drawImage(this.sprite, -this.w / 2, -this.h / 2, this.w, this.h);
    ctx.restore();
  }
}

// ============================================================
// Collectible — bonus score drops, no gameplay effect
// ============================================================

type CollectibleType = 'cherry' | 'glasses-pink' | 'glasses-purple' | 'glasses-zeros';

const COLLECTIBLE_SPRITE: Record<CollectibleType, SpriteKey> = {
  'cherry':         'collectible-cherry',
  'glasses-pink':   'collectible-glasses-pink',
  'glasses-purple': 'collectible-glasses-purple',
  'glasses-zeros':  'collectible-glasses-zeros',
};

const COLLECTIBLE_SCORE: Record<CollectibleType, number> = {
  'cherry':         1000,  // PixelArcade brand mark, big bonus
  'glasses-pink':   500,
  'glasses-purple': 500,
  'glasses-zeros':  750,   // the zeros (000) variant is rarer + bigger
};

class CollectibleDrop implements Entity {
  x: number;
  y: number;
  w = 28;
  h = 28;
  alive = true;
  type: CollectibleType;
  sprite: HTMLImageElement;
  spawnT = 0;

  constructor(x: number, y: number, type: CollectibleType, sprite: HTMLImageElement) {
    this.x = x;
    this.y = y;
    this.type = type;
    this.sprite = sprite;
  }

  update(dt: number) {
    this.y += 70 * dt;   // falls a bit slower than power-ups
    this.spawnT += dt;
    if (this.y > PLAYFIELD_H + 30) this.alive = false;
  }

  render(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.translate(this.x, this.y);
    const bob = Math.sin(this.spawnT * 3.5) * 3;
    const spin = Math.sin(this.spawnT * 2) * 0.1;
    ctx.translate(0, bob);
    ctx.rotate(spin);
    // Glow themed by type
    const glowColor = this.type === 'cherry' ? '#ff3344'
      : this.type === 'glasses-pink' ? '#ff66cc'
      : this.type === 'glasses-purple' ? '#9933ff'
      : '#ffffff';
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = 12;
    ctx.drawImage(this.sprite, -this.w / 2, -this.h / 2, this.w, this.h);
    ctx.restore();
  }

  getScore(): number {
    return COLLECTIBLE_SCORE[this.type];
  }
}

// ============================================================
// Particles
// ============================================================

class Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  alive = true;
  size: number;

  constructor(x: number, y: number, color: string, big = false) {
    this.x = x;
    this.y = y;
    this.vx = (Math.random() - 0.5) * (big ? 400 : 240);
    this.vy = (Math.random() - 0.5) * (big ? 400 : 240);
    this.maxLife = (big ? 0.7 : 0.4) + Math.random() * 0.3;
    this.life = this.maxLife;
    this.color = color;
    this.size = big ? 5 : 3;
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
    const s = this.size + alpha * 2;
    ctx.fillRect(this.x - s / 2, this.y - s / 2, s, s);
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
// Wave composition — per wave: how many of each enemy tier
// ============================================================

function buildWaveComposition(wave: number): { tier: EnemyTier; count: number }[] {
  // Boss waves have no formation enemies (just the boss)
  if (BOSSES[wave]) return [];

  if (wave <= 4) {
    return [{ tier: 'grunt', count: 12 + wave * 2 }];
  }
  if (wave <= 9) {
    return [
      { tier: 'grunt', count: 10 + wave },
      { tier: 'runner', count: Math.floor((wave - 4) * 2) },
    ];
  }
  if (wave <= 14) {
    return [
      { tier: 'grunt', count: 12 + Math.floor(wave / 2) },
      { tier: 'runner', count: 4 + Math.floor((wave - 9) * 1.5) },
      { tier: 'sniper', count: 2 + Math.floor((wave - 9) * 0.8) },
    ];
  }
  if (wave <= 19) {
    return [
      { tier: 'grunt', count: 14 },
      { tier: 'runner', count: 6 },
      { tier: 'sniper', count: 4 },
      { tier: 'bomber', count: Math.floor((wave - 14) * 1.2) },
      { tier: 'titan', count: 1 },   // first titan appears wave 16-19
    ];
  }
  if (wave <= 24) {
    return [
      { tier: 'grunt', count: 16 },
      { tier: 'runner', count: 7 },
      { tier: 'sniper', count: 5 },
      { tier: 'bomber', count: 3 + Math.floor((wave - 19) * 0.6) },
      { tier: 'titan', count: 1 + Math.floor((wave - 19) * 0.3) },  // 1–2 titans
    ];
  }
  // 26-29: max
  return [
    { tier: 'grunt', count: 18 },
    { tier: 'runner', count: 8 },
    { tier: 'sniper', count: 6 },
    { tier: 'bomber', count: 5 },
    { tier: 'titan', count: 2 },  // always 2 titans late game
  ];
}

// ============================================================
// Game Engine
// ============================================================

export class GameEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private callbacks: GameCallbacks;
  private assets: AssetBundle;

  // State
  private phase: GamePhase = 'pre-game';
  private wave = 0;
  private score = 0;
  private lives = STARTING_LIVES;
  private streak = 0;

  // Two-player hot-seat state
  /** 'single' = solo, 'twoPlayer' = hot-seat alternating */
  private mode: 'single' | 'twoPlayer' = 'single';
  /** Which player is currently at the controls (1 or 2). Only meaningful in 2P. */
  private currentPlayer: 1 | 2 = 1;
  /** Final score of P1's turn — captured at p1's game over */
  private p1Score = 0;
  /** Final wave reached by P1 */
  private p1Wave = 0;
  /** P2's final stats — captured at p2's game over */
  private p2Score = 0;
  private p2Wave = 0;

  // Entities
  private player!: Player;
  private bullets: Bullet[] = [];
  private enemies: Enemy[] = [];
  private boss: Boss | null = null;
  private powerUps: PowerUpDrop[] = [];
  private collectibles: CollectibleDrop[] = [];
  private particles: Particle[] = [];

  // Loop
  private rafId: number | null = null;
  private lastTime = 0;
  private running = false;
  private elapsed = 0;
  private phaseTime = 0;
  private fireCooldown = 0;
  private diveTimer = 0;

  private input: InputState = { left: false, right: false, fire: false };

  /** When true, AI controls input and player is invincible (attract mode) */
  private demoMode = false;

  constructor(canvas: HTMLCanvasElement, assets: AssetBundle, callbacks: GameCallbacks = {}) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get canvas 2D context');
    this.ctx = ctx;
    this.assets = assets;
    this.callbacks = callbacks;
    this.player = new Player(this.spriteOf('player-ship'));
  }

  private spriteOf(key: SpriteKey): HTMLImageElement {
    return this.assets.sprites.get(key)!;
  }

  /** Keyboard input (set by React on keydown/keyup) */
  setInput(input: Partial<InputState>) {
    this.input = { ...this.input, ...input };
  }

  /**
   * Gamepad input — set per frame by the React polling loop. ORed with
   * keyboard input each tick. Stored separately so a keyboard key release
   * doesn't override a held gamepad button (and vice versa).
   */
  private gamepadInput: InputState = { left: false, right: false, fire: false };

  setGamepadInput(input: Partial<InputState>) {
    this.gamepadInput = { ...this.gamepadInput, ...input };
  }

  /** Combined input view used by update logic */
  private getCombinedInput(): InputState {
    return {
      left:  this.input.left  || this.gamepadInput.left,
      right: this.input.right || this.gamepadInput.right,
      fire:  this.input.fire  || this.gamepadInput.fire,
    };
  }

  /**
   * Start a new game.
   * @param startWave Optional dev/QA wave skip
   * @param mode 'single' (default) or 'twoPlayer' (hot-seat alternating)
   */
  start(startWave?: number, mode: 'single' | 'twoPlayer' = 'single') {
    this.demoMode = false;
    this.mode = mode;
    this.currentPlayer = 1;
    this.p1Score = 0;
    this.p1Wave = 0;
    this.p2Score = 0;
    this.p2Wave = 0;
    this.reset();
    if (startWave && startWave > 1) {
      this.wave = Math.min(startWave, SECRET_FINAL_WAVE);
      this.emitStats();
      this.emitPhase();
    }
    this.running = true;
    this.lastTime = performance.now();
    this.loop();
  }

  /**
   * Hot-seat handoff: after p2-ready phase, start P2's turn. Resets the
   * playfield while preserving scoreboard state.
   */
  startNextPlayer() {
    if (this.mode !== 'twoPlayer' || this.currentPlayer !== 2) return;
    // Reset the active gameplay state but keep p1 scores
    this.score = 0;
    this.lives = STARTING_LIVES;
    this.wave = 1;
    this.streak = 0;
    this.player = new Player(this.spriteOf('player-ship'));
    this.bullets = [];
    this.enemies = [];
    this.powerUps = [];
    this.collectibles = [];
    this.particles = [];
    this.boss = null;
    this.phase = 'wave-intro';
    this.phaseTime = 0;
    this.emitStats();
    this.emitPhase();
  }

  /**
   * Start attract-mode demo. AI controls an invincible ship through a
   * mid-game wave. Caller should stop() when they want to end the demo
   * (typically after ~25 seconds or when player interacts).
   *
   * Wave is chosen for visual interest: 22 has full enemy roster including
   * titans, but no boss interrupting the action flow.
   */
  startDemo(demoWave = 22) {
    this.demoMode = true;
    this.reset();
    this.wave = Math.min(Math.max(demoWave, 1), FINAL_WAVE);
    this.emitStats();
    this.emitPhase();
    this.running = true;
    this.lastTime = performance.now();
    this.loop();
  }

  /** Whether the current loop is running an attract-mode demo */
  isDemoMode(): boolean {
    return this.demoMode;
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
    this.player = new Player(this.spriteOf('player-ship'));
    this.bullets = [];
    this.enemies = [];
    this.powerUps = [];
    this.collectibles = [];
    this.particles = [];
    this.boss = null;
    this.elapsed = 0;
    this.emitStats();
    this.emitPhase();
  }

  private loop = () => {
    if (!this.running) return;
    const now = performance.now();
    let dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;

    // Slow-mo affects enemies + bullets, not player input or rendering
    const enemySpeedScale = this.player.boosts.has('slowmo') ? SLOWMO_FACTOR : 1;

    this.elapsed += dt;
    this.phaseTime += dt;

    this.update(dt, enemySpeedScale);
    this.render();

    this.rafId = requestAnimationFrame(this.loop);
  };

  private update(dt: number, enemySpeedScale: number) {
    // In demo mode, AI generates input + player has permanent invincibility
    // (uses the 'invincible' boost rather than the invulnerable flag so the
    // player sprite doesn't blink — we want a continuous demo view).
    if (this.demoMode) {
      this.input = this.computeDemoInput();
      // Clear gamepad so a stuck button doesn't override the AI
      this.gamepadInput = { left: false, right: false, fire: false };
      this.player.boosts.set('invincible', Infinity);
    }

    // Player updates regardless of phase. Combined = keyboard OR gamepad.
    const combinedInput = this.getCombinedInput();
    this.player.update(dt, combinedInput);
    this.updatePlayerFire(dt, combinedInput);

    // Bullets/particles/powerups always tick
    for (const b of this.bullets) {
      // Slow-mo affects enemy bullets only
      const slow = !b.fromPlayer ? enemySpeedScale : 1;
      b.x += b.vx * dt * slow;
      b.y += b.vy * dt * slow;
      if (b.y < -20 || b.y > PLAYFIELD_H + 20 || b.x < -20 || b.x > PLAYFIELD_W + 20) {
        b.alive = false;
      }
    }
    this.bullets = this.bullets.filter((b) => b.alive);
    for (const p of this.particles) p.update(dt);
    this.particles = this.particles.filter((p) => p.alive);
    for (const u of this.powerUps) u.update(dt);
    this.powerUps = this.powerUps.filter((u) => u.alive);
    for (const c of this.collectibles) c.update(dt);
    this.collectibles = this.collectibles.filter((c) => c.alive);

    if (this.phase === 'wave-intro') {
      if (this.phaseTime > 1.5) {
        const isBoss = !!BOSSES[this.wave];
        if (isBoss) {
          this.spawnBoss();
        } else {
          this.spawnFormation();
          // Non-boss wave — pick chapter music for this wave (groups waves
          // 1-4, 6-9, 11-14, etc. into shared chapter tracks)
          if (!this.demoMode) void getAudio().playMusic(musicForWave(this.wave));
        }
        this.phase = 'playing';
        this.phaseTime = 0;
        this.diveTimer = 1.5;
        this.emitPhase();
      }
      return;
    }

    if (this.phase === 'playing') {
      // Enemies
      for (const e of this.enemies) {
        if (!e.alive) continue;
        // Pass slow-mo by scaling time delta on enemies only
        e.update(dt * enemySpeedScale, this.elapsed, this.player.x, (bullets) => this.bullets.push(...bullets));
      }

      // Boss
      if (this.boss?.alive) {
        this.boss.update(dt * enemySpeedScale, this.elapsed, this.player.x, (bullets) => this.bullets.push(...bullets));
      }

      // Trigger dives
      this.diveTimer -= dt;
      if (this.diveTimer <= 0) {
        const candidates = this.enemies.filter((e) => e.state === 'formation' && e.alive);
        if (candidates.length > 0) {
          const idx = Math.floor(Math.random() * candidates.length);
          candidates[idx].startDive();
        }
        // Faster dives on later waves
        const baseInterval = Math.max(0.4, 1.2 - this.wave * 0.02);
        this.diveTimer = baseInterval + Math.random() * 0.6;
      }

      // PowerUp pickups
      for (const u of this.powerUps) {
        if (!u.alive) continue;
        if (rectsOverlap(this.player, u)) {
          u.alive = false;
          this.applyPowerUp(u.type);
        }
      }

      // Collectible pickups (pure score bonus)
      for (const c of this.collectibles) {
        if (!c.alive) continue;
        if (rectsOverlap(this.player, c)) {
          c.alive = false;
          const bonus = c.getScore() * this.currentMultiplier();
          this.score += bonus;
          // Themed pop colors
          const color = c.type === 'cherry' ? '#ff3344'
            : c.type === 'glasses-zeros' ? '#ffffff'
            : c.type === 'glasses-purple' ? '#9933ff'
            : '#ff66cc';
          this.explode(c.x, c.y, color, false, true);   // silent — own pickup SFX
          if (!this.demoMode) {
            if (c.type === 'cherry') {
              getAudio().playSample('fx-cherry');         // The PixelArcade brand chime
            } else {
              getAudio().playSynth('glasses-pickup');
            }
          }
          this.emitStats();
        }
      }

      this.checkCollisions();

      // Wave clear
      const enemiesAlive = this.enemies.some((e) => e.alive);
      const bossAlive = this.boss?.alive ?? false;
      if (!enemiesAlive && !bossAlive) {
        this.score += 100 * this.wave;
        if (this.wave === SECRET_FINAL_WAVE) {
          // Beat MintFace — true ending. Persist the unlock so the /characters
          // bestiary reveals MintFace permanently for this browser.
          // Don't set this in demo mode (would falsely unlock the secret).
          if (!this.demoMode) {
            try {
              localStorage.setItem('pixelarcade_swarm_true_ending', 'true');
            } catch {
              // localStorage may be blocked; ignore
            }
          }
          this.phase = 'true-victory';
          this.phaseTime = 0;
          this.emitPhase();
          if (!this.demoMode) {
            getAudio().playSample('fx-true-victory');
            void getAudio().playMusic(null);   // silence music for the moment
          }
        } else if (this.wave === FINAL_WAVE) {
          // Beat Max Pain — secret transition into MintFace fight
          this.phase = 'mintface-incoming';
          this.phaseTime = 0;
          this.emitPhase();
          if (!this.demoMode) {
            getAudio().playSample('fx-mintface-incoming');
            void getAudio().playMusic(null);   // mute music during the WAIT moment
          }
        } else {
          this.phase = 'wave-clear';
          this.phaseTime = 0;
          this.emitPhase();
          if (!this.demoMode) getAudio().playSynth('wave-clear');
        }
        this.emitStats();
      }
      return;
    }

    if (this.phase === 'wave-clear') {
      if (this.phaseTime > 2.5) {
        this.wave += 1;
        this.phase = 'wave-intro';
        this.phaseTime = 0;
        this.emitStats();
        this.emitPhase();
      }
      return;
    }

    if (this.phase === 'mintface-incoming') {
      // 4-second dramatic pause before MintFace materializes
      if (this.phaseTime > 4.0) {
        this.wave = SECRET_FINAL_WAVE;
        this.phase = 'wave-intro';
        this.phaseTime = 0;
        this.emitStats();
        this.emitPhase();
      }
      return;
    }

    if (
      this.phase === 'victory' ||
      this.phase === 'true-victory' ||
      this.phase === 'game-over' ||
      this.phase === 'p2-ready' ||
      this.phase === 'match-over'
    ) {
      // particles continue to fade
      return;
    }
  }

  private updatePlayerFire(dt: number, input: InputState) {
    this.fireCooldown -= dt;
    if (input.fire && this.fireCooldown <= 0 && this.phase === 'playing') {
      const piercing = false; // future power-up
      this.bullets.push(new Bullet(this.player.x, this.player.y - 18, true, 0, -BULLET_SPEED, '#ffe000', piercing));
      this.fireCooldown = 1 / this.player.getFireRate();
      // Skip SFX during demo mode — would be obnoxious during attract
      if (!this.demoMode) getAudio().playSynth('player-shot');
    }
  }

  /**
   * Demo-mode AI input. Strategy:
   *  1. ALWAYS fire (auto-aim by tracking enemy columns)
   *  2. Pick a target: nearest alive enemy or boss, prefer ones already below
   *     formation (diving threats) over still-in-formation
   *  3. Move toward target's X column
   *  4. If an enemy bullet is heading near the player, dodge sideways
   *  5. Avoid edges (don't pin against walls)
   *
   * Result: looks like a competent player without being aimbot-perfect.
   * Some random hesitation makes it feel human.
   */
  private computeDemoInput(): InputState {
    let moveLeft = false;
    let moveRight = false;
    const fire = true;

    // 1. Dodge check — is there an enemy bullet within 60px horizontally and
    //    falling toward the player's y level?
    const dodgeRange = 50;
    const lookaheadY = this.player.y - 20;
    for (const b of this.bullets) {
      if (b.fromPlayer || !b.alive) continue;
      // Only consider bullets above player that could hit soon
      if (b.y > this.player.y) continue;
      if (b.y < lookaheadY - 180) continue;
      const dx = b.x - this.player.x;
      if (Math.abs(dx) < dodgeRange) {
        // Bullet is in our column. Dodge opposite direction.
        if (dx >= 0) moveLeft = true;
        else moveRight = true;
        return { left: moveLeft, right: moveRight, fire };
      }
    }

    // 2. Target selection — pick highest-priority threat
    let targetX: number | null = null;
    let bestPriority = Infinity;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      // Diving enemies are priority (lower number = higher priority)
      // Lower (closer-to-player) enemies also priority
      const priority = (e.state === 'diving' ? 0 : 100) - e.y;
      if (priority < bestPriority) {
        bestPriority = priority;
        targetX = e.x;
      }
    }
    if (this.boss?.alive) {
      // Always shoot at boss when present
      targetX = this.boss.x;
    }

    if (targetX !== null) {
      const dx = targetX - this.player.x;
      // Deadzone so we don't twitch
      if (dx > 8) moveRight = true;
      else if (dx < -8) moveLeft = true;
    }

    // 3. Avoid edge pinning
    if (this.player.x < 40) { moveLeft = false; moveRight = true; }
    if (this.player.x > PLAYFIELD_W - 40) { moveRight = false; moveLeft = true; }

    return { left: moveLeft, right: moveRight, fire };
  }

  private spawnFormation() {
    const composition = buildWaveComposition(this.wave);
    const totalCount = composition.reduce((s, c) => s + c.count, 0);
    const cols = 8;
    const rows = Math.ceil(totalCount / cols);
    const slotW = 50;
    const slotH = 38;
    const gridW = cols * slotW;
    const startX = (PLAYFIELD_W - gridW) / 2 + slotW / 2;
    const startY = 70;

    // Flatten composition into a list of tiers in order
    const tierList: EnemyTier[] = [];
    for (const c of composition) {
      // Place stronger tiers first (top rows) so they're at back
      for (let i = 0; i < c.count; i++) tierList.push(c.tier);
    }
    // Sort: snipers/bombers/titans to the top rows
    const priority: Record<EnemyTier, number> = { titan: 0, bomber: 1, sniper: 2, runner: 3, grunt: 4 };
    tierList.sort((a, b) => priority[a] - priority[b]);

    let index = 0;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (index >= tierList.length) break;
        const tier = tierList[index];
        const fx = startX + col * slotW;
        const fy = startY + row * slotH;
        const fromLeft = (row + col) % 2 === 0;
        const exStart = fromLeft ? -30 : PLAYFIELD_W + 30;
        const eyStart = -30 - index * 8;
        this.enemies.push(new Enemy(
          tier, index, fx, fy, exStart, eyStart, this.spriteOf(ENEMY_SPRITE[tier]),
        ));
        index++;
      }
    }
  }

  private spawnBoss() {
    const desc = BOSSES[this.wave];
    if (!desc) return;
    this.boss = new Boss(desc, this.spriteOf(desc.sprite));
    if (!this.demoMode) {
      getAudio().playSample('fx-boss-warning');
      // Each boss now has its own dedicated track (musicForWave picks correctly)
      void getAudio().playMusic(musicForWave(this.wave));
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
          const score = e.getScoreReward();
          const killed = e.takeDamage(1);
          if (killed) {
            this.score += score * this.currentMultiplier();
            this.streak += 1;
            this.explode(e.x, e.y, '#ff1ad9', false);
            // Drop chance — power-up
            if (Math.random() < e.getDropChance()) {
              this.spawnRandomPowerUp(e.x, e.y);
            }
            // Drop chance — collectible (separate, lower rate, no gameplay effect)
            // Titans drop more often as a reward for being hard to kill
            const collectibleChance = e.tier === 'titan' ? 0.4 : e.getDropChance() * 0.4;
            if (Math.random() < collectibleChance) {
              // Offset slightly so it doesn't overlap the power-up
              this.spawnRandomCollectible(e.x + (Math.random() - 0.5) * 20, e.y);
            }
            this.emitStats();
          }
          break;
        }
      }
      // Player bullet vs boss
      if (b.alive && this.boss?.alive && rectsOverlap(b, this.boss)) {
        b.alive = false;
        const killed = this.boss.takeDamage(1);
        this.explode(b.x, b.y, this.boss.color, false);
        if (killed) {
          // Big payout
          this.score += 5000 * this.currentMultiplier();
          this.streak += 5;
          this.explode(this.boss.x, this.boss.y, this.boss.color, true);
          this.explode(this.boss.x, this.boss.y, '#ffe000', true);
          // Bosses guarantee a power-up AND a collectible drop
          this.spawnRandomPowerUp(this.boss.x, this.boss.y + 30);
          this.spawnRandomCollectible(this.boss.x + 40, this.boss.y + 30);
          this.boss = null;
          this.emitStats();
        }
      }
    }

    // Enemy bullets vs player
    if (!this.player.isInvincible()) {
      for (const b of this.bullets) {
        if (b.fromPlayer || !b.alive) continue;
        if (rectsOverlap(this.player, b)) {
          b.alive = false;
          this.onPlayerHit();
          break;
        }
      }
    }

    // Enemies vs player (ramming)
    if (!this.player.isInvincible()) {
      for (const e of this.enemies) {
        if (!e.alive) continue;
        if (rectsOverlap(this.player, e)) {
          this.onPlayerHit();
          e.alive = false;
          this.explode(e.x, e.y, '#ff1ad9', false);
          break;
        }
      }
    }

    // Boss vs player (only if very close — bosses don't ram, but contact damage)
    if (!this.player.isInvincible() && this.boss?.alive && rectsOverlap(this.player, this.boss)) {
      this.onPlayerHit();
    }
  }

  private spawnRandomPowerUp(x: number, y: number) {
    // Weighted: rarer power-ups are less common
    const weights: { type: PowerUpType; weight: number }[] = [
      { type: 'multiplier', weight: 30 },     // most common, just bonus points
      { type: 'shield',     weight: 22 },
      { type: 'firerate',   weight: 20 },
      { type: 'slowmo',     weight: 12 },
      { type: 'life',       weight: 8 },
      { type: 'invincible', weight: 8 },
    ];
    const total = weights.reduce((s, w) => s + w.weight, 0);
    let r = Math.random() * total;
    let chosen: PowerUpType = 'multiplier';
    for (const w of weights) {
      r -= w.weight;
      if (r <= 0) { chosen = w.type; break; }
    }
    this.powerUps.push(new PowerUpDrop(x, y, chosen, this.spriteOf(POWERUP_SPRITE[chosen])));
  }

  private spawnRandomCollectible(x: number, y: number) {
    // Weighted: cherries are rarest + most valuable
    const weights: { type: CollectibleType; weight: number }[] = [
      { type: 'glasses-pink',   weight: 35 },
      { type: 'glasses-purple', weight: 35 },
      { type: 'glasses-zeros',  weight: 20 },
      { type: 'cherry',         weight: 10 },
    ];
    const total = weights.reduce((s, w) => s + w.weight, 0);
    let r = Math.random() * total;
    let chosen: CollectibleType = 'glasses-pink';
    for (const w of weights) {
      r -= w.weight;
      if (r <= 0) { chosen = w.type; break; }
    }
    this.collectibles.push(new CollectibleDrop(x, y, chosen, this.spriteOf(COLLECTIBLE_SPRITE[chosen])));
  }

  private applyPowerUp(type: PowerUpType) {
    if (type === 'life') {
      this.lives += 1;
      this.explode(this.player.x, this.player.y - 20, '#00ffd0', false, true);
    } else if (type === 'multiplier') {
      // Instant bonus + temporary multiplier
      this.score += POWERUP_SCORE * this.currentMultiplier();
      this.player.applyPowerUp(type);
    } else {
      this.player.applyPowerUp(type);
    }
    // Pickup sparkle (silent — own pickup chime below)
    this.explode(this.player.x, this.player.y - 20, '#ffe000', false, true);
    if (!this.demoMode) getAudio().playSynth('powerup-pickup');
    this.emitStats();
  }

  private currentMultiplier(): number {
    let m = 1;
    for (const t of STREAK_THRESHOLDS) {
      if (this.streak >= t.count) m = t.multiplier;
    }
    if (this.player.boosts.has('multiplier')) m *= SCORE_MULTIPLIER_BOOST;
    return m;
  }

  private onPlayerHit() {
    // Shield absorbs first hit
    if (this.player.hasShield()) {
      this.player.consumeShield();
      this.player.invulnerable = 0.5;
      this.explode(this.player.x, this.player.y, '#00ffd0', false, true);   // silent — own SFX below
      if (!this.demoMode) getAudio().playSample('fx-shield-break');
      this.emitStats();
      return;
    }
    this.lives -= 1;
    this.streak = 0;
    this.explode(this.player.x, this.player.y, '#00ffd0', true);
    this.emitStats();
    if (this.lives <= 0) {
      // Game-over wail (or P1's turn end in 2P)
      if (!this.demoMode) getAudio().playSample('fx-player-death');
      // Two-player hot-seat handoff
      if (this.mode === 'twoPlayer') {
        if (this.currentPlayer === 1) {
          // Capture P1 results, prep for P2 handoff
          this.p1Score = this.score;
          this.p1Wave = this.wave;
          this.currentPlayer = 2;
          this.phase = 'p2-ready';
          this.phaseTime = 0;
          this.emitStats();
          this.emitPhase();
          return;
        }
        // P2 just died — capture and show comparison
        this.p2Score = this.score;
        this.p2Wave = this.wave;
        this.phase = 'match-over';
        this.phaseTime = 0;
        this.emitStats();
        this.emitPhase();
        return;
      }
      // Single-player: normal game over
      this.phase = 'game-over';
      this.phaseTime = 0;
      this.emitPhase();
      if (!this.demoMode) getAudio().playSample('fx-game-over');
    } else {
      // Re-create player, preserve no boosts
      this.player = new Player(this.spriteOf('player-ship'));
      this.player.invulnerable = RESPAWN_INVULN_SEC;
    }
  }

  private explode(x: number, y: number, color: string, big: boolean, silent = false) {
    const n = big ? 28 : 14;
    for (let i = 0; i < n; i++) {
      this.particles.push(new Particle(x, y, color, big));
    }
    // Explosion SFX. Skip in demo mode (gets noisy with constant AI play).
    // The `silent` flag is for non-explosion effects (pickup sparkles, shield breaks)
    // where the caller wants particles only and will play its own sound.
    // Pitch variance keeps repeat explosions from sounding mechanical.
    if (!this.demoMode && !silent) {
      getAudio().playSample(big ? 'fx-explode-big' : 'fx-explode-small', {
        pitchVariance: big ? 0.3 : 0.5,
        volumeScale: big ? 1.0 : 0.7,
      });
    }
  }

  // ============================================================
  // Rendering
  // ============================================================

  private render() {
    const ctx = this.ctx;
    const scale = Math.min(this.canvas.width / PLAYFIELD_W, this.canvas.height / PLAYFIELD_H);
    const ox = (this.canvas.width - PLAYFIELD_W * scale) / 2;
    const oy = (this.canvas.height - PLAYFIELD_H * scale) / 2;

    ctx.save();
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);

    // Background star field
    // Chapter background (dim, behind starfield)
    this.renderChapterBackground(ctx);

    this.renderStars(ctx);

    // Entities (order matters for z)
    for (const u of this.powerUps) u.render(ctx);
    for (const c of this.collectibles) c.render(ctx);
    for (const e of this.enemies) if (e.alive) e.render(ctx);
    if (this.boss?.alive) this.boss.render(ctx);
    for (const b of this.bullets) b.render(ctx);
    for (const p of this.particles) p.render(ctx);
    if (this.player.alive && this.phase !== 'game-over') this.player.render(ctx);

    // Boss HP bar
    if (this.boss?.alive) this.renderBossHpBar(ctx);

    // Phase overlays
    if (this.phase === 'wave-intro') {
      const isBoss = !!BOSSES[this.wave];
      if (isBoss) {
        this.renderCenterText(ctx, '★ BOSS WAVE ★', BOSSES[this.wave].name, '#ff1ad9');
      } else {
        this.renderCenterText(ctx, `WAVE ${this.wave}`, '★ MFER SWARM ★', '#ffe000');
      }
    } else if (this.phase === 'wave-clear') {
      this.renderCenterText(ctx, `WAVE ${this.wave} CLEAR`, `+${100 * this.wave}`, '#00ffd0');
    } else if (this.phase === 'mintface-incoming') {
      // Dramatic wait — text builds over the 4 seconds
      const t = this.phaseTime;
      if (t < 1.0) {
        this.renderCenterText(ctx, 'WAIT…', '', '#ffe000');
      } else if (t < 2.5) {
        this.renderCenterText(ctx, 'SOMETHING ELSE', 'IS COMING', '#ffe000');
      } else {
        // Pulse the final message
        const pulse = Math.floor(t * 3) % 2 === 0;
        this.renderCenterText(ctx, '★ MINTFACE ★', pulse ? 'THE ARTIST APPROACHES' : '', '#ffe000');
      }
    } else if (this.phase === 'game-over') {
      this.renderCenterText(ctx, 'GAME OVER', `SCORE ${this.score}`, '#ff1ad9');
    } else if (this.phase === 'victory') {
      this.renderCenterText(ctx, '★ VICTORY ★', `30 WAVES CLEARED · ${this.score}`, '#ffe000');
    } else if (this.phase === 'true-victory') {
      this.renderCenterText(ctx, '★ TRUE ENDING ★', `MINTFACE DEFEATED · ${this.score}`, '#ffe000');
    }

    ctx.restore();
  }

  /**
   * Determines which chapter (1-6 / 7) the current wave belongs to and renders
   * the chapter-themed Noun head sprite as a dim, slowly-drifting background
   * behind the starfield.
   *
   * Chapter mapping:
   *   waves 1-4   → cherry (PixelArcade brand intro)
   *   waves 5-9   → cd (Damager era, system glitch)
   *   waves 10-14 → blackhole (6529 Punk era, decentralized void)
   *   waves 15-19 → pyramid (Rage era, ancient geometry)
   *   waves 20-24 → ufo (Special Op era, invasion)
   *   waves 25-30 → robot (Beast Mode / Max Pain, cold tech)
   *   wave 31     → blackhole again, but with golden tint (MintFace)
   */
  private renderChapterBackground(ctx: CanvasRenderingContext2D) {
    let key: SpriteKey;
    let tintGold = false;
    if (this.wave === 0) return;        // pre-game
    if (this.wave === SECRET_FINAL_WAVE) {
      key = 'bg-ch3';   // reuse blackhole, gold tint for MintFace
      tintGold = true;
    } else if (this.wave <= 4) key = 'bg-ch1';
    else if (this.wave <= 9) key = 'bg-ch2';
    else if (this.wave <= 14) key = 'bg-ch3';
    else if (this.wave <= 19) key = 'bg-ch4';
    else if (this.wave <= 24) key = 'bg-ch5';
    else key = 'bg-ch6';

    const img = this.assets.sprites.get(key);
    if (!img) return;

    ctx.save();
    // Position centered, large enough to fill, with subtle drift
    const drift = Math.sin(this.elapsed * 0.15) * 16;
    const size = Math.min(PLAYFIELD_W, PLAYFIELD_H) * 0.95;
    ctx.globalAlpha = 0.10;   // dim, doesn't compete with gameplay
    if (tintGold) {
      // MintFace chapter: warm yellow glow
      ctx.shadowColor = '#ffe000';
      ctx.shadowBlur = 30;
    }
    ctx.drawImage(
      img,
      (PLAYFIELD_W - size) / 2 + drift,
      (PLAYFIELD_H - size) / 2 - 30,
      size, size,
    );
    ctx.restore();
  }

  private renderStars(ctx: CanvasRenderingContext2D) {
    ctx.save();
    for (let i = 0; i < 80; i++) {
      const x = (i * 73 + 37) % PLAYFIELD_W;
      const y = ((i * 113 + 191 + this.elapsed * 30) % PLAYFIELD_H);
      const size = (i % 5) === 0 ? 2 : 1;
      ctx.fillStyle = (i % 7) === 0 ? '#ff1ad9' : '#ffffff';
      ctx.globalAlpha = 0.3 + ((i % 3) * 0.2);
      ctx.fillRect(x, y, size, size);
    }
    ctx.restore();
  }

  private renderBossHpBar(ctx: CanvasRenderingContext2D) {
    if (!this.boss) return;
    const x = 20, y = 10, w = PLAYFIELD_W - 40, h = 10;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(x, y, w, h);
    const pct = Math.max(0, this.boss.hp / this.boss.maxHp);
    ctx.fillStyle = this.boss.color;
    ctx.shadowColor = this.boss.color;
    ctx.shadowBlur = 8;
    ctx.fillRect(x, y, w * pct, h);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.strokeRect(x, y, w, h);
    // Name centered
    ctx.fillStyle = '#ffffff';
    ctx.font = '10px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.boss.name, PLAYFIELD_W / 2, y + h + 12);
    ctx.restore();
  }

  private renderCenterText(ctx: CanvasRenderingContext2D, title: string, sub: string, color: string) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.font = 'bold 28px "Press Start 2P", monospace';
    ctx.fillText(title, PLAYFIELD_W / 2, PLAYFIELD_H / 2);
    ctx.fillStyle = '#00ffd0';
    ctx.shadowColor = '#00ffd0';
    ctx.font = '11px "Press Start 2P", monospace';
    ctx.fillText(sub, PLAYFIELD_W / 2, PLAYFIELD_H / 2 + 30);
    ctx.restore();
  }

  // ============================================================
  // Public API
  // ============================================================

  getPhase(): GamePhase { return this.phase; }

  getStats(): GameStats {
    const activeBoosts: ActiveBoost[] = [];
    for (const [type, remaining] of this.player.boosts) {
      activeBoosts.push({ type, remaining });
    }
    return {
      score: this.score,
      lives: this.lives,
      wave: this.wave,
      streak: this.streak,
      multiplier: this.currentMultiplier(),
      activeBoosts,
      bossHp: this.boss
        ? { current: this.boss.hp, max: this.boss.maxHp, name: this.boss.name }
        : null,
      mode: this.mode,
      currentPlayer: this.currentPlayer,
      p1Score: this.p1Score,
      p1Wave: this.p1Wave,
      p2Score: this.p2Score,
      p2Wave: this.p2Wave,
    };
  }

  private emitStats() { this.callbacks.onStatsChange?.(this.getStats()); }
  private emitPhase() {
    this.callbacks.onPhaseChange?.(this.phase, {
      score: this.score, wave: this.wave,
      bossName: this.boss?.name,
    });
  }
}

function rectsOverlap(a: Entity, b: Entity): boolean {
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2;
}

export { PLAYFIELD_W, PLAYFIELD_H };
