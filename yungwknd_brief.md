# PixelArcade · Contract Brief for Yungwknd

**TL;DR — 64 hand-painted pixel artworks released as 1/1 NFTs on Manifold, with three twists that need custom contract logic: collectors roll for what they get, four "wildpixel" tokens are completed by the collector after mint, and every NFT has a matching physical painting the collector can commission with ETH.**

You're being asked to write a custom Manifold Creator Core extension that handles all three. The artist (MintFace) is on Manifold already, has the relationship, and would like to stay on it. Deeper specs and demo site are linked at the end — this page is just the orientation.

---

## What it is

64 one-of-one paintings derived from the canonical color palettes of arcade and console games — Pac-Man, Sonic, Final Fantasy VII, Doom, the lot. Each work is reduced to 8 colors arranged in a fixed grid, painted by hand on plywood, and minted as a CSS-animated SVG NFT. **Three eras** (8-bit / 16-bit / 32-bit) determine grid size and physical painting size:

| Era | Grid | Token IDs | Physical |
|---|---|---|---|
| 8-bit | 4×2 (8 pixels) | 1–17 | 600×300mm, 0.50 ETH |
| 16-bit | 8×2 (16 pixels) | 18–45 | 1200×300mm, 0.75 ETH |
| 32-bit | 8×4 (32 pixels) | 46–64 | 1200×600mm, 1.25 ETH |

All artwork is animated SVG — pixels twitch, RGB channels drift, scanlines roll. Each NFT is ~8 KB and renders fully on-chain via data URI if we want it to.

---

## The gameplay (this is the fun part)

Mint is **0.05 ETH flat** regardless of era. Collectors don't pick what they get — they **roll**. Each wallet gets 3 rolls a day (5 for whales and allowlist), reveals a random unminted token via Chainlink VRF, and decides "lock it" or "roll again." Locked rolls accumulate in a session tray. When the collector hits **MINT ALL LOCKED**, every locked token gets minted in one batch.

So the era is a **size lottery** — every roll could be a small 8-bit study or a giant 32-bit tableau, same price. The artist has been clear: this is the moment of suspense, do not under-engineer it.

**Walk-away semantics are strict.** If the collector closes the tab mid-session, all their unminted holds release back to the pool. **No reservations across users.** This means the final batch mint is a race — first transaction to land for a given token wins. Other transactions for the same token revert. The frontend will show a "WALK AWAY = ALL ROLLS RELEASED · FIRST TO MINT WINS" warning, and we want the contract to enforce it.

**Four of the 64 are "wildpixels"** — same roll mechanic, but the NFT mints with a placeholder palette ("AWAITING PALETTE" diagonal-stripe SVG). Post-mint, the collector uploads an image of their favorite game, the frontend k-means-extracts 8 colors, runs the same simulated-annealing arrangement, and the collector signs a transaction that **rewrites the tokenURI exactly once.** After that the wildpixel is locked forever.

---

## What needs coding

