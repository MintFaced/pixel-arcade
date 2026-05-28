import type { Metadata, Viewport } from 'next';
import CrtOverlays from './components/CrtOverlays';
import { Web3Providers } from './components/Web3Providers';
import './globals.css';

export const metadata: Metadata = {
  title: '★ PIXELARCADE.ART ★',
  description:
    '64 1/1 NFT pixel paintings derived from 8-bit, 16-bit, and 32-bit game palettes. Hand-mixed physical paintings on plywood.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1.0,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Web3Providers>
          <CrtOverlays />
          {children}
        </Web3Providers>
      </body>
    </html>
  );
}
