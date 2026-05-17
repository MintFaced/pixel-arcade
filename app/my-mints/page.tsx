'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { svgPath, type Era } from '../lib/pool';
import { arrange, buildInlineSvg, extractDominantColors } from '../lib/wildpixel';
import { loadCatalog, findCatalogEntry } from '../lib/catalog';
import { UserBadge, MOCK_BADGE } from '../components/UserBadge';
import styles from './page.module.css';

/* ============================================================
   Domain types
   ============================================================ */
type WorkStatus = 'minted' | 'awaiting-palette';
type FilterKey = 'all' | '8-bit' | '16-bit' | '32-bit' | 'wildpixel';

interface Work {
  id: string;
  tokenId: number;
  trait: string | null;
  finalTitle: string;
  era: Era;
  year: number | null;
  grid: [number, number];
  status: WorkStatus;
  physical: boolean;
  wildpixel: boolean;
  /** When a wildpixel is locked in this session, we keep the chosen
   * arrangement here so the gallery can render it inline. */
  completedCells?: string[];
}

interface PostMintPayload {
  tokenIds: number[];
  mintedAt: number;
  txHash: string;
}

interface WildpixelModalState {
  workId: string;
  step: 1 | 2 | 3 | 4;
  extracted: { dataURL: string; colors: string[] } | null;
  arrangementSeed: number;
  rerollsLeft: number;
  trait: string;
}

/* ============================================================
   Pricing
   ============================================================ */
const PRICES: Record<Era, { painting: number; shipping: number }> = {
  '8-bit':  { painting: 0.25, shipping: 0.25 },
  '16-bit': { painting: 0.50, shipping: 0.25 },
  '32-bit': { painting: 1.00, shipping: 0.25 },
};
const BUNDLE_THRESHOLD = 5;
const BUNDLE_SHIPPING_SAVED = 0.25;

function eraToClass(era: Era): 'era-8' | 'era-16' | 'era-32' {
  return `era-${era.split('-')[0]}` as 'era-8' | 'era-16' | 'era-32';
}

/* ============================================================
   Main page component
   ============================================================ */