The contract is a **custom extension on top of Manifold Creator Core** (the artist's existing audited ERC-721). Group of mechanics:

### 1. The roll-and-mint mechanic

- **`batchMint(MintAuthorization auth, bytes signature) external payable`** — accepts a backend-signed EIP-712 payload listing the token IDs the collector locked. Verifies the signature came from the trusted backend signer (the tier check, daily-allowance check, and VRF roll happen off-chain in the backend; the contract just enforces "this was signed by us, the price is right, the tokens aren't taken").
- Whole-batch revert on collision: if any token in the batch is already minted, the whole transaction reverts. **Option A discipline** — never partial mint.
- `msg.value` must equal `0.05 ETH × tokenIds.length`. Any excess refunded.
- Mints to `msg.sender` (the collector's wallet, not the backend).

### 2. The wildpixel completion mechanic

- **`completeWildpixel(uint256 tokenId, string newTokenURI) external`** — `msg.sender` must own the token, must be one of the four wildpixel token IDs (12, 14, 15, 17 — Centipede / Q*bert / Joust / Tron slots, all 8-bit), and must not have been completed before. Sets `wildpixelCompleted[tokenId] = true` (permanent — same finality as a mint).
- The `newTokenURI` is generated and IPFS-pinned by the backend, then handed to the collector to broadcast themselves. Collector's signature on the transaction is the artistic provenance — it has to be them.

### 3. The physical painting claim mechanic

- **`claimPhysical(uint256[] tokenIds) external payable`** — collector pays ETH to commission the physical paintings for tokens they own.
- Era-based pricing read from admin-settable state. Bundle discount: 5+ tokens waives the 0.25 ETH shipping fee (everything ships together in one box).
- ETH forwards directly to `physicalPaymentReceiver` (defaults to `mintface.eth`, admin-settable to a multisig).
- Each token can only be claimed once. `physicalClaimed[tokenId]` flag, permanent.
- For wildpixels: `wildpixelCompleted[tokenId]` must be true before physical can be claimed. Can't paint a painting that has no palette yet.
- **`previewClaimCost(uint256[] tokenIds) view returns (uint256)`** — pure view the frontend calls before showing "CLAIM ALL · X.YZ ETH" so the displayed total can never be wrong.
- Emits `PhysicalClaimed(tokenId, claimer, amountPaid)` per token — the off-chain shipping pipeline watches this event.

### 4. Admin & metadata

- `setMintAuthorizer(address)` — rotates the backend signing key
- `setPhysicalPrice(Era, uint256)` / `setShippingFee(uint256)` / `setBundleThreshold(uint256)` / `setPhysicalPaymentReceiver(address)` — all admin-only, all emit events for auditability
- Token URIs for game-derived works are baked at deploy (lazy-mint pattern, no pre-mint gas burn). Wildpixel URIs start as the placeholder, get rewritten via `completeWildpixel`.
- EIP-2981 royalties at 5% to MintFace, configurable.

---

## What's already decided (don't redesign)

- ✅ Manifold Creator Core + custom extension (not stock Manifold, not Transient, not from-scratch)
- ✅ Off-chain backend handles VRF, tier check, daily-allowance throttle, IPFS pinning. Contract trusts a signed authorization for mint and a collector-signed broadcast for wildpixel completion.
- ✅ Race-to-mint, no reservation between users, whole-batch revert on collision
- ✅ All 64 token IDs assigned (8-bit = 1–17, 16-bit = 18–45, 32-bit = 46–64). Wildpixels are 12, 14, 15, 17.
- ✅ Pricing locked: mint 0.05 ETH, physical 0.50/0.75/1.25 ETH inclusive of shipping, bundle waives shipping
- ✅ All 64 animated SVGs generated, ~8 KB average. Can live on-chain as data URIs or on IPFS.

## What's open (your input wanted)

- ⬜ Daily reset semantics — UTC midnight vs. rolling 24h. Backend's call mostly, but the contract may need to know if you want on-chain enforcement.
- ⬜ ETH custody for physical claim — direct forward (current spec) vs. contract-held with periodic withdraw. Direct is simpler; contract-held is auditable. Your call.
- ⬜ Whether wildpixel completion needs a fee (currently free — collectors only pay gas)
- ⬜ Royalty receiver — single EOA, Safe multisig, or split

## Links

- **Full contract spec** (long, detailed, has the EIP-712 schemas and state diagrams): `/pixelarcade_contract_spec.md` in the GitHub repo
- **Demo site** with full prototype of all three mechanics, no real ETH: `pixelarcade.art` (password: `arcade26`)
- **GitHub**: `github.com/MintFaced/pixel-arcade`
- **Artist context, lineage, why this exists**: `pixelarcade.art/wizards`
- **Repo**: `github.com/MintFaced/pixel-arcade` includes 64 generated SVGs, catalog.json, and the full spec doc

---

*Brief written for Yungwknd · v1 · feel free to push back on anything · the artist's relationship with Manifold is direct, so coordinate timeline through them.*
