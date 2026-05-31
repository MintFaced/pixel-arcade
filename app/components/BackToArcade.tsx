'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Floating "← GAMES" button shown on every game page. Returns the player to
 * the lobby at `/game`. Triggers:
 *   - click / touch
 *   - ESC key
 *   - gamepad button 8 (Back / Select on the F310 cabinet pad and every
 *     standard XInput gamepad)
 *
 * Positioned `fixed` in the top-left so it works regardless of the host
 * page's layout. Won't conflict with the game's own input handling since it
 * only fires on the rising edge of the Back button and ESC, both of which
 * are unused by the three games.
 */
export default function BackToArcade() {
  const router = useRouter();
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    const goBack = () => router.push('/game');

    // Keyboard: ESC
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        e.preventDefault();
        goBack();
      }
    };
    window.addEventListener('keydown', onKey);

    // Gamepad: button 8 (Back/Select). Edge-detected so we don't fire every
    // frame the button is held.
    let prevBack = false;
    let raf = 0;
    let running = true;
    const poll = () => {
      if (!running) return;
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      let pressed = false;
      for (const p of pads) {
        if (!p) continue;
        // Button 8 = Back/Select on standard XInput layout (Logitech F310,
        // Xbox pads, generic USB gamepads).
        if (p.buttons[8]?.pressed) {
          pressed = true;
          break;
        }
      }
      if (pressed && !prevBack) {
        prevBack = true;
        goBack();
        return;
      }
      if (!pressed) prevBack = false;
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
    };
  }, [router]);

  const baseStyle: React.CSSProperties = {
    position: 'fixed',
    top: 12,
    left: 12,
    zIndex: 999,
    background: hovered ? 'rgba(255, 90, 168, 0.92)' : 'rgba(20, 14, 26, 0.78)',
    color: hovered ? '#0a0612' : '#ff5aa8',
    border: '2px solid #ff5aa8',
    padding: '8px 14px',
    fontFamily: '"Press Start 2P", monospace',
    fontSize: 11,
    letterSpacing: '0.12em',
    lineHeight: 1,
    cursor: 'pointer',
    boxShadow: hovered
      ? '0 0 18px rgba(255, 90, 168, 0.75)'
      : '0 0 10px rgba(255, 90, 168, 0.4)',
    transition: 'all 0.15s',
    userSelect: 'none',
    textShadow: hovered ? 'none' : '0 0 6px rgba(255, 90, 168, 0.8)',
  };

  return (
    <button
      type="button"
      onClick={() => router.push('/game')}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-label="Back to Pixel Arcade lobby"
      style={baseStyle}
    >
      ← GAMES
    </button>
  );
}
