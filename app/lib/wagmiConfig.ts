'use client';

import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { sepolia, mainnet } from 'wagmi/chains';

/**
 * Wagmi + RainbowKit configuration.
 *
 * Chains:
 *   - Sepolia (dev/test) — primary for session 4a, allows wallet testing without real funds
 *   - Mainnet (read-only for ENS resolution + Line lookup; minting comes later)
 *
 * RPC:
 *   - Falls back to wagmi/RainbowKit defaults (public RPCs).
 *   - In production, set NEXT_PUBLIC_ALCHEMY_KEY and we'd plug in Alchemy transports.
 *
 * WalletConnect:
 *   - Requires a project ID from https://cloud.walletconnect.com
 *   - Set NEXT_PUBLIC_WC_PROJECT_ID in Vercel env vars (and .env.local for dev)
 *   - If missing, WalletConnect will be disabled but browser wallets (MetaMask, Rabby) still work.
 */

const projectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? 'PIXELARCADE_DEV_PLACEHOLDER';

export const wagmiConfig = getDefaultConfig({
  appName: 'PixelArcade',
  projectId,
  chains: [sepolia, mainnet],
  ssr: true, // Required for Next.js App Router — prevents hydration mismatches
});

/** The chain we expect users to mint on (toggle to mainnet for production). */
export const ACTIVE_CHAIN_ID = sepolia.id;
