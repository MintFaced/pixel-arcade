import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http } from 'viem';
import { sepolia, mainnet } from 'viem/chains';
import { getAuthedAddress } from '../../../lib/auth';
import {
  buildWildpixelSvg,
  buildWildpixelMetadata,
  pinSvgToPinata,
  pinJsonToPinata,
  isWildpixelTokenId,
  wildpixelGridFor,
} from '../../../../lib/wildpixel-server';
import { pixelArcadeAbi, manifoldCoreAbi, PIXEL_ARCADE_ADDRESS, MANIFOLD_CORE_ADDRESS } from '../../../../lib/abi';

/**
 * POST /api/wildpixel/complete
 *
 * Auth required. Validates ownership + completion state, pins SVG + metadata
 * to IPFS, and returns the metadata URI for the frontend to use in the
 * completeWildpixel() contract call.
 *
 * Flow:
 *   1. Parse + validate request body
 *   2. SIWE auth check (must have signed in)
 *   3. Token must be one of the 4 wildpixels (12, 14, 15, 17)
 *   4. Chain read: caller must own the token
 *   5. Chain read: wildpixel must NOT already be completed (idempotency)
 *   6. Generate the canonical SVG from cells
 *   7. Pin SVG to Pinata → get image CID
 *   8. Build metadata JSON with the image CID
 *   9. Pin metadata JSON to Pinata → get metadata CID
 *  10. Return ipfs://<metadata CID> URI
 *
 * Note: this endpoint does NOT call the contract. The frontend handles the
 * tx submission because the user must sign with their wallet. This split
 * means a failed tx leaves orphan IPFS pins — acceptable cost (tiny files,
 * Pinata free tier) for keeping all wallet interactions client-side.
 *
 * Body: { tokenId: number, trait: string, cells: string[], rows: number, cols: number }
 * Returns: { metadataURI: string, imageCid: string, metadataCid: string }
 */

interface RequestBody {
  tokenId?: unknown;
  trait?: unknown;
  cells?: unknown;
  rows?: unknown;
  cols?: unknown;
}

interface ValidatedBody {
  tokenId: number;
  trait: string;
  cells: string[];
  rows: number;
  cols: number;
}

/** Validate the request body shape and content. Returns null if invalid. */
function validateBody(body: RequestBody): ValidatedBody | null {
  if (typeof body.tokenId !== 'number' || !Number.isInteger(body.tokenId)) return null;
  if (typeof body.trait !== 'string') return null;
  if (!Array.isArray(body.cells)) return null;
  if (typeof body.rows !== 'number' || typeof body.cols !== 'number') return null;

  const tokenId = body.tokenId;
  const trait = body.trait.trim();
  const cells = body.cells;
  const rows = body.rows;
  const cols = body.cols;

  if (trait.length === 0 || trait.length > 80) return null;
  if (cells.length !== rows * cols) return null;
  if (rows < 1 || cols < 1) return null;

  // Validate each cell is a hex color string
  for (const c of cells) {
    if (typeof c !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(c)) return null;
  }

  return { tokenId, trait, cells: cells as string[], rows, cols };
}

/** Build a public client for chain reads. Reads chain ID from env. */
function getPublicClient() {
  const chainId = process.env.CHAIN_ID ?? '11155111';
  const alchemyKey = process.env.NEXT_PUBLIC_ALCHEMY_KEY;

  if (chainId === '1') {
    return createPublicClient({
      chain: mainnet,
      transport: http(alchemyKey ? `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}` : undefined),
    });
  }
  // Default to Sepolia
  return createPublicClient({
    chain: sepolia,
    transport: http(alchemyKey ? `https://eth-sepolia.g.alchemy.com/v2/${alchemyKey}` : undefined),
  });
}

