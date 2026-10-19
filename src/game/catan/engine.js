// ============================================================
// CATAN — game engine
//
// Pure state transitions: every exported function takes a state and returns
// the next state (mutating a structuredClone of it), or throws with a message
// that is safe to show the player.
//
// The rules follow the base game as Colonist.io plays it: a snake-draft setup,
// then turns of roll → (robber) → build/trade/play, with ten victory points
// winning the moment you have them on your own turn.
//
// `turnStage` says where the current player is in their turn:
//   roll          waiting for the dice (a knight may be played first)
//   discard       a 7 was rolled; everyone over seven cards hands half back
//   robber        the roller moves the robber
//   steal         ...and picks whom to rob when several are next to it
//   main          build, trade, play development cards, end the turn
//   roadBuilding  placing the free roads from a Road Building card
// ============================================================

import { TOPOLOGY, PORT_SLOTS, RESOURCES, generateLayout, RESOURCE_NAMES } from './board.js';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;

export const WIN_POINTS   = 10;
export const HAND_LIMIT   = 7;
const BANK_PER_RESOURCE   = 19;
export const LONGEST_ROAD_MIN = 5;
export const LARGEST_ARMY_MIN = 3;

export const COSTS = {
  road:       { lumber: 1, brick: 1 },
  settlement: { lumber: 1, brick: 1, wool: 1, grain: 1 },
  city:       { grain: 2, ore: 3 },
  dev:        { wool: 1, grain: 1, ore: 1 },
};

const PIECES = { road: 15, settlement: 5, city: 4 };

export const DEV_NAMES = {
  knight: 'Knight', victoryPoint: 'Victory Point', roadBuilding: 'Road Building',
  yearOfPlenty: 'Year of Plenty', monopoly: 'Monopoly',
};

const DEV_BAG = [
  ...Array(14).fill('knight'), ...Array(5).fill('victoryPoint'),
  ...Array(2).fill('roadBuilding'), ...Array(2).fill('yearOfPlenty'), ...Array(2).fill('monopoly'),
];

function clone(state) { return structuredClone(state); }

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function log(state, message) {
  state.log.push({ time: Date.now(), message });
  if (state.log.length > 200) state.log.shift();
}

const nameOf = (state, id) => state.playerNames?.[id] ?? 'Player';
const emptyHand = () => ({ lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 });

export function handSize(hand) {
  return RESOURCES.reduce((n, r) => n + hand[r], 0);
}

// How many cards a player holds — works on a sanitized opponent too, whose
// hand is only a count.
export function cardsIn(player) {
  return player.resourceCount ?? handSize(player.resources);
}

export const canPay = (hand, cost) => Object.entries(cost).every(([r, n]) => hand[r] >= n);

function describe(cards) {
  const parts = RESOURCES.filter(r => cards[r] > 0).map(r => `${cards[r]} ${RESOURCE_NAMES[r].toLowerCase()}`);
  return parts.length ? parts.join(', ') : 'nothing';
}

// ── Setting up ───────────────────────────────────────────────

export function createGame(playerIds) {
  if (playerIds.length < MIN_PLAYERS) throw new Error('Need at least 2 players.');
  if (playerIds.length > MAX_PLAYERS) throw new Error('Catan supports up to 4 players.');

  const order = shuffle(playerIds);
  const { hexes, ports } = generateLayout();

  const players = {};
  order.forEach((id, seat) => {
    players[id] = {
      color: seat,
      resources: emptyHand(),
      devCards: [],
      knights: 0,
      pieces: { ...PIECES },
    };
  });

  const desert = hexes.find(h => h.terrain === 'desert');

  return {
    gameType:    'catan',
    playerOrder: order,
    playerNames: Object.fromEntries(order.map(id => [id, id])),
    players,
    hexes,
    ports,
    robber:      desert.id,
    buildings:   {},                 // vertex id → { owner, type: 'settlement' | 'city' }
    roads:       {},                 // edge id   → owner
    bank:        Object.fromEntries(RESOURCES.map(r => [r, BANK_PER_RESOURCE])),
    devDeck:     shuffle(DEV_BAG).map((type, i) => ({ id: `dev-${i}`, type })),
    longestRoad: { holder: null, length: 0 },
    largestArmy: { holder: null, size: 0 },
    // Snake draft: forwards, then backwards.
    setup:       { seq: [...order, ...[...order].reverse()], index: 0, placed: null },
    currentPlayerIndex: 0,
    turnStage:   'setup',
    turnNumber:  0,
    phase:       'setup',
    dice:        null,
    devPlayed:   false,
    discarding:  {},
    afterRobber: 'main',
    resume:      'main',
    freeRoads:   0,
    stealFrom:   [],
    trade:       null,
    tradeSeq:    0,
    lastGains:   null,
    winner:      null,
    winners:     [],
    endReason:   null,
    log:         [],
  };
}

