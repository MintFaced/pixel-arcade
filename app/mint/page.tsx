'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useAccount } from 'wagmi';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { POOL, MINT_PRICE, POOL_TOTAL, svgPath, eraClass, type PoolGame } from '../lib/pool';
import { fetchSvgArrangement } from '../lib/svgArrangement';
import { useUserTier } from '../lib/useUserTier';
import CrtPowerOn from '../components/CrtPowerOn';
import { WalletStatus } from '../components/WalletStatus';
import styles from './page.module.css';

type Phase = 'idle' | 'rolling' | 'revealed';
type Roll = { game: PoolGame; locked: boolean; seed: number };

/* ============================================================
   Utility helpers (pure)
   ============================================================ */
function randomHex(n: number): string {
  const chars = '0123456789abcdef';
  let s = '';
  for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * 16)];
  return s;
}

function pickRandomUnusedGame(usedIds: Set<string>): PoolGame | null {
  const available = POOL.filter((g) => !usedIds.has(g.id));
  if (available.length === 0) return null;
  return available[Math.floor(Math.random() * available.length)];
}

/* ============================================================
   Main page
   ============================================================ */
export default function MintPage() {
  // === Core session state ===
  const [phase, setPhase] = useState<Phase>('idle');
  const [rolls, setRolls] = useState<Roll[]>([]);
  const [activeRollIdx, setActiveRollIdx] = useState<number | null>(null);
  const [usedGameIds, setUsedGameIds] = useState<Set<string>>(new Set());

  // Roll currently being animated (rolling phase) or just revealed (revealed phase)
  const [currentGame, setCurrentGame] = useState<PoolGame | null>(null);

  // UI bits
  const [toast, setToast] = useState<string | null>(null);
  const [successInfo, setSuccessInfo] = useState<{ count: number; txHash: string } | null>(null);

  // Wallet state — required before rolling
  const { isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  // Tier resolves the connected wallet's roll allowance:
  //   - elevated tier (in proofs.json) = 5 rolls
  //   - standard tier (everyone else) = 3 rolls
  // Pre-connection or while proofs.json loads, defaults to standard (3).
  const { rollsPerDay: totalRolls } = useUserTier();
  const rollsUsed = rolls.length;
  const rollsLeft = totalRolls - rollsUsed;
  const poolRemaining = Math.max(0, POOL_TOTAL - usedGameIds.size);
  const lockedCount = rolls.filter((r) => r.locked).length;
  const allRollsUsed = rollsUsed >= totalRolls;

  // Toast auto-clear
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  /* ----------------------------------------------------------
     Roll lifecycle — rolling phase → revealed phase
     ---------------------------------------------------------- */
  const startRoll = useCallback(() => {
    // Gate on wallet connection — if not connected, open the picker instead of rolling
    if (!isConnected) {
      openConnectModal?.();
      return;
    }
    if (rollsLeft <= 0) return;
    if (phase === 'rolling') return; // ignore double-clicks during animation

    const picked = pickRandomUnusedGame(usedGameIds);
    if (!picked) {
      setToast('★ NO GAMES LEFT IN POOL ★');
      return;
    }

    // Reserve the game immediately so concurrent state can't pick it again
    setUsedGameIds((prev) => {
      const next = new Set(prev);
      next.add(picked.id);
      return next;
    });
    setCurrentGame(picked);
    setPhase('rolling');
  }, [isConnected, openConnectModal, phase, rollsLeft, usedGameIds]);

  /**
   * When the rolling animation finishes (handled by RollingScreen via callback),
   * we move to the revealed phase. The revealed screen plays the pixel-build
   * itself; once done, we commit the roll.
   */
  const onRollingDone = useCallback(() => {
    setPhase('revealed');
  }, []);

  /**
   * When the revealed screen has finished its pixel-build, commit the roll
   * into the session and switch the lock controls into "live" mode.
   * Called by RevealedScreen.
   */
  const onRevealCommit = useCallback(() => {
    if (!currentGame) return;
    setRolls((prev) => {
      const next: Roll[] = [
        ...prev,
        { game: currentGame, locked: true, seed: Math.floor(Math.random() * 1e6) },
      ];
      setActiveRollIdx(next.length - 1);
      return next;
    });
  }, [currentGame]);

  /* ----------------------------------------------------------
     Lock toggling — from stage button OR from tray clicks
     ---------------------------------------------------------- */
  const toggleLock = useCallback((idx: number) => {
    setRolls((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, locked: !r.locked } : r))
    );
  }, []);

  /* ----------------------------------------------------------
     Mint click — stash payload for my-mints hand-off + show modal
     ---------------------------------------------------------- */
  const handleMint = useCallback(() => {
    const locked = rolls.filter((r) => r.locked);
    if (locked.length === 0) return;

    const txHash = '0x' + randomHex(12) + '...';
    const payload = {
      tokenIds: locked.map((r) => r.game.tokenId),
      mintedAt: Date.now(),
      txHash,
    };
    try {
      sessionStorage.setItem('pixelarcade_post_mint_claim', JSON.stringify(payload));
    } catch {
      // sessionStorage may be unavailable in private mode; non-fatal
    }
    setSuccessInfo({ count: locked.length, txHash });
  }, [rolls]);

  /* ----------------------------------------------------------
     Roll-again from inside the revealed screen — just start the
     next roll directly. startRoll handles the phase transition.
     ---------------------------------------------------------- */
  const rollAgainAvailable = rollsUsed < totalRolls;

  /* ----------------------------------------------------------
     Stage content (idle / rolling / revealed)
     ---------------------------------------------------------- */
  let stageContent: React.ReactNode = null;
  if (phase === 'idle') {
    stageContent = (
      <IdleScreen
        isFirst={rollsUsed === 0}
        allUsed={allRollsUsed}
        rollsLeft={rollsLeft}
        rollsCount={rolls.length}
        onStart={startRoll}
      />
    );
  } else if (phase === 'rolling' && currentGame) {
    stageContent = <RollingScreen game={currentGame} onDone={onRollingDone} />;
  } else if (phase === 'revealed' && currentGame) {
    stageContent = (
      <RevealedScreen
        game={currentGame}
        rollsLeft={rollsLeft}
        isLocked={
          activeRollIdx !== null && rolls[activeRollIdx] ? rolls[activeRollIdx].locked : true
        }
        onCommit={onRevealCommit}
        onToggleLock={() => {
          if (activeRollIdx !== null) toggleLock(activeRollIdx);
        }}
        onRollAgain={startRoll}
      />
    );
  }

  return (
    <>
      <CrtPowerOn />

      <div className={styles.marquee}>
        <div className={styles.marqueeTitle}>
          <span className={styles.star}>★</span> <Link href="/" className={styles.marqueeLink}>PIXELARCADE.ART</Link>{' '}
          <span className={styles.star}>★</span>
        </div>
        <div className={styles.marqueeStatus}>
          <span className={styles.player1}>PLAYER 1</span>
          <WalletStatus />
          <ConnectedRollsBadge rollsLeft={rollsLeft} />
        </div>
      </div>

      <div className={styles.hud}>
        <div className={styles.hudCell}>
          <div className={styles.hudLabel}>ROLLS LEFT</div>
          <div className={`${styles.hudValue} ${styles.pulse}`}>{rollsLeft}</div>
        </div>
        <div className={styles.hudCell}>
          <div className={styles.hudLabel}>POOL</div>
          <div className={`${styles.hudValue} ${styles.green}`}>{poolRemaining}</div>
        </div>
        <div className={styles.hudCell}>
          <div className={styles.hudLabel}>LOCKED</div>
          <div className={`${styles.hudValue} ${styles.pink}`}>{lockedCount}</div>
        </div>
        <div className={styles.hudCell}>
          <div className={styles.hudLabel}>SESSION</div>
          <div className={`${styles.hudValue} ${styles.magenta}`}>ACTIVE</div>
        </div>
      </div>

      <section className={styles.titleBar}>
        <div className={styles.titleEyebrow}>▼ MINT ROOM · 64 ARCADE PIXEL PAINTINGS ▼</div>
        <h1>ROLL TO MINT</h1>
      </section>

      <main className={styles.stage}>
        <div className={styles.stageBezel} aria-hidden="true" />
        <div className={styles.stageContent}>{stageContent}</div>
      </main>

      <div className={styles.warningBand}>
        ★ WALK AWAY = ALL ROLLS RELEASED TO POOL · FIRST TO MINT WINS ★
      </div>

      <Tray
        rolls={rolls}
        totalRolls={totalRolls}
        activeIdx={activeRollIdx}
        phase={phase}
        onToggleLock={toggleLock}
      />

      <CommitBar
        lockedCount={lockedCount}
        anyRolls={rolls.length > 0}
        onMint={handleMint}
      />

      {toast && <div className={`${styles.toast} ${styles.toastShow}`}>{toast}</div>}

      {successInfo && <SuccessOverlay count={successInfo.count} txHash={successInfo.txHash} />}
    </>
  );
}

