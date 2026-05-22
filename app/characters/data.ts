/**
 * SWARM character roster.
 *
 * Single source of truth for the /characters bestiary page. Each entry has:
 *   - id: stable key for keying React lists
 *   - sprite: path to the PNG in /public/swarm/
 *   - name: display name
 *   - subtitle: short tagline (1 line)
 *   - description: 1–3 sentences flavour text
 *   - stats: optional key/value pairs for the stat block
 *   - source: optional NFT/artist provenance with external link
 *   - locked: if true, hidden behind "???" until player unlocks
 */

export interface CharacterEntry {
  id: string;
  sprite: string;
  name: string;
  subtitle: string;
  description: string;
  stats?: { label: string; value: string }[];
  source?: {
    /** Display name like "mfer #2346" or "XNoun #468" */
    label: string;
    /** OpenSea, Etherscan, or other on-chain reference */
    href: string;
  };
  /** If true, gated behind localStorage unlock */
  locked?: boolean;
}

// ============================================================
// BOSSES
// ============================================================

export const BOSSES: CharacterEntry[] = [
  {
    id: 'damager',
    sprite: '/swarm/sprites/boss-damager.png',
    name: 'DAMAGER',
    subtitle: 'Wave 5 · "BATTERY LOW"',
    description:
      'Dying tech in pink and blue. Damager spirals bullets outward in 5-spoke patterns that rotate clockwise. The first boss you meet — punishing but learnable.',
    stats: [
      { label: 'HP', value: '30' },
      { label: 'Pattern', value: 'Rotating spiral' },
      { label: 'Bullet color', value: 'Magenta' },
    ],
    source: {
      label: 'XCOPY · Damager (referenced)',
      href: 'https://opensea.io/XCOPY',
    },
  },
  {
    id: '6529-punk',
    sprite: '/swarm/sprites/boss-doomed-red.png',
    name: '6529 PUNK',
    subtitle: 'Wave 10 · "SEIZE THE MEMES!"',
    description:
      'Hooded with cyan square eyes. Fires wide horizontal sweeps that push you to dodge across the playfield. Voice of crypto-twitter incarnate — yells about bullishness, transaction freedom, and not letting them.',
    stats: [
      { label: 'HP', value: '50' },
      { label: 'Pattern', value: 'Wide sweep' },
      { label: 'Bullet color', value: 'Pink-red' },
    ],
    source: {
      label: '6529 Punk PFP',
      href: 'https://6529.io/',
    },
  },
  {
    id: 'rage',
    sprite: '/swarm/sprites/boss-rage.png',
    name: 'RAGE',
    subtitle: 'Wave 15 · "BURN IT DOWN"',
    description:
      'Solid red skull silhouette. Rains random bullets from above in dense clusters. No mercy mode — keep moving.',
    stats: [
      { label: 'HP', value: '70' },
      { label: 'Pattern', value: 'Random rain' },
      { label: 'Bullet color', value: 'Red' },
    ],
    source: {
      label: 'XCOPY · Doomed Red (referenced)',
      href: 'https://opensea.io/XCOPY',
    },
  },
  {
    id: 'spec-ops',
    sprite: '/swarm/sprites/boss-spec-ops.png',
    name: 'SPECIAL OP',
    subtitle: 'Wave 20 · "COMPLIANCE IS MANDATORY"',
    description:
      'Blue skull on a backdrop of red tanks. Fires aimed beam volleys directly at your last known position plus two flankers. Authority figure energy.',
    stats: [
      { label: 'HP', value: '95' },
      { label: 'Pattern', value: 'Aimed beam' },
      { label: 'Bullet color', value: 'Blue' },
    ],
    source: {
      label: 'XCOPY · Special Operation (referenced)',
      href: 'https://opensea.io/XCOPY',
    },
  },
  {
    id: 'beast-mode',
    sprite: '/swarm/sprites/boss-beast.png',
    name: 'BEAST MODE',
    subtitle: 'Wave 25 · "YOU SMELL LIKE EXIT LIQUIDITY"',
    description:
      'Teal flame monster with white fangs. 6-spoke spiral attacks that rotate faster than Damager\'s. Apex predator of the swarm.',
    stats: [
      { label: 'HP', value: '120' },
      { label: 'Pattern', value: 'Fast 6-spoke spiral' },
      { label: 'Bullet color', value: 'Teal' },
    ],
    source: {
      label: 'XCOPY · Beast Mode (referenced)',
      href: 'https://opensea.io/XCOPY',
    },
  },
  {
    id: 'max-pain',
    sprite: '/swarm/sprites/boss-maxpain.png',
    name: 'MAX PAIN',
    subtitle: 'Wave 30 · "I AM INEVITABLE"',
    description:
      'Final intended boss. Glitched magenta-teal helmet face. Rotates through three sub-patterns: 7-spoke spiral, horizontal spread, aimed burst. Beating Max Pain unlocks something else.',
    stats: [
      { label: 'HP', value: '200' },
      { label: 'Pattern', value: 'Mixed (rotating)' },
      { label: 'Bullet color', value: 'Magenta / Cyan / Yellow' },
    ],
    source: {
      label: 'XCOPY · Max Pain (referenced)',
      href: 'https://opensea.io/XCOPY',
    },
  },
  // SECRET — gated behind localStorage 'pixelarcade_swarm_true_ending'
  {
    id: 'mintface',
    sprite: '/swarm/sprites/boss-mintface.png',
    name: 'MINTFACE',
    subtitle: 'Wave 31 · "I AM THE ARTIST"',
    description:
      'The true final boss. A painted skull with red beanie and pink/blue 3D eye-stripe, surrounded by a rotating yellow halo. Cycles through four attack phases — halo ring, brushstroke sweep, pink eye burst, blue eye rain. Only appears after Max Pain is defeated.',
    stats: [
      { label: 'HP', value: '300' },
      { label: 'Pattern', value: 'Transcend (4-phase)' },
      { label: 'Bullet color', value: 'Yellow / Pink / Red / Blue' },
    ],
    source: {
      label: 'MintFace · PixelArcade Founder',
      href: 'https://pixelarcade.art/',
    },
    locked: true,
  },
];