// ── Reading the board ────────────────────────────────────────

export function currentPlayerId(state) {
  return state.playerOrder[state.currentPlayerIndex];
}

export function buildingsOf(state, pid) {
  return Object.entries(state.buildings)
    .filter(([, b]) => b.owner === pid)
    .map(([id, b]) => ({ id: Number(id), type: b.type }));
}

export function roadsOf(state, pid) {
  return Object.entries(state.roads).filter(([, o]) => o === pid).map(([id]) => Number(id));
}

export function legalSettlementVertices(state, pid, { setup = false } = {}) {
  const out = [];
  for (const v of TOPOLOGY.vertices) {
    if (state.buildings[v.id]) continue;
    if (v.neighbors.some(n => state.buildings[n])) continue;            // distance rule
    if (!setup && !v.edges.some(e => state.roads[e] === pid)) continue;   // must connect
    out.push(v.id);
  }
  return out;
}

export function legalCityVertices(state, pid) {
  return buildingsOf(state, pid).filter(b => b.type === 'settlement').map(b => b.id);
}

// Roads grow out of your own buildings and roads — but not through a vertex an
// opponent has built on. In setup the road must touch the settlement just placed.
export function legalRoadEdges(state, pid, { from = null } = {}) {
  const out = [];
  for (const e of TOPOLOGY.edges) {
    if (state.roads[e.id] !== undefined) continue;
    if (from !== null) {
      if (e.a === from || e.b === from) out.push(e.id);
      continue;
    }
    const connects = [e.a, e.b].some(vid => {
      const b = state.buildings[vid];
      if (b) return b.owner === pid;
      return TOPOLOGY.vertices[vid].edges.some(x => x !== e.id && state.roads[x] === pid);
    });
    if (connects) out.push(e.id);
  }
  return out;
}

// How many cards of each resource a player gives for one from the bank.
export function tradeRatios(state, pid) {
  const ratio = Object.fromEntries(RESOURCES.map(r => [r, 4]));
  state.ports.forEach((type, i) => {
    const slot = PORT_SLOTS[i];
    const owns = state.buildings[slot.a]?.owner === pid || state.buildings[slot.b]?.owner === pid;
    if (!owns) return;
    if (type === 'any') for (const r of RESOURCES) ratio[r] = Math.min(ratio[r], 3);
    else ratio[type] = Math.min(ratio[type], 2);
  });
  return ratio;
}

// Public points: what everyone can see. Your own hidden Victory Point cards
// are only in the list on your own copy of the state, so this is also your
// true total when you are the one asking.
export function pointsOf(state, pid) {
  let n = 0;
  for (const b of Object.values(state.buildings)) {
    if (b.owner === pid) n += b.type === 'city' ? 2 : 1;
  }
  if (state.longestRoad.holder === pid) n += 2;
  if (state.largestArmy.holder === pid) n += 2;
  n += (state.players[pid].devCards ?? []).filter(c => c.type === 'victoryPoint').length;
  return n;
}