/* ============================================================
   IdleScreen — insert-coin or all-rolls-used review
   ============================================================ */
function IdleScreen({
  isFirst,
  allUsed,
  rollsLeft,
  rollsCount,
  onStart,
}: {
  isFirst: boolean;
  allUsed: boolean;
  rollsLeft: number;
  rollsCount: number;
  onStart: () => void;
}) {
  if (allUsed) {
    return (
      <div className={styles.idleScreen}>
        <div className={styles.idleAttract}>▼ ALL ROLLS USED ▼</div>
        <div className={styles.idleRollsInfo}>
          REVIEW YOUR <span className={styles.idleBig}>{rollsCount}</span> ROLLS BELOW
        </div>
        <p className={styles.idleInfoLine}>
          Toggle <span className={styles.idleHl}>LOCK</span> on any roll you want to mint. When ready, hit{' '}
          <span className={styles.idleHl}>MINT ALL LOCKED</span>.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.idleScreen}>
      <div className={styles.idleAttract}>▼ {isFirst ? 'INSERT COIN TO BEGIN' : 'READY FOR NEXT ROLL'} ▼</div>
      <button className={styles.insertCoinBtn} onClick={onStart}>
        {isFirst ? 'CONNECT & PLAY ▶' : 'ROLL AGAIN ▶'}
      </button>
      <div className={styles.idleRollsInfo}>
        <span className={styles.idleBig}>{rollsLeft}</span> ROLLS REMAINING
      </div>
      <p className={styles.idleInfoLine}>
        Each roll reveals a random work from the pool.{' '}
        <span className={styles.idleHl}>8-bit · 16-bit · 32-bit</span> all flat-priced at{' '}
        <span className={styles.idleHl}>0.05 ETH</span>. Bigger era = bigger painting = size lottery win.
      </p>
    </div>
  );
}

