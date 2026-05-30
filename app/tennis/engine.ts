/**
 * XNoun Tennis — game engine.
 *
 * Single export: startEngine(canvas, assets) returns a cleanup function.
 * Manages its own RAF loop, listeners, and state. The React component
 * just mounts/unmounts the canvas and invokes start/stop.
 *
 * Coordinate system:
 *   - 600 × 1000 logical canvas (portrait, for the gallery cabinet's
 *     vertical monitor).
 *   - P1 = BOTTOM paddle (drawn upright). P2 = TOP paddle (drawn rotated
 *     180° so its head faces into the play area).
 *   - Ball travels primarily on the Y axis. Side walls bounce; top/bottom
 *     are scoring zones.
 */

import type { Assets, LoadedCharacter } from './assets';
import { SFX, ensureAudio, playMusic, stopMusic, playVictory } from './audio';

// ============ CONFIG ====================================================
const W = 600;
const H = 1000;
const PAD_MARGIN = 26;
const BALL = 40;
const PAD_SPEED = 700;
const BALL_SPEED_0 = 380;
const BALL_SPEED_INC = 28;
const BALL_SPEED_MAX = 1000;
const WIN_SCORE = 7;
const CPU_REACTION = 0.92;
const CPU_MAX_SPEED = PAD_SPEED * 0.85;

// Each ball frame has a dedicated color in the 320ms cycle: pink-hot,
// pink-light, blue-hot, blue-light. Strobes at 80ms per frame.
const BALL_FRAME_COLORS = ['#fd016b', '#ff459a', '#0059e8', '#478ef4'];

// ============ STATE TYPES ===============================================
const enum Mode { ATTRACT, SELECT, READY, PLAYING, POINT, GAME_OVER }

interface PaddleState {
  x: number;
  score: number;
  cpu: boolean;
  spriteName: string;
  cursor: number;
  confirmed: boolean;
  order: string[];           // shuffled roster for this player's column
  ballInside: boolean;
}

interface BallState {
  x: number; y: number;
  vx: number; vy: number;
  speed: number;
}

interface AttractDemo {
  sprite: LoadedCharacter;
  x: number; y: number;
  vx: number; vy: number;
}

interface GameState {
  mode: Mode;
  modeTimer: number;
  attractBlink: number;
  hitFlash: number;
  lastLoser: number | null;
  winner: number | null;
  p1: PaddleState;
  p2: PaddleState;
  ball: BallState;
  attractDemos: AttractDemo[];
}