// The longest unbroken run of your roads. A road can't continue through a
// vertex an opponent has built on.
export function longestRoadOf(state, pid) {
  const mine = roadsOf(state, pid);
  if (!mine.length) return 0;
  const at = {};
  for (const id of mine) {
    const e = TOPOLOGY.edges[id];
    (at[e.a] ??= []).push(id);
    (at[e.b] ??= []).push(id);
  }

  let best = 0;
  const used = new Set();
  const walk = (vid, len) => {
    best = Math.max(best, len);
    for (const id of at[vid] ?? []) {
      if (used.has(id)) continue;
      const e = TOPOLOGY.edges[id];
      const next = e.a === vid ? e.b : e.a;
      used.add(id);
      const b = state.buildings[next];
      if (b && b.owner !== pid) best = Math.max(best, len + 1);
      else walk(next, len + 1);
      used.delete(id);
    }
  };
  for (const vid of Object.keys(at)) walk(Number(vid), 0);
  return best;
}

// ── Awards ───────────────────────────────────────────────────

function updateLongestRoad(state) {
  const lengths = Object.fromEntries(state.playerOrder.map(id => [id, longestRoadOf(state, id)]));
  const max = Math.max(0, ...Object.values(lengths));
  const was = state.longestRoad.holder;

  let holder = null;
  if (max >= LONGEST_ROAD_MIN) {
    const leaders = state.playerOrder.filter(id => lengths[id] === max);
    if (was && lengths[was] === max) holder = was;         // a tie never takes it from you
    else if (leaders.length === 1)   holder = leaders[0];  // a tie among others leaves it unclaimed
  }
  state.longestRoad = { holder, length: holder ? max : 0 };
  state.roadLengths = lengths;

  if (holder !== was && holder) log(state, `${nameOf(state, holder)} takes Longest Road (${max}).`);
  else if (holder !== was)      log(state, 'Longest Road is up for grabs again.');
}

function updateLargestArmy(state, pid) {
  const size = state.players[pid].knights;
  if (size >= LARGEST_ARMY_MIN && size > state.largestArmy.size && state.largestArmy.holder !== pid) {
    state.largestArmy = { holder: pid, size };
    log(state, `${nameOf(state, pid)} takes Largest Army (${size} knights).`);
  } else if (state.largestArmy.holder === pid) {
    state.largestArmy.size = size;
  }
}

// Ten points on your own turn wins on the spot.
function checkWin(state, pid) {
  if (state.phase !== 'playing' || currentPlayerId(state) !== pid) return;
  if (pointsOf(state, pid) < WIN_POINTS) return;
  state.phase     = 'gameover';
  state.turnStage = 'gameover';
  state.winner    = pid;
  state.winners   = [pid];
  state.endReason = 'victory';
  state.trade     = null;
  log(state, `${nameOf(state, pid)} wins with ${pointsOf(state, pid)} points!`);
}

// ── Turn plumbing ────────────────────────────────────────────

function requireCurrent(state, pid) {
  if (state.phase === 'gameover') throw new Error('The game is over.');
  if (state.phase !== 'playing')  throw new Error('Setup is still going on.');
  if (currentPlayerId(state) !== pid) throw new Error("It's not your turn.");
}

function requireStage(state, ...stages) {
  if (!stages.includes(state.turnStage)) throw new Error("You can't do that right now.");
}

function spend(state, player, cost) {
  for (const [r, n] of Object.entries(cost)) {
    player.resources[r] -= n;
    state.bank[r] += n;
  }
}

function setupPlayerId(state) {
  return state.setup.seq[state.setup.index];
}

function beginPlay(state) {
  state.phase              = 'playing';
  state.turnStage          = 'roll';
  state.currentPlayerIndex = 0;
  state.turnNumber         = 1;
  state.setup              = null;
  log(state, `${nameOf(state, currentPlayerId(state))} goes first.`);
}

// ── Building ─────────────────────────────────────────────────

