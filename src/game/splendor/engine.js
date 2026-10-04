// ============================================================
// SPLENDOR — game engine
//
// Pure state transitions: every exported function takes a state and returns
// the next state (mutating a structuredClone of it), or throws with a message
// that is safe to show the player.
//
// A turn is one action — take gems, reserve a card or buy a card — followed by
// whatever that action makes necessary: handing gems back down to ten, and
// choosing a noble when more than one comes to visit. `turnStage` tracks where
// in that sequence the current player is.
// ============================================================

import { COLORS, COLOR_NAMES, DECKS, NOBLES } from './cards.js';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;

export const GEM_LIMIT      = 10;
export const RESERVE_LIMIT  = 3;
export const WIN_POINTS     = 15;
export const NOBLE_POINTS   = 3;
export const MARKET_SIZE    = 4;
const GOLD_COUNT            = 5;

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
const emptyGems = () => ({ w: 0, b: 0, g: 0, r: 0, k: 0, gold: 0 });

// Seven of each colour at every table size. (The printed rules scale this down
// to 4 and 5 for two and three players; this table plays with the full set.)
export function gemsPerColor() {
  return 7;
}

export function totalGems(gems) {
  return COLORS.reduce((n, c) => n + gems[c], gems.gold);
}

// ── Reading a player ─────────────────────────────────────────

// The discount each owned card gives: one gem off per card of that colour.
export function bonusesOf(state, player) {
  const bonus = { w: 0, b: 0, g: 0, r: 0, k: 0 };
  for (const card of player.cards) bonus[card.bonus]++;
  return bonus;
}

export function scoreOf(player) {
  return player.cards.reduce((n, c) => n + c.points, 0) + player.nobles.length * NOBLE_POINTS;
}

// What buying a card would cost this player right now — discounts applied,
// then coloured gems, then gold for whatever is still short — or null when
// they can't afford it.
export function paymentFor(player, card) {
  const bonus = { w: 0, b: 0, g: 0, r: 0, k: 0 };
  for (const c of player.cards) bonus[c.bonus]++;

  const pay = emptyGems();
  let goldNeeded = 0;
  for (const color of COLORS) {
    const owed = Math.max(0, card.cost[color] - bonus[color]);
    pay[color] = Math.min(owed, player.gems[color]);
    goldNeeded += owed - pay[color];
  }
  if (goldNeeded > player.gems.gold) return null;
  pay.gold = goldNeeded;
  return pay;
}

export const canAfford = (player, card) => paymentFor(player, card) !== null;

// ── Setting up ───────────────────────────────────────────────

export function createGame(playerIds) {
  if (playerIds.length < MIN_PLAYERS) throw new Error('Need at least 2 players.');
  if (playerIds.length > MAX_PLAYERS) throw new Error('Splendor supports up to 4 players.');

  const order = shuffle(playerIds);
  const per   = gemsPerColor();

  const decks  = { 1: shuffle(DECKS[1]), 2: shuffle(DECKS[2]), 3: shuffle(DECKS[3]) };
  const market = { 1: [], 2: [], 3: [] };
  for (const level of [1, 2, 3]) {
    for (let i = 0; i < MARKET_SIZE; i++) market[level].push(decks[level].shift() ?? null);
  }

  const players = {};
  for (const id of order) {
    players[id] = { gems: emptyGems(), cards: [], reserved: [], nobles: [], points: 0 };
  }

  const state = {
    gameType:    'splendor',
    playerOrder: order,
    playerNames: Object.fromEntries(order.map(id => [id, id])),
    players,
    bank:    { w: per, b: per, g: per, r: per, k: per, gold: GOLD_COUNT },
    market,
    decks,
    nobles:  shuffle(NOBLES).slice(0, order.length + 1),
    currentPlayerIndex: 0,
    turnStage:   'action',          // action → returnGems → chooseNoble
    finalRound:  false,             // someone has reached 15; finish the round
    phase:       'playing',
    winner:      null,
    winners:     [],
    endReason:   null,
    turnCount:   0,
    log:         [],
  };

  log(state, `Game started. ${order.length} players, ${state.nobles.length} nobles. First to ${WIN_POINTS} points.`);
  return state;
}

