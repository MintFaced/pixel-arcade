import { redis } from './redis';

/**
 * Pool state — tracks which tokens have been minted vs available.
 *
 * For session 4b without a live contract, we maintain this in Redis. Once
 * Yung's contract is deployed, this should be replaced with on-chain reads:
 *   const minted = await publicClient.readContract({ ..., functionName: 'totalSupply' });
 *
 * For now: a Redis set `pool:minted` of token IDs that have been claimed
 * via /api/mint-authorization (we mark them minted optimistically when we
 * issue an authorization — pessimistic would wait for tx confirmation).
 */

const POOL_TOTAL = 64;
const MINTED_SET_KEY = 'pool:minted';

/** Mark tokens as minted (called after we issue a mint authorization). */
export async function markMinted(tokenIds: number[]): Promise<void> {
  if (tokenIds.length === 0) return;
  const [first, ...rest] = tokenIds.map(String);
  await redis.sadd(MINTED_SET_KEY, first, ...rest);
}

/** Check if a token is minted. */
export async function isMinted(tokenId: number): Promise<boolean> {
  const result = await redis.sismember(MINTED_SET_KEY, String(tokenId));
  return result === 1;
}

/** Get all minted token IDs (for pool browsing). */
export async function getMintedSet(): Promise<Set<number>> {
  const members = await redis.smembers(MINTED_SET_KEY);
  return new Set(members.map((m) => parseInt(m, 10)));
}

/** Pick a random unminted, unheld token. Returns null if pool is empty. */
export async function pickRandomAvailableToken(): Promise<number | null> {
  const minted = await getMintedSet();
  const available: number[] = [];
  for (let id = 1; id <= POOL_TOTAL; id++) {
    if (!minted.has(id)) {
      // Also check it's not currently held by someone else — done by caller via tryHoldToken
      available.push(id);
    }
  }
  if (available.length === 0) return null;
  const idx = Math.floor(Math.random() * available.length);
  return available[idx];
}

export { POOL_TOTAL };
