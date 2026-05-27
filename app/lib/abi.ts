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
  // === CUSTOM ERRORS (so viem can decode reverts into readable names) ===
  { inputs: [], name: 'AlreadyMinted', type: 'error' },
  { inputs: [], name: 'AuthAlreadyUsed', type: 'error' },
  { inputs: [], name: 'AuthExpired', type: 'error' },
  { inputs: [], name: 'BadBatchSize', type: 'error' },
  { inputs: [], name: 'BadMsgValue', type: 'error' },
  { inputs: [], name: 'BadSignature', type: 'error' },
  { inputs: [], name: 'BadTotalPrice', type: 'error' },
  { inputs: [], name: 'NotSeeded', type: 'error' },
] as const;

/**
 * Contract address — read at runtime from env to allow Sepolia/mainnet swap
 * without code change. Falls back to the Sepolia testnet address.
 *
 * NOTE: NEXT_PUBLIC_ prefix means this is bundled into the client.
 * Different from the server-side CONTRACT_ADDRESS used by /api/mint-authorization.
 * Both must point at the same address for everything to work.
 */
export const PIXEL_ARCADE_ADDRESS =
  (process.env.NEXT_PUBLIC_CONTRACT_ADDRESS as `0x${string}` | undefined) ??
  '0x55B7619d8985Ca4Ac2Dd0CFffa2131980217bEa6';
