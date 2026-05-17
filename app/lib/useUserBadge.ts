'use client';

import { useEffect, useState } from 'react';
import { useAccount, useEnsName } from 'wagmi';
import { mainnet } from 'wagmi/chains';
import type { BadgeData } from '../components/UserBadge';

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
 * Priority (matches session 3 design):
 *   1. ★ LINE ★ / #N    if the wallet is on The Line (lookup against /line-roster.json)
 *   2. ★ LEVEL ★ / N    if 6529 Level data available (TODO in session 4b — currently never fires)
 *   3. ★ HI-SCORE ★ / 69420   fallback
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
      const roster = await fetchRoster();
      if (cancelled) return;

      // Try the 0x address first (lowercase), then the ENS name (lowercase)
      const addrKey = address.toLowerCase();
      const ensKey = ensName?.toLowerCase();

      const entry = roster[addrKey] ?? (ensKey ? roster[ensKey] : undefined);
      if (entry) {
        setBadge({ kind: 'line', value: entry.line });
        return;
      }

      // Future session 4b: check 6529 Level here.

      // No Line, no Level — hi-score fallback
      setBadge({ kind: 'hi-score', value: 69420 });
    })();

    return () => {
      cancelled = true;
    };
  }, [address, ensName]);

  return badge;
}