export function buildSettlement(prev, pid, vertex) {
  const state = clone(prev);
  const player = state.players[pid];
  const v = TOPOLOGY.vertices[vertex];
  if (!v) throw new Error('No such spot.');

  if (state.phase === 'setup') {
    if (setupPlayerId(state) !== pid) throw new Error("It's not your turn.");
    if (state.setup.placed !== null)  throw new Error('Now place a road next to your settlement.');
    if (!legalSettlementVertices(state, pid, { setup: true }).includes(vertex)) {
      throw new Error("You can't build there — settlements need a gap of two roads.");
    }
    state.buildings[vertex] = { owner: pid, type: 'settlement' };
    player.pieces.settlement--;
    state.setup.placed = vertex;
    log(state, `${nameOf(state, pid)} placed a settlement.`);

    // The second settlement pays out one card for each resource hex around it.
    if (state.setup.index >= state.playerOrder.length) {
      const got = emptyHand();
      for (const hexId of v.hexes) {
        const res = state.hexes[hexId].resource;
        if (res && state.bank[res] > 0) { player.resources[res]++; state.bank[res]--; got[res]++; }
      }
      if (handSize(got)) log(state, `${nameOf(state, pid)} collected ${describe(got)}.`);
    }
    return state;
  }

  requireCurrent(state, pid);
  requireStage(state, 'main');
  if (player.pieces.settlement < 1) throw new Error('You have no settlements left.');
  if (!canPay(player.resources, COSTS.settlement)) throw new Error("You can't afford a settlement.");
  if (!legalSettlementVertices(state, pid).includes(vertex)) {
    throw new Error('Settlements must connect to your road, with a gap of two roads from any other.');
  }

  spend(state, player, COSTS.settlement);
  state.buildings[vertex] = { owner: pid, type: 'settlement' };
  player.pieces.settlement--;
  log(state, `${nameOf(state, pid)} built a settlement.`);
  updateLongestRoad(state);          // it may have cut someone's road
  checkWin(state, pid);
  return state;
}

export function buildCity(prev, pid, vertex) {
  const state = clone(prev);
  requireCurrent(state, pid);
  requireStage(state, 'main');
  const player = state.players[pid];
  const b = state.buildings[vertex];
  if (!b || b.owner !== pid || b.type !== 'settlement') throw new Error('Cities upgrade one of your settlements.');
  if (player.pieces.city < 1) throw new Error('You have no cities left.');
  if (!canPay(player.resources, COSTS.city)) throw new Error("You can't afford a city.");

  spend(state, player, COSTS.city);
  b.type = 'city';
  player.pieces.city--;
  player.pieces.settlement++;
  log(state, `${nameOf(state, pid)} upgraded to a city.`);
  checkWin(state, pid);
  return state;
}

export function buildRoad(prev, pid, edge) {
  const state = clone(prev);
  const player = state.players[pid];
  if (!TOPOLOGY.edges[edge]) throw new Error('No such road.');

  if (state.phase === 'setup') {
    if (setupPlayerId(state) !== pid)  throw new Error("It's not your turn.");
    if (state.setup.placed === null)   throw new Error('Place a settlement first.');
    if (!legalRoadEdges(state, pid, { from: state.setup.placed }).includes(edge)) {
      throw new Error('The road has to touch the settlement you just placed.');
    }
    state.roads[edge] = pid;
    player.pieces.road--;
    state.setup.placed = null;
    state.setup.index++;
    log(state, `${nameOf(state, pid)} placed a road.`);
    if (state.setup.index >= state.setup.seq.length) beginPlay(state);
    else state.currentPlayerIndex = state.playerOrder.indexOf(setupPlayerId(state));
    return state;
  }

  requireCurrent(state, pid);
  requireStage(state, 'main', 'roadBuilding');
  const free = state.turnStage === 'roadBuilding';
  if (player.pieces.road < 1) throw new Error('You have no roads left.');
  if (!free && !canPay(player.resources, COSTS.road)) throw new Error("You can't afford a road.");
  if (!legalRoadEdges(state, pid).includes(edge)) throw new Error('Roads must connect to your own roads or buildings.');

  if (!free) spend(state, player, COSTS.road);
  state.roads[edge] = pid;
  player.pieces.road--;
  log(state, `${nameOf(state, pid)} built a road${free ? ' for free' : ''}.`);

  if (free) {
    state.freeRoads--;
    if (state.freeRoads <= 0 || player.pieces.road < 1 || !legalRoadEdges(state, pid).length) {
      state.turnStage = state.resume;
      state.freeRoads = 0;
    }
  }
  updateLongestRoad(state);
  checkWin(state, pid);
  return state;
}

