import Link from 'next/link';
import Image from 'next/image';
import styles from './page.module.css';

export const metadata = {
  title: 'WIZARDS · PIXELARCADE.ART',
  description: 'Chapter 0. Named after the arcade at the end of the street. Where this started.',
};

export default function WizardsPage() {
  return (
    <>
      <header className={styles.marquee}>
        <div className={styles.marqueeLeft}>
          <Link href="/">★ PIXELARCADE.ART</Link>
        </div>
        <div className={styles.marqueeRight}>CHAPTER 0 · WIZARDS</div>
      </header>

      <main>
        <section className={styles.hero}>
          <div className={styles.heroEyebrow}>★ ABOUT THIS PROJECT ★</div>
          <h1 className={styles.heroTitle}>WIZARDS</h1>
          <p className={styles.heroSub}>
            Named after the arcade at the end of the street.<br />
            Where this started — <em>and where these paintings come from</em>.
          </p>
        </section>

        <div className={styles.content}>

          <section className={styles.section}>
            <h2 className={styles.h2}>
              Why Pixels<span className={styles.chapterNum}>01</span>
            </h2>
            <p>
              Arcade games, reduced to their most essential form, are pixels. They lived in the digital realm first — bound to the resolution and color range the hardware of their era could afford. <strong>8-bit</strong> gave way to <strong>16-bit</strong>, <strong>16-bit</strong> to <strong>32-bit</strong>; each generation widened what the screen could carry, and each step also defined what we now recognize as the look of a particular decade.
            </p>
            <p>
              <em>PixelArcade</em> winnows each game down to its essential color palette — sampled from the canonical on-screen palette and arranged into a fixed grid. Painting them shifts the context: from a childhood game to a fine artwork with both personal and shared lineage. We all had our favorite games growing up. That&apos;s the joy I&apos;m trying to recreate here.
            </p>
            <p>
              The reduction itself is a debt to Mondrian, who pulled nature down to lines and primary squares and trusted what remained to do the work. These games asked the same of their hardware out of necessity. The paintings ask it back out of respect.
            </p>
          </section>

          <div className={styles.pullQuote}>
            &ldquo;AT 20 CENTS A GAME · WE MOSTLY WATCHED&rdquo;
          </div>

          <section className={styles.section}>
            <h2 className={styles.h2}>
              Wizards<span className={styles.chapterNum}>02</span>
            </h2>
            <p>
              Wizards was the closest arcade to where I grew up. It was literally at the end of our street — a one-minute walk to the right. Still, as an eight-year-old, it felt like longer. We&apos;d always walk after my brother&apos;s bike got nicked from out the front. At twenty cents a game, we mostly watched.
            </p>
            <p>
              <strong>Golden Axe</strong> and <strong>Ghosts &apos;n Goblins</strong> always drew a crowd. The older kids really knew how to work the buttons — and weren&apos;t afraid to use the full force on them. The clack-clack-clack sound whirred, and the machines spoke back in 8-bit, calling out next level or last life before <em>GAME OVER</em>.
            </p>
            <p>
              <strong>Rampage</strong> was absolutely my favorite back then. Climbing skyscrapers and knocking them down while helicopters whirred overhead. Seeing the pixelated game colors still gives me goosebumps. <strong>Galaga</strong> was so popular you could play it at local fish and chip shops while you waited for your order. At one stage we ended up with a Galaga seated game table at home — I think Dad accepted it as part-payment on a deal. I got good at the game, before he swapped it out for another Thursday Trader deal.
            </p>
            <p>At home we had a Vic 20 with <strong>Frogger</strong>.</p>
          </section>

          <div className={styles.pullQuote}>
            &ldquo;16-BIT ON A PC BROUGHT AN UNREAL LEVEL OF DETAIL&rdquo;
          </div>

          <section className={styles.section}>
            <h2 className={styles.h2}>
              The 286 PC<span className={styles.chapterNum}>03</span>
            </h2>
            <p>
              Once Dad brought back a 286 PC from an overseas trip, we suddenly had great games at home. 16-bit on a PC brought an unreal level of detail. I was lucky Dad was a pilot, so he didn&apos;t need convincing to pick up <strong>F-16 Stealth Fighter</strong> — or my favorite, <strong>Wing Commander</strong>.
            </p>
            <p>
              <strong>Ultima VII</strong> was released and we got a copy. Loaded it up, and suddenly I was learning roleplay games. Then came <strong>Wolfenstein 3D</strong> — what a deeply intense and fun first-person shooter for a fifteen-year-old to be playing. Dad had just taught us how to shoot real guns.
            </p>
            <p>
              Later on we got a Sega Master System and I must have spent most of my life thinking about or playing <strong>Alex the Kidd</strong>. Having access to computers so young was a very fortunate thing.
            </p>
          </section>

          <div className={styles.pullQuote}>
            &ldquo;WE USED THE SPARE BANDWIDTH TO COORDINATE · VOICE CALLS WERE STILL PRICEY&rdquo;
          </div>

          <section className={styles.section}>
            <h2 className={styles.h2}>
              Lunch Breaks<span className={styles.chapterNum}>04</span>
            </h2>
            <p>
              <strong>Gran Turismo</strong> was released in 1997. By then I was at uni and had moved on from gaming. Although once I graduated and got a job, a couple of work colleagues and I would head down over lunch to race each other with the full steering wheel and pedals.
            </p>
            <p>
              Then it got serious. We worked in telecoms — and a <strong>Half-Life</strong> group formed. We used the spare bandwidth to set up an audio conference to coordinate. This was when voice calls were still pricey.
            </p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.h2}>
              Lineage<span className={styles.chapterNum}>05</span>
            </h2>
            <p>
              <em>PixelArcade</em> is the third in a body of work. It began as a commentary on NFT culture, refined itself into a meditation on the pixel as a networked art object, and reached its master-work scale with <strong>FROGDNA</strong> — 88 hand-painted pixels at full physical size, the work that proved this approach could carry weight in the material world. PixelArcade extends what FROGDNA established, applied now across 64 games and three eras of arcade history.
            </p>

            <article className={styles.lineageCard}>
              <div className={styles.lineageCardImg}>
                <Image
                  src="https://pub-1246173d524b49ceb6f07c3a9c98284e.r2.dev/10k_project_mintface.jpg"
                  alt="10k Project · MintFace · 2022"
                  width={480}
                  height={480}
                  unoptimized
                />
              </div>
              <div className={styles.lineageCardBody}>
                <div className={styles.lineageCardYear}>★ MAY 7 · 2022</div>
                <div className={styles.lineageCardTitle}>10k Project</div>
                <p>
                  A pixel-centric commentary on the dominance of &ldquo;PFP&rdquo; profile pictures in NFT culture. The first MintFace exploration of pixels as a primary artistic vocabulary — published at the height of the 10k generative-set era, asking what happens when you strip the PFP back to its constituent parts.
                </p>
              </div>
            </article>

            <article className={styles.lineageCard}>
              <div className={styles.lineageCardImg}>
                <Image
                  src="https://pub-1246173d524b49ceb6f07c3a9c98284e.r2.dev/seize_and_share_collection_2022.jpg"
                  alt="Seize and Share collection · MintFace · 2022"
                  width={480}
                  height={480}
                  unoptimized
                />
              </div>
              <div className={styles.lineageCardBody}>
                <div className={styles.lineageCardYear}>★ JUNE · 2022</div>
                <div className={styles.lineageCardTitle}>Seize and Share</div>
                <p>
                  Began with a reinterpretation of <em>6529 Seizing</em> — Meme #1. The smallest unit of the digital image, the pixel, transformed into a networked object of art. This is where the lineage starts taking the form it has now: a single pixel as the smallest meaningful art-historical object.
                </p>
              </div>
            </article>

            <article className={styles.lineageCard}>
              <div className={styles.lineageCardImg}>
                <Image
                  src="https://pub-1246173d524b49ceb6f07c3a9c98284e.r2.dev/fake_rare_frogdna_the_line_gallery.jpg"
                  alt="FROGDNA · 88-pixel painting at The Line Gallery"
                  width={480}
                  height={480}
                  unoptimized
                />
              </div>
              <div className={styles.lineageCardBody}>
                <div className={styles.lineageCardYear}>★ THE MASTER WORK</div>
                <div className={styles.lineageCardTitle}>FROGDNA Sampling</div>
                <p>
                  Pepe was sampled from 88 Pepe cards across Series 0, Series 1, and Series 2. The samples were sequenced into 88 pixels via a greedy AI algorithm, then each pixel was color-matched and hand-painted. <strong>88 pixels at full scale</strong> — the audacity of the project lives in the size of it. FROGDNA re-grounds the pixel back in the material world, translating digital hex codes into the richness of physical paint.
                </p>
                <p>
                  <em>&ldquo;Our digital addiction plainly seen inhabiting a physical reality.&rdquo;</em>
                </p>
                <p>
                  The painting sold to a New Zealand collector duo. The 88 <strong>Fake Rare</strong> digital editions remain available for XCP or PepeCash, or wrapped with ETH on OpenSea.
                </p>
                <p className={styles.lineageCardListings}>
                  🟠 LISTED VIA DISPENSER · 0.000888 BTC<br />
                  🍒 LISTED ON OPENSEA · 0.0369 ETH
                </p>
                <a
                  className={styles.lineageCardLink}
                  href="https://frogdna.com"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  FROGDNA.COM ▶
                </a>
              </div>
            </article>
          </section>

          <section className={styles.section}>
            <h2 className={styles.h2}>
              In Conversation With<span className={styles.chapterNum}>06</span>
            </h2>
            <p>
              FROGDNA, and now PixelArcade, sit in conversation with <strong>Gerhard Richter&apos;s Color Charts</strong> (1966) — works that array industrial colors into grids and ask the viewer to consider perception, chance, and order without subject matter to anchor them.
            </p>
            <p>
              And with <strong>Mondrian</strong>, of course. Who pulled nature down to lines and primary squares, and trusted what remained.
            </p>
          </section>
        </div>

        <section className={styles.closing}>
          <div className={styles.closingEyebrow}>★ WHY THIS COLLECTION ★</div>
          <p>
            Part of my art practice is to share who I am with my son.<br /><br />
            Who will one day be able to learn about who his Dad is, through the collections.<br /><br />
            Through PixelArcade, we will learn about the computer games I enjoyed when I was his age.
          </p>
          <div className={styles.closingMark}>— MINTFACE</div>
        </section>
      </main>

      <footer className={styles.siteFooter}>
        <div className={styles.footerMeta}>
          <div>© 2026 MINTFACE · 64 ARCADE PIXEL PAINTINGS</div>
        </div>
      </footer>
    </>
  );
}