export async function POST(req: NextRequest) {
  // ---- Step 1: parse body ----
  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const validated = validateBody(body);
  if (!validated) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  // ---- Step 2: auth ----
  const callerAddress = await getAuthedAddress(req);
  if (!callerAddress) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  // ---- Step 3: token must be a wildpixel ----
  if (!isWildpixelTokenId(validated.tokenId)) {
    return NextResponse.json(
      { error: `Token ${validated.tokenId} is not a wildpixel` },
      { status: 400 }
    );
  }

  // ---- Step 3b: grid must match expected wildpixel dimensions ----
  const [expectedRows, expectedCols] = wildpixelGridFor(validated.tokenId);
  if (validated.rows !== expectedRows || validated.cols !== expectedCols) {
    return NextResponse.json(
      {
        error: `Grid mismatch for token ${validated.tokenId}: ` +
          `expected ${expectedCols}×${expectedRows}, got ${validated.cols}×${validated.rows}`,
      },
      { status: 400 }
    );
  }

  // ---- Step 4: chain ownership check ----
  const publicClient = getPublicClient();

  let currentOwner: `0x${string}`;
  try {
    currentOwner = (await publicClient.readContract({
      address: MANIFOLD_CORE_ADDRESS,
      abi: manifoldCoreAbi,
      functionName: 'ownerOf',
      args: [BigInt(validated.tokenId)],
    })) as `0x${string}`;
  } catch (err) {
    console.error('[wildpixel/complete] ownerOf failed:', err);
    return NextResponse.json(
      { error: 'Chain read failed (ownership check)' },
      { status: 502 }
    );
  }

  if (currentOwner.toLowerCase() !== callerAddress.toLowerCase()) {
    return NextResponse.json(
      { error: 'You do not own this token' },
      { status: 403 }
    );
  }

  // ---- Step 5: already-completed check (idempotency) ----
  let alreadyCompleted: boolean;
  try {
    alreadyCompleted = (await publicClient.readContract({
      address: PIXEL_ARCADE_ADDRESS,
      abi: pixelArcadeAbi,
      functionName: 'wildpixelCompleted',
      args: [BigInt(validated.tokenId)],
    })) as boolean;
  } catch (err) {
    console.error('[wildpixel/complete] wildpixelCompleted read failed:', err);
    return NextResponse.json(
      { error: 'Chain read failed (completion check)' },
      { status: 502 }
    );
  }

  if (alreadyCompleted) {
    return NextResponse.json(
      { error: 'This wildpixel has already been completed' },
      { status: 409 }
    );
  }

  // ---- Step 6: generate SVG ----
  let svg: string;
  try {
    svg = buildWildpixelSvg(validated.cells, validated.rows, validated.cols);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'SVG generation failed';
    console.error('[wildpixel/complete] SVG build failed:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // ---- Step 7: pin SVG to Pinata ----
  const tokenIdPadded = String(validated.tokenId).padStart(3, '0');
  let imageCid: string;
  try {
    imageCid = await pinSvgToPinata(svg, `${tokenIdPadded}-wildpixel.svg`);
  } catch (err) {
    console.error('[wildpixel/complete] SVG pin failed:', err);
    return NextResponse.json(
      { error: 'IPFS pin failed (image)' },
      { status: 502 }
    );
  }

  // ---- Step 8: build metadata JSON ----
  const metadata = buildWildpixelMetadata({
    tokenId: validated.tokenId,
    trait: validated.trait,
    cells: validated.cells,
    rows: validated.rows,
    cols: validated.cols,
    imageCid,
  });

  // ---- Step 9: pin metadata to Pinata ----
  let metadataCid: string;
  try {
    metadataCid = await pinJsonToPinata(metadata, `${tokenIdPadded}-wildpixel.json`);
  } catch (err) {
    console.error('[wildpixel/complete] metadata pin failed:', err);
    return NextResponse.json(
      { error: 'IPFS pin failed (metadata)' },
      { status: 502 }
    );
  }

  // ---- Step 10: return the URI ----
  return NextResponse.json({
    metadataURI: `ipfs://${metadataCid}`,
    imageCid,
    metadataCid,
  });
}
