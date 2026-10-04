import { useState, useMemo } from 'react';
import { COLORS, COLOR_NAMES } from '../../game/splendor/cards.js';
import {
  paymentFor, bonusesOf, totalGems, scoreOf, legalMoves,
  takeGems, GEM_LIMIT, RESERVE_LIMIT, WIN_POINTS,
} from '../../game/splendor/engine.js';

// ── Palette ──────────────────────────────────────────────────

const GEM = {
  w:    { bg: '#f9fafb', fg: '#374151', ring: '#9ca3af' },
  b:    { bg: '#2563eb', fg: '#fff',    ring: '#1e40af' },
  g:    { bg: '#16a34a', fg: '#fff',    ring: '#166534' },
  r:    { bg: '#dc2626', fg: '#fff',    ring: '#991b1b' },
  k:    { bg: '#1f2937', fg: '#fff',    ring: '#030712' },
  gold: { bg: '#eab308', fg: '#422006', ring: '#a16207' },
};

const BAND = { w: '#e5e7eb', b: '#bfdbfe', g: '#bbf7d0', r: '#fecaca', k: '#9ca3af' };

const ALL_COLORS = [...COLORS, 'gold'];

// ── Small pieces ─────────────────────────────────────────────

function Gem({ color, size = 34, count, onClick, selected, dim, testId, square }) {
  const g = GEM[color];
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      data-testid={testId}
      onClick={onClick}
      style={{
        width: size, height: size, flexShrink: 0,
        borderRadius: square ? 6 : '50%',
        background: g.bg, color: g.fg,
        border: `2px solid ${selected ? '#facc15' : g.ring}`,
        boxShadow: selected ? '0 0 0 3px rgba(250,204,21,0.55)' : 'none',
        opacity: dim ? 0.35 : 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: Math.round(size * 0.42), fontWeight: 800, lineHeight: 1,
        cursor: onClick ? 'pointer' : 'default', padding: 0,
      }}
    >
      {count ?? ''}
    </Tag>
  );
}

function CostPips({ cost, size = 18 }) {
  const owed = COLORS.filter(c => cost[c] > 0);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, auto)', gap: 3, justifyContent: 'start' }}>
      {owed.map(c => <Gem key={c} color={c} size={size} count={cost[c]} />)}
    </div>
  );
}

function CardView({ card, onClick, canBuy, testId, width }) {
  if (!card) {
    return <div style={{ aspectRatio: '0.72', border: '2px dashed #d1d5db', borderRadius: 10 }} />;
  }
  if (card.hidden) {
    return (
      <div style={{
        aspectRatio: '0.72', borderRadius: 10, background: '#4b5563', color: '#e5e7eb',
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700,
      }}>
        Lv {card.level}
      </div>
    );
  }
  return (
    <button
      data-testid={testId}
      onClick={onClick}
      style={{
        position: 'relative', aspectRatio: width ? undefined : '0.72', width, textAlign: 'left',
        background: '#fff', borderRadius: 10, padding: 0, overflow: 'hidden',
        border: `2px solid ${canBuy ? '#16a34a' : '#d1d5db'}`,
        boxShadow: canBuy ? '0 0 0 2px rgba(22,163,74,0.35)' : '0 1px 2px rgba(0,0,0,0.08)',
        cursor: onClick ? 'pointer' : 'default',
        display: 'flex', flexDirection: 'column',
      }}
    >
      <div style={{
        background: BAND[card.bonus], display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', padding: '3px 5px', flexShrink: 0,
      }}>
        <span style={{ fontSize: 17, fontWeight: 800, color: '#111827', minWidth: 10 }}>
          {card.points || ''}
        </span>
        <Gem color={card.bonus} size={20} square />
      </div>
      <div style={{ padding: '5px 5px' }}>
        <CostPips cost={card.cost} />
      </div>
    </button>
  );
}

function NobleView({ noble }) {
  return (
    <div
      data-testid={`noble-${noble.id}`}
      style={{
        background: '#fffbeb', border: '2px solid #fcd34d',
        borderRadius: 10, padding: '4px 6px', display: 'flex', alignItems: 'center', gap: 5,
      }}
    >
      <span style={{ fontSize: 15, fontWeight: 800, color: '#92400e' }}>{noble.points}</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {COLORS.filter(c => noble.req[c] > 0).map(c => (
          <Gem key={c} color={c} size={16} count={noble.req[c]} square />
        ))}
      </div>
    </div>
  );
}

