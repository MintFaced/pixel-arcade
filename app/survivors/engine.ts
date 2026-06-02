/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Assets } from './assets';
import { ensureAudio, SFX } from './audio';

// ============ CONFIG ====================================================
const W = 600, H = 1000;
const RUN_LENGTH = 900;             // 15 minutes

// Player
const PLAYER_SPEED_BASE = 240;
const PLAYER_RADIUS = 30;
const PLAYER_HP_MAX_BASE = 5;
const INVULN_TIME = 0.7;

// Projectile
const PROJ_SPEED_BASE = 580;
const PROJ_RADIUS = 9;
const FIRE_INTERVAL_BASE = 0.2;
const PROJ_LIFE = 1.6;

// Enemy projectile
const E_PROJ_SPEED = 220;
const E_PROJ_RADIUS = 8;
const E_PROJ_DAMAGE = 1;
const E_PROJ_LIFE = 3.5;

// Sprite render heights
const PLAYER_DRAW_H = 102;
const ENEMY_DRAW_H = 96;

// Spawn timing
const SPAWN_INTERVAL_0 = 1.4;
const SPAWN_INTERVAL_MIN = 0.22;
const SPAWN_RAMP_TIME = 240;

// XP / leveling
function xpForLevel(lvl: number) { return Math.round(5 * Math.pow(lvl, 1.55)); }

// Boss times
const BOSS_TIMES = [300, 600, 840];

// ============ TYPES =====================================================
type SkinDef = {
  hp: number; speed: number; xpDrop: number; ai: AIKind; tier: number;
  range?: number; fireRate?: number; teleRate?: number;
  lifesteal?: boolean; isElite?: boolean; isBoss?: boolean;
};
type AIKind = 'chase' | 'charger' | 'ranged' | 'phase' | 'teleport' | 'elite' | 'boss';

const SKINS: Record<string, SkinDef> = {
  light:    { hp: 1, speed: 75,  xpDrop: 1, ai: 'chase',    tier: 1 },
  mid:      { hp: 2, speed: 70,  xpDrop: 1, ai: 'chase',    tier: 1 },
  dark:     { hp: 1, speed: 110, xpDrop: 1, ai: 'chase',    tier: 2 },
  zombie:   { hp: 4, speed: 50,  xpDrop: 2, ai: 'chase',    tier: 2 },
  ape:      { hp: 5, speed: 65,  xpDrop: 3, ai: 'charger',  tier: 3 },
  skeleton: { hp: 2, speed: 60,  xpDrop: 2, ai: 'ranged',   tier: 3, range: 230, fireRate: 2.2 },
  vampire:  { hp: 1, speed: 140, xpDrop: 1, ai: 'chase',    tier: 4, lifesteal: true },
  ghost:    { hp: 2, speed: 95,  xpDrop: 2, ai: 'phase',    tier: 4 },
  alien:    { hp: 3, speed: 0,   xpDrop: 3, ai: 'teleport', tier: 5, teleRate: 3.0, fireRate: 1.5 },
  rainbow:  { hp: 20, speed: 60, xpDrop: 8, ai: 'elite',    tier: 99, isElite: true },
  robot:    { hp: 60, speed: 50, xpDrop: 20, ai: 'boss',    tier: 99, isBoss: true, fireRate: 1.8 },
};

function spawnPool(t: number): string[] {
  const pool: string[] = [];
  if (t >= 0)   pool.push('light', 'mid');
  if (t >= 60)  pool.push('dark', 'zombie');
  if (t >= 180) pool.push('ape', 'skeleton');
  if (t >= 360) pool.push('vampire', 'ghost');
  if (t >= 540) pool.push('alien');
  return pool;
}

type Upgrade = { id: string; name: string; desc: string; max: number; color: string };
const UPGRADES: Upgrade[] = [
  { id: 'multishot', name: 'MULTI-SHOT',  desc: '+1 PROJECTILE PER FIRE',    max: 4, color: '#ff5aa8' },
  { id: 'pierce',    name: 'PIERCE',      desc: 'PROJECTILES PASS +1 ENEMY', max: 3, color: '#ffd24a' },
  { id: 'fireRate',  name: 'FIRE RATE',   desc: '-15% FIRE COOLDOWN',        max: 5, color: '#5ab8ff' },
  { id: 'damage',    name: 'DAMAGE',      desc: '+1 PROJECTILE DAMAGE',      max: 5, color: '#ff6644' },
  { id: 'speed',     name: 'MOVE SPEED',  desc: '+12% MOVEMENT SPEED',       max: 4, color: '#5fc850' },
  { id: 'magnet',    name: 'MAGNET',      desc: '+50% XP PICKUP RANGE',      max: 4, color: '#c878ff' },
  { id: 'maxHp',     name: 'MAX HP',      desc: '+1 MAX HP, HEAL FULL',      max: 3, color: '#ff80c0' },
  { id: 'knockback', name: 'KNOCKBACK',   desc: 'HITS PUSH ENEMIES BACK',    max: 2, color: '#fff080' },
  { id: 'projSpeed', name: 'PROJ SPEED',  desc: '+25% PROJECTILE SPEED',     max: 3, color: '#80fff0' },
];

type Stats = {
  shots: number; pierce: number; fireInterval: number;
  damage: number; speed: number; magnetRange: number;
  maxHp: number; knockback: number; projSpeed: number;
};

type Player = {
  x: number; y: number;
  facingX: number; facingY: number;
  hp: number; fireCooldown: number;
  invuln: number; hitFlash: number;
  level: number; xp: number; xpNeeded: number;
  upgrades: Record<string, number>;
  stats: Stats;
};

function deriveStats(p: Player): Stats {
  const u = p.upgrades;
  return {
    shots:      1 + (u.multishot || 0),
    pierce:     (u.pierce || 0),
    fireInterval: FIRE_INTERVAL_BASE * Math.pow(0.85, (u.fireRate || 0)),
    damage:     1 + (u.damage || 0),
    speed:      PLAYER_SPEED_BASE * Math.pow(1.12, (u.speed || 0)),
    magnetRange: 70 * Math.pow(1.5, (u.magnet || 0)),
    maxHp:      PLAYER_HP_MAX_BASE + (u.maxHp || 0),
    knockback:  120 * (u.knockback || 0),
    projSpeed:  PROJ_SPEED_BASE * Math.pow(1.25, (u.projSpeed || 0)),
  };
}

function rollUpgradeChoices(p: Player): Upgrade[] {
  const available = UPGRADES.filter(u => (p.upgrades[u.id] || 0) < u.max);
  if (available.length === 0) return [];
  const pool = available.slice();
  const out: Upgrade[] = [];
  while (out.length < 3 && pool.length > 0) {
    const i = Math.floor(Math.random() * pool.length);
    out.push(pool[i]);
    pool.splice(i, 1);
  }
  return out;
}

type Projectile = { x: number; y: number; vx: number; vy: number; life: number; pierce: number; damage: number };
type EProjectile = { x: number; y: number; vx: number; vy: number; life: number; damage: number; kind: string };
type Enemy = {
  x: number; y: number; hp: number; maxHp: number;
  skin: string; spriteIdx: number; draw: SpriteDraw; def: SkinDef;
  speed: number; bobOffset: number; hitFlash: number;
  chargeCooldown: number; fireCooldown: number; teleportCooldown: number;
  chargeActive: number; chargeVx: number; chargeVy: number;
  knockbackVx: number; knockbackVy: number;
};
type Gem = { x: number; y: number; vx: number; vy: number; life: number; value: number; magnetized: boolean };
type Pickup = { x: number; y: number; life: number; kind: string; bob: number };
type SpriteDraw = { w: number; h: number; scale: number };

