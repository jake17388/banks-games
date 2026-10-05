import { useSocket }                        from './hooks/useSocket';
import { useGameState, loadSession, clearSession, loadPlayerName, savePlayerName } from './hooks/useGameState';
import { useState }                        from 'react';
import GameBoard                           from './components/GameBoard.jsx';
import MahjongBoard                       from './components/mahjong/MahjongBoard.jsx';
import MahjongReveal                      from './components/mahjong/MahjongReveal.jsx';
import SplendorBoard                      from './components/splendor/SplendorBoard.jsx';
import DebugSetup                          from './components/DebugSetup.jsx';
import Settings                            from './components/Settings.jsx';
import { cleanUpdateUrl }                  from './hooks/useAppVersion.js';

// Drop the cache-busting ?v= that "Update now" reloads with, so it doesn't
// stay in the address bar or get bookmarked.
const cleanedUrl = cleanUpdateUrl(window.location.href);
if (cleanedUrl !== window.location.href) {
  window.history.replaceState(window.history.state, '', cleanedUrl);
}

const GAMES = {
  property: {
    key: 'property', name: 'Property Deal', icon: '🏠',
    tagline: 'Collect three full property sets to win',
    players: '2–5 players', accent: '#15803d', tint: '#f0fdf4', border: '#86efac',
    bots: true, botNames: ['Elon', 'Jeff', 'Warren', 'Bill'],
  },
  mahjong: {
    key: 'mahjong', name: 'Mah Jong', icon: '🀄',
    tagline: 'American mahjong — build a hand from the card',
    players: '2–4 players', accent: '#b45309', tint: '#fffbeb', border: '#fcd34d',
    bots: true, botNames: ['Sum', 'Ting', 'Wong'],
  },
  splendor: {
    key: 'splendor', name: 'Splendor', icon: '💎',
    tagline: 'Collect gems, buy mines, race to 15 prestige points',
    players: '2–4 players', accent: '#7c3aed', tint: '#f5f3ff', border: '#c4b5fd',
    bots: true, botNames: ['Midas', 'Croesus', 'Medici'],
  },
};

// Bots don't come through in the game state, so the rematch screen picks them
// out by name.
const BOT_NAMES = Object.values(GAMES).flatMap(g => g.botNames);

