'use client';

import styles from './UserBadge.module.css';

/**
 * UserBadge — the fourth HUD cell on my-mints.
 *
 * Priority order:
 *   1. ★ LINE ★ / #N   if on The Line
 *   2. ★ LEVEL ★ / N   if has a 6529 Level
 *   3. ★ HI-SCORE ★ / 69420   fallback for everyone else
 *
 * Right now this is hardcoded to show LINE / #42 for the mocked wallet.
 * In session 4 (wallet wiring), this becomes a hook:
 *   const badge = useUserBadge(address);
 * that returns one of the three states based on real data lookups.
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

/**
 * Hardcoded mock badge for session 3 (no wallet yet).
 * Replace with `useUserBadge()` in session 4.
 */
export const MOCK_BADGE: BadgeData = { kind: 'line', value: 42 };
