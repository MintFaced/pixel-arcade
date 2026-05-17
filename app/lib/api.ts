/**
 * API client — typed stubs for the backend endpoints that will exist in
 * session 4b. Right now these return mock data so the UI keeps working
 * without a backend.
 *
 * The interface (function signatures + types) is locked in now so that
 * session 4b is a 5-line swap: replace each function body with a fetch()
 * to the real endpoint.
 *
 * Server-side endpoints we're targeting (Vercel API routes):
 *   - POST /api/auth/nonce          — get a nonce for SIWE
 *   - POST /api/auth/verify         — verify the SIWE signature, get a JWT
 *   - GET  /api/session             — current session info (tier, rolls used)
 *   - POST /api/roll                — request a new roll (backend picks token, holds it)
 *   - POST /api/lock                — lock a roll for minting (extends hold)
 *   - POST /api/release             — release a roll back to the pool
 *   - POST /api/mint-authorization  — get an EIP-712 signed MintAuthorization
 *                                     from the elevated-tier key
 */

import type { Era } from './pool';

// ============================================================
// Shared types
// ============================================================

export interface TierInfo {
  /** 'standard' (1 roll) or 'elevated' (5 rolls) */
  tier: 'standard' | 'elevated';
  /** Total rolls per 24h window for this tier */
  rollsTotal: number;
  /** Rolls used this 24h window */
  rollsUsed: number;
  /** Merkle proof for elevated tier (empty array if standard) */
  proof: string[];
}

export interface RollResult {
  /** Token ID picked by backend */
  tokenId: number;
  /** Hold ID — pass to /lock or /release within 15 min */
  holdId: string;
  /** Seconds until the hold expires */
  expiresIn: number;
}

export interface LockResult {
  holdId: string;
  /** Total locked tokens for this session */
  locked: number[];
  /** Extended expiry (seconds from now) */
  expiresIn: number;
}

export interface MintAuthorization {
  /** EIP-712 payload that gets passed to the contract's batchMint */
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: string;
  };
  message: {
    minter: string;          // user's address
    tokenIds: number[];      // tokens locked for mint
    tier: 0 | 1;             // 0=standard, 1=elevated
    nonce: bigint;           // signed nonce
    deadline: bigint;        // unix seconds
  };
  /** EIP-712 signature from the backend's signing key */
  signature: `0x${string}`;
  /** Total price in wei (tokenIds.length * 0.05 ether) */
  totalPrice: bigint;
  /** Merkle proof for the user's tier */
  merkleProof: `0x${string}`[];
}

// ============================================================
// Stubs — return mock data so UI works without backend
// ============================================================

const STUB_DELAY_MS = 300; // simulate network latency

function delay<T>(value: T, ms = STUB_DELAY_MS): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

/**
 * GET /api/session — returns the current user's tier, rolls allowance,
 * and rolls used. In session 4b this checks the user's address against
 * the allowlist Merkle root + Redis usage tracking.
 */
export async function getSession(address: string): Promise<TierInfo> {
  // Mock: pretend everyone is elevated tier with 5 rolls total, 0 used.
  // Session 4b: real lookup against allowlist + Redis.
  void address;
  return delay({
    tier: 'elevated',
    rollsTotal: 5,
    rollsUsed: 0,
    proof: [],
  });
}

/**
 * POST /api/roll — backend picks a random unminted token and holds it for
 * 15 minutes against the user's address. Re-rolling within the hold
 * window is allowed (releases the previous hold).
 */
export async function requestRoll(_address: string): Promise<RollResult> {
  // Mock: pick a random token 1-64. Real impl uses on-chain pool state
  // and a server-side RNG (or Chainlink VRF commit-reveal).
  const tokenId = Math.floor(Math.random() * 64) + 1;
  return delay({
    tokenId,
    holdId: 'stub-hold-' + Math.random().toString(36).slice(2, 10),
    expiresIn: 900, // 15 min
  });
}

/**
 * POST /api/lock — extend the hold to a longer window (e.g. 60 min) so
 * the user can roll more and batch them. Releases auto-extend.
 */
export async function lockRoll(holdId: string): Promise<LockResult> {
  void holdId;
  return delay({
    holdId,
    locked: [],
    expiresIn: 3600,
  });
}

/**
 * POST /api/release — release a held token back to the pool early. Hold
 * expiry handles the lazy case; this is the eager release.
 */
export async function releaseRoll(holdId: string): Promise<void> {
  void holdId;
  return delay(undefined);
}

/**
 * POST /api/mint-authorization — backend signs an EIP-712 MintAuthorization
 * that the user submits to the contract along with payment. The signature
 * is the elevated-tier signing key authorizing this specific mint.
 */
export async function getMintAuthorization(
  address: string,
  tokenIds: number[]
): Promise<MintAuthorization> {
  // Mock: returns a fake authorization. Session 4b: real EIP-712 sign on backend.
  return delay({
    domain: {
      name: 'PixelArcade',
      version: '1',
      chainId: 11155111, // Sepolia
      verifyingContract: '0x0000000000000000000000000000000000000000',
    },
    message: {
      minter: address,
      tokenIds,
      tier: 1,
      nonce: 0n,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 600),
    },
    signature: '0x' + '00'.repeat(65) as `0x${string}`,
    totalPrice: BigInt(tokenIds.length) * BigInt(5e16), // 0.05 ETH each
    merkleProof: [],
  });
}

/**
 * Helper: prices per era for physical claims (matches my-mints drawer).
 * Pure data, no network call needed.
 */
export const PHYSICAL_PRICES: Record<Era, { painting: bigint; shipping: bigint }> = {
  '8-bit':  { painting: BigInt(25e16),  shipping: BigInt(25e16) },  // 0.25 ETH each
  '16-bit': { painting: BigInt(50e16),  shipping: BigInt(25e16) },  // 0.50 ETH painting
  '32-bit': { painting: BigInt(100e16), shipping: BigInt(25e16) },  // 1.00 ETH painting
};
