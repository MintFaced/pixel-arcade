'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { GameEngine, type GameStats, type GamePhase, PLAYFIELD_W, PLAYFIELD_H } from './engine';
import { loadAssets, type AssetBundle } from './assets';
import styles from './page.module.css';

/**
 * /play — PixelArcade: SWARM (session 5b).
 *
 * Crypto-native game: XNoun player ship, real mfer enemies fetched from IPFS,
 * XCOPY-themed bosses every 5 waves, XNoun-headed power-ups.
 *
 * Pre-game: asset loader runs (local PNGs + 4 mfer IPFS fetches). Player
 * sees a loading bar. Once "READY" the INSERT COIN button appears.
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

interface LoadState {
  loaded: number;
  total: number;
  current: string;
  done: boolean;
  failed: string[];
}

export default function PlayPage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const assetsRef = useRef<AssetBundle | null>(null);

  const [loadState, setLoadState] = useState<LoadState>({ loaded: 0, total: 0, current: '', done: false, failed: [] });
  const [hasGameOverImage, setHasGameOverImage] = useState(false);
  const [stats, setStats] = useState<GameStats>({
    score: 0, lives: 3, wave: 1, streak: 0, multiplier: 1,
    activeBoosts: [], bossHp: null,
  });
  const [phase, setPhase] = useState<GamePhase>('pre-game');
  const [running, setRunning] = useState(false);

  // === Asset loading ===
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const bundle = await loadAssets((loaded, total, current) => {
        if (cancelled) return;
        setLoadState((s) => ({ ...s, loaded, total, current }));
      });
      if (cancelled) return;
      assetsRef.current = bundle;
      // The game-over sprite is optional — only render the image if it loaded
      setHasGameOverImage(bundle.sprites.has('game-over'));
      setLoadState({ loaded: bundle.sprites.size, total: bundle.sprites.size, current: '', done: true, failed: bundle.failed });
    })();
    return () => { cancelled = true; };
  }, []);

  // === Engine init (after assets loaded + canvas mounted) ===
  useEffect(() => {
    if (!loadState.done) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const assets = assetsRef.current;
    if (!assets) return;

    const dpr = window.devicePixelRatio || 1;
    const setCanvasSize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
    };
    setCanvasSize();
    window.addEventListener('resize', setCanvasSize);

    const engine = new GameEngine(canvas, assets, {
      onStatsChange: (s) => setStats(s),
      onPhaseChange: (p) => setPhase(p),
    });
    engineRef.current = engine;

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
      if (e.code === 'Enter' || e.code === 'KeyR') startGame();
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
  }, [loadState.done]);

  // === Touch controls ===
  useEffect(() => {
    if (!loadState.done) return;
    const canvas = canvasRef.current;
    const engine = engineRef.current;
    if (!canvas || !engine) return;

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
        engine.setInput({ left: dx < -5, right: dx > 5, fire: true });
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
  }, [loadState.done]);

  const startGame = useCallback(() => {
    if (engineRef.current && loadState.done) {
      engineRef.current.start();
      setRunning(true);
    }
  }, [loadState.done]);

  const loadPct = loadState.total > 0 ? Math.round((loadState.loaded / loadState.total) * 100) : 0;

  return (
    <>
      <header className={styles.marquee}>
        <div className={styles.marqueeLeft}>
          <Link href="/">★ PIXELARCADE.ART</Link>
        </div>
        <div className={styles.marqueeCenter}>SWARM · v0.2</div>
        <div className={styles.marqueeRight}>
          {phase === 'playing' || phase === 'wave-intro' || phase === 'wave-clear'
            ? 'BATTLE'
            : phase === 'victory'
            ? '★ VICTORY ★'
            : 'STANDBY'}
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
            <div className={`${styles.hudValue} ${styles.cyan}`}>
              {stats.wave > 30 ? `${stats.wave}/?` : `${stats.wave}/30`}
            </div>
          </div>
          <div className={styles.hudCell}>
            <div className={styles.hudLabel}>LIVES</div>
            <div className={`${styles.hudValue} ${styles.pink}`}>{'★'.repeat(Math.max(0, stats.lives))}</div>
          </div>
          <div className={styles.hudCell}>
            <div className={styles.hudLabel}>STREAK</div>
            <div className={`${styles.hudValue} ${stats.multiplier > 1 ? styles.yellow : ''}`}>
              {stats.streak}{stats.multiplier > 1 ? ` · ${stats.multiplier}x` : ''}
            </div>
          </div>
        </div>

        {/* Active power-ups bar */}
        {stats.activeBoosts.length > 0 && (
          <div className={styles.boostsBar}>
            {stats.activeBoosts.map((b) => (
              <div key={b.type} className={styles.boostBadge}>
                <span className={styles.boostType}>{b.type.toUpperCase()}</span>
                {b.remaining !== Infinity && (
                  <span className={styles.boostTime}>{b.remaining.toFixed(1)}s</span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* CRT Cabinet */}
        <div className={styles.cabinet}>
          <div className={styles.cabinetInner}>
            <canvas
              ref={canvasRef}
              className={styles.canvas}
              width={PLAYFIELD_W * 2}
              height={PLAYFIELD_H * 2}
            />

            {/* Pre-game / loading overlay */}
            {!running && (
              <div className={styles.overlay}>
                {!loadState.done ? (
                  <>
                    <div className={styles.title}>SWARM</div>
                    <div className={styles.subtitle}>★ LOADING ASSETS ★</div>
                    <div className={styles.loadBar}>
                      <div className={styles.loadFill} style={{ width: `${loadPct}%` }} />
                    </div>
                    <div className={styles.loadStatus}>
                      {loadState.loaded}/{loadState.total} · {loadState.current.toUpperCase()}
                    </div>
                    <div className={styles.footnote}>LOADING SPRITES…</div>
                  </>
                ) : (
                  <>
                    <div className={styles.title}>SWARM</div>
                    <div className={styles.subtitle}>★ PIXELARCADE · A NEW CHAPTER ★</div>
                    <div className={styles.instructions}>
                      <p>← → MOVE  ·  SPACE FIRE</p>
                      <p>SURVIVE 30 WAVES · DEFEAT 6 BOSSES</p>
                      <p>COLLECT XNOUN POWER-UPS</p>
                    </div>
                    {loadState.failed.length > 0 && (
                      <div className={styles.warn}>
                        ! {loadState.failed.length} ASSET(S) USING PLACEHOLDER
                      </div>
                    )}
                    <button className={styles.startBtn} onClick={startGame}>
                      ▶ INSERT COIN
                    </button>
                    <div className={styles.footnote}>v0.2 prototype · vanilla mode</div>
                  </>
                )}
              </div>
            )}

            {running && phase === 'game-over' && (
              <div className={styles.overlay}>
                {hasGameOverImage ? (
                  <img
                    src="/swarm/sprites/game-over.png"
                    alt="GAME OVER"
                    className={styles.gameOverImage}
                  />
                ) : (
                  <div className={styles.gameOverTitle}>GAME OVER</div>
                )}
                <div className={styles.finalScore}>{String(stats.score).padStart(6, '0')}</div>
                <div className={styles.subtitle}>
                  WAVE {stats.wave}/30 · SHIP LOST · NGMI
                </div>
                <button className={styles.startBtn} onClick={startGame}>
                  ▶ PLAY AGAIN
                </button>
                <div className={styles.footnote}>(R or ENTER also restarts)</div>
              </div>
            )}

            {running && phase === 'victory' && (
              <div className={styles.overlay}>
                <div className={styles.victoryTitle}>★ VICTORY ★</div>
                <div className={styles.finalScore}>{String(stats.score).padStart(6, '0')}</div>
                <div className={styles.subtitle}>
                  30 WAVES CLEARED
                </div>
                <button className={styles.startBtn} onClick={startGame}>
                  ▶ PLAY AGAIN
                </button>
              </div>
            )}

            {running && phase === 'true-victory' && (
              <div className={styles.overlay}>
                <div className={styles.trueVictoryTitle}>★ TRUE ENDING ★</div>
                <div className={styles.finalScore}>{String(stats.score).padStart(6, '0')}</div>
                <div className={styles.subtitle}>
                  MINTFACE DEFEATED · 64 PAINTINGS · 31 WAVES
                </div>
                <div className={styles.trueEndingMsg}>
                  YOU HAVE TRANSCENDED THE ARCADE
                </div>
                <button className={styles.startBtn} onClick={startGame}>
                  ▶ PLAY AGAIN
                </button>
                <div className={styles.footnote}>★ MINTFACE.ART · THE LINE NZ ★</div>
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
