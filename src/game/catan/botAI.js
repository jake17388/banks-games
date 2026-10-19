// ============================================================
// CATAN — bots
//
// A bot scores every spot by the pips (odds of being rolled) and the variety of
// resources around it. It opens on the best spots, then each turn spends its
// hand on the best thing it can afford — a city, a settlement, a development
// card, or a road toward a spot worth settling — trading with the bank for
// whatever it is a card short of. It takes trade offers that help it.
// ============================================================

import { TOPOLOGY, PORT_SLOTS, RESOURCES, pips } from './board.js';
import * as engine from './engine.js';
import {
  COSTS, canPay, pointsOf, buildingsOf, tradeRatios,
  legalSettlementVertices, legalCityVertices, legalRoadEdges, currentPlayerId, WIN_POINTS,
} from './engine.js';

export const BOT_NAMES = ['Marco', 'Isabella', 'Magellan'];

const pick = arr => arr[Math.floor(Math.random() * arr.length)];

// ── Reading the board ────────────────────────────────────────

function resourcesAround(state, vid) {
  return TOPOLOGY.vertices[vid].hexes
    .map(h => state.hexes[h])
    .filter(h => h.resource);
}

// What a spot is worth: its pips, a bonus for the variety of resources, and a
// little for sitting on a harbour.
function spotValue(state, pid, vid, have = {}) {
  const hexes = resourcesAround(state, vid);
  let value = hexes.reduce((n, h) => n + pips(h.num), 0);
  const kinds = new Set(hexes.map(h => h.resource));
  value += kinds.size * 0.8;
  for (const k of kinds) if (!have[k]) value += 0.9;   // resources we don't yet produce
  PORT_SLOTS.forEach((slot, i) => {
    if (slot.a !== vid && slot.b !== vid) return;
    const type = state.ports[i];
    value += type === 'any' ? 0.8 : (have[type] ? 2.2 : 0.6);
  });
  return value;
}

// Pips of production the bot already has in each resource.
function production(state, pid) {
  const have = {};
  for (const b of buildingsOf(state, pid)) {
    for (const h of resourcesAround(state, b.id)) {
      have[h.resource] = (have[h.resource] ?? 0) + pips(h.num) * (b.type === 'city' ? 2 : 1);
    }
  }
  return have;
}

// The best settlement spot within reach if the bot extended its roads, with the
// road to build next to get there.
function roadTarget(state, pid) {
  const have = production(state, pid);
  const open = new Set(legalSettlementVertices(state, pid, { setup: true }));
  let best = null;

  for (const edge of legalRoadEdges(state, pid)) {
    const e = TOPOLOGY.edges[edge];
    for (const far of [e.a, e.b]) {
      if (state.buildings[far]) continue;
      // The spot this road leads to, or one road beyond it.
      const reach = [far, ...TOPOLOGY.vertices[far].neighbors];
      for (const spot of reach) {
        if (!open.has(spot)) continue;
        const score = spotValue(state, pid, spot, have) - (spot === far ? 0 : 1.5);
        if (!best || score > best.score) best = { edge, spot, score };
      }
    }
  }
  return best;
}

// ── What to buy ──────────────────────────────────────────────

function wishList(state, pid) {
  const p = state.players[pid];
  const list = [];
  if (legalCityVertices(state, pid).length && p.pieces.city > 0) list.push('city');
  if (p.pieces.settlement > 0) {
    if (legalSettlementVertices(state, pid).length) list.push('settlement');
    else if (p.pieces.road > 0 && roadTarget(state, pid)) list.push('road');
  }
  if (state.devDeck.length) list.push('dev');
  return list;
}

function shortOf(hand, cost) {
  const need = {};
  for (const [r, n] of Object.entries(cost)) if (hand[r] < n) need[r] = n - hand[r];
  return need;
}

// ── Moves ────────────────────────────────────────────────────

function setupMove(state, pid) {
  const have = production(state, pid);

  if (state.setup.placed === null) {
    const spots = legalSettlementVertices(state, pid, { setup: true });
    spots.sort((a, b) => spotValue(state, pid, b, have) - spotValue(state, pid, a, have));
    return { type: 'settlement', id: spots[0] };
  }

  // Run the road toward the best spot beyond the settlement.
  const from = state.setup.placed;
  const open = new Set(legalSettlementVertices(state, pid, { setup: true }));
  let best = null;
  for (const edge of legalRoadEdges(state, pid, { from })) {
    const e = TOPOLOGY.edges[edge];
    const far = e.a === from ? e.b : e.a;
    const reach = [far, ...TOPOLOGY.vertices[far].neighbors].filter(v => open.has(v) || v === far);
    const score = Math.max(0, ...reach.map(v => (open.has(v) ? spotValue(state, pid, v, have) : 0)));
    if (!best || score > best.score) best = { edge, score };
  }
  return { type: 'road', id: best.edge };
}