// A player's cards, as a row of coloured chips with a count each.
function Bonuses({ bonus }) {
  const owned = COLORS.filter(c => bonus[c] > 0);
  if (!owned.length) return <span style={{ fontSize: 11, color: '#9ca3af' }}>no cards yet</span>;
  return (
    <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
      {owned.map(c => <Gem key={c} color={c} size={20} count={bonus[c]} square />)}
    </div>
  );
}

function Holdings({ gems }) {
  const held = ALL_COLORS.filter(c => gems[c] > 0);
  if (!held.length) return <span style={{ fontSize: 11, color: '#9ca3af' }}>no gems</span>;
  return (
    <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
      {held.map(c => <Gem key={c} color={c} size={22} count={gems[c]} />)}
    </div>
  );
}

// ── The board ────────────────────────────────────────────────

export default function SplendorBoard({ gameState, playerId, playerNames, actions, resignedPlayer }) {
  // Gem picks and the pile you are handing back belong to one moment of the
  // game; tagging them with it means they fall away when play moves on.
  const turnKey = `${gameState.turnCount}:${gameState.turnStage}`;
  const [pick,   setPick]   = useState({ key: '', colors: [] });
  const [giveBack, setGiveBack] = useState({ key: '', gems: {} });
  const [sheet,   setSheet]   = useState(null);   // a card (or deck) being looked at
  const [showLog, setShowLog] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const order     = gameState.playerOrder;
  const me        = gameState.players[playerId];
  const currentId = order[gameState.currentPlayerIndex];
  const isMyTurn  = currentId === playerId;
  const stage     = gameState.turnStage;
  const name      = id => playerNames?.[id] ?? gameState.playerNames?.[id] ?? 'Player';

  const picked = useMemo(() => (pick.key === turnKey ? pick.colors : []), [pick, turnKey]);
  const giving = giveBack.key === turnKey ? giveBack.gems : {};
  const givingCount = Object.values(giving).reduce((a, b) => a + b, 0);
  const mustReturn  = me ? Math.max(0, totalGems(me.gems) - GEM_LIMIT) : 0;

  const myBonus   = useMemo(() => (me ? bonusesOf(gameState, me) : {}), [gameState, me]);
  const stuck = useMemo(
    () => isMyTurn && stage === 'action' && legalMoves(gameState, playerId).length === 0,
    [gameState, playerId, isMyTurn, stage],
  );

  // Ask the engine whether the gems picked make a legal take, so the player
  // is told why not in the engine's own words.
  const takeCheck = useMemo(() => {
    if (!isMyTurn || stage !== 'action' || picked.length === 0) return { ok: false, why: null };
    try { takeGems(gameState, playerId, picked); return { ok: true, why: null }; }
    catch (err) { return { ok: false, why: err.message }; }
  }, [gameState, playerId, isMyTurn, stage, picked]);

  const bank = gameState.bank;

  function togglePick(color) {
    if (!isMyTurn || stage !== 'action') return;
    let next;
    const isPair = picked.length === 2 && picked[0] === picked[1];
    if (picked.includes(color)) {
      if (isPair)                                         next = [];
      else if (picked.length === 1 && bank[color] >= 4)   next = [color, color];
      else                                                next = picked.filter(c => c !== color);
    } else if (isPair)                                    next = [color];
    else if (picked.length < 3 && bank[color] > 0)        next = [...picked, color];
    else                                                  next = picked;
    setPick({ key: turnKey, colors: next });
  }

  function toggleGive(color, delta) {
    const have = me.gems[color];
    const now  = giving[color] ?? 0;
    const next = Math.max(0, Math.min(have, now + delta));
    if (delta > 0 && givingCount >= mustReturn) return;
    setGiveBack({ key: turnKey, gems: { ...giving, [color]: next } });
  }

  // ── Status line ──
  const lastToAct = gameState.finalRound;
  let status, tone = 'idle';
  if (isMyTurn && stage === 'returnGems')  { status = `You hold more than ${GEM_LIMIT} gems — return ${mustReturn}`; tone = 'active'; }
  else if (stuck)                          { status = 'You have no legal move — pass your turn'; tone = 'active'; }
  else if (isMyTurn)                       { status = 'Your turn — take gems, reserve a card, or buy one'; tone = 'active'; }
  else                                     status = `Waiting for ${name(currentId)}…`;

  const mySheetCard = sheet?.kind === 'reserved'
    ? me?.reserved.find(c => c.id === sheet.id)
    : sheet?.kind === 'market' ? gameState.market[sheet.level][sheet.index] : null;

  const iconBtn = active => ({
    background: active ? '#ede9fe' : '#f3f4f6', border: active ? '1px solid #c4b5fd' : 'none',
    borderRadius: 10, width: 36, height: 36, fontSize: 18, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  });

  function openMarket(level, index) {
    const card = gameState.market[level][index];
    if (card) setSheet({ kind: 'market', level, index });
  }

  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column', background: '#f3f4f6',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    }}>
      {/* ── Header ── */}
      <div style={{
        background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '10px 16px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
      }}>
        <span style={{ fontWeight: 800, fontSize: 16, color: '#111827' }}>💎 Splendor</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            fontSize: 12, fontWeight: 600, borderRadius: 20, padding: '4px 12px',
            background: isMyTurn ? '#dcfce7' : '#f3f4f6', color: isMyTurn ? '#166534' : '#6b7280',
            border: `1px solid ${isMyTurn ? '#86efac' : '#e5e7eb'}`,
          }}>
            {isMyTurn ? '✦ Your Turn' : `${name(currentId)}'s turn`}
          </div>
          <button onClick={() => setShowLog(v => !v)} style={iconBtn(showLog)} title="Game log">📋</button>
          <button onClick={() => setShowSettings(true)} style={iconBtn(false)}>⚙️</button>
        </div>
      </div>

      {resignedPlayer && (
        <div style={{
          background: '#fef2f2', borderBottom: '1px solid #fca5a5', padding: '10px 16px',
          fontSize: 13, fontWeight: 600, color: '#dc2626', textAlign: 'center', flexShrink: 0,
        }}>
          {resignedPlayer} has resigned from the game
        </div>
      )}

      <div data-testid="status" style={{
        background: tone === 'active' ? '#ecfdf5' : '#fff', borderBottom: '1px solid #e5e7eb',
        padding: '8px 16px', fontSize: 13, fontWeight: 600, textAlign: 'center', flexShrink: 0,
        color: tone === 'active' ? '#166534' : '#6b7280',
      }}>
        {status}
        {lastToAct && (
          <div style={{ fontSize: 11, color: '#b45309', fontWeight: 700, marginTop: 2 }}>
            Final round — {WIN_POINTS} points reached, finishing the round
          </div>
        )}
      </div>

      {/* ── Table ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 12px 8px' }}>
        <div style={{ maxWidth: 480, margin: '0 auto' }}>

          {/* Opponents */}
          {order.filter(id => id !== playerId).map(id => {
            const p = gameState.players[id];
            return (
              <div key={id} data-testid={`opponent-${id}`} style={{
                background: '#fff', borderRadius: 12, padding: '8px 10px', marginBottom: 8,
                border: `2px solid ${id === currentId ? '#86efac' : 'transparent'}`,
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <div style={{ minWidth: 62 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 80 }}>
                    {name(id)}
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#b45309', lineHeight: 1.1 }}>
                    {scoreOf(p)}<span style={{ fontSize: 10, color: '#9ca3af', fontWeight: 600 }}> pts</span>
                  </div>
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                  <Holdings gems={p.gems} />
                  <Bonuses bonus={bonusesOf(gameState, p)} />
                </div>
                <div style={{ fontSize: 11, color: '#6b7280', textAlign: 'right', flexShrink: 0 }}>
                  {p.reserved.length > 0 && <div>📌 {p.reserved.length}</div>}
                  {p.nobles.length > 0 && <div>👑 {p.nobles.length}</div>}
                </div>
              </div>
            );
          })}

          {/* Nobles */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', margin: '10px 0', flexWrap: 'wrap' }}>
            {gameState.nobles.map(n => <NobleView key={n.id} noble={n} />)}
          </div>

          {/* Market */}
          {[3, 2, 1].map(level => (
            <div key={level} style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6, marginBottom: 6 }}>
              <button
                data-testid={`deck-${level}`}
                onClick={() => gameState.decks[level] > 0 && setSheet({ kind: 'deck', level })}
                style={{
                  aspectRatio: '0.72', borderRadius: 10, border: 'none', cursor: 'pointer',
                  background: ['', '#16a34a', '#d97706', '#2563eb'][level], color: '#fff',
                  opacity: gameState.decks[level] > 0 ? 1 : 0.3,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
                }}
              >
                <span style={{ fontSize: 15, fontWeight: 800 }}>{'●'.repeat(level)}</span>
                <span style={{ fontSize: 11, fontWeight: 700 }}>{gameState.decks[level]} left</span>
              </button>
              {gameState.market[level].map((card, i) => (
                <CardView
                  key={card?.id ?? `empty-${level}-${i}`}
                  card={card}
                  testId={card ? `card-${card.id}` : undefined}
                  canBuy={isMyTurn && stage === 'action' && card && me && paymentFor(me, card) !== null}
                  onClick={card ? () => openMarket(level, i) : undefined}
                />
              ))}
            </div>
          ))}

          {/* My reserved cards */}
          {me?.reserved.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', letterSpacing: '0.06em', marginBottom: 6 }}>
                YOUR RESERVED CARDS
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
                {me.reserved.map(card => (
                  <CardView
                    key={card.id} card={card} testId={`reserved-${card.id}`}
                    canBuy={isMyTurn && stage === 'action' && paymentFor(me, card) !== null}
                    onClick={() => setSheet({ kind: 'reserved', id: card.id })}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Dock: bank + you ── */}
      <div style={{
        background: '#fff', borderTop: '1px solid #e5e7eb', padding: '8px 12px 12px', flexShrink: 0,
      }}>
        <div style={{ maxWidth: 480, margin: '0 auto' }}>
          {/* Bank */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            {ALL_COLORS.map(c => {
              const n = picked.filter(x => x === c).length;
              return (
                <div key={c} style={{ position: 'relative' }}>
                  <Gem
                    color={c} size={44} count={bank[c]} testId={`bank-${c}`}
                    selected={n > 0}
                    dim={bank[c] === 0}
                    onClick={c !== 'gold' && isMyTurn && stage === 'action' ? () => togglePick(c) : undefined}
                  />
                  {n > 0 && (
                    <span style={{
                      position: 'absolute', top: -6, right: -6, background: '#facc15', color: '#422006',
                      borderRadius: 10, fontSize: 11, fontWeight: 800, padding: '0 5px',
                    }}>+{n}</span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Action line */}
          {isMyTurn && stage === 'action' && !stuck && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <button
                data-testid="take-gems"
                onClick={() => actions.spTake(picked)}
                disabled={!takeCheck.ok}
                style={{
                  flex: 1, border: 'none', borderRadius: 12, padding: '12px', fontSize: 14, fontWeight: 700,
                  color: '#fff', background: takeCheck.ok ? '#15803d' : '#d1d5db',
                  cursor: takeCheck.ok ? 'pointer' : 'not-allowed',
                }}
              >
                {picked.length === 0 ? 'Tap gems to take (3 different, or 2 of one)'
                  : takeCheck.ok ? `Take ${picked.length} gem${picked.length > 1 ? 's' : ''}`
                  : takeCheck.why}
              </button>
              {picked.length > 0 && (
                <button onClick={() => setPick({ key: turnKey, colors: [] })} style={{
                  background: '#f3f4f6', color: '#6b7280', border: 'none', borderRadius: 12,
                  padding: '12px 14px', fontSize: 14, cursor: 'pointer',
                }}>Clear</button>
              )}
            </div>
          )}

          {stuck && (
            <button data-testid="pass" onClick={actions.spPass} style={{
              width: '100%', marginBottom: 8, background: '#b45309', color: '#fff', border: 'none',
              borderRadius: 12, padding: '12px', fontSize: 14, fontWeight: 700, cursor: 'pointer',
            }}>Pass turn</button>
          )}

          {isMyTurn && stage === 'returnGems' && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>
                Tap your gems below to choose {mustReturn} to return.
              </div>
              <button
                data-testid="return-gems"
                onClick={() => actions.spReturn(giving)}
                disabled={givingCount !== mustReturn}
                style={{
                  width: '100%', border: 'none', borderRadius: 12, padding: '12px', fontSize: 14, fontWeight: 700,
                  color: '#fff', background: givingCount === mustReturn ? '#b45309' : '#d1d5db',
                  cursor: givingCount === mustReturn ? 'pointer' : 'not-allowed',
                }}
              >
                Return {givingCount} / {mustReturn} gems
              </button>
            </div>
          )}

          {/* You */}
          {me && (
            <div data-testid="me" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ minWidth: 62 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#111827' }}>You</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#b45309', lineHeight: 1.1 }}>
                  {scoreOf(me)}<span style={{ fontSize: 10, color: '#9ca3af', fontWeight: 600 }}> pts</span>
                </div>
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                  {ALL_COLORS.filter(c => me.gems[c] > 0).map(c => {
                    const out = giving[c] ?? 0;
                    return (
                      <div key={c} style={{ position: 'relative' }}>
                        <Gem
                          color={c} size={26} count={me.gems[c]} testId={`mine-${c}`}
                          selected={out > 0}
                          onClick={isMyTurn && stage === 'returnGems' ? () => toggleGive(c, +1) : undefined}
                        />
                        {out > 0 && (
                          <button onClick={() => toggleGive(c, -1)} style={{
                            position: 'absolute', top: -7, right: -7, background: '#b45309', color: '#fff',
                            border: 'none', borderRadius: 10, fontSize: 10, fontWeight: 800, padding: '0 5px', cursor: 'pointer',
                          }}>−{out}</button>
                        )}
                      </div>
                    );
                  })}
                  {totalGems(me.gems) === 0 && <span style={{ fontSize: 11, color: '#9ca3af' }}>no gems</span>}
                </div>
                <Bonuses bonus={myBonus} />
              </div>
              <div style={{ fontSize: 11, color: '#6b7280', textAlign: 'right', flexShrink: 0 }}>
                {me.nobles.length > 0 && <div>👑 {me.nobles.length}</div>}
                <div>{totalGems(me.gems)}/{GEM_LIMIT} gems</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {sheet && (
        <CardSheet
          sheet={sheet}
          card={mySheetCard}
          deckCount={sheet.kind === 'deck' ? gameState.decks[sheet.level] : 0}
          me={me}
          canAct={isMyTurn && stage === 'action'}
          onClose={() => setSheet(null)}
          onBuy={() => {
            actions.spBuy(sheet.kind === 'reserved'
              ? { reservedId: sheet.id }
              : { level: sheet.level, index: sheet.index });
            setSheet(null);
          }}
          onReserve={() => {
            actions.spReserve(sheet.kind === 'deck'
              ? { level: sheet.level, deck: true }
              : { level: sheet.level, index: sheet.index });
            setSheet(null);
          }}
        />
      )}

      {showLog && <GameLog entries={gameState.log ?? []} onClose={() => setShowLog(false)} />}
      {showSettings && (
        <SettingsSheet
          onClose={() => setShowSettings(false)}
          onResign={() => {
            if (window.confirm('Are you sure you want to resign?')) {
              actions.resignGame();
              setShowSettings(false);
            }
          }}
        />
      )}
    </div>
  );
}

// ── Sheets ───────────────────────────────────────────────────

function Sheet({ onClose, children }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(17,24,39,0.45)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: '16px 16px 0 0', width: '100%',
        maxWidth: 480, padding: '20px 20px 32px',
      }}>
        {children}
      </div>
    </div>
  );
}

const sheetBtn = (bg, color = '#fff', enabled = true) => ({
  width: '100%', background: enabled ? bg : '#e5e7eb', color: enabled ? color : '#9ca3af',
  border: 'none', borderRadius: 14, padding: '14px', fontSize: 15, fontWeight: 700,
  cursor: enabled ? 'pointer' : 'not-allowed', marginBottom: 10,
});

function CardSheet({ sheet, card, deckCount, me, canAct, onClose, onBuy, onReserve }) {
  const isDeck     = sheet.kind === 'deck';
  const isReserved = sheet.kind === 'reserved';
  const pay        = card && me ? paymentFor(me, card) : null;
  const canReserve = canAct && me && me.reserved.length < RESERVE_LIMIT && (!isDeck || deckCount > 0);

  return (
    <Sheet onClose={onClose}>
      {isDeck ? (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: '#111827' }}>Level {sheet.level} deck</div>
          <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>
            Reserve the top card without looking at it — only you will see it. {deckCount} left.
          </div>
        </div>
      ) : card && (
        <div style={{ display: 'flex', gap: 14, marginBottom: 16, alignItems: 'flex-start' }}>
          <div style={{ width: 96, flexShrink: 0 }}>
            <CardView card={card} width={96} />
          </div>
          <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.5 }}>
            <div style={{ fontWeight: 800, fontSize: 16, color: '#111827' }}>
              {COLOR_NAMES[card.bonus]} card{card.points ? ` · ${card.points} point${card.points > 1 ? 's' : ''}` : ''}
            </div>
            <div>Level {card.level}</div>
            {pay ? (
              <div style={{ marginTop: 6 }}>
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>You would pay</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {ALL_COLORS.filter(c => pay[c] > 0).map(c => <Gem key={c} color={c} size={24} count={pay[c]} />)}
                  {ALL_COLORS.every(c => pay[c] === 0) && <span style={{ fontWeight: 700, color: '#15803d' }}>Free!</span>}
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 6, color: '#b91c1c', fontWeight: 600 }}>You can't afford this yet.</div>
            )}
          </div>
        </div>
      )}

      {!isDeck && (
        <button data-testid="sheet-buy" onClick={pay && canAct ? onBuy : undefined} style={sheetBtn('#15803d', '#fff', !!pay && canAct)}>
          Buy card
        </button>
      )}
      {!isReserved && (
        <button data-testid="sheet-reserve" onClick={canReserve ? onReserve : undefined} style={sheetBtn('#b45309', '#fff', !!canReserve)}>
          {me && me.reserved.length >= RESERVE_LIMIT ? 'Reserve (you hold three)' : 'Reserve card'}
        </button>
      )}
      <button onClick={onClose} style={sheetBtn('#f3f4f6', '#6b7280')}>Close</button>
    </Sheet>
  );
}