export default function MyMintsPage() {
  /** Works the user "owns" — empty by default in this prototype.
   * Populated by the post-mint hand-off via sessionStorage. */
  const [works, setWorks] = useState<Work[]>([]);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [modal, setModal] = useState<WildpixelModalState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ count: number; txHash: string } | null>(null);

  /* ----------------------------------------------------------
     ESC closes drawer or modal — nice keyboard UX
     ---------------------------------------------------------- */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      // Modal has its own handler, but it doesn't hurt to also close drawer
      // from here; if both were open, this hits drawer first which is fine.
      if (drawerOpen) setDrawerOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  /* ----------------------------------------------------------
     Toast lifecycle
     ---------------------------------------------------------- */
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  /* ----------------------------------------------------------
     Post-mint banner lifecycle — auto-fade at 12s
     ---------------------------------------------------------- */
  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 12000);
    return () => clearTimeout(t);
  }, [banner]);

  /* ----------------------------------------------------------
     Post-mint hand-off — read sessionStorage on mount, resolve
     token IDs against the catalog, build Work objects, pre-select
     for physical claim, open drawer after a beat.
     ---------------------------------------------------------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let raw: string | null = null;
      try {
        raw = sessionStorage.getItem('pixelarcade_post_mint_claim');
      } catch {
        return; // sessionStorage unavailable (private mode etc.)
      }
      if (!raw) return;
      try {
        sessionStorage.removeItem('pixelarcade_post_mint_claim');
      } catch {/* ignore */}

      let payload: PostMintPayload;
      try {
        payload = JSON.parse(raw);
      } catch {
        return;
      }
      if (!payload?.tokenIds?.length) return;

      const catalog = await loadCatalog();
      if (cancelled) return;
      if (catalog.length === 0) return;

      const newWorks: Work[] = [];
      let nextId = 1;
      const preSelect = new Set<string>();

      for (const tokenId of payload.tokenIds) {
        const entry = findCatalogEntry(catalog, tokenId);
        if (!entry) continue;
        const w: Work = {
          id: `m${nextId++}`,
          tokenId: entry.token_id,
          trait: entry.wildpixel ? null : entry.name,
          finalTitle: entry.art_title,
          era: entry.era,
          year: entry.wildpixel ? null : entry.year,
          grid: [entry.grid.rows, entry.grid.cols],
          status: entry.wildpixel ? 'awaiting-palette' : 'minted',
          physical: false,
          wildpixel: entry.wildpixel,
        };
        newWorks.push(w);
        // Pre-select eligible works for physical claim
        if (!w.wildpixel) preSelect.add(w.id);
      }

      setWorks(newWorks);
      setSelected(preSelect);

      // Auto-open drawer after a beat, show banner immediately
      setBanner({ count: newWorks.length, txHash: payload.txHash });
      setTimeout(() => {
        if (!cancelled) setDrawerOpen(true);
      }, 800);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  /* ----------------------------------------------------------
     Derived counts for the HUD
     ---------------------------------------------------------- */
  const stats = useMemo(() => {
    return {
      total: works.length,
      physical: works.filter((w) => w.physical).length,
      wildpixel: works.filter((w) => w.wildpixel && w.status === 'awaiting-palette').length,
    };
  }, [works]);

  /* ----------------------------------------------------------
     Filtered works for gallery
     ---------------------------------------------------------- */
  const filteredWorks = useMemo(() => {
    if (filter === 'all') return works;
    if (filter === 'wildpixel') return works.filter((w) => w.wildpixel);
    return works.filter((w) => w.era === filter);
  }, [works, filter]);

  /* ----------------------------------------------------------
     Selection actions
     ---------------------------------------------------------- */
  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAllToggle = useCallback(() => {
    const eligible = works.filter(
      (w) => !w.physical && !(w.wildpixel && w.status === 'awaiting-palette')
    );
    setSelected((prev) => {
      const allSelected = eligible.every((w) => prev.has(w.id));
      const next = new Set(prev);
      if (allSelected) {
        eligible.forEach((w) => next.delete(w.id));
      } else {
        eligible.forEach((w) => next.add(w.id));
      }
      return next;
    });
  }, [works]);

  /* ----------------------------------------------------------
     Checkout — flip selected works to physical, close drawer
     ---------------------------------------------------------- */
  const handleCheckout = useCallback(() => {
    const selectedIds = Array.from(selected);
    if (selectedIds.length === 0) return;
    setWorks((prev) =>
      prev.map((w) => (selected.has(w.id) ? { ...w, physical: true } : w))
    );
    setSelected(new Set());
    setDrawerOpen(false);
    setToast(`★ ORDER CONFIRMED · ${selectedIds.length} QUEUED ★`);
  }, [selected]);

  /* ----------------------------------------------------------
     Wildpixel modal — open with fresh state
     ---------------------------------------------------------- */
  const openWildpixelModal = useCallback((workId: string) => {
    setModal({
      workId,
      step: 1,
      extracted: null,
      arrangementSeed: Math.floor(Math.random() * 100000),
      rerollsLeft: 3,
      trait: '',
    });
  }, []);

  const closeWildpixelModal = useCallback(() => {
    setModal(null);
  }, []);

  /* ----------------------------------------------------------
     Wildpixel lock — write completed cells onto the Work,
     promote status from awaiting-palette to minted.
     ---------------------------------------------------------- */
  const lockWildpixel = useCallback(() => {
    if (!modal) return;
    if (!modal.extracted || modal.trait.trim().length === 0) return;
    const work = works.find((w) => w.id === modal.workId);
    if (!work) return;
    const [rows, cols] = work.grid;
    const cells = arrange(modal.extracted.colors, rows, cols, modal.arrangementSeed);
    setWorks((prev) =>
      prev.map((w) =>
        w.id === modal.workId
          ? { ...w, completedCells: cells, trait: modal.trait.trim(), status: 'minted' }
          : w
      )
    );
    closeWildpixelModal();
    setToast('★ WILDPIXEL LOCKED · METADATA WRITTEN ★');
  }, [modal, works, closeWildpixelModal]);

  /* ----------------------------------------------------------
     Render
     ---------------------------------------------------------- */
  return (
    <>
      {banner && (
        <PostMintBanner
          count={banner.count}
          txHash={banner.txHash}
          onClose={() => setBanner(null)}
        />
      )}

      <div className={styles.marquee}>
        <div className={styles.marqueeTitle}>
          <span className={styles.star}>★</span>{' '}
          <Link href="/" className={styles.marqueeLink}>PIXELARCADE.ART</Link>{' '}
          <span className={styles.star}>★</span>
        </div>
        <div className={styles.marqueeStatus}>
          <span className={styles.player1}>PLAYER 1</span>
          <span className={styles.wallet}>0x7A3F…B9C2</span>
          <span className={styles.insertcoinTier}>★ TDH WHALE ★</span>
        </div>
      </div>

      <div className={styles.hud}>
        <div className={styles.hudCell}>
          <div className={styles.hudLabel}>MINTED</div>
          <div className={styles.hudValue}>{String(stats.total).padStart(2, '0')}</div>
        </div>
        <div className={styles.hudCell}>
          <div className={styles.hudLabel}>PHYSICAL</div>
          <div className={`${styles.hudValue} ${styles.green}`}>
            {String(stats.physical).padStart(2, '0')}
          </div>
        </div>
        <div className={styles.hudCell}>
          <div className={styles.hudLabel}>WILDPIXEL</div>
          <div className={`${styles.hudValue} ${styles.magenta}`}>
            {String(stats.wildpixel).padStart(2, '0')}
          </div>
        </div>
        <div className={styles.hudCell}>
          <UserBadge badge={MOCK_BADGE} />
        </div>
      </div>

      <section className={styles.titleBlock}>
        <div className={styles.titleEyebrow}>▼ COLLECTOR · ROOM 01 ▼</div>
        <h1 className={styles.titleH1}>
          YOUR<br />MINTS<span className={styles.blinkCursor} />
        </h1>
        <p className={styles.titleSub}>
          Your <span className={styles.hlCyan}>NFT MINTS</span> from the{' '}
          <span className={styles.hlYellow}>8-BIT · 16-BIT · 32-BIT</span> eras.<br />
          Claim <span className={styles.hlPink}>PAINTING</span> wen ready. Complete{' '}
          <span className={styles.hlPink}>WILDPIXEL</span> palettes if qualified.
        </p>
      </section>

      <div className={styles.filterStrip}>
        {(['all', '8-bit', '16-bit', '32-bit', 'wildpixel'] as FilterKey[]).map((key) => {
          const label =
            key === 'all' ? 'ALL'
              : key === 'wildpixel' ? 'WILDPIXELS'
                : key.toUpperCase();
          return (
            <button
              key={key}
              className={`${styles.filterBtn} ${filter === key ? styles.active : ''}`}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className={styles.toolbarRow}>
        <div className={styles.toolbarActions}>
          <button className={`${styles.coinBtn} ${styles.ghost}`} onClick={selectAllToggle}>
            + SELECT ALL
          </button>
          <button className={styles.coinBtn} onClick={() => setDrawerOpen(true)}>
            CLAIM PAINTING
            {selected.size > 0 && <span className={styles.coinCount}>{selected.size}</span>}
          </button>
        </div>
      </div>

      <main className={styles.gallery}>
        {works.length === 0 ? (
          <EmptyState />
        ) : (
          filteredWorks.map((work) => (
            <WorkCard
              key={work.id}
              work={work}
              selected={selected.has(work.id)}
              onToggleSelect={() => toggleSelect(work.id)}
              onOpenWildpixel={() => openWildpixelModal(work.id)}
            />
          ))
        )}
      </main>

      <div className={styles.footer}>
        <div className={styles.highscore}>★ © 2026 MINTFACE.ART · 64 ARCADE PIXEL PAINTINGS ★</div>
        <div>POWERED BY ETHEREUM · TRANSIENT · CHAINLINK VRF</div>
        <div className={styles.footerStartLine}>
          PRESS <Link href="/mint" className={styles.footerStartLink}>[START]</Link> TO MINT MORE
        </div>
      </div>

      {/* Drawer for physical claim */}
      <div
        className={`${styles.drawerBackdrop} ${drawerOpen ? styles.drawerOpen : ''}`}
        onClick={() => setDrawerOpen(false)}
      />
      <Drawer
        open={drawerOpen}
        works={works}
        selected={selected}
        onClose={() => setDrawerOpen(false)}
        onRemove={(id) => toggleSelect(id)}
        onCheckout={handleCheckout}
      />

      {/* Wildpixel modal */}
      {modal && (
        <WildpixelModal
          state={modal}
          work={works.find((w) => w.id === modal.workId)}
          onChange={setModal}
          onClose={closeWildpixelModal}
          onLock={lockWildpixel}
        />
      )}

      {/* Toast */}
      {toast && <div className={`${styles.toast} ${styles.toastShow}`}>{toast}</div>}
    </>
  );
}

/* ============================================================
   EmptyState — shown when user has no mints (default state)
   ============================================================ */
function EmptyState() {
  return (
    <div className={styles.emptyState}>
      <div className={styles.emptyBig}>▼ NO MINTS YET ▼</div>
      <p className={styles.emptySub}>
        Head to the <Link href="/mint" className={styles.emptyLink}>MINT ROOM</Link> to roll your first work.<br />
        Fresh mints appear here automatically.
      </p>
      <Link href="/mint" className={`${styles.coinBtn}`}>▶ START · MINT</Link>
    </div>
  );
}

/* ============================================================
   PostMintBanner — fixed-top celebratory strip
   ============================================================ */
function PostMintBanner({
  count, txHash, onClose,
}: {
  count: number; txHash: string; onClose: () => void;
}) {
  return (
    <div className={styles.postMintBanner}>
      <div className={styles.pmbInner}>
        <span className={styles.pmbStar}>★</span>
        <span className={styles.pmbText}>
          <strong>FRESH MINT</strong> · {count} WORK{count !== 1 && 'S'} ADDED TO YOUR WALLET ·{' '}
          TX <span className={styles.pmbHash}>{txHash}</span> ·{' '}
          <strong>CLAIM YOUR PHYSICALS BELOW</strong>
        </span>
        <span className={styles.pmbStar}>★</span>
        <button className={styles.pmbClose} onClick={onClose} aria-label="Dismiss">×</button>
      </div>
    </div>
  );
}

/* ============================================================
   WorkCard — one cabinet in the gallery
   ============================================================ */
function WorkCard({
  work, selected, onToggleSelect, onOpenWildpixel,
}: {
  work: Work;
  selected: boolean;
  onToggleSelect: () => void;
  onOpenWildpixel: () => void;
}) {
  const cls = eraToClass(work.era);
  const isWildpixelEmpty = work.wildpixel && work.status === 'awaiting-palette';

  let visual: React.ReactNode;
  if (work.wildpixel && work.completedCells) {
    // Locally-completed wildpixel — render as inline animated SVG
    const [rows, cols] = work.grid;
    const svgHtml = buildInlineSvg(work.completedCells, rows, cols);
    visual = (
      <div
        className={`${styles.workSvgInline} ${styles[cls]}`}
        dangerouslySetInnerHTML={{ __html: svgHtml }}
      />
    );
  } else {
    // Standard work — load the static SVG file
    // eslint-disable-next-line @next/next/no-img-element
    visual = (
      <img
        className={`${styles.workSvg} ${styles[cls]}`}
        src={svgPath(work.tokenId)}
        alt={work.trait ?? 'Awaiting palette'}
      />
    );
  }

  const traitDisplay = work.trait ? (
    <div className={styles.workTrait}>★ {work.trait.toUpperCase()} ★</div>
  ) : (
    <div className={`${styles.workTrait} ${styles.workTraitEmpty}`}>★ NOT YET SET ★</div>
  );

  let statusTag: React.ReactNode;
  if (isWildpixelEmpty) {
    statusTag = <span className={`${styles.statusTag} ${styles.awaiting}`}>▶ TAP TO PLAY</span>;
  } else if (work.physical) {
    statusTag = <span className={`${styles.statusTag} ${styles.physical}`}>● PHYSICAL</span>;
  } else {
    statusTag = <span className={`${styles.statusTag} ${styles.digital}`}>○ DIGITAL ONLY</span>;
  }

  const handleCardClick = (e: React.MouseEvent) => {
    // If the user clicked the select button, let its own handler fire and stop here
    const target = e.target as HTMLElement;
    if (target.closest(`.${styles.workSelect}`)) return;
    if (isWildpixelEmpty) onOpenWildpixel();
  };

  const showSelect = !isWildpixelEmpty && !work.physical;

  return (
    <div
      className={`${styles.work} ${isWildpixelEmpty ? styles.wildpixelEmpty : ''} ${selected ? styles.selected : ''}`}
      onClick={handleCardClick}
    >
      <div className={styles.workCabinet}>
        {work.wildpixel && <div className={`${styles.badge} ${styles.badgeWildpixel}`}>WILDPIXEL</div>}
        {work.physical && <div className={`${styles.badge} ${styles.badgePhysical}`}>PHYSICAL</div>}
        {showSelect && (
          <button
            className={styles.workSelect}
            onClick={(e) => { e.stopPropagation(); onToggleSelect(); }}
            aria-label={selected ? 'Deselect' : 'Select'}
          >
            <span>+</span>
          </button>
        )}
        <div className={styles.workScreenBezel}>{visual}</div>
        <div className={styles.workMeta}>
          {traitDisplay}
          <div className={styles.workTitle}>{work.finalTitle}</div>
          <div className={styles.workStats}>
            <span className={styles.eraTag}>
              {work.era.toUpperCase()}{work.year ? ` · ${work.year}` : ''}
            </span>
            {statusTag}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Drawer — physical claim cart
   ============================================================ */
function Drawer({
  open, works, selected, onClose, onRemove, onCheckout,
}: {
  open: boolean;
  works: Work[];
  selected: Set<string>;
  onClose: () => void;
  onRemove: (id: string) => void;
  onCheckout: () => void;
}) {
  const selectedWorks = works.filter((w) => selected.has(w.id));
  const subTot = selectedWorks.reduce((s, w) => s + PRICES[w.era].painting, 0);
  const ship = selectedWorks.reduce((s, w) => s + PRICES[w.era].shipping, 0);
  const savings = selectedWorks.length >= BUNDLE_THRESHOLD ? BUNDLE_SHIPPING_SAVED : 0;
  const grand = subTot + ship - savings;

  return (
    <aside className={`${styles.drawer} ${open ? styles.drawerOpen : ''}`}>
      <div className={styles.drawerHead}>
        <div>
          <div className={styles.drawerEyebrow}>▼ PAUSE MENU ▼</div>
          <h2 className={styles.drawerH2}>CLAIM PAINTING</h2>
        </div>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close">X</button>
      </div>
      <div className={styles.drawerBody}>
        {selectedWorks.length === 0 ? (
          <div className={styles.drawerEmpty}>
            ▼ EMPTY ▼<br /><br />
            <span className={styles.drawerEmptyBlink}>INSERT WORK TO CONTINUE</span>
          </div>
        ) : (
          selectedWorks.map((w) => {
            const cls = eraToClass(w.era);
            const price = PRICES[w.era].painting;
            return (
              <div key={w.id} className={styles.drawerItem}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className={`${styles.drawerThumbSvg} ${styles[cls]}`}
                  src={svgPath(w.tokenId)}
                  alt={w.trait ?? ''}
                />
                <div className={styles.drawerMeta}>
                  <div className={styles.drawerT1}>{(w.trait ?? '').toUpperCase()}</div>
                  <div className={styles.drawerT2}>{w.finalTitle}</div>
                  <div className={styles.drawerT3}>{w.era.toUpperCase()}</div>
                  <button
                    className={styles.removeBtn}
                    onClick={() => onRemove(w.id)}
                  >
                    ▼ REMOVE
                  </button>
                </div>
                <div className={styles.drawerPrice}>{price.toFixed(2)} ETH</div>
              </div>
            );
          })
        )}
      </div>
      <div className={styles.drawerTotals}>
        <div className={styles.totalRow}><span>PAINTINGS</span><span>{subTot.toFixed(2)} ETH</span></div>
        <div className={styles.totalRow}><span>BOX + SHIP</span><span>{ship.toFixed(2)} ETH</span></div>
        {savings > 0 && (
          <div className={`${styles.totalRow} ${styles.savingsRow}`}>
            <span>★ BUNDLE BONUS ★</span><span>−{savings.toFixed(2)} ETH</span>
          </div>
        )}
        <div className={`${styles.totalRow} ${styles.grandRow}`}>
          <span>TOTAL</span><span>{grand.toFixed(2)} ETH</span>
        </div>
        <button
          className={styles.checkoutBtn}
          onClick={onCheckout}
          disabled={selectedWorks.length === 0}
        >
          CONFIRM ORDER ▶
        </button>
      </div>
    </aside>
  );
}

/* ============================================================
   WildpixelModal — 4-step flow: Upload → Extract → Arrange → Lock
   ============================================================ */
function WildpixelModal({
  state, work, onChange, onClose, onLock,
}: {
  state: WildpixelModalState;
  work: Work | undefined;
  onChange: (s: WildpixelModalState) => void;
  onClose: () => void;
  onLock: () => void;
}) {
  // Hidden file input we trigger via a button click — more reliable than
  // the <label for=""> pattern across mobile browsers
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Track timers spawned by the extraction stagger so we can clear them
  // if the user navigates away mid-animation.
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    return () => {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
    };
  }, []);

  // ESC closes the modal — nice to have
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!work) return null;
  const [rows, cols] = work.grid;
  const cls = eraToClass(work.era);

  /* ---- Step controls ---- */
  const goNext = () => {
    if (state.step === 1) onChange({ ...state, step: 2 });
    else if (state.step === 2) onChange({ ...state, step: 3 });
    else if (state.step === 3) onChange({ ...state, step: 4 });
    else if (state.step === 4) onLock();
  };
  const goBack = () => {
    if (state.step > 1) onChange({ ...state, step: (state.step - 1) as 1 | 2 | 3 });
  };

  /* ---- File upload — fires k-means on load ---- */
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset the input value so picking the same file again still fires `change`.
    // (Browsers debounce identical selections; this is the standard workaround.)
    e.target.value = '';
    if (!file) return;
    // Enforce the 8MB cap advertised in the upload zone
    const MAX_BYTES = 8 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      alert(`File too large (${Math.round(file.size / 1024 / 1024)} MB). Max is 8 MB.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataURL = ev.target?.result as string;
      const img = new Image();
      img.onload = () => {
        const colors = extractDominantColors(img, 8);
        onChange({ ...state, extracted: { dataURL, colors } });
      };
      img.onerror = () => {
        alert('Could not load that image. Try a different file.');
      };
      img.src = dataURL;
    };
    reader.onerror = () => {
      alert('Could not read that file. Try a different one.');
    };
    reader.readAsDataURL(file);
  };

  /* ---- Re-roll the arrangement seed (step 3) ---- */
  const handleReroll = () => {
    if (state.rerollsLeft <= 0) return;
    onChange({
      ...state,
      rerollsLeft: state.rerollsLeft - 1,
      arrangementSeed: Math.floor(Math.random() * 100000),
    });
  };

  /* ---- Step labels + footer button states ---- */
  const nextLabel =
    state.step === 1 ? 'EXTRACT ▶'
      : state.step === 2 ? 'ARRANGE ▶'
        : state.step === 3 ? 'USE THIS ▶'
          : 'LOCK ON-CHAIN ▶';
  const nextDisabled =
    state.step === 1 ? !state.extracted
      : state.step === 4 ? state.trait.trim().length === 0
        : false;

  return (
    <div className={`${styles.modalBackdrop} ${styles.modalOpen}`} onClick={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}>
      <div className={styles.modal} role="dialog" aria-modal="true">
        <div className={styles.modalHead}>
          <div>
            <div className={styles.modalEyebrow}>▼ WILDPIXEL · AWAITING PALETTE ▼</div>
            <h2 className={styles.modalH2}>COMPLETE WILDPIXEL</h2>
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">X</button>
        </div>

        <div className={styles.steps}>
          {(['1·UPLOAD', '2·EXTRACT', '3·ARRANGE', '4·LOCK'] as const).map((label, i) => {
            const n = i + 1;
            const active = state.step === n;
            const done = state.step > n;
            return (
              <div
                key={label}
                className={`${styles.step} ${active ? styles.stepActive : ''} ${done ? styles.stepDone : ''}`}
              >
                {label}
              </div>
            );
          })}
        </div>

        <div className={styles.modalBody}>
          {state.step === 1 && (
            <>
              <button
                type="button"
                className={styles.uploadZone}
                onClick={() => fileInputRef.current?.click()}
              >
                <div className={styles.uploadIcon}>[ + ]</div>
                <h3 className={styles.uploadH3}>UPLOAD YOUR GAME OR PFP</h3>
                <p className={styles.uploadP}>
                  Tap to upload your favorite arcade screenshot or pfp.
                </p>
                <div className={styles.uploadNote}>PNG · JPG · WEBP · MAX 8MB</div>
              </button>
              {/* File input sits outside the button — nested interactive
                  elements are invalid HTML and trigger browser quirks. */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
              <div className={styles.infoText}>
                Your image is analysed via <strong>K-MEANS CLUSTERING</strong> to extract 8 dominant colors.
                The source image is <strong>DISCARDED IMMEDIATELY</strong> after extraction — only hex codes
                and your entered game name are stored. This action is <strong>PERMANENT</strong> and on-chain.
              </div>
            </>
          )}

          {state.step === 2 && state.extracted && (
            <ExtractPanel
              extracted={state.extracted}
              timersRef={timersRef}
            />
          )}

          {state.step === 3 && state.extracted && (
            <ArrangePanel
              colors={state.extracted.colors}
              rows={rows}
              cols={cols}
              seed={state.arrangementSeed}
              eraClass={cls}
              rerollsLeft={state.rerollsLeft}
              onReroll={handleReroll}
            />
          )}

          {state.step === 4 && state.extracted && (
            <FinalPanel
              colors={state.extracted.colors}
              rows={rows}
              cols={cols}
              seed={state.arrangementSeed}
              eraClass={cls}
              trait={state.trait}
              onTraitChange={(t) => onChange({ ...state, trait: t })}
              finalTitle={work.finalTitle}
            />
          )}
        </div>

        <div className={styles.modalFoot}>
          <button
            className={`${styles.coinBtn} ${styles.ghost}`}
            onClick={goBack}
            hidden={state.step === 1}
          >
            ◄ BACK
          </button>
          <div className={styles.modalFootSpacer} />
          <button
            className={styles.coinBtn}
            onClick={goNext}
            disabled={nextDisabled}
          >
            {nextLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Step 2 — Extract panel (source preview + staggered swatches)
   ============================================================ */
function ExtractPanel({
  extracted, timersRef,
}: {
  extracted: { dataURL: string; colors: string[] };
  timersRef: React.MutableRefObject<ReturnType<typeof setTimeout>[]>;
}) {
  // `litCount` controls how many swatches have animated in;
  // `sourceDiscarded` toggles the source preview into "discarded" message
  const [litCount, setLitCount] = useState(0);
  const [sourceDiscarded, setSourceDiscarded] = useState(false);

  useEffect(() => {
    // Reset on mount
    setLitCount(0);
    setSourceDiscarded(false);

    // Stagger swatch reveal: 90ms between each
    extracted.colors.forEach((_, i) => {
      const t = setTimeout(() => setLitCount((n) => Math.max(n, i + 1)), 200 + i * 90);
      timersRef.current.push(t);
    });

    // After all swatches are in, swap source preview to "discarded"
    const tFinal = setTimeout(() => setSourceDiscarded(true), 1600);
    timersRef.current.push(tFinal);

    return () => {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
    };
  }, [extracted, timersRef]);

  return (
    <div className={styles.extractedPreview}>
      <div>
        <div className={styles.extractedLabel}>▼ SOURCE ▼</div>
        <div className={styles.sourcePreview}>
          {!sourceDiscarded ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={extracted.dataURL} alt="Source" />
              <div className={styles.scanning} />
            </>
          ) : (
            <div className={styles.sourceDiscarded}>
              ▼ SOURCE<br />DISCARDED ▼<br /><br />
              ONLY HEX<br />CODES STORED
            </div>
          )}
        </div>
        <div className={styles.extractedAnalysing}>ANALYSING · K-MEANS · K=8</div>
      </div>
      <div>
        <div className={styles.extractedLabel}>▼ PALETTE ▼</div>
        <div className={styles.extractedSwatches}>
          {extracted.colors.map((color, i) => (
            <div
              key={`${color}-${i}`}
              className={`${styles.swatch} ${i < litCount ? styles.swatchIn : ''}`}
              style={{ background: color, color }}
              data-hex={color}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Step 3 — Arrange panel (inline SVG + re-roll button)
   ============================================================ */
function ArrangePanel({
  colors, rows, cols, seed, eraClass, rerollsLeft, onReroll,
}: {
  colors: string[];
  rows: number;
  cols: number;
  seed: number;
  eraClass: string;
  rerollsLeft: number;
  onReroll: () => void;
}) {
  // Compute arrangement on every render (deterministic given seed; cheap)
  const cells = useMemo(
    () => arrange(colors, rows, cols, seed),
    [colors, rows, cols, seed]
  );
  const svgHtml = useMemo(() => buildInlineSvg(cells, rows, cols), [cells, rows, cols]);

  return (
    <>
      <div className={styles.rerollInfo}>
        <span>ARRANGEMENT · SIM-ANNEAL</span>
        <span>
          RE-ROLLS LEFT: <span className={styles.rerollCount}>{rerollsLeft}</span> / 3
        </span>
        <button
          className={`${styles.coinBtn} ${styles.ghost} ${styles.rerollBtn}`}
          onClick={onReroll}
          disabled={rerollsLeft <= 0}
        >
          ◄ RE-ROLL
        </button>
      </div>
      <div className={styles.arrangementStage}>
        <div
          className={`${styles.pixelGrid} ${styles[eraClass]}`}
          dangerouslySetInnerHTML={{ __html: svgHtml }}
        />
      </div>
      <div className={styles.infoText}>
        Same algorithm as game-derived works: <strong>ADJACENCY CONTRAST</strong>,{' '}
        <strong>DUPLICATE DISPERSION</strong>, <strong>ASYMMETRY</strong>.
        Re-roll up to 3 times before locking.
      </div>
    </>
  );
}

/* ============================================================
   Step 4 — Final panel (preview + trait input)
   ============================================================ */
function FinalPanel({
  colors, rows, cols, seed, eraClass, trait, onTraitChange, finalTitle,
}: {
  colors: string[];
  rows: number;
  cols: number;
  seed: number;
  eraClass: string;
  trait: string;
  onTraitChange: (v: string) => void;
  finalTitle: string;
}) {
  const cells = useMemo(
    () => arrange(colors, rows, cols, seed),
    [colors, rows, cols, seed]
  );
  const svgHtml = useMemo(() => buildInlineSvg(cells, rows, cols), [cells, rows, cols]);

  return (
    <>
      <div className={styles.arrangementStage}>
        <div
          className={`${styles.pixelGrid} ${styles[eraClass]}`}
          dangerouslySetInnerHTML={{ __html: svgHtml }}
        />
      </div>
      <div className={styles.traitLabel}>▼ TRAIT · THE GAME NAME ▼</div>
      <input
        type="text"
        className={styles.traitInput}
        value={trait}
        onChange={(e) => onTraitChange(e.target.value)}
        placeholder="POKEMON CRYSTAL"
      />
      <div className={styles.infoText}>
        Locking writes swatches, arrangement &amp; trait permanently to NFT metadata.
        Final art title <strong>{finalTitle.toUpperCase()}</strong> already assigned.
      </div>
    </>
  );
}
