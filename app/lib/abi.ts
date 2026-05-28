/**
 * Minimal PixelArcade contract ABI — only the functions/errors the frontend
 * needs to interact with. The full ABI is on Etherscan.
 *
 * Sepolia: 0x55B7619d8985Ca4Ac2Dd0CFffa2131980217bEa6
 *
 * Custom errors are listed so wagmi/viem can decode reverts into named errors
 * (e.g. "AlreadyMinted") instead of opaque hex strings. This makes the UI
 * messaging much better.
 */

export const pixelArcadeAbi = [
  // === MINT (the one the frontend calls) ===
  {
    inputs: [
      {
        components: [
          { internalType: 'address', name: 'collector', type: 'address' },
          { internalType: 'uint256[]', name: 'tokenIds', type: 'uint256[]' },
          { internalType: 'uint256', name: 'totalPrice', type: 'uint256' },
          { internalType: 'uint256', name: 'deadline', type: 'uint256' },
          { internalType: 'bytes32', name: 'nonce', type: 'bytes32' },
        ],
        internalType: 'struct PixelArcade.MintAuthorization',
        name: 'auth',
        type: 'tuple',
      },
      { internalType: 'bytes', name: 'signature', type: 'bytes' },
    ],
    name: 'batchMint',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  // === READS (for HUD / availability checks) ===
  {
    inputs: [],
    name: 'getAvailableTokens',
    outputs: [{ internalType: 'uint256[]', name: 'available', type: 'uint256[]' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'tokenId', type: 'uint256' }],
    name: 'isMinted',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'MINT_PRICE',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  // === PHYSICAL CLAIM ===
  {
    inputs: [{ internalType: 'uint256[]', name: 'tokenIds', type: 'uint256[]' }],
    name: 'previewClaimCost',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256[]', name: 'tokenIds', type: 'uint256[]' }],
    name: 'claimPhysical',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  // === WILDPIXEL COMPLETION ===
  // Owner-only metadata rewrite for the 4 wildpixel tokens (12, 14, 15, 17).
  // Pass the new IPFS URI returned by /api/wildpixel/complete after pinning.
  {
    inputs: [
      { internalType: 'uint256', name: 'tokenId', type: 'uint256' },
      { internalType: 'string', name: 'newTokenURI', type: 'string' },
    ],
    name: 'completeWildpixel',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    name: 'isWildpixel',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    name: 'physicalClaimed',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    name: 'wildpixelCompleted',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  // === EVENTS (for indexing post-mint) ===
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'uint256', name: 'tokenId', type: 'uint256' },
      { indexed: true, internalType: 'address', name: 'collector', type: 'address' },
    ],
    name: 'Minted',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'uint256', name: 'tokenId', type: 'uint256' },
      { indexed: true, internalType: 'address', name: 'claimer', type: 'address' },
      { indexed: false, internalType: 'uint256', name: 'amountPaid', type: 'uint256' },
    ],
    name: 'PhysicalClaimed',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'uint256', name: 'tokenId', type: 'uint256' },
      { indexed: true, internalType: 'address', name: 'owner', type: 'address' },
      { indexed: false, internalType: 'string', name: 'newTokenURI', type: 'string' },
    ],
    name: 'WildpixelCompleted',
    type: 'event',
  },
  // === CUSTOM ERRORS (so viem can decode reverts into readable names) ===
  { inputs: [], name: 'AlreadyMinted', type: 'error' },
  { inputs: [], name: 'AuthAlreadyUsed', type: 'error' },
  { inputs: [], name: 'AuthExpired', type: 'error' },
  { inputs: [], name: 'BadBatchSize', type: 'error' },
  { inputs: [], name: 'BadMsgValue', type: 'error' },
  { inputs: [], name: 'BadSignature', type: 'error' },
  { inputs: [], name: 'BadTotalPrice', type: 'error' },
  { inputs: [], name: 'NotSeeded', type: 'error' },
  // === Claim-related errors ===
  { inputs: [], name: 'AlreadyClaimed', type: 'error' },
  { inputs: [], name: 'EmptyClaim', type: 'error' },
  { inputs: [], name: 'NotTokenOwner', type: 'error' },
  { inputs: [], name: 'WildpixelNotCompleted', type: 'error' },
  // === Wildpixel-completion errors ===
  { inputs: [], name: 'NotWildpixel', type: 'error' },
  { inputs: [], name: 'AlreadyCompleted', type: 'error' },
] as const;

/**
 * Contract address — read at runtime from env to allow Sepolia/mainnet swap
 * without code change. Falls back to the current Sepolia testnet address.
 *
 * NOTE: NEXT_PUBLIC_ prefix means this is bundled into the client.
 * Different from the server-side CONTRACT_ADDRESS used by /api/mint-authorization.
 * Both must point at the same address for everything to work.
 */
export const PIXEL_ARCADE_ADDRESS =
  (process.env.NEXT_PUBLIC_CONTRACT_ADDRESS as `0x${string}` | undefined) ??
  '0xFAD64829d66e43389A11ec466F834d7F7F2B251C';

/**
 * Manifold creator core address — the actual ERC-721 contract.
 * `ownerOf`, `balanceOf`, `tokenURI`, `Transfer` events all live here.
 * Marketplaces look at this address, not the extension.
 *
 * The extension address above handles custom logic; the core handles standard
 * NFT ownership. Both must be deployed and linked for the system to work.
 */
export const MANIFOLD_CORE_ADDRESS =
  (process.env.NEXT_PUBLIC_MANIFOLD_CORE as `0x${string}` | undefined) ??
  '0x280C3C59688c004b7ed753666F17De9c4970EBf0';

/**
 * Minimal ERC-721 ABI for the Manifold core — only the reads we need for
 * the my-mints page. Standard ERC-721 interface, no Manifold extensions.
 */
export const manifoldCoreAbi = [
  {
    inputs: [{ internalType: 'uint256', name: 'tokenId', type: 'uint256' }],
    name: 'ownerOf',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: 'owner', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'tokenId', type: 'uint256' }],
    name: 'tokenURI',
    outputs: [{ internalType: 'string', name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;