/* ============================================================
   RollingScreen — VRF type-out + 3-slot machine
   Timings preserved EXACTLY from the legacy file:
     - Lines type out at 400ms per line
     - Slot 1 lands at 1500ms
     - Slot 2 lands at 1800ms
     - Slot 3 lands at 2100ms
     - Rolling phase ends at 2700ms
   ============================================================ */
function RollingScreen({ game, onDone }: { game: PoolGame; onDone: () => void }) {
  const [lines, setLines] = useState<string[]>([]);
  const [landed, setLanded] = useState<[boolean, boolean, boolean]>([false, false, false]);

  // Hex commitment is set once on mount so the displayed value is stable
  const allLines = useMemo(
    () => [
      'REQUEST CHAINLINK VRF...',
      'VERIFYING POOL STATE...',
      `COMMITMENT: 0x${randomHex(40)}`,
      'ENTROPY ACQUIRED · ROLLING...',
    ],
    []
  );

  // Type out lines one-by-one
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    allLines.forEach((_, i) => {
      timers.push(setTimeout(() => setLines((prev) => [...prev, allLines[i]]), 18 + i * 400));
    });
    return () => timers.forEach(clearTimeout);
  }, [allLines]);

  // Land slots one-by-one at exact legacy timings
  useEffect(() => {
    const t1 = setTimeout(() => setLanded([true, false, false]), 1500);
    const t2 = setTimeout(() => setLanded([true, true, false]), 1800);
    const t3 = setTimeout(() => setLanded([true, true, true]), 2100);
    const tDone = setTimeout(() => onDone(), 2700);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(tDone);
    };
  }, [onDone]);

  const cls = eraClass(game.era);
  const eraLabel = game.era.toUpperCase();

  return (
    <div className={styles.rollingScreen}>
      <div className={styles.vrfLog}>
        {lines.map((line, i) => {
          if (line.includes('0x')) {
            const parts = line.split('0x');
            return (
              <div key={i} className={styles.vrfPrompt}>
                {parts[0]}
                <span className={styles.vrfHex}>0x{parts[1]}</span>
              </div>
            );
          }
          return (
            <div key={i} className={styles.vrfPrompt}>
              {line}
            </div>
          );
        })}
      </div>
      <div className={styles.eraSlots}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className={`${styles.eraSlot} ${landed[i] ? `${styles.landed} ${styles[cls]}` : styles.spinning}`}
          >
            {landed[i] ? (
              <span>{eraLabel}</span>
            ) : (
              <div className={styles.reel}>
                <span className={styles['era-8']}>8-BIT</span>
                <span className={styles['era-16']}>16-BIT</span>
                <span className={styles['era-32']}>32-BIT</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================================================
   RevealedScreen — pixel-by-pixel build, then swap to live SVG
   Timings preserved EXACTLY from the legacy file:
     - Build starts at t=80ms
     - Per-pixel delay: 22ms (32-bit) / 28ms (8/16-bit)
     - SVG swap-in at buildStart + totalCells * perPixelDelay + 200ms
   ============================================================ */
function RevealedScreen({
  game,
  rollsLeft,
  isLocked,
  onCommit,
  onToggleLock,
  onRollAgain,
}: {
  game: PoolGame;
  rollsLeft: number;
  isLocked: boolean;
  onCommit: () => void;
  onToggleLock: () => void;
  onRollAgain: () => void;
}) {
  const [rows, cols] = game.grid;
  const totalCells = rows * cols;
  const [arrangement, setArrangement] = useState<string[]>([]);
  const [litMap, setLitMap] = useState<boolean[]>(() => new Array(totalCells).fill(false));
  const [swapped, setSwapped] = useState(false);
  const cls = eraClass(game.era);
  const committedRef = useRef(false);

  // Fetch SVG arrangement, then drive the pixel-by-pixel build
  useEffect(() => {
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    (async () => {
      const cells = await fetchSvgArrangement(svgPath(game.tokenId));
      if (cancelled) return;
      const arr = cells.length === totalCells ? cells : new Array(totalCells).fill('#000');
      setArrangement(arr);

      // Random reveal order
      const indices = Array.from({ length: totalCells }, (_, i) => i);
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }

      const perPixelDelay = totalCells > 16 ? 22 : 28;
      const buildStart = 80;

      indices.forEach((cellIdx, order) => {
        timers.push(
          setTimeout(() => {
            if (cancelled) return;
            setLitMap((prev) => {
              const next = prev.slice();
              next[cellIdx] = true;
              return next;
            });
          }, buildStart + order * perPixelDelay)
        );
      });

      // Swap to real animated SVG after build completes
      const buildDuration = buildStart + totalCells * perPixelDelay + 200;
      timers.push(
        setTimeout(() => {
          if (cancelled) return;
          setSwapped(true);
        }, buildDuration)
      );

      // Commit the roll into the session a beat after the swap
      timers.push(
        setTimeout(() => {
          if (cancelled || committedRef.current) return;
          committedRef.current = true;
          onCommit();
        }, buildDuration + 200)
      );
    })();

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.tokenId]);

  const sizeTag =
    game.era === '32-bit' ? (
      <span className={`${styles.eraSizeTag} ${styles.lottery}`}>★ SIZE LOTTERY · 4× BIGGER ★</span>
    ) : game.era === '16-bit' ? (
      <span className={`${styles.eraSizeTag} ${styles.lottery}`}>★ SIZE LOTTERY · 2× BIGGER ★</span>
    ) : (
      <span className={styles.eraSizeTag}>STANDARD SIZE</span>
    );

  return (
    <div className={styles.revealedScreen}>
      <div className={styles.paintingSide}>
        <div className={styles.eraBannerRow}>
          <div className={`${styles.eraBanner} ${styles[cls]}`}>{game.era.toUpperCase()}</div>
          {sizeTag}
        </div>
        <div className={styles.revealGridWrap}>
          {swapped ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className={`${styles.revealSvg} ${styles[cls]}`}
              src={svgPath(game.tokenId)}
              alt={game.trait}
            />
          ) : (
            <div className={`${styles.pixelGrid} ${styles[cls]}`}>
              {Array.from({ length: totalCells }).map((_, i) => (
                <span
                  key={i}
                  className={`${styles.pixel} ${litMap[i] ? styles.lit : ''}`}
                  style={litMap[i] && arrangement[i] ? { background: arrangement[i] } : undefined}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className={styles.infoSide}>
        <div className={styles.gameTrait}>
          ★ {game.wildpixel ? 'WILD PIXEL' : game.trait.toUpperCase()} ★
        </div>
        <div className={styles.gameFinalTitle}>{game.finalTitle}</div>
        <div className={styles.gameYear}>
          {game.era.toUpperCase()} · {game.year}
        </div>
        <div className={styles.revealActions}>
          <button
            className={`${styles.coinBtn} ${styles.lock} ${isLocked ? styles.locked : ''}`}
            onClick={onToggleLock}
          >
            {isLocked ? '✓ LOCKED IN' : 'LOCK IT IN ▶'}
          </button>
          <button
            className={`${styles.coinBtn} ${styles.ghost}`}
            onClick={onRollAgain}
            disabled={rollsLeft <= 0}
          >
            {rollsLeft <= 0 ? 'NO ROLLS LEFT' : 'ROLL AGAIN ▶'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Tray — N slots, filled or empty
   ============================================================ */
function Tray({
  rolls,
  totalRolls,
  activeIdx,
  phase,
  onToggleLock,
}: {
  rolls: Roll[];
  totalRolls: number;
  activeIdx: number | null;
  phase: Phase;
  onToggleLock: (i: number) => void;
}) {
  return (
    <section className={styles.tray}>
      <div className={styles.trayHead}>
        <div className={styles.trayLabel}>▼ YOUR ROLLS ▼</div>
        <div className={styles.trayHint}>
          TAP ANY ROLL TO <span className={styles.trayHl}>TOGGLE LOCK</span>
        </div>
      </div>
      <div className={styles.traySlots}>
        {Array.from({ length: totalRolls }).map((_, i) => {
          if (i < rolls.length) {
            const r = rolls[i];
            const cls = eraClass(r.game.era);
            return (
              <div
                key={i}
                className={`${styles.traySlot} ${styles.filled} ${r.locked ? styles.locked : ''} ${activeIdx === i ? styles.active : ''}`}
                onClick={() => onToggleLock(i)}
              >
                <div className={`${styles.trayEraTag} ${styles[cls]}`}>{r.game.era.toUpperCase()}</div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className={`${styles.trayThumbSvg} ${styles[cls]}`}
                  src={svgPath(r.game.tokenId)}
                  alt={r.game.trait}
                />
                <div className={styles.traySlotMeta}>
                  <div className={styles.traySlotTitle}>
                    {r.game.wildpixel ? 'WILD PIXEL' : r.game.trait.toUpperCase()}
                  </div>
                  <div className={styles.traySlotStatus}>{r.locked ? '● LOCKED' : '○ HELD'}</div>
                </div>
              </div>
            );
          }
          const isNext = i === rolls.length && (phase === 'idle' || phase === 'revealed');
          return (
            <div key={i} className={`${styles.traySlot} ${styles.empty} ${isNext ? styles.next : ''}`}>
              <div className={styles.emptyNum}>{isNext ? '▶ NEXT ROLL' : `ROLL ${i + 1}`}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ============================================================
   CommitBar — sticky bottom, slides up when any locked
   ============================================================ */
function CommitBar({
  lockedCount,
  anyRolls,
  onMint,
}: {
  lockedCount: number;
  anyRolls: boolean;
  onMint: () => void;
}) {
  const active = anyRolls && lockedCount > 0;
  const price = (lockedCount * MINT_PRICE).toFixed(2);
  return (
    <section className={`${styles.commitBar} ${active ? styles.commitActive : ''}`}>
      <div className={styles.commitSummary}>
        READY TO MINT <span className={styles.countPulse}>{lockedCount}</span> LOCKED WORK
        {lockedCount !== 1 && 'S'}
        <span className={styles.price}>{price} ETH</span>
      </div>
      <button className={styles.mintBtn} onClick={onMint} disabled={lockedCount === 0}>
        MINT ALL LOCKED ▶
      </button>
    </section>
  );
}

/* ============================================================
   SuccessOverlay — shown after mint
   ============================================================ */
function SuccessOverlay({ count, txHash }: { count: number; txHash: string }) {
  return (
    <div className={`${styles.successOverlay} ${styles.successShow}`}>
      <div className={styles.successContent}>
        <div className={styles.successTitle}>★ MINT COMPLETE ★</div>
        <div className={styles.successSub}>
          <span className={styles.successHl}>{count}</span> WORK{count !== 1 && 'S'} NOW IN YOUR WALLET<br />
          ROLL HASH: <span className={styles.successHash}>{txHash}</span><br />
          <br />
          <span className={styles.successNext}>★ NEXT · CLAIM PHYSICALS? ★</span>
        </div>
        <div className={styles.successActions}>
          <Link href="/mint" className={`${styles.coinBtn} ${styles.ghost}`}>SKIP · ROLL AGAIN</Link>
          <Link href="/my-mints" className={styles.coinBtn}>CLAIM PHYSICALS ▶</Link>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   ConnectedRollsBadge — shows "★ N ROLLS REMAINING ★" only when wallet is connected
   Tier name lookup wires in session 4b once the backend can resolve
   address → tier from the proofs.json + signed allowance.
   ============================================================ */
function ConnectedRollsBadge({ rollsLeft }: { rollsLeft: number }) {
  const { isConnected } = useAccount();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // Hide during SSR + before connection — avoids hydration mismatch and
  // also doesn't display a roll allowance for non-connected visitors.
  if (!mounted || !isConnected) return null;
  return (
    <span className={styles.tierBadge}>
      ★ {rollsLeft} ROLL{rollsLeft !== 1 ? 'S' : ''} REMAINING ★
    </span>
  );
}
