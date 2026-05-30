'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './page.module.css';
import { loadAssets } from './assets';
import { startEngine } from './engine';

export default function TennisGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!canvasRef.current) return;
    let cleanup: (() => void) | null = null;
    let cancelled = false;

    loadAssets()
      .then((assets) => {
        if (cancelled || !canvasRef.current) return;
        setLoading(false);
        cleanup = startEngine(canvasRef.current, assets);
      })
      .catch((err) => {
        console.error('Failed to load tennis assets', err);
        if (!cancelled) setError(err.message || 'Failed to load assets');
      });

    return () => {
      cancelled = true;
      if (cleanup) cleanup();
    };
  }, []);

  return (
    <div className={styles.stage}>
      <canvas ref={canvasRef} className={styles.canvas} />
      {loading && !error && (
        <div className={styles.loading}>LOADING ROSTER…</div>
      )}
      {error && (
        <div className={styles.error}>
          <div>FAILED TO LOAD</div>
          <div className={styles.errorDetail}>{error}</div>
        </div>
      )}
      <div className={styles.hint}>
        A/D · P1 (BOTTOM) &nbsp; ←/→ · P2 (TOP) &nbsp;
        ENTER · CONFIRM &nbsp; C · CPU TOGGLE &nbsp; ESC · BACK
      </div>
    </div>
  );
}
