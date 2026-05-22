'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { GameEngine, type GameStats, type GamePhase, PLAYFIELD_W, PLAYFIELD_H } from './engine';
import styles from './page.module.css';

/**
 * /play — PixelArcade: SWARM (session 5a prototype).
 *
 * Hidden URL, no nav links. Single-player Galaga-style demo, 3 waves of
 * placeholder mfer-grunt enemies. Vanilla mode only (no perks yet — those
 * come in 5c with leaderboard backend).
 */

const KEY_MAP: Record<string, 'left' | 'right' | 'fire'> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyA: 'left',
  KeyD: 'right',
  Space: 'fire',
  KeyJ: 'fire',
  KeyZ: 'fire',
};

export default function PlayPage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const [stats, setStats] = useState<GameStats>({ score: 0, lives: 3, wave: 1, streak: 0, multiplier: 1 });
  const [phase, setPhase] = useState<GamePhase>('pre-game');
  const [running, setRunning] = useState(false);

  // Initialize engine on mount
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Set canvas dimensions matching display, scaled for DPR for crisp pixels
    const dpr = window.devicePixelRatio || 1;
    const setCanvasSize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
    };
    setCanvasSize();
    window.addEventListener('resize', setCanvasSize);

    const engine = new GameEngine(canvas, {
      onStatsChange: (s) => setStats(s),
      onPhaseChange: (p) => setPhase(p),
    });
    engineRef.current = engine;

    // Keyboard listeners
    const heldKeys = new Set<string>();
    const updateInput = () => {
      const input = { left: false, right: false, fire: false };
      for (const code of heldKeys) {
        const action = KEY_MAP[code];
        if (action) input[action] = true;
      }
      engine.setInput(input);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (KEY_MAP[e.code]) {
        e.preventDefault();
        heldKeys.add(e.code);
        updateInput();
      }
      // Enter / R to start or restart
      if (e.code === 'Enter' || e.code === 'KeyR') {
        startGame();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (KEY_MAP[e.code]) {
        heldKeys.delete(e.code);
        updateInput();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    return () => {
      window.removeEventListener('resize', setCanvasSize);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      engine.stop();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mobile touch controls
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = engineRef.current;
    if (!engine) return;

    let touchX: number | null = null;
    let touchActive = false;

    const onStart = (e: TouchEvent) => {
      e.preventDefault();
      touchActive = true;
      touchX = e.touches[0].clientX;
      engine.setInput({ fire: true });
    };
    const onMove = (e: TouchEvent) => {
      if (!touchActive) return;
      const x = e.touches[0].clientX;
      if (touchX !== null) {
        const dx = x - touchX;
        engine.setInput({
          left: dx < -5,
          right: dx > 5,
          fire: true,
        });
      }
    };
    const onEnd = () => {
      touchActive = false;
      touchX = null;
      engine.setInput({ left: false, right: false, fire: false });
    };
    canvas.addEventListener('touchstart', onStart, { passive: false });
    canvas.addEventListener('touchmove', onMove, { passive: false });
    canvas.addEventListener('touchend', onEnd);
    return () => {
      canvas.removeEventListener('touchstart', onStart);
      canvas.removeEventListener('touchmove', onMove);
      canvas.removeEventListener('touchend', onEnd);
    };
  }, []);

  const startGame = () => {
    if (engineRef.current) {
      engineRef.current.start();
      setRunning(true);
    }
  };

  return (
    <>
      <header className={styles.marquee}>
        <div className={styles.marqueeLeft}>
          <Link href="/">★ PIXELARCADE.ART</Link>
        </div>
        <div className={styles.marqueeCenter}>SWARM · v0.1</div>
        <div className={styles.marqueeRight}>
          {phase === 'playing' || phase === 'wave-intro' || phase === 'wave-clear' ? 'BATTLE' : 'STANDBY'}
        </div>
      </header>

      <main className={styles.main}>
        {/* HUD */}
        <div className={styles.hud}>
          <div className={styles.hudCell}>
            <div className={styles.hudLabel}>SCORE</div>
            <div className={styles.hudValue}>{String(stats.score).padStart(6, '0')}</div>
          </div>
          <div className={styles.hudCell}>
            <div className={styles.hudLabel}>WAVE</div>
            <div className={`${styles.hudValue} ${styles.cyan}`}>{stats.wave}</div>
          </div>
          <div className={styles.hudCell}>
            <div className={styles.hudLabel}>LIVES</div>
            <div className={`${styles.hudValue} ${styles.pink}`}>
              {'★'.repeat(Math.max(0, stats.lives))}
            </div>
          </div>
          <div className={styles.hudCell}>
            <div className={styles.hudLabel}>STREAK</div>
            <div className={`${styles.hudValue} ${stats.multiplier > 1 ? styles.yellow : ''}`}>
              {stats.streak}{stats.multiplier > 1 ? ` · ${stats.multiplier}x` : ''}
            </div>
          </div>
        </div>

        {/* CRT Cabinet around playfield */}
        <div className={styles.cabinet}>
          <div className={styles.cabinetInner}>
            <canvas
              ref={canvasRef}
              className={styles.canvas}
              width={PLAYFIELD_W * 2}
              height={PLAYFIELD_H * 2}
            />

            {/* Overlay screens */}
            {!running && (
              <div className={styles.overlay}>
                <div className={styles.title}>SWARM</div>
                <div className={styles.subtitle}>★ PIXELARCADE · A NEW CHAPTER ★</div>
                <div className={styles.instructions}>
                  <p>← → MOVE  ·  SPACE FIRE</p>
                  <p>(or touch + drag)</p>
                </div>
                <button className={styles.startBtn} onClick={startGame}>
                  ▶ INSERT COIN
                </button>
                <div className={styles.footnote}>v0.1 prototype · 3 waves</div>
              </div>
            )}

            {running && phase === 'game-over' && (
              <div className={styles.overlay}>
                <div className={styles.gameOverTitle}>GAME OVER</div>
                <div className={styles.finalScore}>{String(stats.score).padStart(6, '0')}</div>
                <div className={styles.subtitle}>
                  WAVE {stats.wave} · {stats.lives <= 0 ? 'SHIP LOST' : '3 WAVES CLEARED'}
                </div>
                <button className={styles.startBtn} onClick={startGame}>
                  ▶ PLAY AGAIN
                </button>
                <div className={styles.footnote}>(R or ENTER also restarts)</div>
              </div>
            )}
          </div>
        </div>

        <div className={styles.controls}>
          <span>← → / A D · MOVE</span>
          <span>·</span>
          <span>SPACE / J / Z · FIRE</span>
          <span>·</span>
          <span>R / ENTER · RESTART</span>
        </div>
      </main>
    </>
  );
}