// ── Dice, the robber and discarding ──────────────────────────

function collect(state, roll) {
  const owed = Object.fromEntries(RESOURCES.map(r => [r, {}]));
  for (const hex of state.hexes) {
    if (hex.num !== roll || hex.id === state.robber || !hex.resource) continue;
    for (const vid of TOPOLOGY.hexes[hex.id].vertices) {
      const b = state.buildings[vid];
      if (!b) continue;
      owed[hex.resource][b.owner] = (owed[hex.resource][b.owner] ?? 0) + (b.type === 'city' ? 2 : 1);
    }
  }

  const gains = {};
  for (const res of RESOURCES) {
    const owners = Object.keys(owed[res]);
    const total  = owners.reduce((n, id) => n + owed[res][id], 0);
    if (!total) continue;
    // An undersupplied bank pays a lone recipient what is left, and nobody at
    // all when several players are owed.
    if (total > state.bank[res] && owners.length > 1) {
      log(state, `The bank doesn't have enough ${RESOURCE_NAMES[res].toLowerCase()} — nobody collects it.`);
      continue;
    }
    for (const id of owners) {
      const n = Math.min(owed[res][id], state.bank[res]);
      if (!n) continue;
      state.players[id].resources[res] += n;
      state.bank[res] -= n;
      (gains[id] ??= emptyHand())[res] += n;
    }
  }
  for (const [id, got] of Object.entries(gains)) {
    log(state, `${nameOf(state, id)} collected ${describe(got)}.`);
  }
  if (!Object.keys(gains).length) log(state, 'Nobody collected anything.');
  state.lastGains = gains;
}

export function roll(prev, pid, forced = null) {
  const state = clone(prev);
  requireCurrent(state, pid);
  requireStage(state, 'roll');

  const dice = forced ?? [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)];
  const total = dice[0] + dice[1];
  state.dice = dice;
  log(state, `${nameOf(state, pid)} rolled ${total}.`);

  if (total !== 7) {
    collect(state, total);
    state.turnStage = 'main';
    return state;
  }

  state.lastGains = null;
  state.discarding = {};
  for (const id of state.playerOrder) {
    const n = handSize(state.players[id].resources);
    if (n > HAND_LIMIT) state.discarding[id] = Math.floor(n / 2);
  }
  state.afterRobber = 'main';
  state.turnStage   = Object.keys(state.discarding).length ? 'discard' : 'robber';
  return state;
}

export function discard(prev, pid, cards) {
  const state = clone(prev);
  if (state.turnStage !== 'discard' || state.discarding[pid] === undefined) {
    throw new Error("You don't have to discard.");
  }
  const player = state.players[pid];
  const need = state.discarding[pid];
  let total = 0;
  for (const r of RESOURCES) {
    const n = cards?.[r] ?? 0;
    if (!Number.isInteger(n) || n < 0) throw new Error('Invalid discard.');
    if (n > player.resources[r]) throw new Error("You don't have those cards.");
    total += n;
  }
  if (total !== need) throw new Error(`Discard exactly ${need} cards.`);

  for (const r of RESOURCES) {
    player.resources[r] -= cards[r] ?? 0;
    state.bank[r]       += cards[r] ?? 0;
  }
  delete state.discarding[pid];
  log(state, `${nameOf(state, pid)} discarded ${need} cards.`);
  if (!Object.keys(state.discarding).length) state.turnStage = 'robber';
  return state;
}

export function robberVictims(state, hexId, pid) {
  const victims = new Set();
  for (const vid of TOPOLOGY.hexes[hexId].vertices) {
    const b = state.buildings[vid];
    if (b && b.owner !== pid && handSize(state.players[b.owner].resources) > 0) victims.add(b.owner);
  }
  return [...victims];
}

