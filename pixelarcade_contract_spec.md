# PixelArcade — Smart Contract Requirements

**Project:** 64 Arcade Pixel Paintings (APP) · 1/1 NFTs derived from retro game palettes
**Site:** pixelarcade.art (operated by MintFace)
**Network:** Ethereum mainnet
**Spec version:** 1.0 · For implementation scoping

---

## 1. Executive summary

PixelArcade needs a custom ERC-721 1/1/X contract supporting six non-standard mechanics that go beyond stock marketplace offerings:

1. **VRF-random reveal at roll time** — collector rolls and a random unminted token is revealed; the artist does *not* pre-determine the mint order.
2. **Tier-gated daily roll allowance** — wallets get 3 or 5 rolls per UTC day based on off-chain verification (TDH whale status, line-artist allowlist).
3. **Off-chain session holds with on-chain race-to-mint** — collectors can hold rolled tokens in an ephemeral session tray and toggle lock/unlock, but the final mint is a permissionless race; first batch-mint transaction to land wins.
4. **Batch mint** of multiple specific token IDs in a single transaction.
5. **Post-mint metadata updates for wildpixel tokens** — collectors of designated "wildpixel" token IDs can write their final palette + arrangement + trait into the metadata one time, after which it is frozen.
6. **Era-aware token metadata** — every token's metadata declares its era (8-bit / 16-bit / 32-bit) which determines the physical painting price downstream (off-chain).

The contract is on-chain. A backend service holds ephemeral roll-session state and submits signed authorizations that the contract verifies.

---

## 2. Architectural overview

Three components:

**On-chain — the contract.** Holds token IDs, mint state, royalties, wildpixel metadata writes, and verifies signed authorizations from the backend. Emits events.

**Off-chain — the backend (the "MintFace orchestrator").** Holds per-wallet roll session state in Redis with TTL. Performs tier verification (TDH API, line-artist allowlist). Issues EIP-712 signed mint authorizations consumed by the contract. Watches contract events to update its view of which token IDs are minted (so it never authorizes a mint on a token already minted).

**Off-chain — the indexer.** Listens to `Minted` events and maintains a Postgres view used by the frontend HUD (POOL: 47/64 etc.). Can be a service like Alchemy/The Graph or a simple custom ethers.js listener.

The key insight: **all sensitive logic (who can roll, how many times per day, which token they rolled) lives in the backend.** The contract's job is to verify the backend's signed authorization and atomically mint. This keeps gas costs low (no on-chain TDH lookups, no daily counters) while preserving trustlessness on the part that matters — the actual mint and ownership.

---

## 3. Token structure

64 total tokens, fixed supply. Token IDs `1` through `64`.

Each token has an immutable **era** and **grid dimensions** baked in at deploy time:

| Token range | Era | Grid | Count |
|---|---|---|---|
| 1–17 | 8-bit | 2×4 | 17 |
| 18–45 | 16-bit | 2×8 | 28 |
| 46–64 | 32-bit | 4×8 | 19 |

Within each era, **4 tokens are designated wildpixels** (final token IDs TBD by artist; placeholder candidates listed in the project spec). Wildpixel tokens are minted with placeholder metadata; the owner can complete them later via `completeWildpixel()`.

Token metadata (final, post-mint):

```json
{
  "name": "Pac-Man",
  "final_title": "Eight-Bit Study No. 8",
  "description": "1/1 pixel painting · color palette derived from a 1980 arcade game.",
  "image": "ipfs://<arrangement render>",
  "attributes": [
    {"trait_type": "Era", "value": "8-bit"},
    {"trait_type": "Trait", "value": "Pac-Man"},
    {"trait_type": "Year", "value": 1980},
    {"trait_type": "Grid", "value": "4×2"},
    {"trait_type": "Wildpixel", "value": false}
  ],
  "swatches": ["#000000", "#2121DE", "#FFFF00", "#FF0000", "#FFB8FF", "#00FFFF", "#FFB851", "#DEBA87"],
  "arrangement": [
    ["#DEBA87", "#FFB8FF"],
    ["#000000", "#FFFF00"],
    ["#FF0000", "#2121DE"],
    ["#00FFFF", "#FFB851"]
  ]
}
```

