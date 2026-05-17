'use client';

import { useEffect, useState } from 'react';
import styles from './CrtPowerOn.module.css';

const STORAGE_KEY = 'pixelarcade_booted';

/**
 * CRT power-on overlay. Plays once per session:
 *   t=0.15s   horizontal line snaps in
 *   t=0.5s    line expands to fill screen
 *   t=0.85s   bloom (overexposed white wash)
 *   t=1.2s    RGB channel separation (red/green/cyan)
 *   t=1.8s    "PIXELARCADE.ART · SYSTEM READY" boot text appears
 *   t=2.6s    fade out, hide
 *
 * Skipping fires the fade immediately.
 */
export default function CrtPowerOn() {
  // We render the overlay only if this is the user's first visit this session.
  // Once shown OR skipped, sessionStorage flag prevents repeat plays on
  // subsequent client-side navigations.
  const [phase, setPhase] = useState<'hidden' | 'showing' | 'rgb' | 'done'>('hidden');

  useEffect(() => {
    // Already booted this session — don't show
    if (sessionStorage.getItem(STORAGE_KEY) === '1') {
      return;
    }

    setPhase('showing');

    // RGB channel separation kicks in at 1.2s
    const rgbTimer = setTimeout(() => setPhase('rgb'), 1200);

    // Mark done at 2.6s — triggers fade-out
    const doneTimer = setTimeout(() => {
      sessionStorage.setItem(STORAGE_KEY, '1');
      setPhase('done');
    }, 2600);

    // Fully unmount after the 0.4s fade
    const unmountTimer = setTimeout(() => setPhase('hidden'), 3000);

    return () => {
      clearTimeout(rgbTimer);
      clearTimeout(doneTimer);
      clearTimeout(unmountTimer);
    };
  }, []);

  function skip() {
    sessionStorage.setItem(STORAGE_KEY, '1');
    setPhase('done');
    setTimeout(() => setPhase('hidden'), 400);
  }

  if (phase === 'hidden') return null;

  return (
    <div className={`${styles.crtPoweron} ${phase === 'done' ? styles.done : ''}`}>
      <div className={styles.crtLine} />
      <div className={styles.crtBloom} />
      <div className={`${styles.crtRgb} ${phase === 'rgb' ? styles.show : ''}`}>
        <div className={`${styles.channel} ${styles.r}`} />
        <div className={`${styles.channel} ${styles.g}`} />
        <div className={`${styles.channel} ${styles.b}`} />
      </div>
      <div className={styles.crtBootText}>
        <div className={styles.crtBootTitle}>★ PIXELARCADE.ART ★</div>
        <div className={styles.crtBootSub}>SYSTEM READY</div>
      </div>
      <button className={styles.crtSkip} onClick={skip} aria-label="Skip intro">
        SKIP ▶
      </button>
    </div>
  );
}
