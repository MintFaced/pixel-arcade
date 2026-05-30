/**
 * Tennis assets — types and loader.
 *
 * Single fetch of /tennis/roster.json gives us polygons, bg mapping, and
 * ball SVG path data. Sprite PNGs and background GIFs are loaded as Image
 * objects from /tennis/sprites/ and /tennis/backgrounds/ respectively.
 */

const PUB = '/tennis';

export interface CharacterData {
  name: string;          // 'xnouns_3'
  sprite: string;        // 'xnouns_3.png'
  width: number;
  height: number;
  polygon: number[][];   // sprite-pixel coords
  bg: string;            // bg name without extension, e.g. 'sidewayz'
}

export interface RosterData {
  version: number;
  characters: CharacterData[];
  backgrounds: string[];        // filenames like 'sidewayz.gif'
  ballFrames: string[][];       // 4 frames, each an array of SVG path strings
  ballViewBox: number;          // the SVG viewBox dimension (3000)
}

export interface LoadedCharacter extends CharacterData {
  image: HTMLImageElement;
  scale: number;
  drawW: number;
  drawH: number;
}

export interface Assets {
  roster: RosterData;
  characters: Record<string, LoadedCharacter>;   // by name
  bgs: Record<string, HTMLImageElement>;         // by name (no extension)
  ballPaths: Path2D[][];                         // built from ballFrames
}

// Paddle envelope — every sprite scales to fit within this box.
export const PAD_BOX_W = 100;
export const PAD_BOX_H = 140;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}

export async function loadAssets(): Promise<Assets> {
  const roster: RosterData = await fetch(`${PUB}/roster.json`).then(r => r.json());

  // Sprite images in parallel
  const charEntries = await Promise.all(
    roster.characters.map(async (c) => {
      const image = await loadImage(`${PUB}/sprites/${c.sprite}`);
      const scale = Math.min(PAD_BOX_W / c.width, PAD_BOX_H / c.height);
      const loaded: LoadedCharacter = {
        ...c,
        image,
        scale,
        drawW: Math.round(c.width * scale),
        drawH: Math.round(c.height * scale),
      };
      return [c.name, loaded] as const;
    })
  );
  const characters = Object.fromEntries(charEntries);

  // BG images — start loading but don't block. They'll appear when ready.
  // (We could await these too if we want a black flash to be impossible.)
  const bgs: Record<string, HTMLImageElement> = {};
  for (const bgFile of roster.backgrounds) {
    const name = bgFile.replace(/\.[a-z]+$/, '');
    const img = new Image();
    img.src = `${PUB}/backgrounds/${bgFile}`;
    bgs[name] = img;
  }

  // Build Path2D objects per ball frame
  const ballPaths = roster.ballFrames.map((frame) =>
    frame.map((d) => new Path2D(d))
  );

  return { roster, characters, bgs, ballPaths };
}