const enum Mode { TITLE = 0, PLAYING = 1, LEVEL_UP = 2, GAME_OVER = 3, WIN = 4 }

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
function lerpColor(c1: number[], c2: number[], t: number) {
  return [Math.round(lerp(c1[0], c2[0], t)), Math.round(lerp(c1[1], c2[1], t)), Math.round(lerp(c1[2], c2[2], t))];
}
function rgb(c: number[]) { return `rgb(${c[0]},${c[1]},${c[2]})`; }
function mulHex(hex: string, m: number) {
  const r = Math.round(parseInt(hex.slice(1, 3), 16) * m);
  const g = Math.round(parseInt(hex.slice(3, 5), 16) * m);
  const b = Math.round(parseInt(hex.slice(5, 7), 16) * m);
  return `rgb(${r},${g},${b})`;
}

type TOD = { sky: number[]; ocean: number[]; sand: number[]; shadow: number };
const TOD_KEYS: (TOD & { t: number })[] = [
  { t: 0.00, sky: [125, 168, 189], ocean: [74, 127, 160], sand: [232, 208, 144], shadow: 0.0 },
  { t: 0.25, sky: [255, 180, 110], ocean: [200, 110, 70],  sand: [220, 178, 130], shadow: 0.15 },
  { t: 0.45, sky: [120, 70, 110],  ocean: [70, 50, 100],   sand: [120, 95, 95],   shadow: 0.35 },
  { t: 0.70, sky: [25, 30, 60],    ocean: [20, 30, 60],    sand: [60, 55, 75],    shadow: 0.55 },
  { t: 1.00, sky: [8, 12, 32],     ocean: [10, 15, 40],    sand: [30, 30, 50],    shadow: 0.75 },
];
function todAt(t01: number): TOD {
  for (let i = 0; i < TOD_KEYS.length - 1; i++) {
    if (t01 <= TOD_KEYS[i + 1].t) {
      const a = TOD_KEYS[i], b = TOD_KEYS[i + 1];
      const f = (t01 - a.t) / (b.t - a.t);
      return { sky: lerpColor(a.sky, b.sky, f), ocean: lerpColor(a.ocean, b.ocean, f),
               sand: lerpColor(a.sand, b.sand, f), shadow: lerp(a.shadow, b.shadow, f) };
    }
  }
  const last = TOD_KEYS[TOD_KEYS.length - 1];
  return { sky: last.sky, ocean: last.ocean, sand: last.sand, shadow: last.shadow };
}

// ============ ENGINE FACTORY ============================================
export type Engine = { start: () => void; stop: () => void };

