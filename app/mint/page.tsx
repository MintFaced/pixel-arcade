'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useAccount, useChainId, useSwitchChain, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { ACTIVE_CHAIN_ID, ACTIVE_CHAIN_NAME, txUrl } from '../lib/wagmiConfig';
import { decodeErrorResult, type Hex } from 'viem';

import { POOL, MINT_PRICE, POOL_TOTAL, svgPath, eraClass, type PoolGame } from '../lib/pool';
import { fetchSvgArrangement } from '../lib/svgArrangement';
import { useUserTier } from '../lib/useUserTier';
import { useSiweLogin } from '../lib/useSiweLogin';
import {
  requestRoll, lockRoll, releaseRoll, getMintAuthorization, getSession,
  type SignedMintAuthorization, ApiError,
} from '../lib/api';
import { pixelArcadeAbi, PIXEL_ARCADE_ADDRESS } from '../lib/abi';
import CrtPowerOn from '../components/CrtPowerOn';
import { WalletStatus } from '../components/WalletStatus';
import styles from './page.module.css';

/* ============================================================
 * /mint — PixelArcade roll & mint flow.
 *
 * Real backend wiring (replaces the prior demo flow):
 *   1. "Connect & Play" — single button that runs Connect → SIWE → Roll
 *   2. Roll calls /api/roll → server picks random token, creates 15-min Redis hold
 *   3. Lock calls /api/lock → marks the hold as locked (won't auto-release)
 *   4. Mint calls /api/mint-authorization → gets EIP-712 signed payload, then
 *      sends an on-chain batchMint() tx via wagmi
 *   5. On success, navigates to /my-mints
 *
 * Animation choreography preserved exactly from the prior version. The
 * server provides the token ID; the animations use that token's metadata
 * from the local POOL constant.
 * ============================================================ */

/** Three top-level UI phases driving the central stage area. */
type Phase = 'idle' | 'rolling' | 'revealed';

/** A roll that has been committed to the user's session — backend has a hold. */
interface Roll {
  game: PoolGame;
  /** True when the user has explicitly locked this roll (server-side lock). */
  locked: boolean;
  /** Server-issued expiry for the hold (Unix ms) — for display only. */
  expiresAt: number;
  /** Local animation seed — keeps the reveal stable on re-render. */
  seed: number;
}

/** Mint flow phases — distinct from UI phases since they overlap. */
type MintFlow =
  | { kind: 'idle' }
  | { kind: 'authorizing' }                        // calling /api/mint-authorization
  | { kind: 'signing'; signed: SignedMintAuthorization }   // waiting for user wallet signature
  | { kind: 'sending'; signed: SignedMintAuthorization }   // tx submitted, awaiting receipt
  | { kind: 'success'; txHash: Hex; tokenIds: number[] }
  | { kind: 'error'; message: string; revertName?: string };

/* ============================================================
 * Utility helpers
 * ============================================================ */

function randomHex(n: number): string {
  const chars = '0123456789abcdef';
  let s = '';
  for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * 16)];
  return s;
}

/** Look up game metadata by tokenId — used to drive animations from server data. */
function gameFromTokenId(tokenId: number): PoolGame | undefined {
  return POOL.find((g) => g.tokenId === tokenId);
}

/** Decode a custom-error revert into a friendly name. Returns null if not decodable. */
function decodeRevert(data: Hex | undefined): string | null {
  if (!data) return null;
  try {
    const decoded = decodeErrorResult({ abi: pixelArcadeAbi, data });
    return decoded.errorName;
  } catch {
    return null;
  }
}

/* ============================================================
 * Main page
 * ============================================================ */

