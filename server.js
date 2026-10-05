// ============================================================
// Socket.IO Game Server — Property Deal, Mah Jong & Splendor
// Run with: node server.js
// ============================================================

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';

import {
  createGame, createGameDebug, drawForTurn, playCard,
  respondToAction, moveWildcard, endTurn, pendingResponders,
  resignGame, getCurrentPlayer, checkWin,
} from './src/game/engine.js';
import { FULL_DECK } from './src/game/cards.js';
import * as mj from './src/game/mahjong/engine.js';
import * as sp from './src/game/splendor/engine.js';
import { BOT_NAMES, getBotMove, getBotResponse, getBotDiscards, getBotWildcardOverflowMove } from './src/game/botAI.js';
import {
  BOT_NAMES as MJ_BOT_NAMES,
  getBotMove as getMahjongBotMove,
  getBotFallbackMove as getMahjongBotFallbackMove,
} from './src/game/mahjong/botAI.js';
import {
  BOT_NAMES as SP_BOT_NAMES,
  getBotMove as getSplendorBotMove,
  getBotFallbackMove as getSplendorBotFallbackMove,
} from './src/game/splendor/botAI.js';

// ============================================================
// SERVER SETUP
// ============================================================

const app  = express();
const http = createServer(app);

const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:5173', 'http://localhost:4173', 'https://property-deal-chi.vercel.app', 'https://banks-games.vercel.app'];

const io   = new Server(http, {
  cors: { origin: allowedOrigins, methods: ['GET', 'POST'] },
  // A phone that sleeps for a moment, or a flaky mobile connection, used to
  // cost the player their socket. Ping a little less often, wait a little
  // longer for the answer, and let Socket.IO restore the session outright if
  // the client comes back within a couple of minutes.
  pingInterval: 20000,
  pingTimeout:  30000,
  connectionStateRecovery: { maxDisconnectionDuration: 2 * 60 * 1000 },
});

// A bug in one room must never take down every other table. Nothing here is
// worth exiting for: log it and keep serving.
process.on('uncaughtException',  err => console.error('Uncaught exception:', err));
process.on('unhandledRejection', err => console.error('Unhandled rejection:', err));

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3001;

// ============================================================
// IN-MEMORY GAME STORE
// ============================================================

const rooms    = {};
const CARD_MAP = Object.fromEntries(FULL_DECK.map(c => [c.id, c]));

// How long a room is kept alive with nobody connected to it, so a player who
// drops out mid-game can come back to the same board. Rooms used to be kept
// for ever: every abandoned game stayed in memory with its bots still playing
// it out, and the server got slower and heavier with every game started.
const ROOM_GRACE_MS   = 5 * 60 * 1000;
const ROOM_SWEEP_MS   = 60 * 1000;
const LOBBY_GRACE_MS  = 30 * 1000;

function closeRoom(room, why) {
  if (room.botTimeout) clearTimeout(room.botTimeout);
  room.botTimeout = null;
  delete rooms[room.roomCode];
  console.log(`Room ${room.roomCode} closed (${why})`);
}

// Drop rooms nobody has come back to, and rooms whose game has finished and
// emptied out.
function sweepRooms() {
  const now = Date.now();
  for (const room of Object.values(rooms)) {
    if (hasConnectedHuman(room)) { room.emptySince = null; continue; }
    room.emptySince ??= now;
    if (now - room.emptySince >= ROOM_GRACE_MS) closeRoom(room, 'nobody came back');
  }
}

setInterval(sweepRooms, ROOM_SWEEP_MS).unref?.();

// ============================================================
// HELPERS
// ============================================================

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

// ── Game types ───────────────────────────────────────────────

const GAME_TYPES = {
  property: { label: 'Property Deal', min: 2, max: 5, bots: true, botNames: BOT_NAMES    },
  mahjong:  { label: 'Mah Jong',      min: 2, max: 4, bots: true, botNames: MJ_BOT_NAMES },
  splendor: { label: 'Splendor',      min: 2, max: 4, bots: true, botNames: SP_BOT_NAMES },
};

function gameTypeOf(room) {
  return GAME_TYPES[room.gameType] ? room.gameType : 'property';
}

function isMahjong(room) {
  return gameTypeOf(room) === 'mahjong';
}

function isSplendor(room) {
  return gameTypeOf(room) === 'splendor';
}

function createGameFor(room, playerIds) {
  return isMahjong(room)  ? mj.createGame(playerIds)
       : isSplendor(room) ? sp.createGame(playerIds)
       : createGame(playerIds);
}

// Splendor is played in the open except for two things: the decks, which are
// only ever a count, and cards reserved blind from a deck, which only their
// owner may read.
function sanitizeSplendor(state, viewerId) {
  return {
    ...state,
    players: Object.fromEntries(
      Object.entries(state.players).map(([id, p]) => [id, {
        ...p,
        // The placeholder's id must not be the card's own, or it could be
        // looked up in the public card list.
        reserved: id === viewerId
          ? p.reserved
          : p.reserved.map((c, i) => c.blind
              ? { id: `hidden-${id}-${i}`, level: c.level, blind: true, hidden: true }
              : c),
      }])
    ),
    decks: Object.fromEntries(Object.entries(state.decks).map(([level, d]) => [level, d.length])),
  };
}

// Runs a Splendor engine call for the socket's player and pushes the result.
function applySplendor(socket, fn) {
  const room = getRoomBySocket(socket.id);
  if (!room?.gameState || !isSplendor(room)) return emitError(socket, 'No Splendor game in progress.');

  const player = getPlayerBySocket(room, socket.id);
  if (!player) return emitError(socket, 'Player not found.');

  try {
    applyMove(room, state => fn(state, player.id));
  } catch (err) {
    return emitError(socket, err.message);
  }

  broadcastGameState(room);
  emitSplendorGameOver(room);
  checkAndScheduleBotTurn(room);
}

