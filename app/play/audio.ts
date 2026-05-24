/**
 * AudioEngine — the sound system for SWARM.
 *
 * Two layers of sound:
 *   1. Sample-based — pre-recorded MP3s loaded once. Used for explosions,
 *      coins, voice taunts, music. Higher quality, no synthesis math.
 *   2. Synth-based — Web Audio oscillators created on demand. Used for
 *      shots, pickups, blips — sounds that fire dozens of times per second
 *      and would be wasteful as samples.
 *
 * Three buses:
 *   - SFX bus (explosions, shots, pickups)
 *   - Music bus (looping background tracks)
 *   - Voice bus (boss taunt MP3s)
 *
 * The music bus auto-ducks (lowers in volume) when a voice plays.
 *
 * Mute state persists across sessions via localStorage.
 * Master volume is currently fixed; a slider could be added later.
 *
 * Browser autoplay policy: AudioContext starts in 'suspended' state and must
 * be resumed after a user gesture (click, keypress). The engine handles this
 * automatically on the first play() call after the user has interacted.
 */

/** Identifiers for synth-style SFX (no sample needed) */
export type SynthSfx =
  | 'player-shot'
  | 'enemy-shot'
  | 'powerup-pickup'
  | 'glasses-pickup'
  | 'wave-clear'
  | 'menu-blip'
  | 'enemy-hit'
  | 'mfer-dive';

/** Identifiers for sample-based SFX. Must match files in /swarm/audio/sfx/{key}.mp3 */
export type SampleSfx =
  | 'fx-explode-small'
  | 'fx-explode-big'
  | 'fx-coin'
  | 'fx-cherry'
  | 'fx-shield-break'
  | 'fx-player-death'
  | 'fx-titan-shot'
  | 'fx-boss-warning'
  | 'fx-game-over'
  | 'fx-true-victory'
  | 'fx-mintface-incoming';

/** Music tracks. Files in /swarm/audio/music/{key}.mp3 */
export type MusicTrack =
  // Attract / pre-game — plays on INSERT COIN screen + during demo
  | 'music-attract'
  // Chapter music — one per chapter (4-5 waves each)
  | 'music-chapter-1'
  | 'music-chapter-2'
  | 'music-chapter-3'
  | 'music-chapter-4'
  | 'music-chapter-5'
  | 'music-chapter-6'
  // Boss music — distinct track per boss
  | 'music-boss-damager'
  | 'music-boss-6529-punk'
  | 'music-boss-rage'
  | 'music-boss-spec-ops'
  | 'music-boss-beast-mode'
  | 'music-boss-max-pain'
  | 'music-mintface';

/**
 * Resolve which music track plays for a given wave number.
 *
 * Wave → music mapping:
 *   1-4    → chapter-1   (cherry chapter, gentle entry)
 *   5      → boss-damager
 *   6-9    → chapter-2
 *   10     → boss-6529-punk
 *   11-14  → chapter-3
 *   15     → boss-rage
 *   16-19  → chapter-4
 *   20     → boss-spec-ops
 *   21-24  → chapter-5
 *   25     → boss-beast-mode
 *   26-30  → chapter-6 (or wave 30 → boss-max-pain)
 *   30     → boss-max-pain
 *   31     → mintface (secret final)
 */
export function musicForWave(wave: number): MusicTrack {
  if (wave === 5)  return 'music-boss-damager';
  if (wave === 10) return 'music-boss-6529-punk';
  if (wave === 15) return 'music-boss-rage';
  if (wave === 20) return 'music-boss-spec-ops';
  if (wave === 25) return 'music-boss-beast-mode';
  if (wave === 30) return 'music-boss-max-pain';
  if (wave === 31) return 'music-mintface';
  if (wave <= 4)   return 'music-chapter-1';
  if (wave <= 9)   return 'music-chapter-2';
  if (wave <= 14)  return 'music-chapter-3';
  if (wave <= 19)  return 'music-chapter-4';
  if (wave <= 24)  return 'music-chapter-5';
  return 'music-chapter-6';   // 26-29 (wave 30 is handled above)
}

/** Boss IDs that have voice taunts. Files in /swarm/audio/voice/{bossId}-{idx}.mp3 */
export type BossVoiceId =
  | 'damager'
  | '6529-punk'
  | 'rage'
  | 'spec-ops'
  | 'beast-mode'
  | 'max-pain'
  | 'mintface';

const MUTE_KEY = 'pixelarcade_swarm_audio_muted';
const VOLUME_KEY = 'pixelarcade_swarm_audio_volume';