export default function MintPage() {
  // === Wallet + chain state ===
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { openConnectModal } = useConnectModal();
  const isOnActiveChain = chainId === ACTIVE_CHAIN_ID;

  // === Authentication (SIWE) ===
  const { login: siweLogin, checkAuthed, signing: siweSigning } = useSiweLogin();
  const [isAuthed, setIsAuthed] = useState(false);

  // === Roll session state ===
  const [phase, setPhase] = useState<Phase>('idle');
  const [rolls, setRolls] = useState<Roll[]>([]);
  const [activeRollIdx, setActiveRollIdx] = useState<number | null>(null);
  const [currentGame, setCurrentGame] = useState<PoolGame | null>(null);
  const [currentTokenId, setCurrentTokenId] = useState<number | null>(null);

  /** Server-reported rolls remaining (authoritative once authed). */
  const [serverRollsRemaining, setServerRollsRemaining] = useState<number | null>(null);

  // === Mint flow state ===
  const [mintFlow, setMintFlow] = useState<MintFlow>({ kind: 'idle' });

  // === UI bits ===
  const [toast, setToast] = useState<string | null>(null);

  // === Tier (still useful for showing roll allowance pre-auth) ===
  const { rollsPerDay: localRollsPerDay } = useUserTier();
  const totalRolls = serverRollsRemaining !== null
    ? serverRollsRemaining + rolls.length
    : localRollsPerDay;
  const rollsUsed = rolls.length;
  const rollsLeft = Math.max(0, totalRolls - rollsUsed);
  const poolRemaining = Math.max(0, POOL_TOTAL - rolls.length);  // TODO: read from server for accuracy
  const lockedCount = rolls.filter((r) => r.locked).length;
  const allRollsUsed = rollsUsed >= totalRolls && totalRolls > 0;

  // === Toast auto-clear ===
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  /* ----------------------------------------------------------
   * Session restore on page load.
   *
   * If the user has a valid SIWE cookie from a prior visit, /api/session
   * returns their address + active holds. Rebuild the local rolls array
   * from those holds so the user sees their session state without having
   * to re-roll.
   * ---------------------------------------------------------- */
  useEffect(() => {
    if (!isConnected || !address) return;
    let cancelled = false;
    (async () => {
      try {
        const session = await getSession();
        if (cancelled) return;
        // Confirm the session matches the connected wallet
        if (session.address.toLowerCase() !== address.toLowerCase()) {
          setIsAuthed(false);
          return;
        }
        setIsAuthed(true);
        setServerRollsRemaining(session.rollsRemaining);
        // Rebuild rolls from holds
        const restored: Roll[] = [];
        for (const h of session.holds) {
          const game = gameFromTokenId(h.tokenId);
          if (game) {
            restored.push({
              game,
              locked: h.locked,
              expiresAt: h.expiresAt,
              seed: Math.floor(Math.random() * 1e6),
            });
          }
        }
        setRolls(restored);
      } catch {
        // Not authed — that's fine, user will sign in via "Connect & Play"
        if (!cancelled) setIsAuthed(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isConnected, address]);

  /* ----------------------------------------------------------
   * Connect & Play — one button, three states
   *
   * Handles whatever state the user is in:
   *   - Disconnected → open wallet connect modal, return (user will click again)
   *   - Wrong chain → switch to Sepolia
   *   - Connected but not authed → trigger SIWE
   *   - Connected + authed → roll
   *
   * Designed as resumable: each click advances one step. If the user cancels
   * a popup, no state is lost — the next click picks up where they left off.
   * ---------------------------------------------------------- */
  const connectAndPlay = useCallback(async () => {
    // Step 1: ensure connection
    if (!isConnected) {
      openConnectModal?.();
      return; // user will click again after connecting
    }

    // Step 2: ensure correct chain
    if (!isOnActiveChain) {
      try {
        await switchChainAsync({ chainId: ACTIVE_CHAIN_ID });
      } catch {
        setToast(`★ PLEASE SWITCH TO ${ACTIVE_CHAIN_NAME.toUpperCase()} ★`);
        return;
      }
    }

    // Step 3: ensure authed
    if (!isAuthed) {
      const result = await siweLogin();
      if (!result) {
        // User rejected, or backend rejected — toast and bail
        setToast('★ SIGN IN CANCELLED ★');
        return;
      }
      setIsAuthed(true);
      // Fall through to roll (no need for user to click again)
    }

    // Step 4: roll
    await doRoll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, isOnActiveChain, isAuthed, openConnectModal, switchChainAsync, siweLogin]);

  /* ----------------------------------------------------------
   * doRoll — calls /api/roll, kicks off the rolling animation
   *
   * Server picks the token. We look it up in the local POOL for animation
   * metadata. If the user has no rolls left or pool is empty, surface
   * via toast.
   * ---------------------------------------------------------- */
  const doRoll = useCallback(async () => {
    if (phase === 'rolling') return; // ignore double-clicks

    try {
      const result = await requestRoll();
      const game = gameFromTokenId(result.tokenId);
      if (!game) {
        setToast(`★ UNKNOWN TOKEN #${result.tokenId} ★`);
        return;
      }
      setServerRollsRemaining(result.rollsRemaining);
      setCurrentGame(game);
      setCurrentTokenId(result.tokenId);
      setPhase('rolling');
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setToast('★ SESSION EXPIRED · SIGN IN AGAIN ★');
          setIsAuthed(false);
        } else if (err.status === 403) {
          setToast('★ NO ROLLS REMAINING ★');
        } else if (err.status === 409) {
          setToast('★ POOL EXHAUSTED ★');
        } else {
          setToast(`★ ROLL FAILED · ${err.message.toUpperCase()} ★`);
        }
      } else {
        setToast('★ ROLL FAILED · NETWORK ★');
      }
    }
  }, [phase]);

  /* ----------------------------------------------------------
   * Rolling animation finished → revealed phase
   * Revealed phase commits the roll into the session and locks it server-side
   * ---------------------------------------------------------- */
  const onRollingDone = useCallback(() => {
    setPhase('revealed');
  }, []);

  const onRevealCommit = useCallback(async () => {
    if (!currentGame || currentTokenId === null) return;

    // Add the roll to local state with locked=true (auto-lock after reveal)
    // and call /api/lock server-side so the lock persists across page reloads.
    setRolls((prev) => {
      const next: Roll[] = [
        ...prev,
        {
          game: currentGame,
          locked: true,
          expiresAt: Date.now() + 15 * 60 * 1000,  // 15 min, will be overwritten
          seed: Math.floor(Math.random() * 1e6),
        },
      ];
      setActiveRollIdx(next.length - 1);
      return next;
    });

    // Fire-and-forget the server lock — UI shows locked optimistically
    try {
      const result = await lockRoll(currentTokenId);
      // Update the expiresAt with the server's authoritative value
      setRolls((prev) => prev.map((r) =>
        r.game.tokenId === currentTokenId ? { ...r, expiresAt: result.expiresAt } : r
      ));
    } catch (err) {
      // If lock fails the hold is still active but won't survive walk-away.
      // Surface this so the user can manually retry.
      const message = err instanceof Error ? err.message : 'Lock failed';
      setToast(`★ LOCK FAILED · ${message.toUpperCase()} ★`);
    }
  }, [currentGame, currentTokenId]);

  /* ----------------------------------------------------------
   * Toggle lock on a roll
   *
   * Locked → Unlocked: server release. Hold goes back to 15-min TTL.
   * Unlocked → Locked: server lock. Hold persists.
   * Optimistic UI — assume success, revert on error.
   * ---------------------------------------------------------- */
  const toggleLock = useCallback(async (idx: number) => {
    const target = rolls[idx];
    if (!target) return;

    const nextLocked = !target.locked;

    // Optimistic update
    setRolls((prev) => prev.map((r, i) => i === idx ? { ...r, locked: nextLocked } : r));

    try {
      if (nextLocked) {
        const result = await lockRoll(target.game.tokenId);
        setRolls((prev) => prev.map((r, i) =>
          i === idx ? { ...r, expiresAt: result.expiresAt } : r
        ));
      } else {
        await releaseRoll(target.game.tokenId);
      }
    } catch (err) {
      // Revert
      setRolls((prev) => prev.map((r, i) => i === idx ? { ...r, locked: !nextLocked } : r));
      const message = err instanceof Error ? err.message : 'Toggle failed';
      setToast(`★ ${message.toUpperCase()} ★`);
    }
  }, [rolls]);

  /* ----------------------------------------------------------
   * Mint flow — the real on-chain version
   *
   * Steps:
   *   1. Filter locked rolls, get their tokenIds
   *   2. Call /api/mint-authorization to get a signed EIP-712 payload
   *   3. Send the batchMint() transaction via wagmi
   *   4. Wait for receipt
   *   5. Handle reverts (AlreadyMinted etc.) with specific UX
   *   6. On success, navigate to /my-mints
   * ---------------------------------------------------------- */
  const { writeContractAsync } = useWriteContract();

  // Stores the in-flight tx hash so useWaitForTransactionReceipt can track it
  const [pendingTxHash, setPendingTxHash] = useState<Hex | null>(null);
  const { data: txReceipt, isSuccess: txSuccess, isError: txError, error: txErrorObj } =
    useWaitForTransactionReceipt({
      hash: pendingTxHash ?? undefined,
      chainId: ACTIVE_CHAIN_ID,
    });

  // Hand-off after tx confirmation
  useEffect(() => {
    if (txSuccess && txReceipt && mintFlow.kind === 'sending') {
      setMintFlow({
        kind: 'success',
        txHash: txReceipt.transactionHash,
        tokenIds: mintFlow.signed.message.tokenIds.map((s) => parseInt(s, 10)),
      });
    } else if (txError && mintFlow.kind === 'sending') {
      const msg = txErrorObj instanceof Error ? txErrorObj.message : 'Transaction failed';
      // Look for a revert name in the error
      const revertMatch = /reverted with the following reason:\s*(\w+)/i.exec(msg);
      setMintFlow({
        kind: 'error',
        message: msg,
        revertName: revertMatch?.[1],
      });
    }
  }, [txSuccess, txError, txReceipt, txErrorObj, mintFlow]);

  const handleMint = useCallback(async () => {
    const locked = rolls.filter((r) => r.locked);
    if (locked.length === 0) return;
    const tokenIds = locked.map((r) => r.game.tokenId);

    // Step 1: get authorization
    setMintFlow({ kind: 'authorizing' });
    let signed: SignedMintAuthorization;
    try {
      signed = await getMintAuthorization(tokenIds);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Authorization failed';
      setMintFlow({ kind: 'error', message });
      return;
    }

    setMintFlow({ kind: 'signing', signed });

    // Step 2: send the tx
    let txHash: Hex;
    try {
      txHash = await writeContractAsync({
        address: PIXEL_ARCADE_ADDRESS,
        abi: pixelArcadeAbi,
        functionName: 'batchMint',
        args: [
          {
            collector: signed.message.collector,
            tokenIds: signed.message.tokenIds.map((s) => BigInt(s)),
            totalPrice: BigInt(signed.message.totalPrice),
            deadline: BigInt(signed.message.deadline),
            nonce: signed.message.nonce,
          },
          signed.signature,
        ],
        value: BigInt(signed.message.totalPrice),
        chainId: ACTIVE_CHAIN_ID,
      });
    } catch (err) {
      // User rejected, or wallet failed to send
      const msg = err instanceof Error ? err.message : 'Send failed';
      if (msg.toLowerCase().includes('reject') || msg.toLowerCase().includes('denied')) {
        setMintFlow({ kind: 'idle' });  // user rejected — silent return to idle
      } else {
        // Try to decode any custom error data
        const errData = (err as { data?: Hex; cause?: { data?: Hex } })?.data
          ?? (err as { cause?: { data?: Hex } })?.cause?.data;
        const revertName = decodeRevert(errData) ?? undefined;
        setMintFlow({ kind: 'error', message: msg, revertName });
      }
      return;
    }

    setPendingTxHash(txHash);
    setMintFlow({ kind: 'sending', signed });
  }, [rolls, writeContractAsync]);

  // Navigate to /my-mints on success after a short delay (lets the user see the confirmation)
  useEffect(() => {
    if (mintFlow.kind !== 'success') return;
    const tokenIds = mintFlow.tokenIds;
    const txHash = mintFlow.txHash;
    // Stash payload for my-mints hand-off
    try {
      sessionStorage.setItem('pixelarcade_post_mint_claim', JSON.stringify({
        tokenIds,
        mintedAt: Date.now(),
        txHash,
      }));
    } catch {
      // sessionStorage may be unavailable; non-fatal
    }
  }, [mintFlow]);

  /* ----------------------------------------------------------
   * Stage content (idle / rolling / revealed)
   * ---------------------------------------------------------- */
  let stageContent: React.ReactNode = null;
  if (phase === 'idle') {
    stageContent = (
      <IdleScreen
        isFirst={rollsUsed === 0}
        allUsed={allRollsUsed}
        rollsLeft={rollsLeft}
        rollsCount={rolls.length}
        onStart={connectAndPlay}
        isConnected={isConnected}
        isAuthed={isAuthed}
        siweSigning={siweSigning}
        isOnActiveChain={isOnActiveChain}
      />
    );
  } else if (phase === 'rolling' && currentGame) {
    stageContent = <RollingScreen game={currentGame} onDone={onRollingDone} />;
  } else if (phase === 'revealed' && currentGame) {
    stageContent = (
      <RevealedScreen
        game={currentGame}
        rollsLeft={rollsLeft}
        isLocked={activeRollIdx !== null && rolls[activeRollIdx] ? rolls[activeRollIdx].locked : true}
        onCommit={onRevealCommit}
        onToggleLock={() => {
          if (activeRollIdx !== null) toggleLock(activeRollIdx);
        }}
        onRollAgain={() => {
          setPhase('idle');
          void doRoll();
        }}
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
          <ConnectedRollsBadge rollsLeft={rollsLeft} isAuthed={isAuthed} />
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
          <div className={`${styles.hudValue} ${styles.magenta}`}>
            {isAuthed ? 'ACTIVE' : 'WAITING'}
          </div>
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
        ★ WALK AWAY = UNLOCKED ROLLS RELEASED TO POOL · FIRST TO MINT WINS ★
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
        mintFlow={mintFlow}
      />

      {toast && <div className={`${styles.toast} ${styles.toastShow}`}>{toast}</div>}

      {mintFlow.kind === 'success' && (
        <SuccessOverlay count={mintFlow.tokenIds.length} txHash={mintFlow.txHash} />
      )}

      {mintFlow.kind === 'error' && (
        <ErrorOverlay
          message={mintFlow.message}
          revertName={mintFlow.revertName}
          onDismiss={() => setMintFlow({ kind: 'idle' })}
        />
      )}
    </>
  );
}

/* ============================================================
 * IdleScreen — insert-coin or all-rolls-used review
 * Now aware of connection / auth state for clearer labels
 * ============================================================ */

function IdleScreen({
  isFirst, allUsed, rollsLeft, rollsCount, onStart,
  isConnected, isAuthed, siweSigning, isOnActiveChain,
}: {
  isFirst: boolean;
  allUsed: boolean;
  rollsLeft: number;
  rollsCount: number;
  onStart: () => void;
  isConnected: boolean;
  isAuthed: boolean;
  siweSigning: boolean;
  isOnActiveChain: boolean;
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

  // Determine the button label from current state
  let buttonLabel = 'ROLL AGAIN ▶';
  if (isFirst) {
    if (!isConnected) buttonLabel = 'CONNECT & PLAY ▶';
    else if (!isOnActiveChain) buttonLabel = `SWITCH TO ${ACTIVE_CHAIN_NAME.toUpperCase()} ▶`;
    else if (siweSigning) buttonLabel = 'SIGNING IN…';
    else if (!isAuthed) buttonLabel = 'SIGN IN & PLAY ▶';
    else buttonLabel = 'INSERT COIN ▶';
  }

  return (
    <div className={styles.idleScreen}>
      <div className={styles.idleAttract}>▼ {isFirst ? 'INSERT COIN TO BEGIN' : 'READY FOR NEXT ROLL'} ▼</div>
      <button
        className={styles.insertCoinBtn}
        onClick={onStart}
        disabled={siweSigning}
      >
        {buttonLabel}
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
 * RollingScreen — VRF type-out + 3-slot machine
 * UNCHANGED from prior version. Timings exact:
 *   - Lines type out at 400ms per line
 *   - Slot 1 lands at 1500ms
 *   - Slot 2 lands at 1800ms
 *   - Slot 3 lands at 2100ms
 *   - Rolling phase ends at 2700ms
 * ============================================================ */

function RollingScreen({ game, onDone }: { game: PoolGame; onDone: () => void }) {
  const [lines, setLines] = useState<string[]>([]);
  const [landed, setLanded] = useState<[boolean, boolean, boolean]>([false, false, false]);

  const allLines = useMemo(
    () => [
      'REQUEST CHAINLINK VRF...',
      'VERIFYING POOL STATE...',
      `COMMITMENT: 0x${randomHex(40)}`,
      'ENTROPY ACQUIRED · ROLLING...',
    ],
    []
  );

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    allLines.forEach((_, i) => {
      timers.push(setTimeout(() => setLines((prev) => [...prev, allLines[i]]), 18 + i * 400));
    });
    return () => timers.forEach(clearTimeout);
  }, [allLines]);

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
                {parts[0]}<span className={styles.vrfHex}>0x{parts[1]}</span>
              </div>
            );
          }
          return <div key={i} className={styles.vrfPrompt}>{line}</div>;
        })}
      </div>
      <div className={styles.eraSlots}>
        {[0, 1, 2].map((i) => (
          <div key={i} className={`${styles.eraSlot} ${landed[i] ? `${styles.landed} ${styles[cls]}` : styles.spinning}`}>
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
 * RevealedScreen — pixel-by-pixel build, then swap to live SVG
 * UNCHANGED from prior version. Same timings.
 * ============================================================ */

function RevealedScreen({
  game, rollsLeft, isLocked, onCommit, onToggleLock, onRollAgain,
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

  useEffect(() => {
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    (async () => {
      const cells = await fetchSvgArrangement(svgPath(game.tokenId));
      if (cancelled) return;
      const arr = cells.length === totalCells ? cells : new Array(totalCells).fill('#000');
      setArrangement(arr);

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

      const buildDuration = buildStart + totalCells * perPixelDelay + 200;
      timers.push(setTimeout(() => { if (!cancelled) setSwapped(true); }, buildDuration));
      timers.push(setTimeout(() => {
        if (cancelled || committedRef.current) return;
        committedRef.current = true;
        onCommit();
      }, buildDuration + 200));
    })();
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.tokenId]);

  const sizeTag = game.era === '32-bit'
    ? <span className={`${styles.eraSizeTag} ${styles.lottery}`}>★ SIZE LOTTERY · 4× BIGGER ★</span>
    : game.era === '16-bit'
    ? <span className={`${styles.eraSizeTag} ${styles.lottery}`}>★ SIZE LOTTERY · 2× BIGGER ★</span>
    : <span className={styles.eraSizeTag}>STANDARD SIZE</span>;

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
            <img className={`${styles.revealSvg} ${styles[cls]}`} src={svgPath(game.tokenId)} alt={game.trait} />
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
        <div className={styles.gameYear}>{game.era.toUpperCase()} · {game.year}</div>
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
 * Tray — UNCHANGED from prior version
 * ============================================================ */

function Tray({
  rolls, totalRolls, activeIdx, phase, onToggleLock,
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
                <img className={`${styles.trayThumbSvg} ${styles[cls]}`} src={svgPath(r.game.tokenId)} alt={r.game.trait} />
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
 * CommitBar — adds mint flow status indicator
 * ============================================================ */

function CommitBar({
  lockedCount, anyRolls, onMint, mintFlow,
}: {
  lockedCount: number;
  anyRolls: boolean;
  onMint: () => void;
  mintFlow: MintFlow;
}) {
  const active = anyRolls && lockedCount > 0;
  const price = (lockedCount * MINT_PRICE).toFixed(2);
  const busy = mintFlow.kind === 'authorizing' || mintFlow.kind === 'signing' || mintFlow.kind === 'sending';

  let mintLabel = 'MINT ALL LOCKED ▶';
  if (mintFlow.kind === 'authorizing') mintLabel = 'AUTHORIZING…';
  else if (mintFlow.kind === 'signing') mintLabel = 'SIGN IN WALLET…';
  else if (mintFlow.kind === 'sending') mintLabel = 'CONFIRMING ON-CHAIN…';

  return (
    <section className={`${styles.commitBar} ${active ? styles.commitActive : ''}`}>
      <div className={styles.commitSummary}>
        READY TO MINT <span className={styles.countPulse}>{lockedCount}</span> LOCKED WORK
        {lockedCount !== 1 && 'S'}
        <span className={styles.price}>{price} ETH</span>
      </div>
      <button
        className={styles.mintBtn}
        onClick={onMint}
        disabled={lockedCount === 0 || busy}
      >
        {mintLabel}
      </button>
    </section>
  );
}

/* ============================================================
 * SuccessOverlay — shown after successful on-chain mint
 * ============================================================ */

function SuccessOverlay({ count, txHash }: { count: number; txHash: string }) {
  const shortHash = `${txHash.slice(0, 10)}…${txHash.slice(-8)}`;
  return (
    <div className={`${styles.successOverlay} ${styles.successShow}`}>
      <div className={styles.successContent}>
        <div className={styles.successTitle}>★ MINT COMPLETE ★</div>
        <div className={styles.successSub}>
          <span className={styles.successHl}>{count}</span> WORK{count !== 1 && 'S'} NOW IN YOUR WALLET<br />
          TX: <a
            href={txUrl(txHash)}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.successHash}
          >
            {shortHash}
          </a><br />
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
 * ErrorOverlay — for mint failures
 *
 * Decodes the known custom errors into specific, actionable messages.
 * ============================================================ */

function ErrorOverlay({
  message, revertName, onDismiss,
}: {
  message: string;
  revertName?: string;
  onDismiss: () => void;
}) {
  let title = '★ MINT FAILED ★';
  let body = message;

  switch (revertName) {
    case 'AlreadyMinted':
      title = '★ TOO LATE ★';
      body = 'Someone else minted one of these tokens first. Release any locked rolls that got taken and try again.';
      break;
    case 'AuthExpired':
      title = '★ AUTH EXPIRED ★';
      body = 'Your mint authorization timed out (10 min). Click MINT again to get a fresh signature.';
      break;
    case 'AuthAlreadyUsed':
      title = '★ ALREADY USED ★';
      body = 'This authorization was already submitted. Refresh and try again.';
      break;
    case 'BadMsgValue':
    case 'BadTotalPrice':
      title = '★ PRICE MISMATCH ★';
      body = 'The price calculation drifted. Refresh and try again.';
      break;
    case 'BadSignature':
      title = '★ SIGNATURE FAILED ★';
      body = 'Server signature did not verify on-chain. This is a backend bug — please report.';
      break;
    case 'BadBatchSize':
      title = '★ BATCH TOO LARGE ★';
      body = 'Max 5 tokens per mint. Unlock some and try again.';
      break;
  }

  return (
    <div className={`${styles.successOverlay} ${styles.successShow}`}>
      <div className={styles.successContent}>
        <div className={styles.successTitle}>{title}</div>
        <div className={styles.successSub}>
          {body}
          {revertName && (
            <><br /><br /><span className={styles.successHash}>{revertName}</span></>
          )}
        </div>
        <div className={styles.successActions}>
          <button className={`${styles.coinBtn} ${styles.ghost}`} onClick={onDismiss}>
            DISMISS
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 * ConnectedRollsBadge — shows rolls left in the marquee
 * ============================================================ */

function ConnectedRollsBadge({ rollsLeft, isAuthed }: { rollsLeft: number; isAuthed: boolean }) {
  const { isConnected } = useAccount();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted || !isConnected || !isAuthed) return null;
  return (
    <span className={styles.tierBadge}>
      ★ {rollsLeft} ROLL{rollsLeft !== 1 ? 'S' : ''} REMAINING ★
    </span>
  );
}
