import { NextRequest, NextResponse } from 'next/server';
import { getAuthedAddress } from '../../lib/auth';
import { extendHold } from '../../lib/redis';

/**
 * POST /api/lock
 *
 * Auth required. Extends the user's hold on a token from 15 min to 60 min,
 * which is the window in which they should call /mint-authorization and
 * submit the mint to chain.
 *
 * Body: { tokenId: number }
 * Returns: { tokenId, expiresAt, locked: true }
 *
 * 404 if the user doesn't currently hold the token (expired or someone else's).
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
    const extended = await extendHold(body.tokenId, address);
    if (!extended) {
      return NextResponse.json(
        { error: 'Hold not found or not owned by you' },
        { status: 404 }
      );
    }
    return NextResponse.json({
      tokenId: extended.tokenId,
      expiresAt: extended.expiresAt,
      locked: extended.locked,
    });
  } catch (err) {
    console.error('[lock] Error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
