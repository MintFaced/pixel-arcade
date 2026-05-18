import { NextResponse } from 'next/server';

/**
 * GET /api/health
 *
 * Reports config status. Useful for confirming env vars are wired correctly
 * before debugging deeper.
 */

export async function GET() {
  const status = {
    ok: true,
    env: {
      hasUpstash: Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN),
      hasJwtSecret: Boolean(process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32),
      hasResend: Boolean(process.env.RESEND_API_KEY),
      hasSigner: Boolean(process.env.MINT_SIGNER_PRIVATE_KEY),
      hasContractAddress: Boolean(process.env.CONTRACT_ADDRESS),
      chainId: process.env.CHAIN_ID ?? '11155111',
    },
    signerAddress: null as string | null,
  };

  // Try to derive signer address without exposing the private key
  if (status.env.hasSigner) {
    try {
      const { getSignerAddress } = await import('../../lib/signing');
      status.signerAddress = getSignerAddress();
    } catch (err) {
      console.error('[health] Could not derive signer address:', err);
    }
  }

  return NextResponse.json(status);
}
