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
  /** True when the engine is showing attract-mode demo (not real gameplay) */
  const [demoActive, setDemoActive] = useState(false);
  /** Timers we may need to cancel — kept in refs so cleanup is correct */
  const demoIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const demoStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      // During demo: any control input cancels demo and starts real game
      if (engineRef.current?.isDemoMode()) {
        if (KEY_MAP[e.code] || e.code === 'Enter' || e.code === 'KeyR') {
          e.preventDefault();
          startGame();
          return;
        }
      }
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
      // Touch during demo starts real game instead of registering as input
      if (engine.isDemoMode()) {
        e.preventDefault();
        startGame();
        return;
      }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadState.done]);

  /**
   * Read ?wave=N from URL for QA/dev jumping straight to a specific wave.
   * Examples:  /play?wave=5   → start at Damager
   *            /play?wave=10  → start at 6529 Punk
   *            /play?wave=30  → start at Max Pain
   *            /play?wave=31  → secret MintFace fight
   * Memoized so re-reads are cheap; only re-evaluates on URL change.
   */
  const getStartWave = useCallback((): number | undefined => {
    if (typeof window === 'undefined') return undefined;
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('wave');
    if (!raw) return undefined;
    const n = parseInt(raw, 10);
    if (Number.isNaN(n) || n < 1 || n > 31) return undefined;
    return n;
  }, []);

  /**
   * Demo / attract mode helpers.
   *
   * Lifecycle:
   *   1. Pre-game screen is shown. After 5s of no interaction, startDemo()
   *      fires the engine in AI-controlled invincible mode at a mid-game wave.
   *   2. Demo runs for ~25s, then stopDemo() resets to pre-game.
   *   3. If pre-game is still idle for another 5s, demo plays again — but
   *      this time we pick a different wave for variety.
   *   4. Any user interaction (button click, keypress) cancels demo and
   *      either starts the real game or returns to attract.
   */
  // Cycle through these waves on successive demo plays for variety
  const DEMO_WAVES = [22, 17, 28, 13];
  const demoCycleRef = useRef(0);

  const stopDemo = useCallback(() => {
    if (demoStopTimerRef.current) {
      clearTimeout(demoStopTimerRef.current);
      demoStopTimerRef.current = null;
    }
    if (engineRef.current) {
      engineRef.current.stop();
    }
    setDemoActive(false);
    setRunning(false);
    setPhase('pre-game');
  }, []);

  const startDemo = useCallback(() => {
    if (!engineRef.current || !loadState.done) return;
    const wave = DEMO_WAVES[demoCycleRef.current % DEMO_WAVES.length];
    demoCycleRef.current += 1;
    engineRef.current.startDemo(wave);
    setDemoActive(true);
    setRunning(true);
    // Demo runs for 25s, then we cycle back to attract
    if (demoStopTimerRef.current) clearTimeout(demoStopTimerRef.current);
    demoStopTimerRef.current = setTimeout(() => {
      stopDemo();
    }, 25000);
  }, [loadState.done, stopDemo]);

  /** Schedule idle-timeout to start the demo after 5s of inactivity */
  const scheduleAttractTimer = useCallback(() => {
    if (demoIdleTimerRef.current) clearTimeout(demoIdleTimerRef.current);
    demoIdleTimerRef.current = setTimeout(() => {
      // Only auto-demo if still on pre-game screen and not playing for real
      startDemo();
    }, 5000);
  }, [startDemo]);

  const cancelAttractTimer = useCallback(() => {
    if (demoIdleTimerRef.current) {
      clearTimeout(demoIdleTimerRef.current);
      demoIdleTimerRef.current = null;
    }
  }, []);

  // Kick off attract loop once assets are loaded and we're idle on pre-game
  useEffect(() => {
    if (!loadState.done) return;
    if (running && !demoActive) return; // playing real game
    if (demoActive) return; // demo already running; its stop callback will retrigger
    scheduleAttractTimer();
    return () => {
      cancelAttractTimer();
    };
  }, [loadState.done, running, demoActive, scheduleAttractTimer, cancelAttractTimer]);

  // After demo ends, schedule the next attract cycle
  useEffect(() => {
    if (demoActive) return;
    if (!loadState.done) return;
    if (running) return;
    // We're back in attract mode; the other effect handles scheduling
  }, [demoActive, loadState.done, running]);

  const startGame = useCallback(() => {
    if (!engineRef.current || !loadState.done) return;
    // Tear down any demo / timers first
    cancelAttractTimer();
    if (demoStopTimerRef.current) {
      clearTimeout(demoStopTimerRef.current);
      demoStopTimerRef.current = null;
    }
    setDemoActive(false);
    engineRef.current.start(getStartWave());
    setRunning(true);
  }, [loadState.done, getStartWave, cancelAttractTimer]);

  const loadPct = loadState.total > 0 ? Math.round((loadState.loaded / loadState.total) * 100) : 0;

  return (
    <>
      <header className={styles.marquee}>
        <div className={styles.marqueeLeft}>
          <Link href="/">★ PIXELARCADE.ART</Link>
        </div>
        <div className={styles.marqueeCenter}>
          SWARM · v0.2
          {getStartWave() !== undefined && (
            <span className={styles.devBadge}> · DEV WAVE {getStartWave()}</span>
          )}
        </div>
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
                    <Link href="/characters" className={styles.charactersLink}>
                      ? CHARACTERS
                    </Link>
                    <div className={styles.footnote}>v0.2 prototype · vanilla mode</div>
                  </>
                )}
              </div>
            )}

            {/* Demo mode banner overlay — runs during attract-mode auto-play */}
            {running && demoActive && (
              <div className={styles.demoOverlay} onClick={startGame}>
                <div className={styles.demoBanner}>
                  <div className={styles.demoLabel}>★ DEMO MODE ★</div>
                  <div className={styles.demoCta}>CLICK ANYWHERE OR PRESS ENTER TO PLAY</div>
                </div>
              </div>
            )}

            {running && !demoActive && phase === 'game-over' && (
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

            {running && !demoActive && phase === 'victory' && (
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

            {running && !demoActive && phase === 'true-victory' && (
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
