'use client';

import { useEffect, useState } from 'react';
import { useAccount, useEnsName } from 'wagmi';
import { mainnet } from 'wagmi/chains';
import type { BadgeData } from '../components/UserBadge';
import { fetch6529Identity, MIN_DISPLAY_LEVEL } from './sixtyFiveTwentyNine';

/**
 * The Line roster, fetched lazily from /line-roster.json (built from
 * theline.wtf artists data). Keyed by lowercase wallet address OR
 * lowercase ENS name (some artists are stored by ENS in the source data).
 */
interface RosterEntry {
  line: number;
  name: string;
}
type Roster = Record<string, RosterEntry>;

let cachedRoster: Roster | null = null;
let rosterPromise: Promise<Roster> | null = null;

async function fetchRoster(): Promise<Roster> {
  if (cachedRoster) return cachedRoster;
  if (rosterPromise) return rosterPromise;
  rosterPromise = (async () => {
    try {
      const resp = await fetch('/line-roster.json', { cache: 'force-cache' });
      if (!resp.ok) return {};
      const data = (await resp.json()) as Roster;
      cachedRoster = data;
      return data;
    } catch {
      return {};
    }
  })();
  return rosterPromise;
}

/**
 * useUserBadge — returns the badge state for the connected wallet.
 *
 * Priority (highest wins):
 *   1. LINE / N     if the wallet is on The Line (lookup against /line-roster.json)
 *   2. LEVEL / N    if 6529 API returns an identity with level >= MIN_DISPLAY_LEVEL.
 *                   Note: 6529's API resolves consolidated wallets — connecting
 *                   ANY of an identity's wallets returns the same identity, so
 *                   delegation is handled API-side.
 *   3. HI-SCORE / 69420   universal fallback
 *
 * Important: the badge is informational only. Roll allowance is enforced
 * by the contract's Merkle root, NOT by what this badge displays.
 *
 * Disconnected wallet: returns the hi-score fallback so the badge still
 * displays something rather than going blank.
 */
export function useUserBadge(): BadgeData {
  const { address } = useAccount();
  const { data: ensName } = useEnsName({ address, chainId: mainnet.id });
  const [badge, setBadge] = useState<BadgeData>({ kind: 'hi-score', value: 69420 });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // No wallet yet — fall back
      if (!address) {
        if (!cancelled) setBadge({ kind: 'hi-score', value: 69420 });
        return;
      }

      // === Priority 1: The Line ===
      const roster = await fetchRoster();
      if (cancelled) return;

      const addrKey = address.toLowerCase();
      const ensKey = ensName?.toLowerCase();

      const lineEntry = roster[addrKey] ?? (ensKey ? roster[ensKey] : undefined);
      if (lineEntry) {
        setBadge({ kind: 'line', value: lineEntry.line });
        return;
      }

      // === Priority 2: 6529 Level ===
      const identity = await fetch6529Identity(address);
      if (cancelled) return;

      if (identity && typeof identity.level === 'number' && identity.level >= MIN_DISPLAY_LEVEL) {
        setBadge({ kind: 'level', value: identity.level });
        return;
      }

      // === Priority 3: HI-SCORE fallback ===
      setBadge({ kind: 'hi-score', value: 69420 });
    })();

    return () => {
      cancelled = true;
    };
  }, [address, ensName]);

  return badge;
}