// ── Guards ───────────────────────────────────────────────────

function requireTurn(state, playerId, stage = 'action') {
  if (state.phase !== 'playing')                              throw new Error('The game is over.');
  if (state.playerOrder[state.currentPlayerIndex] !== playerId) throw new Error("It isn't your turn.");
  if (state.turnStage !== stage) {
    throw new Error(
      state.turnStage === 'returnGems'  ? 'You have too many gems — return some first.'
      : state.turnStage === 'chooseNoble' ? 'Choose a noble first.'
      : 'That move is not available right now.');
  }
}

// ── Actions ──────────────────────────────────────────────────

// Three different gems, or two of one colour when that pile still has four.
// With fewer than three colours on the table you may take fewer.
export function takeGems(prev, playerId, colors) {
  const state = clone(prev);
  requireTurn(state, playerId);

  if (!Array.isArray(colors) || colors.length === 0) throw new Error('Pick some gems to take.');
  if (colors.some(c => !COLORS.includes(c)))         throw new Error('You can only take coloured gems.');

  const player = state.players[playerId];
  const unique = [...new Set(colors)];

  if (colors.length === 2 && unique.length === 1) {
    const c = unique[0];
    if (state.bank[c] < 4) throw new Error(`Taking two ${COLOR_NAMES[c].toLowerCase()} gems needs four in the pile.`);
  } else {
    if (unique.length !== colors.length) throw new Error('Take three different gems, or two of the same colour.');
    if (colors.length > 3)               throw new Error('You can take at most three gems.');
    if (unique.some(c => state.bank[c] < 1)) throw new Error('That pile is empty.');
    const available = COLORS.filter(c => state.bank[c] > 0).length;
    if (colors.length < Math.min(3, available)) {
      throw new Error('Take three different gems while there are three colours to take.');
    }
  }

  for (const c of colors) { state.bank[c]--; player.gems[c]++; }

  log(state, `${nameOf(state, playerId)} took ${describeGems(colors)}.`);
  return afterAction(state, playerId);
}

// Reserve a face-up card (`{ level, index }`) or the top of a deck
// (`{ level, deck: true }`), and take a gold gem for it if any is left.
export function reserveCard(prev, playerId, target) {
  const state = clone(prev);
  requireTurn(state, playerId);

  const player = state.players[playerId];
  if (player.reserved.length >= RESERVE_LIMIT) throw new Error('You can only reserve three cards.');

  const level = Number(target?.level);
  if (![1, 2, 3].includes(level)) throw new Error('Unknown card.');

  let card;
  let blind = false;
  if (target.deck) {
    if (state.decks[level].length === 0) throw new Error('That deck is empty.');
    card  = state.decks[level].shift();
    blind = true;
  } else {
    card = state.market[level][target.index];
    if (!card) throw new Error('There is no card there.');
    refill(state, level, target.index);
  }

  player.reserved.push({ ...card, blind });
  if (state.bank.gold > 0) { state.bank.gold--; player.gems.gold++; }

  log(state, blind
    ? `${nameOf(state, playerId)} reserved a level ${level} card from the deck.`
    : `${nameOf(state, playerId)} reserved a level ${level} ${COLOR_NAMES[card.bonus].toLowerCase()} card.`);
  return afterAction(state, playerId);
}

// Buy a face-up card (`{ level, index }`) or one of your reserved cards
// (`{ reservedId }`).
export function buyCard(prev, playerId, target) {
  const state = clone(prev);
  requireTurn(state, playerId);

  const player = state.players[playerId];
  let card;

  if (target?.reservedId) {
    const i = player.reserved.findIndex(c => c.id === target.reservedId);
    if (i === -1) throw new Error('You have not reserved that card.');
    card = player.reserved[i];
  } else {
    const level = Number(target?.level);
    if (![1, 2, 3].includes(level)) throw new Error('Unknown card.');
    card = state.market[level][target.index];
    if (!card) throw new Error('There is no card there.');
  }

  const pay = paymentFor(player, card);
  if (!pay) throw new Error("You can't afford that card.");

  for (const c of [...COLORS, 'gold']) {
    player.gems[c] -= pay[c];
    state.bank[c]  += pay[c];
  }

  if (target?.reservedId) {
    player.reserved = player.reserved.filter(c => c.id !== card.id);
  } else {
    refill(state, card.level, target.index);
  }

  const owned = { ...card };
  delete owned.blind;
  player.cards.push(owned);

  log(state, `${nameOf(state, playerId)} bought a level ${card.level} ${COLOR_NAMES[card.bonus].toLowerCase()} card` +
    (card.points ? ` (${card.points} point${card.points === 1 ? '' : 's'}).` : '.'));
  return afterAction(state, playerId);
}

