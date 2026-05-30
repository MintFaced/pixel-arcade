'use client';
import { useEffect, useRef } from 'react';
import styles from './page.module.css';
import { createEngine, type Engine } from './engine';
import { loadAssets } from './assets';

export default function SurvivorsGame() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef  = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<Engine | null>(null);

  useEffect(() => {
    if (!canvasRef.current || !stageRef.current) return;
    let cancelled = false;
    let engine: Engine | null = null;

    (async () => {
      const assets = await loadAssets();
      if (cancelled) return;
      engine = createEngine({
        canvas: canvasRef.current!,
        stage: stageRef.current!,
        assets,
      });
      engineRef.current = engine;
      engine.start();
    })();

    return () => {
      cancelled = true;
      engine?.stop();
      engineRef.current = null;
    };
  }, []);

  return (
    <div ref={stageRef} className={styles.stage}>
      <canvas ref={canvasRef} tabIndex={0} className={styles.canvas} />
      <div className={styles.hint}>
        CLICK TO FOCUS · WASD/ARROWS MOVE · 1/2/3 UPGRADE · R RESTART · ESC TITLE
      </div>
    </div>
  );
}
