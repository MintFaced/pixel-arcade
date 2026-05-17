/**
 * Catalog loader — fetches the static catalog.json with all 64 token entries,
 * and resolves token IDs to full metadata.
 *
 * The catalog lives at /svg/catalog.json (in public/svg/) and is the same
 * inventory file that was pinned to IPFS in the generator output. We use
 * it here only as a convenient client-side lookup; on-chain tokenURI is
 * the source of truth in production.
 */

export interface CatalogEntry {
  token_id: number;
  name: string;
  art_title: string;
  trait: string;
  year: number;
  manufacturer: string;
  platform: string;
  era: '8-bit' | '16-bit' | '32-bit';
  grid: { rows: number; cols: number };
  wildpixel: boolean;
  swatches: string[];
  arrangement: string[][];
  svg_file: string;
}

let catalogCache: CatalogEntry[] | null = null;

export async function loadCatalog(): Promise<CatalogEntry[]> {
  if (catalogCache) return catalogCache;
  try {
    const resp = await fetch('/svg/catalog.json');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = (await resp.json()) as CatalogEntry[];
    catalogCache = data;
    return data;
  } catch (err) {
    console.warn('[loadCatalog] failed', err);
    return [];
  }
}

export function findCatalogEntry(
  catalog: CatalogEntry[],
  tokenId: number
): CatalogEntry | null {
  return catalog.find((c) => c.token_id === tokenId) ?? null;
}