// Put gems back until the player is down to ten.
export function returnGems(prev, playerId, gems) {
  const state = clone(prev);
  requireTurn(state, playerId, 'returnGems');

  const player = state.players[playerId];
  const excess = totalGems(player.gems) - GEM_LIMIT;

  let count = 0;
  for (const c of [...COLORS, 'gold']) {
    const n = Math.floor(Number(gems?.[c] ?? 0));
    if (n < 0 || n > player.gems[c]) throw new Error("You don't have those gems.");
    count += n;
  }
  if (count !== excess) throw new Error(`Return exactly ${excess} gem${excess === 1 ? '' : 's'}.`);

  for (const c of [...COLORS, 'gold']) {
    const n = Math.floor(Number(gems?.[c] ?? 0));
    player.gems[c] -= n;
    state.bank[c]  += n;
  }

  log(state, `${nameOf(state, playerId)} returned ${count} gem${count === 1 ? '' : 's'}.`);
  return afterGems(state, playerId);
}

export function chooseNoble(prev, playerId, nobleId) {
  const state = clone(prev);
  requireTurn(state, playerId, 'chooseNoble');

  const options = eligibleNobles(state, playerId);
  if (!options.some(n => n.id === nobleId)) throw new Error('That noble cannot visit you.');

  takeNoble(state, playerId, nobleId);
  return endTurn(state, playerId);
}

// The only way to move when there is nothing legal to do — every pile empty
// and no card you can buy or reserve.
export function passTurn(prev, playerId) {
  const state = clone(prev);
  requireTurn(state, playerId);
  if (legalMoves(state, playerId).length > 0) throw new Error('You still have a move to make.');
  log(state, `${nameOf(state, playerId)} had no move and passed.`);
  return endTurn(state, playerId);
}

// ── Turn flow ────────────────────────────────────────────────

function afterAction(state, playerId) {
  const player = state.players[playerId];
  if (totalGems(player.gems) > GEM_LIMIT) {
    state.turnStage = 'returnGems';
    return state;
  }
  return afterGems(state, playerId);
}

function afterGems(state, playerId) {
  const visiting = eligibleNobles(state, playerId);
  if (visiting.length === 0) return endTurn(state, playerId);
  if (visiting.length === 1) {
    takeNoble(state, playerId, visiting[0].id);
    return endTurn(state, playerId);
  }
  state.turnStage = 'chooseNoble';
  return state;
}

export function eligibleNobles(state, playerId) {
  const bonus = bonusesOf(state, state.players[playerId]);
  return state.nobles.filter(n => COLORS.every(c => bonus[c] >= n.req[c]));
}

function takeNoble(state, playerId, nobleId) {
  const i = state.nobles.findIndex(n => n.id === nobleId);
  const [noble] = state.nobles.splice(i, 1);
  state.players[playerId].nobles.push(noble);
  log(state, `A noble visited ${nameOf(state, playerId)} (+${NOBLE_POINTS} points).`);
}

function endTurn(state, playerId) {
  const player = state.players[playerId];
  player.points = scoreOf(player);
  state.turnStage = 'action';
  state.turnCount++;

  if (player.points >= WIN_POINTS && !state.finalRound) {
    state.finalRound = true;
    log(state, `${nameOf(state, playerId)} reached ${player.points} points — everyone gets one more turn.`);
  }

  const next = (state.currentPlayerIndex + 1) % state.playerOrder.length;
  // The round ends when play comes back round to whoever opened it, so every
  // player has had the same number of turns.
  if (state.finalRound && next === 0) return finish(state, 'points');

  state.currentPlayerIndex = next;
  return state;
}

