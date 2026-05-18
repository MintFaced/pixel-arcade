import { NextRequest, NextResponse } from 'next/server';
import { getAuthedAddress } from '../../lib/auth';
import { getHold, nextMintNonce } from '../../lib/redis';
import { lookupTier } from '../../lib/tier';
import { buildSignedMintAuthorization } from '../../lib/signing';
import { markMinted } from '../../lib/pool-state';
import type { Address } from 'viem';

/**
 * POST /api/mint-authorization
 *
 * Auth required. Signs an EIP-712 MintAuthorization for the given tokens.
 * Frontend submits this to the contract along with payment.
 *
 * Validates:
 *   - User is authenticated
 *   - All tokenIds are currently held (and locked) by this user
 *   - Tokens haven't already been authorized (nonce-protected)
 *
 * Marks the tokens as minted optimistically. If the user fails to submit the
 * tx within the deadline, the tokens stay in the minted set — they'd need
 * to be released manually. (Future: watch chain for non-confirmation and
 * release.)
 *
 * Body: { tokenIds: number[] }
 * Returns: SignedMintAuthorization payload
 */

interface RequestBody {
  tokenIds?: number[];
}

const DEADLINE_SECONDS = 10 * 60;  // 10 min to submit the tx

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
  if (!Array.isArray(body.tokenIds) || body.tokenIds.length === 0) {
    return NextResponse.json({ error: 'tokenIds[] required' }, { status: 400 });
  }
  if (!body.tokenIds.every((x) => typeof x === 'number' && Number.isInteger(x) && x >= 1 && x <= 64)) {
    return NextResponse.json({ error: 'Invalid tokenIds' }, { status: 400 });
  }

  try {
    // Verify the user holds (and has locked) every token in the request
    for (const tokenId of body.tokenIds) {
      const hold = await getHold(tokenId);
      if (!hold) {
        return NextResponse.json(
          { error: `Token ${tokenId} not held` },
          { status: 404 }
        );
      }
      if (hold.holder !== address) {
        return NextResponse.json(
          { error: `Token ${tokenId} held by another user` },
          { status: 403 }
        );
      }
      if (!hold.locked) {
        return NextResponse.json(
          { error: `Token ${tokenId} not locked — call /api/lock first` },
          { status: 409 }
        );
      }
    }

    // Look up the user's tier and proof for the elevated-tier check
    const tier = await lookupTier(address);

    // Get a fresh nonce
    const nonce = await nextMintNonce(address);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS);

    // Build and sign
    const signed = await buildSignedMintAuthorization({
      minter: address as Address,
      tokenIds: body.tokenIds.map((n) => BigInt(n)),
      tier: tier.tierValue,
      merkleProof: tier.proof,
      nonce,
      deadline,
    });

    // Optimistically mark tokens as minted so they leave the available pool.
    // If the user never submits the tx, these stay marked — admin can clear
    // them in a future release of this code.
    await markMinted(body.tokenIds);

    return NextResponse.json(signed);
  } catch (err) {
    console.error('[mint-authorization] Error:', err);
    const message = err instanceof Error ? err.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
