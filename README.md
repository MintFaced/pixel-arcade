# pixel-arcade

PixelArcade — MintFace's 64-piece 1/1 NFT pixel-painting collection at https://pixelarcade.art.

This repo is mid-conversion from vanilla HTML to Next.js. See **State** below.

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript
- CSS Modules + global CSS variables (no Tailwind)
- Static assets (SVGs, proofs, test vectors) served from `public/`
- Deploys to Vercel

## Local dev

```bash
npm install
npm run dev          # http://localhost:3000
npm run build        # production build
npm run start        # serve production build
```

## State

**Converted to Next.js so far:**

- ✅ Root layout with shared CRT overlays, fonts, gate
- ✅ Password gate (sessionStorage, `arcade26`)
- ✅ `/` — landing page (cabinets + footer + wizards link)
- ✅ `/wizards` — lineage / chapter story page

**Not yet converted (still in `legacy/` for reference):**

- ❌ `/mint` — slot animation, pool state, session tray, walk-away modal
- ❌ `/my-mints` — drawers, wildpixel modal with k-means, post-mint banner

**Not yet wired:**

- ❌ Wallet connect (RainbowKit + wagmi + viem + SIWE)
- ❌ Backend API (signing server, roll endpoints)
- ❌ Real contract calls (`batchMint`, `claimPhysical`, `completeWildpixel`)

## Static assets

- `public/svg/001.svg` … `064.svg` — generated artwork
- `public/svg/catalog.json` — token catalog (legacy inventory file; not used by contract)
- `public/proofs.json` — Merkle proofs for the 3,073 elevated-tier addresses
- `public/test-vectors.json` — sample (address, tier, leaf, proof) tuples for the contract dev to cross-check

## Key URLs (in production)

- `https://pixelarcade.art/proofs.json` — proofs file
- `https://pixelarcade.art/test-vectors.json` — test vectors for Yungwknd
- Metadata IPFS: `ipfs://bafybeidbswv324oabtnkqsi5jc72bbx5iitmtt3zlx3xubwrsamszjatwa/{NNN}.json`
- SVG IPFS: `ipfs://bafybeieodunnishnl5vli644c2mcdftdgmbz7c6fbnzva66lk5pmjutyyq/{NNN}.svg`
- Merkle root: `0xee5a46908c3043b910ede259a2ad1cc9907f7a4c7fa065d216e16896b0d1dba7`

## Notes

- The password gate is theater, not security. The passcode is in the client bundle.
- All 4 original HTML pages are preserved in `legacy/` for reference during conversion.