/** Number of voice clip variants per boss (look up taunt-{id}-0.mp3 through taunt-{id}-{N-1}.mp3) */
const VOICE_VARIANTS_PER_BOSS: Record<BossVoiceId, number> = {
  'damager': 4,
  '6529-punk': 4,
  'rage': 4,
  'spec-ops': 4,
  'beast-mode': 4,
  'max-pain': 6,
  'mintface': 7,
};

/**
 * The SFX list to preload during the existing asset loader screen.
 * Music is loaded on-demand (it's bigger and we don't want to delay startup).
 */
const SAMPLE_SFX_KEYS: SampleSfx[] = [
  'fx-explode-small',
  'fx-explode-big',
  'fx-coin',
  'fx-cherry',
  'fx-shield-break',
  'fx-player-death',
  'fx-titan-shot',
  'fx-boss-warning',
  'fx-game-over',
  'fx-true-victory',
  'fx-mintface-incoming',
];

export class AudioEngine {
  private ctx: AudioContext | null = null;
  /** True after first successful resume() — i.e. user has interacted */
  private contextUnlocked = false;
  /** Set true after first attempted play to know we should resume */
  private wantsToPlay = false;

  // Mixer buses
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private voiceGain: GainNode | null = null;

  // Loaded sample buffers
  private sampleBuffers = new Map<string, AudioBuffer>();
  /** Track in-flight music: source node + its fade gain + which track */
  private currentMusic: { source: AudioBufferSourceNode; fadeGain: GainNode; track: MusicTrack } | null = null;
  /** Whether a voice clip is currently playing (for ducking music) */
  private voicePlaying = 0;
  /** Last-played voice timestamps per boss to avoid stacking same boss */
  private lastVoiceAt = new Map<BossVoiceId, number>();

  // User-controlled state
  private muted = false;
  private masterVolume = 0.7;

  constructor() {
    // Read persisted state (skip in SSR)
    if (typeof window !== 'undefined') {
      try {
        this.muted = localStorage.getItem(MUTE_KEY) === 'true';
        const v = localStorage.getItem(VOLUME_KEY);
        if (v !== null) {
          const parsed = parseFloat(v);
          if (!Number.isNaN(parsed)) this.masterVolume = Math.max(0, Math.min(1, parsed));
        }
      } catch {
        // localStorage may be blocked; use defaults
      }
    }
  }

  /**
   * Lazily create the AudioContext + mixer graph. Called on first interaction.
   * AudioContext creation is allowed at any time; resume() requires user gesture.
   */
  private ensureContext() {
    if (this.ctx) return;
    if (typeof window === 'undefined') return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AC();
    } catch {
      // No audio support in this browser
      return;
    }
    // Mixer graph: each bus → master → destination
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.muted ? 0 : this.masterVolume;
    this.masterGain.connect(this.ctx.destination);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.85;       // SFX slightly quieter than full
    this.sfxGain.connect(this.masterGain);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.5;      // Music sits underneath
    this.musicGain.connect(this.masterGain);

