'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  useAccount, useChainId, usePublicClient, useSwitchChain,
  useWriteContract, useWaitForTransactionReceipt,
} from 'wagmi';
import { ACTIVE_CHAIN_ID, ACTIVE_CHAIN_NAME, txUrl } from '../lib/wagmiConfig';
import { decodeErrorResult, type Hex } from 'viem';

import { svgPath, eraDimensionLabel, type Era } from '../lib/pool';
import { arrange, buildInlineSvg, extractDominantColors } from '../lib/wildpixel';
import { loadCatalog, findCatalogEntry } from '../lib/catalog';
import { pixelArcadeAbi, manifoldCoreAbi, PIXEL_ARCADE_ADDRESS, MANIFOLD_CORE_ADDRESS } from '../lib/abi';
import { ConnectedUserBadge } from '../components/UserBadge';
import { WalletStatus } from '../components/WalletStatus';
import { ShippingForm } from '../components/ShippingForm';
import styles from './page.module.css';

/* ============================================================
 * /my-mints — collector dashboard.
 *
 * Real on-chain claim flow (replaces the prior demo checkout):
 *   1. User selects works → clicks "CONFIRM ORDER"
 *   2. Frontend reads `previewClaimCost(tokenIds)` from the contract for the exact price
 *   3. Frontend calls `claimPhysical(tokenIds, { value: cost })` via wagmi
 *   4. Waits for receipt
 *   5. Only AFTER on-chain confirmation, swaps drawer to ShippingForm
 *   6. ShippingForm sends shipping details to backend + email
 *
 * The previous version used a Math.random() tx hash and skipped the on-chain
 * call entirely — collectors could submit shipping for free. Fixed by
 * actually requiring the chain to confirm payment first.
 * ============================================================ */

/* ============================================================
 * Domain types
 * ============================================================ */

type WorkStatus = 'minted' | 'awaiting-palette';
type FilterKey = 'all' | '8-bit' | '16-bit' | '32-bit' | 'wildpixel';

interface Work {
  id: string;
  tokenId: number;
  trait: string | null;
  finalTitle: string;
  era: Era;
  year: number | null;
  grid: [number, number];
  status: WorkStatus;
  physical: boolean;
  wildpixel: boolean;
  completedCells?: string[];
}

interface PostMintPayload {
  tokenIds: number[];
  mintedAt: number;
  txHash: string;
}

interface WildpixelModalState {
  workId: string;
  step: 1 | 2 | 3 | 4;
  extracted: { dataURL: string; colors: string[] } | null;
  arrangementSeed: number;
  rerollsLeft: number;
  trait: string;
}

/** Claim flow state — distinct from drawer open/closed state */
type ClaimFlow =
  | { kind: 'idle' }
  | { kind: 'pricing'; tokenIds: number[] }       // calling previewClaimCost
  | { kind: 'signing'; tokenIds: number[]; cost: bigint }   // wallet popup open
  | { kind: 'confirming'; tokenIds: number[]; txHash: Hex } // on-chain pending
  | { kind: 'paid'; tokenIds: number[]; txHash: Hex }       // tx confirmed, ready for shipping form
  | { kind: 'error'; message: string; revertName?: string };

/** Wildpixel completion flow state — drives the modal's step-4 status display */
type WildpixelFlow =
  | { kind: 'idle' }
  | { kind: 'pinning'; tokenId: number }                                  // POSTing to /api/wildpixel/complete
  | { kind: 'signing'; tokenId: number; metadataURI: string }             // wallet popup open
  | { kind: 'confirming'; tokenId: number; metadataURI: string; txHash: Hex }
  | { kind: 'done'; tokenId: number; metadataURI: string; txHash: Hex }
  | { kind: 'error'; tokenId: number; message: string; revertName?: string };

/* ============================================================
 * Local price hints — DISPLAY ONLY
 * Real price comes from contract.previewClaimCost(). These values
 * match the deployed contract's physicalPrice() and shippingFee()
 * for accurate UI preview before the user clicks Confirm Order.
 *
 * From the contract:
 *   physicalPrice[8-bit]  = 0.50 ETH
 *   physicalPrice[16-bit] = 0.75 ETH
 *   physicalPrice[32-bit] = 1.25 ETH
 *   shippingFee           = 0.25 ETH (added once if n < bundleThreshold)
 *   bundleThreshold       = 5 (claim 5+ tokens = no shipping fee)
 * ============================================================ */

const PRICES_HINT: Record<Era, number> = {
  '8-bit':  0.50,
  '16-bit': 0.75,
  '32-bit': 1.25,
};
const SHIPPING_FEE = 0.25;
const BUNDLE_THRESHOLD = 5;

function eraToClass(era: Era): 'era-8' | 'era-16' | 'era-32' {
  return `era-${era.split('-')[0]}` as 'era-8' | 'era-16' | 'era-32';
}

/** Decode a custom-error revert into a friendly name. */
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
 * Main page component
 * ============================================================ */

