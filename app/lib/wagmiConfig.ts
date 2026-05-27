'use client';

import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { sepolia, mainnet } from 'wagmi/chains';
import { http } from 'wagmi';

/**
 * Wagmi + RainbowKit configuration.
 *
 * Chains:
 *   - Sepolia (primary) — where mints happen during testnet phase
 *   - Mainnet (read-only) — for ENS resolution and Line lookup
 *
 * RPC transports:
 *   - Uses Alchemy for both chains when NEXT_PUBLIC_ALCHEMY_KEY is set
 *   - Falls back to wagmi defaults (public RPCs) without the key
 *
 * Public RPCs (like eth.merkle.io that wagmi defaults to for mainnet) block
 * browser requests via CORS — they only allow server-side calls. That breaks
 * ENS resolution during SIWE sign-in, which can cascade into the whole sign-in
 * flow stalling. Using Alchemy fixes this because Alchemy allows CORS from any
 * origin when you use a project key.
 *
 * WalletConnect:
 *   - Requires NEXT_PUBLIC_WC_PROJECT_ID from https://cloud.walletconnect.com
 *   - Browser wallets (MetaMask, Rabby) work without it
 */

const projectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? 'PIXELARCADE_DEV_PLACEHOLDER';
const alchemyKey = process.env.NEXT_PUBLIC_ALCHEMY_KEY;

/** Build a transport for a given chain — Alchemy if key is set, else undefined (wagmi default). */
function transportFor(chainPrefix: string) {
  if (!alchemyKey) return undefined;
  return http(`https://${chainPrefix}.g.alchemy.com/v2/${alchemyKey}`);
}

const sepoliaTransport = transportFor('eth-sepolia');
const mainnetTransport = transportFor('eth-mainnet');

export const wagmiConfig = getDefaultConfig({
  appName: 'PixelArcade',
  projectId,
  chains: [sepolia, mainnet],
  ssr: true, // Required for Next.js App Router — prevents hydration mismatches
  // Only pass transports if we have at least one (Alchemy key present)
  ...(sepoliaTransport && mainnetTransport
    ? {
        transports: {
          [sepolia.id]: sepoliaTransport,
          [mainnet.id]: mainnetTransport,
        },
      }
    : {}),
});

/** The chain we expect users to mint on (toggle to mainnet for production). */
export const ACTIVE_CHAIN_ID = sepolia.id;