function emitSplendorGameOver(room) {
  const state = room.gameState;
  if (state?.phase !== 'gameover' || room.gameOverSent) return;
  room.gameOverSent = true;
  const winner = room.players.find(p => p.id === state.winner);
  io.to(room.roomCode).emit('gameOver', {
    winnerId:   state.winner,
    winnerName: winner?.name ?? state.playerNames?.[state.winner] ?? null,
    winnerIds:  state.winners ?? [],
    reason:     state.endReason,
    standings:  state.playerOrder
      .map(id => ({
        id,
        name:   state.playerNames?.[id] ?? 'Player',
        points: sp.scoreOf(state.players[id]),
        cards:  state.players[id].cards.length,
      }))
      .sort((a, b) => b.points - a.points || a.cards - b.cards),
  });
}

// Mah Jong hands, marked win conditions and the wall are all private; strip
// everything the receiving player isn't entitled to see.
function sanitizeMahjong(state, viewerId) {
  return {
    ...state,
    players: Object.fromEntries(
      Object.entries(state.players).map(([id, p]) => [id, {
        ...p,
        hand: (id === viewerId || state.revealed)
          ? p.hand
          : p.hand.map((_, i) => ({ id: `hidden-${id}-${i}`, kind: 'hidden' })),
        markedHands:   id === viewerId ? p.markedHands   : [],
        passSelection: id === viewerId ? p.passSelection : [],
        justReceived:  id === viewerId ? p.justReceived  : [],
      }])
    ),
    wall: state.wall.length,
  };
}

// Runs a Mah Jong engine call for the socket's player and pushes the result.
function applyMahjong(socket, fn) {
  const room = getRoomBySocket(socket.id);
  if (!room?.gameState || !isMahjong(room)) return emitError(socket, 'No Mah Jong game in progress.');

  const player = getPlayerBySocket(room, socket.id);
  if (!player) return emitError(socket, 'Player not found.');

  try {
    applyMove(room, state => fn(state, player.id));
  } catch (err) {
    return emitError(socket, err.message);
  }

  broadcastGameState(room);
  emitMahjongGameOver(room);
  checkAndScheduleBotTurn(room);
}

// Property Deal ends either with a winner or — when the deck and discard run
// dry with nothing left to play — with nobody. Both need to reach the table.
function emitPropertyGameOver(room) {
  const state = room.gameState;
  if (!state) return false;
  if (state.phase !== 'gameover' && !state.winner) return false;
  if (room.gameOverSent) return true;

  room.gameOverSent = true;
  const winner = room.players.find(p => p.id === state.winner);
  io.to(room.roomCode).emit('gameOver', {
    winnerId:   state.winner ?? null,
    winnerName: winner?.name ?? state.playerNames?.[state.winner] ?? null,
    reason:     state.endReason ?? 'sets',
  });
  return true;
}

function emitMahjongGameOver(room) {
  const state = room.gameState;
  if (state?.phase !== 'gameover' || room.gameOverSent) return;
  room.gameOverSent = true;
  const winner = room.players.find(p => p.id === state.winner);
  io.to(room.roomCode).emit('gameOver', {
    winnerId:   state.winner,
    winnerName: winner?.name ?? state.playerNames?.[state.winner] ?? null,
    reason:     state.endReason,
    winningHands: state.winningHands ?? [],
  });
}

// Engine calls mutate the state they are handed, and they validate as they go:
// playing a property to the bank, say, takes the card out of your hand before
// it decides the move is illegal. Committing that half-applied state is how
// cards went missing from hands and the deck quietly drained. So every move
// runs against a copy, and the room only keeps it if the move came back
// without throwing.
function applyMove(room, fn) {
  const next = fn(structuredClone(room.gameState));
  if (next) room.gameState = next;
  return next ?? null;
}

function getRoomBySocket(socketId) {
  return Object.values(rooms).find(r =>
    r.players.some(p => p.socketId === socketId)
  );
}

function getPlayerBySocket(room, socketId) {
  return room?.players.find(p => p.socketId === socketId);
}

function broadcastGameState(room) {
  room.players.forEach(player => {
    const socket = io.sockets.sockets.get(player.socketId);
    if (!socket) return;

    const state = room.gameState;

    if (isMahjong(room)) {
      socket.emit('gameState', sanitizeMahjong(state, player.id));
      return;
    }
    if (isSplendor(room)) {
      socket.emit('gameState', sanitizeSplendor(state, player.id));
      return;
    }

    const sanitized = {
      ...state,
      players: Object.fromEntries(
        Object.entries(state.players).map(([id, p]) => [
          id,
          {
            ...p,
            hand: id === player.id
              ? p.hand
              : p.hand.map(() => ({ id: 'hidden', type: 'hidden' })),
          },
        ])
      ),
      deck: state.deck.length,
    };

    socket.emit('gameState', sanitized);
  });
}

function emitError(socket, message) {
  socket.emit('error', { message });
}

function updateRematchHost(room) {
  if (!room.rematchVotes || room.rematchVotes.size === 0) {
    room.rematchHostId = null;
    return;
  }
  const votes    = [...room.rematchVotes];
  const botCount = room.players.filter(p => p.isBot).length;
  // Bots auto-join rematches, so count them toward the "enough players" threshold.
  const totalParticipants = votes.length + botCount;

  // Original host voted + at least one other player (human or bot) → host gets priority
  if (room.hostId && votes.includes(room.hostId) && totalParticipants >= 2) {
    room.rematchHostId = room.hostId;
    return;
  }
  // 2+ human non-host voters (or 1 non-host voter + bots) → assign one randomly
  const nonHostVotes = votes.filter(id => id !== room.hostId);
  if (nonHostVotes.length + botCount >= 2) {
    if (room.rematchHostId && nonHostVotes.includes(room.rematchHostId)) return;
    room.rematchHostId = nonHostVotes[Math.floor(Math.random() * nonHostVotes.length)];
    return;
  }
  room.rematchHostId = null;
}

