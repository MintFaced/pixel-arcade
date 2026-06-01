# TX6900

Self-contained static browser game. Drop this whole `tx6900/` folder into your
Vercel project's `public/` directory. It will be served at `/tx6900/`.

- `index.html` — the entire game (HTML5 canvas; sprites embedded as base64)
- `*.mp4` — interstitial videos, referenced by relative paths from index.html

No build step, no dependencies. Do not move the mp4s — index.html references
them by relative filename and they must sit alongside it.
