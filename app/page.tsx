import Link from 'next/link';
import styles from './page.module.css';

export default function Home() {
  return (
    <>
      <div className="attract-band">
        <div className="insertcoin">★ INSERT COIN TO BEGIN ★</div>
      </div>

      <main className={styles.hero}>
        <div>
          <div className={styles.logoMark}>
            <span className={styles.mint}>Mint</span>
            <span className={styles.face}>
              Face
              <span className={styles.cherry}>●</span>
            </span>
          </div>
          <div className={styles.logoDivider}>★ PRESENTS ★</div>
          <h1 className={styles.siteTitle}>PIXELARCADE.ART</h1>
        </div>

        <p className={styles.siteTagline}>
          <span className={styles.hlYellow}>64</span> Arcade Pixel Paintings.<br />
          <span className={styles.hlCyan}>1/1 NFTs</span> derived from{' '}
          <span className={styles.hlPink}>8-bit · 16-bit · 32-bit</span> game palettes.<br />
          Optional <span className={styles.hlPink}>physical paintings</span> hand-mixed by the artist.
        </p>

        <div className={styles.cabinetButtons}>
          <Link href="/mint" className={`${styles.cabBtn} ${styles.mintCab}`}>
            <span className={styles.arrow}>▶</span>
            <span className={styles.label}>MINT</span>
            <span className={styles.sub}>
              CONNECT WALLET &amp; ROLL<br />
              REVEAL · LOCK · BATCH MINT
            </span>
          </Link>
          <Link href="/my-mints" className={`${styles.cabBtn} ${styles.mintsCab}`}>
            <span className={styles.arrow}>▶</span>
            <span className={styles.label}>YOUR MINTS</span>
            <span className={styles.sub}>
              COLLECTOR PAGE<br />
              CLAIM · WILDPIXEL PALETTES
            </span>
          </Link>
        </div>
      </main>

      <footer className={styles.footer}>
        <div className={styles.prototypeTag}>
          ★ <Link href="/wizards" className={styles.wizardsLink}>WIZARDS</Link> ★
        </div>
        <div className={styles.buildLine}>
          COLLECTION BY <span className={styles.hl}>MINTFACE</span> · CONTRACT BY <span className={styles.hl}>YUNGWKND</span> · <a href="https://opensea.io/collection/pixelarcade-/overview" target="_blank" rel="noopener noreferrer" className={styles.wizardsLink}>OPENSEA →</a>
        </div>
        <div>
          © 2026 MINTFACE · 64 ARCADE PIXEL PAINTINGS 🍒
        </div>
      </footer>
    </>
  );
}
