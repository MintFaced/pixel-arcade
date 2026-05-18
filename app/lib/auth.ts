import { SignJWT, jwtVerify } from 'jose';
import { SiweMessage } from 'siwe';
import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';

/**
 * Auth lib — SIWE verification + JWT sessions stored in HTTP-only cookies.
 *
 * Flow:
 *   1. Client calls POST /api/auth/nonce → backend generates + stores nonce, returns it
 *   2. Client builds SIWE message with nonce, signs with wallet
 *   3. Client POSTs message + signature to /api/auth/verify
 *   4. Backend verifies signature, issues JWT in httpOnly cookie
 *   5. Subsequent requests include cookie automatically; we extract address
 *
 * Required env vars:
 *   JWT_SECRET — random 64+ char string. Generate with: openssl rand -hex 32
 *
 * Cookie:
 *   pixelarcade_session — httpOnly, secure, sameSite=strict, 24h expiry
 */

const COOKIE_NAME = 'pixelarcade_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24; // 24h
const JWT_ALG = 'HS256';

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET env var missing or too short (need 32+ chars)');
  }
  return new TextEncoder().encode(secret);
}

export interface SessionPayload {
  address: string;       // lowercase
  iat: number;
  exp: number;
}

/** Sign a session JWT for the given address. */
export async function signSession(address: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ address: address.toLowerCase() })
    .setProtectedHeader({ alg: JWT_ALG })
    .setIssuedAt(now)
    .setExpirationTime(now + SESSION_TTL_SECONDS)
    .sign(getSecret());
}

/** Verify a session JWT, returning the address or null. */
export async function verifySession(jwt: string): Promise<{ address: string } | null> {
  try {
    const { payload } = await jwtVerify(jwt, getSecret(), { algorithms: [JWT_ALG] });
    if (typeof payload.address !== 'string') return null;
    return { address: payload.address };
  } catch {
    return null;
  }
}

/**
 * Cookie helpers — different signatures for setting (during /verify) vs
 * reading (during any authenticated endpoint).
 */

export async function setSessionCookie(jwt: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, jwt, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

/** Extract the authenticated address from a request, or null if not authed. */
export async function getAuthedAddress(req: NextRequest): Promise<string | null> {
  // Try cookie first (browser flow)
  const cookieValue = req.cookies.get(COOKIE_NAME)?.value;
  if (cookieValue) {
    const session = await verifySession(cookieValue);
    if (session) return session.address;
  }

  // Fall back to Authorization: Bearer header (for API testing / non-browser clients)
  const authHeader = req.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const session = await verifySession(authHeader.slice(7));
    if (session) return session.address;
  }

  return null;
}

/* ============================================================
   SIWE message verification
   ============================================================ */

export interface VerifySiweInput {
  message: string;
  signature: string;
}

/** Verify a SIWE message + signature, returning the recovered address. */
export async function verifySiwe(input: VerifySiweInput): Promise<{ address: string } | null> {
  try {
    const siwe = new SiweMessage(input.message);
    const result = await siwe.verify({ signature: input.signature });
    if (!result.success) return null;
    return { address: siwe.address.toLowerCase() };
  } catch {
    return null;
  }
}

/** Build a domain string for SIWE message verification. Should match the frontend. */
export function getExpectedDomain(): string {
  // Production: pixelarcade.art. Preview: branch URL. Dev: localhost.
  return process.env.NEXT_PUBLIC_SIWE_DOMAIN ?? 'pixelarcade.art';
}