// ============================================================
// ENEMIES (mfers)
// ============================================================

export const ENEMIES: CharacterEntry[] = [
  {
    id: 'grunt',
    sprite: '/swarm/sprites/mfer-grunt.png',
    name: 'GRUNT',
    subtitle: 'mfer #2346 · the foot soldier',
    description:
      'Plain mfer, pink earmuffs. The most common enemy. Doesn\'t fire — only rams you on its dive. 1 HP, low score, low drop rate. You\'ll kill thousands of these.',
    stats: [
      { label: 'HP', value: '1' },
      { label: 'Score', value: '50 (formation), 75 (dive)' },
      { label: 'Fires?', value: 'No' },
      { label: 'Drop chance', value: '4%' },
    ],
    source: {
      label: 'mfer #2346',
      href: 'https://opensea.io/assets/ethereum/0x79fcdef22feed20eddacbb2587640e45491b757f/2346',
    },
  },
  {
    id: 'runner',
    sprite: '/swarm/sprites/mfer-runner.png',
    name: 'RUNNER',
    subtitle: 'mfer #9956 · the fast one',
    description:
      'White mfer on green. 1.5× speed of grunts. Tracks toward your X position when diving instead of returning to formation. Worth double points.',
    stats: [
      { label: 'HP', value: '1' },
      { label: 'Score', value: '100 (formation), 200 (dive)' },
      { label: 'Fires?', value: 'No' },
      { label: 'Drop chance', value: '8%' },
    ],
    source: {
      label: 'mfer #9956',
      href: 'https://opensea.io/assets/ethereum/0x79fcdef22feed20eddacbb2587640e45491b757f/9956',
    },
  },
  {
    id: 'sniper',
    sprite: '/swarm/sprites/mfer-sniper.png',
    name: 'SNIPER',
    subtitle: 'mfer #8278 · the precise one',
    description:
      'Brown cap with orange band. Stays in formation and fires single straight-down bullets at your X. Slow movement but dangerous from above. Takes 2 hits.',
    stats: [
      { label: 'HP', value: '2' },
      { label: 'Score', value: '200 (formation), 300 (dive)' },
      { label: 'Fires?', value: 'Yes — single shot' },
      { label: 'Drop chance', value: '20%' },
    ],
    source: {
      label: 'mfer #8278',
      href: 'https://opensea.io/assets/ethereum/0x79fcdef22feed20eddacbb2587640e45491b757f/8278',
    },
  },
  {
    id: 'bomber',
    sprite: '/swarm/sprites/mfer-bomber.png',
    name: 'BOMBER',
    subtitle: 'mfer #1586 · the dangerous one',
    description:
      'Yellow mech hood with goggles. Fires 3-bullet spreads from formation. Takes 2 hits. The orange-bullet spreads are wide — easy to walk into accidentally.',
    stats: [
      { label: 'HP', value: '2' },
      { label: 'Score', value: '300 (formation), 450 (dive)' },
      { label: 'Fires?', value: 'Yes — 3-spread' },
      { label: 'Drop chance', value: '30%' },
    ],
    source: {
      label: 'mfer #1586',
      href: 'https://opensea.io/assets/ethereum/0x79fcdef22feed20eddacbb2587640e45491b757f/1586',
    },
  },
  {
    id: 'titan',
    sprite: '/swarm/sprites/mfer-titan.png',
    name: 'TITAN',
    subtitle: 'Geodetic Moment · the elite',
    description:
      'Rare elite enemy appearing from wave 15 onward. White silhouette on black. Visibly larger (40×40). Twin parallel white shots at 1.2× speed. Takes 5 hits — the heaviest formation enemy. Big score reward and 55% chance to drop a power-up.',
    stats: [
      { label: 'HP', value: '5' },
      { label: 'Score', value: '800 (formation), 1200 (dive)' },
      { label: 'Fires?', value: 'Yes — twin parallel shots' },
      { label: 'Drop chance', value: '55%' },
      { label: 'First appears', value: 'Wave 15+' },
    ],
    source: {
      label: 'Geodetic Moment',
      href: 'https://pixelarcade.art/',
    },
  },
];

