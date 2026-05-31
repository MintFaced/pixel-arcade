'use client';
import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import styles from './page.module.css';

const W = 600, H = 1000;

// 2×2 grid geometry
const TILE_W = 280;
const TILE_H = 470;
const GAP = 20;
const COLS = 2, ROWS = 2;
const GRID_W = TILE_W * COLS + GAP * (COLS - 1);
const GRID_H = TILE_H * ROWS + GAP * (ROWS - 1);
const GRID_X0 = (W - GRID_W) / 2;
const GRID_Y0 = (H - GRID_H) / 2;

type Game = { name: string; url: string; color: string; preview: string };

const GAMES: Game[] = [
  { name: 'TENNIS',    url: '/tennis',    color: '#38f2c6', preview: '/game/previews/tennis.png' },
  { name: 'SWARM',     url: '/play',      color: '#ff5aa8', preview: '/game/previews/swarm.png' },
  { name: 'SURVIVORS', url: '/survivors', color: '#5fc850', preview: '/game/previews/survivors.png' },
  { name: 'TX6900',    url: '/tx6900',    color: '#5bf2a0', preview: '/game/previews/tx6900.png' },
];

export default function GameLobby() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef  = useRef<HTMLDivElement | null>(null);
  const router = useRouter();

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage  = stageRef.current;
    if (!canvas || !stage) return;
    const ctx = canvas.getContext('2d')!;

    const imgs: Record<string, HTMLImageElement> = {};
    let loaded = 0;
    let allLoaded = false;
    for (const g of GAMES) {
      const im = new Image();
      im.onload = () => { loaded++; if (loaded === GAMES.length) allLoaded = true; };
      im.src = g.preview;
      imgs[g.preview] = im;
    }

    const state = { selected: 0, t: 0, launching: null as Game | null, launchT: 0 };

    const keys = new Set<string>();
    const pressed = new Set<string>();
    function onKey(e: KeyboardEvent) {
      if (!keys.has(e.code)) pressed.add(e.code);
      keys.add(e.code);
      if (['Space','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Tab'].includes(e.code)) e.preventDefault();
    }
    const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code);

    const padPrev: (boolean | number)[] = [];
    function padEdges() {
      const out = { U: false, D: false, L: false, R: false, A: false };
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const p of pads) {
        if (!p) continue;
        const lx = p.axes[0] ?? 0, ly = p.axes[1] ?? 0;
        const dx = Math.abs(lx) > 0.4 ? Math.sign(lx) : 0;
        const dy = Math.abs(ly) > 0.4 ? Math.sign(ly) : 0;
        const lastX = (padPrev[100] as number) ?? 0;
        const lastY = (padPrev[101] as number) ?? 0;
        if (dx === 1  && lastX !== 1)  out.R = true;
        if (dx === -1 && lastX !== -1) out.L = true;
        if (dy === 1  && lastY !== 1)  out.D = true;
        if (dy === -1 && lastY !== -1) out.U = true;
        padPrev[100] = dx; padPrev[101] = dy;
        const b = p.buttons;
        const checkBtn = (idx: number, key: 'U'|'D'|'L'|'R') => {
          if (b[idx]?.pressed && !padPrev[idx]) out[key] = true;
          padPrev[idx] = !!b[idx]?.pressed;
        };
        checkBtn(12, 'U'); checkBtn(13, 'D'); checkBtn(14, 'L'); checkBtn(15, 'R');
        if (b[0]?.pressed && !padPrev[0]) out.A = true;
        if (b[9]?.pressed && !padPrev[9]) out.A = true;
        padPrev[0] = !!b[0]?.pressed; padPrev[9] = !!b[9]?.pressed;
        break;
      }
      return out;
    }

    let ac: AudioContext | null = null;
    function blip(f: number, d: number, t: OscillatorType = 'square', v = 0.04) {
      try {
        if (!ac) {
          const Ctx = (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ?? window.AudioContext;
          ac = new Ctx();
        }
      } catch { return; }
      if (!ac) return;
      const o = ac.createOscillator(), g = ac.createGain(), now = ac.currentTime;
      o.type = t; o.frequency.setValueAtTime(f, now);
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(v, now + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, now + d);
      o.connect(g).connect(ac.destination);
      o.start(now); o.stop(now + d + 0.02);
    }
    const SFX = {
      move:   () => blip(440, 0.04, 'square', 0.03),
      select: () => [523, 784].forEach((f, i) => setTimeout(() => blip(f, 0.1, 'square', 0.06), i * 80)),
    };

    function move(dx: number, dy: number) {
      const c = state.selected % COLS;
      const r = Math.floor(state.selected / COLS);
      const nc = (c + dx + COLS) % COLS;
      const nr = (r + dy + ROWS) % ROWS;
      state.selected = nr * COLS + nc;
      SFX.move();
    }
    function launch() {
      const g = GAMES[state.selected];
      state.launching = g;
      state.launchT = 0;
      SFX.select();
      window.setTimeout(() => { router.push(g.url); }, 700);
    }

    function tileRect(idx: number) {
      const r = Math.floor(idx / COLS), c = idx % COLS;
      return { x: GRID_X0 + c * (TILE_W + GAP), y: GRID_Y0 + r * (TILE_H + GAP), w: TILE_W, h: TILE_H };
    }

    let displayScale = 1;
    function fit() {
      const margin = 24;
      displayScale = Math.max(0.4, Math.min((stage!.clientWidth - margin*2)/W, (stage!.clientHeight - margin*2)/H));
      const dpr = window.devicePixelRatio || 1;
      canvas!.width = W * dpr; canvas!.height = H * dpr;
      canvas!.style.width = (W * displayScale) + 'px';
      canvas!.style.height = (H * displayScale) + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
    }

    function drawBg() {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#0a0510');
      g.addColorStop(0.5, '#06030c');
      g.addColorStop(1, '#0a0510');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      const t = state.t;
      for (let i = 0; i < 60; i++) {
        const px = (i * 47) % W;
        const py = ((i * 73) + t * 6) % H;
        const tw = Math.sin(t * 1.2 + i) * 0.5 + 0.5;
        ctx.fillStyle = `rgba(255, 220, 240, ${0.10 + tw * 0.10})`;
        ctx.fillRect(px, py, 1, 1);
      }
    }

    function drawCabinet(idx: number) {
      const g = GAMES[idx];
      const rect = tileRect(idx);
      const isSel = idx === state.selected;
      const bob = isSel ? Math.sin(state.t * 2.5) * 1.5 : 0;
      const y = rect.y + bob;

      ctx.fillStyle = '#08040e';
      ctx.fillRect(rect.x, y, rect.w, rect.h);

      const im = imgs[g.preview];
      if (im && im.complete && im.naturalWidth > 0) {
        const ia = im.naturalWidth / im.naturalHeight;
        const ta = rect.w / rect.h;
        let dw, dh;
        // COVER fit: fill the tile, overflow clipped
        if (ia > ta) {
          // Image relatively wider: fit by HEIGHT, crop sides
          dh = rect.h; dw = rect.h * ia;
        } else {
          // Image relatively taller: fit by WIDTH, crop top/bottom
          dw = rect.w; dh = rect.w / ia;
        }
        const dx = rect.x + (rect.w - dw) / 2;
        const dy = y + (rect.h - dh) / 2;
        ctx.save();
        ctx.beginPath();
        ctx.rect(rect.x, y, rect.w, rect.h);
        ctx.clip();
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(im, dx, dy, dw, dh);
        ctx.restore();
      }

      if (isSel) {
        const pulse = (Math.sin(state.t * 4) + 1) / 2;
        ctx.save();
        ctx.shadowColor = g.color;
        ctx.shadowBlur = 28 + pulse * 22;
        ctx.strokeStyle = g.color;
        ctx.lineWidth = 4;
        ctx.strokeRect(rect.x - 2, y - 2, rect.w + 4, rect.h + 4);
        ctx.restore();
        ctx.save();
        ctx.strokeStyle = g.color;
        ctx.globalAlpha = 0.45 + pulse * 0.4;
        ctx.lineWidth = 2;
        ctx.strokeRect(rect.x - 7, y - 7, rect.w + 14, rect.h + 14);
        ctx.restore();
      } else {
        ctx.strokeStyle = g.color;
        ctx.globalAlpha = 0.25;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(rect.x, y, rect.w, rect.h);
        ctx.globalAlpha = 1;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.fillRect(rect.x, y, rect.w, rect.h);
      }
    }

    function drawLaunchSplash() {
      if (!state.launching) return;
      const a = Math.min(1, state.launchT * 2.5);
      ctx.fillStyle = `rgba(0, 0, 0, ${a * 0.85})`;
      ctx.fillRect(0, 0, W, H);
      const g = state.launching;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = g.color; ctx.shadowColor = g.color; ctx.shadowBlur = 30;
      ctx.font = 'bold 32px "Press Start 2P", monospace';
      ctx.fillText('LAUNCHING', W/2, H/2 - 30);
      ctx.font = 'bold 38px "Press Start 2P", monospace';
      ctx.fillText(g.name, W/2, H/2 + 25);
      ctx.shadowBlur = 0;
    }

    function render() {
      drawBg();
      if (allLoaded) for (let i = 0; i < GAMES.length; i++) drawCabinet(i);
      drawLaunchSplash();
    }

    function update(dt: number) {
      state.t += dt;
      if (state.launching) { state.launchT += dt; pressed.clear(); return; }
      const pe = padEdges();
      if      (pressed.has('ArrowLeft')  || pressed.has('KeyA') || pe.L) move(-1, 0);
      else if (pressed.has('ArrowRight') || pressed.has('KeyD') || pe.R) move(+1, 0);
      else if (pressed.has('ArrowUp')    || pressed.has('KeyW') || pe.U) move(0, -1);
      else if (pressed.has('ArrowDown')  || pressed.has('KeyS') || pe.D) move(0, +1);
      else if (pressed.has('Enter') || pressed.has('Space') || pe.A) launch();
      pressed.clear();
    }

    let lastT = 0;
    let raf = 0;
    let running = true;
    function loop(t: number) {
      if (!running) return;
      const dt = lastT === 0 ? 0 : Math.min((t - lastT) / 1000, 1/30);
      lastT = t;
      update(dt);
      render();
      raf = requestAnimationFrame(loop);
    }

    fit();
    window.addEventListener('resize', fit);
    window.addEventListener('keydown', onKey);
    document.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    document.addEventListener('keyup', onKeyUp);
    const onCanvasMouseDown = () => { try { canvas!.focus(); } catch {} };
    canvas.addEventListener('mousedown', onCanvasMouseDown);
    document.body.addEventListener('mousedown', onCanvasMouseDown);
    const onCanvasClick = (e: MouseEvent) => {
      const rect = canvas!.getBoundingClientRect();
      const cx = (e.clientX - rect.left) * (W / rect.width);
      const cy = (e.clientY - rect.top) * (H / rect.height);
      for (let i = 0; i < GAMES.length; i++) {
        const r = tileRect(i);
        if (cx >= r.x && cx < r.x + r.w && cy >= r.y && cy < r.y + r.h) {
          if (i === state.selected) launch();
          else { state.selected = i; SFX.move(); }
          return;
        }
      }
    };
    canvas.addEventListener('click', onCanvasClick);
    try { canvas.focus(); } catch {}

    raf = requestAnimationFrame(loop);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', fit);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('keyup', onKeyUp);
      canvas.removeEventListener('mousedown', onCanvasMouseDown);
      document.body.removeEventListener('mousedown', onCanvasMouseDown);
      canvas.removeEventListener('click', onCanvasClick);
    };
  }, [router]);

  return (
    <div ref={stageRef} className={styles.stage}>
      <canvas ref={canvasRef} tabIndex={0} className={styles.canvas} />
    </div>
  );
}
