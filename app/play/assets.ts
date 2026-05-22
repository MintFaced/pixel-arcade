/**
 * SWARM asset loader.
 *
 * Loads all sprite images before the game starts. Two sources:
 *   1. Local public/swarm/sprites/*.png — bundled CC0 assets (player, bosses, power-ups)
 *   2. IPFS gateway — fetches mfer #N images live at game start
 *
 * The loader exposes a typed registry. Engine references sprites by name,
 * never by path. If a sprite fails to load, a magenta placeholder is used
 * so the game still runs.
 *
 * mfers metadata IPFS CID is publicly known and the collection is CC0.
 * We try multiple gateways for resilience (sometimes one is slow or down).
 */

export type SpriteKey =
  // Player + power-ups (local PNGs)
  | 'player-ship'
  | 'noun-shield'
  | 'noun-life'
  | 'noun-firerate'
  | 'noun-slowmo'
  | 'noun-multiplier'
  | 'noun-invincible'
  // Bosses (local PNGs)
  | 'boss-damager'
  | 'boss-doomed-red'
  | 'boss-rage'
  | 'boss-spec-ops'
  | 'boss-beast'
  | 'boss-maxpain'
  // Enemies (fetched from IPFS at runtime)
  | 'mfer-grunt'
  | 'mfer-runner'
  | 'mfer-sniper'
  | 'mfer-bomber';

interface SpriteSource {
  /** Local /public path, OR an IPFS path that we'll resolve via gateways */
  local?: string;
  ipfsPath?: string;
}

/** mfer token IDs mapped to enemy tiers (per user's selection). */
const MFER_IDS = {
  'mfer-grunt': 2346,
  'mfer-runner': 9956,
  'mfer-sniper': 8278,
  'mfer-bomber': 1586,
} as const;

const SPRITE_SOURCES: Record<SpriteKey, SpriteSource> = {
  // Local sprites
  'player-ship':       { local: '/swarm/sprites/player-ship.png' },
  'noun-shield':       { local: '/swarm/sprites/noun-shield.png' },
  'noun-life':         { local: '/swarm/sprites/noun-life.png' },
  'noun-firerate':     { local: '/swarm/sprites/noun-firerate.png' },
  'noun-slowmo':       { local: '/swarm/sprites/noun-slowmo.png' },
  'noun-multiplier':   { local: '/swarm/sprites/noun-multiplier.png' },
  'noun-invincible':   { local: '/swarm/sprites/noun-invincible.png' },
  'boss-damager':      { local: '/swarm/sprites/boss-damager.png' },
  'boss-doomed-red':   { local: '/swarm/sprites/boss-doomed-red.png' },
  'boss-rage':         { local: '/swarm/sprites/boss-rage.png' },
  'boss-spec-ops':     { local: '/swarm/sprites/boss-spec-ops.png' },
  'boss-beast':        { local: '/swarm/sprites/boss-beast.png' },
  'boss-maxpain':      { local: '/swarm/sprites/boss-maxpain.png' },
  // Live-fetched
  'mfer-grunt':   { ipfsPath: `mfers/${MFER_IDS['mfer-grunt']}.png` },
  'mfer-runner':  { ipfsPath: `mfers/${MFER_IDS['mfer-runner']}.png` },
  'mfer-sniper':  { ipfsPath: `mfers/${MFER_IDS['mfer-sniper']}.png` },
  'mfer-bomber':  { ipfsPath: `mfers/${MFER_IDS['mfer-bomber']}.png` },
};

/**
 * mfers images live on IPFS. Known CID for the mfers image folder:
 *   QmWiQE65tmpYzcokCheQmng2DCM33DEhjXcPB6PanwpAZo
 * (Sartoshi's original deployment, CC0.)
 *
 * Each image is accessible at:
 *   https://<gateway>/ipfs/<cid>/<tokenId>.png
 *
 * We try multiple public gateways for resilience.
 */
const MFERS_IPFS_CID = 'QmWiQE65tmpYzcokCheQmng2DCM33DEhjXcPB6PanwpAZo';
const IPFS_GATEWAYS = [
  'https://ipfs.io',
  'https://nftstorage.link',
  'https://cloudflare-ipfs.com',
  'https://dweb.link',
  'https://gateway.pinata.cloud',
];

export interface AssetBundle {
  sprites: Map<SpriteKey, HTMLImageElement>;
  failed: SpriteKey[];
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load: ${src}`));
    img.src = src;
  });
}

/**
 * Try multiple IPFS gateways for a given path until one succeeds.
 * Each gateway gets ~5 sec before we fall back.
 */
async function loadFromIpfs(ipfsPath: string): Promise<HTMLImageElement> {
  const [_collection, file] = ipfsPath.split('/');
  for (const gw of IPFS_GATEWAYS) {
    const url = `${gw}/ipfs/${MFERS_IPFS_CID}/${file}`;
    try {
      const img = await Promise.race([
        loadImage(url),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000)),
      ]);
      return img;
    } catch {
      // Try next gateway
    }
  }
  throw new Error(`All IPFS gateways failed for ${ipfsPath}`);
}

/**
 * Render a magenta placeholder square as fallback for failed loads.
 * Returns an HTMLImageElement so the engine doesn't need special handling.
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
 * Load all sprites. Returns when local ones are loaded. IPFS loads happen
 * in parallel and resolve when ready — engine treats them as optional.
 *
 * onProgress fires per-asset so the UI can show a load bar.
 */
export async function loadAssets(
  onProgress?: (loaded: number, total: number, current: string) => void
): Promise<AssetBundle> {
  const sprites = new Map<SpriteKey, HTMLImageElement>();
  const failed: SpriteKey[] = [];
  const entries = Object.entries(SPRITE_SOURCES) as [SpriteKey, SpriteSource][];
  const total = entries.length;
  let loaded = 0;

  const tasks = entries.map(async ([key, src]) => {
    try {
      const img = src.local
        ? await loadImage(src.local)
        : await loadFromIpfs(src.ipfsPath!);
      sprites.set(key, img);
    } catch (err) {
      console.warn(`[assets] Failed to load ${key}:`, err);
      failed.push(key);
      // Use placeholder so engine doesn't crash on missing sprite
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
