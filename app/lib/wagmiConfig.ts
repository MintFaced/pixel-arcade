'use client';

import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { sepolia, mainnet, type Chain } from 'wagmi/chains';
import { http } from 'wagmi';

/**
 * Wagmi + RainbowKit configuration.
 *
 * Chain selection is driven by NEXT_PUBLIC_CHAIN_ID. The whole app reads
 * from ACTIVE_CHAIN / ACTIVE_CHAIN_ID / ETHERSCAN_BASE below, so flipping
 * from testnet to mainnet is a single env-var change — no code edits.
 *
 *   NEXT_PUBLIC_CHAIN_ID=11155111  →  Sepolia testnet
 *   NEXT_PUBLIC_CHAIN_ID=1         →  Ethereum mainnet
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

/**
 * Active chain — driven by NEXT_PUBLIC_CHAIN_ID env var. Defaults to Sepolia
 * for safety (if the var is missing or malformed, we don't accidentally
 * route to mainnet).
 *
 * Note we use NEXT_PUBLIC_CHAIN_ID here (client-readable), separate from the
 * server-only CHAIN_ID that the EIP-712 signing route uses. They must match.
 */
const envChainId = process.env.NEXT_PUBLIC_CHAIN_ID;
export const ACTIVE_CHAIN: Chain = envChainId === '1' ? mainnet : sepolia;
export const ACTIVE_CHAIN_ID: number = ACTIVE_CHAIN.id;
export const ACTIVE_CHAIN_NAME: string = ACTIVE_CHAIN.name;

/**
 * Etherscan URL base for the active chain. Used for tx links in the UI.
 * Mainnet: https://etherscan.io
 * Sepolia: https://sepolia.etherscan.io
 */
export const ETHERSCAN_BASE: string =
  ACTIVE_CHAIN_ID === mainnet.id
    ? 'https://etherscan.io'
    : 'https://sepolia.etherscan.io';

/** Build a tx URL for the active chain. */
export function txUrl(txHash: string): string {
  return `${ETHERSCAN_BASE}/tx/${txHash}`;
}

/** Build an address URL for the active chain. */
export function addressUrl(addr: string): string {
  return `${ETHERSCAN_BASE}/address/${addr}`;
}

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