For game-derived tokens, the metadata is finalized at deploy time and stored at a fixed `tokenURI`. For wildpixel tokens, the metadata is replaced via `setTokenURI()` after the collector completes the wildpixel flow.

---

## 4. State variables

```solidity
// Mint state — bitmap pattern for gas efficiency
uint256 private _mintedBitmap1;  // tokens 1-64 (only first 64 bits used)

// Or alternatively, a mapping for readability:
// mapping(uint256 => bool) public isMinted;

// Wildpixel state
mapping(uint256 => bool) public isWildpixel;            // set at deploy
mapping(uint256 => bool) public wildpixelCompleted;     // set when collector locks
uint256 public constant MAX_SUPPLY = 64;

// Pricing
uint256 public constant MINT_PRICE = 0.05 ether;

// Authorization
address public mintAuthorizer;  // EIP-712 signer (the backend wallet)
mapping(bytes32 => bool) public usedAuthorizations;  // replay protection

// Roles (using Manifold's AdminControl or OpenZeppelin AccessControl)
// - DEFAULT_ADMIN: MintFace ops wallet — emergency pause, configure authorizer
// - WILDPIXEL_FREEZER: optional role to permanently freeze wildpixel metadata after collector completes
```

---

## 5. External functions

### 5.1 `batchMint(MintAuthorization calldata auth, bytes calldata signature)`

The mint entry point. Atomic — all token IDs in the authorization either mint together or revert together. **No state mutation happens unless every token in the batch is still unminted and the signature is valid.**

```solidity
struct MintAuthorization {
    address collector;        // who is minting
    uint256[] tokenIds;       // 1 to 5 token IDs from the collector's locked rolls
    uint256 totalPrice;       // tokenIds.length * MINT_PRICE
    uint256 deadline;         // unix timestamp; auth expires
    bytes32 nonce;            // unique per authorization, prevents replay
}

function batchMint(
    MintAuthorization calldata auth,
    bytes calldata signature
) external payable {
    // 1. require(msg.sender == auth.collector)
    // 2. require(block.timestamp <= auth.deadline)
    // 3. require(msg.value == auth.totalPrice)
    // 4. require(auth.tokenIds.length >= 1 && auth.tokenIds.length <= 5)
    // 5. Verify EIP-712 signature was made by mintAuthorizer
    // 6. require(!usedAuthorizations[auth.nonce])
    // 7. usedAuthorizations[auth.nonce] = true
    // 8. For each tokenId:
    //    - require(tokenId >= 1 && tokenId <= MAX_SUPPLY)
    //    - require(!_isMinted(tokenId))  // bitmap check
    //    - _setMinted(tokenId)
    //    - _mint(auth.collector, tokenId)
    //    - emit Minted(tokenId, auth.collector)
    // 9. Forward msg.value to payout address
}
```

**Why this design?** The backend signs an authorization saying "this wallet is allowed to mint these specific token IDs right now for this price." The contract doesn't care about rolls, tiers, daily limits, or TDH status — it only verifies that someone authorized the mint and the tokens are still available. This is the FOMO mechanic: two collectors could simultaneously have valid authorizations for the same token, but only the first batch-mint transaction to land succeeds. The second reverts at step 8 (`!_isMinted(tokenId)`) and the collector keeps their ETH minus gas.

### 5.2 `completeWildpixel(uint256 tokenId, string calldata newTokenURI)`

Called by the owner of a wildpixel token to write their final metadata. One-time operation per token.

```solidity
function completeWildpixel(
    uint256 tokenId,
    string calldata newTokenURI
) external {
    require(isWildpixel[tokenId], "Not a wildpixel");
    require(!wildpixelCompleted[tokenId], "Already completed");
    require(ownerOf(tokenId) == msg.sender, "Not owner");

    wildpixelCompleted[tokenId] = true;
    _setTokenURI(tokenId, newTokenURI);  // calls into core contract

    emit WildpixelCompleted(tokenId, msg.sender, newTokenURI);
}
```

The `newTokenURI` points to a JSON file (IPFS or arweave) that the MintFace backend pins after the collector finishes the wildpixel flow on the frontend. The contract doesn't validate the JSON contents — that's the backend's responsibility before pinning.

**Important constraint:** once `wildpixelCompleted[tokenId]` is true, the URI cannot be changed again, even by the admin. This makes the wildpixel a true one-shot decision and gives collectors the same finality as game-derived tokens.

