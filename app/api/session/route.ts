import { NextRequest, NextResponse } from 'next/server';
import { getAuthedAddress } from '../../lib/auth';
import { getRollCount, getUserHolds } from '../../lib/redis';
import { lookupTier } from '../../lib/tier';

/**
 * GET /api/session
 *
 * Auth required (session cookie or Bearer JWT).
 * Returns the authenticated user's tier, daily rolls allowance, rolls used
 * so far in this 24h window, and any current token holds.
 */

export async function GET(req: NextRequest) {
  const address = await getAuthedAddress(req);
  if (!address) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const [tier, rollsUsed, holds] = await Promise.all([
      lookupTier(address),
      getRollCount(address),
      getUserHolds(address),
    ]);

    return NextResponse.json({
      address,
      tier: tier.tier,
      tierValue: tier.tierValue,
      rollsTotal: tier.rollsPerDay,
      rollsUsed,
      rollsRemaining: Math.max(0, tier.rollsPerDay - rollsUsed),
      proof: tier.proof,
      holds: holds.map((h) => ({
        tokenId: h.tokenId,
        expiresAt: h.expiresAt,
        locked: h.locked,
      })),
    });
  } catch (err) {
    console.error('[session] Error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