function broadcastRematchStatus(room) {
  updateRematchHost(room);
  io.to(room.roomCode).emit('rematchStatus', {
    votes:         [...(room.rematchVotes ?? new Set())],
    rematchHostId: room.rematchHostId ?? null,
  });
}

function emitRoomUpdate(room) {
  io.to(room.roomCode).emit('roomUpdate', {
    roomCode:  room.roomCode,
    players:   room.players.map(p => ({ id: p.id, name: p.name, isBot: p.isBot ?? false, connected: p.connected !== false })),
    hostId:    room.hostId,
    gameType:  gameTypeOf(room),
    maxPlayers: GAME_TYPES[gameTypeOf(room)].max,
    debugMode: room.debugMode ?? false,
    started:  room.started,
  });
}

// ============================================================
// BOT HELPERS
// ============================================================

const BOT_TURN_DELAY_MS     = 1400;
const BOT_RESPONSE_DELAY_MS = 1000;

function isBotPlayer(room, playerId) {
  return room.players.some(p => p.id === playerId && p.isBot);
}

// A table of nothing but bots — or one whose players have all dropped out —
// has nobody to play for, so it stops there.
function hasConnectedHuman(room) {
  return room.players.some(p => !p.isBot && p.connected !== false);
}

// Whoever the table is waiting on is decided by the engine; here we only ask
// whether that player is a bot we have to move for.
function getPendingBotResponder(room) {
  const botIds = new Set(room.players.filter(p => p.isBot).map(p => p.id));
  return pendingResponders(room.gameState).find(id => botIds.has(id)) ?? null;
}

// A bot step that throws used to take the whole server down: the AI calls sat
// outside every try/catch, inside a setTimeout, where an exception is fatal to
// the process and drops every player on every table. Nothing a bot does is
// worth that, so each step is wrapped, and a bot that cannot move gets its turn
// ended for it rather than being left to retry the same bad move forever.
function runBotStep(room, botId, what, step) {
  try {
    step();
    room.botFailures = 0;
  } catch (err) {
    room.botFailures = (room.botFailures ?? 0) + 1;
    console.error(`Bot ${botId} ${what} error (${room.botFailures}):`, err.message);
    if (!recoverStuckBot(room, botId)) return;   // table is beyond saving by us
  }

  broadcastGameState(room);
  if (!emitPropertyGameOver(room)) checkAndScheduleBotTurn(room);
}

// Last resort for a bot that cannot complete its move: end its turn, and if
// even that is impossible, take it out of the game. Either way the table keeps
// moving instead of freezing on a bot that will never act.
function recoverStuckBot(room, botId) {
  const state = room.gameState;

  // Owing an answer: take the plain one. Conceding beats leaving the whole
  // table waiting on a response that is never coming.
  if (state?.phase === 'responding' && pendingResponders(state).includes(botId)) {
    const conceding = state.pendingAction?.justSayNoBy ? 'acceptJustSayNo' : 'accept';
    try {
      applyMove(room, s => respondToAction(s, botId, conceding, {}));
      return true;
    } catch (err) {
      console.error(`Bot ${botId} could not concede:`, err.message);
    }
  }

  try {
    applyMove(room, s => {
      const next = endTurn(s, botId, getBotDiscards(s, botId));
      drawForTurn(next, next.playerOrder[next.currentPlayerIndex]);
      return next;
    });
    return true;
  } catch (err) {
    console.error(`Bot ${botId} could not end its turn:`, err.message);
  }

  const botName = botNameOf(room, botId);
  try {
    applyMove(room, s => resignGame(s, botId));
    room.players = room.players.filter(p => p.id !== botId);
    io.to(room.roomCode).emit('playerResigned', { playerId: botId, playerName: botName });
    emitRoomUpdate(room);
    return true;
  } catch (err) {
    console.error(`Bot ${botId} could not be resigned:`, err.message);
    return false;
  }
}

function botNameOf(room, botId) {
  return room.players.find(p => p.id === botId)?.name ?? 'Bot';
}

// Schedule the next bot action after every game-state broadcast.
function checkAndScheduleBotTurn(room) {
  if (isMahjong(room))  return scheduleMahjongBot(room);
  if (isSplendor(room)) return scheduleSplendorBot(room);

  if (room.botTimeout) { clearTimeout(room.botTimeout); room.botTimeout = null; }
  if (!room.gameState || room.gameState.phase === 'gameover') return;
  // Nobody is watching an empty table — stop playing it out and let the room
  // be swept up. A player who reconnects starts the bots again.
  if (!hasConnectedHuman(room)) return;

  const delay = (fn, ms) => { room.botTimeout = setTimeout(fn, ms); };

  if (room.gameState.phase === 'responding') {
    const responder = getPendingBotResponder(room);
    if (responder) delay(() => executeBotResponse(room, responder), BOT_RESPONSE_DELAY_MS);
    return;
  }

  if (room.gameState.phase === 'movingWildcard') {
    const pending = room.gameState.pendingAction;
    if (pending?.playerId && isBotPlayer(room, pending.playerId)) {
      delay(() => executeBotWildcardOverflow(room, pending.playerId), BOT_RESPONSE_DELAY_MS);
    }
    return;
  }

  if (room.gameState.phase === 'playing') {
    const currentId = room.gameState.playerOrder[room.gameState.currentPlayerIndex];
    if (isBotPlayer(room, currentId)) delay(() => executeBotTurn(room, currentId), BOT_TURN_DELAY_MS);
  }
}

