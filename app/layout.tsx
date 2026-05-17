import type { Metadata, Viewport } from 'next';
import Gate from './components/Gate';
import CrtOverlays from './components/CrtOverlays';
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
  // Tiny inline script: read sessionStorage before React hydrates and set a
  // body class. Gate CSS checks this class and hides itself instantly for
  // returning users — no flash of the unlock screen.
  const preHydrationScript = `
    try {
      if (sessionStorage.getItem('pixelarcade_unlocked') === '1') {
        document.documentElement.classList.add('pa-unlocked');
      }
    } catch (e) {}
  `;

  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: preHydrationScript }} />
      </head>
      <body>
        <Gate />
        <CrtOverlays />
        {children}
      </body>
    </html>
  );
}
