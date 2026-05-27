import { privateKeyToAccount } from 'viem/accounts';
import type { Address } from 'viem';

/**
 * EIP-712 typed-data signing for MintAuthorization payloads.
 *
 * The signature is what Yungwknd's contract verifies before allowing a mint.
 * It proves the backend authorized this specific mint for this specific
 * collector for this specific total price.
 *
 * Required env vars:
 *   MINT_SIGNER_PRIVATE_KEY — 0x-prefixed 64-char hex (a fresh EOA, never holds funds)
 *   CONTRACT_ADDRESS        — the deployed PixelArcade extension contract
 *   CHAIN_ID                — 11155111 (Sepolia) or 1 (mainnet)
 *
 * STRUCT — must match the deployed contract exactly. Verified against the
 * Sepolia ABI at 0x55B7619d8985Ca4Ac2Dd0CFffa2131980217bEa6:
 *
 *   struct MintAuthorization {
 *     address collector;
 *     uint256[] tokenIds;
 *     uint256 totalPrice;
 *     uint256 deadline;
 *     bytes32 nonce;
 *   }
 *
 * Any deviation (field order, types, names) breaks signature verification.
 */
export const EIP712_DOMAIN_NAME = 'PixelArcade';
export const EIP712_DOMAIN_VERSION = '1';

export const MINT_AUTH_TYPES = {
  MintAuthorization: [
    { name: 'collector', type: 'address' },
    { name: 'tokenIds', type: 'uint256[]' },
    { name: 'totalPrice', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

export interface MintAuthorizationMessage {
  /** The wallet that will send the mint tx — must equal msg.sender on-chain */
  collector: Address;
  /** Token IDs being minted in this batch (1–MAX_BATCH, contract enforces) */
  tokenIds: bigint[];
  /** Exact ETH value (wei) the user must send with batchMint() */
  totalPrice: bigint;
  /** Unix timestamp after which the authorization expires */
  deadline: bigint;
  /** 32-byte random nonce, unique per authorization (contract tracks via usedAuthorizations mapping) */
  nonce: `0x${string}`;
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
 *  confirming what to give Yungwknd for setMintAuthorizer(). */
export function getSignerAddress(): Address {
  return getSigner().address;
}

function getDomain() {
  const contractAddress = process.env.CONTRACT_ADDRESS;
  const chainId = process.env.CHAIN_ID ? parseInt(process.env.CHAIN_ID, 10) : 11155111;
  if (!contractAddress) {
    throw new Error('CONTRACT_ADDRESS env var missing (set after Yungwknd deploys)');
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
    collector: Address;
    tokenIds: string[];     // bigint → string for JSON safety
    totalPrice: string;     // bigint → string
    deadline: string;       // bigint → string
    nonce: `0x${string}`;   // 32-byte hex
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
      collector: message.collector,
      tokenIds: message.tokenIds.map(String),
      totalPrice: message.totalPrice.toString(),
      deadline: message.deadline.toString(),
      nonce: message.nonce,
    },
    signature,
  };
}

/** Mint price per token, in wei (0.05 ETH). Matches contract MINT_PRICE constant. */
export const MINT_PRICE_WEI = 50_000_000_000_000_000n;  // 0.05 ETH

/** Generate a 32-byte random nonce as 0x-prefixed hex. */
export function generateNonce(): `0x${string}` {
  // Use Web Crypto API — available in Edge Runtime + Node 19+
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return ('0x' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')) as `0x${string}`;
}