function executeBotWildcardOverflow(room, botId) {
  room.botTimeout = null;
  const state = room.gameState;
  if (!state || state.phase !== 'movingWildcard') return;
  if (state.pendingAction?.playerId !== botId) return;

  runBotStep(room, botId, 'wildcard overflow', () => {
    const move = getBotWildcardOverflowMove(state, botId);
    if (!move) throw new Error('no legal colour for the overflowing wildcard');
    applyMove(room, s => moveWildcard(s, botId, move.cardId, move.newColor));
  });
}

function executeBotTurn(room, botId) {
  room.botTimeout = null;
  const state = room.gameState;
  if (!state || state.phase === 'gameover') return;
  if (state.playerOrder[state.currentPlayerIndex] !== botId) return; // turn changed while the timeout was pending

  runBotStep(room, botId, 'turn', () => {
    const move = getBotMove(state, botId);
    if (!move) {
      applyMove(room, s => {
        const next = endTurn(s, botId, getBotDiscards(s, botId));
        drawForTurn(next, next.playerOrder[next.currentPlayerIndex]);
        return next;
      });
      return;
    }
    applyMove(room, s => playCard(s, botId, move.cardId, move.destination, move.options));
  });
}

function executeBotResponse(room, botId) {
  room.botTimeout = null;
  const state = room.gameState;
  if (!state || state.phase !== 'responding') return;
  if (getPendingBotResponder(room) !== botId) return; // someone else answered first

  runBotStep(room, botId, 'response', () => {
    const { response, options } = getBotResponse(state, botId);
    applyMove(room, s => respondToAction(s, botId, response, options));
  });
}

// ── Mah Jong bots ────────────────────────────────────────────

const MJ_BOT_DELAY_MS = 1200;

// Returns the bot whose move the table is waiting on, or null. During the
// Charleston that is any bot that has not locked in a pass yet; in play it is
// the bot whose turn it is — unless another bot can call the discard for Mah
// Jong, which beats whatever the player in turn was about to do.
function nextMahjongBot(room) {
  const state = room.gameState;
  if (!state) return null;

  const botIds = room.players.filter(p => p.isBot).map(p => p.id);

  if (state.phase === 'charleston') {
    return botIds.find(id => state.players[id] && !state.players[id].passReady) ?? null;
  }
  if (state.phase === 'playing') {
    const caller = botIds.find(id => mj.mahjongClaimFor(state, id));
    if (caller) return caller;
    const currentId = state.playerOrder[state.currentPlayerIndex];
    return botIds.includes(currentId) ? currentId : null;
  }
  return null;
}

function scheduleMahjongBot(room) {
  const waitingOn = room.gameState?.phase !== 'gameover' && hasConnectedHuman(room)
    ? nextMahjongBot(room)
    : null;

  // A move already on the clock for the same bot stays on it — sorting or
  // dragging tiles rebroadcasts the state, and that shouldn't keep pushing
  // the bot's turn back.
  if (waitingOn && room.botTimeout && room.botTimeoutFor === waitingOn) return;

  if (room.botTimeout) { clearTimeout(room.botTimeout); room.botTimeout = null; }
  room.botTimeoutFor = waitingOn;
  if (!waitingOn) return;

  room.botTimeout = setTimeout(() => executeMahjongBotMove(room, waitingOn), MJ_BOT_DELAY_MS);
}

function applyMahjongBotMove(state, botId, move) {
  switch (move?.type) {
    case 'pass':    return mj.confirmPass(mj.setPassSelection(state, botId, move.tileIds), botId);
    case 'claim':   return mj.claimDiscard(state, botId, move.option);
    case 'draw':    return mj.drawFromWall(state, botId);
    case 'discard': return mj.discardTile(state, botId, move.tileId);
    case 'declare': return mj.declareMahjong(state, botId);
    default:        return null;
  }
}

function executeMahjongBotMove(room, botId) {
  room.botTimeout    = null;
  room.botTimeoutFor = null;

  const state = room.gameState;
  if (!state || state.phase === 'gameover') return;
  if (nextMahjongBot(room) !== botId) return;   // the table moved on while we waited

  let moved = false;
  try {
    moved = !!applyMove(room, s => applyMahjongBotMove(s, botId, getMahjongBotMove(s, botId)));
  } catch (err) {
    console.error(`Mah Jong bot ${botId} move error:`, err.message);
  }

  if (!moved) {
    // Fall back to a move that is always legal so the hand doesn't stall.
    try {
      moved = !!applyMove(room, s => applyMahjongBotMove(s, botId, getMahjongBotFallbackMove(s, botId)));
    } catch (err) {
      console.error(`Mah Jong bot ${botId} fallback error:`, err.message);
    }
  }
  if (!moved) return;

  broadcastGameState(room);
  emitMahjongGameOver(room);
  checkAndScheduleBotTurn(room);
}

// ── Splendor bots ────────────────────────────────────────────

const SP_BOT_DELAY_MS = 1300;

// The bot whose move the table is waiting on, or null. Every stage of a turn
// — the action, or handing gems back — belongs to the player
// whose turn it is.
function nextSplendorBot(room) {
  const state = room.gameState;
  if (!state || state.phase !== 'playing') return null;
  const currentId = state.playerOrder[state.currentPlayerIndex];
  return room.players.some(p => p.isBot && p.id === currentId) ? currentId : null;
}

