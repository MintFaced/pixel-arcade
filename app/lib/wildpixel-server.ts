/**
 * Server-side utilities for wildpixel completion.
 *
 * The wildpixel completion flow asks the collector to provide 8 colors and
 * a game-name trait. The server then:
 *   1. Builds the final SVG from the colors + chosen arrangement
 *   2. Builds the metadata JSON in the same shape as Yungwknd's pre-minted tokens
 *   3. Pins both to IPFS via Pinata
 *   4. Returns the final ipfs:// URI for the contract's completeWildpixel call
 *
 * The frontend handles UI extraction + simulated annealing arrangement,
 * but we re-generate the SVG server-side so we own the canonical output —
 * no possibility of the client smuggling in tampered SVG markup.
 */

/* ============================================================
 * Configuration
 * ============================================================ */

const PINATA_API_BASE = 'https://api.pinata.cloud';

/** Grid dimensions for each era. Wildpixels are 8-bit only. */
const ERA_GRID: Record<'8-bit' | '16-bit' | '32-bit', [number, number]> = {
  '8-bit':  [2, 4],   // 2 rows × 4 cols = 8 cells
  '16-bit': [3, 4],   // 3×4 = 12 (not used for wildpixels but exported for completeness)
  '32-bit': [4, 6],   // 4×6 = 24
};

/** Display titles for the formal art-historical series. */
function formalSeriesTitle(tokenId: number): string {
  // 8-bit wildpixels are tokens 12, 14, 15, 17 — all "Eight-Bit Study No. N"
  if (tokenId <= 17) return `Eight-Bit Study No. ${tokenId}`;
  if (tokenId <= 45) return `Sixteen-Bit Composition No. ${tokenId}`;
  return `Thirty-Two-Bit Tableau No. ${tokenId}`;
}

/* ============================================================
 * SVG generation
 * ============================================================ */

/**
 * Build the SVG markup for a completed wildpixel.
 *
 * Each cell is a flat-colored rect arranged in a grid. The viewBox is 800×400
 * which gives clean integer pixel coordinates for a 4×2 grid (200×200 cells).
 *
 * Important: this output is what gets pinned to IPFS as the canonical
 * artwork. It must be deterministic given the same inputs — no random
 * styling, no timestamp comments, nothing that would change the CID
 * on re-pin of identical inputs.
 *
 * @param cells   Array of hex color strings, length = rows × cols
 * @param rows    Number of grid rows
 * @param cols    Number of grid columns
 * @returns       Complete SVG markup as a string
 */
export function buildWildpixelSvg(cells: string[], rows: number, cols: number): string {
  if (cells.length !== rows * cols) {
    throw new Error(`Cell count mismatch: got ${cells.length}, expected ${rows * cols}`);
  }
  // Validate every cell is a hex string. Reject anything weird.
  for (const c of cells) {
    if (!/^#[0-9a-fA-F]{6}$/.test(c)) {
      throw new Error(`Invalid color: ${c}`);
    }
  }

  const cellWidth = 800 / cols;
  const cellHeight = 400 / rows;

  const rects: string[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const x = c * cellWidth;
      const y = r * cellHeight;
      // Use uppercase hex to match Yungwknd's existing palette format
      const color = cells[idx].toUpperCase();
      rects.push(
        `<rect x="${x}" y="${y}" width="${cellWidth}" height="${cellHeight}" fill="${color}"/>`
      );
    }
  }

  // Compact single-line SVG. xmlns required so it renders standalone.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400" preserveAspectRatio="xMidYMid meet">${rects.join('')}</svg>`;
}

/* ============================================================
 * Metadata JSON construction
 * ============================================================ */

export interface WildpixelMetadataInput {
  tokenId: number;
  trait: string;          // user's chosen game name
  cells: string[];        // 8 hex colors in arranged order
  rows: number;
  cols: number;
  imageCid: string;       // CID of the pinned SVG (bafk...)
}

/**
 * Build the metadata JSON for a completed wildpixel. Matches the shape of
 * Yungwknd's pre-minted tokens (name, description, image, external_url,
 * art_title, attributes) with adjustments for the wildpixel context:
 *   - name: the trait the collector entered
 *   - description: acknowledges the collector chose the palette
 *   - art_title: formal series title (Eight-Bit Study No. N)
 *   - Wildpixel attribute: "Yes"
 *   - Color attributes: Color 1 through Color N with hex codes
 *
 * @param input Validated wildpixel completion inputs + the pinned SVG CID
 * @returns     Metadata JSON object ready to JSON.stringify and pin
 */
