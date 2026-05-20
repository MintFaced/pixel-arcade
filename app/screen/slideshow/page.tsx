'use client';

import { useEffect, useMemo, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { POOL, svgPath, type PoolGame } from '../../lib/pool';
import styles from './page.module.css';

/**
 * /screen/slideshow — full-screen rotating display for the gallery's entrance
 * pedestal screen. Loops through all 64 tokens at a configurable interval.
 *
 * URL params:
 *   ?interval=8000   — milliseconds per slide (default 8000)
 *   ?eras=8-bit,16-bit  — comma-separated era filter (default: all)
 *   ?shuffle=1       — randomize order each cycle (default: sequential)
 *
 * Visual:
 *   - Full-bleed SVG of the painting on left half
 *   - Overlay panel right: token #, title, palette swatches, claim status, mint CTA
 *
 * Claim states are currently mock (matches /collection). Once contract goes
 * live, this should be wired to useReadContract for real ownership data.
 */

const MOCK_CLAIMED_TOKEN_IDS = new Set([3, 17, 28, 41, 56]);
const MOCK_OWNERS: Record<number, string> = {
  3: 'mintface.eth',
  17: 'punk6529.eth',
  28: '0x742d35cc6669c4e7e9b3f2c4e5d0e3b8a1c5b8e9',
  41: 'vincentvanduke.eth',
  56: 'archetype.eth',
};

function formatOwner(owner: string): string {
  if (owner.endsWith('.eth') || owner.endsWith('.cb.id')) return owner;
  if (owner.startsWith('0x') && owner.length >= 10) {
    return `${owner.slice(0, 6)}…${owner.slice(-4)}`;
  }
  return owner;
}

function SlideshowInner() {
  const searchParams = useSearchParams();
  const interval = Math.max(2000, parseInt(searchParams.get('interval') ?? '8000', 10) || 8000);
  const erasParam = searchParams.get('eras');
  const shuffle = searchParams.get('shuffle') === '1';

  const slides = useMemo(() => {
    let pool: PoolGame[] = [...POOL];
    if (erasParam) {
      const allowed = new Set(erasParam.split(',').map((s) => s.trim()));
      pool = pool.filter((g) => allowed.has(g.era));
    }
    if (shuffle) {
      // Deterministic shuffle isn't needed — fresh order each mount is fine
      pool = pool
        .map((g) => ({ g, k: Math.random() }))
        .sort((a, b) => a.k - b.k)
        .map(({ g }) => g);
    }
    return pool;
  }, [erasParam, shuffle]);

  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (slides.length === 0) return;
    const id = setInterval(() => {
      setIdx((i) => (i + 1) % slides.length);
    }, interval);
    return () => clearInterval(id);
  }, [slides.length, interval]);

  if (slides.length === 0) {
    return <div className={styles.empty}>No slides — adjust era filter.</div>;
  }

  const game = slides[idx];
  const claimed = MOCK_CLAIMED_TOKEN_IDS.has(game.tokenId);
  const owner = MOCK_OWNERS[game.tokenId];

  return (
    <div className={styles.stage}>
      <div className={styles.imageWrap}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={game.tokenId}
          src={svgPath(game.tokenId)}
          alt={game.finalTitle}
          className={styles.image}
        />
      </div>

      <div className={styles.overlay}>
        <div className={styles.tokenId}>
          TOKEN #{String(game.tokenId).padStart(2, '0')}
        </div>

        <h1 className={styles.title}>
          {game.wildpixel ? 'WILD PIXEL' : game.trait.toUpperCase()}
        </h1>

        <div className={styles.subtitle}>{game.finalTitle}</div>

        <div className={styles.meta}>
          {game.era.toUpperCase()} · {game.year} · {game.grid[0]}×{game.grid[1]} = {game.grid[0] * game.grid[1]} PIXELS
        </div>

        <div className={styles.status}>
          {claimed ? (
            <>
              <span className={styles.cherry}>🍒</span>{' '}
              <span className={styles.claimedLabel}>CLAIMED</span>
              {owner && (
                <div className={styles.owner}>★ {formatOwner(owner)}</div>
              )}
            </>
          ) : (
            <>
              <span className={styles.green}>🟢</span>{' '}
              <span className={styles.availableLabel}>AVAILABLE</span>
            </>
          )}
        </div>

        <div className={styles.cta}>
          MINT LIVE → <span className={styles.url}>pixelarcade.art</span>
        </div>

        <div className={styles.progress}>
          <div
            className={styles.progressBar}
            style={{ animationDuration: `${interval}ms` }}
            key={`${game.tokenId}-${idx}`}
          />
        </div>

        <div className={styles.counter}>
          {idx + 1} / {slides.length}
        </div>
      </div>
    </div>
  );
}

export default function SlideshowPage() {
  return (
    <Suspense fallback={<div className={styles.empty}>Loading…</div>}>
      <SlideshowInner />
    </Suspense>
  );
}
