'use client';

import { ReactNode, useState } from 'react';
import { WagmiProvider } from 'wagmi';
import { RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { wagmiConfig } from '../lib/wagmiConfig';

import '@rainbow-me/rainbowkit/styles.css';

/**
 * Web3Providers — must be a client component so wagmi's React context
 * works correctly. Wrapped around the app at the root layout level.
 *
 * Theme:
 *   RainbowKit's darkTheme is customized to match the CRT palette.
 *   We override accent color (magenta), accent contrast (white), border
 *   colors, and the font. Wallet icons (MetaMask, Rabby etc.) stay as
 *   their official logos — those aren't restyleable.
 */
export function Web3Providers({ children }: { children: ReactNode }) {
  // QueryClient is created lazily so it doesn't get shared across SSR requests
  // (Next.js best practice — otherwise mutations leak across users)
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: { staleTime: 60_000 }, // 1 min cache for chain reads
    },
  }));

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={darkTheme({
            accentColor: '#CB02B2',          // --face-pink
            accentColorForeground: '#ffffff',
            borderRadius: 'none',            // arcade-y blocks, no rounded
            fontStack: 'system',             // RainbowKit doesn't expose font override directly
            overlayBlur: 'small',
          })}
          modalSize="compact"
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
