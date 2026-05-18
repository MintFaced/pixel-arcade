import { Redis } from '@upstash/redis';

/**
 * Singleton Redis client. Uses Upstash REST API (not native Redis protocol)
 * so it works in Vercel's serverless functions without persistent connections.
 *
 * Required env vars:
 *   UPSTASH_REDIS_REST_URL
 *   UPSTASH_REDIS_REST_TOKEN
 *
 * Throws at import time if these are missing — fail fast in production.
 */

if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
  // Only warn in dev/build — runtime calls will throw clearly
  if (process.env.NODE_ENV === 'production') {
    console.warn('[redis] UPSTASH env vars missing — Redis operations will fail');
  }
}

export const redis = Redis.fromEnv();

/* ============================================================
   Token holds — reserve an unminted token for a wallet temporarily
   ============================================================ */

const HOLD_TTL_SECONDS = 15 * 60;     // 15 min initial hold (matches /api/roll)
const LOCK_TTL_SECONDS = 60 * 60;     // 60 min extended (matches /api/lock)

export interface TokenHold {
  tokenId: number;
  holder: string;       // lowercase address
  expiresAt: number;    // unix seconds
  locked: boolean;      // true after /lock, false after just /roll
}

function holdKey(tokenId: number): string {
  return `hold:token:${tokenId}`;
}

/** Try to atomically claim a hold on tokenId for the given address. */
export async function tryHoldToken(tokenId: number, holder: string): Promise<TokenHold | null> {
  const key = holdKey(tokenId);
  const expiresAt = Math.floor(Date.now() / 1000) + HOLD_TTL_SECONDS;
  const hold: TokenHold = { tokenId, holder: holder.toLowerCase(), expiresAt, locked: false };

  // SET NX EX — only succeed if key doesn't exist; auto-expire
  const result = await redis.set(key, JSON.stringify(hold), {
    nx: true,
    ex: HOLD_TTL_SECONDS,
  });

  return result === 'OK' ? hold : null;
}

/** Read current hold info (or null if expired/not held). */
export async function getHold(tokenId: number): Promise<TokenHold | null> {
  const raw = await redis.get<TokenHold | string>(holdKey(tokenId));
  if (!raw) return null;
  return typeof raw === 'string' ? (JSON.parse(raw) as TokenHold) : raw;
}

/** Extend an existing hold (after /lock). Caller must be the current holder. */
export async function extendHold(tokenId: number, holder: string): Promise<TokenHold | null> {
  const current = await getHold(tokenId);
  if (!current) return null;
  if (current.holder !== holder.toLowerCase()) return null;

  const extended: TokenHold = {
    ...current,
    locked: true,
    expiresAt: Math.floor(Date.now() / 1000) + LOCK_TTL_SECONDS,
  };
  await redis.set(holdKey(tokenId), JSON.stringify(extended), { ex: LOCK_TTL_SECONDS });
  return extended;
}

/** Release a hold early. Caller must be the current holder. */
export async function releaseHold(tokenId: number, holder: string): Promise<boolean> {
  const current = await getHold(tokenId);
  if (!current) return false;
  if (current.holder !== holder.toLowerCase()) return false;
  await redis.del(holdKey(tokenId));
  return true;
}

/** List all currently-held token IDs for a given address. */
export async function getUserHolds(holder: string): Promise<TokenHold[]> {
  // Naive scan — fine for 64 tokens, would replace with a set index for scale
  const holds: TokenHold[] = [];
  for (let id = 1; id <= 64; id++) {
    const h = await getHold(id);
    if (h && h.holder === holder.toLowerCase()) holds.push(h);
  }
  return holds;
}

/* ============================================================
   Rate limiting — track rolls per address per 24h window
   ============================================================ */

function dayBucket(now = Date.now()): string {
  // Use UTC day so the reset is consistent worldwide
  const d = new Date(now);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function rollCountKey(address: string, day = dayBucket()): string {
  return `rolls:${address.toLowerCase()}:${day}`;
}

/** Increment a user's roll count for today, return the new total. */
export async function bumpRollCount(address: string): Promise<number> {
  const key = rollCountKey(address);
  const n = await redis.incr(key);
  if (n === 1) {
    // First increment of the day — set expiry to slightly more than 24h
    // so the key auto-cleans
    await redis.expire(key, 60 * 60 * 25);
  }
  return n;
}

/** Read current roll count without incrementing. */
export async function getRollCount(address: string): Promise<number> {
  const n = await redis.get<number | string>(rollCountKey(address));
  if (n === null) return 0;
  return typeof n === 'string' ? parseInt(n, 10) : n;
}

/* ============================================================
   SIWE nonces — one-time tokens used for sign-in
   ============================================================ */

const NONCE_TTL_SECONDS = 5 * 60;

function nonceKey(nonce: string): string {
  return `nonce:${nonce}`;
}

/** Store a nonce as unused, with 5-min TTL. */
export async function storeNonce(nonce: string, address: string): Promise<void> {
  await redis.set(nonceKey(nonce), { address: address.toLowerCase(), used: false }, { ex: NONCE_TTL_SECONDS });
}

/** Consume a nonce (returns true if it was valid and unused). One-shot. */
export async function consumeNonce(nonce: string): Promise<{ address: string } | null> {
  const data = await redis.get<{ address: string; used: boolean }>(nonceKey(nonce));
  if (!data || data.used) return null;
  await redis.del(nonceKey(nonce));
  return { address: data.address };
}

/* ============================================================
   Per-tx nonces for mint authorizations — prevent replay
   ============================================================ */

function mintNonceKey(address: string): string {
  return `mintnonce:${address.toLowerCase()}`;
}

/** Get and atomically increment the user's mint nonce. */
export async function nextMintNonce(address: string): Promise<bigint> {
  const n = await redis.incr(mintNonceKey(address));
  return BigInt(n);
}
