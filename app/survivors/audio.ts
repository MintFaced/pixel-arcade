let audioCtx: AudioContext | null = null;

export function ensureAudio() {
  if (audioCtx) return;
  try {
    const Ctx =
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      ?? window.AudioContext;
    audioCtx = new Ctx();
  } catch {
    audioCtx = null;
  }
}

function blip(freq: number, dur: number, type: OscillatorType = 'square', vol = 0.06) {
  ensureAudio();
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

export const SFX = {
  fire:      () => blip(880, 0.04, 'square', 0.025),
  hit:       () => blip(440, 0.05, 'square', 0.05),
  kill:      () => blip(220, 0.06, 'sawtooth', 0.05),
  playerHit: () => { blip(140, 0.15, 'sawtooth', 0.10); blip(80, 0.2, 'sawtooth', 0.08); },
  xpGet:     () => blip(1200, 0.03, 'sine', 0.04),
  levelUp:   () => [523, 659, 784, 1046].forEach((f, i) =>
                     setTimeout(() => blip(f, 0.12, 'square', 0.08), i * 90)),
  bossWarn:  () => [200, 180, 200, 180].forEach((f, i) =>
                     setTimeout(() => blip(f, 0.18, 'sawtooth', 0.10), i * 200)),
  bossDie:   () => [600, 400, 200, 100].forEach((f, i) =>
                     setTimeout(() => blip(f, 0.25, 'sawtooth', 0.10), i * 150)),
  upgrade:   () => blip(1500, 0.1, 'sine', 0.08),
};
