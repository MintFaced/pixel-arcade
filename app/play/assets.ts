/**
 * SWARM asset loader.
 *
 * Loads all sprite images from /public/swarm/sprites/ before the game starts.
 * All assets are bundled locally — no runtime IPFS fetching needed (was tried
 * in 5b prototype but gateways are unreliable and add 5-20s latency).
 *
 * If a sprite fails to load, a magenta placeholder is used so the game still
 * runs and a warning shows in the UI.
 *
 * Future: when wallet connection is wired (5c), we can OPTIONALLY fetch the
 * player's own mfer from IPFS to use as their ship — that's an enhancement
 * not a dependency, so we'd keep gateway fetch as a runtime option.
 */

export type SpriteKey =
  // Player
  | 'player-ship'
  // Power-ups (XNoun heads)
  | 'noun-shield'
  | 'noun-life'
  | 'noun-firerate'
  | 'noun-slowmo'
  | 'noun-multiplier'
  | 'noun-invincible'
  // Bosses (XCOPY-styled pieces)
  | 'boss-damager'
  | 'boss-doomed-red'
  | 'boss-rage'
  | 'boss-spec-ops'
  | 'boss-beast'
  | 'boss-maxpain'
  // Enemies (real mfers)
  | 'mfer-grunt'
  | 'mfer-runner'
  | 'mfer-sniper'
  | 'mfer-bomber';

const SPRITE_PATHS: Record<SpriteKey, string> = {
  'player-ship':       '/swarm/sprites/player-ship.png',
  'noun-shield':       '/swarm/sprites/noun-shield.png',
  'noun-life':         '/swarm/sprites/noun-life.png',
  'noun-firerate':     '/swarm/sprites/noun-firerate.png',
  'noun-slowmo':       '/swarm/sprites/noun-slowmo.png',
  'noun-multiplier':   '/swarm/sprites/noun-multiplier.png',
  'noun-invincible':   '/swarm/sprites/noun-invincible.png',
  'boss-damager':      '/swarm/sprites/boss-damager.png',
  'boss-doomed-red':   '/swarm/sprites/boss-doomed-red.png',
  'boss-rage':         '/swarm/sprites/boss-rage.png',
  'boss-spec-ops':     '/swarm/sprites/boss-spec-ops.png',
  'boss-beast':        '/swarm/sprites/boss-beast.png',
  'boss-maxpain':      '/swarm/sprites/boss-maxpain.png',
  'mfer-grunt':        '/swarm/sprites/mfer-grunt.png',
  'mfer-runner':       '/swarm/sprites/mfer-runner.png',
  'mfer-sniper':       '/swarm/sprites/mfer-sniper.png',
  'mfer-bomber':       '/swarm/sprites/mfer-bomber.png',
};

export interface AssetBundle {
  sprites: Map<SpriteKey, HTMLImageElement>;
  failed: SpriteKey[];
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load: ${src}`));
    img.src = src;
  });
}

/**
 * Render a colored placeholder square as fallback for failed loads.
 * Color hints at what role the missing sprite plays.
 */
function placeholderImage(label: string, color: string): HTMLImageElement {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 32, 32);
  ctx.fillStyle = '#ffffff';
  ctx.font = '8px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label.slice(0, 5), 16, 16);
  const img = new Image();
  img.src = canvas.toDataURL();
  return img;
}

/**
 * Load all sprites in parallel. Returns when complete (or all failed).
 * onProgress fires per-asset so the UI can show a load bar.
 */
export async function loadAssets(
  onProgress?: (loaded: number, total: number, current: string) => void
): Promise<AssetBundle> {
  const sprites = new Map<SpriteKey, HTMLImageElement>();
  const failed: SpriteKey[] = [];
  const entries = Object.entries(SPRITE_PATHS) as [SpriteKey, string][];
  const total = entries.length;
  let loaded = 0;

  const tasks = entries.map(async ([key, path]) => {
    try {
      const img = await loadImage(path);
      sprites.set(key, img);
    } catch (err) {
      console.warn(`[assets] Failed to load ${key}:`, err);
      failed.push(key);
      const color = key.startsWith('boss-') ? '#ff1ad9'
        : key.startsWith('mfer-') ? '#ff8800'
        : key.startsWith('noun-') ? '#00ffd0'
        : '#ffe000';
      sprites.set(key, placeholderImage(key.split('-').pop()!, color));
    } finally {
      loaded++;
      onProgress?.(loaded, total, key);
    }
  });

  await Promise.all(tasks);
  return { sprites, failed };
}
