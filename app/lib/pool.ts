/**
 * The full pool of 64 tokens with metadata used by mint roll + my-mints display.
 * IDs of wildpixel tokens (open palettes): 12, 14, 15, 17.
 *
 * SVG paths are derived: `/svg/${String(tokenId).padStart(3, '0')}.svg`.
 */

export type Era = '8-bit' | '16-bit' | '32-bit';

export interface PoolGame {
  /** Internal id like 'g12' — used for set membership in mint roll */
  id: string;
  tokenId: number;
  trait: string;
  finalTitle: string;
  era: Era;
  year: number;
  /** [rows, cols] for the pixel arrangement grid */
  grid: [number, number];
  wildpixel?: boolean;
}

export const POOL: PoolGame[] = [
  { id: 'g1',  tokenId: 1,  trait: 'Pitfall!',                    finalTitle: 'Eight-Bit Study No. 1',         era: '8-bit',  year: 1982, grid: [2, 4] },
  { id: 'g2',  tokenId: 2,  trait: 'Lunar Lander',                finalTitle: 'Eight-Bit Study No. 2',         era: '8-bit',  year: 1979, grid: [2, 4] },
  { id: 'g3',  tokenId: 3,  trait: 'Breakout',                    finalTitle: 'Eight-Bit Study No. 3',         era: '8-bit',  year: 1976, grid: [2, 4] },
  { id: 'g4',  tokenId: 4,  trait: 'Missile Command',             finalTitle: 'Eight-Bit Study No. 4',         era: '8-bit',  year: 1980, grid: [2, 4] },
  { id: 'g5',  tokenId: 5,  trait: 'Asteroids',                   finalTitle: 'Eight-Bit Study No. 5',         era: '8-bit',  year: 1979, grid: [2, 4] },
  { id: 'g6',  tokenId: 6,  trait: 'Mario Bros.',                 finalTitle: 'Eight-Bit Study No. 6',         era: '8-bit',  year: 1983, grid: [2, 4] },
  { id: 'g7',  tokenId: 7,  trait: 'Frogger',                     finalTitle: 'Eight-Bit Study No. 7',         era: '8-bit',  year: 1981, grid: [2, 4] },
  { id: 'g8',  tokenId: 8,  trait: 'Pac-Man',                     finalTitle: 'Eight-Bit Study No. 8',         era: '8-bit',  year: 1980, grid: [2, 4] },
  { id: 'g9',  tokenId: 9,  trait: 'Pole Position',               finalTitle: 'Eight-Bit Study No. 9',         era: '8-bit',  year: 1982, grid: [2, 4] },
  { id: 'g10', tokenId: 10, trait: 'Defender',                    finalTitle: 'Eight-Bit Study No. 10',        era: '8-bit',  year: 1981, grid: [2, 4] },
  { id: 'g11', tokenId: 11, trait: 'Galaga',                      finalTitle: 'Eight-Bit Study No. 11',        era: '8-bit',  year: 1981, grid: [2, 4] },
  { id: 'g12', tokenId: 12, trait: 'Centipede',                   finalTitle: 'Eight-Bit Study No. 12',        era: '8-bit',  year: 1981, grid: [2, 4], wildpixel: true },
  { id: 'g13', tokenId: 13, trait: 'Donkey Kong (arcade)',        finalTitle: 'Eight-Bit Study No. 13',        era: '8-bit',  year: 1981, grid: [2, 4] },
  { id: 'g14', tokenId: 14, trait: 'Q*bert',                      finalTitle: 'Eight-Bit Study No. 14',        era: '8-bit',  year: 1982, grid: [2, 4], wildpixel: true },
  { id: 'g15', tokenId: 15, trait: 'Joust',                       finalTitle: 'Eight-Bit Study No. 15',        era: '8-bit',  year: 1982, grid: [2, 4], wildpixel: true },
  { id: 'g16', tokenId: 16, trait: 'Dig Dug',                     finalTitle: 'Eight-Bit Study No. 16',        era: '8-bit',  year: 1982, grid: [2, 4] },
  { id: 'g17', tokenId: 17, trait: 'Tron',                        finalTitle: 'Eight-Bit Study No. 17',        era: '8-bit',  year: 1982, grid: [2, 4], wildpixel: true },
  { id: 'g18', tokenId: 18, trait: 'Double Dragon',               finalTitle: 'Sixteen-Bit Composition I',     era: '16-bit', year: 1987, grid: [2, 8] },
  { id: 'g19', tokenId: 19, trait: 'Paperboy',                    finalTitle: 'Sixteen-Bit Composition II',    era: '16-bit', year: 1985, grid: [2, 8] },
  { id: 'g20', tokenId: 20, trait: 'Rampage',                     finalTitle: 'Sixteen-Bit Composition III',   era: '16-bit', year: 1986, grid: [2, 8] },
  { id: 'g21', tokenId: 21, trait: 'Street Fighter II',           finalTitle: 'Sixteen-Bit Composition IV',    era: '16-bit', year: 1991, grid: [2, 8] },
  { id: 'g22', tokenId: 22, trait: 'Sonic the Hedgehog',          finalTitle: 'Sixteen-Bit Composition V',     era: '16-bit', year: 1991, grid: [2, 8] },
  { id: 'g23', tokenId: 23, trait: 'Golden Axe',                  finalTitle: 'Sixteen-Bit Composition VI',    era: '16-bit', year: 1989, grid: [2, 8] },
  { id: 'g24', tokenId: 24, trait: 'Mortal Kombat',               finalTitle: 'Sixteen-Bit Composition VII',   era: '16-bit', year: 1992, grid: [2, 8] },
  { id: 'g25', tokenId: 25, trait: 'Zelda: A Link to the Past',   finalTitle: 'Sixteen-Bit Composition VIII',  era: '16-bit', year: 1991, grid: [2, 8] },
  { id: 'g26', tokenId: 26, trait: 'Donkey Kong Country',         finalTitle: 'Sixteen-Bit Composition IX',    era: '16-bit', year: 1994, grid: [2, 8] },
  { id: 'g27', tokenId: 27, trait: 'Virtua Racing',               finalTitle: 'Sixteen-Bit Composition X',     era: '16-bit', year: 1992, grid: [2, 8] },
  { id: 'g28', tokenId: 28, trait: 'Prince of Persia',            finalTitle: 'Sixteen-Bit Composition XI',    era: '16-bit', year: 1989, grid: [2, 8] },
  { id: 'g29', tokenId: 29, trait: "Ghouls 'n Ghosts",            finalTitle: 'Sixteen-Bit Composition XII',   era: '16-bit', year: 1988, grid: [2, 8] },
  { id: 'g30', tokenId: 30, trait: 'Moonwalker',                  finalTitle: 'Sixteen-Bit Composition XIII',  era: '16-bit', year: 1990, grid: [2, 8] },
  { id: 'g31', tokenId: 31, trait: 'Pinball Illusions',           finalTitle: 'Sixteen-Bit Composition XIV',   era: '16-bit', year: 1995, grid: [2, 8] },
  { id: 'g32', tokenId: 32, trait: 'Wonder Boy',                  finalTitle: 'Sixteen-Bit Composition XV',    era: '16-bit', year: 1986, grid: [2, 8] },
  { id: 'g33', tokenId: 33, trait: 'Wings',                       finalTitle: 'Sixteen-Bit Composition XVI',   era: '16-bit', year: 1990, grid: [2, 8] },
  { id: 'g34', tokenId: 34, trait: 'Indiana Jones & Last Crusade',finalTitle: 'Sixteen-Bit Composition XVII',  era: '16-bit', year: 1989, grid: [2, 8] },
  { id: 'g35', tokenId: 35, trait: 'Secret of Monkey Island',     finalTitle: 'Sixteen-Bit Composition XVIII', era: '16-bit', year: 1990, grid: [2, 8] },
  { id: 'g36', tokenId: 36, trait: 'Wing Commander',              finalTitle: 'Sixteen-Bit Composition XIX',   era: '16-bit', year: 1990, grid: [2, 8] },
  { id: 'g37', tokenId: 37, trait: 'Wolfenstein 3D',              finalTitle: 'Sixteen-Bit Composition XX',    era: '16-bit', year: 1992, grid: [2, 8] },
  { id: 'g38', tokenId: 38, trait: 'Ultima VII',                  finalTitle: 'Sixteen-Bit Composition XXI',   era: '16-bit', year: 1992, grid: [2, 8] },
  { id: 'g39', tokenId: 39, trait: 'Doom',                        finalTitle: 'Sixteen-Bit Composition XXII',  era: '16-bit', year: 1993, grid: [2, 8] },
  { id: 'g40', tokenId: 40, trait: 'SimCity 2000',                finalTitle: 'Sixteen-Bit Composition XXIII', era: '16-bit', year: 1993, grid: [2, 8] },
  { id: 'g41', tokenId: 41, trait: 'Lemmings',                    finalTitle: 'Sixteen-Bit Composition XXIV',  era: '16-bit', year: 1991, grid: [2, 8] },
  { id: 'g42', tokenId: 42, trait: 'Civilization',                finalTitle: 'Sixteen-Bit Composition XXV',   era: '16-bit', year: 1991, grid: [2, 8] },
  { id: 'g43', tokenId: 43, trait: 'X-Wing',                      finalTitle: 'Sixteen-Bit Composition XXVI',  era: '16-bit', year: 1993, grid: [2, 8] },
  { id: 'g44', tokenId: 44, trait: 'Theme Park',                  finalTitle: 'Sixteen-Bit Composition XXVII', era: '16-bit', year: 1994, grid: [2, 8] },
  { id: 'g45', tokenId: 45, trait: 'Dune II',                     finalTitle: 'Sixteen-Bit Composition XXVIII',era: '16-bit', year: 1992, grid: [2, 8] },
  { id: 'g46', tokenId: 46, trait: 'Tekken 3',                    finalTitle: 'Thirty-Two-Bit Tableau I',      era: '32-bit', year: 1997, grid: [4, 8] },
  { id: 'g47', tokenId: 47, trait: 'Crash Bandicoot',             finalTitle: 'Thirty-Two-Bit Tableau II',     era: '32-bit', year: 1996, grid: [4, 8] },
  { id: 'g48', tokenId: 48, trait: 'Wipeout',                     finalTitle: 'Thirty-Two-Bit Tableau III',    era: '32-bit', year: 1995, grid: [4, 8] },
  { id: 'g49', tokenId: 49, trait: 'Metal Gear Solid',            finalTitle: 'Thirty-Two-Bit Tableau IV',     era: '32-bit', year: 1998, grid: [4, 8] },
  { id: 'g50', tokenId: 50, trait: 'GoldenEye 007',               finalTitle: 'Thirty-Two-Bit Tableau V',      era: '32-bit', year: 1997, grid: [4, 8] },
  { id: 'g51', tokenId: 51, trait: 'Tomb Raider',                 finalTitle: 'Thirty-Two-Bit Tableau VI',     era: '32-bit', year: 1996, grid: [4, 8] },
  { id: 'g52', tokenId: 52, trait: 'Final Fantasy VII',           finalTitle: 'Thirty-Two-Bit Tableau VII',    era: '32-bit', year: 1997, grid: [4, 8] },
  { id: 'g53', tokenId: 53, trait: 'Resident Evil',               finalTitle: 'Thirty-Two-Bit Tableau VIII',   era: '32-bit', year: 1996, grid: [4, 8] },
  { id: 'g54', tokenId: 54, trait: 'Super Mario 64',              finalTitle: 'Thirty-Two-Bit Tableau IX',     era: '32-bit', year: 1996, grid: [4, 8] },
  { id: 'g55', tokenId: 55, trait: 'Gran Turismo',                finalTitle: 'Thirty-Two-Bit Tableau X',      era: '32-bit', year: 1997, grid: [4, 8] },
  { id: 'g56', tokenId: 56, trait: 'Quake',                       finalTitle: 'Thirty-Two-Bit Tableau XI',     era: '32-bit', year: 1996, grid: [4, 8] },
  { id: 'g57', tokenId: 57, trait: 'Diablo',                      finalTitle: 'Thirty-Two-Bit Tableau XII',    era: '32-bit', year: 1996, grid: [4, 8] },
  { id: 'g58', tokenId: 58, trait: 'Half-Life',                   finalTitle: 'Thirty-Two-Bit Tableau XIII',   era: '32-bit', year: 1998, grid: [4, 8] },
  { id: 'g59', tokenId: 59, trait: 'StarCraft',                   finalTitle: 'Thirty-Two-Bit Tableau XIV',    era: '32-bit', year: 1998, grid: [4, 8] },
  { id: 'g60', tokenId: 60, trait: 'Age of Empires',              finalTitle: 'Thirty-Two-Bit Tableau XV',     era: '32-bit', year: 1997, grid: [4, 8] },
  { id: 'g61', tokenId: 61, trait: "Tony Hawk's Pro Skater",      finalTitle: 'Thirty-Two-Bit Tableau XVI',    era: '32-bit', year: 1999, grid: [4, 8] },
  { id: 'g62', tokenId: 62, trait: 'Sonic Adventure',             finalTitle: 'Thirty-Two-Bit Tableau XVII',   era: '32-bit', year: 1998, grid: [4, 8] },
  { id: 'g63', tokenId: 63, trait: 'Pokémon Red/Blue',            finalTitle: 'Thirty-Two-Bit Tableau XVIII',  era: '32-bit', year: 1996, grid: [4, 8] },
  { id: 'g64', tokenId: 64, trait: 'Quake III Arena',             finalTitle: 'Thirty-Two-Bit Tableau XIX',    era: '32-bit', year: 1999, grid: [4, 8] },
];

export const MINT_PRICE = 0.05;
export const POOL_TOTAL = 64;

/** SVG path helper — pads token ID to 3 digits */
export function svgPath(tokenId: number): string {
  return `/svg/${String(tokenId).padStart(3, '0')}.svg`;
}

/** Era → CSS class name (e.g., '8-bit' → 'era-8') */
export function eraClass(era: Era): 'era-8' | 'era-16' | 'era-32' {
  return `era-${era.split('-')[0]}` as 'era-8' | 'era-16' | 'era-32';
}
