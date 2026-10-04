// ============================================================
// SPLENDOR — cards and nobles
//
// The 90 development cards and 10 nobles of the base game, written in a
// compact form: `[<bonus colour><points>|<cost>]` where the cost is a run of
// `<colour><count>` pairs. Colours are w(hite) b(lue) g(reen) r(ed) and k (black).
// ============================================================

export const COLORS = ['w', 'b', 'g', 'r', 'k'];

export const COLOR_NAMES = {
  w: 'White', b: 'Blue', g: 'Green', r: 'Red', k: 'Black', gold: 'Gold',
};

const LEVEL_1 = [
  'k0|r1g1b1w1', 'k0|r1g1b2w1', 'k0|r1b2w2', 'k0|r3g1k1', 'k0|r1g2', 'k0|g2w2', 'k0|g3', 'k1|b4',
  'b0|r1g1w1k1', 'b0|r2g1w1k1', 'b0|r2g2w1', 'b0|r1g3b1', 'b0|w1k2', 'b0|g2k2', 'b0|k3', 'b1|r4',
  'w0|r1g1b1k1', 'w0|r1g2b1k1', 'w0|g2b2k1', 'w0|b1w3k1', 'w0|r2k1', 'w0|b2k2', 'w0|b3', 'w1|g4',
  'g0|r1b1w1k1', 'g0|r1b1w1k2', 'g0|r2b1k2', 'g0|g1b3w1', 'g0|b1w2', 'g0|r2b2', 'g0|r3', 'g1|k4',
  'r0|g1b1w1k1', 'r0|g1b1w2k1', 'r0|g1w2k2', 'r0|r1w1k3', 'r0|g1b2', 'r0|r2w2', 'r0|w3', 'r1|w4',
];

const LEVEL_2 = [
  'k1|g2b2w3', 'k1|g3w3k2', 'k2|r2g4b1', 'k2|r3g5', 'k2|w5', 'k3|k6',
  'b1|r3g2b2', 'b1|g3b2k3', 'b2|b3w5', 'b2|r1w2k4', 'b2|b5', 'b3|b6',
  'w1|r2g3k2', 'w1|r3b3w2', 'w2|r4g1k2', 'w2|r5k3', 'w2|r5', 'w3|w6',
  'g1|r3g2w3', 'g1|b3w2k2', 'g2|b2w4k1', 'g2|g3b5', 'g2|g5', 'g3|g6',
  'r1|r2w2k3', 'r1|r2b3k3', 'r2|g2b4w1', 'r2|w3k5', 'r2|k5', 'r3|r6',
];

const LEVEL_3 = [
  'k3|r3g5b3w3', 'k4|r7', 'k4|r6g3k3', 'k5|r7k3',
  'b3|r3g3w3k5', 'b4|w7', 'b4|b3w6k3', 'b5|b3w7',
  'w3|r5g3b3k3', 'w4|k7', 'w4|r3w3k6', 'w5|w3k7',
  'g3|r3b3w5k3', 'g4|b7', 'g4|g3b6w3', 'g5|g3b7',
  'r3|g3b5w3k3', 'r4|g7', 'r4|r3g6b3', 'r5|r3g7',
];

// 'r1g2b1' → { w: 0, b: 1, g: 2, r: 1, k: 0 }
function parseCost(str) {
  const cost = { w: 0, b: 0, g: 0, r: 0, k: 0 };
  for (const [, color, n] of str.matchAll(/([wbgrk])(\d+)/g)) cost[color] += Number(n);
  return cost;
}

function build(level, rows) {
  return rows.map((row, i) => {
    const [head, cost] = row.split('|');
    return {
      id:     `L${level}-${String(i + 1).padStart(2, '0')}`,
      level,
      bonus:  head[0],
      points: Number(head.slice(1)),
      cost:   parseCost(cost),
    };
  });
}

export const DECKS = {
  1: build(1, LEVEL_1),
  2: build(2, LEVEL_2),
  3: build(3, LEVEL_3),
};

export const ALL_CARDS = [...DECKS[1], ...DECKS[2], ...DECKS[3]];
export const CARDS_BY_ID = Object.fromEntries(ALL_CARDS.map(c => [c.id, c]));

// Nobles ask for a number of cards of given colours, and are worth 3 points.
const NOBLE_ROWS = [
  'r4g4', 'g4b4', 'b4w4', 'w4k4', 'k4r4',
  'r3g3b3', 'b3g3w3', 'b3w3k3', 'w3k3r3', 'k3r3g3',
];

export const NOBLES = NOBLE_ROWS.map((row, i) => ({
  id:     `N-${i + 1}`,
  points: 3,
  req:    parseCost(row),
}));
