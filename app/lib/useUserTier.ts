'use client';

import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';

/**
 * Tier shape:
 *   - 'standard' = 3 rolls/day (default, no proof needed)
 *   - 'elevated' = 5 rolls/day (Line Artists + 6529 whale tier, ~3,073 addresses)
 *
 * Lookup: an address is elevated iff it appears in /proofs.json (the Merkle
 * tree leaves). The contract enforces this on mint via Merkle proof; the
 * frontend reads the same file to show the right roll allowance.
 *
 * Important: this is the display value. The actual roll allowance is also
 * rate-limited per 24h window by the backend (session 4b). For now, this is
 * just the "total rolls available this session" the UI shows.
 */
export type Tier = 'standard' | 'elevated';

export interface TierInfo {
  tier: Tier;
  rollsPerDay: number;
}

const TIER_TO_ROLLS: Record<Tier, number> = {
  standard: 3,
  elevated: 5,
};

interface ProofsFile {
  [address: string]: { tier: number; proof: string[] };
}

let cachedProofs: ProofsFile | null = null;
let proofsPromise: Promise<ProofsFile> | null = null;

async function loadProofs(): Promise<ProofsFile> {
  if (cachedProofs) return cachedProofs;
  if (proofsPromise) return proofsPromise;
  proofsPromise = (async () => {
    try {
      const resp = await fetch('/proofs.json', { cache: 'force-cache' });
      if (!resp.ok) return {};
      const data = (await resp.json()) as ProofsFile;
      cachedProofs = data;
      return data;
    } catch {
      return {};
    }
  })();
  return proofsPromise;
}

/**
 * useUserTier — returns the connected wallet's tier and roll allowance.
 *
 * Defaults to standard (3 rolls) until the wallet is connected and the
 * proofs file has been checked. This means disconnected users see 3 rolls
 * — which is honest because they can't mint anyway without connecting.
 */
export function useUserTier(): TierInfo {
  const { address } = useAccount();
  const [tier, setTier] = useState<TierInfo>({
    tier: 'standard',
    rollsPerDay: TIER_TO_ROLLS.standard,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!address) {
        if (!cancelled) {
          setTier({ tier: 'standard', rollsPerDay: TIER_TO_ROLLS.standard });
        }
        return;
      }
      const proofs = await loadProofs();
      if (cancelled) return;
      const entry = proofs[address.toLowerCase()];
      if (entry) {
        // Address is in the elevated Merkle tree
        setTier({ tier: 'elevated', rollsPerDay: TIER_TO_ROLLS.elevated });
      } else {
        setTier({ tier: 'standard', rollsPerDay: TIER_TO_ROLLS.standard });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [address]);

  return tier;
}
