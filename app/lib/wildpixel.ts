/**
 * Wildpixel helpers — the algorithms collectors use to complete an "awaiting
 * palette" token. None of these have side effects; safe to import anywhere.
 *
 * Notes:
 * - `extractDominantColors` uses the DOM Canvas API and only runs client-side.
 * - `buildInlineSvg` returns an SVG string with embedded styles + animation
 *   timing buckets per era, matching the production generator's output.
 */

/** Linear congruential generator — deterministic given a seed. */
export function seededRand(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Duplicate palette to fill rows×cols, then Fisher–Yates shuffle with
 * the given seed. Deterministic output for the same (palette, seed).
 */
export function arrange(
  palette: string[],
  rows: number,
  cols: number,
  seed: number
): string[] {
  const total = rows * cols;
  const dup = total / palette.length;
  const pool: string[] = [];
  for (let i = 0; i < dup; i++) pool.push(...palette);
  const r = seededRand(seed);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}

/**
 * Render an arrangement as an animated inline SVG identical in look to the
 * production-generated /svg/NNN.svg files. Used by the wildpixel modal
 * (steps 3 & 4) and to display locally-completed wildpixels in the gallery.
 *
 * The phase buckets are per-era — they spread the twitch animation across
 * different cells so the surface feels alive rather than blinking in sync.
 */
export function buildInlineSvg(cells: string[], rows: number, cols: number): string {
  const PX = 200;
  const w = cols * PX;
  const h = rows * PX;

  let rectsPrimary = '';
  let rectsGhost = '';
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const x = c * PX;
      const y = r * PX;
      const fill = cells[idx];
      rectsPrimary += `<rect class="px" x="${x}" y="${y}" width="${PX}" height="${PX}" fill="${fill}"/>`;
      rectsGhost += `<rect x="${x}" y="${y}" width="${PX}" height="${PX}" fill="${fill}"/>`;
    }
  }

  // Phase buckets — match production generator's count per era
  const buckets = cols === 4 ? 8 : rows === 2 ? 10 : 12;
  const phasesByBucket: Record<number, [number, number][]> = {
    8: [
      [0, 0.9], [0.12, 0.85], [0.25, 0.95], [0.38, 0.8],
      [0.05, 1.0], [0.30, 0.88], [0.18, 0.92], [0.42, 0.86],
    ],
    10: [
      [0, 0.9], [0.10, 0.85], [0.22, 0.95], [0.34, 0.8],
      [0.05, 1.0], [0.28, 0.88], [0.16, 0.92], [0.40, 0.86],
      [0.08, 0.94], [0.32, 0.82],
    ],
    12: [
      [0, 0.9], [0.08, 0.85], [0.16, 0.95], [0.24, 0.8],
      [0.04, 1.0], [0.28, 0.88], [0.14, 0.92], [0.36, 0.86],
      [0.06, 0.94], [0.32, 0.82], [0.20, 0.98], [0.40, 0.84],
    ],
  };
  const phases = phasesByBucket[buckets];

  let phaseCSS = '';
  for (let i = 0; i < buckets; i++) {
    const [d, dur] = phases[i];
    phaseCSS += `.px:nth-child(${buckets}n+${i}){animation-delay:${d}s;animation-duration:${dur}s;}`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">
<defs>
  <pattern id="sp" x="0" y="0" width="4" height="4" patternUnits="userSpaceOnUse">
    <rect x="0" y="0" width="4" height="2" fill="rgba(0,0,0,0)"/>
    <rect x="0" y="2" width="4" height="2" fill="rgba(0,0,0,0.45)"/>
  </pattern>
  <radialGradient id="vg" cx="50%" cy="50%" r="70%">
    <stop offset="60%" stop-color="rgb(0,0,0)" stop-opacity="0"/>
    <stop offset="100%" stop-color="rgb(0,0,0)" stop-opacity="0.45"/>
  </radialGradient>
</defs>
<style>
.px{transform-box:fill-box;transform-origin:center;animation:tw .9s steps(2) infinite;}
@keyframes tw{0%,100%{transform:scale(1);filter:brightness(1);}50%{transform:scale(1.015);filter:brightness(1.12);}}
${phaseCSS}
.gc{mix-blend-mode:screen;opacity:.45;animation:gc .5s steps(3) infinite;}
.gr{mix-blend-mode:screen;opacity:.4;animation:gr .5s steps(3) infinite;}
@keyframes gc{0%,100%{transform:translate(0,0);}33%{transform:translate(-3px,0);}66%{transform:translate(1px,0);}}
@keyframes gr{0%,100%{transform:translate(0,0);}33%{transform:translate(3px,0);}66%{transform:translate(-1px,0);}}
.sl{pointer-events:none;mix-blend-mode:multiply;animation:sc 8s linear infinite;}
@keyframes sc{from{transform:translateY(0);}to{transform:translateY(8px);}}
</style>
<rect width="${w}" height="${h}" fill="#080210"/>
<g class="gc">${rectsGhost}</g>
<g class="gr">${rectsGhost}</g>
<g>${rectsPrimary}</g>
<g class="sl"><rect x="0" y="-8" width="${w}" height="${h + 16}" fill="url(#sp)"/></g>
<rect width="${w}" height="${h}" fill="url(#vg)" pointer-events="none"/>
</svg>`;
}

/**
 * Extract `k` dominant colors from an image using bucketed quantization.
 * Draws onto a small canvas (64×64) for speed, quantizes RGB to a 32-step
 * grid, picks the top-`k` most populated buckets, returns as uppercase
 * hex strings.
 *
 * Trade-off: not a true k-means (no centroid iteration), but fast enough
 * to run on user uploads inline. Output quality is fine for 8 colors.
 */
export function extractDominantColors(
  img: HTMLImageElement,
  k: number
): string[] {
  const canvas = document.createElement('canvas');
  const size = 64;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];

  ctx.drawImage(img, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size).data;
  const buckets = new Map<string, number>();

  for (let i = 0; i < data.length; i += 4) {
    const r = Math.round(data[i] / 32) * 32;
    const g = Math.round(data[i + 1] / 32) * 32;
    const b = Math.round(data[i + 2] / 32) * 32;
    const key = `${r},${g},${b}`;
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }

  const sorted = Array.from(buckets.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, k);

  // Pad with grey if the image had fewer distinct bucket colors than requested
  while (sorted.length < k) sorted.push(['128,128,128', 0]);

  return sorted.map(([key]) => {
    const [r, g, b] = key.split(',').map(Number);
    return (
      '#' +
      [r, g, b]
        .map((x) => Math.min(255, x).toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase()
    );
  });
}
