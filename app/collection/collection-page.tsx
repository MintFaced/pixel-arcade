'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { POOL, type PoolGame, type Era, svgPath, eraClass } from '../lib/pool';
import { WalletStatus } from '../components/WalletStatus';
import styles from './page.module.css';

/* ============================================================
   Mock claim states — 5 random pre-claimed tokens for visual demo.
   Session 4b replaces this with real on-chain lookup via useReadContract
   against the deployed contract's `claimedPhysical(tokenId)` mapping +
   ownerOf(tokenId) for ENS hero display.
   ============================================================ */

interface ClaimInfo {
  /** Lowercase 0x address or ENS name */
  owner: string | null;
  /** Has the physical painting been claimed */
  physicalClaimed: boolean;
}

/** Deterministic 5 pre-claimed tokens (so the demo looks consistent on every reload). */
const MOCK_CLAIMED_TOKEN_IDS = new Set([3, 17, 28, 41, 56]);
const MOCK_OWNERS: Record<number, string> = {
  3: 'mintface.eth',
  17: 'punk6529.eth',
  28: '0x742d35cc6669c4e7e9b3f2c4e5d0e3b8a1c5b8e9',
  41: 'vincentvanduke.eth',
  56: 'archetype.eth',
};

function getClaimInfo(tokenId: number): ClaimInfo {
  const claimed = MOCK_CLAIMED_TOKEN_IDS.has(tokenId);
  return {
    owner: claimed ? MOCK_OWNERS[tokenId] ?? null : null,
    physicalClaimed: claimed,
  };
}

/** Render a wallet/ENS string nicely. Truncates 0x... addresses. */
function formatOwner(owner: string): string {
  if (owner.endsWith('.eth') || owner.endsWith('.cb.id')) return owner;
  if (owner.startsWith('0x') && owner.length >= 10) {
    return `${owner.slice(0, 6)}…${owner.slice(-4)}`;
  }
  return owner;
}

/* ============================================================
   Page
   ============================================================ */

type EraFilter = 'all' | Era;