function stealFrom(state, thief, victim) {
  const pool = RESOURCES.flatMap(r => Array(state.players[victim].resources[r]).fill(r));
  const res = pool[Math.floor(Math.random() * pool.length)];
  state.players[victim].resources[res]--;
  state.players[thief].resources[res]++;
  log(state, `${nameOf(state, thief)} stole a card from ${nameOf(state, victim)}.`);
}

function finishRobber(state) {
  state.turnStage = state.afterRobber;
  state.stealFrom = [];
}

export function moveRobber(prev, pid, hexId) {
  const state = clone(prev);
  requireCurrent(state, pid);
  requireStage(state, 'robber');
  if (!state.hexes[hexId]) throw new Error('No such tile.');
  if (hexId === state.robber) throw new Error('The robber has to move to a different tile.');

  state.robber = hexId;
  log(state, `${nameOf(state, pid)} moved the robber.`);

  const victims = robberVictims(state, hexId, pid);
  if (victims.length === 0) finishRobber(state);
  else if (victims.length === 1) { stealFrom(state, pid, victims[0]); finishRobber(state); }
  else { state.stealFrom = victims; state.turnStage = 'steal'; }
  checkWin(state, pid);
  return state;
}

export function steal(prev, pid, victim) {
  const state = clone(prev);
  requireCurrent(state, pid);
  requireStage(state, 'steal');
  if (!state.stealFrom.includes(victim)) throw new Error("You can't rob that player.");
  stealFrom(state, pid, victim);
  finishRobber(state);
  return state;
}

// ── Development cards ────────────────────────────────────────

export function buyDevCard(prev, pid) {
  const state = clone(prev);
  requireCurrent(state, pid);
  requireStage(state, 'main');
  const player = state.players[pid];
  if (!state.devDeck.length) throw new Error('No development cards left.');
  if (!canPay(player.resources, COSTS.dev)) throw new Error("You can't afford a development card.");

  spend(state, player, COSTS.dev);
  const card = state.devDeck.shift();
  player.devCards.push({ ...card, turn: state.turnNumber });
  log(state, `${nameOf(state, pid)} bought a development card.`);
  checkWin(state, pid);
  return state;
}

// `options` carries the card's choices: `resources` ([a, b]) for Year of
// Plenty, `resource` for Monopoly.
export function playDevCard(prev, pid, type, options = {}) {
  const state = clone(prev);
  requireCurrent(state, pid);
  requireStage(state, 'roll', 'main');
  if (type === 'victoryPoint') throw new Error('Victory Point cards count themselves.');
  if (state.devPlayed) throw new Error('One development card per turn.');

  const player = state.players[pid];
  const idx = player.devCards.findIndex(c => c.type === type && c.turn !== state.turnNumber);
  if (idx < 0) {
    const fresh = player.devCards.some(c => c.type === type);
    throw new Error(fresh ? "You can't play a card the turn you bought it." : "You don't have that card.");
  }

  const stage = state.turnStage;
  const apply = {
    knight() {
      player.knights++;
      log(state, `${nameOf(state, pid)} played a Knight.`);
      updateLargestArmy(state, pid);
      state.afterRobber = stage;
      state.turnStage   = 'robber';
    },
    roadBuilding() {
      if (player.pieces.road < 1 || !legalRoadEdges(state, pid).length) throw new Error('You have nowhere to build a road.');
      log(state, `${nameOf(state, pid)} played Road Building.`);
      state.freeRoads = Math.min(2, player.pieces.road);
      state.resume    = stage;
      state.turnStage = 'roadBuilding';
    },
    yearOfPlenty() {
      const picks = options.resources;
      if (!Array.isArray(picks) || picks.length !== 2 || !picks.every(r => RESOURCES.includes(r))) {
        throw new Error('Pick two resources.');
      }
      const want = emptyHand();
      for (const r of picks) want[r]++;
      if (RESOURCES.some(r => want[r] > state.bank[r])) throw new Error("The bank doesn't have those.");
      for (const r of RESOURCES) { player.resources[r] += want[r]; state.bank[r] -= want[r]; }
      log(state, `${nameOf(state, pid)} played Year of Plenty and took ${describe(want)}.`);
    },
    monopoly() {
      const res = options.resource;
      if (!RESOURCES.includes(res)) throw new Error('Pick a resource.');
      let taken = 0;
      for (const id of state.playerOrder) {
        if (id === pid) continue;
        taken += state.players[id].resources[res];
        player.resources[res] += state.players[id].resources[res];
        state.players[id].resources[res] = 0;
      }
      log(state, `${nameOf(state, pid)} played Monopoly on ${RESOURCE_NAMES[res].toLowerCase()} and took ${taken}.`);
    },
  };
  if (!apply[type]) throw new Error('Unknown card.');

  apply[type]();
  player.devCards.splice(idx, 1);
  state.devPlayed = true;
  state.trade = null;
  checkWin(state, pid);
  return state;
}