    this.voiceGain = this.ctx.createGain();
    this.voiceGain.gain.value = 1.0;      // Voice loudest — taunts must cut through
    this.voiceGain.connect(this.masterGain);
  }

  /**
   * Attempt to resume the AudioContext after user interaction.
   * Called automatically before the first play() call.
   */
  private async tryResume(): Promise<boolean> {
    this.ensureContext();
    if (!this.ctx) return false;
    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch {
        return false;
      }
    }
    this.contextUnlocked = this.ctx.state === 'running';
    return this.contextUnlocked;
  }

  /**
   * Preload sample-based SFX. Called during the existing asset loader.
   * Returns a promise that resolves when all SFX are loaded (or failed).
   */
  async preloadSfx(onProgress?: (loaded: number, total: number) => void): Promise<void> {
    this.ensureContext();
    if (!this.ctx) return;
    const tasks = SAMPLE_SFX_KEYS.map((key) => this.loadSample(`/swarm/audio/sfx/${key}.mp3`, key));
    let done = 0;
    await Promise.all(tasks.map(async (p) => {
      try {
        await p;
      } catch {
        // ignore load errors — sample just won't be available
      }
      done++;
      onProgress?.(done, SAMPLE_SFX_KEYS.length);
    }));
  }

  /**
   * Preload all known voice taunts. Quiet failure — most won't exist initially
   * (waiting for user-recorded voiceovers). They'll be loaded on-demand later
   * if they appear in the public folder. Optional to call during init.
   */
  async preloadVoiceTaunts(): Promise<void> {
    if (typeof window === 'undefined') return;
    this.ensureContext();
    if (!this.ctx) return;
    const tasks: Promise<void>[] = [];
    for (const bossId in VOICE_VARIANTS_PER_BOSS) {
      const id = bossId as BossVoiceId;
      const n = VOICE_VARIANTS_PER_BOSS[id];
      for (let i = 0; i < n; i++) {
        const url = `/swarm/audio/voice/taunt-${id}-${i}.mp3`;
        const key = `voice-${id}-${i}`;
        tasks.push(this.loadSample(url, key).catch(() => {}));
      }
    }
    await Promise.all(tasks);
  }

  private async loadSample(url: string, key: string): Promise<void> {
    if (!this.ctx) return;
    if (this.sampleBuffers.has(key)) return;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const arrayBuf = await res.arrayBuffer();
    const audioBuf = await this.ctx.decodeAudioData(arrayBuf);
    this.sampleBuffers.set(key, audioBuf);
  }

  /**
   * Play a sample-based SFX. Optional pitch and volume tweaks per call so the
   * same explosion doesn't sound mechanical when fired 20× in a row.
   *
   * @param pitchVariance ±semitones random pitch jitter (0.0 = no jitter, 0.15 = subtle, 0.5 = pronounced)
   * @param volumeScale 0..1 multiplier on top of bus gain
   */
  playSample(key: SampleSfx, opts: { pitchVariance?: number; volumeScale?: number } = {}) {
    if (this.muted) return;
    if (!this.ctx || !this.sfxGain) return;
    const buffer = this.sampleBuffers.get(key);
    if (!buffer) return;
    this.tryResume();
    if (this.ctx.state !== 'running') {
      // Browser hasn't allowed audio yet
      this.wantsToPlay = true;
      return;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    // Random pitch shift via playbackRate (rough — semitones via 2^(n/12))
    const variance = opts.pitchVariance ?? 0;
    if (variance > 0) {
      const semitones = (Math.random() * 2 - 1) * variance;
      src.playbackRate.value = Math.pow(2, semitones / 12);
    }
    if (opts.volumeScale !== undefined && opts.volumeScale !== 1) {
      const g = this.ctx.createGain();
      g.gain.value = opts.volumeScale;
      src.connect(g);
      g.connect(this.sfxGain);
    } else {
      src.connect(this.sfxGain);
    }
    src.start();
  }

  /**
   * Play a synth-based SFX. Cheap to call many times per second.
   */
  playSynth(key: SynthSfx) {
    if (this.muted) return;
    if (!this.ctx || !this.sfxGain) {
      this.ensureContext();
      if (!this.ctx || !this.sfxGain) return;
    }
    this.tryResume();
    if (this.ctx.state !== 'running') {
      this.wantsToPlay = true;
      return;
    }

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const out = this.sfxGain;

    switch (key) {
      case 'player-shot': {
        // Thin descending square — pew
        const osc = ctx.createOscillator();
        osc.type = 'square';
        const g = ctx.createGain();
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.exponentialRampToValueAtTime(440, now + 0.08);
        g.gain.setValueAtTime(0, now);
        g.gain.linearRampToValueAtTime(0.18, now + 0.005);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
        osc.connect(g);
        g.connect(out);
        osc.start(now);
        osc.stop(now + 0.1);
        break;
      }
      case 'enemy-shot': {
        // Lower, darker than player shot
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        const g = ctx.createGain();
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 1200;
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.exponentialRampToValueAtTime(110, now + 0.12);
        g.gain.setValueAtTime(0, now);
        g.gain.linearRampToValueAtTime(0.12, now + 0.01);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        osc.connect(filter);
        filter.connect(g);
        g.connect(out);
        osc.start(now);
        osc.stop(now + 0.14);
        break;
      }
      case 'powerup-pickup': {
        // 4-note ascending arpeggio: C E G C
        const notes = [523.25, 659.25, 783.99, 1046.5];
        notes.forEach((freq, i) => {
          const osc = ctx.createOscillator();
          osc.type = 'triangle';
          const g = ctx.createGain();
          const start = now + i * 0.05;
          osc.frequency.value = freq;
          g.gain.setValueAtTime(0, start);
          g.gain.linearRampToValueAtTime(0.18, start + 0.005);
          g.gain.exponentialRampToValueAtTime(0.001, start + 0.12);
          osc.connect(g);
          g.connect(out);
          osc.start(start);
          osc.stop(start + 0.15);
        });
        break;
      }
      case 'glasses-pickup': {
        // Single high chime
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        const g = ctx.createGain();
        osc.frequency.value = 1318.51;   // E6
        g.gain.setValueAtTime(0, now);
        g.gain.linearRampToValueAtTime(0.22, now + 0.005);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.connect(g);
        g.connect(out);
        osc.start(now);
        osc.stop(now + 0.2);
        break;
      }
      case 'wave-clear': {
        // C-E-G major triad arpeggio
        const notes = [523.25, 659.25, 783.99];
        notes.forEach((freq, i) => {
          const osc = ctx.createOscillator();
          osc.type = 'triangle';
          const g = ctx.createGain();
          const start = now + i * 0.1;
          osc.frequency.value = freq;
          g.gain.setValueAtTime(0, start);
          g.gain.linearRampToValueAtTime(0.22, start + 0.01);
          g.gain.exponentialRampToValueAtTime(0.001, start + 0.3);
          osc.connect(g);
          g.connect(out);
          osc.start(start);
          osc.stop(start + 0.35);
        });
        break;
      }
      case 'menu-blip': {
        // Single 100ms square blip
        const osc = ctx.createOscillator();
        osc.type = 'square';
        const g = ctx.createGain();
        osc.frequency.value = 660;
        g.gain.setValueAtTime(0, now);
        g.gain.linearRampToValueAtTime(0.15, now + 0.005);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
        osc.connect(g);
        g.connect(out);
        osc.start(now);
        osc.stop(now + 0.1);
        break;
      }
      case 'enemy-hit': {
        // Brief filtered noise burst
        const bufferSize = ctx.sampleRate * 0.05;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
        }
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 1500;
        filter.Q.value = 1.5;
        const g = ctx.createGain();
        g.gain.value = 0.15;
        src.connect(filter);
        filter.connect(g);
        g.connect(out);
        src.start();
        break;
      }
      case 'mfer-dive': {
        // Descending sine sweep — "wheee"
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        const g = ctx.createGain();
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(110, now + 0.25);
        g.gain.setValueAtTime(0, now);
        g.gain.linearRampToValueAtTime(0.12, now + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        osc.connect(g);
        g.connect(out);
        osc.start(now);
        osc.stop(now + 0.3);
        break;
      }
    }
  }

  /**
   * Track we are *currently transitioning to or playing*. Used as a fast-path
   * dedup check so concurrent playMusic() calls don't both start sources.
   * Updated synchronously at the top of playMusic() before any awaits.
   */
  private pendingTrack: MusicTrack | null = null;

  /**
   * Start a music track. If a track is already playing, cross-fades to the new
   * one over 0.5s (old fades out, new fades in). If `track` is null, fades out
   * the current music.
   *
   * Concurrency: this function is async (awaits resume + sample load). Multiple
   * rapid calls are safe — only the most recently requested track wins. The
   * `pendingTrack` check at the top bails out duplicate calls for the same
   * track while one is still in flight.
   */
  async playMusic(track: MusicTrack | null) {
    if (!this.ctx || !this.musicGain) {
      this.ensureContext();
      if (!this.ctx || !this.musicGain) return;
    }
    // Dedup: already playing this track, or already transitioning to it
    if (this.pendingTrack === track) return;
    // Record intent IMMEDIATELY — before any awaits — so subsequent calls
    // for the same track bail and subsequent calls for a different track
    // can see what we're switching to.
    this.pendingTrack = track;

    await this.tryResume();
    if (this.ctx.state !== 'running' && track !== null) {
      // We'll be called again when audio unlocks
      this.wantsToPlay = true;
      this.pendingTrack = null;   // reset so retry isn't deduped
      return;
    }

    // While we were awaiting, someone else may have requested a different
    // track. Bail if so — the latest call will handle the actual switch.
    if (this.pendingTrack !== track) return;

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const fadeTime = 0.5;

    // Fade out current with a proper gain ramp, then stop the source.
    // We need a per-source gain node — the bus gain affects ALL music, so
    // we can't ramp it down without also dimming the incoming fade-in.
    if (this.currentMusic) {
      const old = this.currentMusic;
      // The source was connected through a fade gain when it started — find it.
      // We store the fade gain alongside the source now (see end of this fn).
      try {
        if (old.fadeGain) {
          old.fadeGain.gain.cancelScheduledValues(now);
          old.fadeGain.gain.setValueAtTime(old.fadeGain.gain.value, now);
          old.fadeGain.gain.linearRampToValueAtTime(0, now + fadeTime);
        }
        old.source.stop(now + fadeTime + 0.05);
      } catch {
        // already stopped
      }
      this.currentMusic = null;
    }

    if (track === null) {
      // Just fading out, no new music to start
      this.pendingTrack = null;
      return;
    }

    // Load the music track if not already loaded
    if (!this.sampleBuffers.has(track)) {
      try {
        await this.loadSample(`/swarm/audio/music/${track}.mp3`, track);
      } catch {
        this.pendingTrack = null;
        return;
      }
      // Re-check pending in case caller switched again during load
      if (this.pendingTrack !== track) return;
    }
    const buffer = this.sampleBuffers.get(track);
    if (!buffer) {
      this.pendingTrack = null;
      return;
    }

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    // Per-source fade-in via a dedicated gain node (kept on the record so
    // the NEXT playMusic() call can use it to fade THIS source out cleanly).
    const fadeGain = ctx.createGain();
    fadeGain.gain.setValueAtTime(0, now);
    fadeGain.gain.linearRampToValueAtTime(1, now + fadeTime);
    src.connect(fadeGain);
    fadeGain.connect(this.musicGain);
    src.start(now);
    this.currentMusic = { source: src, fadeGain, track };
  }

  /**
   * Play a random boss taunt voice clip. Falls back silently if no clips
   * for that boss are loaded yet (waiting for user voice recordings).
   *
   * Ducks the music bus by ~70% while voice is playing.
   */
  async playBossTaunt(bossId: BossVoiceId, phraseIdx?: number) {
    if (this.muted) return;
    if (!this.ctx || !this.voiceGain || !this.musicGain) return;
    await this.tryResume();
    if (this.ctx.state !== 'running') return;

    const variants = VOICE_VARIANTS_PER_BOSS[bossId];
    const idx = phraseIdx ?? Math.floor(Math.random() * variants);
    const key = `voice-${bossId}-${idx}`;
    // Lazy-load if not already cached
    if (!this.sampleBuffers.has(key)) {
      try {
        await this.loadSample(`/swarm/audio/voice/taunt-${bossId}-${idx}.mp3`, key);
      } catch {
        // No clip available — silent fallback
        return;
      }
    }
    const buffer = this.sampleBuffers.get(key);
    if (!buffer) return;

    // Throttle: don't repeat same boss's voice within 2 seconds
    const now = performance.now();
    const last = this.lastVoiceAt.get(bossId) ?? 0;
    if (now - last < 2000) return;
    this.lastVoiceAt.set(bossId, now);

    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.voiceGain);

    // Duck music down during voice, restore after
    const musicGain = this.musicGain.gain;
    const startTime = ctx.currentTime;
    const duration = buffer.duration;
    const duckLevel = 0.15;        // music drops to 15% of normal during voice
    const restoreLevel = 0.5;      // back to normal level
    musicGain.cancelScheduledValues(startTime);
    musicGain.setValueAtTime(musicGain.value, startTime);
    musicGain.linearRampToValueAtTime(duckLevel, startTime + 0.1);
    musicGain.linearRampToValueAtTime(duckLevel, startTime + duration);
    musicGain.linearRampToValueAtTime(restoreLevel, startTime + duration + 0.3);

    this.voicePlaying++;
    src.onended = () => {
      this.voicePlaying = Math.max(0, this.voicePlaying - 1);
    };
    src.start();
  }

  /** Toggle mute on/off, persist to localStorage */
  toggleMute(): boolean {
    this.muted = !this.muted;
    this.applyMute();
    try {
      localStorage.setItem(MUTE_KEY, String(this.muted));
    } catch {
      // ignore
    }
    return this.muted;
  }

  isMuted(): boolean {
    return this.muted;
  }

  private applyMute() {
    if (!this.masterGain || !this.ctx) return;
    const target = this.muted ? 0 : this.masterVolume;
    const now = this.ctx.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.linearRampToValueAtTime(target, now + 0.05);
  }

  /** Force-unlock audio after a user interaction. Safe to call multiple times. */
  unlock() {
    this.ensureContext();
    void this.tryResume();
  }
}

/**
 * Singleton helper — most callers just want `getAudio()`. The engine is
 * lazily constructed because we don't want to touch AudioContext at module
 * load time in case it's running in an SSR context.
 */
let _instance: AudioEngine | null = null;
export function getAudio(): AudioEngine {
  if (!_instance) _instance = new AudioEngine();
  return _instance;
}
