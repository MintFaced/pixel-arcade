/**
 * Fetch an SVG by URL and extract the per-pixel fill colors in row-major order.
 *
 * The generator produces SVGs with three <g> groups: cyan ghost, red ghost,
 * and the primary (unclassed) group. We read the primary group's <rect fill>
 * values in document order, which matches the row-major arrangement.
 *
 * Returns [] on failure — callers should treat that as "skip the pixel build,
 * jump straight to the SVG swap".
 */
export async function fetchSvgArrangement(svgUrl: string): Promise<string[]> {
  try {
    const resp = await fetch(svgUrl);
    if (!resp.ok) return [];
    const svgText = await resp.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, 'image/svg+xml');

    // Find the unclassed primary <g>. Fallback to the third group if everything is classed.
    const groups = doc.querySelectorAll('g');
    let primary: Element | null = null;
    groups.forEach((g) => {
      if (!primary && g.classList.length === 0) primary = g;
    });
    if (!primary && groups.length >= 3) primary = groups[2];
    if (!primary) return [];

    const rects = (primary as Element).querySelectorAll('rect');
    return Array.from(rects).map((r) => r.getAttribute('fill') || '#000');
  } catch (err) {
    console.warn('[fetchSvgArrangement] failed', err);
    return [];
  }
}