function SettingsSheet({ onClose, onResign }) {
  return (
    <Sheet onClose={onClose}>
      <div style={{ fontSize: 18, fontWeight: 700, color: '#111827', marginBottom: 4 }}>⚙️ Settings</div>
      <div style={{ fontSize: 13, color: '#9ca3af', marginBottom: 24 }}>Game options</div>
      <button onClick={onResign} style={{
        width: '100%', background: '#fef2f2', color: '#dc2626',
        border: '2px solid #fca5a5', borderRadius: 14, padding: '16px',
        fontSize: 16, fontWeight: 700, cursor: 'pointer', marginBottom: 12,
      }}>🏳️ Resign Game</button>
      <button onClick={onClose} style={sheetBtn('#f3f4f6', '#6b7280')}>Close</button>
    </Sheet>
  );
}

function GameLog({ entries, onClose }) {
  return (
    <div style={{
      position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 50,
      display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#1e1b2e', borderRadius: '20px 20px 0 0', maxHeight: '60%',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '14px 20px 10px', borderBottom: '1px solid rgba(255,255,255,0.08)', flexShrink: 0,
        }}>
          <span style={{ fontWeight: 700, fontSize: 14, color: '#e5e7eb' }}>📋 Game Log</span>
          <button onClick={onClose} style={{
            background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 8,
            color: '#9ca3af', fontSize: 18, width: 30, height: 30, cursor: 'pointer', lineHeight: 1,
          }}>×</button>
        </div>
        <div style={{ overflowY: 'auto', padding: '12px 16px', flex: 1 }}>
          {entries.length === 0
            ? <div style={{ color: '#6b7280', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>Nothing yet.</div>
            : [...entries].reverse().map((e, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '5px 0' }}>
                <span style={{ fontSize: 10, color: '#6b7280', flexShrink: 0 }}>
                  {new Date(e.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                <span style={{ fontSize: 13, color: '#d1d5db', lineHeight: 1.4 }}>{e.message}</span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