// ── Trading ──────────────────────────────────────────────────

export function bankTrade(prev, pid, give, get) {
  const state = clone(prev);
  requireCurrent(state, pid);
  requireStage(state, 'main');
  if (!RESOURCES.includes(give) || !RESOURCES.includes(get) || give === get) throw new Error('Pick two different resources.');

  const player = state.players[pid];
  const ratio = tradeRatios(state, pid)[give];
  if (player.resources[give] < ratio) throw new Error(`You need ${ratio} ${RESOURCE_NAMES[give].toLowerCase()} for that.`);
  if (state.bank[get] < 1) throw new Error(`The bank is out of ${RESOURCE_NAMES[get].toLowerCase()}.`);

  player.resources[give] -= ratio;
  state.bank[give]       += ratio;
  player.resources[get]++;
  state.bank[get]--;
  log(state, `${nameOf(state, pid)} traded ${ratio} ${RESOURCE_NAMES[give].toLowerCase()} to the bank for 1 ${RESOURCE_NAMES[get].toLowerCase()}.`);
  return state;
}

function cleanCards(cards) {
  const out = {};
  for (const r of RESOURCES) {
    const n = cards?.[r] ?? 0;
    if (!Number.isInteger(n) || n < 0 || n > 19) throw new Error('Invalid trade.');
    if (n) out[r] = n;
  }
  return out;
}

export function offerTrade(prev, pid, give, want) {
  const state = clone(prev);
  requireCurrent(state, pid);
  requireStage(state, 'main');
  give = cleanCards(give);
  want = cleanCards(want);
  if (!Object.keys(give).length || !Object.keys(want).length) throw new Error('A trade needs cards on both sides.');
  if (Object.keys(give).some(r => r in want)) throw new Error("Don't trade a resource for itself.");
  if (!canPay(state.players[pid].resources, give)) throw new Error("You don't have the cards you're offering.");

  state.trade = { id: ++state.tradeSeq, from: pid, give, want, responses: {} };
  log(state, `${nameOf(state, pid)} offered ${describe(give)} for ${describe(want)}.`);
  return state;
}

export function respondTrade(prev, pid, accept) {
  const state = clone(prev);
  const t = state.trade;
  if (!t || state.turnStage !== 'main') throw new Error('There is no trade to answer.');
  if (pid === t.from) throw new Error("That's your own offer.");
  if (!state.players[pid]) throw new Error('Player not found.');
  if (accept && !canPay(state.players[pid].resources, t.want)) throw new Error("You don't have the cards they want.");
  t.responses[pid] = accept ? 'accept' : 'decline';
  return state;
}

export function confirmTrade(prev, pid, partner) {
  const state = clone(prev);
  requireCurrent(state, pid);
  const t = state.trade;
  if (!t || t.from !== pid) throw new Error('You have no open offer.');
  if (t.responses[partner] !== 'accept') throw new Error("They haven't accepted.");

  const me = state.players[pid];
  const them = state.players[partner];
  if (!canPay(me.resources, t.give) || !canPay(them.resources, t.want)) {
    state.trade = null;
    throw new Error('The cards have changed — the offer is off.');
  }
  for (const [r, n] of Object.entries(t.give)) { me.resources[r] -= n; them.resources[r] += n; }
  for (const [r, n] of Object.entries(t.want)) { them.resources[r] -= n; me.resources[r] += n; }
  log(state, `${nameOf(state, pid)} traded ${describe(t.give)} to ${nameOf(state, partner)} for ${describe(t.want)}.`);
  state.trade = null;
  return state;
}