// ============================================================
// POWER-UPS (XNoun heads)
// ============================================================

export const POWERUPS: CharacterEntry[] = [
  {
    id: 'shield',
    sprite: '/swarm/sprites/noun-shield.png',
    name: 'SHIELD',
    subtitle: 'XNoun #483 · sunglasses + tears',
    description:
      'Cyan halo wraps your ship. Absorbs the next hit for free, then expires. Holds indefinitely until used. Always grab this when you see it.',
    stats: [
      { label: 'Effect', value: 'Absorb 1 hit' },
      { label: 'Duration', value: 'Until consumed' },
      { label: 'Spawn weight', value: '22 (common)' },
    ],
    source: {
      label: 'XNoun #483',
      href: 'https://xnouns.xyz/',
    },
  },
  {
    id: 'life',
    sprite: '/swarm/sprites/noun-life.png',
    name: 'EXTRA LIFE',
    subtitle: 'XNoun #500 · crown',
    description:
      'Instant +1 life. The rarest gameplay drop. King move.',
    stats: [
      { label: 'Effect', value: '+1 life' },
      { label: 'Duration', value: 'Instant' },
      { label: 'Spawn weight', value: '8 (rare)' },
    ],
    source: {
      label: 'XNoun #500',
      href: 'https://xnouns.xyz/',
    },
  },
  {
    id: 'firerate',
    sprite: '/swarm/sprites/noun-firerate.png',
    name: 'FIRE RATE',
    subtitle: 'XNoun #484 · pizza',
    description:
      '2.5× fire rate for 8 seconds. Burst-down windows for boss DPS or clearing dense formations fast.',
    stats: [
      { label: 'Effect', value: '2.5× fire rate' },
      { label: 'Duration', value: '8 sec' },
      { label: 'Spawn weight', value: '20 (common)' },
    ],
    source: {
      label: 'XNoun #484',
      href: 'https://xnouns.xyz/',
    },
  },
  {
    id: 'slowmo',
    sprite: '/swarm/sprites/noun-slowmo.png',
    name: 'SLOW MO',
    subtitle: 'XNoun #495 · marijuana leaf',
    description:
      'Enemies and bullets at 45% speed for 6 seconds. Player moves slightly FASTER during slow-mo (1.4×). Use it for tight dodges.',
    stats: [
      { label: 'Effect', value: 'Enemies 0.45×, you 1.4×' },
      { label: 'Duration', value: '6 sec' },
      { label: 'Spawn weight', value: '12' },
    ],
    source: {
      label: 'XNoun #495',
      href: 'https://xnouns.xyz/',
    },
  },
  {
    id: 'multiplier',
    sprite: '/swarm/sprites/noun-multiplier.png',
    name: '2x MULTIPLIER',
    subtitle: 'XNoun #470 · pink antennae',
    description:
      'Instant +500 bonus on pickup. Then 2× score multiplier (stacks with streak multiplier) for 10 seconds. Most common drop.',
    stats: [
      { label: 'Effect', value: '+500 + 2× for 10s' },
      { label: 'Duration', value: '10 sec' },
      { label: 'Spawn weight', value: '30 (most common)' },
    ],
    source: {
      label: 'XNoun #470',
      href: 'https://xnouns.xyz/',
    },
  },
  {
    id: 'invincible',
    sprite: '/swarm/sprites/noun-invincible.png',
    name: 'INVINCIBLE',
    subtitle: 'XNoun #507 · castle/tower',
    description:
      'Cyan halo, no damage at all for 4 seconds. Save it for boss attack patterns you can\'t dodge.',
    stats: [
      { label: 'Effect', value: 'No damage' },
      { label: 'Duration', value: '4 sec' },
      { label: 'Spawn weight', value: '8 (rare)' },
    ],
    source: {
      label: 'XNoun #507',
      href: 'https://xnouns.xyz/',
    },
  },
];

// ============================================================
// COLLECTIBLES (bonus score, no gameplay effect)
// ============================================================

