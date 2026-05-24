/**
 * Gamepad input layer.
 *
 * The Gamepad API doesn't fire events for analog stick movement or held
 * button state — you poll `navigator.getGamepads()` each frame. This util
 * normalizes that polling into a clean per-frame snapshot.
 *
 * Mapping (standard gamepad layout — works for Xbox, PS, 8BitDo, etc):
 *   - Left stick X OR D-pad left/right  → left/right
 *   - A button (button 0) OR any face button → fire
 *   - Start button (button 9) → start/restart signal
 *
 * Browser pads aren't visible until the user presses a button on them,
 * by browser security policy. Once pressed, they appear in getGamepads().
 */

export interface GamepadSnapshot {
  /** Index in navigator.getGamepads() — same across frames once connected */
  index: number;
  /** Connected on this frame */
  connected: boolean;
  /** Movement: -1 to 1 (negative = left) */
  axisX: number;
  /** True if any move-left source is active */
  left: boolean;
  /** True if any move-right source is active */
  right: boolean;
  /** True if any fire button held */
  fire: boolean;
  /** True if start button pressed this frame (edge-triggered) */
  startPressed: boolean;
}

const STICK_DEADZONE = 0.25;

/** Tracks previous frame's start-button state per gamepad index */
const startEdgeState = new Map<number, boolean>();

/**
 * Read the current state of a specific gamepad slot (0 or 1 for hot-seat).
 * Returns a snapshot with edge-triggered start detection.
 */
export function readGamepad(index: number): GamepadSnapshot {
  const pads = typeof navigator !== 'undefined' ? navigator.getGamepads() : null;
  const pad = pads ? pads[index] : null;

  if (!pad) {
    startEdgeState.set(index, false);
    return {
      index,
      connected: false,
      axisX: 0,
      left: false,
      right: false,
      fire: false,
      startPressed: false,
    };
  }

  // Movement: left stick X or D-pad
  const axisRaw = pad.axes[0] ?? 0;
  const axisX = Math.abs(axisRaw) < STICK_DEADZONE ? 0 : axisRaw;
  // D-pad — buttons 14 (left) and 15 (right) in standard mapping
  const dpadLeft = pad.buttons[14]?.pressed ?? false;
  const dpadRight = pad.buttons[15]?.pressed ?? false;

  const left = axisX < -STICK_DEADZONE || dpadLeft;
  const right = axisX > STICK_DEADZONE || dpadRight;

  // Fire — any of the four face buttons (A, B, X, Y = indices 0-3)
  const fire = (pad.buttons[0]?.pressed ?? false)
    || (pad.buttons[1]?.pressed ?? false)
    || (pad.buttons[2]?.pressed ?? false)
    || (pad.buttons[3]?.pressed ?? false)
    // Also accept right triggers as fire — feels good for shooters
    || (pad.buttons[7]?.pressed ?? false);

  // Start button — edge-triggered (press, not held)
  const startNow = pad.buttons[9]?.pressed ?? false;
  const startPrev = startEdgeState.get(index) ?? false;
  startEdgeState.set(index, startNow);
  const startPressed = startNow && !startPrev;

  return {
    index,
    connected: true,
    axisX,
    left,
    right,
    fire,
    startPressed,
  };
}

/**
 * Check if any gamepad has pressed start this frame. Used by the
 * pre-game / game-over screens for "press any button to begin".
 */
export function anyGamepadStart(): boolean {
  const pads = typeof navigator !== 'undefined' ? navigator.getGamepads() : null;
  if (!pads) return false;
  for (let i = 0; i < pads.length; i++) {
    if (pads[i]) {
      const snap = readGamepad(i);
      if (snap.startPressed) return true;
      // Also accept any face button as start for convenience
      const pad = pads[i]!;
      const facePressed = (pad.buttons[0]?.pressed ?? false)
        || (pad.buttons[1]?.pressed ?? false)
        || (pad.buttons[2]?.pressed ?? false)
        || (pad.buttons[3]?.pressed ?? false);
      // Edge-detect face buttons too — uses a separate index space (1000+)
      const faceKey = 1000 + i;
      const facePrev = startEdgeState.get(faceKey) ?? false;
      startEdgeState.set(faceKey, facePressed);
      if (facePressed && !facePrev) return true;
    }
  }
  return false;
}

/**
 * Count of currently-connected gamepads.
 */
export function gamepadCount(): number {
  const pads = typeof navigator !== 'undefined' ? navigator.getGamepads() : null;
  if (!pads) return 0;
  let count = 0;
  for (let i = 0; i < pads.length; i++) {
    if (pads[i]) count++;
  }
  return count;
}
