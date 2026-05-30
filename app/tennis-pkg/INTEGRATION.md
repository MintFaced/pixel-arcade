# XNoun Tennis — drop-in for `pixel-arcade`

## What's in this package

```
app/tennis/
├── page.tsx           Next.js server page entry
├── TennisGame.tsx     Client component (mounts canvas, boots engine)
├── engine.ts          Game logic — state, update, render, collision, input
├── assets.ts          Roster loader + types
├── audio.ts           Web Audio SFX module
└── page.module.css    Page-level styles (stage, canvas glow, loading)

public/tennis/
├── roster.json        Manifest — characters, polygons, bg map, ball SVG paths
├── sprites/           9 XNoun PNGs (xnouns_3, 6, 8, 12, 18, 19, 21, 26, 27)
└── backgrounds/       7 animated GIFs (bang_bang, bot-rot, churn, crawler,
                       oblivion, reign, sidewayz)
```

## Drop-in

Unzip into the repo root. The directories merge cleanly — `app/tennis/` is
new, `public/tennis/` is new. Nothing else is touched.

```bash
cd path/to/pixel-arcade
unzip ~/Downloads/tennis-pkg.zip
git add app/tennis public/tennis
git commit -m "Add XNoun Tennis at /tennis"
git push                # Vercel auto-deploys
```

Live at `https://your-site.vercel.app/tennis`. No build flags, no extra
dependencies — only standard React and Next.js APIs.

## Routing

Add a tile in your arcade lobby pointing to `/tennis`. Same pattern as the
existing `/play` route.

## Controls

| Player | Movement | Confirm |
|--------|----------|---------|
| P1 (bottom paddle) | `A` / `D` | `SPACE` |
| P2 (top paddle)    | `←` / `→` | `ENTER` |
| Both               | `C` to toggle CPU/P2, `ESC` to return to attract |

Gamepad: left-stick X axis or D-pad left/right per player; START or A button
to advance from attract.

## How it works

- **Canvas, not React** for the game itself. The engine runs in its own
  `requestAnimationFrame` loop with internal state. React just mounts the
  canvas element and invokes `startEngine()` once assets are loaded. On
  unmount, the returned cleanup function cancels the loop and removes
  listeners.

- **Logical resolution: 600 × 1000** (portrait, for the cabinet's vertical
  monitor). The canvas auto-scales to fit its container at DPR-aware
  resolution. `image-rendering: pixelated` keeps the sprites crisp.

- **Per-character backgrounds.** `roster.json` maps each XNoun to one of
  seven animated GIFs. P1's pick determines the bg for the match. To
  change a pairing, edit the `bg` field for that character in
  `public/tennis/roster.json` — no rebuild needed.

- **Animated ball.** The XNoun-face ball is rendered from inline SVG path
  data (also in `roster.json`) with our own animation timer. Strobes
  pink-hot → pink-light → blue-hot → blue-light at 80ms per frame.

- **Collision.** Each XNoun has an authored polygon outline. The ball is
  treated as a circle of radius 20; we test ball center against the
  polygon with a Minkowski-sum overlap check, then reflect across the
  nearest-edge normal. The top paddle (P2) is drawn rotated 180°, and its
  polygon coordinates are flipped accordingly so collision matches the
  visible silhouette.

- **Audio.** Web Audio API blips, lazy-initialised on first input gesture
  to satisfy browser autoplay policies.

## Palette

The game is themed around `#38f2c6` (the bot_rot teal — sampled from the
dominant pixels of the original bg). Everything else lives in `engine.ts`
and `page.module.css`:

| Token     | Hex      | Role                                  |
|-----------|----------|---------------------------------------|
| Brand teal | `#38f2c6` | P1 accent, glow, centerline           |
| Cyan      | `#00d4ff` | P2 accent, secondary glow             |
| Mint      | `#88ffd6` | POINT text, attract tagline           |
| White     | `#f4f4f0` | Titles, winner highlight, score text  |
| Slate     | `#4a5a6a` | Dim UI text                           |
| Warn red  | `#ff4060` | GAME OVER                             |

If your existing PixelArcade pages use a different brand, this game keeps
its own visual identity — bot_rot teal/black/grey. That's intentional;
each game on the cabinet has room for its own personality.

## Fonts

The engine references `Press Start 2P` and `Silkscreen` by family name.
These should already be loaded by your root layout (the SWARM game uses
the same fonts). If they're not, add to your `app/layout.tsx`:

```tsx
import { Press_Start_2P, Silkscreen } from 'next/font/google';

const press = Press_Start_2P({ weight: '400', subsets: ['latin'], variable: '--font-press' });
const silk  = Silkscreen({ weight: ['400', '700'], subsets: ['latin'], variable: '--font-silk' });
```

## Tuning gameplay

All game constants live at the top of `engine.ts`:

```ts
const W = 600;                  // logical canvas dimensions
const H = 1000;
const PAD_MARGIN = 26;          // paddle distance from edge
const BALL = 40;                // ball size
const PAD_SPEED = 700;          // px/sec paddle slide
const BALL_SPEED_0 = 380;       // serve speed
const BALL_SPEED_INC = 28;      // speedup per paddle hit
const BALL_SPEED_MAX = 1000;    // ceiling
const WIN_SCORE = 7;            // first to 7
const CPU_REACTION = 0.92;      // 0..1 — higher is more accurate
```

To swap a character's polygon, edit `polygon` for that entry in
`roster.json`. Coordinates are in the sprite's native pixel space.

## Asset weight

| File | Size |
|------|------|
| 9 sprite PNGs | ~1.1 MB |
| 7 background GIFs | ~1.8 MB |
| roster.json | 24 KB |
| **Total** | **~2.9 MB** (cached after first visit) |

The backgrounds were resized from their original 4096×4096 down to
500×500 with 128-color quantisation. The dithered glitch aesthetic
absorbs the downsizing — no visible quality loss at gallery viewing
distance.

## Known follow-ups

- v0.3: Music + voice lines (per the original scope). Hooks are in place
  in `audio.ts`; just call new SFX entries from `engine.ts`.
- v0.3: SWARM-style credit roll on GAME OVER.
- v0.4: Tournament mode, multi-round bracket.

🌙🍒