export const COLLECTIBLES: CharacterEntry[] = [
  {
    id: 'cherry',
    sprite: '/swarm/sprites/collectible-cherry.png',
    name: 'CHERRY',
    subtitle: 'The PixelArcade brand mark · 🍒',
    description:
      'Rarest collectible. Worth 1000 points (multiplied by your current streak). The cherry is the PixelArcade signature — every gallery label, every footer, every collection page has one.',
    stats: [
      { label: 'Score', value: '1000 × multiplier' },
      { label: 'Spawn weight', value: '10 (rare)' },
    ],
  },
  {
    id: 'glasses-pink',
    sprite: '/swarm/sprites/collectible-glasses-pink.png',
    name: 'PINK GLASSES',
    subtitle: 'XCOPY-style frame · X eyes',
    description:
      'Magenta frames with X-eye lenses. Worth 500 points.',
    stats: [
      { label: 'Score', value: '500 × multiplier' },
      { label: 'Spawn weight', value: '35 (common)' },
    ],
  },
  {
    id: 'glasses-purple',
    sprite: '/swarm/sprites/collectible-glasses-purple.png',
    name: 'PURPLE GLASSES',
    subtitle: 'XCOPY-style frame · X eyes',
    description:
      'Blue-purple frames with X-eye lenses. Worth 500 points.',
    stats: [
      { label: 'Score', value: '500 × multiplier' },
      { label: 'Spawn weight', value: '35 (common)' },
    ],
  },
  {
    id: 'glasses-zeros',
    sprite: '/swarm/sprites/collectible-glasses-zeros.png',
    name: 'ZEROS GLASSES',
    subtitle: 'Black frame · O eyes',
    description:
      'Rare black variant with hollow zero eyes. Worth 750 points — the premium collectible.',
    stats: [
      { label: 'Score', value: '750 × multiplier' },
      { label: 'Spawn weight', value: '20' },
    ],
  },
];

// ============================================================
// CHAPTER BACKGROUNDS (Noun heads from the CC0 set)
// ============================================================

export const CHAPTERS: CharacterEntry[] = [
  {
    id: 'ch1',
    sprite: '/swarm/backgrounds/bg-ch1.png',
    name: 'CHAPTER 1 — FIRST CONTACT',
    subtitle: 'Waves 1–4 · head-cherry',
    description:
      'Soft entry. Grunt swarms only. The cherry background nods to the PixelArcade brand mark.',
    source: {
      label: 'Nouns DAO head-cherry (CC0)',
      href: 'https://nouns.center/',
    },
  },
  {
    id: 'ch2',
    sprite: '/swarm/backgrounds/bg-ch2.png',
    name: 'CHAPTER 2 — SYSTEM FAILURE',
    subtitle: 'Waves 5–9 · head-cd',
    description:
      'Damager defeated, retro tech glitch era. Runners join the swarm.',
    source: {
      label: 'Nouns DAO head-cd (CC0)',
      href: 'https://nouns.center/',
    },
  },
  {
    id: 'ch3',
    sprite: '/swarm/backgrounds/bg-ch3.png',
    name: 'CHAPTER 3 — DECENTRALIZED',
    subtitle: 'Waves 10–14 · head-blackhole',
    description:
      '6529 Punk era. Snipers added. Memes seized. Black hole pulls everything toward the center.',
    source: {
      label: 'Nouns DAO head-blackhole (CC0)',
      href: 'https://nouns.center/',
    },
  },
  {
    id: 'ch4',
    sprite: '/swarm/backgrounds/bg-ch4.png',
    name: 'CHAPTER 4 — ANCIENT WISDOM',
    subtitle: 'Waves 15–19 · head-pyramid',
    description:
      'Rage era. Bombers and the first Titans (Geodetic Moment) appear. Geometric pressure mounts.',
    source: {
      label: 'Nouns DAO head-pyramid (CC0)',
      href: 'https://nouns.center/',
    },
  },
  {
    id: 'ch5',
    sprite: '/swarm/backgrounds/bg-ch5.png',
    name: 'CHAPTER 5 — INVASION',
    subtitle: 'Waves 20–24 · head-ufo',
    description:
      'Special Op era. Compliance mandatory. Titans become regular threats.',
    source: {
      label: 'Nouns DAO head-ufo (CC0)',
      href: 'https://nouns.center/',
    },
  },
  {
    id: 'ch6',
    sprite: '/swarm/backgrounds/bg-ch6.png',
    name: 'CHAPTER 6 — APEX',
    subtitle: 'Waves 25–30 · head-robot',
    description:
      'Beast Mode and Max Pain. Maximum enemy density. Cold tech. The arcade\'s intended ending.',
    source: {
      label: 'Nouns DAO head-robot (CC0)',
      href: 'https://nouns.center/',
    },
  },
];
