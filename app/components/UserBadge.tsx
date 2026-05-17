'use client';

import { useUserBadge } from '../lib/useUserBadge';
import styles from './UserBadge.module.css';

/**
 * UserBadge — the fourth HUD cell on my-mints.
 *
 * Priority order:
 *   1. ★ LINE ★ / #N   if on The Line
 *   2. ★ LEVEL ★ / N   if has a 6529 Level
 *   3. ★ HI-SCORE ★ / 69420   fallback for everyone else
 *
 * Two flavors:
 *   - <UserBadge badge={badge} /> — presentational, takes any badge data
 *   - <ConnectedUserBadge />     — wires to wallet via useUserBadge hook
 *
 * Use ConnectedUserBadge in actual pages; UserBadge is exported for testing
 * and for places that want to display a specific badge state directly.
 */

export type BadgeKind = 'line' | 'level' | 'hi-score';

export interface BadgeData {
  kind: BadgeKind;
  value: number;
}

const LABELS: Record<BadgeKind, string> = {
  'line': 'LINE',
  'level': 'LEVEL',
  'hi-score': 'HI-SCORE',
};

const PREFIXES: Record<BadgeKind, string> = {
  'line': '#',
  'level': '',
  'hi-score': '',
};

export function UserBadge({ badge }: { badge: BadgeData }) {
  const label = LABELS[badge.kind];
  const prefix = PREFIXES[badge.kind];
  // Hi-score uses pink, line uses yellow (curated/special), level uses cyan
  const colorClass =
    badge.kind === 'hi-score'
      ? styles.pink
      : badge.kind === 'line'
        ? styles.yellow
        : styles.cyan;
  return (
    <>
      <div className={styles.hudLabel}>★ {label} ★</div>
      <div className={`${styles.hudValue} ${colorClass}`}>
        {prefix}{badge.value}
      </div>
    </>
  );
}

/** Wallet-connected variant — call this inside pages. */
export function ConnectedUserBadge() {
  const badge = useUserBadge();
  return <UserBadge badge={badge} />;
}

/**
 * Test/preview badge data — fixed Line #42, useful for previews where you
 * don't want to wire up a wallet. NOT used in production pages.
 */
export const MOCK_BADGE: BadgeData = { kind: 'line', value: 42 };
