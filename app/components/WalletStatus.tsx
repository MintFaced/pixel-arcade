'use client';

import { useEffect, useState } from 'react';
import { useAccount, useDisconnect, useEnsName } from 'wagmi';
import { useConnectModal, useAccountModal } from '@rainbow-me/rainbowkit';
import { mainnet } from 'wagmi/chains';
import styles from './WalletStatus.module.css';

/**
 * WalletStatus — drop-in replacement for the mocked wallet text in the marquee.
 *
 * States:
 *   - SSR / pre-mount: shows "CONNECT" (no flash, matches disconnected look)
 *   - Disconnected:    "▶ CONNECT" button — opens RainbowKit modal
 *   - Connecting:      "CONNECTING…" with blink
 *   - Connected:       "vitalik.eth" or "0xabc…1234" — clickable, opens RainbowKit's account modal
 *
 * The tier badge / rolls count is rendered separately by the marquee since
 * its data comes from the tier lookup once we wire that in session 4b.
 */
export function WalletStatus() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const { address, isConnected, isConnecting, isReconnecting } = useAccount();
  // Always resolve ENS against mainnet (Sepolia doesn't have ENS in any meaningful way)
  const { data: ensName } = useEnsName({ address, chainId: mainnet.id });
  const { openConnectModal } = useConnectModal();
  const { openAccountModal } = useAccountModal();

  // Server render + pre-mount: render the disconnected state. Once mounted on
  // the client, the real state takes over. This avoids the hydration flicker
  // where we briefly show one thing then snap to another.
  if (!mounted) {
    return (
      <button className={styles.connectBtn} disabled aria-label="Loading wallet status">
        CONNECT
      </button>
    );
  }

  if (isConnecting || isReconnecting) {
    return (
      <span className={`${styles.connectingBadge}`}>
        CONNECTING<span className={styles.dots}>…</span>
      </span>
    );
  }

  if (!isConnected || !address) {
    return (
      <button
        type="button"
        className={styles.connectBtn}
        onClick={() => openConnectModal?.()}
      >
        ▶ CONNECT
      </button>
    );
  }

  // Connected — show ENS if available, otherwise truncated address
  const display = ensName ?? truncateAddress(address);
  return (
    <button
      type="button"
      className={styles.connectedBadge}
      onClick={() => openAccountModal?.()}
      aria-label={`Connected as ${display} — click to open account menu`}
    >
      {display}
    </button>
  );
}

function truncateAddress(addr: string): string {
  if (addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/**
 * Disconnect helper — exposed for places that need an explicit disconnect
 * button (e.g. account menu when we add one). Currently RainbowKit's own
 * account modal handles this.
 */
export function useWalletDisconnect() {
  return useDisconnect();
}
