import { promises as fs } from 'fs';
import path from 'path';

/**
 * Server-side tier lookup. Reads /public/proofs.json from disk on cold-start,
 * caches in module scope, and looks up addresses to determine tier.
 *
 * Frontend's useUserTier hook does the same thing client-side; this is the
 * server-side authoritative source.
 */

interface ProofEntry {
  tier: number;
  proof: string[];
}
type ProofsFile = Record<string, ProofEntry>;

let cachedProofs: ProofsFile | null = null;
let proofsPromise: Promise<ProofsFile> | null = null;

async function loadProofs(): Promise<ProofsFile> {
  if (cachedProofs) return cachedProofs;
  if (proofsPromise) return proofsPromise;
  proofsPromise = (async () => {
    try {
      const filePath = path.join(process.cwd(), 'public', 'proofs.json');
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw) as ProofsFile;
      cachedProofs = parsed;
      return parsed;
    } catch (err) {
      console.error('[tier] Failed to load proofs.json:', err);
      cachedProofs = {};
      return {};
    }
  })();
  return proofsPromise;
}

export type Tier = 'standard' | 'elevated';

export interface TierLookupResult {
  tier: Tier;
  rollsPerDay: number;
  /** Merkle proof if elevated, empty array if standard */
  proof: `0x${string}`[];
  /** Numeric tier value used in contract: 0 = standard, 1 = elevated */
  tierValue: 0 | 1;
}

const TIER_TO_ROLLS: Record<Tier, number> = {
  standard: 3,
  elevated: 5,
};

/** Look up a wallet's tier. Always returns a valid result (standard by default). */
export async function lookupTier(address: string): Promise<TierLookupResult> {
  const proofs = await loadProofs();
  const entry = proofs[address.toLowerCase()];
  if (entry && entry.tier === 1) {
    return {
      tier: 'elevated',
      rollsPerDay: TIER_TO_ROLLS.elevated,
      proof: entry.proof as `0x${string}`[],
      tierValue: 1,
    };
  }
  return {
    tier: 'standard',
    rollsPerDay: TIER_TO_ROLLS.standard,
    proof: [],
    tierValue: 0,
  };
}