export function buildWildpixelMetadata(input: WildpixelMetadataInput): Record<string, unknown> {
  const { tokenId, trait, cells, rows, cols, imageCid } = input;

  const grid = `${cols}×${rows}`;
  const artTitle = formalSeriesTitle(tokenId);
  // Capitalize the trait for the name field. Preserve user's exact string
  // beyond capitalization — they typed "Pokemon Crystal" → that's the name.
  const cleanTrait = trait.trim();

  const description =
    `1/1 pixel painting from PixelArcade. Wildpixel: eight colors chosen by the ` +
    `collector from ${cleanTrait}, arranged into a fixed grid via simulated annealing. ` +
    `Each pixel is painted by hand on plywood at 150mm square. The physical painting is ` +
    `available to commission via the on-chain claim mechanic.\n\nEra: 8-bit. Source: ${cleanTrait}.`;

  // Build attributes. Order matters for marketplace display.
  const attributes: { trait_type: string; value: string | number }[] = [
    { trait_type: 'Era', value: '8-bit' },
    { trait_type: 'Game', value: cleanTrait },
    { trait_type: 'Wildpixel', value: 'Yes' },
    { trait_type: 'Grid', value: grid },
  ];
  // 8 color swatches — generic names since the collector picked them.
  // Marketplace traits page will show these as filterable hex values.
  for (let i = 0; i < cells.length; i++) {
    attributes.push({
      trait_type: `Color ${i + 1}`,
      value: cells[i].toUpperCase(),
    });
  }

  return {
    name: cleanTrait,
    description,
    image: `ipfs://${imageCid}`,
    external_url: 'https://pixelarcade.art',
    art_title: artTitle,
    attributes,
  };
}

/* ============================================================
 * Pinata client
 * ============================================================ */

/**
 * Pin an SVG file to Pinata. Returns the resulting CID.
 *
 * Pinata's pinFileToIPFS endpoint expects multipart/form-data. The CID
 * returned is the pin's permanent identifier.
 *
 * @param svg      The SVG markup
 * @param filename Filename for Pinata's records (visible in dashboard)
 * @returns        IPFS CID
 */
export async function pinSvgToPinata(svg: string, filename: string): Promise<string> {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) throw new Error('PINATA_JWT not configured');

  // Build multipart form data manually. node-fetch/global fetch handles
  // FormData natively in Node 18+.
  const form = new FormData();
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  form.append('file', blob, filename);

  // Metadata in Pinata dashboard
  form.append('pinataMetadata', JSON.stringify({
    name: filename,
    keyvalues: {
      type: 'wildpixel-svg',
    },
  }));

  // Pin options — CIDv1 is the modern default + works with all gateways.
  form.append('pinataOptions', JSON.stringify({
    cidVersion: 1,
  }));

  const resp = await fetch(`${PINATA_API_BASE}/pinning/pinFileToIPFS`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwt}`,
      // DO NOT set Content-Type — let fetch set it with the multipart boundary
    },
    body: form,
  });

  if (!resp.ok) {
    const errorText = await resp.text().catch(() => '<no body>');
    throw new Error(`Pinata SVG pin failed: ${resp.status} ${errorText}`);
  }

  const data = await resp.json() as { IpfsHash?: string };
  if (!data.IpfsHash) {
    throw new Error('Pinata response missing IpfsHash');
  }
  return data.IpfsHash;
}

/**
 * Pin a JSON object to Pinata. Returns the resulting CID.
 *
 * Uses pinJSONToIPFS (a different endpoint than pinFileToIPFS) which accepts
 * the JSON directly without multipart wrapping.
 */
export async function pinJsonToPinata(
  json: Record<string, unknown>,
  filename: string
): Promise<string> {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) throw new Error('PINATA_JWT not configured');

  const body = {
    pinataContent: json,
    pinataMetadata: {
      name: filename,
      keyvalues: {
        type: 'wildpixel-metadata',
      },
    },
    pinataOptions: {
      cidVersion: 1,
    },
  };

  const resp = await fetch(`${PINATA_API_BASE}/pinning/pinJSONToIPFS`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errorText = await resp.text().catch(() => '<no body>');
    throw new Error(`Pinata JSON pin failed: ${resp.status} ${errorText}`);
  }

  const data = await resp.json() as { IpfsHash?: string };
  if (!data.IpfsHash) {
    throw new Error('Pinata response missing IpfsHash');
  }
  return data.IpfsHash;
}

/* ============================================================
 * Validation helpers
 * ============================================================ */

const WILDPIXEL_TOKEN_IDS = new Set([12, 14, 15, 17]);

/** True if the given tokenId is one of the 4 wildpixels. */
export function isWildpixelTokenId(tokenId: number): boolean {
  return WILDPIXEL_TOKEN_IDS.has(tokenId);
}

/** Expected grid dimensions for a wildpixel token (all 8-bit, so 2×4). */
export function wildpixelGridFor(tokenId: number): [number, number] {
  if (!isWildpixelTokenId(tokenId)) {
    throw new Error(`Token ${tokenId} is not a wildpixel`);
  }
  return ERA_GRID['8-bit'];
}
