import { NextRequest, NextResponse } from 'next/server';
import { consumeNonce } from '../../../lib/redis';
import { verifySiwe, signSession, setSessionCookie } from '../../../lib/auth';
import { SiweMessage } from 'siwe';

/**
 * POST /api/auth/verify
 *
 * Body: { message: string, signature: string }
 * Returns: { ok: true, address: string } and sets pixelarcade_session cookie
 *
 * Verifies the SIWE signature, consumes the nonce, issues a JWT session.
 */

interface RequestBody {
  message?: string;
  signature?: string;
}

export async function POST(req: NextRequest) {
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.message || !body.signature) {
    return NextResponse.json({ error: 'message and signature required' }, { status: 400 });
  }

  // Parse the SIWE message to extract nonce and address for our checks
  let parsed: SiweMessage;
  try {
    parsed = new SiweMessage(body.message);
  } catch {
    return NextResponse.json({ error: 'Invalid SIWE message' }, { status: 400 });
  }

  // Verify the signature
  const verified = await verifySiwe({ message: body.message, signature: body.signature });
  if (!verified) {
    return NextResponse.json({ error: 'Signature verification failed' }, { status: 401 });
  }
  if (verified.address !== parsed.address.toLowerCase()) {
    return NextResponse.json({ error: 'Address mismatch' }, { status: 401 });
  }

  // Consume the nonce — must exist + match address + be one-shot
  const nonceResult = await consumeNonce(parsed.nonce);
  if (!nonceResult) {
    return NextResponse.json({ error: 'Invalid or expired nonce' }, { status: 401 });
  }
  if (nonceResult.address !== verified.address) {
    return NextResponse.json({ error: 'Nonce/address mismatch' }, { status: 401 });
  }

  // All good — issue JWT
  const jwt = await signSession(verified.address);
  await setSessionCookie(jwt);

  return NextResponse.json({ ok: true, address: verified.address });
}
