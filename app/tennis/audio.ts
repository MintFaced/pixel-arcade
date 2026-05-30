/**
 * Audio: synthesized SFX (Web Audio API) + music streaming (HTMLAudioElement).
 *
 * SFX are short blips synthesised on demand. Music tracks are pre-loaded
 * HTMLAudioElements that loop until told otherwise. The two systems share
 * the same lazy-init pattern: nothing happens until the first user gesture,
 * which sidesteps browser autoplay restrictions.
 *
 * Mix targets: SFX play at their natural volume (~0.06–0.08 gain).
 * Music sits at MUSIC_VOL (default 0.32) so the beeps cut through cleanly.
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
  // Local win fanfare kept as a backup — Music.playVictory() is preferred.
  win: () => {
    [523, 659, 784, 1046].forEach((f, i) =>
      setTimeout(() => blip(f, 0.18, 'square', 0.07), i * 120)
    );
  },
};

// ============ MUSIC ===================================================
const MUSIC_VOL = 0.32;        // baseline volume — leaves space for SFX
const VICTORY_VOL = 0.55;      // stinger gets slightly louder

const tracks: Record<string, HTMLAudioElement> = {};
let current: HTMLAudioElement | null = null;
let currentName: string | null = null;

/**
 * Register a music track. Call once per track at startup. Volume starts
 * at 0; the track does not play until playMusic() is invoked.
 */
export function registerMusic(name: string, url: string) {
  if (typeof window === 'undefined') return;
  if (tracks[name]) return;
  const audio = new Audio(url);
  audio.preload = 'auto';
  audio.loop = true;
  audio.volume = 0;
  // Allow some browsers to start decoding immediately
  audio.load();
  tracks[name] = audio;
}

/**
 * Start a registered track on loop. If the same track is already playing,
 * does nothing (no restart). Stops any other current track first.
 */
export function playMusic(name: string) {
  const next = tracks[name];
  if (!next) return;
  if (current === next && !next.paused) return;
  stopMusic();
  current = next;
  currentName = name;
  next.loop = true;
  next.currentTime = 0;
  next.volume = MUSIC_VOL;
  void next.play().catch(() => { /* autoplay blocked — fine, will retry on next gesture */ });
}

export function stopMusic() {
  if (current) {
    current.pause();
    current.currentTime = 0;
  }
  current = null;
  currentName = null;
}

/** Lower the loop volume briefly (e.g. for a POINT pause) and restore. */
export function duckMusic(toVol: number, durMs: number, restoreAfter = true) {
  if (!current) return;
  const start = current.volume;
  const tStart = performance.now();
  const track = current;
  const tick = () => {
    if (current !== track) return; // changed tracks mid-fade
    const t = (performance.now() - tStart) / durMs;
    if (t >= 1) {
      track.volume = toVol;
      if (restoreAfter) {
        setTimeout(() => { if (current === track) fadeVolume(MUSIC_VOL, 400); }, 600);
      }
      return;
    }
    track.volume = start + (toVol - start) * t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function fadeVolume(toVol: number, durMs: number) {
  if (!current) return;
  const start = current.volume;
  const tStart = performance.now();
  const track = current;
  const tick = () => {
    if (current !== track) return;
    const t = (performance.now() - tStart) / durMs;
    if (t >= 1) { track.volume = toVol; return; }
    track.volume = start + (toVol - start) * t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/**
 * Game-over stinger. Plays once (no loop). The 'victory' track must be
 * registered. Stops loop music first.
 */
export function playVictory() {
  const v = tracks['victory'];
  if (!v) return;
  stopMusic();
  v.loop = false;
  v.currentTime = 0;
  v.volume = VICTORY_VOL;
  void v.play().catch(() => {});
}

export function currentMusicName() { return currentName; }
