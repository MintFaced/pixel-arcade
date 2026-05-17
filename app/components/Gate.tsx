'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './Gate.module.css';

const PASSCODE = 'arcade26';
const STORAGE_KEY = 'pixelarcade_unlocked';

/**
 * Password gate. Theater for a prototype — not security.
 * Stores an unlocked flag in sessionStorage so refreshes within a session pass.
 *
 * Rendered as a fixed overlay above all content. When unlocked, fully removed
 * from DOM so it doesn't capture clicks or interfere with focus.
 */
export default function Gate() {
  // Default to LOCKED so content never flashes on first paint for new users.
  // After mount we check sessionStorage and unlock if the user already entered
  // the passcode this session.
  const [unlocked, setUnlocked] = useState(false);
  const [wrong, setWrong] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (sessionStorage.getItem(STORAGE_KEY) === '1') {
      setUnlocked(true);
    } else {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const value = inputRef.current?.value.trim().toLowerCase() ?? '';
    if (value === PASSCODE) {
      sessionStorage.setItem(STORAGE_KEY, '1');
      setUnlocked(true);
    } else {
      setWrong(true);
      if (inputRef.current) inputRef.current.value = '';
      setTimeout(() => {
        setWrong(false);
        inputRef.current?.focus();
      }, 400);
    }
  }

  if (unlocked) return null;

  return (
    <div className={styles.gate} role="dialog" aria-modal="true" aria-label="Passcode required">
      <div className={styles.gateInner}>
        <div className={styles.prompt}>▼ AUTHORIZED ACCESS ONLY ▼</div>
        <div className={styles.title}>★ INSERT PASSCODE ★</div>
        <form className={styles.form} onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="password"
            className={`${styles.input} ${wrong ? styles.wrong : ''}`}
            placeholder="ENTER PASSCODE"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            required
          />
          <button type="submit" className={styles.submit}>UNLOCK ▶</button>
        </form>
        <div className={styles.footer}>PROTOTYPE · MINTFACE 2026</div>
      </div>
    </div>
  );
}