export function cancelTrade(prev, pid) {
  const state = clone(prev);
  requireCurrent(state, pid);
  state.trade = null;
  return state;
}

// ── Ending a turn ────────────────────────────────────────────

function advanceTurn(state) {
  state.currentPlayerIndex = (state.currentPlayerIndex + 1) % state.playerOrder.length;
  state.turnNumber++;
  state.turnStage = 'roll';
  state.dice      = null;
  state.devPlayed = false;
  state.trade     = null;
  state.lastGains = null;
}

export function endTurn(prev, pid) {
  const state = clone(prev);
  requireCurrent(state, pid);
  requireStage(state, 'main');
  advanceTurn(state);
  return state;
}

// ── Leaving ──────────────────────────────────────────────────

export function resignGame(prev, playerId) {
  const state = clone(prev);
  if (state.phase === 'gameover') return state;
  const leaving = state.players[playerId];
  if (!leaving) throw new Error('Player not found.');

  log(state, `${nameOf(state, playerId)} resigned.`);

  // Their cards go back to the bank, and their pieces off the board.
  for (const r of RESOURCES) state.bank[r] += leaving.resources[r];
  for (const [vid, b] of Object.entries(state.buildings)) if (b.owner === playerId) delete state.buildings[vid];
  for (const [eid, o] of Object.entries(state.roads)) if (o === playerId) delete state.roads[eid];

  const idx        = state.playerOrder.indexOf(playerId);
  const wasCurrent = state.currentPlayerIndex === idx;
  const lastSeat   = idx === state.playerOrder.length - 1;

  state.playerOrder = state.playerOrder.filter(id => id !== playerId);
  delete state.players[playerId];

  if (state.playerOrder.length < MIN_PLAYERS) {
    state.winner    = state.playerOrder[0] ?? null;
    state.winners   = state.winner ? [state.winner] : [];
    state.phase     = 'gameover';
    state.turnStage = 'gameover';
    state.endReason = 'resignation';
    state.trade     = null;
    return state;
  }

  if (state.longestRoad.holder === playerId) state.longestRoad = { holder: null, length: 0 };
  if (state.largestArmy.holder === playerId) state.largestArmy = { holder: null, size: 0 };

  if (state.phase === 'setup') {
    const s = state.setup;
    const before  = s.seq.slice(0, s.index).filter(id => id === playerId).length;
    const wasNext = s.seq[s.index] === playerId;
    s.seq   = s.seq.filter(id => id !== playerId);
    s.index -= before;
    if (wasNext) s.placed = null;
    if (s.index >= s.seq.length) beginPlay(state);
    else state.currentPlayerIndex = state.playerOrder.indexOf(s.seq[s.index]);
  } else {
    updateLongestRoad(state);
    delete state.discarding[playerId];
    state.stealFrom = state.stealFrom.filter(id => id !== playerId);
    if (state.trade?.from === playerId) state.trade = null;
    else if (state.trade) delete state.trade.responses[playerId];

    if (wasCurrent) {
      // The next player is now sitting at the same index (or wraps to the first).
      state.currentPlayerIndex = lastSeat ? 0 : idx;
      state.turnNumber++;
      state.turnStage = 'roll';
      state.dice      = null;
      state.devPlayed = false;
      state.trade     = null;
      state.discarding = {};
      state.stealFrom  = [];
      state.freeRoads  = 0;
    } else {
      if (idx < state.currentPlayerIndex) state.currentPlayerIndex--;
      if (state.turnStage === 'discard' && !Object.keys(state.discarding).length) state.turnStage = 'robber';
      if (state.turnStage === 'steal' && !state.stealFrom.length) finishRobber(state);
    }
  }
  state.currentPlayerIndex %= state.playerOrder.length;
  return state;
}
