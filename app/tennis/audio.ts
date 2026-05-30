/**
 * Sound effects via Web Audio API. Lazy-initializes on first use, which
 * also handles browser autoplay restrictions (first user gesture unlocks).
 */

let audioCtx: AudioContext | null = null;

function ensureCtx(): AudioContext | null {
  if (audioCtx) return audioCtx;
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  try {
    audioCtx = new AC();
    return audioCtx;
  } catch {
    return null;
  }
}

export function ensureAudio() { ensureCtx(); }

function blip(freq: number, dur: number, type: OscillatorType = 'square', vol = 0.06) {
  const ctx = ensureCtx();
  if (!ctx) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

export const SFX = {
  hitPaddle: () => blip(660, 0.08, 'square', 0.08),
  hitWall:   () => blip(280, 0.06, 'square', 0.06),
  score:     () => {
    blip(140, 0.4, 'sawtooth', 0.08);
    setTimeout(() => blip(80, 0.5, 'sawtooth', 0.07), 80);
  },
  cursorMove: () => blip(440, 0.04, 'square', 0.04),
  confirm:    () => blip(880, 0.10, 'square', 0.07),
  win: () => {
    [523, 659, 784, 1046].forEach((f, i) =>
      setTimeout(() => blip(f, 0.18, 'square', 0.07), i * 120)
    );
  },
};