export function createEngine(opts: { canvas: HTMLCanvasElement; stage: HTMLElement; assets: Assets; onExit?: () => void }): Engine {
  const { canvas, stage, assets } = opts;
  const ctx = canvas.getContext('2d')!;

  // === Sprite scaling
  function scaledDims(w: number, h: number, targetH: number): SpriteDraw {
    const s = targetH / h;
    return { w: Math.round(w * s), h: targetH, scale: s };
  }
  const playerDraw = scaledDims(assets.playerDims[0], assets.playerDims[1], PLAYER_DRAW_H);
  const enemyDraw: Record<string, SpriteDraw[]> = {};
  for (const skin of Object.keys(assets.enemySprites)) {
    const def = SKINS[skin];
    const targetH = def?.isBoss ? ENEMY_DRAW_H * 1.8 : def?.isElite ? ENEMY_DRAW_H * 1.4 : ENEMY_DRAW_H;
    enemyDraw[skin] = assets.enemyDims[skin].map(d => scaledDims(d[0], d[1], targetH));
  }

  // === Offscreen background canvas + pre-baked glow sprites
  const bgCanvas = document.createElement('canvas');
  bgCanvas.width = W; bgCanvas.height = H;
  const bgCtx = bgCanvas.getContext('2d')!;
  let bgCachedShadow = -999;

  let projSprite!: HTMLCanvasElement;
  let gemSpriteA!: HTMLCanvasElement;
  let gemSpriteB!: HTMLCanvasElement;
  let heartFilledSprite!: HTMLCanvasElement;
  let heartEmptySprite!: HTMLCanvasElement;
  let starSprite!: HTMLCanvasElement;
  const eProjSprites: Record<string, HTMLCanvasElement> = {};

  function bakeCircleGlow(color: string, innerColor: string | null, radius: number, blur: number) {
    const size = (radius + blur) * 2 + 4;
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const c = cv.getContext('2d')!;
    c.shadowColor = color; c.shadowBlur = blur;
    c.fillStyle = color;
    c.beginPath(); c.arc(size/2, size/2, radius, 0, Math.PI * 2); c.fill();
    c.shadowBlur = 0;
    if (innerColor) {
      c.fillStyle = innerColor;
      c.beginPath(); c.arc(size/2, size/2, Math.max(1, radius - 3), 0, Math.PI * 2); c.fill();
    }
    return cv;
  }
  function bakeDiamondGem(color: string) {
    const size = 26;
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const c = cv.getContext('2d')!;
    c.shadowColor = '#ff5aa8'; c.shadowBlur = 10;
    c.fillStyle = color;
    c.beginPath();
    c.moveTo(size/2, size/2 - 7);
    c.lineTo(size/2 + 6, size/2);
    c.lineTo(size/2, size/2 + 7);
    c.lineTo(size/2 - 6, size/2);
    c.closePath(); c.fill();
    return cv;
  }
  function bakeHeart(filled: boolean) {
    const size = 28;
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const c = cv.getContext('2d')!;
    if (filled) { c.shadowColor = '#ff5aa8'; c.shadowBlur = 8; c.fillStyle = '#ff5aa8'; }
    else { c.fillStyle = 'rgba(255,90,168,0.18)'; }
    c.beginPath();
    c.arc(8, 9, 5, 0, Math.PI * 2);
    c.arc(17, 9, 5, 0, Math.PI * 2);
    c.moveTo(3, 11); c.lineTo(12, 24); c.lineTo(22, 11);
    c.closePath(); c.fill();
    return cv;
  }
  function bakeStarSprite() {
    const size = 36;
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const c = cv.getContext('2d')!;
    c.translate(size/2, size/2);
    c.fillStyle = '#ffd24a'; c.shadowColor = '#ffd24a'; c.shadowBlur = 18;
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 14 : 6;
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.closePath(); c.fill();
    return cv;
  }
  function bakeAllSprites() {
    projSprite        = bakeCircleGlow('#ff5aa8', '#ffd0e0', PROJ_RADIUS, 10);
    gemSpriteA        = bakeDiamondGem('#ff5aa8');
    gemSpriteB        = bakeDiamondGem('#ff80c0');
    heartFilledSprite = bakeHeart(true);
    heartEmptySprite  = bakeHeart(false);
    starSprite        = bakeStarSprite();
    eProjSprites.bone  = bakeCircleGlow('#e0d4b0', null, E_PROJ_RADIUS, 6);
    eProjSprites.ray   = bakeCircleGlow('#80ff60', null, E_PROJ_RADIUS, 6);
    eProjSprites.robot = bakeCircleGlow('#80c0ff', null, E_PROJ_RADIUS, 6);
  }

  // === State
  const state = {
    mode: Mode.TITLE as Mode,
    modeTimer: 0,
    attractBlink: 0,
    bossWarning: 0,
    player: {
      x: W/2, y: H/2, facingX: 0, facingY: -1,
      hp: PLAYER_HP_MAX_BASE, fireCooldown: 0,
      invuln: 0, hitFlash: 0,
      level: 1, xp: 0, xpNeeded: xpForLevel(1),
      upgrades: {} as Record<string, number>,
      stats: null as unknown as Stats,
    } as Player,
    projectiles: [] as Projectile[],
    eProjectiles: [] as EProjectile[],
    enemies: [] as Enemy[],
    gems: [] as Gem[],
    pickups: [] as Pickup[],
    spawnTimer: 0,
    runTime: 0,
    kills: 0,
    bossesKilled: 0,
    nextBossIdx: 0,
    levelUpChoices: [] as Upgrade[],
  };
  state.player.stats = deriveStats(state.player);

  // === Input
  const keys = new Set<string>();
  const justPressed = new Set<string>();
  let lastInputDebug = '';
  let inputCount = 0;

  function recordKey(e: KeyboardEvent, src: string) {
    if (!e || typeof e.code !== 'string') return;
    if (!keys.has(e.code)) justPressed.add(e.code);
    keys.add(e.code);
    lastInputDebug = `${src}: ${e.code}`;
    inputCount++;
    if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Tab'].includes(e.code)) {
      e.preventDefault();
    }
  }
  const onKeyDownWin = (e: KeyboardEvent) => recordKey(e, 'WIN');
  const onKeyDownDoc = (e: KeyboardEvent) => recordKey(e, 'DOC');
  const onKeyUp      = (e: KeyboardEvent) => { keys.delete(e.code); };

  function pointerStart() {
    if (state.mode === Mode.TITLE) {
      resetGame();
      lastInputDebug = 'POINTER START'; inputCount++;
    } else if (state.mode === Mode.GAME_OVER && state.modeTimer > 1.0) {
      resetGame();
      lastInputDebug = 'POINTER RESTART'; inputCount++;
    } else if (state.mode === Mode.WIN && state.modeTimer > 1.0) {
      state.mode = Mode.TITLE; state.modeTimer = 0;
    }
  }
  const onCanvasMouseDown = () => { try { canvas.focus(); } catch {} };
  const onBodyMouseDown   = () => { try { canvas.focus(); } catch {} };
  const onCanvasClick = () => pointerStart();
  const onBodyClick = () => pointerStart();
  const onTouchStart = (e: TouchEvent) => { e.preventDefault(); pointerStart(); };

  function readInput() {
    let dx = 0, dy = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) dy -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) dy += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) dx -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) dx += 1;

    // Gamepad: read left stick, blend with keyboard
    const pads = navigator.getGamepads?.() ?? [];
    for (const pad of pads) {
      if (!pad) continue;
      const lx = pad.axes[0] ?? 0;
      const ly = pad.axes[1] ?? 0;
      const DEAD = 0.18;
      if (Math.abs(lx) > DEAD) dx += lx;
      if (Math.abs(ly) > DEAD) dy += ly;
      // D-pad fallback
      if (pad.buttons[12]?.pressed) dy -= 1;
      if (pad.buttons[13]?.pressed) dy += 1;
      if (pad.buttons[14]?.pressed) dx -= 1;
      if (pad.buttons[15]?.pressed) dx += 1;
      break;
    }
    const m = Math.hypot(dx, dy);
    if (m > 0) { dx /= m; dy /= m; }
    return { dx, dy };
  }

  // Gamepad button edges for menus
  const padPrev: boolean[] = [];
  function readPadEdges(): { start?: boolean; choice1?: boolean; choice2?: boolean; choice3?: boolean; back?: boolean } {
    const out: any = {};
    const pads = navigator.getGamepads?.() ?? [];
    for (const pad of pads) {
      if (!pad) continue;
      const b = pad.buttons;
      // Map common buttons: A (0), B (1), X (2), Y (3), Select/Back (8), Start (9)
      const wasA = padPrev[0]; if (b[0]?.pressed && !wasA) out.choice1 = true;
      padPrev[0] = !!b[0]?.pressed;
      const wasB = padPrev[1]; if (b[1]?.pressed && !wasB) out.choice2 = true;
      padPrev[1] = !!b[1]?.pressed;
      const wasX = padPrev[2]; if (b[2]?.pressed && !wasX) out.choice3 = true;
      padPrev[2] = !!b[2]?.pressed;
      // Select/Back (8) → leave the game entirely (back to the arcade).
      const wasBack = padPrev[8]; if (b[8]?.pressed && !wasBack) out.back = true;
      padPrev[8] = !!b[8]?.pressed;
      const wasStart = padPrev[9]; if (b[9]?.pressed && !wasStart) out.start = true;
      padPrev[9] = !!b[9]?.pressed;
      break;
    }
    return out;
  }

  // === Helpers
  function pickSpawnPosition() {
    const side = Math.floor(Math.random() * 4);
    if (side === 0) return { x: Math.random() * W, y: -40 };
    if (side === 1) return { x: W + 40, y: Math.random() * H };
    if (side === 2) return { x: Math.random() * W, y: H + 40 };
    return { x: -40, y: Math.random() * H };
  }
  function spawnEnemy(skinName: string | null = null) {
    if (!skinName) {
      const pool = spawnPool(state.runTime);
      skinName = pool[Math.floor(Math.random() * pool.length)];
    }
    const def = SKINS[skinName];
    const sprites = assets.enemySprites[skinName];
    if (!sprites || !sprites.length) return;
    const spriteIdx = Math.floor(Math.random() * sprites.length);
    const pos = pickSpawnPosition();
    const sp = def.speed * (0.85 + Math.random() * 0.3);
    state.enemies.push({
      x: pos.x, y: pos.y,
      hp: def.hp, maxHp: def.hp,
      skin: skinName, spriteIdx,
      draw: enemyDraw[skinName][spriteIdx],
      def, speed: sp,
      bobOffset: Math.random() * Math.PI * 2,
      hitFlash: 0,
      chargeCooldown: 1 + Math.random() * 2,
      fireCooldown: 1 + Math.random() * 2,
      teleportCooldown: 1.5 + Math.random(),
      chargeActive: 0, chargeVx: 0, chargeVy: 0,
      knockbackVx: 0, knockbackVy: 0,
    });
  }
  function spawnRainbow() { spawnEnemy('rainbow'); }
  function spawnBoss() {
    spawnEnemy('robot');
    const b = state.enemies[state.enemies.length - 1];
    if (b) { b.x = W/2; b.y = -60; }
    SFX.bossWarn();
    state.bossWarning = 2.0;
  }

  // === AI
  const AI: Record<AIKind, (e: Enemy, dt: number) => void> = {
    chase(e, dt) {
      const dx = state.player.x - e.x;
      const dy = state.player.y - e.y;
      const m = Math.hypot(dx, dy) || 1;
      e.x += (dx / m) * e.speed * dt;
      e.y += (dy / m) * e.speed * dt;
    },
    charger(e, dt) {
      if (e.chargeActive > 0) {
        e.x += e.chargeVx * dt;
        e.y += e.chargeVy * dt;
        e.chargeActive -= dt;
      } else {
        AI.chase(e, dt);
        e.chargeCooldown -= dt;
        if (e.chargeCooldown <= 0) {
          const dx = state.player.x - e.x;
          const dy = state.player.y - e.y;
          const m = Math.hypot(dx, dy) || 1;
          const dashSpeed = e.speed * 3.5;
          e.chargeVx = (dx / m) * dashSpeed;
          e.chargeVy = (dy / m) * dashSpeed;
          e.chargeActive = 0.45;
          e.chargeCooldown = 3.0 + Math.random() * 2;
        }
      }
    },
    ranged(e, dt) {
      const dx = state.player.x - e.x;
      const dy = state.player.y - e.y;
      const dist = Math.hypot(dx, dy) || 1;
      const range = e.def.range!;
      if (dist > range) {
        e.x += (dx / dist) * e.speed * dt;
        e.y += (dy / dist) * e.speed * dt;
      } else if (dist < range * 0.6) {
        e.x -= (dx / dist) * e.speed * 0.6 * dt;
        e.y -= (dy / dist) * e.speed * 0.6 * dt;
      }
      e.fireCooldown -= dt;
      if (e.fireCooldown <= 0) {
        state.eProjectiles.push({
          x: e.x, y: e.y,
          vx: (dx / dist) * E_PROJ_SPEED,
          vy: (dy / dist) * E_PROJ_SPEED,
          life: E_PROJ_LIFE, damage: E_PROJ_DAMAGE, kind: 'bone',
        });
        e.fireCooldown = e.def.fireRate!;
      }
    },
    phase(e, dt) { AI.chase(e, dt); },
    teleport(e, dt) {
      e.teleportCooldown -= dt;
      e.fireCooldown -= dt;
      if (e.teleportCooldown <= 0) {
        const dx = state.player.x - e.x;
        const dy = state.player.y - e.y;
        const m = Math.hypot(dx, dy) || 1;
        const jump = Math.min(m - 80, 140);
        if (jump > 0) { e.x += (dx / m) * jump; e.y += (dy / m) * jump; }
        e.teleportCooldown = e.def.teleRate!;
        e.hitFlash = 0.15;
      }
      if (e.fireCooldown <= 0) {
        const dx = state.player.x - e.x;
        const dy = state.player.y - e.y;
        const m = Math.hypot(dx, dy) || 1;
        state.eProjectiles.push({
          x: e.x, y: e.y,
          vx: (dx / m) * E_PROJ_SPEED * 1.4,
          vy: (dy / m) * E_PROJ_SPEED * 1.4,
          life: E_PROJ_LIFE, damage: E_PROJ_DAMAGE, kind: 'ray',
        });
        e.fireCooldown = e.def.fireRate!;
      }
    },
    elite(e, dt) { AI.chase(e, dt); },
    boss(e, dt) {
      AI.chase(e, dt);
      e.fireCooldown -= dt;
      if (e.fireCooldown <= 0) {
        const N = 8;
        for (let i = 0; i < N; i++) {
          const a = (i / N) * Math.PI * 2 + Math.random() * 0.05;
          state.eProjectiles.push({
            x: e.x, y: e.y,
            vx: Math.cos(a) * E_PROJ_SPEED * 0.9,
            vy: Math.sin(a) * E_PROJ_SPEED * 0.9,
            life: E_PROJ_LIFE, damage: E_PROJ_DAMAGE, kind: 'robot',
          });
        }
        e.fireCooldown = e.def.fireRate!;
      }
    },
  };

  // === Gameplay actions
  function fire() {
    const p = state.player;
    const s = p.stats;
    const baseA = Math.atan2(p.facingY, p.facingX);
    const JITTER = 0.16;
    const fanHalf = Math.min(0.55, 0.13 * (s.shots - 1));
    for (let i = 0; i < s.shots; i++) {
      const fanTilt = s.shots > 1 ? (i / (s.shots - 1) - 0.5) * 2 * fanHalf : 0;
      const jitterTilt = (Math.random() - 0.5) * 2 * JITTER;
      const a = baseA + fanTilt + jitterTilt;
      state.projectiles.push({
        x: p.x, y: p.y,
        vx: Math.cos(a) * s.projSpeed,
        vy: Math.sin(a) * s.projSpeed,
        life: PROJ_LIFE, pierce: s.pierce, damage: s.damage,
      });
    }
    SFX.fire();
  }
  function damagePlayer(amount: number) {
    if (state.player.invuln > 0) return;
    state.player.hp -= amount;
    state.player.invuln = INVULN_TIME;
    state.player.hitFlash = 0.2;
    SFX.playerHit();
    if (state.player.hp <= 0) {
      state.player.hp = 0;
      state.mode = Mode.GAME_OVER; state.modeTimer = 0;
    }
  }
  function killEnemy(e: Enemy) {
    state.kills++;
    SFX.kill();
    const xpValue = e.def.xpDrop;
    const numGems = Math.min(xpValue, 4);
    const xpPerGem = Math.ceil(xpValue / numGems);
    for (let i = 0; i < numGems; i++) {
      state.gems.push({
        x: e.x + (Math.random() - 0.5) * 20,
        y: e.y + (Math.random() - 0.5) * 20,
        vx: (Math.random() - 0.5) * 60,
        vy: -60 - Math.random() * 40,
        life: 12, value: xpPerGem, magnetized: false,
      });
    }
    if (e.def.isBoss || e.def.isElite) {
      state.pickups.push({ x: e.x, y: e.y, life: 30, kind: 'upgrade', bob: 0 });
    }
    if (e.def.isBoss) { state.bossesKilled++; SFX.bossDie(); }
  }
  function addXp(amt: number) {
    const p = state.player;
    p.xp += amt; SFX.xpGet();
    while (p.xp >= p.xpNeeded) {
      p.xp -= p.xpNeeded;
      p.level++;
      p.xpNeeded = xpForLevel(p.level);
      state.levelUpChoices = rollUpgradeChoices(p);
      if (state.levelUpChoices.length > 0) {
        state.mode = Mode.LEVEL_UP; state.modeTimer = 0;
        SFX.levelUp();
        break;
      }
    }
  }
  function applyUpgrade(id: string) {
    const p = state.player;
    p.upgrades[id] = (p.upgrades[id] || 0) + 1;
    if (id === 'maxHp') {
      p.stats = deriveStats(p);
      p.hp = p.stats.maxHp;
    } else {
      p.stats = deriveStats(p);
    }
    SFX.upgrade();
    state.mode = Mode.PLAYING; state.modeTimer = 0;
  }
  function resetGame() {
    const p = state.player;
    p.x = W/2; p.y = H/2;
    p.facingX = 0; p.facingY = -1;
    p.upgrades = {};
    p.stats = deriveStats(p);
    p.hp = p.stats.maxHp;
    p.fireCooldown = 0;
    p.invuln = 0; p.hitFlash = 0;
    p.level = 1; p.xp = 0; p.xpNeeded = xpForLevel(1);
    state.projectiles.length = 0;
    state.eProjectiles.length = 0;
    state.enemies.length = 0;
    state.gems.length = 0;
    state.pickups.length = 0;
    state.spawnTimer = 0;
    state.runTime = 0;
    state.kills = 0;
    state.bossesKilled = 0;
    state.nextBossIdx = 0;
    state.bossWarning = 0;
    state.mode = Mode.PLAYING; state.modeTimer = 0;
    ensureAudio();
  }

  // === Update loop
  function updatePlaying(dt: number) {
    state.runTime += dt;
    state.bossWarning = Math.max(0, state.bossWarning - dt);
    state.spawnTimer -= dt;
    const rampT = clamp(state.runTime / SPAWN_RAMP_TIME, 0, 1);
    const interval = SPAWN_INTERVAL_0 * (1 - rampT) + SPAWN_INTERVAL_MIN * rampT;
    if (state.spawnTimer <= 0) {
      spawnEnemy();
      state.spawnTimer = interval * (0.6 + Math.random() * 0.8);
    }
    if (state.runTime > 240 && Math.random() < dt / 60) spawnRainbow();
    if (state.nextBossIdx < BOSS_TIMES.length && state.runTime >= BOSS_TIMES[state.nextBossIdx]) {
      spawnBoss(); state.nextBossIdx++;
    }
    if (state.runTime >= RUN_LENGTH) {
      state.mode = Mode.WIN; state.modeTimer = 0; return;
    }
    const { dx, dy } = readInput();
    if (dx !== 0 || dy !== 0) { state.player.facingX = dx; state.player.facingY = dy; }
    const moveSp = state.player.stats.speed;
    state.player.x = clamp(state.player.x + dx * moveSp * dt, PLAYER_RADIUS, W - PLAYER_RADIUS);
    state.player.y = clamp(state.player.y + dy * moveSp * dt, PLAYER_RADIUS, H - PLAYER_RADIUS);
    state.player.invuln = Math.max(0, state.player.invuln - dt);
    state.player.hitFlash = Math.max(0, state.player.hitFlash - dt);
    state.player.fireCooldown -= dt;
    if (state.player.fireCooldown <= 0) {
      fire();
      state.player.fireCooldown = state.player.stats.fireInterval;
    }
    for (let i = state.projectiles.length - 1; i >= 0; i--) {
      const p = state.projectiles[i];
      p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
      if (p.life <= 0 || p.x < -40 || p.x > W + 40 || p.y < -40 || p.y > H + 40) state.projectiles.splice(i, 1);
    }
    for (const e of state.enemies) {
      AI[e.def.ai](e, dt);
      if (e.knockbackVx || e.knockbackVy) {
        e.x += e.knockbackVx * dt;
        e.y += e.knockbackVy * dt;
        e.knockbackVx *= 0.85; e.knockbackVy *= 0.85;
        if (Math.abs(e.knockbackVx) < 5 && Math.abs(e.knockbackVy) < 5) {
          e.knockbackVx = 0; e.knockbackVy = 0;
        }
      }
      e.bobOffset += dt * 5;
      e.hitFlash = Math.max(0, e.hitFlash - dt);
    }
    for (let i = state.eProjectiles.length - 1; i >= 0; i--) {
      const p = state.eProjectiles[i];
      p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
      const d = Math.hypot(p.x - state.player.x, p.y - state.player.y);
      if (d < PLAYER_RADIUS + E_PROJ_RADIUS) {
        damagePlayer(p.damage); state.eProjectiles.splice(i, 1); continue;
      }
      if (p.life <= 0 || p.x < -40 || p.x > W + 40 || p.y < -40 || p.y > H + 40) state.eProjectiles.splice(i, 1);
    }
    for (let i = state.enemies.length - 1; i >= 0; i--) {
      const e = state.enemies[i];
      const rad = e.def.isBoss ? 75 : e.def.isElite ? 50 : 34;
      for (let j = state.projectiles.length - 1; j >= 0; j--) {
        const p = state.projectiles[j];
        const d = Math.hypot(e.x - p.x, e.y - p.y);
        if (d < rad + PROJ_RADIUS) {
          e.hp -= p.damage;
          e.hitFlash = 0.15;
          if (state.player.stats.knockback > 0) {
            const m = Math.hypot(p.vx, p.vy) || 1;
            e.knockbackVx += (p.vx / m) * state.player.stats.knockback;
            e.knockbackVy += (p.vy / m) * state.player.stats.knockback;
          }
          if (p.pierce > 0) { p.pierce--; } else { state.projectiles.splice(j, 1); }
          if (e.hp <= 0) {
            killEnemy(e); state.enemies.splice(i, 1); break;
          }
        }
      }
    }
    for (const e of state.enemies) {
      if (e.chargeActive > 0 && Math.abs(e.x - state.player.x) > W + 50) continue;
      const rad = e.def.isBoss ? 75 : e.def.isElite ? 50 : 34;
      const d = Math.hypot(e.x - state.player.x, e.y - state.player.y);
      if (d < rad + PLAYER_RADIUS - 6) {
        damagePlayer(1);
        if (e.def.lifesteal) e.hp = Math.min(e.hp + 1, e.maxHp + 2);
      }
    }
    for (let i = state.gems.length - 1; i >= 0; i--) {
      const g = state.gems[i];
      g.life -= dt;
      g.vy += 140 * dt;
      g.x += g.vx * dt; g.y += g.vy * dt;
      g.vx *= 0.94;
      if (g.vy > 0 && g.y > H - 8) { g.y = H - 8; g.vy *= -0.25; g.vx *= 0.6; }
      const d = Math.hypot(g.x - state.player.x, g.y - state.player.y);
      if (d < state.player.stats.magnetRange) g.magnetized = true;
      if (g.magnetized) {
        const dx = state.player.x - g.x, dy = state.player.y - g.y;
        const m = Math.hypot(dx, dy) || 1;
        g.vx = (dx / m) * 480;
        g.vy = (dy / m) * 480;
      }
      if (d < PLAYER_RADIUS + 6) { addXp(g.value); state.gems.splice(i, 1); }
      else if (g.life <= 0) state.gems.splice(i, 1);
    }
    for (let i = state.pickups.length - 1; i >= 0; i--) {
      const u = state.pickups[i];
      u.life -= dt; u.bob += dt * 3;
      const d = Math.hypot(u.x - state.player.x, u.y - state.player.y);
      if (d < PLAYER_RADIUS + 14) {
        const choices = rollUpgradeChoices(state.player);
        if (choices.length > 0) {
          state.levelUpChoices = choices;
          state.mode = Mode.LEVEL_UP; state.modeTimer = 0;
          SFX.levelUp();
        }
        state.pickups.splice(i, 1); break;
      }
      if (u.life <= 0) state.pickups.splice(i, 1);
    }
  }

  function update(dt: number) {
    state.modeTimer += dt;
    state.attractBlink += dt;
    const padEdges = readPadEdges();

    // Global "back to arcade" — Select/Back (button 8) or keyboard Escape, from
    // ANY screen. Leaves the game entirely via the onExit callback (the React
    // layer performs the actual navigation). Handled before the per-mode switch
    // so the older Escape→internal-TITLE branches below don't also fire.
    if (padEdges.back || justPressed.has('Escape')) {
      justPressed.clear();
      if (opts.onExit) opts.onExit();
      return;
    }

    switch (state.mode) {
      case Mode.TITLE:
        if (justPressed.size > 0 || padEdges.start || padEdges.choice1) resetGame();
        break;
      case Mode.PLAYING:
        updatePlaying(dt);
        if (padEdges.start) { state.mode = Mode.TITLE; state.modeTimer = 0; }
        break;
      case Mode.LEVEL_UP:
        if ((justPressed.has('Digit1') || padEdges.choice1) && state.levelUpChoices[0])
          applyUpgrade(state.levelUpChoices[0].id);
        else if ((justPressed.has('Digit2') || padEdges.choice2) && state.levelUpChoices[1])
          applyUpgrade(state.levelUpChoices[1].id);
        else if ((justPressed.has('Digit3') || padEdges.choice3) && state.levelUpChoices[2])
          applyUpgrade(state.levelUpChoices[2].id);
        break;
      case Mode.GAME_OVER:
        if (state.modeTimer > 1.0 && (justPressed.has('KeyR') || padEdges.choice1)) resetGame();
        else if (state.modeTimer > 1.0 &&
                 (justPressed.has('Enter') || justPressed.has('Space') || padEdges.start)) {
          state.mode = Mode.TITLE; state.modeTimer = 0;
        }
        break;
      case Mode.WIN:
        if (state.modeTimer > 1.0 &&
            (justPressed.has('Enter') || justPressed.has('Space') ||
             justPressed.has('KeyR') || padEdges.start || padEdges.choice1)) {
          state.mode = Mode.TITLE; state.modeTimer = 0;
        }
        break;
    }
    justPressed.clear();
  }

  // === Rendering (delegated to a sub-module would be cleaner but inlined for ship)
  let displayScale = 1;
  function fitCanvas() {
    const sw = stage.clientWidth, sh = stage.clientHeight;
    const margin = 24;
    displayScale = Math.max(0.4, Math.min((sw - margin*2)/W, (sh - margin*2)/H));
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = (W * displayScale) + 'px';
    canvas.style.height = (H * displayScale) + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
  }

  function drawIsland() {
    const t01 = clamp(state.runTime / RUN_LENGTH, 0, 1);
    const tod = todAt(t01);
    if (Math.abs(tod.shadow - bgCachedShadow) > 0.025) {
      bakeIslandToCache(tod);
      bgCachedShadow = tod.shadow;
    }
    ctx.drawImage(bgCanvas, 0, 0);
    drawBoat(tod);
    ctx.strokeStyle = `rgba(255,255,255,${0.4 - tod.shadow * 0.3})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const wt = state.runTime * 0.8;
    for (let x = 0; x < W; x += 8) {
      const y = H * 0.3 + Math.sin(x * 0.04 + wt) * 1.5;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    if (tod.shadow > 0.5) {
      const dim = (tod.shadow - 0.5) / 0.25;
      const grad = ctx.createRadialGradient(state.player.x, state.player.y, 80, state.player.x, state.player.y, 380);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, `rgba(0,0,0,${dim * 0.6})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
    }
  }
  function bakeIslandToCache(tod: TOD) {
    const c = bgCtx;
    c.clearRect(0, 0, W, H);
    const skyDim = [Math.round(tod.sky[0] * 0.55), Math.round(tod.sky[1] * 0.55), Math.round(tod.sky[2] * 0.6)];
    const skyGrad = c.createLinearGradient(0, 0, 0, H * 0.3);
    skyGrad.addColorStop(0, rgb(skyDim)); skyGrad.addColorStop(1, rgb(tod.sky));
    c.fillStyle = skyGrad; c.fillRect(0, 0, W, H * 0.3);
    if (tod.shadow > 0.4) {
      const sa = clamp((tod.shadow - 0.4) / 0.35, 0, 1) * 0.85;
      c.fillStyle = `rgba(255,255,240,${sa})`;
      for (let i = 0; i < 40; i++) {
        const sx = (i * 137) % W;
        const sy = (i * 73) % (H * 0.28);
        c.fillRect(sx, sy, 1, 2);
      }
    }
    c.fillStyle = rgb(tod.ocean);
    c.fillRect(0, H * 0.3, W, H * 0.05);
    const sandDark = [Math.round(tod.sand[0] * 0.7), Math.round(tod.sand[1] * 0.7), Math.round(tod.sand[2] * 0.7)];
    const sandGrad = c.createLinearGradient(0, H * 0.32, 0, H);
    sandGrad.addColorStop(0, rgb(tod.sand)); sandGrad.addColorStop(1, rgb(sandDark));
    c.fillStyle = sandGrad; c.fillRect(0, H * 0.32, W, H * 0.68);
    c.fillStyle = `rgba(120,90,40,${0.25 - tod.shadow * 0.18})`;
    for (let i = 0; i < 60; i++) {
      const px = (i * 53) % W;
      const py = H * 0.32 + ((i * 91) % (H * 0.68));
      c.fillRect(px, py, 1, 1);
    }
    const dim = 1 - tod.shadow * 0.6;
    drawPalmCached(c, 60, H * 0.38, 1.2, dim);
    drawPalmCached(c, W - 70, H * 0.34, 1.0, dim);
    drawPalmCached(c, 40, H - 60, 1.3, dim);
    drawPalmCached(c, W - 50, H - 50, 1.2, dim);
    drawPalmCached(c, W * 0.65, H - 30, 0.8, dim);
  }
  function drawPalmCached(c: CanvasRenderingContext2D, x: number, baseY: number, scale: number, dim: number) {
    const trunkH = 110 * scale;
    const trunkBaseW = 11 * scale;
    const trunkTopW = 7 * scale;
    c.fillStyle = mulHex('#6b4423', dim);
    c.beginPath();
    c.moveTo(x - trunkBaseW/2, baseY);
    c.lineTo(x + trunkBaseW/2, baseY);
    c.lineTo(x + trunkTopW/2, baseY - trunkH);
    c.lineTo(x - trunkTopW/2, baseY - trunkH);
    c.closePath(); c.fill();
    c.fillStyle = mulHex('#3a1f10', dim);
    for (let i = 0; i < 8; i++) {
      const ry = baseY - (i + 1) * (trunkH / 9);
      const rw = trunkBaseW - (i * (trunkBaseW - trunkTopW) / 8);
      c.fillRect(x - rw/2, ry, rw, 1.5);
    }
    const topX = x, topY = baseY - trunkH;
    c.fillStyle = mulHex('#4a2e15', dim);
    c.beginPath(); c.arc(topX, topY, 7 * scale, 0, Math.PI * 2); c.fill();
    for (const [dx, dy] of [[-6, 3], [5, 2], [-2, 6], [3, 5], [-4, 5]] as [number, number][]) {
      c.fillStyle = mulHex('#5a3018', dim);
      c.beginPath(); c.arc(topX + dx * scale, topY + dy * scale, 2.8 * scale, 0, Math.PI * 2); c.fill();
      c.fillStyle = mulHex('#8a5028', dim);
      c.beginPath(); c.arc(topX + dx * scale - 0.8 * scale, topY + dy * scale - 0.8 * scale, 0.9 * scale, 0, Math.PI * 2); c.fill();
    }
    const numFronds = 8;
    const frondDark = mulHex('#1a4a20', dim);
    const frondMid  = mulHex('#2e7a2e', dim);
    const frondLight= mulHex('#5fb850', dim);
    const frondLeaf = mulHex('#3a8a3a', dim);
    for (let i = 0; i < numFronds; i++) {
      const t = i / (numFronds - 1);
      const baseAngle = -Math.PI * 0.85 + t * Math.PI * 0.95;
      const droopDepth = 0.35 + 0.25 * Math.sin(t * Math.PI);
      const frondLen = (60 + 8 * Math.sin(i * 1.7)) * scale;
      drawFrondTo(c, topX, topY, baseAngle, frondLen, scale, droopDepth, frondDark, frondMid, frondLight, frondLeaf);
    }
  }
  function drawFrondTo(c: CanvasRenderingContext2D, originX: number, originY: number, angle: number, len: number, scale: number, droop: number, dark: string, mid: string, light: string, leaf: string) {
    c.save();
    c.translate(originX, originY);
    c.rotate(angle);
    c.fillStyle = dark;
    c.beginPath();
    c.moveTo(0, -5 * scale);
    c.quadraticCurveTo(len * 0.4, -10 * scale, len * 0.9, droop * len * 0.35 - 2 * scale);
    c.quadraticCurveTo(len, droop * len * 0.4, len * 0.92, droop * len * 0.4 + 2 * scale);
    c.quadraticCurveTo(len * 0.4, droop * len * 0.4 + 8 * scale, 0, 5 * scale);
    c.closePath(); c.fill();
    c.fillStyle = mid;
    c.beginPath();
    c.moveTo(0, -3 * scale);
    c.quadraticCurveTo(len * 0.4, -7 * scale, len * 0.85, droop * len * 0.32);
    c.quadraticCurveTo(len * 0.5, droop * len * 0.3 - 2 * scale, 0, 1 * scale);
    c.closePath(); c.fill();
    c.strokeStyle = light; c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(2 * scale, 0);
    c.quadraticCurveTo(len * 0.5, droop * len * 0.2, len * 0.93, droop * len * 0.4);
    c.stroke();
    c.strokeStyle = leaf; c.lineWidth = 1;
    for (let i = 1; i <= 4; i++) {
      const u = i / 5;
      const rx = len * u;
      const ry = droop * len * u * u * 0.5;
      const ll = (8 - u * 4) * scale;
      c.beginPath();
      c.moveTo(rx, ry); c.lineTo(rx - 1 * scale, ry - ll);
      c.moveTo(rx, ry); c.lineTo(rx - 1 * scale, ry + ll * 0.8);
      c.stroke();
    }
    c.restore();
  }
  function drawBoat(tod: TOD) {
    const t = state.runTime * 0.012;
    const cycle = (Math.sin(t) + 1) / 2;
    const bx = 40 + cycle * (W - 100);
    const by = H * 0.22;
    const bob = Math.sin(state.runTime * 1.4) * 1.5;
    const dim = 1 - tod.shadow * 0.4;
    ctx.fillStyle = `rgba(42, 24, 16, ${dim})`;
    ctx.beginPath();
    ctx.moveTo(bx - 18, by + bob);
    ctx.lineTo(bx + 18, by + bob);
    ctx.lineTo(bx + 14, by + 6 + bob);
    ctx.lineTo(bx - 14, by + 6 + bob);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = `rgba(212, 72, 72, ${dim})`;
    ctx.fillRect(bx - 16, by + 2 + bob, 32, 1);
    ctx.fillStyle = `rgba(42, 24, 16, ${dim})`;
    ctx.fillRect(bx - 1, by - 22 + bob, 2, 22);
    ctx.fillStyle = `rgba(244, 244, 240, ${dim})`;
    ctx.beginPath(); ctx.moveTo(bx, by - 22 + bob); ctx.lineTo(bx + 12, by - 4 + bob); ctx.lineTo(bx, by - 4 + bob); ctx.closePath(); ctx.fill();
    ctx.fillStyle = `rgba(255, 212, 168, ${dim})`;
    ctx.beginPath(); ctx.moveTo(bx, by - 22 + bob); ctx.lineTo(bx - 10, by - 4 + bob); ctx.lineTo(bx, by - 4 + bob); ctx.closePath(); ctx.fill();
    ctx.fillStyle = `rgba(255, 90, 168, ${dim})`;
    ctx.fillRect(bx, by - 25 + bob, 4, 3);
    ctx.fillStyle = `rgba(255,255,255,${0.55 * dim})`;
    for (let i = 1; i <= 3; i++) {
      const wx = bx + (cycle < 0.5 ? -20 - i * 8 : 20 + i * 8);
      ctx.fillRect(wx, by + 7 + bob, 4, 1);
    }
  }
  function drawSprite(img: HTMLImageElement, x: number, y: number, draw: SpriteDraw, flipX = false, alpha = 1, hitFlash = 0) {
    if (!img || !img.complete) return;
    if (alpha < 1) ctx.globalAlpha = alpha;
    if (flipX) {
      ctx.save(); ctx.translate(x, y); ctx.scale(-1, 1);
      ctx.drawImage(img, -draw.w/2, -draw.h/2, draw.w, draw.h);
      ctx.restore();
    } else {
      ctx.drawImage(img, Math.round(x - draw.w/2), Math.round(y - draw.h/2), draw.w, draw.h);
    }
    if (hitFlash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${Math.min(0.55, hitFlash * 3)})`;
      ctx.fillRect(Math.round(x - draw.w/2), Math.round(y - draw.h/2), draw.w, draw.h);
    }
    ctx.globalAlpha = 1;
  }
  function drawPlayer() {
    const p = state.player;
    const moving = (keys.has('KeyW') || keys.has('KeyA') || keys.has('KeyS') || keys.has('KeyD') ||
                    keys.has('ArrowUp') || keys.has('ArrowDown') || keys.has('ArrowLeft') || keys.has('ArrowRight'));
    const bob = moving ? Math.sin(state.runTime * 14) * 1.5 : 0;
    const flicker = p.invuln > 0 && Math.floor(p.invuln * 18) % 2 === 0;
    const alpha = flicker ? 0.4 : 1;
    drawSprite(assets.playerImg, p.x, p.y + bob, playerDraw, p.facingX < 0, alpha, 0);
    if (p.hitFlash > 0) {
      ctx.fillStyle = `rgba(255, 64, 96, ${p.hitFlash * 2})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, PLAYER_RADIUS + 10, 0, Math.PI * 2); ctx.fill();
    }
    const tod = todAt(clamp(state.runTime / RUN_LENGTH, 0, 1));
    if (tod.shadow > 0.5) {
      const haloA = (tod.shadow - 0.5) * 0.6;
      const grad = ctx.createRadialGradient(p.x, p.y, 20, p.x, p.y, 80);
      grad.addColorStop(0, `rgba(255, 200, 220, ${haloA})`);
      grad.addColorStop(1, 'rgba(255, 200, 220, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(p.x, p.y, 80, 0, Math.PI * 2); ctx.fill();
    }
  }
  function drawEnemy(e: Enemy) {
    const bob = Math.sin(e.bobOffset) * 2;
    const img = assets.enemySprites[e.skin][e.spriteIdx];
    const flipX = state.player.x < e.x;
    const isPhasing = e.def.ai === 'phase';
    const alpha = isPhasing ? 0.55 : 1;
    drawSprite(img, e.x, e.y + bob, e.draw, flipX, alpha, e.hitFlash);
    if (e.def.isBoss || e.def.isElite) {
      const barW = e.def.isBoss ? 60 : 40;
      const barH = 4;
      const barX = e.x - barW / 2;
      const barY = e.y + bob - e.draw.h / 2 - 10;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(barX, barY, barW, barH);
      const fillW = (e.hp / e.maxHp) * barW;
      ctx.fillStyle = e.def.isBoss ? '#ff4060' : '#ffd24a';
      ctx.fillRect(barX, barY, fillW, barH);
    }
    if (e.def.ai === 'teleport' && e.hitFlash > 0.1) {
      ctx.strokeStyle = `rgba(140, 255, 100, ${e.hitFlash * 3})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(e.x, e.y + bob, 30, 0, Math.PI * 2); ctx.stroke();
    }
  }
  function drawProjectile(p: Projectile) {
    if (!projSprite) return;
    const half = projSprite.width / 2;
    ctx.drawImage(projSprite, p.x - half, p.y - half);
  }
  function drawEnemyProj(p: EProjectile) {
    const spr = eProjSprites[p.kind] || eProjSprites.bone;
    if (!spr) return;
    const half = spr.width / 2;
    ctx.drawImage(spr, p.x - half, p.y - half);
  }
  function drawGem(g: Gem) {
    const spr = (Math.floor(state.runTime * 6) % 2 === 0) ? gemSpriteA : gemSpriteB;
    if (!spr) return;
    const half = spr.width / 2;
    ctx.drawImage(spr, g.x - half, g.y - half);
  }
  function drawPickup(u: Pickup) {
    if (!starSprite) return;
    const float = Math.sin(u.bob) * 3;
    ctx.save();
    ctx.translate(u.x, u.y + float);
    ctx.rotate(u.bob * 0.3);
    const half = starSprite.width / 2;
    ctx.drawImage(starSprite, -half, -half);
    ctx.restore();
  }
  function drawHud() {
    const p = state.player;
    for (let i = 0; i < p.stats.maxHp; i++) {
      const x = 18 + i * 24;
      const y = 14;
      const spr = (i < p.hp) ? heartFilledSprite : heartEmptySprite;
      if (spr) ctx.drawImage(spr, x, y);
    }
    ctx.font = '14px "Press Start 2P", monospace';
    ctx.textAlign = 'right';
    const min = Math.floor(state.runTime / 60);
    const sec = Math.floor(state.runTime % 60);
    ctx.fillStyle = '#000';
    ctx.fillText(`${min}:${String(sec).padStart(2, '0')}`, W - 17, 31);
    ctx.fillStyle = '#f4f4f0';
    ctx.fillText(`${min}:${String(sec).padStart(2, '0')}`, W - 18, 30);
    ctx.font = '10px "Press Start 2P", monospace';
    ctx.fillStyle = '#000';
    ctx.fillText(`LVL ${p.level}`, W - 17, 51);
    ctx.fillText(`KILLS ${state.kills}`, W - 17, 69);
    ctx.fillStyle = '#f4f4f0';
    ctx.fillText(`LVL ${p.level}`, W - 18, 50);
    ctx.fillText(`KILLS ${state.kills}`, W - 18, 68);
    const barY = 50, barH = 7;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(20, barY, W - 100, barH);
    const fillW = (p.xp / p.xpNeeded) * (W - 100);
    ctx.fillStyle = '#5fc850';
    ctx.fillRect(20, barY, fillW, barH);
    ctx.font = '8px "Press Start 2P", monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#f4f4f0';
    ctx.fillText(`XP ${p.xp}/${p.xpNeeded}`, 20, barY + 18);
    if (state.bossWarning > 0) {
      const blink = Math.floor(state.bossWarning * 6) % 2 === 0;
      if (blink) {
        ctx.font = 'bold 20px "Press Start 2P", monospace';
        ctx.fillStyle = '#ff4060'; ctx.textAlign = 'center';
        ctx.fillText('!! BOSS !!', W/2, 110);
      }
    }
  }
  function drawTitle() {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ff5aa8';
    ctx.shadowColor = '#ff5aa8'; ctx.shadowBlur = 28;
    ctx.font = 'bold 52px "Press Start 2P", monospace';
    ctx.fillText('DICKBUTT', W/2, H/2 - 160);
    ctx.fillText('SURVIVORS', W/2, H/2 - 90);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#f4f4f0';
    ctx.font = '14px "Press Start 2P", monospace';
    ctx.fillText('GOOCH ISLAND', W/2, H/2 - 20);
    ctx.fillStyle = '#806060';
    ctx.font = '10px "Press Start 2P", monospace';
    ctx.fillText('15-MIN SURVIVAL', W/2, H/2 + 5);
    if (Math.floor(state.attractBlink * 1.6) % 2 === 0) {
      ctx.fillStyle = '#ff5aa8'; ctx.shadowColor = '#ff5aa8'; ctx.shadowBlur = 12;
      ctx.font = '18px "Press Start 2P", monospace';
      ctx.fillText('CLICK OR PRESS ANY KEY', W/2, H/2 + 80);
      ctx.shadowBlur = 0;
    }
    ctx.fillStyle = '#a89090';
    ctx.font = '9px "Press Start 2P", monospace';
    ctx.fillText('11 SKIN TYPES · BOSSES · LEVEL UP', W/2, H/2 + 130);
    ctx.fillText('SURVIVE TILL DAWN', W/2, H/2 + 150);
    ctx.fillStyle = '#806060';
    ctx.fillText('PIXEL ARCADE · THE LINE GALLERY', W/2, H - 60);
    ctx.fillText('CDB IS CC0 · MINTFACE · NZ · 2026', W/2, H - 36);
  }
  function drawLevelUp() {
    ctx.fillStyle = 'rgba(0, 10, 20, 0.82)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#5fc850'; ctx.shadowColor = '#5fc850'; ctx.shadowBlur = 22;
    ctx.font = 'bold 32px "Press Start 2P", monospace';
    ctx.fillText('LEVEL UP!', W/2, 130);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#f4f4f0'; ctx.font = '12px "Press Start 2P", monospace';
    ctx.fillText(`LVL ${state.player.level}`, W/2, 175);
    ctx.fillText('PICK AN UPGRADE', W/2, 210);
    const cardW = W - 80, cardH = 130, gap = 24;
    const startY = 270;
    for (let i = 0; i < state.levelUpChoices.length; i++) {
      const up = state.levelUpChoices[i];
      const cardX = 40, cardY = startY + i * (cardH + gap);
      ctx.fillStyle = 'rgba(20, 30, 50, 0.9)';
      ctx.fillRect(cardX, cardY, cardW, cardH);
      ctx.strokeStyle = up.color; ctx.lineWidth = 3;
      ctx.shadowColor = up.color; ctx.shadowBlur = 14;
      ctx.strokeRect(cardX, cardY, cardW, cardH);
      ctx.shadowBlur = 0;
      ctx.fillStyle = up.color;
      ctx.beginPath(); ctx.arc(cardX + 30, cardY + 30, 22, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#0a0e2a';
      ctx.font = 'bold 24px "Press Start 2P", monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), cardX + 30, cardY + 30);
      ctx.fillStyle = up.color;
      ctx.font = 'bold 18px "Press Start 2P", monospace';
      ctx.textAlign = 'left';
      ctx.fillText(up.name, cardX + 72, cardY + 36);
      ctx.fillStyle = '#f4f4f0';
      ctx.font = '11px "Press Start 2P", monospace';
      ctx.fillText(up.desc, cardX + 72, cardY + 70);
      const cur = state.player.upgrades[up.id] || 0;
      ctx.fillStyle = '#a8b8c8';
      ctx.font = '10px "Press Start 2P", monospace';
      ctx.fillText(`OWNED  ${cur} / ${up.max}`, cardX + 72, cardY + 100);
    }
    ctx.fillStyle = '#a8b8c8';
    ctx.font = '10px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('PRESS 1, 2 OR 3 · OR A/B/X', W/2, H - 36);
  }
  function drawGameOver() {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ff4060'; ctx.shadowColor = '#ff4060'; ctx.shadowBlur = 22;
    ctx.font = 'bold 40px "Press Start 2P", monospace';
    ctx.fillText('GAME OVER', W/2, H/2 - 140);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#f4f4f0'; ctx.font = '14px "Press Start 2P", monospace';
    const min = Math.floor(state.runTime / 60);
    const sec = Math.floor(state.runTime % 60);
    ctx.fillText(`TIME    ${min}:${String(sec).padStart(2, '0')}`, W/2, H/2 - 60);
    ctx.fillText(`LEVEL   ${state.player.level}`, W/2, H/2 - 30);
    ctx.fillText(`KILLS   ${state.kills}`, W/2, H/2);
    ctx.fillText(`BOSSES  ${state.bossesKilled}`, W/2, H/2 + 30);
    if (Math.floor(state.modeTimer * 1.6) % 2 === 0 && state.modeTimer > 1.0) {
      ctx.fillStyle = '#ff5aa8'; ctx.shadowColor = '#ff5aa8'; ctx.shadowBlur = 10;
      ctx.font = '14px "Press Start 2P", monospace';
      ctx.fillText('R · RETRY    ESC · TITLE', W/2, H - 80);
      ctx.shadowBlur = 0;
    }
  }
  function drawWin() {
    ctx.fillStyle = 'rgba(0, 30, 60, 0.7)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffd24a'; ctx.shadowColor = '#ffd24a'; ctx.shadowBlur = 28;
    ctx.font = 'bold 38px "Press Start 2P", monospace';
    ctx.fillText('YOU SURVIVED', W/2, H/2 - 160);
    ctx.fillText('GOOCH ISLAND', W/2, H/2 - 100);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#f4f4f0'; ctx.font = '14px "Press Start 2P", monospace';
    ctx.fillText(`KILLS   ${state.kills}`, W/2, H/2 - 20);
    ctx.fillText(`LEVEL   ${state.player.level}`, W/2, H/2 + 10);
    ctx.fillText(`BOSSES  ${state.bossesKilled}`, W/2, H/2 + 40);
    if (Math.floor(state.modeTimer * 1.6) % 2 === 0 && state.modeTimer > 1.0) {
      ctx.fillStyle = '#ff5aa8'; ctx.font = '14px "Press Start 2P", monospace';
      ctx.fillText('PRESS ANY KEY', W/2, H - 80);
    }
  }
  function render() {
    drawIsland();
    if (state.mode === Mode.PLAYING || state.mode === Mode.LEVEL_UP ||
        state.mode === Mode.GAME_OVER || state.mode === Mode.WIN) {
      for (const u of state.pickups) drawPickup(u);
      for (const g of state.gems) drawGem(g);
      const drawables = [
        ...state.enemies.map(e => ({ kind: 'enemy' as const, y: e.y, e })),
        { kind: 'player' as const, y: state.player.y, e: null as Enemy | null },
      ];
      drawables.sort((a, b) => a.y - b.y);
      for (const d of drawables) {
        if (d.kind === 'enemy' && d.e) drawEnemy(d.e);
        else drawPlayer();
      }
      for (const p of state.projectiles) drawProjectile(p);
      for (const p of state.eProjectiles) drawEnemyProj(p);
      drawHud();
    }
    if (state.mode === Mode.TITLE) drawTitle();
    if (state.mode === Mode.LEVEL_UP) drawLevelUp();
    if (state.mode === Mode.GAME_OVER) drawGameOver();
    if (state.mode === Mode.WIN) drawWin();
  }

  // === Loop
  let lastT = 0;
  let raf = 0;
  let running = false;
  function loop(t: number) {
    if (!running) return;
    const dt = lastT === 0 ? 0 : Math.min((t - lastT) / 1000, 1/30);
    lastT = t;
    update(dt);
    render();
    raf = requestAnimationFrame(loop);
  }

  function start() {
    bakeAllSprites();
    fitCanvas();
    window.addEventListener('resize', fitCanvas);
    window.addEventListener('keydown', onKeyDownWin);
    document.addEventListener('keydown', onKeyDownDoc);
    window.addEventListener('keyup', onKeyUp);
    document.addEventListener('keyup', onKeyUp);
    canvas.addEventListener('mousedown', onCanvasMouseDown);
    document.body.addEventListener('mousedown', onBodyMouseDown);
    canvas.addEventListener('click', onCanvasClick);
    document.body.addEventListener('click', onBodyClick);
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    try { canvas.focus(); } catch {}
    running = true;
    raf = requestAnimationFrame(loop);
  }
  function stop() {
    running = false;
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', fitCanvas);
    window.removeEventListener('keydown', onKeyDownWin);
    document.removeEventListener('keydown', onKeyDownDoc);
    window.removeEventListener('keyup', onKeyUp);
    document.removeEventListener('keyup', onKeyUp);
    canvas.removeEventListener('mousedown', onCanvasMouseDown);
    document.body.removeEventListener('mousedown', onBodyMouseDown);
    canvas.removeEventListener('click', onCanvasClick);
    document.body.removeEventListener('click', onBodyClick);
    canvas.removeEventListener('touchstart', onTouchStart);
  }

  return { start, stop };
}
