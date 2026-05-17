# pixel-arcade

PixelArcade — MintFace's 64-piece 1/1 NFT pixel-painting collection at https://pixelarcade.art.

This repo is mid-conversion from vanilla HTML to Next.js. See **State** below..

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
- ✅ `/mint` — slot animation, pool state, session tray, walk-away band, post-mint hand-off
- ✅ `/my-mints` — gallery, filters, drawer for physical claim, wildpixel modal with k-means, post-mint banner
- ✅ CRT power-on overlay (plays once per session)

**Wallet integration (session 4a — wallet UX foundations):**

- ✅ RainbowKit + wagmi + viem + react-query installed
- ✅ Sepolia chain config for dev/test; Mainnet for read-only ENS resolution
- ✅ Web3Providers wraps app with CRT-themed RainbowKit dark theme
- ✅ Real wallet connect button replaces mocked `0x7A3F…B9C2` on mint + my-mints
- ✅ ENS resolution via `useEnsName` — connected wallets display ENS where available
- ✅ Mint flow gated on wallet — clicking PLAY when disconnected opens the connect modal
- ✅ Real Line lookup — 731 wallet entries from `theline.wtf` roster, badge shows ★ LINE ★ #N if connected wallet is on The Line, otherwise ★ HI-SCORE ★ 69420
- ✅ API client stubs (`lib/api.ts`) with typed interfaces for `/api/roll`, `/api/lock`, `/api/mint-authorization` — return mock data so UI keeps working

**Not yet wired (session 4b, blocked on Yungwknd contract + backend build):**

- ❌ Real contract calls (`batchMint`, `claimPhysical`, `completeWildpixel`)
- ❌ Backend signing endpoints (replace `lib/api.ts` stubs)
- ❌ SIWE auth flow
- ❌ On-chain reads to replace post-mint sessionStorage handoff
- ❌ 6529 Level data integration

## Environment variables

Copy `.env.local.example` to `.env.local` and fill in:

- `NEXT_PUBLIC_WC_PROJECT_ID` — WalletConnect project ID from https://cloud.walletconnect.com. Required for mobile wallet deep-linking and QR codes. Without it, only browser-injected wallets (MetaMask, Rabby) work.
- `NEXT_PUBLIC_ALCHEMY_KEY` — optional. Replaces public RPCs with Alchemy.

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
