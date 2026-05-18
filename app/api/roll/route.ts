import { NextRequest, NextResponse } from 'next/server';
import { getAuthedAddress } from '../../lib/auth';
import { bumpRollCount, getRollCount, tryHoldToken } from '../../lib/redis';
import { lookupTier } from '../../lib/tier';
import { pickRandomAvailableToken, isMinted } from '../../lib/pool-state';

/**
 * POST /api/roll
 *
 * Auth required. Picks a random unminted, unheld token and creates a 15-min
 * hold for the user. Increments their daily roll count.
 *
 * Returns: { tokenId, expiresAt }
 *
 * Errors:
 *   401 — not authenticated
 *   403 — daily rolls exhausted for tier
 *   409 — pool exhausted (all tokens minted)
 *   503 — collision / try again (very rare)
 */

const MAX_ATTEMPTS = 5;

export async function POST(req: NextRequest) {
  const address = await getAuthedAddress(req);
  if (!address) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    // Check tier and current usage
    const [tier, used] = await Promise.all([
      lookupTier(address),
      getRollCount(address),
    ]);

    if (used >= tier.rollsPerDay) {
      return NextResponse.json(
        { error: 'Daily roll limit reached', rollsTotal: tier.rollsPerDay, rollsUsed: used },
        { status: 403 }
      );
    }

    // Try to claim a hold on a random available token. Retry on collision.
    let hold = null;
    let chosenTokenId: number | null = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const candidate = await pickRandomAvailableToken();
      if (candidate === null) {
        return NextResponse.json({ error: 'Pool exhausted' }, { status: 409 });
      }
      // Double-check it's not minted (race with another mint)
      if (await isMinted(candidate)) continue;

      const result = await tryHoldToken(candidate, address);
      if (result) {
        hold = result;
        chosenTokenId = candidate;
        break;
      }
      // Collision (held by someone else) — try a different token
    }

    if (!hold || chosenTokenId === null) {
      return NextResponse.json({ error: 'Try again' }, { status: 503 });
    }

    // Increment roll count now that we've successfully held a token
    await bumpRollCount(address);

    return NextResponse.json({
      tokenId: chosenTokenId,
      expiresAt: hold.expiresAt,
      rollsUsed: used + 1,
      rollsRemaining: Math.max(0, tier.rollsPerDay - (used + 1)),
    });
  } catch (err) {
    console.error('[roll] Error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
