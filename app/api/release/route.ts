import { NextRequest, NextResponse } from 'next/server';
import { getAuthedAddress } from '../../lib/auth';
import { releaseHold } from '../../lib/redis';

/**
 * POST /api/release
 *
 * Auth required. Releases a held token back to the pool early.
 *
 * Body: { tokenId: number }
 * Returns: { ok: true }
 *
 * Lazy release happens via TTL anyway; this is for the eager case (user
 * walks away from a roll and we want the token back in circulation now).
 */

interface RequestBody {
  tokenId?: number;
}

export async function POST(req: NextRequest) {
  const address = await getAuthedAddress(req);
  if (!address) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (typeof body.tokenId !== 'number' || !Number.isFinite(body.tokenId)) {
    return NextResponse.json({ error: 'tokenId required' }, { status: 400 });
  }

  try {
    const ok = await releaseHold(body.tokenId, address);
    if (!ok) {
      // Already expired or not yours — idempotent success, doesn't matter
      return NextResponse.json({ ok: true, released: false });
    }
    return NextResponse.json({ ok: true, released: true });
  } catch (err) {
    console.error('[release] Error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
