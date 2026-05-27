'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { GameEngine, type GameStats, type GamePhase, PLAYFIELD_W, PLAYFIELD_H } from './engine';
import { loadAssets, type AssetBundle } from './assets';
import { readGamepad, gamepadCount } from './gamepad';
import { getAudio } from './audio';
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
    mode: 'single', currentPlayer: 1,
    p1Score: 0, p1Wave: 0, p2Score: 0, p2Wave: 0,
  });
  const [phase, setPhase] = useState<GamePhase>('pre-game');
  const [running, setRunning] = useState(false);
  /** True when the engine is showing attract-mode demo (not real gameplay) */
  const [demoActive, setDemoActive] = useState(false);
  /** Timers we may need to cancel — kept in refs so cleanup is correct */
  const demoIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const demoStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Mute state — synced with AudioEngine, displayed in HUD */
  const [isMuted, setIsMuted] = useState(false);
  useEffect(() => {
    // On mount, read persisted mute state from the audio engine
    setIsMuted(getAudio().isMuted());
  }, []);

  /**
   * Rotation override — for cabinets with vertical-mounted monitors where
   * the OS-level display rotation isn't being used, or for previewing the
   * cabinet view on a normal landscape laptop.
   *
   * Usage: append ?rotate=90 (or 180, 270, or -90) to the URL.
   * Read once on mount — changing it requires a full reload.
   */
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raw = new URLSearchParams(window.location.search).get('rotate');
    if (!raw) return;
    const n = parseInt(raw, 10);
    // Accept 90, 180, 270, or -90 (treat -90 as 270)
    const normalized = ((n % 360) + 360) % 360;
    if (normalized === 90 || normalized === 180 || normalized === 270) {
      setRotation(normalized);
    }
  }, []);

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
      // Preload audio SFX in parallel. Doesn't block the loading screen — failures
      // are silent (the game will fall back to no-sound for any unloaded sample).
      void getAudio().preloadSfx();
      void getAudio().preloadVoiceTaunts();
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
      // First-interaction audio unlock (browser autoplay policy)
      getAudio().unlock();
      // M key toggles mute, regardless of game phase
      if (e.code === 'KeyM') {
        e.preventDefault();
        const muted = getAudio().toggleMute();
        setIsMuted(muted);
        return;
      }
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
      // First-interaction audio unlock (mobile autoplay policy)
      getAudio().unlock();
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
   * Gamepad polling.
   *
   * The Gamepad API requires per-frame polling (no events for analog/held state).
   * Separate requestAnimationFrame loop reads the active player's gamepad:
   *   - Sends movement+fire to engine.setGamepadInput (OR-merges with keyboard)
   *   - Detects start-press for handoff (p2-ready) and post-game restart
   *   - Detects face-button and select press on pre-game/menu screens
   *   - Updates connection count for the controller-detection UI badge
   *
   * Active controller index: 0 for P1 / single, 1 for P2 in hot-seat mode.
   * Each player has their own physical controller for the whole match.
   */
  const [connectedPads, setConnectedPads] = useState(0);

  /** Refs let the rAF loop see latest phase + callbacks without recreating itself */
  const phaseRef = useRef<GamePhase>('pre-game');
  const startGameRef = useRef<((mode?: 'single' | 'twoPlayer') => void) | null>(null);

  // Keep phaseRef in sync with state
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    if (!loadState.done) return;
    let rafId: number | null = null;
    let lastConnectedCheck = 0;
    // Edge-trigger tracking for menu-buttons. Maps "padIdx:btnIdx" → was-down.
    // Used so we only fire startGame once per press, not while held.
    const menuButtonWasDown = new Map<string, boolean>();
    const tick = () => {
      const engine = engineRef.current;
      if (!engine) {
        rafId = requestAnimationFrame(tick);
        return;
      }
      // Throttle: connection count doesn't change frame-to-frame
      const now = performance.now();
      if (now - lastConnectedCheck > 250) {
        setConnectedPads(gamepadCount());
        lastConnectedCheck = now;
      }
      // Active pad index based on whose turn it is
      const s = engine.getStats();
      const padIndex = (s.mode === 'twoPlayer' && s.currentPlayer === 2) ? 1 : 0;
      const snap = readGamepad(padIndex);
      // Send held-button state to engine (OR-merged with keyboard)
      engine.setGamepadInput({
        left: snap.left,
        right: snap.right,
        fire: snap.fire,
      });
      // Edge-triggered start press handles phase transitions
      if (snap.startPressed) {
        const p = phaseRef.current;
        if (p === 'p2-ready') {
          engine.startNextPlayer();
        } else if (
          p === 'pre-game' || p === 'game-over' ||
          p === 'match-over' || p === 'true-victory' || p === 'victory'
        ) {
          startGameRef.current?.('single');
        }
      }

      // ==============================================================
      // Menu navigation via raw gamepad — only on menu/idle screens.
      //
      // The cabinet visitor needs to start the game without a keyboard.
      // We read raw gamepad button state for any pad (not just the active
      // player) so that picking up either controller works.
      //
      //   Face buttons (A/B/X/Y → idx 0-3) → single-player
      //   Back / Select (idx 8)            → two-player hot-seat
      //   Start (idx 9)                    → single-player (handled above)
      //
      // Edge-triggered: only fires on press, not while held.
      // Only active on pre-game / post-game / menu screens — never during
      // active gameplay (where face buttons should be FIRE, not start).
      // ==============================================================
      const p = phaseRef.current;
      const onMenu = (
        p === 'pre-game' || p === 'game-over' ||
        p === 'match-over' || p === 'true-victory' || p === 'victory'
      );
      if (onMenu && !engine.isDemoMode()) {
        const pads = navigator.getGamepads?.() ?? [];
        for (let i = 0; i < pads.length; i++) {
          const pad = pads[i];
          if (!pad) continue;
          // Face buttons 0-3 → single-player
          for (let b = 0; b < 4; b++) {
            const key = `${i}:${b}`;
            const pressed = pad.buttons[b]?.pressed ?? false;
            if (pressed && !menuButtonWasDown.get(key)) {
              menuButtonWasDown.set(key, true);
              startGameRef.current?.('single');
            }
            if (!pressed) menuButtonWasDown.set(key, false);
          }
          // Button 8 (Back/Select on Xbox layout) → two-player hot-seat
          const selectKey = `${i}:8`;
          const selectPressed = pad.buttons[8]?.pressed ?? false;
          if (selectPressed && !menuButtonWasDown.get(selectKey)) {
            menuButtonWasDown.set(selectKey, true);
            startGameRef.current?.('twoPlayer');
          }
          if (!selectPressed) menuButtonWasDown.set(selectKey, false);
        }
      }

      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
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

  /**
   * Music management — drives background music from the React side based on
   * phase + running state. In-game music transitions (chapter → boss → mintface)
   * are handled inside the engine via musicForWave(); this effect handles the
   * wrapper states.
   *
   * States:
   *   - pre-game / not running    → music-attract (the gallery vibe)
   *   - demo active                → music-chapter-3 (mid-energy demo bed)
   *   - playing real game          → engine starts the right wave/boss track
   *   - game-over / match-over     → silence so the game-over SFX has space
   */
  useEffect(() => {
    if (!loadState.done) return;
    const audio = getAudio();
    if (!running) {
      // Pre-game or post-game: attract music
      void audio.playMusic('music-attract');
    } else if (demoActive) {
      // Demo running — emerging vibe, mid-energy bed
      void audio.playMusic('music-chapter-3');
    } else if (phase === 'game-over' || phase === 'match-over' || phase === 'true-victory' || phase === 'victory') {
      // End states — silence music so the SFX flourish has room
      void audio.playMusic(null);
    } else if (phase === 'p2-ready') {
      // Hot-seat handoff — same gentle attract vibe
      void audio.playMusic('music-attract');
    }
    // Other in-game phases handled by engine.spawnBoss / wave-intro logic
  }, [loadState.done, running, demoActive, phase]);

  /** Mode the user selected on the pre-game screen (or last played) */
  const [selectedMode, setSelectedMode] = useState<'single' | 'twoPlayer'>('single');

  const startGame = useCallback((mode?: 'single' | 'twoPlayer') => {
    if (!engineRef.current || !loadState.done) return;
    // Audio unlock — covers all click-driven entry points (button + demo overlay)
    getAudio().unlock();
    const m = mode ?? selectedMode;
    if (mode) setSelectedMode(mode);
    // Tear down any demo / timers first
    cancelAttractTimer();
    if (demoStopTimerRef.current) {
      clearTimeout(demoStopTimerRef.current);
      demoStopTimerRef.current = null;
    }
    setDemoActive(false);
    engineRef.current.start(getStartWave(), m);
    setRunning(true);
  }, [loadState.done, getStartWave, cancelAttractTimer, selectedMode]);

  // Keep ref in sync so the gamepad polling loop can call startGame
  useEffect(() => {
    startGameRef.current = (mode) => startGame(mode);
  }, [startGame]);

  /** Hot-seat handoff handler — wired to buttons and gamepad start */
  const startNextPlayer = useCallback(() => {
    if (!engineRef.current) return;
    engineRef.current.startNextPlayer();
  }, []);

  const loadPct = loadState.total > 0 ? Math.round((loadState.loaded / loadState.total) * 100) : 0;

  return (
    <div
      className={rotation !== 0 ? styles.rotateWrap : undefined}
      data-rotate={rotation || undefined}
    >
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
          <button
            type="button"
            className={styles.muteToggle}
            onClick={() => {
              getAudio().unlock();
              setIsMuted(getAudio().toggleMute());
            }}
            aria-label={isMuted ? 'Unmute' : 'Mute'}
            title={isMuted ? 'UNMUTE (M)' : 'MUTE (M)'}
          >
            {isMuted ? '🔇' : '♪'}
          </button>
          <span className={styles.marqueeStatus}>
            {phase === 'playing' || phase === 'wave-intro' || phase === 'wave-clear'
              ? 'BATTLE'
              : phase === 'victory'
              ? '★ VICTORY ★'
              : 'STANDBY'}
          </span>
        </div>
      </header>

      <main className={styles.main}>
        {/* HUD */}
        <div className={styles.hud}>
          <div className={styles.hudCell}>
            <div className={styles.hudLabel}>
              SCORE
              {stats.mode === 'twoPlayer' && (
                <span className={`${styles.playerBadge} ${stats.currentPlayer === 1 ? styles.p1Badge : styles.p2Badge}`}>
                  P{stats.currentPlayer}
                </span>
              )}
            </div>
            <div className={styles.hudValue}>{String(stats.score).padStart(6, '0')}</div>
            {stats.mode === 'twoPlayer' && stats.currentPlayer === 2 && stats.p1Score > 0 && (
              <div className={styles.hudSub}>P1: {String(stats.p1Score).padStart(6, '0')}</div>
            )}
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
                      <p>COLLECT XNOUN POWER-UPS  ·  M MUTE</p>
                    </div>
                    {loadState.failed.length > 0 && (
                      <div className={styles.warn}>
                        ! {loadState.failed.length} ASSET(S) USING PLACEHOLDER
                      </div>
                    )}
                    <div className={styles.modeButtons}>
                      <button className={styles.startBtn} onClick={() => startGame('single')}>
                        ▶ 1 PLAYER
                        <span className={styles.btnHint}>PRESS ANY BUTTON</span>
                      </button>
                      <button
                        className={`${styles.startBtn} ${connectedPads < 2 ? styles.startBtnDim : ''}`}
                        onClick={() => startGame('twoPlayer')}
                        title={connectedPads < 2 ? '2 controllers recommended (keyboard still works)' : ''}
                      >
                        ▶ 2 PLAYER · TAKE TURNS
                        <span className={styles.btnHint}>PRESS SELECT / BACK</span>
                      </button>
                    </div>
                    <div className={styles.padStatus}>
                      {connectedPads === 0
                        ? 'NO CONTROLLERS · KEYBOARD ONLY'
                        : connectedPads === 1
                        ? '1 CONTROLLER DETECTED'
                        : `${connectedPads} CONTROLLERS DETECTED`}
                    </div>
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
              <div className={styles.demoOverlay} onClick={() => startGame()}>
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
                <button className={styles.startBtn} onClick={() => startGame()}>
                  ▶ PLAY AGAIN
                  <span className={styles.btnHint}>PRESS ANY BUTTON</span>
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
                <button className={styles.startBtn} onClick={() => startGame()}>
                  ▶ PLAY AGAIN
                  <span className={styles.btnHint}>PRESS ANY BUTTON</span>
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
                <button className={styles.startBtn} onClick={() => startGame()}>
                  ▶ PLAY AGAIN
                  <span className={styles.btnHint}>PRESS ANY BUTTON</span>
                </button>
                <div className={styles.footnote}>★ MINTFACE.ART · THE LINE NZ ★</div>
              </div>
            )}

            {/* Hot-seat handoff: P1 just died, P2 takes over */}
            {running && !demoActive && phase === 'p2-ready' && (
              <div className={styles.overlay}>
                <div className={styles.handoffTitle}>PLAYER 1 · GAME OVER</div>
                <div className={styles.handoffScore}>
                  P1 · {String(stats.p1Score).padStart(6, '0')} · WAVE {stats.p1Wave}
                </div>
                <div className={styles.handoffBig}>PLAYER 2</div>
                <div className={styles.handoffPrompt}>PRESS ANY BUTTON TO START</div>
                <button className={styles.startBtn} onClick={startNextPlayer}>
                  ▶ PLAYER 2 START
                </button>
                <div className={styles.footnote}>(ENTER · R · ANY GAMEPAD BUTTON)</div>
              </div>
            )}

            {/* Match comparison: both players done */}
            {running && !demoActive && phase === 'match-over' && (
              <div className={styles.overlay}>
                <div className={styles.matchTitle}>★ MATCH OVER ★</div>
                <div className={styles.scoreBoard}>
                  <div className={`${styles.scoreEntry} ${stats.p1Score > stats.p2Score ? styles.scoreWinner : ''}`}>
                    <div className={styles.scoreLabel}>PLAYER 1</div>
                    <div className={styles.scoreValue}>{String(stats.p1Score).padStart(6, '0')}</div>
                    <div className={styles.scoreSub}>WAVE {stats.p1Wave}</div>
                  </div>
                  <div className={styles.scoreVs}>VS</div>
                  <div className={`${styles.scoreEntry} ${stats.p2Score > stats.p1Score ? styles.scoreWinner : ''}`}>
                    <div className={styles.scoreLabel}>PLAYER 2</div>
                    <div className={styles.scoreValue}>{String(stats.p2Score).padStart(6, '0')}</div>
                    <div className={styles.scoreSub}>WAVE {stats.p2Wave}</div>
                  </div>
                </div>
                <div className={styles.matchResult}>
                  {stats.p1Score === stats.p2Score
                    ? 'TIE GAME'
                    : stats.p1Score > stats.p2Score
                    ? '★ PLAYER 1 WINS ★'
                    : '★ PLAYER 2 WINS ★'}
                </div>
                <button className={styles.startBtn} onClick={() => startGame()}>
                  ▶ PLAY AGAIN
                  <span className={styles.btnHint}>PRESS ANY BUTTON</span>
                </button>
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
    </div>
  );
}