function finish(state, reason) {
  state.phase     = 'gameover';
  state.endReason = reason;

  // Most points wins; fewer purchased cards breaks a tie; anything left is shared.
  const ranked = state.playerOrder
    .map(id => ({ id, points: scoreOf(state.players[id]), cards: state.players[id].cards.length }))
    .sort((a, b) => b.points - a.points || a.cards - b.cards);

  const best = ranked[0];
  state.winners = ranked.filter(r => r.points === best.points && r.cards === best.cards).map(r => r.id);
  state.winner  = state.winners[0] ?? null;
  state.standings = ranked;

  log(state, `${nameOf(state, state.winner)} wins with ${best.points} points!`);
  return state;
}

// Slide a fresh card into a market slot from its deck (or leave it empty when
// the deck has run out).
function refill(state, level, index) {
  state.market[level][index] = state.decks[level].shift() ?? null;
}

function describeGems(colors) {
  return colors.map(c => COLOR_NAMES[c].toLowerCase()).join(', ');
}

// ── What can be done ─────────────────────────────────────────

// Every move the player could make this turn, in the shape the socket events
// take. Used to detect a stuck table and to give the bots a safe fallback.
export function legalMoves(state, playerId) {
  const player = state.players[playerId];
  if (!player || state.phase !== 'playing') return [];
  const moves = [];

  // Buying
  for (const level of [1, 2, 3]) {
    state.market[level].forEach((card, index) => {
      if (card && canAfford(player, card)) moves.push({ type: 'buy', level, index });
    });
  }
  for (const card of player.reserved) {
    if (canAfford(player, card)) moves.push({ type: 'buy', reservedId: card.id });
  }

  // Taking gems
  const open = COLORS.filter(c => state.bank[c] > 0);
  const size = Math.min(3, open.length);
  if (size > 0) {
    const combos = (from, n) => n === 0 ? [[]]
      : from.flatMap((c, i) => combos(from.slice(i + 1), n - 1).map(rest => [c, ...rest]));
    for (const colors of combos(open, size)) moves.push({ type: 'take', colors });
  }
  for (const c of COLORS) {
    if (state.bank[c] >= 4) moves.push({ type: 'take', colors: [c, c] });
  }

  // Reserving
  if (player.reserved.length < RESERVE_LIMIT) {
    for (const level of [1, 2, 3]) {
      state.market[level].forEach((card, index) => {
        if (card) moves.push({ type: 'reserve', level, index });
      });
      if (state.decks[level].length > 0) moves.push({ type: 'reserve', level, deck: true });
    }
  }

  return moves;
}

// ── Leaving ──────────────────────────────────────────────────

export function resignGame(prev, playerId) {
  const state = clone(prev);
  if (state.phase === 'gameover') return state;
  const leaving = state.players[playerId];
  if (!leaving) throw new Error('Player not found.');

  const idx        = state.playerOrder.indexOf(playerId);
  const wasCurrent = state.currentPlayerIndex === idx;
  const lastSeat   = idx === state.playerOrder.length - 1;

  log(state, `${nameOf(state, playerId)} resigned.`);

  // Their gems go back in the bank; their cards and reserves leave the game.
  for (const c of [...COLORS, 'gold']) state.bank[c] += leaving.gems[c];
  state.playerOrder = state.playerOrder.filter(id => id !== playerId);
  delete state.players[playerId];

  if (state.playerOrder.length < MIN_PLAYERS) {
    state.winner    = state.playerOrder[0] ?? null;
    state.winners   = state.winner ? [state.winner] : [];
    state.phase     = 'gameover';
    state.endReason = 'resignation';
    return state;
  }

  const n = state.playerOrder.length;
  if (wasCurrent) {
    state.turnStage = 'action';
    // The next player is now sitting at the same index — unless the one who
    // left was last, in which case play wraps to the first seat (and ends the
    // round, if it was the final one).
    state.currentPlayerIndex = lastSeat ? 0 : idx;
    if (lastSeat && state.finalRound) return finish(state, 'points');
  } else if (idx < state.currentPlayerIndex) {
    state.currentPlayerIndex--;
  }
  state.currentPlayerIndex %= n;
  return state;
}