function scheduleSplendorBot(room) {
  const waitingOn = hasConnectedHuman(room) ? nextSplendorBot(room) : null;

  if (waitingOn && room.botTimeout && room.botTimeoutFor === waitingOn) return;

  if (room.botTimeout) { clearTimeout(room.botTimeout); room.botTimeout = null; }
  room.botTimeoutFor = waitingOn;
  if (!waitingOn) return;

  room.botTimeout = setTimeout(() => executeSplendorBotMove(room, waitingOn), SP_BOT_DELAY_MS);
}

function applySplendorBotMove(state, botId, move) {
  switch (move?.type) {
    case 'take':    return sp.takeGems(state, botId, move.colors);
    case 'reserve': return sp.reserveCard(state, botId, move);
    case 'buy':     return sp.buyCard(state, botId, move);
    case 'return':  return sp.returnGems(state, botId, move.gems);
    case 'pass':    return sp.passTurn(state, botId);
    default:        return null;
  }
}

function executeSplendorBotMove(room, botId) {
  room.botTimeout    = null;
  room.botTimeoutFor = null;

  const state = room.gameState;
  if (!state || state.phase === 'gameover') return;
  if (nextSplendorBot(room) !== botId) return;

  let moved = false;
  try {
    moved = !!applyMove(room, s => applySplendorBotMove(s, botId, getSplendorBotMove(s, botId)));
  } catch (err) {
    console.error(`Splendor bot ${botId} move error:`, err.message);
  }

  if (!moved) {
    try {
      moved = !!applyMove(room, s => applySplendorBotMove(s, botId, getSplendorBotFallbackMove(s, botId)));
    } catch (err) {
      console.error(`Splendor bot ${botId} fallback error:`, err.message);
    }
  }
  if (!moved) return;

  broadcastGameState(room);
  emitSplendorGameOver(room);
  checkAndScheduleBotTurn(room);
}

// ============================================================
// SOCKET.IO EVENTS
// ============================================================