### 5.3 `isMinted(uint256 tokenId) external view returns (bool)`

Public view function. The backend reads this (via standard RPC or its indexer cache) to know which token IDs are still in the pool. The frontend reads it via the indexer for the HUD.

### 5.4 `getMintedTokens() external view returns (uint256[] memory)`

Returns the list of minted token IDs. Useful for off-chain consumers that want a single-call snapshot. Implementation note: if using the bitmap pattern this is a few hundred bytes of return data, very cheap.

### 5.5 `setMintAuthorizer(address newAuthorizer)`

Admin-only. Lets MintFace rotate the backend signer key if it's ever compromised. Emits `MintAuthorizerChanged`.

### 5.6 Standard ERC-721 functions

`ownerOf`, `balanceOf`, `transferFrom`, `safeTransferFrom`, `approve`, `setApprovalForAll`, `getApproved`, `isApprovedForAll`, `tokenURI`, `supportsInterface`. Inherited from the underlying core contract (e.g. Manifold's `ERC721Creator`).

### 5.7 Royalties (EIP-2981)

`royaltyInfo(uint256, uint256 salePrice) returns (address, uint256)` — returns MintFace's royalty receiver and royalty amount. Configurable by admin. Default 5% (500 basis points), to be confirmed with artist.

---

## 6. Events

```solidity
event Minted(uint256 indexed tokenId, address indexed collector);
event WildpixelCompleted(uint256 indexed tokenId, address indexed owner, string newTokenURI);
event MintAuthorizerChanged(address indexed oldAuthorizer, address indexed newAuthorizer);
```

Standard ERC-721 events (`Transfer`, `Approval`, `ApprovalForAll`) and EIP-4906 (`MetadataUpdate`) emitted via the inherited core contract.

**EIP-4906 specifically matters for wildpixels.** Marketplaces (OpenSea, Foundation, etc.) listen for `MetadataUpdate(tokenId)` and refresh their cached metadata. Without this event firing on `completeWildpixel`, the wildpixel will continue to show "awaiting palette" on marketplaces even after it's been completed. Manifold's `ERC721Creator` emits this automatically when `setTokenURI` is called; Transient's contracts also support it.

---

## 7. Off-chain backend responsibilities

The MintFace backend (Node.js / Python / whatever) handles:

### 7.1 Tier verification on wallet connect
- Read wallet address
- Hit 6529 TDH API → mark as `whale` if ≥1M TDH
- Check internal allowlist → mark as `line-artist`
- Default to `standard`
- Tier → `rollsPerDay`: standard=3, whale=5, line-artist=5

### 7.2 Daily roll allowance enforcement
- Redis key: `rolls:{walletAddress}:{utcDate}` storing `{used: int, remaining: int}`
- Resets at UTC midnight (per spec §9 — confirm with artist)
- Decremented on each roll, never on lock/unlock toggle

### 7.3 Session state
- Redis key: `session:{walletAddress}` storing:
```json
{
  "rolls": [
    {"tokenId": 23, "locked": true, "rolledAt": "..."},
    {"tokenId": 8, "locked": false, "rolledAt": "..."}
  ],
  "expiresAt": "...",
  "version": 3
}
```
- TTL: 15 minutes (configurable)
- "Walk away = all released" semantics: when TTL expires or wallet disconnects via explicit signal, the session is deleted and the held token IDs become available for other wallets to roll

### 7.4 Pool state
- Backend maintains "currently available" set: all token IDs `1..64` MINUS already-minted (from indexer) MINUS currently-held-in-active-sessions (from Redis)
- Each roll: pick random token ID from this set, atomically move it from "available" to "this wallet's session", return to frontend
- Critical: this set operation must be atomic (Redis SETNX or Lua script) to prevent two simultaneous rolls picking the same token

### 7.5 VRF integration
For provable randomness, the roll could use Chainlink VRF. There are two patterns:

**Pattern A — VRF per roll (most trustless).** Every roll triggers a VRF request, takes ~30 seconds, costs ~$2 of LINK. Adds friction.

**Pattern B — VRF for session seed (recommended).** Once per session, request a VRF seed from Chainlink. Use that seed deterministically to pick rolls. Cheaper and faster. The seed and the algorithm are both auditable post-hoc.

**Pattern C — Off-chain randomness (acceptable).** Use `crypto.randomBytes(32)` on the backend, commit the hash to chain when the session starts (`startSession` function emits an event with the hash), reveal the seed later. Less expensive than VRF but requires collectors to trust MintFace.

For PixelArcade I'd recommend **Pattern B** — it preserves provable randomness without making rolls feel slow.

### 7.6 Mint authorization signing
When the collector clicks "MINT ALL LOCKED":
1. Backend reads session, collects all locked tokenIds
2. Constructs `MintAuthorization` struct
3. Signs with EIP-712 using the `mintAuthorizer` private key
4. Returns signature to frontend
5. Frontend calls `contract.batchMint(auth, signature)` with `msg.value = totalPrice`

The signature is single-use (nonce-protected). If the collector doesn't broadcast within `deadline` (e.g. 10 minutes), the auth expires.

---

## 8. The race condition (the FOMO mechanic)

This is the most important piece of the design and the one most likely to be misunderstood. Let me make it explicit.

**Scenario:** Two collectors, Alice and Bob, each have a session in flight. Both have token #42 in their locked rolls. (How? They started sessions seconds apart and the backend made the unlikely call to pick #42 for both — possible if Bob's session started in the millisecond gap between Alice's "roll" and Alice's session being persisted to Redis. Should be extremely rare with proper Redis atomicity, but not impossible.)

Both Alice and Bob receive valid mint authorizations from the backend.

Alice broadcasts her `batchMint` tx. It lands first. Token #42 is now minted to Alice. The `isMinted` bitmap flips.

Bob's `batchMint` tx lands second. The contract checks `!_isMinted(42)` → it's already true → the entire transaction reverts. Bob pays gas, but keeps his ETH.

The backend's indexer sees Alice's `Minted(42)` event, invalidates token #42 from Bob's session. Frontend notifies Bob: "Token #42 was minted by another collector — your other 4 rolls were unaffected, please re-confirm."

**This is the FOMO.** First batch-mint transaction to land wins. The contract enforces atomicity; the backend prevents most collisions; the rare collision is handled gracefully on the frontend.

**Edge case to handle:** what if Bob's batch had 5 tokens and only #42 collided? The naive contract design reverts the whole batch. The collector experience is bad — they lose all 5 mints because one collided.

**Two options:**
- **Option A (recommended):** Whole batch reverts. Simple, predictable. Backend immediately retries with the surviving 4 tokens after the user re-confirms.
- **Option B:** Partial mint — mint the 4 that are still available, skip the colliding one. More complex contract, harder to reason about pricing (do you refund the colliding portion of msg.value?), but better UX in the rare collision case.

**Recommendation: Option A.** Cleaner contract, the rare collision happens rarely enough that the friction is acceptable, and the backend can handle the retry transparently.

---

## 9. Wildpixel flow — on-chain detail

At deploy time, 4 of the 64 token IDs are marked `isWildpixel[tokenId] = true`. These are minted with placeholder `tokenURI` (e.g., `ipfs://placeholder-wildpixel.json` showing "awaiting palette" art).

When the collector completes the wildpixel flow on the frontend:

1. Frontend: collector uploads image, k-means extracts 8 hex colors, picks arrangement, enters trait name
2. Frontend: sends `{tokenId, swatches[], arrangement[][], trait}` to backend
3. Backend: validates collector owns the token (RPC call to `ownerOf`); validates `!wildpixelCompleted[tokenId]`; renders the final pixel painting image (PNG); generates the metadata JSON; pins both to IPFS; gets the IPFS hash
4. Backend: returns the IPFS URI to the frontend
5. Frontend: collector signs and broadcasts `completeWildpixel(tokenId, ipfsUri)` from their wallet
6. Contract: verifies caller is owner, verifies not already completed, writes URI, sets `wildpixelCompleted = true`, emits `WildpixelCompleted` and `MetadataUpdate` (EIP-4906)

**Gas cost:** small — one `setTokenURI` call (a string write, ~30-50k gas plus length-dependent storage cost). Collector pays this. This is good because it makes the wildpixel completion a deliberate act, not an accidental one.

**Why collector signs and broadcasts, not the backend?** Because the metadata is *theirs*. Having the collector be the on-chain author of their wildpixel preserves the artistic-collaboration story — they aren't just consenting to a backend write, they are the literal on-chain signer of the final metadata. Plus it removes the backend from needing to hold a hot wallet that can edit token metadata, which is a meaningful security improvement.

---

## 10. Permissions / access control

| Function | Who can call |
|---|---|
| `batchMint` | Anyone with a valid backend-signed authorization |
| `completeWildpixel` | Owner of the specific wildpixel token |
| `setMintAuthorizer` | Admin only |
| `setRoyaltyInfo` | Admin only |
| `pause` / `unpause` | Admin only — emergency only |
| Standard ERC-721 transfers | Token owners and approved addresses |
| Manifold-style extension registration | Core contract admin (you) |

The contract should be **pausable** but it's worth noting: pause should only ever halt new mints (`batchMint`). It must NOT block transfers, `completeWildpixel` calls, or any other state that collectors need to preserve their property rights. The pause is a circuit-breaker for the mint event, nothing more.

---

## 11. Deploy & post-deploy checklist

**Pre-deploy:**
- [ ] Final 64 token IDs assigned to specific games (placeholder slot positions in spec §1 finalized)
- [ ] Final 4 wildpixel slot positions chosen
- [ ] All 60 game-derived `tokenURI`s prepared and pinned to IPFS (60 metadata JSONs + 60 painting renders)
- [ ] Placeholder wildpixel `tokenURI` prepared and pinned (single JSON, shared by all 4 wildpixel slots)
- [ ] Mint authorizer wallet generated (separate from any admin wallet — should live in a secure backend secret manager)
- [ ] Payout address confirmed
- [ ] Royalty receiver address and percentage confirmed (proposal: 5%)

**At deploy:**
- [ ] Deploy core contract (Manifold `ERC721Creator` or equivalent)
- [ ] Deploy extension contract with all 64 token IDs and era assignments hardcoded in constructor
- [ ] Register extension with core contract (`registerExtension`)
- [ ] Set `mintAuthorizer` to backend signer address
- [ ] Set `isWildpixel[tokenId] = true` for each of the 4 wildpixel token IDs
- [ ] Pre-mint *all 64 tokens to a holding wallet*? Or use lazy mint where tokens come into existence on first `batchMint`?

The choice between **pre-mint** and **lazy mint** is significant:

- **Pre-mint:** Deploy with all 64 tokens minted to a holding wallet (e.g., MintFace ops). `batchMint` then becomes a `safeTransferFrom` from the holding wallet to the collector. Pro: contract is simpler (mint logic doesn't need to be in the hot path). Con: pre-mint costs significant gas upfront (~5M+ gas for 64 mints), and the holding wallet is technically the "minter" on-chain which can be confusing for provenance.
- **Lazy mint:** Tokens don't exist until `batchMint` creates them. Pro: gas cost spread across collectors. Con: extension contract needs `_mint` capability on the core — Manifold supports this via the `mint` extension function pattern.

**Recommendation: lazy mint.** Standard pattern for Manifold extensions, cleaner provenance, spreads gas cost. This is what stock Manifold extensions already do.

**Post-deploy:**
- [ ] Verify contract source on Etherscan
- [ ] Run a tiny mint flow on testnet (Sepolia) end-to-end before mainnet launch
- [ ] Confirm OpenSea picks up the collection metadata correctly
- [ ] Confirm `tokenURI` resolves correctly for both game-derived and placeholder wildpixel tokens
- [ ] Confirm `setMintAuthorizer` is callable (rotate the key once on testnet to confirm the rotation flow works)

---

## 12. Open questions for the contract dev

These are deliberately questions for the implementer to weigh in on, not pre-decided:

1. **Bitmap vs mapping for mint state?** Bitmap is cheaper to read/write but harder to audit. Mapping is the standard. For 64 tokens, the gas difference is small enough that readability probably wins.

2. **Should `getMintedTokens()` return only minted, or also expose `getAvailableTokens()` as a separate read?** Two views, slightly different consumers. Backend probably wants the inverse (available) since that's what it picks from.

3. **Should the `mintAuthorizer` signature scheme use EIP-712 (typed structured data, MetaMask shows a nice "you are authorizing this mint" prompt) or a simple `ecrecover` of a packed hash?** EIP-712 is strongly preferred from a UX standpoint — collectors see human-readable mint details — and it's standard practice now.

4. **Should `completeWildpixel` allow an admin override** in case a collector wants to change their mind before the metadata is "locked"? My recommendation is no — once committed, it's committed. But the artist might want a grace period.

5. **EIP-7160 (multi-metadata) vs simple `setTokenURI`** for wildpixels? Manifold's pattern is simple `setTokenURI`. Doppelgänger uses EIP-7160 (array of possible metadata, collector picks one). For PixelArcade, the wildpixel metadata is generated fresh per collector — there's no pre-existing array to pick from — so simple `setTokenURI` is the right tool.

6. **Pause coverage** — should `completeWildpixel` also be pausable, or always available? Strong opinion: always available. The collector owns the token; they should always be able to complete their wildpixel regardless of contract pause state.

7. **Token enumeration** — do you need `ERC721Enumerable` (lets contracts iterate over all tokens of an owner)? It significantly increases gas costs (Manifold notes ~2x mint cost). Most modern dApps use off-chain indexing (Alchemy, Reservoir) instead. Recommend: skip Enumerable, rely on indexer.

---

## 13. Recommended platform — Manifold Creator Core + custom extension

This spec is platform-neutral but the recommended implementation path is **Manifold's Creator Core architecture with a custom extension.**

### Why Manifold

- Manifold's `ERC721Creator` is a battle-tested, audited core contract that handles ownership, royalties, transfers, and standard ERC-721 surface area. It's free to deploy through Manifold Studio.
- The **Extension pattern** is exactly the architectural fit PixelArcade needs: a custom Solidity contract that registers itself to the core via `registerExtension()` and overrides `mint`, `tokenURI`, and other hook points. This is *literally* what Manifold built the system for.
- The wildpixel update flow maps cleanly onto Manifold's existing `setTokenURI` capability — no new metadata-update primitive needed.
- The artist (MintFace) already has direct experience with Manifold and has manually called `setTokenURI` before.

### What goes where

| Concern | Lives on |
|---|---|
| Token ownership, transfers, approvals | Manifold `ERC721Creator` (core) |
| Royalties (EIP-2981) | Manifold core (configured via Manifold Studio) |
| Roll-aware batch minting (`batchMint`) | **Custom extension** |
| EIP-712 mint authorization verification | **Custom extension** |
| Wildpixel state (`isWildpixel`, `wildpixelCompleted`) | **Custom extension** |
| `completeWildpixel` function | **Custom extension** (calls `setTokenURI` on core) |
| Mint state (`isMinted` bitmap/mapping) | **Custom extension** |
| Authorizer key management | **Custom extension** |

The extension is one focused Solidity contract, probably 400-700 lines of code including comments and EIP-712 boilerplate. Vastly less code than a from-scratch ERC-721 implementation.

### Key Manifold references for the contract dev

- `@manifoldxyz/creator-core-solidity` — npm package containing `ERC721Creator` and the extension interfaces
- `IERC721CreatorCore` — the interface the extension uses to call `mintExtension`, `setTokenURI`, etc.
- `ICreatorExtensionTokenURI` — the interface the extension implements if it wants to override `tokenURI` (for PixelArcade, it should, so the extension is the source of truth for metadata URIs)
- Manifold's `Lazy Mint Extension ERC721` tutorial — a reference implementation of the exact pattern PixelArcade extends. Available in Manifold dev docs.

### Audit posture

Because the core contract is already audited by Manifold, the audit surface for PixelArcade is **just the custom extension**. This is a meaningful cost reduction compared to commissioning and auditing a full standalone contract. Standard practice for Manifold extensions: get a focused audit on just the extension (one auditor, 1-2 week engagement) before mainnet deploy.

---

## 14. Estimated complexity & sequencing

For the dev scoping conversation, rough phasing:

**Phase 1 — Core contract deploy (1 day):** Deploy `ERC721Creator` via Manifold Studio. Configure royalties, metadata. No custom code yet.

**Phase 2 — Extension contract (2-3 weeks):**
- EIP-712 signature scheme + `batchMint`
- Bitmap mint state
- `completeWildpixel` flow
- Admin functions, pausing, authorizer rotation
- Unit tests (Foundry/Hardhat) covering: signature replay, collision reverts, wildpixel re-write attempts, ownership checks, pause behavior

**Phase 3 — Backend integration (2 weeks, parallel):**
- Redis session management
- TDH/allowlist tier verification
- VRF integration (Pattern B recommended)
- EIP-712 signer wallet, key management
- Indexer for `Minted` events

**Phase 4 — Testnet end-to-end (1 week):**
- Deploy extension on Sepolia
- Run full roll → lock → mint → complete-wildpixel cycle
- Verify OpenSea testnet picks up metadata correctly

**Phase 5 — Audit (1-2 weeks):**
- Focused audit on extension contract only
- Common findings to anticipate: signature replay edge cases, reentrancy on `batchMint` payable function, integer-overflow on token-id math

**Phase 6 — Mainnet deploy & cutover (2 days):**
- Deploy with admin keys held by MintFace ops multisig
- Set authorizer
- Mark wildpixels
- Soft-launch with the artist's wallet rolling the first batch

**Total: ~6-8 weeks of development calendar time** including audit. Could be compressed if the extension dev is dedicated full-time.

---

## 15. Things explicitly NOT in scope for this contract

These are intentional omissions, called out so the dev doesn't over-build:

- **Secondary market royalty enforcement** — relies on EIP-2981 + marketplace cooperation, not on-chain enforcement. (On-chain royalty enforcement requires transfer blocking which is hostile to collectors.)
- **Burning / shattering / fusing** — not part of the spec. If desired later, add as a separate extension.
- **Multi-collection upgrades** — this contract is single-collection. No "PixelArcade 2" mint mechanic baked in.
- **Allowlist Merkle tree on-chain** — the line-artist allowlist is enforced off-chain by the backend. Cheaper, more flexible, and the security model (backend can lie about who's on the allowlist) is acceptable since the backend operator IS MintFace.
- **Daily roll counter on-chain** — also enforced off-chain. The signature-based mint auth means the backend is the source of truth for "did you have enough rolls today."
- **TDH-based pricing or tier-based pricing on-chain** — all collectors pay the same 0.05 ETH per mint. Tier only affects rolls per day, which is off-chain.
- **Physical painting orders** — entirely off-chain via the MintFace dashboard. No on-chain crosslink. The wallet's NFT ownership is the only proof of entitlement needed.

---

## Appendix A — Sample EIP-712 typed data

For reference, here's what the typed data the backend signs looks like:

```javascript
const domain = {
  name: 'PixelArcade',
  version: '1',
  chainId: 1,
  verifyingContract: '0x...' // the extension contract address
};

const types = {
  MintAuthorization: [
    { name: 'collector', type: 'address' },
    { name: 'tokenIds', type: 'uint256[]' },
    { name: 'totalPrice', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' }
  ]
};

const value = {
  collector: '0x...',
  tokenIds: [8, 23, 47],
  totalPrice: parseEther('0.15'),
  deadline: Math.floor(Date.now() / 1000) + 600,  // 10 minutes
  nonce: ethers.utils.randomBytes(32)
};

const signature = await signer._signTypedData(domain, types, value);
```

MetaMask will show the collector something like:
> **PixelArcade**
> *Mint Authorization*
>
> Collector: 0x7A3F...B9C2
> Token IDs: [8, 23, 47]
> Total Price: 0.15 ETH
> Deadline: in 10 minutes

This is much better than asking them to sign a blob of hex.

---

## Appendix B — Frontend developer cheat sheet

For the frontend team integrating against the deployed contract:

```javascript
// Read pool state
const minted = await contract.getMintedTokens(); // returns uint256[]
const available = ALL_TOKEN_IDS.filter(id => !minted.includes(id));

// After backend returns auth + signature, submit mint
const tx = await contract.batchMint(auth, signature, {
  value: auth.totalPrice
});
const receipt = await tx.wait();
const mintedTokenIds = receipt.events
  .filter(e => e.event === 'Minted')
  .map(e => e.args.tokenId.toString());

// Complete wildpixel (collector signs directly, no backend signature needed)
const tx2 = await contract.completeWildpixel(tokenId, ipfsUri);
await tx2.wait();
```

---

*Spec version 1.0 · Prepared for contract dev scoping conversation · Pair with `pixelarcade_spec.md` for the full project context.*
