/**
 * 6529 Network identity client.
 *
 * The 6529 API resolves any wallet address in a consolidation set to the
 * same identity — meaning we don't have to do delegation lookup ourselves.
 * If a user connects ANY of MintFace's three wallets, the API returns
 * MintFace's identity (handle, level, primary_wallet, full consolidation_key).
 *
 * Usage in this app:
 *   - Badge display: show LEVEL N if user has a meaningful 6529 level
 *   - Social/identity surfacing: shows their handle when we want it
 *
 * NOT used for roll allowance — that's strictly Merkle-proof-gated on the
 * contract. See README + session 4 design notes for the rationale.
 */

interface Sixty5Identity {
  /** Display name on 6529 */
  handle: string;
  /** 6529 Level (TDH-derived ranking) */
  level: number | null;
  /** The canonical wallet for this identity */
  primaryWallet: string;
  /** All wallets in the consolidation set, dash-joined */
  consolidationKey: string;
  /** Total Days Held (collector metric) */
  tdh: number | null;
}

/** Cache of resolved identities, keyed by lowercase wallet address.
 *  Cleared on full page reload, which is fine. */
const identityCache = new Map<string, Sixty5Identity | null>();
/** In-flight requests, so two concurrent callers share one fetch. */
const inflight = new Map<string, Promise<Sixty5Identity | null>>();

/**
 * Look up the 6529 identity for a wallet address.
 *
 * Returns `null` if:
 *   - The wallet has no 6529 identity (most wallets won't)
 *   - The API call fails (rate limit, network error, malformed response)
 *
 * Callers should treat null as "no identity, fall through". Never throws.
 */
export async function fetch6529Identity(
  walletAddress: string
): Promise<Sixty5Identity | null> {
  const key = walletAddress.toLowerCase();

  // Cached?
  if (identityCache.has(key)) {
    return identityCache.get(key) ?? null;
  }
  // In flight?
  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = (async (): Promise<Sixty5Identity | null> => {
    try {
      const resp = await fetch(
        `https://api.6529.io/api/identities?wallet=${encodeURIComponent(walletAddress)}`,
        { headers: { accept: 'application/json' } }
      );
      if (!resp.ok) {
        identityCache.set(key, null);
        return null;
      }
      const data = await resp.json();

      // API returns an array; a hit looks like [{...identity}], a miss like [].
      if (!Array.isArray(data) || data.length === 0) {
        identityCache.set(key, null);
        return null;
      }
      const raw = data[0];
      if (!raw || typeof raw !== 'object') {
        identityCache.set(key, null);
        return null;
      }

      const identity: Sixty5Identity = {
        handle: typeof raw.handle === 'string' ? raw.handle : '',
        level: typeof raw.level === 'number' ? raw.level : null,
        primaryWallet:
          typeof raw.primary_wallet === 'string'
            ? raw.primary_wallet.toLowerCase()
            : key,
        consolidationKey:
          typeof raw.consolidation_key === 'string' ? raw.consolidation_key : '',
        tdh: typeof raw.tdh === 'number' ? raw.tdh : null,
      };
      identityCache.set(key, identity);
      return identity;
    } catch {
      // Network error or invalid JSON — treat as no identity, don't throw.
      identityCache.set(key, null);
      return null;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}

/**
 * Minimum 6529 level we'll display as a LEVEL badge.
 * Below this, fall through to the HI-SCORE fallback.
 *
 * Rationale: showing "LEVEL 0" or "LEVEL 1" for brand-new accounts isn't
 * really a signal. Setting a floor keeps the badge meaningful.
 */
export const MIN_DISPLAY_LEVEL = 1;
