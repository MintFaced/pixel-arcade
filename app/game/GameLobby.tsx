'use client';
import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import styles from './page.module.css';

const W = 600, H = 1000;
const CABINET_H = 540;
const GAP = 14;

type Game = { name: string; url: string; color: string; preview: string };

const GAMES: Game[] = [
  { name: 'TENNIS',    url: '/tennis',    color: '#38f2c6', preview: '/game/previews/tennis.png' },
  { name: 'SWARM',     url: '/play',      color: '#ff5aa8', preview: '/game/previews/swarm.png' },
  { name: 'SURVIVORS', url: '/survivors', color: '#5fc850', preview: '/game/previews/survivors.png' },
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
      const out = { L: false, R: false, A: false };
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const p of pads) {
        if (!p) continue;
        const lx = p.axes[0] ?? 0;
        const dir = Math.abs(lx) > 0.4 ? Math.sign(lx) : 0;
        const lastDir = (padPrev[100] as number) ?? 0;
        if (dir === 1 && lastDir !== 1) out.R = true;
        if (dir === -1 && lastDir !== -1) out.L = true;
        padPrev[100] = dir;
        const b = p.buttons;
        if (b[14]?.pressed && !padPrev[14]) out.L = true;
        if (b[15]?.pressed && !padPrev[15]) out.R = true;
        padPrev[14] = !!b[14]?.pressed; padPrev[15] = !!b[15]?.pressed;
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

    type Cabinet = Game & { x: number; y: number; w: number; h: number; img: HTMLImageElement };
    let layout: Cabinet[] | null = null;
    function computeLayout(): boolean {
      if (!allLoaded) return false;
      const cabs: Cabinet[] = GAMES.map(g => {
        const im = imgs[g.preview];
        const w = Math.round(CABINET_H * (im.naturalWidth / im.naturalHeight));
        return { ...g, w, h: CABINET_H, img: im, x: 0, y: 0 };
      });
      const totalW = cabs.reduce((s, c) => s + c.w, 0) + GAP * (cabs.length - 1);
      let x = (W - totalW) / 2;
      const y = (H - CABINET_H) / 2;
      for (const c of cabs) { c.x = x; c.y = y; x += c.w + GAP; }
      layout = cabs;
      return true;
    }

    function move(dx: number) {
      state.selected = (state.selected + dx + GAMES.length) % GAMES.length;
      SFX.move();
    }
    function launch() {
      const g = GAMES[state.selected];
      state.launching = g;
      state.launchT = 0;
      SFX.select();
      window.setTimeout(() => { router.push(g.url); }, 700);
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

    function drawCabinet(c: Cabinet, idx: number) {
      const isSel = idx === state.selected;
      const bob = isSel ? Math.sin(state.t * 2.5) * 2 : 0;
      const y = c.y + bob;
      if (isSel) {
        const pulse = (Math.sin(state.t * 4) + 1) / 2;
        ctx.save();
        ctx.shadowColor = c.color; ctx.shadowBlur = 30 + pulse * 22;
        ctx.strokeStyle = c.color; ctx.lineWidth = 4;
        ctx.strokeRect(c.x - 2, y - 2, c.w + 4, c.h + 4);
        ctx.restore();
        ctx.save();
        ctx.strokeStyle = c.color;
        ctx.globalAlpha = 0.5 + pulse * 0.4;
        ctx.lineWidth = 2;
        ctx.strokeRect(c.x - 6, y - 6, c.w + 12, c.h + 12);
        ctx.restore();
      } else {
        ctx.strokeStyle = 'rgba(120, 110, 130, 0.35)';
        ctx.lineWidth = 1;
        ctx.strokeRect(c.x - 1, y - 1, c.w + 2, c.h + 2);
      }
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(c.img, c.x, y, c.w, c.h);
      if (!isSel) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
        ctx.fillRect(c.x, y, c.w, c.h);
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
      if (!computeLayout()) return;
      for (let i = 0; i < layout!.length; i++) drawCabinet(layout![i], i);
      drawLaunchSplash();
    }

    function update(dt: number) {
      state.t += dt;
      if (state.launching) { state.launchT += dt; pressed.clear(); return; }
      const pe = padEdges();
      if (pressed.has('ArrowLeft') || pressed.has('KeyA') || pe.L) move(-1);
      else if (pressed.has('ArrowRight') || pressed.has('KeyD') || pe.R) move(+1);
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
      if (!layout) return;
      const rect = canvas!.getBoundingClientRect();
      const cx = (e.clientX - rect.left) * (W / rect.width);
      const cy = (e.clientY - rect.top) * (H / rect.height);
      for (let i = 0; i < layout!.length; i++) {
        const c = layout![i];
        if (cx >= c.x && cx < c.x + c.w && cy >= c.y && cy < c.y + c.h) {
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