function discardMove(state, pid) {
  const player = state.players[pid];
  const hand = { ...player.resources };
  const goal = COSTS[wishList(state, pid)[0]] ?? {};
  const cards = Object.fromEntries(RESOURCES.map(r => [r, 0]));

  for (let i = 0; i < state.discarding[pid]; i++) {
    // Give up whatever we hold the most of beyond what the next purchase needs.
    const surplus = RESOURCES
      .filter(r => hand[r] > 0)
      .sort((a, b) => (hand[b] - (goal[b] ?? 0)) - (hand[a] - (goal[a] ?? 0)));
    const r = surplus[0];
    hand[r]--; cards[r]++;
  }
  return { type: 'discard', cards };
}

function robberMove(state, pid) {
  let best = null;
  for (const hex of state.hexes) {
    if (hex.id === state.robber) continue;
    let score = hex.resource ? pips(hex.num) : 0;
    let touched = false;
    for (const vid of TOPOLOGY.hexes[hex.id].vertices) {
      const b = state.buildings[vid];
      if (!b) continue;
      const weight = b.type === 'city' ? 2 : 1;
      if (b.owner === pid) { score -= 12 * weight; continue; }
      touched = true;
      score += (pointsOf(state, b.owner) + 2) * 0.9 * weight;
    }
    if (!touched) score -= 3;
    if (!best || score > best.score) best = { hex: hex.id, score };
  }
  return { type: 'robber', hex: best.hex };
}

function stealMove(state, pid) {
  const victims = [...state.stealFrom];
  victims.sort((a, b) => pointsOf(state, b) - pointsOf(state, a));
  return { type: 'steal', victim: victims[0] };
}

// Which cards to ask the bank for, given what we're after.
function bankMove(state, pid, goalCost) {
  const player = state.players[pid];
  const need = Object.keys(shortOf(player.resources, goalCost));
  if (!need.length) return null;
  const ratio = tradeRatios(state, pid);

  const spare = RESOURCES
    .filter(r => !need.includes(r))
    .map(r => ({ r, extra: player.resources[r] - (goalCost[r] ?? 0) }))
    .filter(x => x.extra >= ratio[x.r])
    .sort((a, b) => b.extra / ratio[b.r] - a.extra / ratio[a.r]);
  if (!spare.length) return null;
  const get = need.find(r => state.bank[r] > 0);
  return get ? { type: 'bank', give: spare[0].r, get } : null;
}

function developmentMove(state, pid) {
  const player = state.players[pid];
  if (state.devPlayed) return null;
  const playable = type => player.devCards.some(c => c.type === type && c.turn !== state.turnNumber);

  if (playable('knight')) {
    const sitting = robberOnUs(state, pid);
    if (sitting || state.turnStage === 'main') return { type: 'dev', card: 'knight' };
  }
  if (state.turnStage !== 'main') return null;

  if (playable('roadBuilding') && player.pieces.road >= 2 && roadTarget(state, pid)) {
    return { type: 'dev', card: 'roadBuilding' };
  }
  if (playable('yearOfPlenty')) {
    const goal = COSTS[wishList(state, pid)[0]] ?? COSTS.city;
    const short = Object.entries(shortOf(player.resources, goal)).flatMap(([r, n]) => Array(n).fill(r));
    const picks = [...short, 'ore', 'grain'].slice(0, 2);
    if (picks.every(r => state.bank[r] > 0)) return { type: 'dev', card: 'yearOfPlenty', options: { resources: picks } };
  }
  if (playable('monopoly')) {
    const worth = r => state.playerOrder.reduce((n, id) => n + (id === pid ? 0 : state.players[id].resources[r] ?? 0), 0);
    const best = [...RESOURCES].sort((a, b) => worth(b) - worth(a))[0];
    if (worth(best) >= 3) return { type: 'dev', card: 'monopoly', options: { resource: best } };
  }
  return null;
}

function robberOnUs(state, pid) {
  return TOPOLOGY.hexes[state.robber].vertices.some(v => state.buildings[v]?.owner === pid);
}

function mainMove(state, pid) {
  const player = state.players[pid];
  const hand = player.resources;

  const dev = developmentMove(state, pid);
  if (dev) return dev;

  const wishes = wishList(state, pid);
  for (const want of wishes) {
    if (want === 'city' && canPay(hand, COSTS.city)) {
      const spots = legalCityVertices(state, pid)
        .sort((a, b) => spotValue(state, pid, b) - spotValue(state, pid, a));
      return { type: 'city', id: spots[0] };
    }
    if (want === 'settlement' && canPay(hand, COSTS.settlement)) {
      const have = production(state, pid);
      const spots = legalSettlementVertices(state, pid)
        .sort((a, b) => spotValue(state, pid, b, have) - spotValue(state, pid, a, have));
      return { type: 'settlement', id: spots[0] };
    }
    if (want === 'dev' && canPay(hand, COSTS.dev)) {
      return { type: 'buyDev' };
    }
    if (want === 'road' && canPay(hand, COSTS.road)) {
      return { type: 'road', id: roadTarget(state, pid).edge };
    }
  }

  // Not affordable yet: swap spare cards with the bank toward the first wish.
  for (const want of wishes) {
    const trade = bankMove(state, pid, COSTS[want]);
    if (trade) return trade;
  }
  return { type: 'end' };
}

