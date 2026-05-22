'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  BOSSES, ENEMIES, POWERUPS, COLLECTIBLES, CHAPTERS,
  type CharacterEntry,
} from './data';
import styles from './page.module.css';

/**
 * /characters — SWARM bestiary.
 *
 * Tabbed page showing every boss, enemy, power-up, collectible, and chapter
 * background. External links to OpenSea / XNouns / Nouns for provenance.
 *
 * MintFace is gated: shown as locked silhouette "???" until the player has
 * beaten him at least once. Engine sets a localStorage flag on true-victory.
 */

type TabId = 'bosses' | 'enemies' | 'powerups' | 'collectibles' | 'chapters';

const TABS: { id: TabId; label: string }[] = [
  { id: 'bosses',       label: 'BOSSES' },
  { id: 'enemies',      label: 'ENEMIES' },
  { id: 'powerups',     label: 'POWER-UPS' },
  { id: 'collectibles', label: 'COLLECTIBLES' },
  { id: 'chapters',     label: 'CHAPTERS' },
];

const TRUE_ENDING_KEY = 'pixelarcade_swarm_true_ending';

export default function CharactersPage() {
  const [activeTab, setActiveTab] = useState<TabId>('bosses');
  const [unlockedSecret, setUnlockedSecret] = useState(false);

  // Read localStorage on mount — secrets unlock after true ending
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      setUnlockedSecret(localStorage.getItem(TRUE_ENDING_KEY) === 'true');
    } catch {
      // Some privacy modes block localStorage — treat as locked
    }
  }, []);

  const entries = useMemo<CharacterEntry[]>(() => {
    switch (activeTab) {
      case 'bosses':       return BOSSES;
      case 'enemies':      return ENEMIES;
      case 'powerups':     return POWERUPS;
      case 'collectibles': return COLLECTIBLES;
      case 'chapters':     return CHAPTERS;
    }
  }, [activeTab]);

  return (
    <>
      <header className={styles.marquee}>
        <div className={styles.marqueeLeft}>
          <Link href="/">★ PIXELARCADE.ART</Link>
        </div>
        <div className={styles.marqueeCenter}>CHARACTERS</div>
        <div className={styles.marqueeRight}>
          <Link href="/play" className={styles.playLink}>▶ PLAY</Link>
        </div>
      </header>

      <main className={styles.main}>
        <h1 className={styles.pageTitle}>SWARM BESTIARY</h1>
        <p className={styles.pageSub}>
          Every character, enemy, power-up, and background is CC0 art with
          on-chain provenance. Tap any source link to view the original NFT.
        </p>

        {/* Tabs */}
        <nav className={styles.tabs}>
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`${styles.tab} ${activeTab === t.id ? styles.tabActive : ''}`}
              onClick={() => setActiveTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {/* Cards */}
        <section className={styles.cards}>
          {entries.map((e) => (
            <Card key={e.id} entry={e} unlocked={unlockedSecret} />
          ))}
        </section>

        {activeTab === 'bosses' && !unlockedSecret && (
          <p className={styles.secretHint}>
            ★ Beat all 30 waves to unlock the secret entry ★
          </p>
        )}
      </main>
    </>
  );
}

function Card({ entry, unlocked }: { entry: CharacterEntry; unlocked: boolean }) {
  const isLocked = !!entry.locked && !unlocked;

  return (
    <article className={`${styles.card} ${isLocked ? styles.cardLocked : ''}`}>
      <div className={styles.cardSpriteWrap}>
        {isLocked ? (
          <div className={styles.lockedSilhouette} aria-label="Locked character">?</div>
        ) : (
          <img
            src={entry.sprite}
            alt={entry.name}
            className={styles.cardSprite}
          />
        )}
      </div>

      <div className={styles.cardBody}>
        <div className={styles.cardName}>
          {isLocked ? '???' : entry.name}
        </div>
        <div className={styles.cardSubtitle}>
          {isLocked ? 'BEAT MAX PAIN TO REVEAL' : entry.subtitle}
        </div>

        {!isLocked && (
          <p className={styles.cardDesc}>{entry.description}</p>
        )}

        {!isLocked && entry.stats && entry.stats.length > 0 && (
          <dl className={styles.cardStats}>
            {entry.stats.map((s) => (
              <div key={s.label} className={styles.cardStat}>
                <dt className={styles.cardStatLabel}>{s.label}</dt>
                <dd className={styles.cardStatValue}>{s.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {!isLocked && entry.source && (
          <a
            href={entry.source.href}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.cardSource}
          >
            {entry.source.label} ↗
          </a>
        )}
      </div>
    </article>
  );
}
