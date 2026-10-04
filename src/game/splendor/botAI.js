// ============================================================
// SPLENDOR — bots
//
// A bot picks a target card — the one that is cheapest to finish for the
// points and discount it brings — and spends its turns walking toward it:
// buying whatever it can afford that is worth having, otherwise taking the
// gems the target is short of, otherwise reserving it.
// ============================================================

import { COLORS } from './cards.js';
import {
  bonusesOf, paymentFor, totalGems, legalMoves, eligibleNobles,
  GEM_LIMIT, RESERVE_LIMIT,
} from './engine.js';

export const BOT_NAMES = ['Midas', 'Croesus', 'Medici'];

// ── Reading the table ────────────────────────────────────────

// Gems of each colour still missing after discounts (gold not counted).
function shortfall(player, bonus, card) {
  const short = { w: 0, b: 0, g: 0, r: 0, k: 0 };
  let total = 0;
  for (const c of COLORS) {
    const need = Math.max(0, card.cost[c] - bonus[c] - player.gems[c]);
    short[c] = need;
    total += need;
  }
  return { short, total: Math.max(0, total - player.gems.gold) };
}

// How much a colour is worth to this player as a permanent discount: what the
// visible cards still ask for in it, and any noble that wants it.
function colorWeight(state, bonus, color) {
  let w = 0;
  for (const level of [1, 2, 3]) {
    for (const card of state.market[level]) {
      if (card && card.cost[color] > bonus[color]) w += 0.4;
    }
  }
  for (const noble of state.nobles) {
    if (noble.req[color] > bonus[color]) w += 1.2;
  }
  return w;
}

function cardValue(state, player, bonus, card) {
  const afterBuy   = player.cards.length + 1;
  const earlyBonus = Math.max(0, 6 - afterBuy) * 0.15;     // discounts matter more early
  return card.points * 2 + 1 + colorWeight(state, bonus, card.bonus) + earlyBonus;
}

// The card worth saving up for: value per gem still missing.
function pickTarget(state, player, bonus) {
  const candidates = [
    ...[1, 2, 3].flatMap(level => state.market[level].map((card, index) =>
      card && { card, ref: { level, index } })).filter(Boolean),
    ...player.reserved.map(card => ({ card, ref: { reservedId: card.id } })),
  ];

  let best = null;
  for (const c of candidates) {
    const { short, total } = shortfall(player, bonus, c.card);
    const score = cardValue(state, player, bonus, c.card) / (total + 1.5);
    if (!best || score > best.score) best = { ...c, short, total, score };
  }
  return best;
}

// ── Choosing a move ──────────────────────────────────────────

export function getBotMove(state, botId) {
  const player = state.players[botId];
  const bonus  = bonusesOf(state, player);

  if (state.turnStage === 'returnGems') return returnMove(state, player, bonus);
  if (state.turnStage === 'chooseNoble') {
    return { type: 'noble', nobleId: eligibleNobles(state, botId)[0].id };
  }

  // Buy the most valuable card we can afford — unless it's a pointless
  // purchase when a better one is a gem or two away.
  const buys = legalMoves(state, botId)
    .filter(m => m.type === 'buy')
    .map(m => {
      const card = m.reservedId
        ? player.reserved.find(c => c.id === m.reservedId)
        : state.market[m.level][m.index];
      const pay = paymentFor(player, card);
      // Gold is precious: prefer purchases that keep it.
      return { move: m, card, score: cardValue(state, player, bonus, card) - pay.gold * 0.8 };
    })
    .sort((a, b) => b.score - a.score);
  if (buys.length) return buys[0].move;

  const target = pickTarget(state, player, bonus);

  // Take the gems the target needs, topping up with whatever else is useful.
  const open = COLORS.filter(c => state.bank[c] > 0);
  if (open.length > 0) {
    const need = target
      ? COLORS.filter(c => target.short[c] > 0 && state.bank[c] > 0)
      : [];

    // Two of one colour when we're short two of it and the pile allows it.
    const double = COLORS.find(c => target?.short[c] >= 2 && state.bank[c] >= 4);
    const room   = GEM_LIMIT - totalGems(player.gems);
    if (double && need.length <= 1 && room >= 2) return { type: 'take', colors: [double, double] };

    const rest = open
      .filter(c => !need.includes(c))
      .sort((a, b) => colorWeight(state, bonus, b) - colorWeight(state, bonus, a)
        || state.bank[b] - state.bank[a]);
    const colors = [...need, ...rest].slice(0, Math.min(3, open.length));
    if (colors.length > 0) return { type: 'take', colors };
  }

  // Nothing to take: lock the target down, or take any legal move.
  if (target && !target.ref.reservedId && player.reserved.length < RESERVE_LIMIT) {
    return { type: 'reserve', ...target.ref };
  }
  return getBotFallbackMove(state, botId);
}

// Which gems to hand back: the ones the bot is least likely to use, gold last.
function returnMove(state, player, bonus) {
  const excess = totalGems(player.gems) - GEM_LIMIT;
  const target = pickTarget(state, player, bonus);
  const gems   = { w: 0, b: 0, g: 0, r: 0, k: 0, gold: 0 };
  const held   = { ...player.gems };

  for (let i = 0; i < excess; i++) {
    const options = COLORS.filter(c => held[c] > 0);
    if (options.length === 0) { gems.gold++; held.gold--; continue; }
    // Colours the target needs are the last to go; then the most plentiful.
    options.sort((a, b) =>
      (target?.short[a] > 0 ? 1 : 0) - (target?.short[b] > 0 ? 1 : 0) || held[b] - held[a]);
    const give = options[0];
    gems[give]++; held[give]--;
  }
  return { type: 'return', gems };
}

// Always legal, so a hand can't stall on a bot that failed to find a move.
export function getBotFallbackMove(state, botId) {
  const player = state.players[botId];

  if (state.turnStage === 'returnGems') {
    const excess = totalGems(player.gems) - GEM_LIMIT;
    const gems   = { w: 0, b: 0, g: 0, r: 0, k: 0, gold: 0 };
    const held   = { ...player.gems };
    for (let i = 0; i < excess; i++) {
      const give = [...COLORS, 'gold'].find(c => held[c] > 0);
      gems[give]++; held[give]--;
    }
    return { type: 'return', gems };
  }
  if (state.turnStage === 'chooseNoble') {
    return { type: 'noble', nobleId: eligibleNobles(state, botId)[0].id };
  }

  const moves = legalMoves(state, botId);
  const buy   = moves.find(m => m.type === 'buy');
  if (buy) return buy;
  return moves[0] ?? { type: 'pass' };
}