function respondMove(state, pid) {
  const t = state.trade;
  const player = state.players[pid];
  if (!canPay(player.resources, t.want)) return { type: 'respond', accept: false };

  const goal = COSTS[wishList(state, pid)[0]] ?? {};
  const missing = shortOf(player.resources, goal);
  const getsWhatItNeeds = Object.keys(t.give).some(r => missing[r]);
  const givesWhatItNeeds = Object.entries(t.want).some(([r, n]) => player.resources[r] - n < (goal[r] ?? 0));
  const asked = Object.values(t.want).reduce((n, x) => n + x, 0);
  const offered = Object.values(t.give).reduce((n, x) => n + x, 0);
  const leading = pointsOf(state, t.from) >= WIN_POINTS - 2;

  const fair = offered >= asked;
  return { type: 'respond', accept: getsWhatItNeeds && !givesWhatItNeeds && fair && !leading };
}

// ── Entry points ─────────────────────────────────────────────

// Who the table is waiting on right now, as a list of ids in the order they
// should act: discarders first (any order), then trade responders, then the
// player whose turn it is.
export function actorsWaiting(state) {
  if (!state || state.phase === 'gameover') return [];
  if (state.phase === 'setup') return [state.setup.seq[state.setup.index]];

  const current = currentPlayerId(state);
  if (state.turnStage === 'discard') return Object.keys(state.discarding);

  const out = [];
  const t = state.trade;
  if (t && state.turnStage === 'main') {
    for (const id of state.playerOrder) {
      if (id !== t.from && !t.responses[id]) out.push(id);
    }
  }
  out.push(current);
  return out;
}

export function getBotMove(state, botId) {
  if (state.phase === 'setup') return setupMove(state, botId);

  if (state.turnStage === 'discard') return discardMove(state, botId);

  const current = currentPlayerId(state);
  const t = state.trade;
  if (botId !== current) {
    return t && !t.responses[botId] ? respondMove(state, botId) : null;
  }
  if (t && state.turnStage === 'main') {
    // A bot makes no offers, but a human's pending offer is not its business.
    if (t.from === botId) return { type: 'cancelTrade' };
  }

  switch (state.turnStage) {
    case 'roll': {
      const dev = developmentMove(state, botId);
      return dev && dev.card === 'knight' ? dev : { type: 'roll' };
    }
    case 'robber':       return robberMove(state, botId);
    case 'steal':        return stealMove(state, botId);
    case 'roadBuilding': return { type: 'road', id: (roadTarget(state, botId) ?? { edge: legalRoadEdges(state, botId)[0] }).edge };
    case 'main':         return mainMove(state, botId);
    default:             return null;
  }
}

// Something always legal, for when the clever move fails.
export function getBotFallbackMove(state, botId) {
  if (state.phase === 'setup') {
    if (state.setup.placed === null) return { type: 'settlement', id: pick(legalSettlementVertices(state, botId, { setup: true })) };
    return { type: 'road', id: pick(legalRoadEdges(state, botId, { from: state.setup.placed })) };
  }
  if (state.turnStage === 'discard') {
    const hand = { ...state.players[botId].resources };
    const cards = Object.fromEntries(RESOURCES.map(r => [r, 0]));
    for (let i = 0; i < state.discarding[botId]; i++) {
      const r = pick(RESOURCES.filter(x => hand[x] > 0));
      hand[r]--; cards[r]++;
    }
    return { type: 'discard', cards };
  }
  if (botId !== currentPlayerId(state)) return { type: 'respond', accept: false };

  switch (state.turnStage) {
    case 'roll':   return { type: 'roll' };
    case 'robber': return { type: 'robber', hex: pick(state.hexes.filter(h => h.id !== state.robber)).id };
    case 'steal':  return { type: 'steal', victim: state.stealFrom[0] };
    case 'roadBuilding': return { type: 'road', id: legalRoadEdges(state, botId)[0] };
    default:       return { type: 'end' };
  }
}


// Applies a move chosen above, returning the next state.
export function playBotMove(state, botId, move) {
  switch (move?.type) {
    case 'settlement': return engine.buildSettlement(state, botId, move.id);
    case 'city':       return engine.buildCity(state, botId, move.id);
    case 'road':       return engine.buildRoad(state, botId, move.id);
    case 'roll':       return engine.roll(state, botId);
    case 'discard':    return engine.discard(state, botId, move.cards);
    case 'robber':     return engine.moveRobber(state, botId, move.hex);
    case 'steal':      return engine.steal(state, botId, move.victim);
    case 'buyDev':     return engine.buyDevCard(state, botId);
    case 'dev':        return engine.playDevCard(state, botId, move.card, move.options);
    case 'bank':       return engine.bankTrade(state, botId, move.give, move.get);
    case 'respond':    return engine.respondTrade(state, botId, move.accept);
    case 'cancelTrade': return engine.cancelTrade(state, botId);
    case 'end':        return engine.endTurn(state, botId);
    default:           return null;
  }
}