export default function App() {
  const { socket, connected } = useSocket();
  const {
    roomCode, playerId, roomInfo, gameState, gameOver, error, actions, resignedPlayer, hasSession, rematchStatus,
  } = useGameState(socket);

  // Your name is remembered between visits, so a returning player lands
  // straight on the game picker instead of retyping it.
  const [nameInput,      setNameInput]      = useState(loadPlayerName);
  const [codeInput,      setCodeInput]      = useState('');
  const [step,           setStep]           = useState(() => (loadPlayerName() ? 'game' : 'name'));  // name → game → room
  const [gameChoice,     setGameChoice]     = useState(null);
  const [showDebugSetup, setShowDebugSetup] = useState(false);
  const [showSettings,   setShowSettings]   = useState(false);

  const debugUnlocked = new URLSearchParams(window.location.search).has('debug');

  // ── Reconnecting ────────────────────────────────────────
  if (!connected && hasSession) {
    const session = loadSession();
    return (
      <div style={{
        height: '100%', background: '#f3f4f6',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        padding: 24,
      }}>
        <div style={{
          background: '#fff', borderRadius: 20,
          padding: '40px 28px', width: '100%', maxWidth: 380,
          textAlign: 'center', boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📡</div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: '#111827', marginBottom: 8 }}>
            Reconnecting…
          </h2>
          <p style={{ fontSize: 14, color: '#6b7280', marginBottom: 6 }}>
            Returning to your game
          </p>
          {session?.roomCode && (
            <div style={{
              display: 'inline-block', background: '#f0f9ff',
              border: '1px solid #bae6fd', borderRadius: 10,
              padding: '6px 16px', fontSize: 20, fontWeight: 800,
              color: '#0369a1', letterSpacing: '0.15em', marginBottom: 28,
            }}>
              {session.roomCode}
            </div>
          )}
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 6 }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{
                  width: 8, height: 8, borderRadius: '50%', background: '#3b82f6',
                  animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
                }} />
              ))}
            </div>
          </div>
          <button
            onClick={() => { clearSession(); window.location.reload(); }}
            style={{
              background: 'transparent', color: '#9ca3af',
              border: '1px solid #e5e7eb', borderRadius: 12,
              padding: '10px 20px', fontSize: 13, cursor: 'pointer',
            }}
          >
            Leave Game
          </button>
        </div>
      </div>
    );
  }

  // ── Game Over ───────────────────────────────────────────
  if (gameOver) {
    const playerOrder   = gameState?.playerOrder ?? [];
    const playerNames   = gameState?.playerNames ?? {};
    const myVote        = rematchStatus?.votes?.includes(playerId) ?? false;
    const rematchHostId = rematchStatus?.rematchHostId ?? null;
    const iAmHost       = rematchHostId === playerId;
    const voteCount     = rematchStatus?.votes?.length ?? 0;

    return (
      <div style={{
        height: '100%', background: '#f3f4f6',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        padding: 24, overflowY: 'auto',
      }}>
        <div style={{
          background: '#fff', borderRadius: 20,
          padding: '32px 24px', width: '100%', maxWidth: 380,
          boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
        }}>
          {/* Winner */}
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <div style={{ fontSize: 56, marginBottom: 8 }}>
              {gameOver.reason === 'wall' ? '🀫' : gameOver.winnerName ? '🏆' : '🃏'}
            </div>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: '#111827', marginBottom: 4 }}>
              {gameOver.reason === 'wall'      ? 'Wall game — nobody won'
                : !gameOver.winnerName         ? 'Nobody won'
                : gameOver.reason === 'mahjong' ? `${gameOver.winnerName} called Mah Jong!`
                : (gameOver.winnerIds?.length ?? 0) > 1 ? `${gameOver.winnerName} and others tie!`
                : `${gameOver.winnerName} wins!`}
            </h1>
            <p style={{ fontSize: 13, color: '#6b7280' }}>
              {gameOver.reason === 'resignation' ? 'Game ended by resignation'
                : gameOver.reason === 'wall'      ? 'The wall ran out before anyone completed a hand'
                : gameOver.reason === 'deckEmpty' ? 'The deck ran out — most complete sets takes it'
                : gameOver.reason === 'points'    ? 'Most prestige points after the final round — fewer cards breaks a tie'
                : 'Great game everyone!'}
            </p>
          </div>

          {gameOver.standings && (
            <div data-testid="standings" style={{ borderTop: '1px solid #e5e7eb', paddingTop: 16, marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', textAlign: 'center', marginBottom: 8, letterSpacing: '0.04em' }}>
                FINAL SCORES
              </div>
              {gameOver.standings.map(s => (
                <div key={s.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0',
                  borderBottom: '1px solid #f3f4f6', fontSize: 14,
                  fontWeight: gameOver.winnerIds?.includes(s.id) ? 800 : 500, color: '#111827',
                }}>
                  <span style={{ width: 22, textAlign: 'center' }}>{gameOver.winnerIds?.includes(s.id) ? '🏆' : ''}</span>
                  <span style={{ flex: 1 }}>{s.name}{s.id === playerId ? ' (you)' : ''}</span>
                  <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 500 }}>{s.cards} cards</span>
                  <span style={{ minWidth: 44, textAlign: 'right', color: '#b45309' }}>{s.points} pts</span>
                </div>
              ))}
            </div>
          )}

          <MahjongReveal
            gameState={gameState}
            playerId={playerId}
            playerNames={playerNames}
            winningHands={gameOver.winningHands ?? []}
          />

          {/* Rematch section */}
          <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 20, marginBottom: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#374151', textAlign: 'center', marginBottom: 14, letterSpacing: '0.04em' }}>
              REMATCH?
            </div>

            {/* Per-player vote status */}
            <div style={{ marginBottom: 16 }}>
              {playerOrder.map(pid => {
                const isBot  = gameState?.players?.[pid] == null
                  ? false
                  : !rematchStatus?.votes?.includes(pid) && BOT_NAMES.includes(playerNames[pid]);
                const voted  = rematchStatus?.votes?.includes(pid) || isBot;
                const isHost = pid === rematchHostId;
                return (
                  <div key={pid} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '9px 0', borderBottom: '1px solid #f3f4f6',
                  }}>
                    <div style={{ fontSize: 18, width: 24, textAlign: 'center' }}>
                      {voted ? '✅' : '⏳'}
                    </div>
                    <span style={{
                      flex: 1, fontSize: 14,
                      color: voted ? '#111827' : '#9ca3af',
                      fontWeight: pid === playerId ? 700 : 400,
                    }}>
                      {playerNames[pid] ?? pid}
                      {pid === playerId ? ' (you)' : ''}
                      {isBot ? ' 🤖' : ''}
                    </span>
                    {isHost && voted && (
                      <span style={{
                        fontSize: 10, background: '#eff6ff', color: '#1d4ed8',
                        borderRadius: 20, padding: '2px 8px', fontWeight: 700,
                        border: '1px solid #bfdbfe',
                      }}>HOST</span>
                    )}
                    <span style={{ fontSize: 12, color: voted ? '#16a34a' : '#d1d5db', fontWeight: 600 }}>
                      {voted ? 'In!' : '...'}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Action button */}
            {!myVote ? (
              <button
                onClick={() => actions.voteRematch()}
                style={{
                  width: '100%', background: '#15803d', color: '#fff',
                  border: 'none', borderRadius: 12, padding: '14px',
                  fontSize: 15, fontWeight: 700, cursor: 'pointer', marginBottom: 8,
                }}
              >
                Yes, Rematch! 🔁
              </button>
            ) : iAmHost ? (
              <button
                onClick={() => actions.beginRematch()}
                style={{
                  width: '100%', background: '#1d4ed8', color: '#fff',
                  border: 'none', borderRadius: 12, padding: '14px',
                  fontSize: 15, fontWeight: 700, cursor: 'pointer', marginBottom: 8,
                }}
              >
                Begin Rematch ({voteCount} player{voteCount !== 1 ? 's' : ''}) 🚀
              </button>
            ) : (
              <div style={{
                textAlign: 'center', fontSize: 13, color: '#6b7280',
                padding: '10px 0', marginBottom: 8,
              }}>
                {rematchHostId
                  ? `Waiting for ${playerNames[rematchHostId] ?? 'host'} to start…`
                  : voteCount >= 1
                    ? 'Waiting for more players…'
                    : 'Waiting for others to vote…'}
              </div>
            )}
          </div>

          <button
            onClick={() => { clearSession(); window.location.reload(); }}
            style={{
              width: '100%', background: '#f3f4f6', color: '#6b7280',
              border: 'none', borderRadius: 12, padding: '12px',
              fontSize: 14, cursor: 'pointer',
            }}
          >
            🏠 Back to Home
          </button>
        </div>
      </div>
    );
  }

  // ── Debug Setup ─────────────────────────────────────────
  if (showDebugSetup && roomInfo) return (
    <DebugSetup
      players={roomInfo.players}
      onStart={hands => {
        actions.debugStartGame(hands);
        setShowDebugSetup(false);
      }}
      onCancel={() => setShowDebugSetup(false)}
    />
  );

  // ── In Game ─────────────────────────────────────────────
  if (gameState?.gameType === 'mahjong') return (
    <MahjongBoard
      gameState={gameState}
      playerId={playerId}
      playerNames={Object.fromEntries(
        roomInfo?.players?.map(p => [p.id, p.name]) ?? []
      )}
      actions={actions}
      resignedPlayer={resignedPlayer}
    />
  );

  if (gameState?.gameType === 'splendor') return (
    <SplendorBoard
      gameState={gameState}
      playerId={playerId}
      playerNames={Object.fromEntries(
        roomInfo?.players?.map(p => [p.id, p.name]) ?? []
      )}
      actions={actions}
      resignedPlayer={resignedPlayer}
    />
  );

  if (gameState) return (
    <GameBoard
      gameState={gameState}
      playerId={playerId}
      playerNames={Object.fromEntries(
        roomInfo?.players?.map(p => [p.id, p.name]) ?? []
      )}
      actions={actions}
      resignedPlayer={resignedPlayer}
    />
  );

  // ── Server too old for the game you picked ──────────────
  // The frontend and the game server deploy from two different hosts, so the
  // frontend can land first. A server without game-type support just ignores
  // the field and hands back a Property Deal room — which would quietly drop a
  // Mah Jong player into the wrong game. Say what actually happened instead.
  if (roomInfo && !roomInfo.gameType && gameChoice && gameChoice !== 'property') return shellWrapper(
    <>
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <div style={{ fontSize: 46, marginBottom: 10 }}>🛠️</div>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: '#111827', marginBottom: 8 }}>
          {GAMES[gameChoice].name} isn't live yet
        </h1>
        <p style={{ fontSize: 13.5, color: '#6b7280', lineHeight: 1.55 }}>
          This app has the new version, but the game server it talks to hasn't been
          updated yet — so it can only host Property Deal right now. Try again once
          the server has redeployed.
        </p>
      </div>
      <button
        onClick={() => { clearSession(); window.location.reload(); }}
        style={{
          width: '100%', background: '#1d4ed8', color: '#fff',
          border: 'none', borderRadius: 14, padding: '16px',
          fontSize: 16, fontWeight: 700, cursor: 'pointer',
        }}
      >
        Back to games
      </button>
    </>
  );

  // ── Lobby ────────────────────────────────────────────────
  if (roomInfo) {
    const game       = GAMES[roomInfo.gameType] ?? GAMES.property;
    const maxPlayers = roomInfo.maxPlayers ?? (roomInfo.gameType === 'property' ? 5 : 4);
    const enough     = roomInfo.players.length >= 2;
    const tooMany    = roomInfo.players.length > maxPlayers;
    return (
    <div style={{
      height: '100%',
      background: '#f3f4f6',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      padding: 24,
    }}>
      <div style={{
        background: '#fff',
        borderRadius: 20,
        padding: '32px 24px',
        width: '100%',
        maxWidth: 380,
        boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 36, marginBottom: 4 }}>{game.icon}</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: game.accent, marginBottom: 8 }}>
            {game.name}
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#111827', marginBottom: 4 }}>
            Room Code:
          </h1>
          <div style={{
            display: 'inline-block',
            background: '#f0f9ff',
            border: '1px solid #bae6fd',
            borderRadius: 10,
            padding: '6px 16px',
            fontSize: 20,
            fontWeight: 800,
            color: '#0369a1',
            letterSpacing: '0.15em',
          }}>
            {roomCode}
          </div>
          <p style={{ fontSize: 13, color: '#9ca3af', marginTop: 6 }}>
            Share this code with friends
          </p>
        </div>

        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, color: '#9ca3af', fontWeight: 600, marginBottom: 10, letterSpacing: '0.06em' }}>
            PLAYERS ({roomInfo.players.length}/{maxPlayers})
          </div>
          {roomInfo.players.map(p => (
            <div key={p.id} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 0',
              borderBottom: '1px solid #f3f4f6',
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: '50%',
                background: p.isBot ? '#7c3aed' : p.id === roomInfo.hostId ? '#1d4ed8' : '#6b7280',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: p.isBot ? 18 : 15, fontWeight: 700, color: '#fff', flexShrink: 0,
              }}>
                {p.isBot ? '🤖' : p.name[0].toUpperCase()}
              </div>
              <span style={{ fontSize: 16, fontWeight: 500, color: '#111827' }}>{p.name}</span>
              {p.isBot && (
                <span style={{
                  fontSize: 10, background: '#f5f3ff',
                  color: '#7c3aed', borderRadius: 20, padding: '2px 8px',
                  fontWeight: 600, border: '1px solid #ddd6fe',
                }}>bot</span>
              )}
              {!p.isBot && p.id === roomInfo.hostId && (
                <span style={{
                  fontSize: 11, background: '#fef3c7',
                  color: '#92400e', borderRadius: 20, padding: '2px 8px',
                  fontWeight: 600, border: '1px solid #f59e0b',
                }}>host</span>
              )}
              {p.isBot && playerId === roomInfo.hostId && (
                <button
                  onClick={() => actions.removeBot(p.id)}
                  style={{
                    marginLeft: 'auto', background: 'transparent', border: 'none',
                    color: '#9ca3af', fontSize: 18, cursor: 'pointer',
                    lineHeight: 1, padding: '0 4px',
                  }}
                  title={`Remove ${p.name}`}
                >
                  ×
                </button>
              )}
              {!p.isBot && p.id !== roomInfo.hostId && p.id === playerId && (
                <span style={{ marginLeft: 'auto', fontSize: 11, color: '#9ca3af' }}>you</span>
              )}
            </div>
          ))}
        </div>

        {/* Add Bot — host only, room not full */}
        {game.bots && playerId === roomInfo.hostId && roomInfo.players.length < maxPlayers && (() => {
          const addedBotNames = roomInfo.players.filter(p => p.isBot).map(p => p.name);
          const available = game.botNames.filter(n => !addedBotNames.includes(n));
          if (available.length === 0) return null;
          return (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, color: '#9ca3af', fontWeight: 600, marginBottom: 8, letterSpacing: '0.06em' }}>
                ADD A BOT
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {available.map(name => (
                  <button
                    key={name}
                    onClick={() => actions.addBot(name)}
                    style={{
                      background: '#f5f3ff', color: '#7c3aed',
                      border: '1.5px solid #ddd6fe', borderRadius: 20,
                      padding: '6px 14px', fontSize: 13, fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    🤖 {name}
                  </button>
                ))}
              </div>
            </div>
          );
        })()}

        {error && (
          <div style={{ background: '#fef2f2', color: '#dc2626', borderRadius: 10, padding: '10px 14px', fontSize: 13, marginBottom: 16 }}>
            {error}
          </div>
        )}

        {playerId === roomInfo.hostId ? (
          roomInfo.debugMode ? (
            <button
              onClick={() => setShowDebugSetup(true)}
              disabled={roomInfo.players.length < 2}
              style={{
                width: '100%',
                background: roomInfo.players.length < 2 ? '#d1d5db' : '#7c3aed',
                color: '#fff', border: 'none', borderRadius: 14, padding: '18px',
                fontSize: 17, fontWeight: 700,
                cursor: roomInfo.players.length < 2 ? 'not-allowed' : 'pointer',
              }}
            >
              {roomInfo.players.length < 2 ? 'Waiting for players...' : '🔧 Setup Cards'}
            </button>
          ) : (
            <button
              onClick={actions.startGame}
              disabled={!enough || tooMany}
              style={{
                width: '100%', background: !enough || tooMany ? '#d1d5db' : game.accent,
                color: '#fff', border: 'none', borderRadius: 14, padding: '18px',
                fontSize: 17, fontWeight: 700, cursor: !enough || tooMany ? 'not-allowed' : 'pointer',
              }}
            >
              {tooMany ? `Too many players for ${game.name}`
                : !enough ? 'Waiting for players...'
                : 'Start Game 🚀'}
            </button>
          )
        ) : (
          <div style={{ textAlign: 'center', color: '#6b7280', fontSize: 14, padding: '12px 0' }}>
            Waiting for host to start...
          </div>
        )}
      </div>
    </div>
    );
  }

  // ── Home Screen: name → game → room ──────────────────────
  const selectedGame = GAMES[gameChoice] ?? null;
  const nameReady    = connected && nameInput.trim().length > 0;

  function confirmName() {
    savePlayerName(nameInput);
    setStep('game');
  }

  const shell = shellWrapper;
  function shellWrapper(children) { return (
    <div style={{
      height: '100%',
      background: '#f3f4f6',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      padding: 24,
      overflowY: 'auto',
    }}>
      <div style={{
        position: 'relative',
        background: '#fff',
        borderRadius: 20,
        padding: '40px 24px',
        width: '100%',
        maxWidth: 380,
        boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
      }}>
        <button
          onClick={() => setShowSettings(true)}
          title="Settings"
          aria-label="Settings"
          style={{
            position: 'absolute', top: 14, right: 14,
            background: 'none', border: 'none', cursor: 'pointer',
            padding: 6, lineHeight: 0, color: '#9ca3af',
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>

        {children}
      </div>

      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
    </div>
  ); }

  const errorBox = error && (
    <div style={{ background: '#fef2f2', color: '#dc2626', borderRadius: 10, padding: '10px 14px', fontSize: 13, marginBottom: 16 }}>
      {error}
    </div>
  );

  const backLink = (label, onClick) => (
    <button
      onClick={onClick}
      style={{
        background: 'none', border: 'none', color: '#6b7280',
        fontSize: 13, cursor: 'pointer', padding: '10px 0', marginTop: 4,
        width: '100%', textAlign: 'center',
      }}
    >
      ← {label}
    </button>
  );

  // Step 1 — who are you?
  if (step === 'name') return shell(
    <>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div style={{ fontSize: 52, marginBottom: 8 }}>🎲</div>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: '#111827', marginBottom: 4 }}>
          Banks Games
        </h1>
        <p style={{ fontSize: 14, color: '#9ca3af' }}>Multiplayer card &amp; tile games</p>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 8 }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: connected ? '#16a34a' : '#dc2626',
          }} />
          <span style={{ fontSize: 12, color: '#9ca3af' }}>
            {connected ? 'Connected' : 'Connecting...'}
          </span>
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
          Your Name
        </label>
        <input
          style={{
            width: '100%', background: '#f9fafb',
            border: '2px solid #e5e7eb', borderRadius: 12,
            padding: '14px 16px', fontSize: 16, outline: 'none',
            color: '#111827',
          }}
          placeholder="Enter your name"
          value={nameInput}
          onChange={e => setNameInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && nameReady) confirmName(); }}
          onFocus={e => e.target.style.borderColor = '#3b82f6'}
          onBlur={e => e.target.style.borderColor = '#e5e7eb'}
        />
      </div>

      {errorBox}

      <button
        onClick={confirmName}
        disabled={!nameReady}
        style={{
          width: '100%', background: nameReady ? '#1d4ed8' : '#d1d5db',
          color: '#fff', border: 'none', borderRadius: 14, padding: '18px',
          fontSize: 17, fontWeight: 700,
          cursor: nameReady ? 'pointer' : 'not-allowed',
        }}
      >
        Continue
      </button>
    </>
  );

  // Step 2 — which game?
  if (step === 'game') return shell(
    <>
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#111827', marginBottom: 4 }}>
          Pick a game
        </h1>
        <p style={{ fontSize: 14, color: '#9ca3af' }}>
          Hi {nameInput.trim()} — what are we playing?
        </p>
      </div>

      {Object.values(GAMES).map(g => (
        <button
          key={g.key}
          onClick={() => { setGameChoice(g.key); setStep('room'); }}
          style={{
            width: '100%', textAlign: 'left', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 14,
            background: g.tint, border: `2px solid ${g.border}`,
            borderRadius: 16, padding: '18px 16px', marginBottom: 12,
          }}
        >
          <span style={{ fontSize: 34, lineHeight: 1, flexShrink: 0 }}>{g.icon}</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 17, fontWeight: 800, color: '#111827' }}>
              {g.name}
            </span>
            <span style={{ display: 'block', fontSize: 12.5, color: '#4b5563', marginTop: 2 }}>
              {g.tagline}
            </span>
            <span style={{ display: 'block', fontSize: 11.5, color: g.accent, fontWeight: 700, marginTop: 4 }}>
              {g.players}{g.bots ? ' · bots available' : ' · real players only'}
            </span>
          </span>
          <span style={{ fontSize: 20, color: g.accent, flexShrink: 0 }}>›</span>
        </button>
      ))}

      {errorBox}
      {backLink('Change name', () => setStep('name'))}
    </>
  );

  // Step 3 — create or join a room for the chosen game
  const joinReady = connected && nameInput.trim() && codeInput.trim();

  return shell(
    <>
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div style={{ fontSize: 46, marginBottom: 6 }}>{selectedGame.icon}</div>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#111827', marginBottom: 2 }}>
          {selectedGame.name}
        </h1>
        <p style={{ fontSize: 13, color: '#9ca3af' }}>
          {selectedGame.players} · playing as {nameInput.trim()}
        </p>
      </div>

      {errorBox}

      <button
        onClick={() => actions.createRoom(nameInput, selectedGame.key)}
        disabled={!nameReady}
        style={{
          width: '100%', background: nameReady ? selectedGame.accent : '#d1d5db',
          color: '#fff', border: 'none', borderRadius: 14, padding: '18px',
          fontSize: 17, fontWeight: 700,
          cursor: nameReady ? 'pointer' : 'not-allowed',
          marginBottom: 12,
        }}
      >
        Create Game
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div style={{ flex: 1, height: 1, background: '#e5e7eb' }} />
        <span style={{ fontSize: 12, color: '#9ca3af' }}>or join existing</span>
        <div style={{ flex: 1, height: 1, background: '#e5e7eb' }} />
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          style={{
            flex: 1, background: '#f9fafb',
            border: '2px solid #e5e7eb', borderRadius: 12,
            padding: '14px 16px', fontSize: 16, outline: 'none',
            color: '#111827', textTransform: 'uppercase', letterSpacing: '0.1em',
            minWidth: 0,
          }}
          placeholder="Room code"
          value={codeInput}
          onChange={e => setCodeInput(e.target.value.toUpperCase())}
          onKeyDown={e => { if (e.key === 'Enter' && joinReady) actions.joinRoom(codeInput, nameInput, selectedGame.key); }}
          onFocus={e => e.target.style.borderColor = '#3b82f6'}
          onBlur={e => e.target.style.borderColor = '#e5e7eb'}
          maxLength={5}
        />
        <button
          onClick={() => actions.joinRoom(codeInput, nameInput, selectedGame.key)}
          disabled={!joinReady}
          style={{
            background: joinReady ? '#1d4ed8' : '#d1d5db',
            color: '#fff', border: 'none', borderRadius: 12,
            padding: '14px 20px', fontSize: 16, fontWeight: 700,
            cursor: joinReady ? 'pointer' : 'not-allowed',
          }}
        >
          Join
        </button>
      </div>

      {debugUnlocked && selectedGame.key === 'property' && (
        <div style={{ textAlign: 'center', marginTop: 20 }}>
          <button
            onClick={() => { if (nameInput.trim()) actions.createDebugRoom(nameInput); }}
            disabled={!nameReady}
            style={{
              background: 'none', border: 'none', color: '#d1d5db',
              fontSize: 11, cursor: nameReady ? 'pointer' : 'default',
              padding: '4px 8px', borderRadius: 4,
            }}
            title="Open a debug room with manual card setup"
          >
            🔧 debug mode
          </button>
        </div>
      )}

      {backLink('Pick a different game', () => setStep('game'))}
    </>
  );
}