io.on('connection', socket => {
  console.log(`Socket connected: ${socket.id}${socket.recovered ? ' (recovered)' : ''}`);

  // Socket.IO restored a session that briefly dropped: the player never really
  // left, so pick their seat back up without a round trip through rejoinRoom.
  if (socket.recovered) {
    const room   = getRoomBySocket(socket.id);
    const player = room && getPlayerBySocket(room, socket.id);
    if (player) {
      player.connected = true;
      if (player.dropTimer) { clearTimeout(player.dropTimer); player.dropTimer = null; }
      room.emptySince = null;
      checkAndScheduleBotTurn(room);
    }
  }

  // ── Create Room ──────────────────────────────────────────
  socket.on('createRoom', ({ playerName, debug, gameType }) => {
    if (!playerName?.trim()) return emitError(socket, 'Player name is required.');

    const type = GAME_TYPES[gameType] ? gameType : 'property';
    const roomCode = generateRoomCode();
    const playerId = uuidv4();

    rooms[roomCode] = {
      roomCode,
      hostId:    playerId,
      started:   false,
      gameType:  type,
      // Debug card setup only exists for Property Deal.
      debugMode: !!debug && type === 'property',
      gameState: null,
      players: [{ id: playerId, name: playerName.trim(), socketId: socket.id, connected: true }],
    };

    socket.join(roomCode);
    socket.emit('joinedRoom', { playerId, roomCode });
    emitRoomUpdate(rooms[roomCode]);
    console.log(`Room ${roomCode} (${type}) created by ${playerName}`);
  });

  // ── Join Room ────────────────────────────────────────────
  socket.on('joinRoom', ({ roomCode, playerName, gameType }) => {
    const code = roomCode?.toUpperCase().trim();
    if (!playerName?.trim()) return emitError(socket, 'Player name is required.');

    const room = rooms[code];
    if (!room)                return emitError(socket, `Room ${code} not found.`);
    if (room.started)         return emitError(socket, 'Game already in progress.');

    const type = gameTypeOf(room);
    const cfg  = GAME_TYPES[type];
    if (gameType && GAME_TYPES[gameType] && gameType !== type) {
      return emitError(socket, `Room ${code} is playing ${cfg.label}.`);
    }
    if (room.players.length >= cfg.max) {
      return emitError(socket, `Room is full (max ${cfg.max} players).`);
    }

    const playerId = uuidv4();
    room.players.push({ id: playerId, name: playerName.trim(), socketId: socket.id, connected: true });

    socket.join(code);
    socket.emit('joinedRoom', { playerId, roomCode: code });
    emitRoomUpdate(room);
    console.log(`${playerName} joined room ${code}`);
  });

  // ── Start Game ───────────────────────────────────────────
  socket.on('startGame', () => {
    const room   = getRoomBySocket(socket.id);
    if (!room)   return emitError(socket, 'You are not in a room.');

    const player = getPlayerBySocket(room, socket.id);
    if (player.id !== room.hostId) return emitError(socket, 'Only the host can start the game.');
    if (room.started)               return emitError(socket, 'Game already started.');

    const cfg = GAME_TYPES[gameTypeOf(room)];
    if (room.players.length < cfg.min) return emitError(socket, `Need at least ${cfg.min} players to start.`);
    if (room.players.length > cfg.max) return emitError(socket, `${cfg.label} supports up to ${cfg.max} players.`);

    const playerIds = room.players.map(p => p.id);

    if (isSplendor(room)) {
      try {
        room.gameState = sp.createGame(playerIds);
      } catch (err) {
        return emitError(socket, err.message);
      }
      room.started      = true;
      room.gameOverSent = false;
      playerIds.forEach(id => {
        const p = room.players.find(pl => pl.id === id);
        if (p) room.gameState.playerNames[id] = p.name;
      });
      broadcastGameState(room);
      io.to(room.roomCode).emit('gameStarted');
      checkAndScheduleBotTurn(room);
      console.log(`Splendor started in room ${room.roomCode}`);
      return;
    }

    if (isMahjong(room)) {
      try {
        room.gameState = mj.createGame(playerIds);
      } catch (err) {
        return emitError(socket, err.message);
      }
      room.started      = true;
      room.gameOverSent = false;
      playerIds.forEach(id => {
        const p = room.players.find(pl => pl.id === id);
        if (p) room.gameState.playerNames[id] = p.name;
      });
      broadcastGameState(room);
      io.to(room.roomCode).emit('gameStarted');
      checkAndScheduleBotTurn(room);
      console.log(`Mah Jong started in room ${room.roomCode}`);
      return;
    }

    room.gameState    = createGame(playerIds);
    room.started      = true;
    room.gameOverSent = false;

    // Store real player names so the game log uses them
    playerIds.forEach(id => {
      const p = room.players.find(p => p.id === id);
      if (p) room.gameState.playerNames[id] = p.name;
    });

    // Auto-draw for the first player (use shuffled order, not join order)
    drawForTurn(room.gameState, room.gameState.playerOrder[0]);

    broadcastGameState(room);
    io.to(room.roomCode).emit('gameStarted');
    checkAndScheduleBotTurn(room);
    console.log(`Game started in room ${room.roomCode}`);
  });

  // ── Debug Start Game (manual hand setup) ─────────────────
  socket.on('debugStartGame', ({ hands }) => {
    const room = getRoomBySocket(socket.id);
    if (!room)           return emitError(socket, 'You are not in a room.');
    if (!room.debugMode) return emitError(socket, 'Room is not in debug mode.');
    if (room.started)    return emitError(socket, 'Game already started.');

    const player = getPlayerBySocket(room, socket.id);
    if (player.id !== room.hostId) return emitError(socket, 'Only the host can start the game.');
    if (room.players.length < 2)   return emitError(socket, 'Need at least 2 players to start.');

    // Resolve card IDs → card objects from the master deck
    const manualHands = {};
    for (const [pid, cardIds] of Object.entries(hands)) {
      manualHands[pid] = (cardIds ?? []).map(id => CARD_MAP[id]).filter(Boolean);
    }

    const playerIds   = room.players.map(p => p.id);
    room.gameState    = createGameDebug(playerIds, manualHands);
    room.started      = true;
    room.gameOverSent = false;

    playerIds.forEach(id => {
      const p = room.players.find(p => p.id === id);
      if (p) room.gameState.playerNames[id] = p.name;
    });

    broadcastGameState(room);
    io.to(room.roomCode).emit('gameStarted');
    checkAndScheduleBotTurn(room);
    console.log(`[DEBUG] Game started in room ${room.roomCode} with manual hands`);
  });

  // ── Play Card ────────────────────────────────────────────
  socket.on('playCard', ({ cardId, destination, options = {} }) => {
    const room = getRoomBySocket(socket.id);
    if (!room?.gameState) return emitError(socket, 'No game in progress.');

    const player = getPlayerBySocket(room, socket.id);
    if (!player) return emitError(socket, 'Player not found.');

    try {
      applyMove(room, state => playCard(state, player.id, cardId, destination, options));
      broadcastGameState(room);
      if (!emitPropertyGameOver(room)) checkAndScheduleBotTurn(room);
    } catch (err) {
      emitError(socket, err.message);
    }
  });

  // ── Respond to Action ────────────────────────────────────
  socket.on('respondToAction', ({ response, cardId, options = {} }) => {
    const room = getRoomBySocket(socket.id);
    if (!room?.gameState) return emitError(socket, 'No game in progress.');

    const player = getPlayerBySocket(room, socket.id);
    if (!player) return emitError(socket, 'Player not found.');

    try {
      applyMove(room, state => respondToAction(
        state,
        player.id,
        response,
        { cardId, selectedCardIds: options.selectedCardIds ?? [], ...options }
      ));
      broadcastGameState(room);
      if (!emitPropertyGameOver(room)) checkAndScheduleBotTurn(room);
    } catch (err) {
      emitError(socket, err.message);
    }
  });

  // ── Move Wildcard ────────────────────────────────────────
  socket.on('moveWildcard', ({ cardId, newColor }) => {
    const room = getRoomBySocket(socket.id);
    if (!room?.gameState) return emitError(socket, 'No game in progress.');

    const player = getPlayerBySocket(room, socket.id);
    if (!player) return emitError(socket, 'Player not found.');

    try {
      applyMove(room, state => moveWildcard(state, player.id, cardId, newColor));
      broadcastGameState(room);
      if (!emitPropertyGameOver(room)) checkAndScheduleBotTurn(room);
    } catch (err) {
      emitError(socket, err.message);
    }
  });

  // ── End Turn ─────────────────────────────────────────────
  socket.on('endTurn', ({ discardIds = [] } = {}) => {
    const room = getRoomBySocket(socket.id);
    if (!room?.gameState) return emitError(socket, 'No game in progress.');

    const player = getPlayerBySocket(room, socket.id);
    if (!player) return emitError(socket, 'Player not found.');

    try {
      applyMove(room, state => {
        const next = endTurn(state, player.id, discardIds);
        drawForTurn(next, next.playerOrder[next.currentPlayerIndex]);
        return next;
      });
      broadcastGameState(room);
      if (!emitPropertyGameOver(room)) checkAndScheduleBotTurn(room);
    } catch (err) {
      emitError(socket, err.message);
    }
  });

  // ── Resign Game ──────────────────────────────────────────
  socket.on('resignGame', () => {
    const room = getRoomBySocket(socket.id);
    if (!room?.gameState) return emitError(socket, 'No game in progress.');

    const player = getPlayerBySocket(room, socket.id);
    if (!player) return emitError(socket, 'Player not found.');

    if (isSplendor(room)) {
      try {
        room.gameState = sp.resignGame(room.gameState, player.id);
      } catch (err) {
        return emitError(socket, err.message);
      }
      broadcastGameState(room);
      if (room.gameState.phase === 'gameover') {
        emitSplendorGameOver(room);
      } else {
        io.to(room.roomCode).emit('playerResigned', { playerId: player.id, playerName: player.name });
        checkAndScheduleBotTurn(room);
      }
      return;
    }

    if (isMahjong(room)) {
      try {
        room.gameState = mj.resignGame(room.gameState, player.id);
      } catch (err) {
        return emitError(socket, err.message);
      }
      broadcastGameState(room);
      if (room.gameState.phase === 'gameover') {
        emitMahjongGameOver(room);
      } else {
        io.to(room.roomCode).emit('playerResigned', { playerId: player.id, playerName: player.name });
        checkAndScheduleBotTurn(room);
      }
      return;
    }

    try {
      applyMove(room, state => {
        const next = resignGame(state, player.id);
        if (next.phase !== 'gameover' && next.playerOrder.length > 0) {
          try { drawForTurn(next, next.playerOrder[next.currentPlayerIndex]); } catch { /* the next player draws on their turn instead */ }
        }
        return next;
      });

      broadcastGameState(room);

      if (room.gameState.winner) room.gameState.endReason = 'resignation';
      if (!emitPropertyGameOver(room)) {
        io.to(room.roomCode).emit('playerResigned', {
          playerId:   player.id,
          playerName: player.name,
        });
        checkAndScheduleBotTurn(room);
      }
    } catch (err) {
      emitError(socket, err.message);
    }
  });

  // ── Mah Jong ─────────────────────────────────────────────

  socket.on('mj:confirmPass', ({ tileIds = [] } = {}) => {
    applyMahjong(socket, (state, pid) =>
      mj.confirmPass(mj.setPassSelection(state, pid, tileIds), pid));
  });

  socket.on('mj:draw', () => {
    applyMahjong(socket, (state, pid) => mj.drawFromWall(state, pid));
  });

  socket.on('mj:claim', ({ option, size }) => {
    applyMahjong(socket, (state, pid) => mj.claimDiscard(state, pid, option ?? size));
  });

  socket.on('mj:discard', ({ tileId }) => {
    applyMahjong(socket, (state, pid) => mj.discardTile(state, pid, tileId));
  });

  socket.on('mj:useBlank', ({ blankTileId, targetTileId }) => {
    applyMahjong(socket, (state, pid) => mj.useBlank(state, pid, blankTileId, targetTileId));
  });

  socket.on('mj:setMarked', ({ handIds = [] } = {}) => {
    applyMahjong(socket, (state, pid) => mj.setMarkedHands(state, pid, handIds));
  });

  socket.on('mj:declare', () => {
    applyMahjong(socket, (state, pid) => mj.declareMahjong(state, pid));
  });

  socket.on('mj:reorder', ({ tileIds = [] } = {}) => {
    applyMahjong(socket, (state, pid) => mj.reorderHand(state, pid, tileIds));
  });

  socket.on('mj:sort', () => {
    applyMahjong(socket, (state, pid) => mj.sortHand(state, pid));
  });

  // ── Splendor ─────────────────────────────────────────────

  socket.on('sp:take', ({ colors } = {}) => {
    applySplendor(socket, (state, pid) => sp.takeGems(state, pid, colors));
  });

  socket.on('sp:reserve', ({ level, index, deck } = {}) => {
    applySplendor(socket, (state, pid) => sp.reserveCard(state, pid, { level, index, deck: !!deck }));
  });

  socket.on('sp:buy', ({ level, index, reservedId } = {}) => {
    applySplendor(socket, (state, pid) => sp.buyCard(state, pid, { level, index, reservedId }));
  });

  socket.on('sp:return', ({ gems } = {}) => {
    applySplendor(socket, (state, pid) => sp.returnGems(state, pid, gems));
  });

  socket.on('sp:pass', () => {
    applySplendor(socket, (state, pid) => sp.passTurn(state, pid));
  });

  // ── Vote Rematch ─────────────────────────────────────────
  socket.on('voteRematch', () => {
    const room = getRoomBySocket(socket.id);
    if (!room) return;
    const player = getPlayerBySocket(room, socket.id);
    if (!player) return;

    if (!room.rematchVotes) room.rematchVotes = new Set();
    room.rematchVotes.add(player.id);
    broadcastRematchStatus(room);
  });

  // ── Begin Rematch ─────────────────────────────────────────
  socket.on('beginRematch', () => {
    const room = getRoomBySocket(socket.id);
    if (!room) return;
    const player = getPlayerBySocket(room, socket.id);
    if (!player) return;

    updateRematchHost(room);
    if (player.id !== room.rematchHostId) return emitError(socket, 'Only the rematch host can begin.');

    const botIds          = room.players.filter(p => p.isBot).map(p => p.id);
    const rematchPlayerIds = [...new Set([...(room.rematchVotes ?? new Set()), ...botIds])];
    if (rematchPlayerIds.length < 2) return emitError(socket, 'Need at least 2 players to rematch.');

    // Keep only players who voted yes (bots are always included)
    room.players = room.players.filter(p => rematchPlayerIds.includes(p.id));
    room.hostId      = room.rematchHostId;
    room.started     = true;
    room.rematchVotes   = new Set();
    room.rematchHostId  = null;

    const playerIds  = room.players.map(p => p.id);
    room.gameOverSent = false;
    try {
      room.gameState = createGameFor(room, playerIds);
    } catch (err) {
      return emitError(socket, err.message);
    }
    playerIds.forEach(id => {
      const p = room.players.find(pl => pl.id === id);
      if (p) room.gameState.playerNames[id] = p.name;
    });

    if (isMahjong(room) || isSplendor(room)) {
      broadcastGameState(room);
      io.to(room.roomCode).emit('gameStarted');
      checkAndScheduleBotTurn(room);
      console.log(`${GAME_TYPES[gameTypeOf(room)].label} rematch started in room ${room.roomCode} with ${playerIds.length} players.`);
      return;
    }

    drawForTurn(room.gameState, room.gameState.playerOrder[0]);
    broadcastGameState(room);
    io.to(room.roomCode).emit('gameStarted');
    checkAndScheduleBotTurn(room);
    console.log(`Rematch started in room ${room.roomCode} with ${playerIds.length} players.`);
  });

  // ── Add Bot ──────────────────────────────────────────────
  socket.on('addBot', ({ botName }) => {
    const room   = getRoomBySocket(socket.id);
    if (!room)   return emitError(socket, 'You are not in a room.');

    const player = getPlayerBySocket(room, socket.id);
    if (player.id !== room.hostId)  return emitError(socket, 'Only the host can add bots.');
    if (room.started)               return emitError(socket, 'Cannot add bots after the game starts.');

    const cfg = GAME_TYPES[gameTypeOf(room)];
    if (!cfg.bots)                        return emitError(socket, `${cfg.label} is real players only.`);
    if (room.players.length >= cfg.max)   return emitError(socket, 'Room is full.');
    if (!cfg.botNames.includes(botName))  return emitError(socket, 'Unknown bot name.');
    if (room.players.some(p => p.name === botName && p.isBot)) {
      return emitError(socket, `${botName} is already in the room.`);
    }

    const botId = uuidv4();
    room.players.push({ id: botId, name: botName, socketId: null, isBot: true });
    emitRoomUpdate(room);
    console.log(`Bot "${botName}" added to room ${room.roomCode}`);
  });

  // ── Remove Bot ───────────────────────────────────────────
  socket.on('removeBot', ({ botId }) => {
    const room   = getRoomBySocket(socket.id);
    if (!room)   return emitError(socket, 'You are not in a room.');

    const player = getPlayerBySocket(room, socket.id);
    if (player.id !== room.hostId) return emitError(socket, 'Only the host can remove bots.');

    const bot = room.players.find(p => p.id === botId && p.isBot);
    if (!bot) return emitError(socket, 'Bot not found.');

    room.players = room.players.filter(p => p.id !== botId);
    emitRoomUpdate(room);
    console.log(`Bot "${bot.name}" removed from room ${room.roomCode}`);
  });

  // ── Rejoin Room ──────────────────────────────────────────
  socket.on('rejoinRoom', ({ roomCode, playerId }) => {
    const code = roomCode?.toUpperCase().trim();
    const room = rooms[code];
    if (!room) return socket.emit('rejoinFailed', { message: 'Room no longer exists.' });

    const player = room.players.find(p => p.id === playerId);
    if (!player) return socket.emit('rejoinFailed', { message: 'Player not found in room.' });

    // Update the player's socket mapping and re-join the Socket.IO room
    player.socketId  = socket.id;
    player.connected = true;
    if (player.dropTimer) { clearTimeout(player.dropTimer); player.dropTimer = null; }
    room.emptySince = null;
    socket.join(code);

    // Restore session state for this client
    socket.emit('joinedRoom', { playerId, roomCode: code });
    emitRoomUpdate(room);

    if (room.gameState) {
      const state = room.gameState;
      if (isMahjong(room)) {
        socket.emit('gameState', sanitizeMahjong(state, player.id));
      } else if (isSplendor(room)) {
        socket.emit('gameState', sanitizeSplendor(state, player.id));
      } else {
        socket.emit('gameState', {
          ...state,
          players: Object.fromEntries(
            Object.entries(state.players).map(([id, p]) => [id, {
              ...p,
              hand: id === player.id
                ? p.hand
                : p.hand.map(() => ({ id: 'hidden', type: 'hidden' })),
            }])
          ),
          deck: state.deck.length,
        });
      }
    }

    // Bots stop while a table has nobody watching — start them again.
    checkAndScheduleBotTurn(room);

    console.log(`${player.name} rejoined room ${code}`);
  });

  // ── Disconnect ───────────────────────────────────────────
  socket.on('disconnect', () => {
    const room = getRoomBySocket(socket.id);
    if (!room) return;

    const player = getPlayerBySocket(room, socket.id);
    if (!player) return;

    player.connected = false;
    room.emptySince  = hasConnectedHuman(room) ? null : Date.now();
    console.log(`${player.name} disconnected from room ${room.roomCode}`);

    if (room.started) {
      io.to(room.roomCode).emit('playerDisconnected', {
        playerId:   player.id,
        playerName: player.name,
      });
      // Nobody left to play for: stop the bots until someone comes back.
      if (!hasConnectedHuman(room)) checkAndScheduleBotTurn(room);
      return;
    }

    // In the lobby a blink of a connection used to cost you your seat. Hold it
    // for a moment so a reconnect lands you back where you were.
    if (player.dropTimer) clearTimeout(player.dropTimer);
    player.dropTimer = setTimeout(() => {
      if (player.connected || rooms[room.roomCode] !== room) return;
      room.players = room.players.filter(p => p.id !== player.id);
      if (room.players.every(p => p.isBot)) {
        closeRoom(room, 'lobby emptied');
      } else {
        if (room.hostId === player.id) room.hostId = room.players.find(p => !p.isBot)?.id ?? room.players[0].id;
        emitRoomUpdate(room);
      }
    }, LOBBY_GRACE_MS);
  });
});

// ============================================================
// START SERVER
// ============================================================

http.listen(PORT, () => {
  console.log(`Game server running on port ${PORT}`);
});