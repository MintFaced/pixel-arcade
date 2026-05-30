export type SpriteEntry = { src: string; dims: [number, number] };
export type Roster = {
  player: SpriteEntry;
  enemies: Record<string, SpriteEntry[]>;
};

export type Assets = {
  playerImg: HTMLImageElement;
  playerDims: [number, number];
  enemySprites: Record<string, HTMLImageElement[]>;
  enemyDims: Record<string, [number, number][]>;
};

const BASE = '/survivors/sprites/';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load ' + src));
    img.src = src;
  });
}

export async function loadAssets(): Promise<Assets> {
  const res = await fetch('/survivors/roster.json');
  if (!res.ok) throw new Error('roster.json failed: ' + res.status);
  const roster: Roster = await res.json();

  const playerImg = await loadImage(BASE + roster.player.src);
  const playerDims = roster.player.dims;

  const enemySprites: Record<string, HTMLImageElement[]> = {};
  const enemyDims:    Record<string, [number, number][]> = {};

  const skinNames = Object.keys(roster.enemies);
  await Promise.all(
    skinNames.map(async skin => {
      const entries = roster.enemies[skin];
      const imgs = await Promise.all(entries.map(e => loadImage(BASE + e.src)));
      enemySprites[skin] = imgs;
      enemyDims[skin]    = entries.map(e => e.dims);
    })
  );

  return { playerImg, playerDims, enemySprites, enemyDims };
}