export default function CollectionPage() {
  const [eraFilter, setEraFilter] = useState<EraFilter>('all');
  const [detailToken, setDetailToken] = useState<PoolGame | null>(null);

  const filtered = useMemo(() => {
    if (eraFilter === 'all') return POOL;
    return POOL.filter((g) => g.era === eraFilter);
  }, [eraFilter]);

  // Compute counts for filter buttons
  const counts = useMemo(() => {
    const c: Record<EraFilter, number> = {
      all: POOL.length,
      '8-bit': POOL.filter((g) => g.era === '8-bit').length,
      '16-bit': POOL.filter((g) => g.era === '16-bit').length,
      '32-bit': POOL.filter((g) => g.era === '32-bit').length,
    };
    return c;
  }, []);

  const claimedCount = MOCK_CLAIMED_TOKEN_IDS.size;

  // Esc closes the detail modal
  useEffect(() => {
    if (!detailToken) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDetailToken(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detailToken]);

  return (
    <>
      <header className={styles.marquee}>
        <div className={styles.marqueeLeft}>
          <Link href="/">★ PIXELARCADE.ART</Link>
        </div>
        <div className={styles.marqueeCenter}>COLLECTION · 64 ARCADE PIXEL PAINTINGS</div>
        <div className={styles.marqueeRight}>
          <WalletStatus />
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.hero}>
          <div className={styles.heroEyebrow}>★ THE FULL COLLECTION ★</div>
          <h1 className={styles.heroTitle}>64 PAINTINGS</h1>
          <p className={styles.heroSub}>
            Click any cabinet to see full metadata. <br />
            <span className={styles.heroLegend}>
              <span className={styles.legendItem}>🍒 <em>physical claimed</em></span>
              {' · '}
              <span className={styles.legendItem}>🟢 <em>available</em></span>
            </span>
          </p>
          <p className={styles.heroStats}>
            {claimedCount} / {POOL.length} CLAIMED · {POOL.length - claimedCount} AVAILABLE
          </p>
        </section>

        <div className={styles.filters}>
          {(['all', '8-bit', '16-bit', '32-bit'] as const).map((era) => (
            <button
              key={era}
              type="button"
              className={`${styles.filterBtn} ${eraFilter === era ? styles.filterActive : ''}`}
              onClick={() => setEraFilter(era)}
            >
              {era === 'all' ? 'ALL' : era.toUpperCase()} · {counts[era]}
            </button>
          ))}
        </div>

        <div className={styles.grid}>
          {filtered.map((game) => {
            const info = getClaimInfo(game.tokenId);
            return (
              <button
                key={game.id}
                type="button"
                className={`${styles.cabinet} ${styles[eraClass(game.era)]} ${info.physicalClaimed ? styles.claimed : ''}`}
                onClick={() => setDetailToken(game)}
              >
                <div className={styles.cabinetTop}>
                  <span className={styles.tokenIdLabel}>#{String(game.tokenId).padStart(2, '0')}</span>
                  <span className={styles.claimDot}>{info.physicalClaimed ? '🍒' : '🟢'}</span>
                </div>
                <div className={styles.cabinetImage}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={svgPath(game.tokenId)} alt={game.finalTitle} loading="lazy" />
                </div>
                <div className={styles.cabinetMeta}>
                  <div className={styles.cabinetTitle}>
                    {game.wildpixel ? 'WILD PIXEL' : game.trait.toUpperCase()}
                  </div>
                  <div className={styles.cabinetSub}>
                    {game.era.toUpperCase()} · {game.year}
                  </div>
                  {info.owner && (
                    <div className={styles.cabinetOwner}>
                      ★ {formatOwner(info.owner)}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </main>

      <footer className={styles.collectionFooter}>
        <div>SHIPS IN 2-3 WEEKS · READY TO HANG · UNFRAMED ·</div>
        <div>SHIPPED FROM THE LINE GALLERY NEW ZEALAND</div>
      </footer>

      {detailToken && (
        <DetailModal
          game={detailToken}
          info={getClaimInfo(detailToken.tokenId)}
          onClose={() => setDetailToken(null)}
        />
      )}
    </>
  );
}

/* ============================================================
   Palette data — combines catalog.json swatches with the poetic
   names from palette-names.json. Lazy-loaded the first time a
   detail modal opens.
   ============================================================ */

interface PaletteSwatch {
  hex: string;
  /** Poetic name from palette-names.json, e.g. "jungle bg", "Harry skin" */
  name: string | null;
}

interface CatalogEntry {
  token_id: number;
  swatches: string[];
}

let cachedCatalog: Record<number, string[]> | null = null;
let cachedNames: Record<number, { hex: string; name: string }[]> | null = null;
let paletteLoadPromise: Promise<void> | null = null;

async function ensurePaletteData(): Promise<void> {
  if (cachedCatalog && cachedNames) return;
  if (paletteLoadPromise) return paletteLoadPromise;
  paletteLoadPromise = (async () => {
    try {
      const [catalogResp, namesResp] = await Promise.all([
        fetch('/svg/catalog.json', { cache: 'force-cache' }),
        fetch('/palette-names.json', { cache: 'force-cache' }),
      ]);
      if (catalogResp.ok) {
        const cat = (await catalogResp.json()) as CatalogEntry[];
        cachedCatalog = {};
        for (const e of cat) cachedCatalog[e.token_id] = e.swatches;
      } else {
        cachedCatalog = {};
      }
      if (namesResp.ok) {
        cachedNames = (await namesResp.json()) as Record<number, { hex: string; name: string }[]>;
      } else {
        cachedNames = {};
      }
    } catch {
      cachedCatalog = cachedCatalog ?? {};
      cachedNames = cachedNames ?? {};
    }
  })();
  return paletteLoadPromise;
}

function getPalette(tokenId: number): PaletteSwatch[] {
  const swatches = cachedCatalog?.[tokenId];
  if (!swatches) return [];
  // Build a hex→name lookup from the names file (case-insensitive)
  const nameEntries = cachedNames?.[tokenId] ?? [];
  const nameByHex: Record<string, string> = {};
  for (const ne of nameEntries) {
    nameByHex[ne.hex.toLowerCase()] = ne.name;
  }
  return swatches.map((hex) => ({
    hex,
    name: nameByHex[hex.toLowerCase()] ?? null,
  }));
}

/* ============================================================
   Detail modal — token metadata + owner display
   ============================================================ */

function DetailModal({
  game,
  info,
  onClose,
}: {
  game: PoolGame;
  info: ClaimInfo;
  onClose: () => void;
}) {
  const [palette, setPalette] = useState<PaletteSwatch[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await ensurePaletteData();
      if (!cancelled) setPalette(getPalette(game.tokenId));
    })();
    return () => { cancelled = true; };
  }, [game.tokenId]);

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <button type="button" className={styles.modalClose} onClick={onClose} aria-label="Close">
          ✕
        </button>

        <div className={styles.modalEyebrow}>
          ▼ TOKEN #{String(game.tokenId).padStart(2, '0')} ▼
        </div>

        <div className={styles.modalImage}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={svgPath(game.tokenId)} alt={game.finalTitle} />
        </div>

        <div className={styles.modalBody}>
          <h2 className={styles.modalTitle}>
            {game.wildpixel ? 'WILD PIXEL' : game.trait.toUpperCase()}
          </h2>
          <div className={styles.modalSubtitle}>{game.finalTitle}</div>

          <dl className={styles.modalMeta}>
            <div className={styles.metaRow}>
              <dt>Era</dt>
              <dd>{game.era}</dd>
            </div>
            <div className={styles.metaRow}>
              <dt>Year</dt>
              <dd>{game.year}</dd>
            </div>
            <div className={styles.metaRow}>
              <dt>Source Game</dt>
              <dd>{game.trait}</dd>
            </div>
            <div className={styles.metaRow}>
              <dt>Pixel Grid</dt>
              <dd>{game.grid[0]} × {game.grid[1]} = {game.grid[0] * game.grid[1]} pixels</dd>
            </div>
            {game.wildpixel && (
              <div className={styles.metaRow}>
                <dt>Type</dt>
                <dd className={styles.metaHighlight}>Wild Pixel · collector chooses palette</dd>
              </div>
            )}
            <div className={styles.metaRow}>
              <dt>Physical</dt>
              <dd>
                {info.physicalClaimed
                  ? <span className={styles.statusClaimed}>🍒 CLAIMED</span>
                  : <span className={styles.statusAvailable}>🟢 AVAILABLE</span>}
              </dd>
            </div>
            {info.owner && (
              <div className={styles.metaRow}>
                <dt>Owner</dt>
                <dd className={styles.metaHero}>★ {formatOwner(info.owner)}</dd>
              </div>
            )}
          </dl>

          {palette && palette.length > 0 && (
            <div className={styles.paletteSection}>
              <div className={styles.paletteLabel}>★ PALETTE ★</div>
              <ul className={styles.paletteList}>
                {palette.map((sw, i) => (
                  <li key={`${sw.hex}-${i}`} className={styles.paletteItem}>
                    <span
                      className={styles.paletteSwatch}
                      style={{ background: sw.hex }}
                      aria-hidden="true"
                    />
                    <span className={styles.paletteHex}>{sw.hex.toUpperCase()}</span>
                    {sw.name && <span className={styles.paletteName}>{sw.name}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
