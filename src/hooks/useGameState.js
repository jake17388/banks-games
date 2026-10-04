import { useState, useEffect, useMemo, useRef } from 'react';
import { applyLocalMoves, isConfirmed, isStale } from '../game/predict.js';

const SESSION_KEY = 'pd_session';
const NAME_KEY    = 'pd_player_name';

// The name is remembered across visits so you don't retype it every time
// you reopen the app; the home screen prefills from it.
export function savePlayerName(name) {
  const trimmed = (name ?? '').trim();
  try {
    if (trimmed) localStorage.setItem(NAME_KEY, trimmed);
    else         localStorage.removeItem(NAME_KEY);
  } catch { /* storage unavailable (private mode) — not worth failing over */ }
}
export function loadPlayerName() {
  try { return localStorage.getItem(NAME_KEY) ?? ''; } catch { return ''; }
}

function saveSession(playerId, roomCode, playerName, gameType) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ playerId, roomCode, playerName, gameType }));
}
export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}
export function loadSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; }
}

export function useGameState(socket) {
  const [roomCode,       setRoomCode]       = useState(null);
  const [playerId,       setPlayerId]       = useState(null);
  const [roomInfo,       setRoomInfo]       = useState(null);
  const [gameState,      setGameState]      = useState(null);
  const [gameOver,       setGameOver]       = useState(null);
  const [error,          setError]          = useState(null);
  const [resignedPlayer, setResignedPlayer] = useState(null);
  const [hasSession,     setHasSession]     = useState(() => !!loadSession());
  const [rematchStatus,  setRematchStatus]  = useState(null);

  // Moves you've made that the server hasn't echoed back yet. They're mirrored
  // onto its state so a dropped card lands immediately, and dropped again the
  // moment the real state arrives — see game/predict.js.
  const [localMoves, setLocalMoves] = useState([]);

  const pendingNameRef = useRef('');
  const pendingGameRef = useRef(null);
  const playerIdRef    = useRef(null);
  const moveSeqRef     = useRef(0);

  function trackMove(move) {
    const tracked = { ...move, id: ++moveSeqRef.current, at: Date.now() };
    setLocalMoves(prev => [...prev, tracked]);
    // A move the server never answers for — a lost packet, a dropped socket —
    // stops being mirrored rather than sticking to the board forever.
    setTimeout(() => {
      setLocalMoves(prev => prev.filter(m => m.id !== tracked.id));
    }, 5000);
  }

  // The socket handlers below are registered once, so they read the player id
  // through a ref rather than closing over a stale one.
  useEffect(() => { playerIdRef.current = playerId; }, [playerId]);

  useEffect(() => {
    if (!socket) return;

    function tryRejoin() {
      const saved = loadSession();
      if (saved) {
        pendingGameRef.current = saved.gameType ?? pendingGameRef.current;
        socket.emit('rejoinRoom', { roomCode: saved.roomCode, playerId: saved.playerId });
      }
    }

    socket.on('connect', tryRejoin);
    // If socket is already connected when this effect runs, rejoin immediately
    if (socket.connected) tryRejoin();

    socket.on('joinedRoom', ({ playerId, roomCode }) => {
      playerIdRef.current = playerId;
      setPlayerId(playerId);
      setRoomCode(roomCode);
      setError(null);
      saveSession(playerId, roomCode, pendingNameRef.current, pendingGameRef.current);
      setHasSession(true);
    });

    socket.on('rejoinFailed', () => {
      clearSession();
      setHasSession(false);
    });

    socket.on('roomUpdate', info => {
      setRoomInfo(info);
      if (info?.gameType) pendingGameRef.current = info.gameType;
    });
    socket.on('gameStarted', ()    => setError(null));

    socket.on('gameState', state => {
      setGameState(state);
      // Stop mirroring every move this state already accounts for.
      setLocalMoves(prev => {
        const now  = Date.now();
        const kept = prev.filter(m => !isStale(m, now) && !isConfirmed(m, state, playerIdRef.current));
        return kept.length === prev.length ? prev : kept;
      });
      // When a new game state arrives (rematch), clear the game-over screen
      setGameOver(null);
      setRematchStatus(null);
    });

    socket.on('gameOver', info => {
      setGameOver(info);
      clearSession();
      setHasSession(false);
    });

    socket.on('rematchStatus', status => setRematchStatus(status));

    // A rejected move was never real — take it back off the board.
    socket.on('error', ({ message }) => {
      setError(message);
      setLocalMoves([]);
    });

    socket.on('playerResigned', ({ playerName }) => {
      setResignedPlayer(playerName);
      setTimeout(() => setResignedPlayer(null), 4000);
    });

    return () => {
      socket.off('connect', tryRejoin);
      socket.off('joinedRoom');
      socket.off('rejoinFailed');
      socket.off('roomUpdate');
      socket.off('gameStarted');
      socket.off('gameState');
      socket.off('gameOver');
      socket.off('rematchStatus');
      socket.off('error');
      socket.off('playerResigned');
    };
  }, [socket]);

  const actions = {
    createRoom: (playerName, gameType = 'property') => {
      pendingNameRef.current = playerName;
      savePlayerName(playerName);
      pendingGameRef.current = gameType;
      socket.emit('createRoom', { playerName, gameType });
    },
    createDebugRoom: (playerName) => {
      pendingNameRef.current = playerName;
      savePlayerName(playerName);
      pendingGameRef.current = 'property';
      socket.emit('createRoom', { playerName, gameType: 'property', debug: true });
    },
    joinRoom: (roomCode, playerName, gameType) => {
      pendingNameRef.current = playerName;
      savePlayerName(playerName);
      pendingGameRef.current = gameType ?? null;
      socket.emit('joinRoom', { roomCode, playerName, gameType });
    },
    startGame:       ()                          => socket.emit('startGame'),
    debugStartGame:  (hands)                     => socket.emit('debugStartGame', { hands }),
    addBot:          (botName)                   => socket.emit('addBot',    { botName }),
    removeBot:       (botId)                     => socket.emit('removeBot', { botId }),
    playCard:        (cardId, destination, opts) => {
      trackMove({ kind: 'play', cardId, destination, options: opts ?? {} });
      socket.emit('playCard', { cardId, destination, options: opts });
    },
    respondToAction: (response, cardId, opts)    => socket.emit('respondToAction', { response, cardId, options: opts ?? {} }),
    moveWildcard:    (cardId, newColor)          => {
      trackMove({ kind: 'moveWildcard', cardId, newColor });
      socket.emit('moveWildcard', { cardId, newColor });
    },
    endTurn:         (discardIds = [])           => socket.emit('endTurn',         { discardIds }),
    resignGame:      ()                          => socket.emit('resignGame'),
    voteRematch:     ()                          => socket.emit('voteRematch'),
    beginRematch:    ()                          => socket.emit('beginRematch'),

    // Mah Jong
    mjConfirmPass:   (tileIds)                   => socket.emit('mj:confirmPass', { tileIds }),
    mjDraw:          ()                          => socket.emit('mj:draw'),
    mjClaim:         (option)                    => socket.emit('mj:claim',    { option }),
    mjDiscard:       (tileId)                    => socket.emit('mj:discard',  { tileId }),
    mjUseBlank:      (blankTileId, targetTileId) => socket.emit('mj:useBlank', { blankTileId, targetTileId }),
    mjSetMarked:     (handIds)                   => socket.emit('mj:setMarked', { handIds }),
    mjDeclare:       ()                          => socket.emit('mj:declare'),
    mjReorder:       (tileIds)                   => socket.emit('mj:reorder', { tileIds }),
    mjSort:          ()                          => socket.emit('mj:sort'),

    // Splendor
    spTake:          (colors)                    => socket.emit('sp:take',    { colors }),
    spReserve:       (target)                    => socket.emit('sp:reserve', target),
    spBuy:           (target)                    => socket.emit('sp:buy',     target),
    spReturn:        (gems)                      => socket.emit('sp:return',  { gems }),
    spPass:          ()                          => socket.emit('sp:pass'),
  };

  // What the board draws: the server's state with your unconfirmed moves
  // already on it.
  const displayState = useMemo(
    () => applyLocalMoves(gameState, playerId, localMoves),
    [gameState, playerId, localMoves],
  );

  return {
    roomCode, playerId, roomInfo, gameState: displayState, gameOver, error,
    actions, resignedPlayer, hasSession, rematchStatus,
  };
}