// ============ HELPERS ===================================================
function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
function shuffled<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ============ COLLISION =================================================
function pointInPoly(x: number, y: number, poly: number[][]): boolean {
  let inside = false;
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    if (((yi > y) !== (yj > y)) &&
        (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-9) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

interface EdgeInfo { distSq: number; nx: number; ny: number; }

function nearestEdge(x: number, y: number, poly: number[][]): EdgeInfo {
  const best: EdgeInfo = { distSq: Infinity, nx: 0, ny: 0 };
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const lenSq = dx * dx + dy * dy || 1e-9;
    let t = ((x - a[0]) * dx + (y - a[1]) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const px = a[0] + t * dx, py = a[1] + t * dy;
    const ddx = x - px, ddy = y - py;
    const distSq = ddx * ddx + ddy * ddy;
    if (distSq < best.distSq) {
      const elen = Math.sqrt(lenSq);
      let nx = dy / elen, ny = -dx / elen;
      const testX = px + nx * 1, testY = py + ny * 1;
      if (pointInPoly(testX, testY, poly)) { nx = -nx; ny = -ny; }
      best.distSq = distSq; best.nx = nx; best.ny = ny;
    }
  }
  return best;
}

// ============ ENGINE ====================================================
export function startEngine(canvas: HTMLCanvasElement, assets: Assets): () => void {
  const ctx = canvas.getContext('2d')!;
  const roster = assets.roster;
  const charNames = roster.characters.map(c => c.name);

  // ============ State ===============================================
  const state: GameState = {
    mode: Mode.ATTRACT,
    modeTimer: 0,
    attractBlink: 0,
    hitFlash: 0,
    lastLoser: null,
    winner: null,
    p1: {
      x: W / 2, score: 0, cpu: false,
      spriteName: charNames[0],
      cursor: 0, confirmed: false,
      order: charNames.slice(),
      ballInside: false,
    },
    p2: {
      x: W / 2, score: 0, cpu: true,
      spriteName: charNames[0],
      cursor: 0, confirmed: false,
      order: charNames.slice(),
      ballInside: false,
    },
    ball: { x: W / 2, y: H / 2, vx: 0, vy: 0, speed: BALL_SPEED_0 },
    attractDemos: [],
  };

  // Per-frame display layout
  let canvasScale = 1;

  // ============ Input ===============================================
  const keys = new Set<string>();
  const justPressed = new Set<string>();

  const onKeyDown = (e: KeyboardEvent) => {
    if (!keys.has(e.code)) justPressed.add(e.code);
    keys.add(e.code);
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      e.preventDefault();
    }
  };
  const onKeyUp = (e: KeyboardEvent) => { keys.delete(e.code); };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  function readPaddleInput(player: 1 | 2): number {
    const p = player === 1 ? state.p1 : state.p2;
    if (p.cpu) return cpuDecide(p, player);
    let v = 0;
    if (player === 1) {
      if (keys.has('KeyA')) v -= 1;
      if (keys.has('KeyD')) v += 1;
    } else {
      if (keys.has('ArrowLeft'))  v -= 1;
      if (keys.has('ArrowRight')) v += 1;
    }
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && pads[player - 1];
    if (gp) {
      const sx = gp.axes[0] || 0;
      if (Math.abs(sx) > 0.18) v += Math.sign(sx);
      if (gp.buttons[14]?.pressed) v -= 1;
      if (gp.buttons[15]?.pressed) v += 1;
      v = Math.max(-1, Math.min(1, v));
    }
    return v;
  }

  function cpuDecide(paddle: PaddleState, player: 1 | 2): number {
    const b = state.ball;
    const isBottom = player === 1;
    const heading = isBottom ? b.vy > 0 : b.vy < 0;
    if (!heading) {
      const dx = (W / 2) - paddle.x;
      if (Math.abs(dx) < 8) return 0;
      return dx > 0 ? 0.35 : -0.35;
    }
    const sprite = assets.characters[paddle.spriteName];
    const targetY = isBottom ? H - PAD_MARGIN - sprite.drawH : PAD_MARGIN + sprite.drawH;
    const ttHit = Math.abs((targetY - b.y) / (b.vy || 1));
    let px = b.x + b.vx * ttHit;
    while (px < 0 || px > W) {
      if (px < 0) px = -px;
      if (px > W) px = 2 * W - px;
    }
    const error = (Math.random() - 0.5) * 60 * (1 - CPU_REACTION);
    const dx = (px + error) - paddle.x;
    if (Math.abs(dx) < 6) return 0;
    return Math.max(-1, Math.min(1, dx / 40)) * (CPU_MAX_SPEED / PAD_SPEED);
  }

  // ============ Geometry helpers ====================================
  function paddleCenterY(player: 1 | 2): number {
    const s = assets.characters[player === 1 ? state.p1.spriteName : state.p2.spriteName];
    return player === 1
      ? H - PAD_MARGIN - s.drawH / 2
      : PAD_MARGIN + s.drawH / 2;
  }

  function currentBg(): HTMLImageElement | undefined {
    const c = assets.characters[state.p1.spriteName];
    return c ? assets.bgs[c.bg] : undefined;
  }

  // ============ Collision ===========================================
  function testPaddleCollision(paddle: PaddleState, player: 1 | 2) {
    const sprite = assets.characters[paddle.spriteName];
    const cx = paddle.x;
    const cy = paddleCenterY(player);
    const isTop = player === 2;
    const halfW = sprite.drawW / 2;
    const halfH = sprite.drawH / 2;
    let worldDx = state.ball.x - cx;
    let worldDy = state.ball.y - cy;
    if (isTop) { worldDx = -worldDx; worldDy = -worldDy; }
    const sx = (worldDx + halfW) / sprite.scale;
    const sy = (worldDy + halfH) / sprite.scale;

    const inside = pointInPoly(sx, sy, sprite.polygon);
    const e = nearestEdge(sx, sy, sprite.polygon);
    const distSprite = Math.sqrt(e.distSq);
    const signedDist = inside ? -distSprite : distSprite;
    const ballRadiusSprite = (BALL / 2) / sprite.scale;
    const collide = signedDist < ballRadiusSprite;

    if (collide && !paddle.ballInside) {
      let wnx = e.nx, wny = e.ny;
      if (isTop) { wnx = -wnx; wny = -wny; }
      const v = state.ball;
      const dot = v.vx * wnx + v.vy * wny;
      if (dot < 0) {
        v.vx = v.vx - 2 * dot * wnx;
        v.vy = v.vy - 2 * dot * wny;
        v.speed = Math.min(v.speed + BALL_SPEED_INC, BALL_SPEED_MAX);
        const cur = Math.hypot(v.vx, v.vy) || 1;
        v.vx = v.vx / cur * v.speed;
        v.vy = v.vy / cur * v.speed;
        const overlapSprite = ballRadiusSprite - signedDist;
        const pushWorld = (overlapSprite + 6) * sprite.scale;
        v.x += wnx * pushWorld;
        v.y += wny * pushWorld;
        state.hitFlash = 0.15;
        SFX.hitPaddle();
      }
    }
    paddle.ballInside = collide;
  }

  // ============ Game logic ==========================================
  function startMatch() {
    state.p1.score = 0; state.p2.score = 0;
    state.p1.x = W / 2; state.p2.x = W / 2;
    state.winner = null;
    state.mode = Mode.READY;
    state.modeTimer = 0;
    state.p1.ballInside = false; state.p2.ballInside = false;
    ensureAudio();
    // Per-character music — P1's pick wins, matching the bg rule.
    const trackName = assets.characters[state.p1.spriteName]?.music;
    if (trackName) playMusic(trackName);
  }

  function gotoSelect() {
    state.mode = Mode.SELECT;
    state.modeTimer = 0;
    state.p1.confirmed = false; state.p2.confirmed = false;
    state.p1.order = shuffled(charNames);
    state.p2.order = shuffled(charNames);
    state.p1.cursor = 0; state.p2.cursor = 0;
    state.p1.spriteName = state.p1.order[0];
    state.p2.spriteName = state.p2.order[0];
    ensureAudio();
  }

  function serve(towardPlayer: number | null = null) {
    state.ball.x = W / 2; state.ball.y = H / 2;
    const a = (Math.random() - 0.5) * 0.7;
    const dir = towardPlayer === 1 ? 1 : towardPlayer === 2 ? -1 :
                (Math.random() < 0.5 ? -1 : 1);
    state.ball.speed = BALL_SPEED_0;
    state.ball.vy = dir * Math.cos(a) * state.ball.speed;
    state.ball.vx = Math.sin(a) * state.ball.speed;
    state.p1.ballInside = false;
    state.p2.ballInside = false;
  }

  function pointScored(loser: number) {
    if (loser === 1) state.p2.score++; else state.p1.score++;
    SFX.score();
    state.ball.vx = 0; state.ball.vy = 0;
    state.mode = Mode.POINT;
    state.modeTimer = 0;
    state.lastLoser = loser;
  }

  function updatePlaying(dt: number) {
    const v1 = readPaddleInput(1);
    const v2 = readPaddleInput(2);
    const halfW1 = assets.characters[state.p1.spriteName].drawW / 2;
    const halfW2 = assets.characters[state.p2.spriteName].drawW / 2;
    state.p1.x = clamp(state.p1.x + v1 * PAD_SPEED * dt, halfW1, W - halfW1);
    state.p2.x = clamp(state.p2.x + v2 * PAD_SPEED * dt, halfW2, W - halfW2);

    state.ball.x += state.ball.vx * dt;
    state.ball.y += state.ball.vy * dt;

    if (state.ball.x < BALL / 2) {
      state.ball.x = BALL / 2;
      state.ball.vx = Math.abs(state.ball.vx);
      SFX.hitWall();
    }
    if (state.ball.x > W - BALL / 2) {
      state.ball.x = W - BALL / 2;
      state.ball.vx = -Math.abs(state.ball.vx);
      SFX.hitWall();
    }

    testPaddleCollision(state.p1, 1);
    testPaddleCollision(state.p2, 2);

    if (state.ball.y < -BALL) pointScored(2);
    else if (state.ball.y > H + BALL) pointScored(1);
  }

  function updateAttract(dt: number) {
    if (state.attractDemos.length === 0) {
      for (let i = 0; i < 4; i++) {
        const c = assets.characters[charNames[Math.floor(Math.random() * charNames.length)]];
        const a = Math.random() * Math.PI * 2;
        state.attractDemos.push({
          sprite: c,
          x: 100 + Math.random() * 400, y: 200 + Math.random() * 600,
          vx: Math.cos(a) * 120, vy: Math.sin(a) * 120,
        });
      }
    }
    for (const d of state.attractDemos) {
      d.x += d.vx * dt; d.y += d.vy * dt;
      const halfW = d.sprite.drawW / 2, halfH = d.sprite.drawH / 2;
      if (d.x < halfW)       { d.x = halfW;       d.vx = Math.abs(d.vx); }
      if (d.x > W - halfW)   { d.x = W - halfW;   d.vx = -Math.abs(d.vx); }
      if (d.y < halfH)       { d.y = halfH;       d.vy = Math.abs(d.vy); }
      if (d.y > H - halfH)   { d.y = H - halfH;   d.vy = -Math.abs(d.vy); }
    }
    state.attractBlink += dt;
  }

  function updateSelect(_dt: number) {
    if (justPressed.has('KeyA') || justPressed.has('KeyW')) {
      if (!state.p1.confirmed) {
        state.p1.cursor = (state.p1.cursor - 1 + charNames.length) % charNames.length;
        state.p1.spriteName = state.p1.order[state.p1.cursor];
        SFX.cursorMove();
      }
    }
    if (justPressed.has('KeyD') || justPressed.has('KeyS')) {
      if (!state.p1.confirmed) {
        state.p1.cursor = (state.p1.cursor + 1) % charNames.length;
        state.p1.spriteName = state.p1.order[state.p1.cursor];
        SFX.cursorMove();
      }
    }
    if (justPressed.has('Space') && !state.p1.confirmed) {
      state.p1.confirmed = true; SFX.confirm();
    }
    if (!state.p2.cpu) {
      if (justPressed.has('ArrowLeft') || justPressed.has('ArrowUp')) {
        if (!state.p2.confirmed) {
          state.p2.cursor = (state.p2.cursor - 1 + charNames.length) % charNames.length;
          state.p2.spriteName = state.p2.order[state.p2.cursor];
          SFX.cursorMove();
        }
      }
      if (justPressed.has('ArrowRight') || justPressed.has('ArrowDown')) {
        if (!state.p2.confirmed) {
          state.p2.cursor = (state.p2.cursor + 1) % charNames.length;
          state.p2.spriteName = state.p2.order[state.p2.cursor];
          SFX.cursorMove();
        }
      }
      if (justPressed.has('Enter') && !state.p2.confirmed) {
        state.p2.confirmed = true; SFX.confirm();
      }
    } else {
      if (!state.p2.confirmed && state.modeTimer > 0.8) {
        state.p2.cursor = Math.floor(Math.random() * charNames.length);
        state.p2.spriteName = state.p2.order[state.p2.cursor];
        state.p2.confirmed = true;
        SFX.confirm();
      }
    }
    if (state.p1.confirmed && state.p2.confirmed && state.modeTimer > 1.4) {
      startMatch();
    }
  }

  function update(dt: number) {
    state.modeTimer += dt;
    state.hitFlash = Math.max(0, state.hitFlash - dt);

    if (justPressed.has('KeyC')) {
      if (state.mode === Mode.ATTRACT || state.mode === Mode.SELECT ||
          state.mode === Mode.PLAYING) {
        state.p2.cpu = !state.p2.cpu;
        if (state.mode === Mode.SELECT && state.p2.cpu) state.p2.confirmed = false;
      }
    }
    if (justPressed.has('Escape')) {
      state.mode = Mode.ATTRACT;
      state.modeTimer = 0;
      stopMusic();
    }

    switch (state.mode) {
      case Mode.ATTRACT:
        updateAttract(dt);
        if (justPressed.has('Enter') || justPressed.has('Space')) gotoSelect();
        {
          const pads = navigator.getGamepads ? navigator.getGamepads() : [];
          for (let i = 0; i < 2; i++) {
            const gp = pads && pads[i];
            if (gp && (gp.buttons[9]?.pressed || gp.buttons[0]?.pressed)) gotoSelect();
          }
        }
        break;
      case Mode.SELECT:
        updateSelect(dt);
        break;
      case Mode.READY:
        if (state.modeTimer > 1.5) {
          serve(state.lastLoser);
          state.mode = Mode.PLAYING;
          state.modeTimer = 0;
        }
        break;
      case Mode.PLAYING:
        updatePlaying(dt);
        break;
      case Mode.POINT:
        if (state.modeTimer > 1.0) {
          if (state.p1.score >= WIN_SCORE || state.p2.score >= WIN_SCORE) {
            state.winner = state.p1.score > state.p2.score ? 1 : 2;
            state.mode = Mode.GAME_OVER;
            state.modeTimer = 0;
            playVictory();              // stinger replaces the loop track
          } else {
            state.mode = Mode.READY;
            state.modeTimer = 0;
            state.p1.ballInside = false; state.p2.ballInside = false;
          }
        }
        break;
      case Mode.GAME_OVER:
        if (justPressed.has('Enter') || justPressed.has('Space')) {
          state.attractDemos.length = 0;
          state.mode = Mode.ATTRACT;
          state.modeTimer = 0;
          stopMusic();                  // silence the cabinet between players
        }
        break;
    }
    justPressed.clear();
  }

  // ============ Render ==============================================
  function fitCanvas() {
    const parent = canvas.parentElement;
    if (!parent) return;
    const cw = parent.clientWidth;
    const ch = parent.clientHeight;
    const margin = 24;
    canvasScale = Math.max(0.4, Math.min((cw - margin * 2) / W, (ch - margin * 2) / H));
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W * canvasScale}px`;
    canvas.style.height = `${H * canvasScale}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
  }

  function drawCourt() {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, W, H);
    const bg = currentBg();
    if (bg && bg.complete && bg.naturalWidth > 0) {
      ctx.drawImage(bg, 0, 0, W, H);
    }
    ctx.strokeStyle = '#1a2222';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, H - 2);
    ctx.strokeStyle = 'rgba(56, 242, 198, 0.35)';
    ctx.lineWidth = 3;
    ctx.setLineDash([14, 16]);
    ctx.beginPath();
    ctx.moveTo(24, H / 2); ctx.lineTo(W - 24, H / 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawOverlay(alpha: number) {
    ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`;
    ctx.fillRect(0, 0, W, H);
  }

  function drawSpriteRaw(sprite: LoadedCharacter, cx: number, cy: number, rotated180: boolean) {
    const sw = sprite.drawW, sh = sprite.drawH;
    ctx.save();
    ctx.translate(cx, cy);
    if (rotated180) ctx.rotate(Math.PI);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sprite.image, -sw / 2, -sh / 2, sw, sh);
    ctx.restore();
  }

  function drawPaddle(player: 1 | 2) {
    const paddle = player === 1 ? state.p1 : state.p2;
    const sprite = assets.characters[paddle.spriteName];
    drawSpriteRaw(sprite, paddle.x, paddleCenterY(player), player === 2);
  }

  // Offscreen canvas for the ball
  const ballOff = document.createElement('canvas');
  ballOff.width = ballOff.height = BALL;
  const ballOffCtx = ballOff.getContext('2d')!;

  function drawBall() {
    const phase = performance.now() % 320;
    const frameIdx = Math.floor(phase / 80);
    const color = BALL_FRAME_COLORS[frameIdx];
    const VB = roster.ballViewBox;

    ballOffCtx.clearRect(0, 0, BALL, BALL);
    ballOffCtx.save();
    ballOffCtx.scale(BALL / VB, BALL / VB);
    ballOffCtx.fillStyle = color;
    for (const p of assets.ballPaths[frameIdx]) ballOffCtx.fill(p);
    ballOffCtx.restore();

    ctx.shadowColor = state.hitFlash > 0 ? '#f4f4f0' : color;
    ctx.shadowBlur  = state.hitFlash > 0 ? 32 : 18;
    ctx.drawImage(
      ballOff,
      Math.round(state.ball.x - BALL / 2),
      Math.round(state.ball.y - BALL / 2)
    );
    ctx.shadowBlur = 0;
  }

  function drawScores() {
    ctx.font = 'bold 88px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(244, 244, 240, 0.18)';
    ctx.fillText(String(state.p2.score), W / 2, H / 2 - 80);
    ctx.fillText(String(state.p1.score), W / 2, H / 2 + 80);
    ctx.font = '11px "Press Start 2P", monospace';
    ctx.fillStyle = 'rgba(0, 212, 255, 0.55)';
    ctx.fillText(state.p2.cpu ? 'CPU' : 'P2', W / 2, H / 2 - 140);
    ctx.fillStyle = 'rgba(56, 242, 198, 0.55)';
    ctx.fillText('P1', W / 2, H / 2 + 140);
  }

  interface TitleOpts { size?: number; color?: string; glow?: number; shadow?: string; }
  function drawTitleText(text: string, y: number, opts: TitleOpts = {}) {
    const size = opts.size || 28;
    const color = opts.color || '#00d4ff';
    ctx.font = `bold ${size}px "Press Start 2P", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = color;
    ctx.shadowBlur = opts.glow || 12;
    if (opts.shadow) {
      ctx.shadowBlur = 0;
      ctx.fillStyle = opts.shadow;
      ctx.fillText(text, W / 2 + 3, y + 3);
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = opts.glow || 12;
    }
    ctx.fillStyle = color;
    ctx.fillText(text, W / 2, y);
    ctx.shadowBlur = 0;
  }

  function drawAttract() {
    drawOverlay(0.55);
    for (const d of state.attractDemos) {
      ctx.globalAlpha = 0.55;
      drawSpriteRaw(d.sprite, d.x, d.y, false);
      ctx.globalAlpha = 1;
    }
    drawTitleText('XNOUN',  H / 2 - 130, { size: 64, color: '#f4f4f0', shadow: '#38f2c6', glow: 24 });
    drawTitleText('TENNIS', H / 2 - 50,  { size: 64, color: '#f4f4f0', shadow: '#38f2c6', glow: 24 });
    drawTitleText('PIXEL ARCADE', H / 2 + 30, { size: 12, color: '#88ffd6', glow: 6 });
    if (Math.floor(state.attractBlink * 1.6) % 2 === 0) {
      drawTitleText('PRESS ENTER', H / 2 + 120, { size: 20, color: '#38f2c6', glow: 12 });
    }
    ctx.fillStyle = '#4a5a6a';
    ctx.font = '10px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('PIXEL ARCADE · THE LINE GALLERY', W / 2, H - 60);
    ctx.fillText('MINTFACE · NZ · 2026', W / 2, H - 36);
  }

  function drawSelect() {
    drawOverlay(0.7);
    drawTitleText('PICK YOUR XNOUN', 70, { size: 22, color: '#f4f4f0', glow: 14 });
    const TILE = 76;
    const GAP = 10;
    const startY = 140;
    const p1ColX = W / 4;
    const p2ColX = W * 3 / 4;

    ctx.font = '16px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#38f2c6';
    ctx.shadowColor = '#38f2c6'; ctx.shadowBlur = 10;
    ctx.fillText('P1', p1ColX, 110);
    ctx.fillStyle = '#00d4ff';
    ctx.shadowColor = '#00d4ff';
    ctx.fillText(state.p2.cpu ? 'CPU' : 'P2', p2ColX, 110);
    ctx.shadowBlur = 0;

    for (let i = 0; i < charNames.length; i++) {
      const y = startY + i * (TILE + GAP);
      for (const col of [
        { x: p1ColX, player: state.p1, color: '#38f2c6' },
        { x: p2ColX, player: state.p2, color: '#00d4ff' },
      ]) {
        const spriteName = col.player.order[i];
        const s = assets.characters[spriteName];
        if (!s) continue;
        const isSelected = col.player.cursor === i;
        const isConfirmed = col.player.confirmed && col.player.cursor === i;
        const maxDim = TILE - 8;
        const scale = Math.min(maxDim / s.width, maxDim / s.height);
        const sw = s.width * scale, sh = s.height * scale;
        if (isSelected) {
          const glowColor = isConfirmed ? '#f4f4f0' : col.color;
          ctx.shadowColor = glowColor;
          ctx.shadowBlur = isConfirmed ? 28 : 18;
          ctx.globalAlpha = 0;
          ctx.fillStyle = glowColor;
          ctx.fillRect(col.x - sw / 2, y - sh / 2, sw, sh);
          ctx.globalAlpha = 1;
          ctx.shadowBlur = 0;
          ctx.fillStyle = isConfirmed ? 'rgba(244,244,240,0.7)' :
                          (col.color === '#38f2c6' ? 'rgba(56,242,198,0.7)' : 'rgba(0,212,255,0.7)');
          ctx.fillRect(col.x - sw / 2, y + TILE / 2 - 2, sw, 2);
        } else {
          ctx.globalAlpha = 0.55;
        }
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(s.image, col.x - sw / 2, y - sh / 2, sw, sh);
        ctx.globalAlpha = 1;
        if (isConfirmed) {
          ctx.font = 'bold 14px "Press Start 2P", monospace';
          ctx.fillStyle = '#f4f4f0';
          ctx.shadowColor = '#f4f4f0'; ctx.shadowBlur = 8;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText('✓', col.x + sw / 2 + 14, y);
          ctx.shadowBlur = 0;
        }
      }
    }

    ctx.font = '10px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#38f2c6';
    ctx.fillText('P1: A/D move · SPACE confirm', W / 4, H - 56);
    ctx.fillStyle = '#00d4ff';
    ctx.fillText(state.p2.cpu ? 'CPU PICKS RANDOM' : 'P2: ←/→ move · ENTER confirm', W * 3 / 4, H - 56);
    ctx.fillStyle = '#4a5a6a';
    ctx.fillText('PRESS C TO TOGGLE CPU/P2', W / 2, H - 28);
    if (state.p1.confirmed && state.p2.confirmed) {
      drawTitleText('READY!', H - 96, { size: 20, color: '#f4f4f0', glow: 16 });
    }
  }

  function drawReady() {
    const remaining = Math.max(0, 1.5 - state.modeTimer);
    const n = Math.ceil(remaining);
    drawTitleText('GET READY', H / 2 - 40, { size: 28, color: '#00d4ff', glow: 16 });
    drawTitleText(String(n), H / 2 + 40, { size: 80, color: '#f4f4f0', shadow: '#38f2c6', glow: 24 });
  }

  function drawPoint() {
    drawTitleText('POINT', H / 2, { size: 32, color: '#88ffd6', glow: 18 });
  }

  function drawGameOver() {
    drawOverlay(0.65);
    const winner = state.winner === 1 ? 'P1 WINS' : state.p2.cpu ? 'CPU WINS' : 'P2 WINS';
    drawTitleText('GAME OVER', H / 2 - 120, { size: 28, color: '#ff4060', glow: 18 });
    drawTitleText(winner,      H / 2 - 40,  { size: 36, color: '#f4f4f0', shadow: '#38f2c6', glow: 24 });
    drawTitleText(`${state.p1.score} — ${state.p2.score}`, H / 2 + 30,
                  { size: 20, color: '#00d4ff', glow: 10 });
    const wp = state.winner === 1 ? state.p1 : state.p2;
    const ws = assets.characters[wp.spriteName];
    if (ws && ws.image.complete) {
      const scale = Math.min(220 / ws.width, 220 / ws.height);
      const sw = ws.width * scale, sh = ws.height * scale;
      ctx.shadowColor = '#f4f4f0'; ctx.shadowBlur = 30;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(ws.image, W / 2 - sw / 2, H / 2 + 130 - sh / 2, sw, sh);
      ctx.shadowBlur = 0;
    }
    if (Math.floor(state.modeTimer * 1.6) % 2 === 0) {
      drawTitleText('PRESS ENTER', H - 80, { size: 16, color: '#38f2c6', glow: 8 });
    }
  }

  function render() {
    drawCourt();
    if (state.mode === Mode.PLAYING || state.mode === Mode.READY || state.mode === Mode.POINT) {
      drawScores();
      drawPaddle(1);
      drawPaddle(2);
    }
    if (state.mode === Mode.PLAYING || state.mode === Mode.POINT) {
      drawBall();
    }
    switch (state.mode) {
      case Mode.ATTRACT:   drawAttract();  break;
      case Mode.SELECT:    drawSelect();   break;
      case Mode.READY:     drawReady();    break;
      case Mode.POINT:     drawPoint();    break;
      case Mode.GAME_OVER: drawGameOver(); break;
    }
  }

  // ============ Loop ================================================
  let lastT = 0;
  let rafId = 0;
  let alive = true;

  function loop(t: number) {
    if (!alive) return;
    const dt = lastT === 0 ? 0 : Math.min((t - lastT) / 1000, 1 / 30);
    lastT = t;
    update(dt);
    render();
    rafId = requestAnimationFrame(loop);
  }

  const onResize = () => fitCanvas();
  window.addEventListener('resize', onResize);
  fitCanvas();
  rafId = requestAnimationFrame(loop);

  // ============ Cleanup ============================================
  return () => {
    alive = false;
    cancelAnimationFrame(rafId);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('resize', onResize);
    stopMusic();
  };
}
