import { NextRequest, NextResponse } from 'next/server';
import { generateNonce } from 'siwe';
import { storeNonce } from '../../../lib/redis';

/**
 * POST /api/auth/nonce
 *
 * Body: { address: string }
 * Returns: { nonce: string }
 *
 * Generates a random nonce, stores it in Redis with 5-min TTL bound to the
 * given address. Frontend uses this nonce in the SIWE message it signs.
 */

interface RequestBody {
  address?: string;
}

export async function POST(req: NextRequest) {
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body.address || !/^0x[0-9a-fA-F]{40}$/.test(body.address)) {
    return NextResponse.json({ error: 'Invalid address' }, { status: 400 });
  }

  const nonce = generateNonce();
  try {
    await storeNonce(nonce, body.address);
  } catch (err) {
    console.error('[auth/nonce] Redis error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
  return NextResponse.json({ nonce });
}
