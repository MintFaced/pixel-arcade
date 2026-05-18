/**
 * API client — typed fetch wrappers for the backend.
 *
 * SIWE auth uses a session cookie set by /api/auth/verify; subsequent calls
 * send the cookie automatically via `credentials: 'same-origin'`.
 */

import type { Era } from './pool';

// ============================================================
// Shared types — match the backend response shapes
// ============================================================

export interface SessionInfo {
  address: string;
  tier: 'standard' | 'elevated';
  tierValue: 0 | 1;
  rollsTotal: number;
  rollsUsed: number;
  rollsRemaining: number;
  proof: string[];
  holds: Array<{ tokenId: number; expiresAt: number; locked: boolean }>;
}

export interface RollResult {
  tokenId: number;
  expiresAt: number;
  rollsUsed: number;
  rollsRemaining: number;
}

export interface LockResult {
  tokenId: number;
  expiresAt: number;
  locked: true;
}

export interface SignedMintAuthorization {
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: `0x${string}`;
  };
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: 'MintAuthorization';
  message: {
    minter: `0x${string}`;
    tokenIds: string[];  // bigint stringified
    tier: number;
    merkleProof: `0x${string}`[];
    nonce: string;
    deadline: string;
  };
  signature: `0x${string}`;
}

// ============================================================
// Fetch helper with consistent error handling
// ============================================================

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  let body: unknown = null;
  try {
    body = await resp.json();
  } catch {
    // Non-JSON response is OK if status is fine
  }
  if (!resp.ok) {
    const errorMsg = (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string')
      ? body.error
      : `Request failed (${resp.status})`;
    throw new ApiError(errorMsg, resp.status);
  }
  return body as T;
}

// ============================================================
// Auth — SIWE flow
// ============================================================

export async function getSiweNonce(address: string): Promise<string> {
  const data = await apiFetch<{ nonce: string }>('/api/auth/nonce', {
    method: 'POST',
    body: JSON.stringify({ address }),
  });
  return data.nonce;
}

export async function verifySiweSignature(message: string, signature: string): Promise<{ address: string }> {
  return apiFetch<{ address: string }>('/api/auth/verify', {
    method: 'POST',
    body: JSON.stringify({ message, signature }),
  });
}

// ============================================================
// Session
// ============================================================

export async function getSession(): Promise<SessionInfo> {
  return apiFetch<SessionInfo>('/api/session', { method: 'GET' });
}

// ============================================================
// Roll / Lock / Release
// ============================================================

export async function requestRoll(): Promise<RollResult> {
  return apiFetch<RollResult>('/api/roll', { method: 'POST' });
}

export async function lockRoll(tokenId: number): Promise<LockResult> {
  return apiFetch<LockResult>('/api/lock', {
    method: 'POST',
    body: JSON.stringify({ tokenId }),
  });
}

export async function releaseRoll(tokenId: number): Promise<void> {
  await apiFetch<{ ok: boolean }>('/api/release', {
    method: 'POST',
    body: JSON.stringify({ tokenId }),
  });
}

// ============================================================
// Mint authorization
// ============================================================

export async function getMintAuthorization(tokenIds: number[]): Promise<SignedMintAuthorization> {
  return apiFetch<SignedMintAuthorization>('/api/mint-authorization', {
    method: 'POST',
    body: JSON.stringify({ tokenIds }),
  });
}

// ============================================================
// Physical / shipping
// ============================================================

export const PHYSICAL_PRICES: Record<Era, { painting: bigint; shipping: bigint }> = {
  '8-bit':  { painting: BigInt(25e16),  shipping: BigInt(25e16) },
  '16-bit': { painting: BigInt(50e16),  shipping: BigInt(25e16) },
  '32-bit': { painting: BigInt(100e16), shipping: BigInt(25e16) },
};