export default function MyMintsPage() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient({ chainId: ACTIVE_CHAIN_ID });
  const isOnActiveChain = chainId === ACTIVE_CHAIN_ID;

  const [works, setWorks] = useState<Work[]>([]);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [modal, setModal] = useState<WildpixelModalState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ count: number; txHash: string } | null>(null);

  /** Claim flow state — drives the drawer's behavior */
  const [claimFlow, setClaimFlow] = useState<ClaimFlow>({ kind: 'idle' });

  /** Wildpixel completion flow state — drives the modal's status display */
  const [wildpixelFlow, setWildpixelFlow] = useState<WildpixelFlow>({ kind: 'idle' });

  /* ESC handler */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (drawerOpen) closeDrawer();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  /* Toast lifecycle */
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  /* Banner lifecycle */
  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 12000);
    return () => clearTimeout(t);
  }, [banner]);

  /** Loading state for chain-read */
  const [isLoadingMints, setIsLoadingMints] = useState(false);

  /* Post-mint hand-off */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let raw: string | null = null;
      try {
        raw = sessionStorage.getItem('pixelarcade_post_mint_claim');
      } catch {
        return;
      }
      if (!raw) return;
      try {
        sessionStorage.removeItem('pixelarcade_post_mint_claim');
      } catch {/* ignore */}

      let payload: PostMintPayload;
      try {
        payload = JSON.parse(raw);
      } catch {
        return;
      }
      if (!payload?.tokenIds?.length) return;

      const catalog = await loadCatalog();
      if (cancelled) return;
      if (catalog.length === 0) return;

      const newWorks: Work[] = [];
      let nextId = 1;
      const preSelect = new Set<string>();
      for (const tokenId of payload.tokenIds) {
        const entry = findCatalogEntry(catalog, tokenId);
        if (!entry) continue;
        const w: Work = {
          id: `m${nextId++}`,
          tokenId: entry.token_id,
          trait: entry.wildpixel ? null : entry.name,
          finalTitle: entry.art_title,
          era: entry.era,
          year: entry.wildpixel ? null : entry.year,
          grid: [entry.grid.rows, entry.grid.cols],
          status: entry.wildpixel ? 'awaiting-palette' : 'minted',
          physical: false,
          wildpixel: entry.wildpixel,
        };
        newWorks.push(w);
        if (!w.wildpixel) preSelect.add(w.id);
      }
      setWorks(newWorks);
      setSelected(preSelect);
      setBanner({ count: newWorks.length, txHash: payload.txHash });
      setTimeout(() => {
        if (!cancelled) setDrawerOpen(true);
      }, 800);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* ----------------------------------------------------------
   * Chain-read — load all tokens this wallet owns from the chain
   *
   * Strategy:
   *   1. Query past `Minted(tokenId, collector)` events from the extension,
   *      filtered to the connected wallet — gives us all tokens this wallet
   *      ever minted.
   *   2. For each tokenId, verify current ownership via Manifold core's
   *      `ownerOf(tokenId)` — catches any tokens that have been transferred
   *      out (sold on marketplace, sent to another wallet, etc.).
   *   3. For each verified-owned token, check `physicalClaimed(tokenId)` and
   *      `wildpixelCompleted(tokenId)` on the extension — sets the right
   *      status in the UI.
   *
   * Merging:
   *   - If the post-mint sessionStorage payload already populated works, we
   *     don't duplicate. The chain-read updates statuses (e.g. physical) on
   *     existing works and adds anything missing.
   *   - This effect runs whenever address changes — supports wallet switch
   *     and reconnect.
   * ---------------------------------------------------------- */
  useEffect(() => {
    if (!isConnected || !address || !publicClient) return;
    let cancelled = false;
    setIsLoadingMints(true);

    (async () => {
      try {
        // Find tokens this wallet owns by iterating all 64 tokens and calling
        // ownerOf on each. This is 64 RPC reads (cheap, parallel) and works on
        // any RPC tier — unlike eth_getLogs which is restricted to 10-block
        // ranges on Alchemy free tier.
        //
        // For a 64-piece collection, this is fast enough. For larger collections,
        // an indexer (Subgraph, Alchemy NFT API) would scale better.
        const TOTAL_SUPPLY = 64;
        const allTokens = Array.from({ length: TOTAL_SUPPLY }, (_, i) => i + 1);

        const ownershipChecks = await Promise.all(
          allTokens.map(async (tokenId) => {
            try {
              const owner = (await publicClient.readContract({
                address: MANIFOLD_CORE_ADDRESS,
                abi: manifoldCoreAbi,
                functionName: 'ownerOf',
                args: [BigInt(tokenId)],
              })) as `0x${string}`;
              return owner.toLowerCase() === address.toLowerCase() ? tokenId : null;
            } catch {
              // ownerOf reverts for un-minted tokens. Treat as "not owned".
              return null;
            }
          })
        );
        if (cancelled) return;

        const ownedTokenIds = ownershipChecks.filter((t): t is number => t !== null);

        if (ownedTokenIds.length === 0) {
          setIsLoadingMints(false);
          return;
        }

        // Step 3 — for each owned token, read claim + wildpixel status
        const statuses = await Promise.all(
          ownedTokenIds.map(async (tokenId) => {
            const [physical, wpCompleted] = await Promise.all([
              publicClient.readContract({
                address: PIXEL_ARCADE_ADDRESS,
                abi: pixelArcadeAbi,
                functionName: 'physicalClaimed',
                args: [BigInt(tokenId)],
              }).catch(() => false) as Promise<boolean>,
              publicClient.readContract({
                address: PIXEL_ARCADE_ADDRESS,
                abi: pixelArcadeAbi,
                functionName: 'wildpixelCompleted',
                args: [BigInt(tokenId)],
              }).catch(() => false) as Promise<boolean>,
            ]);
            return { tokenId, physical, wpCompleted };
          })
        );
        if (cancelled) return;

        // Step 4 — build Work objects from catalog
        const catalog = await loadCatalog();
        if (cancelled || catalog.length === 0) {
          setIsLoadingMints(false);
          return;
        }

        // Merge with existing works (from sessionStorage handoff)
        setWorks((prevWorks) => {
          const byTokenId = new Map<number, Work>();
          // Start with existing works keyed by tokenId
          for (const w of prevWorks) {
            byTokenId.set(w.tokenId, w);
          }

          // Build / update from chain data
          let nextId = prevWorks.length + 1;
          for (const { tokenId, physical, wpCompleted } of statuses) {
            const existing = byTokenId.get(tokenId);
            if (existing) {
              // Already have it from sessionStorage — enrich with chain status
              byTokenId.set(tokenId, {
                ...existing,
                physical,
                status: existing.wildpixel && !wpCompleted ? 'awaiting-palette' : 'minted',
              });
            } else {
              // New from chain — build full Work from catalog
              const entry = findCatalogEntry(catalog, tokenId);
              if (!entry) continue;
              const isWildpixelEmpty = entry.wildpixel && !wpCompleted;
              byTokenId.set(tokenId, {
                id: `c${nextId++}`,
                tokenId: entry.token_id,
                trait: entry.wildpixel && !wpCompleted ? null : entry.name,
                finalTitle: entry.art_title,
                era: entry.era,
                year: entry.wildpixel && !wpCompleted ? null : entry.year,
                grid: [entry.grid.rows, entry.grid.cols],
                status: isWildpixelEmpty ? 'awaiting-palette' : 'minted',
                physical,
                wildpixel: entry.wildpixel,
              });
            }
          }

          // Return as array, sorted by tokenId for stable display
          return Array.from(byTokenId.values()).sort((a, b) => a.tokenId - b.tokenId);
        });

        setIsLoadingMints(false);
      } catch (err) {
        console.error('[my-mints] Chain read failed:', err);
        if (!cancelled) setIsLoadingMints(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isConnected, address, publicClient]);

  /* ----------------------------------------------------------
   * Derived state
   * ---------------------------------------------------------- */
  const stats = useMemo(() => ({
    total: works.length,
    physical: works.filter((w) => w.physical).length,
    wildpixel: works.filter((w) => w.wildpixel && w.status === 'awaiting-palette').length,
  }), [works]);

  const filteredWorks = useMemo(() => {
    if (filter === 'all') return works;
    if (filter === 'wildpixel') return works.filter((w) => w.wildpixel);
    return works.filter((w) => w.era === filter);
  }, [works, filter]);

  /* ----------------------------------------------------------
   * Selection actions (unchanged)
   * ---------------------------------------------------------- */
  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const selectAllToggle = useCallback(() => {
    const eligible = works.filter(
      (w) => !w.physical && !(w.wildpixel && w.status === 'awaiting-palette')
    );
    setSelected((prev) => {
      const allSelected = eligible.every((w) => prev.has(w.id));
      const next = new Set(prev);
      if (allSelected) {
        eligible.forEach((w) => next.delete(w.id));
      } else {
        eligible.forEach((w) => next.add(w.id));
      }
      return next;
    });
  }, [works]);

  /* ----------------------------------------------------------
   * Real claimPhysical flow
   *
   * Note: we call previewClaimCost imperatively via the public client
   * inside handleCheckout (not via useReadContract), because it's a
   * one-shot call when the user clicks the button, not a continuous
   * subscription. Imperative calls keep the React tree clean.
   * ---------------------------------------------------------- */
  const { writeContractAsync } = useWriteContract();

  // Track the pending tx for receipt watching
  const [pendingTxHash, setPendingTxHash] = useState<Hex | null>(null);
  const { data: txReceipt, isSuccess: txSuccess, isError: txError, error: txErrorObj } =
    useWaitForTransactionReceipt({
      hash: pendingTxHash ?? undefined,
      chainId: ACTIVE_CHAIN_ID,
    });

  // Transition the claim flow or wildpixel flow when tx resolves
  useEffect(() => {
    // === Claim physical tx confirmation ===
    if (txSuccess && txReceipt && claimFlow.kind === 'confirming') {
      // Mark the works as physical now that payment is confirmed on-chain
      const claimedIds = new Set(claimFlow.tokenIds);
      setWorks((prev) =>
        prev.map((w) => claimedIds.has(w.tokenId) ? { ...w, physical: true } : w)
      );
      setSelected(new Set());
      setClaimFlow({ kind: 'paid', tokenIds: claimFlow.tokenIds, txHash: txReceipt.transactionHash });
      setToast(`★ PAID ON-CHAIN · ${claimFlow.tokenIds.length} QUEUED · SHIPPING DETAILS BELOW ★`);
    } else if (txError && claimFlow.kind === 'confirming') {
      const msg = txErrorObj instanceof Error ? txErrorObj.message : 'Transaction failed';
      const revertMatch = /reverted with the following reason:\s*(\w+)/i.exec(msg);
      setClaimFlow({ kind: 'error', message: msg, revertName: revertMatch?.[1] });
    }

    // === Wildpixel completion tx confirmation ===
    if (txSuccess && txReceipt && wildpixelFlow.kind === 'confirming') {
      // Update the work — mark wildpixel as completed, store the trait + cells
      setWorks((prev) =>
        prev.map((w) =>
          w.tokenId === wildpixelFlow.tokenId
            ? { ...w, status: 'minted' as const }
            : w
        )
      );
      setWildpixelFlow({
        kind: 'done',
        tokenId: wildpixelFlow.tokenId,
        metadataURI: wildpixelFlow.metadataURI,
        txHash: txReceipt.transactionHash,
      });
      setToast(`★ WILDPIXEL #${wildpixelFlow.tokenId} COMPLETED ON-CHAIN ★`);
    } else if (txError && wildpixelFlow.kind === 'confirming') {
      const msg = txErrorObj instanceof Error ? txErrorObj.message : 'Transaction failed';
      const revertMatch = /reverted with the following reason:\s*(\w+)/i.exec(msg);
      setWildpixelFlow({
        kind: 'error',
        tokenId: wildpixelFlow.tokenId,
        message: msg,
        revertName: revertMatch?.[1],
      });
    }
  }, [txSuccess, txError, txReceipt, txErrorObj, claimFlow, wildpixelFlow]);

  /**
   * Imperative read of previewClaimCost via a one-off useReadContract call.
   *
   * We can't conditionally call a hook, so instead we render a hidden
   * component when we need the price. Simpler: we use the contract's
   * built-in pricing rules from the integration guide as a client-side
   * estimate, then refine via the actual call in the request.
   *
   * For the actual claim tx we need an exact value match — so we DO have
   * to read the contract. Approach: use refetch from a hidden read-hook.
   */
  const handleCheckout = useCallback(async () => {
    const selectedWorks = works.filter((w) => selected.has(w.id));
    if (selectedWorks.length === 0) return;

    // Validate wallet + chain
    if (!isConnected || !address) {
      setToast('★ CONNECT WALLET FIRST ★');
      return;
    }
    if (!isOnActiveChain) {
      try {
        await switchChainAsync({ chainId: ACTIVE_CHAIN_ID });
      } catch {
        setToast(`★ PLEASE SWITCH TO ${ACTIVE_CHAIN_NAME.toUpperCase()} ★`);
        return;
      }
    }

    const tokenIds = selectedWorks.map((w) => w.tokenId);
    const tokenIdsBig = tokenIds.map((n) => BigInt(n));

    // Step 1 — read previewClaimCost from contract
    setClaimFlow({ kind: 'pricing', tokenIds });

    let cost: bigint;
    try {
      if (!publicClient) {
        throw new Error(`No public client available — wallet not connected to ${ACTIVE_CHAIN_NAME}`);
      }
      cost = (await publicClient.readContract({
        address: PIXEL_ARCADE_ADDRESS,
        abi: pixelArcadeAbi,
        functionName: 'previewClaimCost',
        args: [tokenIdsBig],
      })) as bigint;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Price lookup failed';
      // Look for a revert (e.g. WildpixelNotCompleted)
      const errData = (err as { data?: Hex; cause?: { data?: Hex } })?.data
        ?? (err as { cause?: { data?: Hex } })?.cause?.data;
      const revertName = decodeRevert(errData) ?? undefined;
      setClaimFlow({ kind: 'error', message: msg, revertName });
      return;
    }

    // Step 2 — send the claimPhysical tx with the exact value
    setClaimFlow({ kind: 'signing', tokenIds, cost });

    let txHash: Hex;
    try {
      txHash = await writeContractAsync({
        address: PIXEL_ARCADE_ADDRESS,
        abi: pixelArcadeAbi,
        functionName: 'claimPhysical',
        args: [tokenIdsBig],
        value: cost,
        chainId: ACTIVE_CHAIN_ID,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Send failed';
      if (msg.toLowerCase().includes('reject') || msg.toLowerCase().includes('denied')) {
        // User rejected — silent return to idle
        setClaimFlow({ kind: 'idle' });
      } else {
        const errData = (err as { data?: Hex; cause?: { data?: Hex } })?.data
          ?? (err as { cause?: { data?: Hex } })?.cause?.data;
        const revertName = decodeRevert(errData) ?? undefined;
        setClaimFlow({ kind: 'error', message: msg, revertName });
      }
      return;
    }

    // Step 3 — wait for receipt (handled by useWaitForTransactionReceipt effect above)
    setPendingTxHash(txHash);
    setClaimFlow({ kind: 'confirming', tokenIds, txHash });
  }, [works, selected, isConnected, address, isOnActiveChain, switchChainAsync, writeContractAsync, publicClient]);

  /* ----------------------------------------------------------
   * Drawer close — also resets claim flow
   * ---------------------------------------------------------- */
  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    // If user closes mid-flow before payment, reset to idle.
    // If they've paid (kind:'paid'), the works are already marked physical
    // and the cleanup just clears the shipping form prompt — user can
    // submit shipping later via my-mints if we add that path.
    setClaimFlow({ kind: 'idle' });
    setPendingTxHash(null);
  }, []);

  /* ----------------------------------------------------------
   * Wildpixel modal (unchanged)
   * ---------------------------------------------------------- */
  const openWildpixelModal = useCallback((workId: string) => {
    setModal({
      workId,
      step: 1,
      extracted: null,
      arrangementSeed: Math.floor(Math.random() * 100000),
      rerollsLeft: 3,
      trait: '',
    });
  }, []);

  const closeWildpixelModal = useCallback(() => {
    // Only allow closing if not mid-flow. If the user has a tx in flight,
    // keep the modal open so they don't lose track.
    if (
      wildpixelFlow.kind === 'pinning' ||
      wildpixelFlow.kind === 'signing' ||
      wildpixelFlow.kind === 'confirming'
    ) {
      return;
    }
    setModal(null);
    setWildpixelFlow({ kind: 'idle' });
  }, [wildpixelFlow.kind]);

  /**
   * Real wildpixel completion — drives the full pipeline:
   *   1. POST /api/wildpixel/complete with cells + trait → backend pins to IPFS
   *   2. Returns metadataURI (ipfs://...)
   *   3. Call completeWildpixel(tokenId, metadataURI) on the extension contract
   *   4. Wait for tx receipt
   *   5. Update local UI + toast
   *
   * The previous version updated local state only and showed a misleading
   * "metadata written" toast. This version actually writes to chain.
   */
  const lockWildpixel = useCallback(async () => {
    if (!modal) return;
    if (!modal.extracted || modal.trait.trim().length === 0) return;
    const work = works.find((w) => w.id === modal.workId);
    if (!work) return;

    // Validate wallet + chain
    if (!isConnected || !address) {
      setToast('★ CONNECT WALLET FIRST ★');
      return;
    }
    if (!isOnActiveChain) {
      try {
        await switchChainAsync({ chainId: ACTIVE_CHAIN_ID });
      } catch {
        setToast(`★ PLEASE SWITCH TO ${ACTIVE_CHAIN_NAME.toUpperCase()} ★`);
        return;
      }
    }

    const [rows, cols] = work.grid;
    const cells = arrange(modal.extracted.colors, rows, cols, modal.arrangementSeed);
    const tokenId = work.tokenId;
    const trait = modal.trait.trim();

    // === Step 1: backend pinning ===
    setWildpixelFlow({ kind: 'pinning', tokenId });

    let metadataURI: string;
    try {
      const resp = await fetch('/api/wildpixel/complete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tokenId, trait, cells, rows, cols }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data?.error ?? `Server error (${resp.status})`);
      }
      if (typeof data.metadataURI !== 'string') {
        throw new Error('Server did not return metadataURI');
      }
      metadataURI = data.metadataURI;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Pinning failed';
      console.error('[wildpixel] backend pin failed:', err);
      setWildpixelFlow({ kind: 'error', tokenId, message });
      return;
    }

    // === Step 2: on-chain completeWildpixel ===
    setWildpixelFlow({ kind: 'signing', tokenId, metadataURI });

    let txHash: Hex;
    try {
      txHash = await writeContractAsync({
        address: PIXEL_ARCADE_ADDRESS,
        abi: pixelArcadeAbi,
        functionName: 'completeWildpixel',
        args: [BigInt(tokenId), metadataURI],
        chainId: ACTIVE_CHAIN_ID,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Send failed';
      console.error('[wildpixel] writeContract failed:', err);
      if (msg.toLowerCase().includes('reject') || msg.toLowerCase().includes('denied')) {
        // User rejected — silent return to idle, modal stays open so they can retry
        setWildpixelFlow({ kind: 'idle' });
      } else {
        const errData = (err as { data?: Hex; cause?: { data?: Hex } })?.data
          ?? (err as { cause?: { data?: Hex } })?.cause?.data;
        const revertName = decodeRevert(errData) ?? undefined;
        setWildpixelFlow({ kind: 'error', tokenId, message: msg, revertName });
      }
      return;
    }

    // === Step 3: persist completedCells locally so it renders post-tx ===
    setWorks((prev) =>
      prev.map((w) =>
        w.tokenId === tokenId
          ? { ...w, completedCells: cells, trait, status: w.status }
          : w
      )
    );

    // === Step 4: hand off to the receipt-watching effect ===
    setPendingTxHash(txHash);
    setWildpixelFlow({ kind: 'confirming', tokenId, metadataURI, txHash });
  }, [
    modal, works, isConnected, address, isOnActiveChain,
    switchChainAsync, writeContractAsync,
  ]);

  /** Close the wildpixel modal after a successful completion. Reset flow. */
  const closeWildpixelDone = useCallback(() => {
    setModal(null);
    setWildpixelFlow({ kind: 'idle' });
    setPendingTxHash(null);
  }, []);

  /* ----------------------------------------------------------
   * Render
   * ---------------------------------------------------------- */
  return (
    <>
      {banner && (
        <PostMintBanner
          count={banner.count}
          txHash={banner.txHash}
          onClose={() => setBanner(null)}
        />
      )}

      <div className={styles.marquee}>
        <div className={styles.marqueeTitle}>
          <span className={styles.star}>★</span>{' '}
          <Link href="/" className={styles.marqueeLink}>PIXELARCADE.ART</Link>{' '}
          <span className={styles.star}>★</span>
        </div>
        <div className={styles.marqueeStatus}>
          <span className={styles.player1}>PLAYER 1</span>
          <WalletStatus />
        </div>
      </div>

      <div className={styles.hud}>
        <div className={styles.hudCell}>
          <div className={styles.hudLabel}>MINTED</div>
          <div className={styles.hudValue}>{String(stats.total).padStart(2, '0')}</div>
        </div>
        <div className={styles.hudCell}>
          <div className={styles.hudLabel}>PHYSICAL</div>
          <div className={`${styles.hudValue} ${styles.green}`}>
            {String(stats.physical).padStart(2, '0')}
          </div>
        </div>
        <div className={styles.hudCell}>
          <div className={styles.hudLabel}>WILDPIXEL</div>
          <div className={`${styles.hudValue} ${styles.magenta}`}>
            {String(stats.wildpixel).padStart(2, '0')}
          </div>
        </div>
        <div className={styles.hudCell}>
          <ConnectedUserBadge />
        </div>
      </div>

      <section className={styles.titleBlock}>
        <div className={styles.titleEyebrow}>▼ COLLECTOR · ROOM 01 ▼</div>
        <h1 className={styles.titleH1}>
          YOUR<br />MINTS<span className={styles.blinkCursor} />
        </h1>
        <p className={styles.titleSub}>
          Your <span className={styles.hlCyan}>NFT MINTS</span> from the{' '}
          <span className={styles.hlYellow}>8-BIT · 16-BIT · 32-BIT</span> eras.<br />
          Claim <span className={styles.hlPink}>PAINTING</span> wen ready. Complete{' '}
          <span className={styles.hlPink}>WILDPIXEL</span> palettes if qualified.
        </p>
      </section>

      <div className={styles.filterStrip}>
        {(['all', '8-bit', '16-bit', '32-bit', 'wildpixel'] as FilterKey[]).map((key) => {
          const label =
            key === 'all' ? 'ALL'
              : key === 'wildpixel' ? 'WILDPIXELS'
                : key.toUpperCase();
          return (
            <button
              key={key}
              className={`${styles.filterBtn} ${filter === key ? styles.active : ''}`}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className={styles.toolbarRow}>
        <div className={styles.toolbarActions}>
          <button className={`${styles.coinBtn} ${styles.ghost}`} onClick={selectAllToggle}>
            + SELECT ALL
          </button>
          <button className={styles.coinBtn} onClick={() => setDrawerOpen(true)}>
            CLAIM PAINTING
            {selected.size > 0 && <span className={styles.coinCount}>{selected.size}</span>}
          </button>
        </div>
      </div>

      <main className={styles.gallery}>
        {works.length === 0 ? (
          isLoadingMints ? <LoadingMints /> : <EmptyState />
        ) : (
          filteredWorks.map((work) => (
            <WorkCard
              key={work.id}
              work={work}
              selected={selected.has(work.id)}
              onToggleSelect={() => toggleSelect(work.id)}
              onOpenWildpixel={() => openWildpixelModal(work.id)}
            />
          ))
        )}
      </main>

      <div className={styles.footer}>
        <div className={styles.highscore}>★ © 2026 MINTFACE.ART · 64 ARCADE PIXEL PAINTINGS ★</div>
        <div>POWERED BY ETHEREUM · MANIFOLD · CHAINLINK VRF</div>
        <div className={styles.footerStartLine}>
          PRESS <Link href="/mint" className={styles.footerStartLink}>[START]</Link> TO MINT MOAR
        </div>
      </div>

      <div
        className={`${styles.drawerBackdrop} ${drawerOpen ? styles.drawerOpen : ''}`}
        onClick={closeDrawer}
      />
      <Drawer
        open={drawerOpen}
        works={works}
        selected={selected}
        claimFlow={claimFlow}
        onClose={closeDrawer}
        onRemove={(id) => toggleSelect(id)}
        onCheckout={handleCheckout}
        onDismissError={() => setClaimFlow({ kind: 'idle' })}
      />

      {modal && (
        <WildpixelModal
          state={modal}
          work={works.find((w) => w.id === modal.workId)}
          flow={wildpixelFlow}
          onChange={setModal}
          onClose={closeWildpixelModal}
          onLock={lockWildpixel}
          onDone={closeWildpixelDone}
          onDismissError={() => setWildpixelFlow({ kind: 'idle' })}
        />
      )}

      {toast && <div className={`${styles.toast} ${styles.toastShow}`}>{toast}</div>}
    </>
  );
}

/* ============================================================
 * EmptyState
 * ============================================================ */

function EmptyState() {
  return (
    <div className={styles.emptyState}>
      <div className={styles.emptyBig}>▼ NO MINTS YET ▼</div>
      <p className={styles.emptySub}>
        Head to the <Link href="/mint" className={styles.emptyLink}>MINT ROOM</Link> to roll your first work.<br />
        Fresh mints appear here automatically.
      </p>
      <Link href="/mint" className={`${styles.coinBtn}`}>▶ START · MINT</Link>
    </div>
  );
}

/* ============================================================
 * LoadingMints — shown while chain-reading
 * ============================================================ */

function LoadingMints() {
  return (
    <div className={styles.emptyState}>
      <div className={styles.emptyBig}>▼ READING CHAIN ▼</div>
      <p className={styles.emptySub}>
        Loading your mints from the chain<span className={styles.blinkCursor} />
      </p>
    </div>
  );
}

/* ============================================================
 * PostMintBanner
 * ============================================================ */

function PostMintBanner({
  count, txHash, onClose,
}: {
  count: number; txHash: string; onClose: () => void;
}) {
  const shortHash = txHash.startsWith('0x') && txHash.length > 16
    ? `${txHash.slice(0, 10)}…${txHash.slice(-8)}`
    : txHash;
  return (
    <div className={styles.postMintBanner}>
      <div className={styles.pmbInner}>
        <span className={styles.pmbStar}>★</span>
        <span className={styles.pmbText}>
          <strong>FRESH MINT</strong> · {count} WORK{count !== 1 && 'S'} ADDED TO YOUR WALLET ·{' '}
          TX <a
            href={txUrl(txHash)}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.pmbHash}
          >
            {shortHash}
          </a> ·{' '}
          <strong>CLAIM YOUR PHYSICALS BELOW</strong>
        </span>
        <span className={styles.pmbStar}>★</span>
        <button className={styles.pmbClose} onClick={onClose} aria-label="Dismiss">×</button>
      </div>
    </div>
  );
}

/* ============================================================
 * WorkCard (unchanged)
 * ============================================================ */

function WorkCard({
  work, selected, onToggleSelect, onOpenWildpixel,
}: {
  work: Work;
  selected: boolean;
  onToggleSelect: () => void;
  onOpenWildpixel: () => void;
}) {
  const cls = eraToClass(work.era);
  const isWildpixelEmpty = work.wildpixel && work.status === 'awaiting-palette';

  let visual: React.ReactNode;
  if (work.wildpixel && work.completedCells) {
    const [rows, cols] = work.grid;
    const svgHtml = buildInlineSvg(work.completedCells, rows, cols);
    visual = (
      <div
        className={`${styles.workSvgInline} ${styles[cls]}`}
        dangerouslySetInnerHTML={{ __html: svgHtml }}
      />
    );
  } else {
    // eslint-disable-next-line @next/next/no-img-element
    visual = (
      <img
        className={`${styles.workSvg} ${styles[cls]}`}
        src={svgPath(work.tokenId)}
        alt={work.trait ?? 'Choose your own palette'}
      />
    );
  }

  let traitDisplay: React.ReactNode;
  if (isWildpixelEmpty) {
    traitDisplay = <div className={styles.workTrait}>★ WILD PIXEL ★</div>;
  } else if (work.trait) {
    traitDisplay = <div className={styles.workTrait}>★ {work.trait.toUpperCase()} ★</div>;
  } else {
    traitDisplay = <div className={`${styles.workTrait} ${styles.workTraitEmpty}`}>★ NOT YET SET ★</div>;
  }

  let statusTag: React.ReactNode;
  if (isWildpixelEmpty) {
    statusTag = <span className={`${styles.statusTag} ${styles.awaiting}`}>▶ TAP TO PLAY</span>;
  } else if (work.physical) {
    statusTag = <span className={`${styles.statusTag} ${styles.physical}`}>● PHYSICAL</span>;
  } else {
    statusTag = <span className={`${styles.statusTag} ${styles.digital}`}>○ DIGITAL ONLY</span>;
  }

  const handleCardClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest(`.${styles.workSelect}`)) return;
    if (isWildpixelEmpty) onOpenWildpixel();
  };

  const showSelect = !isWildpixelEmpty && !work.physical;

  return (
    <div
      className={`${styles.work} ${isWildpixelEmpty ? styles.wildpixelEmpty : ''} ${selected ? styles.selected : ''}`}
      onClick={handleCardClick}
    >
      <div className={styles.workCabinet}>
        {work.wildpixel && <div className={`${styles.badge} ${styles.badgeWildpixel}`}>WILDPIXEL</div>}
        {work.physical && <div className={`${styles.badge} ${styles.badgePhysical}`}>PHYSICAL</div>}
        {showSelect && (
          <button
            className={styles.workSelect}
            onClick={(e) => { e.stopPropagation(); onToggleSelect(); }}
            aria-label={selected ? 'Deselect' : 'Select'}
          >
            <span>+</span>
          </button>
        )}
        <div className={styles.workScreenBezel}>{visual}</div>
        <div className={styles.workMeta}>
          {traitDisplay}
          <div className={styles.workTitle}>{work.finalTitle}</div>
          <div className={styles.workStats}>
            <span className={styles.eraTag}>
              {work.era.toUpperCase()} {eraDimensionLabel(work.era)}
            </span>
            {statusTag}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 * Drawer — physical claim cart with real on-chain flow
 *
 * States the drawer can be in:
 *   - claimFlow.kind === 'idle' AND no selection  → empty hint
 *   - claimFlow.kind === 'idle' AND selection      → standard cart
 *   - claimFlow.kind === 'pricing'                  → "READING PRICE FROM CHAIN…"
 *   - claimFlow.kind === 'signing'                  → "SIGN IN WALLET…"
 *   - claimFlow.kind === 'confirming'               → "CONFIRMING ON-CHAIN…"
 *   - claimFlow.kind === 'paid'                     → ShippingForm
 *   - claimFlow.kind === 'error'                    → error panel
 * ============================================================ */

function Drawer({
  open, works, selected, claimFlow, onClose, onRemove, onCheckout, onDismissError,
}: {
  open: boolean;
  works: Work[];
  selected: Set<string>;
  claimFlow: ClaimFlow;
  onClose: () => void;
  onRemove: (id: string) => void;
  onCheckout: () => void;
  onDismissError: () => void;
}) {
  const selectedWorks = works.filter((w) => selected.has(w.id));
  // Sum of painting prices per the contract's physicalPrice() per era.
  const paintingsTotal = selectedWorks.reduce((s, w) => s + PRICES_HINT[w.era], 0);
  // Shipping fee added ONCE if claiming fewer than bundleThreshold tokens.
  const shippingApplies = selectedWorks.length > 0 && selectedWorks.length < BUNDLE_THRESHOLD;
  const shipping = shippingApplies ? SHIPPING_FEE : 0;
  const grand = paintingsTotal + shipping;

  // === Paid state — show shipping form ===
  if (claimFlow.kind === 'paid') {
    return (
      <aside className={`${styles.drawer} ${open ? styles.drawerOpen : ''}`}>
        <div className={styles.drawerHead}>
          <div>
            <div className={styles.drawerEyebrow}>▼ PAYMENT CONFIRMED ON-CHAIN ▼</div>
            <h2 className={styles.drawerH2}>WHERE TO SHIP</h2>
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">X</button>
        </div>
        <div className={styles.drawerBody}>
          <ShippingForm
            tokenIds={claimFlow.tokenIds}
            paymentTxHash={claimFlow.txHash}
            onSubmitted={() => {/* user dismisses with X */}}
          />
        </div>
      </aside>
    );
  }

  // === Error state ===
  if (claimFlow.kind === 'error') {
    let title = '★ CLAIM FAILED ★';
    let body = claimFlow.message;
    switch (claimFlow.revertName) {
      case 'NotTokenOwner':
        title = '★ NOT YOUR TOKEN ★';
        body = 'You can only claim physicals for tokens in this wallet.';
        break;
      case 'AlreadyClaimed':
        title = '★ ALREADY CLAIMED ★';
        body = 'One of these tokens already has its physical claim recorded on-chain.';
        break;
      case 'WildpixelNotCompleted':
        title = '★ WILDPIXEL INCOMPLETE ★';
        body = 'Complete the wildpixel palette first — you can\'t claim a wildpixel painting before its palette is set.';
        break;
      case 'EmptyClaim':
        title = '★ EMPTY CLAIM ★';
        body = 'No tokens were submitted for claim.';
        break;
      case 'BadMsgValue':
        title = '★ PRICE MISMATCH ★';
        body = 'The price drifted between preview and claim. Refresh and try again.';
        break;
    }
    return (
      <aside className={`${styles.drawer} ${open ? styles.drawerOpen : ''}`}>
        <div className={styles.drawerHead}>
          <div>
            <div className={styles.drawerEyebrow}>▼ ERROR ▼</div>
            <h2 className={styles.drawerH2}>{title}</h2>
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">X</button>
        </div>
        <div className={styles.drawerBody}>
          <div className={styles.drawerEmpty}>
            {body}
            {claimFlow.revertName && (
              <><br /><br /><code style={{ fontSize: '11px', opacity: 0.5 }}>{claimFlow.revertName}</code></>
            )}
          </div>
        </div>
        <div className={styles.drawerTotals}>
          <button className={styles.checkoutBtn} onClick={onDismissError}>
            BACK TO CART ▶
          </button>
        </div>
      </aside>
    );
  }

  // === Standard cart / in-flight states ===
  const busy = claimFlow.kind === 'pricing' || claimFlow.kind === 'signing' || claimFlow.kind === 'confirming';
  let checkoutLabel = 'CONFIRM ORDER ▶';
  if (claimFlow.kind === 'pricing') checkoutLabel = 'READING PRICE FROM CHAIN…';
  else if (claimFlow.kind === 'signing') checkoutLabel = 'SIGN IN WALLET…';
  else if (claimFlow.kind === 'confirming') checkoutLabel = 'CONFIRMING ON-CHAIN…';

  return (
    <aside className={`${styles.drawer} ${open ? styles.drawerOpen : ''}`}>
      <div className={styles.drawerHead}>
        <div>
          <div className={styles.drawerEyebrow}>▼ PAUSE MENU ▼</div>
          <h2 className={styles.drawerH2}>CLAIM PAINTING</h2>
        </div>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close">X</button>
      </div>
      <div className={styles.drawerBody}>
        {selectedWorks.length === 0 ? (
          <div className={styles.drawerEmpty}>
            ▼ EMPTY ▼<br /><br />
            <span className={styles.drawerEmptyBlink}>INSERT WORK TO CONTINUE</span>
          </div>
        ) : (
          selectedWorks.map((w) => {
            const cls = eraToClass(w.era);
            const price = PRICES_HINT[w.era];
            return (
              <div key={w.id} className={styles.drawerItem}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className={`${styles.drawerThumbSvg} ${styles[cls]}`}
                  src={svgPath(w.tokenId)}
                  alt={w.trait ?? ''}
                />
                <div className={styles.drawerMeta}>
                  <div className={styles.drawerT1}>{(w.trait ?? '').toUpperCase()}</div>
                  <div className={styles.drawerT2}>{w.finalTitle}</div>
                  <div className={styles.drawerT3}>{w.era.toUpperCase()}</div>
                  <button
                    className={styles.removeBtn}
                    onClick={() => onRemove(w.id)}
                    disabled={busy}
                  >
                    ▼ REMOVE
                  </button>
                </div>
                <div className={styles.drawerPrice}>{price.toFixed(2)} ETH</div>
              </div>
            );
          })
        )}
      </div>
      <div className={styles.drawerTotals}>
        <div className={styles.totalRow}><span>PAINTINGS</span><span>{paintingsTotal.toFixed(2)} ETH</span></div>
        {shippingApplies ? (
          <div className={styles.totalRow}><span>SHIPPING</span><span>{shipping.toFixed(2)} ETH</span></div>
        ) : selectedWorks.length >= BUNDLE_THRESHOLD ? (
          <div className={`${styles.totalRow} ${styles.savingsRow}`}>
            <span>★ BUNDLE · SHIPPING WAIVED ★</span><span>FREE</span>
          </div>
        ) : null}
        <div className={`${styles.totalRow} ${styles.grandRow}`}>
          <span>TOTAL (estimate)</span><span>{grand.toFixed(2)} ETH</span>
        </div>
        <div style={{ fontSize: '10px', opacity: 0.5, textAlign: 'center', margin: '4px 0' }}>
          ★ FINAL PRICE READ FROM CONTRACT ★
        </div>
        <button
          className={styles.checkoutBtn}
          onClick={onCheckout}
          disabled={selectedWorks.length === 0 || busy}
        >
          {checkoutLabel}
        </button>
      </div>
    </aside>
  );
}

/* ============================================================
 * WildpixelModal
 *
 * 4-step UI: Upload → Extract → Arrange → Lock (review + trait input).
 *
 * When the user clicks "LOCK ON-CHAIN" at step 4, the parent's lockWildpixel
 * fires the full pipeline (backend pin → wallet sign → tx confirm). The modal
 * stays mounted throughout and overlays its body with a status panel showing
 * which phase the flow is in. On success, shows a "DONE" state with the tx
 * hash + link to Etherscan, with a close button that dismisses the modal.
 * ============================================================ */

function WildpixelModal({
  state, work, flow, onChange, onClose, onLock, onDone, onDismissError,
}: {
  state: WildpixelModalState;
  work: Work | undefined;
  flow: WildpixelFlow;
  onChange: (s: WildpixelModalState) => void;
  onClose: () => void;
  onLock: () => void | Promise<void>;
  onDone: () => void;
  onDismissError: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    return () => {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!work) return null;
  const [rows, cols] = work.grid;
  const cls = eraToClass(work.era);

  const goNext = () => {
    if (state.step === 1) onChange({ ...state, step: 2 });
    else if (state.step === 2) onChange({ ...state, step: 3 });
    else if (state.step === 3) onChange({ ...state, step: 4 });
    else if (state.step === 4) onLock();
  };
  const goBack = () => {
    if (state.step > 1) onChange({ ...state, step: (state.step - 1) as 1 | 2 | 3 });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const MAX_BYTES = 8 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      alert(`File too large (${Math.round(file.size / 1024 / 1024)} MB). Max is 8 MB.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataURL = ev.target?.result as string;
      const img = new Image();
      img.onload = () => {
        const colors = extractDominantColors(img, 8);
        onChange({ ...state, extracted: { dataURL, colors } });
      };
      img.onerror = () => alert('Could not load that image. Try a different file.');
      img.src = dataURL;
    };
    reader.onerror = () => alert('Could not read that file. Try a different one.');
    reader.readAsDataURL(file);
  };

  const handleReroll = () => {
    if (state.rerollsLeft <= 0) return;
    onChange({
      ...state,
      rerollsLeft: state.rerollsLeft - 1,
      arrangementSeed: Math.floor(Math.random() * 100000),
    });
  };

  const nextLabel =
    state.step === 1 ? 'EXTRACT ▶'
      : state.step === 2 ? 'ARRANGE ▶'
        : state.step === 3 ? 'USE THIS ▶'
          : 'LOCK ON-CHAIN ▶';
  const nextDisabled =
    state.step === 1 ? !state.extracted
      : state.step === 4 ? state.trait.trim().length === 0
        : false;

  return (
    <div className={`${styles.modalBackdrop} ${styles.modalOpen}`} onClick={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}>
      <div className={styles.modal} role="dialog" aria-modal="true">
        <div className={styles.modalHead}>
          <div>
            <div className={styles.modalEyebrow}>▼ WILDPIXEL · CHOOSE YOUR OWN PALETTE ▼</div>
            <h2 className={styles.modalH2}>COMPLETE WILDPIXEL</h2>
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">X</button>
        </div>
        <div className={styles.steps}>
          {(['1·UPLOAD', '2·EXTRACT', '3·ARRANGE', '4·LOCK'] as const).map((label, i) => {
            const n = i + 1;
            const active = state.step === n;
            const done = state.step > n;
            return (
              <div
                key={label}
                className={`${styles.step} ${active ? styles.stepActive : ''} ${done ? styles.stepDone : ''}`}
              >
                {label}
              </div>
            );
          })}
        </div>
        <div className={styles.modalBody}>
          {flow.kind !== 'idle' ? (
            <WildpixelFlowPanel flow={flow} onDone={onDone} onDismissError={onDismissError} />
          ) : (
            <>
              {state.step === 1 && (
                <>
                  <button
                    type="button"
                    className={styles.uploadZone}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <div className={styles.uploadIcon}>[ + ]</div>
                    <h3 className={styles.uploadH3}>UPLOAD YOUR GAME OR PFP</h3>
                    <p className={styles.uploadP}>Tap to upload your favorite arcade screenshot or pfp.</p>
                    <div className={styles.uploadNote}>PNG · JPG · WEBP · MAX 8MB</div>
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={handleFileChange}
                  />
                  <div className={styles.infoText}>
                    Your image is analysed via <strong>K-MEANS CLUSTERING</strong> to extract 8 dominant colors.
                    The source image is <strong>DISCARDED IMMEDIATELY</strong> after extraction — only hex codes
                    and your entered game name are stored. This action is <strong>PERMANENT</strong> and on-chain.
                  </div>
                </>
              )}
              {state.step === 2 && state.extracted && (
                <ExtractPanel extracted={state.extracted} timersRef={timersRef} />
              )}
              {state.step === 3 && state.extracted && (
                <ArrangePanel
                  colors={state.extracted.colors} rows={rows} cols={cols}
                  seed={state.arrangementSeed} eraClass={cls}
                  rerollsLeft={state.rerollsLeft} onReroll={handleReroll}
                />
              )}
              {state.step === 4 && state.extracted && (
                <FinalPanel
                  colors={state.extracted.colors} rows={rows} cols={cols}
                  seed={state.arrangementSeed} eraClass={cls}
                  trait={state.trait}
                  onTraitChange={(t) => onChange({ ...state, trait: t })}
                  finalTitle={work.finalTitle}
                />
              )}
            </>
          )}
        </div>
        {flow.kind === 'idle' && (
          <div className={styles.modalFoot}>
            <button
              className={`${styles.coinBtn} ${styles.ghost}`}
              onClick={goBack}
              hidden={state.step === 1}
            >
              ◄ BACK
            </button>
            <div className={styles.modalFootSpacer} />
            <button className={styles.coinBtn} onClick={goNext} disabled={nextDisabled}>
              {nextLabel}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================
 * WildpixelFlowPanel — status display during pinning/signing/confirming
 * ============================================================ */

function WildpixelFlowPanel({
  flow, onDone, onDismissError,
}: {
  flow: WildpixelFlow;
  onDone: () => void;
  onDismissError: () => void;
}) {
  // Parent never renders this with flow.kind === 'idle', but the type system
  // doesn't know that — return null defensively to narrow the union below.
  if (flow.kind === 'idle') return null;

  if (flow.kind === 'pinning') {
    return (
      <div style={{ padding: '32px 16px', textAlign: 'center' }}>
        <div style={{ fontSize: '14px', opacity: 0.7, marginBottom: 12 }}>▼ PHASE 1 OF 3 ▼</div>
        <div style={{ fontSize: '20px', marginBottom: 16 }}>PINNING METADATA TO IPFS<span className={styles.blinkCursor} /></div>
        <div className={styles.infoText}>
          Generating the canonical SVG and metadata JSON, then pinning both to IPFS via Pinata.
          This takes 5–15 seconds.
        </div>
      </div>
    );
  }
  if (flow.kind === 'signing') {
    return (
      <div style={{ padding: '32px 16px', textAlign: 'center' }}>
        <div style={{ fontSize: '14px', opacity: 0.7, marginBottom: 12 }}>▼ PHASE 2 OF 3 ▼</div>
        <div style={{ fontSize: '20px', marginBottom: 16 }}>SIGN IN WALLET<span className={styles.blinkCursor} /></div>
        <div className={styles.infoText}>
          A wallet popup is open. Sign to call <code>completeWildpixel(tokenId, metadataURI)</code> on
          the PixelArcade extension. This writes your palette + trait permanently to the chain.
        </div>
      </div>
    );
  }
  if (flow.kind === 'confirming') {
    const shortHash = `${flow.txHash.slice(0, 10)}…${flow.txHash.slice(-8)}`;
    return (
      <div style={{ padding: '32px 16px', textAlign: 'center' }}>
        <div style={{ fontSize: '14px', opacity: 0.7, marginBottom: 12 }}>▼ PHASE 3 OF 3 ▼</div>
        <div style={{ fontSize: '20px', marginBottom: 16 }}>CONFIRMING ON-CHAIN<span className={styles.blinkCursor} /></div>
        <div className={styles.infoText}>
          Transaction submitted. Waiting for Ethereum to confirm.
          <br /><br />
          <a
            href={txUrl(flow.txHash)}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#00ffff', textDecoration: 'underline' }}
          >
            View on Etherscan: {shortHash}
          </a>
        </div>
      </div>
    );
  }
  if (flow.kind === 'done') {
    const shortHash = `${flow.txHash.slice(0, 10)}…${flow.txHash.slice(-8)}`;
    return (
      <div style={{ padding: '32px 16px', textAlign: 'center' }}>
        <div style={{ fontSize: '14px', opacity: 0.7, marginBottom: 12 }}>★ COMPLETE ★</div>
        <div style={{ fontSize: '22px', marginBottom: 16, color: '#00ff66' }}>WILDPIXEL #{flow.tokenId} LOCKED</div>
        <div className={styles.infoText}>
          Your palette and trait are now permanently recorded on the Ethereum blockchain.
          Marketplaces will update to show the new metadata within minutes.
          <br /><br />
          <a
            href={txUrl(flow.txHash)}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#00ffff', textDecoration: 'underline' }}
          >
            View on Etherscan: {shortHash}
          </a>
        </div>
        <div style={{ marginTop: 24 }}>
          <button className={styles.coinBtn} onClick={onDone}>
            ✓ DONE
          </button>
        </div>
      </div>
    );
  }
  // error
  return (
    <div style={{ padding: '32px 16px', textAlign: 'center' }}>
      <div style={{ fontSize: '14px', opacity: 0.7, marginBottom: 12 }}>▼ ERROR ▼</div>
      <div style={{ fontSize: '20px', marginBottom: 16, color: '#ff3366' }}>
        {flow.revertName === 'NotTokenOwner' ? 'NOT YOUR TOKEN'
          : flow.revertName === 'NotWildpixel' ? 'NOT A WILDPIXEL'
            : flow.revertName === 'AlreadyCompleted' ? 'ALREADY COMPLETED'
              : 'COMPLETION FAILED'}
      </div>
      <div className={styles.infoText} style={{ wordBreak: 'break-word' }}>
        {flow.message}
        {flow.revertName && (
          <><br /><br /><code style={{ fontSize: '11px', opacity: 0.5 }}>{flow.revertName}</code></>
        )}
      </div>
      <div style={{ marginTop: 24 }}>
        <button className={styles.coinBtn} onClick={onDismissError}>
          ◄ BACK TO STEP 4
        </button>
      </div>
    </div>
  );
}

/* ExtractPanel (unchanged) */
function ExtractPanel({
  extracted, timersRef,
}: {
  extracted: { dataURL: string; colors: string[] };
  timersRef: React.MutableRefObject<ReturnType<typeof setTimeout>[]>;
}) {
  const [litCount, setLitCount] = useState(0);
  const [sourceDiscarded, setSourceDiscarded] = useState(false);
  useEffect(() => {
    setLitCount(0);
    setSourceDiscarded(false);
    extracted.colors.forEach((_, i) => {
      const t = setTimeout(() => setLitCount((n) => Math.max(n, i + 1)), 200 + i * 90);
      timersRef.current.push(t);
    });
    const tFinal = setTimeout(() => setSourceDiscarded(true), 1600);
    timersRef.current.push(tFinal);
    return () => {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
    };
  }, [extracted, timersRef]);
  return (
    <div className={styles.extractedPreview}>
      <div>
        <div className={styles.extractedLabel}>▼ SOURCE ▼</div>
        <div className={styles.sourcePreview}>
          {!sourceDiscarded ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={extracted.dataURL} alt="Source" />
              <div className={styles.scanning} />
            </>
          ) : (
            <div className={styles.sourceDiscarded}>
              ▼ SOURCE<br />DISCARDED ▼<br /><br />
              ONLY HEX<br />CODES STORED
            </div>
          )}
        </div>
        <div className={styles.extractedAnalysing}>ANALYSING · K-MEANS · K=8</div>
      </div>
      <div>
        <div className={styles.extractedLabel}>▼ PALETTE ▼</div>
        <div className={styles.extractedSwatches}>
          {extracted.colors.map((color, i) => (
            <div
              key={`${color}-${i}`}
              className={`${styles.swatch} ${i < litCount ? styles.swatchIn : ''}`}
              style={{ background: color, color }}
              data-hex={color}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ArrangePanel (unchanged) */
function ArrangePanel({
  colors, rows, cols, seed, eraClass, rerollsLeft, onReroll,
}: {
  colors: string[];
  rows: number; cols: number;
  seed: number; eraClass: string;
  rerollsLeft: number; onReroll: () => void;
}) {
  const cells = useMemo(() => arrange(colors, rows, cols, seed), [colors, rows, cols, seed]);
  const svgHtml = useMemo(() => buildInlineSvg(cells, rows, cols), [cells, rows, cols]);
  return (
    <>
      <div className={styles.rerollInfo}>
        <span>ARRANGEMENT · SIM-ANNEAL</span>
        <span>RE-ROLLS LEFT: <span className={styles.rerollCount}>{rerollsLeft}</span> / 3</span>
        <button
          className={`${styles.coinBtn} ${styles.ghost} ${styles.rerollBtn}`}
          onClick={onReroll} disabled={rerollsLeft <= 0}
        >
          ◄ RE-ROLL
        </button>
      </div>
      <div className={styles.arrangementStage}>
        <div
          className={`${styles.pixelGrid} ${styles[eraClass]}`}
          dangerouslySetInnerHTML={{ __html: svgHtml }}
        />
      </div>
      <div className={styles.infoText}>
        Same algorithm as game-derived works: <strong>ADJACENCY CONTRAST</strong>,{' '}
        <strong>DUPLICATE DISPERSION</strong>, <strong>ASYMMETRY</strong>.
        Re-roll up to 3 times before locking.
      </div>
    </>
  );
}

/* FinalPanel (unchanged) */
function FinalPanel({
  colors, rows, cols, seed, eraClass, trait, onTraitChange, finalTitle,
}: {
  colors: string[];
  rows: number; cols: number;
  seed: number; eraClass: string;
  trait: string;
  onTraitChange: (v: string) => void;
  finalTitle: string;
}) {
  const cells = useMemo(() => arrange(colors, rows, cols, seed), [colors, rows, cols, seed]);
  const svgHtml = useMemo(() => buildInlineSvg(cells, rows, cols), [cells, rows, cols]);
  return (
    <>
      <div className={styles.arrangementStage}>
        <div
          className={`${styles.pixelGrid} ${styles[eraClass]}`}
          dangerouslySetInnerHTML={{ __html: svgHtml }}
        />
      </div>
      <div className={styles.traitLabel}>▼ TRAIT · THE GAME NAME ▼</div>
      <input
        type="text"
        className={styles.traitInput}
        value={trait}
        onChange={(e) => onTraitChange(e.target.value)}
        placeholder="POKEMON CRYSTAL"
      />
      <div className={styles.infoText}>
        Locking writes swatches, arrangement &amp; trait permanently to NFT metadata.
        Final art title <strong>{finalTitle.toUpperCase()}</strong> already assigned.
      </div>
    </>
  );
}
