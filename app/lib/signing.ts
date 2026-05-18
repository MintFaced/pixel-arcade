import { privateKeyToAccount } from 'viem/accounts';
import type { Address } from 'viem';

/**
 * EIP-712 typed-data signing for MintAuthorization payloads.
 *
 * The signature is what Yungwknd's contract verifies before allowing a mint.
 * It proves the backend authorized this specific mint for this specific
 * address with these specific token IDs at this specific tier.
 *
 * Required env vars:
 *   MINT_SIGNER_PRIVATE_KEY — 0x-prefixed 64-char hex (a fresh EOA, never holds funds)
 *   CONTRACT_ADDRESS        — the deployed PixelArcade contract (Sepolia/mainnet)
 *   CHAIN_ID                — 11155111 (Sepolia) or 1 (mainnet)
 *
 * STRUCT DEFINITION — must match Yung's contract exactly. If his struct
 * differs (field order, types, names), signatures won't verify on-chain.
 * Currently assumed:
 *
 *   struct MintAuthorization {
 *     address minter;
 *     uint256[] tokenIds;
 *     uint8 tier;            // 0 standard, 1 elevated
 *     bytes32[] merkleProof; // empty if tier == 0
 *     uint256 nonce;
 *     uint256 deadline;
 *   }
 *
 * If Yung's struct differs, update MINT_AUTH_TYPES below.
 */

export const EIP712_DOMAIN_NAME = 'PixelArcade';
export const EIP712_DOMAIN_VERSION = '1';

export const MINT_AUTH_TYPES = {
  MintAuthorization: [
    { name: 'minter', type: 'address' },
    { name: 'tokenIds', type: 'uint256[]' },
    { name: 'tier', type: 'uint8' },
    { name: 'merkleProof', type: 'bytes32[]' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

export interface MintAuthorizationMessage {
  minter: Address;
  tokenIds: bigint[];
  tier: number;                    // 0 or 1
  merkleProof: `0x${string}`[];
  nonce: bigint;
  deadline: bigint;
}

/** Get the configured signer account from env. Throws if missing or malformed. */
function getSigner() {
  const pk = process.env.MINT_SIGNER_PRIVATE_KEY;
  if (!pk) throw new Error('MINT_SIGNER_PRIVATE_KEY env var missing');
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    throw new Error('MINT_SIGNER_PRIVATE_KEY must be 0x + 64 hex chars');
  }
  return privateKeyToAccount(pk as `0x${string}`);
}

/** Public address of the configured signer. Useful for /api/health and for
 *  confirming what to give Yung for setMintSigner(). */
export function getSignerAddress(): Address {
  return getSigner().address;
}

function getDomain() {
  const contractAddress = process.env.CONTRACT_ADDRESS;
  const chainId = process.env.CHAIN_ID ? parseInt(process.env.CHAIN_ID, 10) : 11155111;
  if (!contractAddress) {
    throw new Error('CONTRACT_ADDRESS env var missing (set after Yung deploys)');
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(contractAddress)) {
    throw new Error('CONTRACT_ADDRESS must be 0x + 40 hex chars');
  }
  return {
    name: EIP712_DOMAIN_NAME,
    version: EIP712_DOMAIN_VERSION,
    chainId,
    verifyingContract: contractAddress as Address,
  };
}

/** Sign a MintAuthorization. Returns the 65-byte signature. */
export async function signMintAuthorization(message: MintAuthorizationMessage): Promise<`0x${string}`> {
  const signer = getSigner();
  const domain = getDomain();
  const signature = await signer.signTypedData({
    domain,
    types: MINT_AUTH_TYPES,
    primaryType: 'MintAuthorization',
    message,
  });
  return signature;
}

/** Return the full payload + signature, JSON-serializable. */
export interface SignedMintAuthorization {
  domain: ReturnType<typeof getDomain>;
  types: typeof MINT_AUTH_TYPES;
  primaryType: 'MintAuthorization';
  message: {
    minter: Address;
    tokenIds: string[];    // bigint → string for JSON safety
    tier: number;
    merkleProof: `0x${string}`[];
    nonce: string;
    deadline: string;
  };
  signature: `0x${string}`;
}

export async function buildSignedMintAuthorization(
  message: MintAuthorizationMessage
): Promise<SignedMintAuthorization> {
  const signature = await signMintAuthorization(message);
  const domain = getDomain();
  return {
    domain,
    types: MINT_AUTH_TYPES,
    primaryType: 'MintAuthorization',
    message: {
      minter: message.minter,
      tokenIds: message.tokenIds.map(String),
      tier: message.tier,
      merkleProof: message.merkleProof,
      nonce: message.nonce.toString(),
      deadline: message.deadline.toString(),
    },
    signature,
  };
}
