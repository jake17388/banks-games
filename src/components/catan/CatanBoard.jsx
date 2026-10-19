import { useState, useMemo } from 'react';
import BoardSvg, { PLAYER_COLORS, RESOURCE_ICON, RESOURCE_COLOR } from './BoardSvg.jsx';
import { RESOURCES, RESOURCE_NAMES } from '../../game/catan/board.js';
import {
  COSTS, DEV_NAMES, HAND_LIMIT, canPay, cardsIn, pointsOf, tradeRatios, longestRoadOf,
  legalSettlementVertices, legalCityVertices, legalRoadEdges, WIN_POINTS,
} from '../../game/catan/engine.js';

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const DICE = '⚀⚁⚂⚃⚄⚅';

const DEV_BLURB = {
  knight:       'Move the robber and steal a card. Three played makes the Largest Army.',
  roadBuilding: 'Build two roads for free.',
  yearOfPlenty: 'Take any two resources from the bank.',
  monopoly:     'Name a resource: every other player hands you all of theirs.',
  victoryPoint: 'Worth a point. Kept secret, and counted automatically.',
};

// ── Small pieces ─────────────────────────────────────────────

// A handful of cards of one kind: "2 🪵".
function Cards({ cards, size = 14 }) {
  const held = RESOURCES.filter(r => cards[r] > 0);
  return (
    <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      {held.map(r => (
        <span key={r} style={{ fontSize: size, fontWeight: 700, whiteSpace: 'nowrap' }}>
          {cards[r]}{RESOURCE_ICON[r]}
        </span>
      ))}
    </span>
  );
}

function ResourceCard({ resource, count, onClick, selected, dim, label, testId }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      data-testid={testId}
      onClick={onClick}
      style={{
        flex: 1, minWidth: 0, borderRadius: 10, padding: '6px 2px',
        background: RESOURCE_COLOR[resource], color: '#fff',
        border: `2px solid ${selected ? '#facc15' : 'rgba(0,0,0,0.18)'}`,
        boxShadow: selected ? '0 0 0 3px rgba(250,204,21,0.55)' : 'none',
        opacity: dim ? 0.35 : 1, cursor: onClick ? 'pointer' : 'default',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
        textShadow: '0 1px 2px rgba(0,0,0,0.45)',
      }}
    >
      <span style={{ fontSize: 18, lineHeight: 1.1 }}>{RESOURCE_ICON[resource]}</span>
      <span style={{ fontSize: 15, fontWeight: 800, lineHeight: 1.1 }}>{label ?? count}</span>
    </Tag>
  );
}

function PlayerTile({ state, id, name, current, isMe }) {
  const p = state.players[id];
  const c = PLAYER_COLORS[p.color];
  return (
    <div data-testid={`player-${id}`} style={{
      flex: 1, minWidth: 0, background: '#fff', borderRadius: 12, padding: '6px 8px',
      border: `2px solid ${current ? '#facc15' : 'transparent'}`,
      boxShadow: current ? '0 0 0 2px rgba(250,204,21,0.35)' : '0 1px 2px rgba(0,0,0,0.08)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 12, height: 12, borderRadius: '50%', background: c.fill, border: `2px solid ${c.dark}`, flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {isMe ? 'You' : name}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 1 }}>
        <span data-testid={`points-${id}`} style={{ fontSize: 20, fontWeight: 800, color: '#b45309', lineHeight: 1.1 }}>
          {pointsOf(state, id)}
        </span>
        <span style={{ fontSize: 10, color: '#9ca3af', fontWeight: 600 }}>VP</span>
      </div>
      <div style={{ display: 'flex', gap: 5, fontSize: 10.5, color: '#4b5563', flexWrap: 'wrap', fontWeight: 600 }}>
        <span title="Resource cards">🎴{cardsIn(p)}</span>
        <span title="Development cards">🃏{p.devCount ?? p.devCards.length}</span>
        <span title="Knights played">⚔️{p.knights}</span>
        <span title="Longest road">🛣️{longestRoadOf(state, id)}</span>
      </div>
      {(state.longestRoad.holder === id || state.largestArmy.holder === id) && (
        <div style={{ fontSize: 9.5, fontWeight: 800, color: '#92400e', marginTop: 2, lineHeight: 1.25 }}>
          {state.longestRoad.holder === id && <div>🏆 LONGEST ROAD</div>}
          {state.largestArmy.holder === id && <div>🏆 LARGEST ARMY</div>}
        </div>
      )}
    </div>
  );
}

// ── Sheets ───────────────────────────────────────────────────

function Sheet({ onClose, children, testId }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(17,24,39,0.5)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      <div data-testid={testId} onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: '16px 16px 0 0', width: '100%', maxWidth: 520,
        padding: '18px 18px 28px', maxHeight: '88%', overflowY: 'auto',
      }}>
        {children}
      </div>
    </div>
  );
}

const btn = (bg, color = '#fff', enabled = true) => ({
  width: '100%', background: enabled ? bg : '#e5e7eb', color: enabled ? color : '#9ca3af',
  border: 'none', borderRadius: 14, padding: '13px', fontSize: 15, fontWeight: 700,
  cursor: enabled ? 'pointer' : 'not-allowed', marginTop: 10,
});

// One row per resource with − / + around a count.
function Stepper({ values, max, onChange, testPrefix }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {RESOURCES.map(r => {
        const n = values[r] ?? 0;
        return (
          <div key={r} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              width: 38, height: 34, borderRadius: 8, background: RESOURCE_COLOR[r], fontSize: 18,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>{RESOURCE_ICON[r]}</span>
            <span style={{ flex: 1, fontSize: 14, color: '#374151' }}>{RESOURCE_NAMES[r]}</span>
            <button data-testid={`${testPrefix}-${r}-minus`} onClick={() => onChange(r, Math.max(0, n - 1))}
                    disabled={n === 0} style={stepBtn(n > 0)}>−</button>
            <span style={{ width: 22, textAlign: 'center', fontWeight: 800, fontSize: 16 }}>{n}</span>
            <button data-testid={`${testPrefix}-${r}-plus`} onClick={() => onChange(r, n + 1)}
                    disabled={n >= max[r]} style={stepBtn(n < max[r])}>+</button>
          </div>
        );
      })}
    </div>
  );
}

const stepBtn = on => ({
  width: 34, height: 34, borderRadius: 10, border: 'none', fontSize: 20, fontWeight: 700, lineHeight: 1,
  background: on ? '#e0e7ff' : '#f3f4f6', color: on ? '#3730a3' : '#d1d5db', cursor: on ? 'pointer' : 'not-allowed',
});

function DiscardSheet({ me, need, onDiscard }) {
  const [cards, setCards] = useState({});
  const total = RESOURCES.reduce((n, r) => n + (cards[r] ?? 0), 0);
  const max = Object.fromEntries(RESOURCES.map(r => [
    r, total >= need ? (cards[r] ?? 0) : me.resources[r],
  ]));
  return (
    <Sheet testId="discard-sheet" onClose={() => {}}>
      <div style={{ fontSize: 18, fontWeight: 800, color: '#111827' }}>🥷 The robber strikes!</div>
      <div style={{ fontSize: 13, color: '#6b7280', margin: '4px 0 14px' }}>
        A 7 was rolled and you hold more than {HAND_LIMIT} cards. Discard {need}.
      </div>
      <Stepper values={cards} max={max} testPrefix="discard"
               onChange={(r, n) => setCards(c => ({ ...c, [r]: Math.min(n, me.resources[r]) }))} />
      <button data-testid="discard-confirm" onClick={total === need ? () => onDiscard(cards) : undefined}
              style={btn('#b45309', '#fff', total === need)}>
        Discard {total} / {need}
      </button>
    </Sheet>
  );
}

function StealSheet({ victims, name, state, onSteal }) {
  return (
    <Sheet testId="steal-sheet" onClose={() => {}}>
      <div style={{ fontSize: 18, fontWeight: 800, color: '#111827', marginBottom: 4 }}>Who do you rob?</div>
      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 6 }}>You take one random card from them.</div>
      {victims.map(id => (
        <button key={id} data-testid={`steal-${id}`} onClick={() => onSteal(id)} style={btn('#374151')}>
          {name(id)} · {cardsIn(state.players[id])} cards
        </button>
      ))}
    </Sheet>
  );
}

function PickSheet({ title, blurb, count, onPick, onClose }) {
  const [picked, setPicked] = useState([]);
  const add = r => setPicked(p => (p.length < count ? [...p, r] : p));
  return (
    <Sheet testId="pick-sheet" onClose={onClose}>
      <div style={{ fontSize: 18, fontWeight: 800, color: '#111827' }}>{title}</div>
      <div style={{ fontSize: 13, color: '#6b7280', margin: '4px 0 12px' }}>{blurb}</div>
      <div style={{ display: 'flex', gap: 6 }}>
        {RESOURCES.map(r => (
          <ResourceCard key={r} resource={r} label={picked.filter(x => x === r).length || ''}
                        testId={`pick-${r}`} onClick={() => add(r)} selected={picked.includes(r)} />
        ))}
      </div>
      <button data-testid="pick-confirm" onClick={picked.length === count ? () => onPick(picked) : undefined}
              style={btn('#15803d', '#fff', picked.length === count)}>Confirm</button>
      {picked.length > 0 && <button onClick={() => setPicked([])} style={btn('#f3f4f6', '#6b7280')}>Clear</button>}
      <button onClick={onClose} style={btn('#f3f4f6', '#6b7280')}>Cancel</button>
    </Sheet>
  );
}

function DevSheet({ state, me, canPlay, onBuy, onPlay, onClose }) {
  const [picking, setPicking] = useState(null);
  const canBuy = canPlay.main && canPay(me.resources, COSTS.dev) && state.devDeck > 0;

  const count = type => me.devCards.filter(c => c.type === type).length;
  const ready = type => me.devCards.filter(c => c.type === type && c.turn !== state.turnNumber).length;

  if (picking === 'yearOfPlenty') {
    return <PickSheet title="Year of Plenty" blurb="Choose any two resources from the bank." count={2}
                      onClose={() => setPicking(null)}
                      onPick={resources => onPlay('yearOfPlenty', { resources })} />;
  }
  if (picking === 'monopoly') {
    return <PickSheet title="Monopoly" blurb="Choose the resource to take from every other player." count={1}
                      onClose={() => setPicking(null)}
                      onPick={([resource]) => onPlay('monopoly', { resource })} />;
  }

  return (
    <Sheet testId="dev-sheet" onClose={onClose}>
      <div style={{ fontSize: 18, fontWeight: 800, color: '#111827', marginBottom: 10 }}>🃏 Development cards</div>
      <button data-testid="buy-dev" onClick={canBuy ? onBuy : undefined} style={{ ...btn('#7c3aed', '#fff', canBuy), marginTop: 0 }}>
        Buy a card · 🐑🌾🪨 · {state.devDeck} left
      </button>
      <div style={{ marginTop: 14 }}>
        {['knight', 'roadBuilding', 'yearOfPlenty', 'monopoly', 'victoryPoint'].map(type => {
          const n = count(type);
          if (!n && type !== 'knight') return null;
          const playable = type !== 'victoryPoint' && canPlay.any && ready(type) > 0;
          return (
            <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid #f3f4f6' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#111827' }}>
                  {DEV_NAMES[type]} <span style={{ color: '#7c3aed' }}>×{n}</span>
                  {n > ready(type) && type !== 'victoryPoint' && (
                    <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 500 }}> ({n - ready(type)} new)</span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>{DEV_BLURB[type]}</div>
              </div>
              {type !== 'victoryPoint' && (
                <button data-testid={`play-${type}`} disabled={!playable} style={{
                  border: 'none', borderRadius: 10, padding: '8px 14px', fontWeight: 700, fontSize: 13,
                  background: playable ? '#15803d' : '#e5e7eb', color: playable ? '#fff' : '#9ca3af',
                  cursor: playable ? 'pointer' : 'not-allowed',
                }} onClick={() => {
                  if (type === 'yearOfPlenty' || type === 'monopoly') setPicking(type);
                  else onPlay(type, {});
                }}>Play</button>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 11.5, color: '#9ca3af', marginTop: 10 }}>
        One development card per turn, and not on the turn you bought it.
      </div>
      <button onClick={onClose} style={btn('#f3f4f6', '#6b7280')}>Close</button>
    </Sheet>
  );
}

function TradeSheet({ state, me, ratios, actions, onClose }) {
  const [tab,  setTab]  = useState('bank');
  const [give, setGive] = useState(null);
  const [get,  setGet]  = useState(null);
  const [offerGive, setOfferGive] = useState({});
  const [offerWant, setOfferWant] = useState({});

  const canSwap = give && get && give !== get && me.resources[give] >= ratios[give] && state.bank[get] > 0;
  const giveTotal = RESOURCES.reduce((n, r) => n + (offerGive[r] ?? 0), 0);
  const wantTotal = RESOURCES.reduce((n, r) => n + (offerWant[r] ?? 0), 0);
  const overlap   = RESOURCES.some(r => offerGive[r] > 0 && offerWant[r] > 0);
  const canOffer  = giveTotal > 0 && wantTotal > 0 && !overlap;

  const tabStyle = on => ({
    flex: 1, border: 'none', borderRadius: 10, padding: '9px', fontWeight: 700, fontSize: 14, cursor: 'pointer',
    background: on ? '#1d4ed8' : '#f3f4f6', color: on ? '#fff' : '#6b7280',
  });

  return (
    <Sheet testId="trade-sheet" onClose={onClose}>
      <div style={{ fontSize: 18, fontWeight: 800, color: '#111827', marginBottom: 10 }}>🤝 Trade</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button data-testid="tab-bank" onClick={() => setTab('bank')} style={tabStyle(tab === 'bank')}>With the bank</button>
        <button data-testid="tab-players" onClick={() => setTab('players')} style={tabStyle(tab === 'players')}>With players</button>
      </div>

      {tab === 'bank' ? (
        <>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', marginBottom: 6 }}>YOU GIVE</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
            {RESOURCES.map(r => (
              <ResourceCard key={r} resource={r} testId={`give-${r}`} label={`${ratios[r]}:1`}
                            dim={me.resources[r] < ratios[r]} selected={give === r}
                            onClick={me.resources[r] >= ratios[r] ? () => setGive(r) : undefined} />
            ))}
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', marginBottom: 6 }}>YOU GET</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {RESOURCES.map(r => (
              <ResourceCard key={r} resource={r} testId={`get-${r}`} label={state.bank[r]}
                            dim={state.bank[r] === 0} selected={get === r}
                            onClick={state.bank[r] > 0 ? () => setGet(r) : undefined} />
            ))}
          </div>
          <div style={{ fontSize: 11.5, color: '#9ca3af', marginTop: 6 }}>
            Ratios show what each resource costs you — settle on a harbour to improve them. The bank's stock is under "You get".
          </div>
          <button data-testid="bank-trade" onClick={canSwap ? () => actions.ctBankTrade(give, get) : undefined}
                  style={btn('#15803d', '#fff', !!canSwap)}>
            {give && get && give !== get
              ? `Trade ${ratios[give]} ${RESOURCE_ICON[give]} for 1 ${RESOURCE_ICON[get]}`
              : 'Pick what to give and what to get'}
          </button>
        </>
      ) : (
        <>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', marginBottom: 6 }}>YOU GIVE</div>
          <Stepper values={offerGive} max={me.resources} testPrefix="offer-give"
                   onChange={(r, n) => setOfferGive(v => ({ ...v, [r]: n }))} />
          <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', margin: '14px 0 6px' }}>YOU WANT</div>
          <Stepper values={offerWant} max={Object.fromEntries(RESOURCES.map(r => [r, 9]))} testPrefix="offer-want"
                   onChange={(r, n) => setOfferWant(v => ({ ...v, [r]: n }))} />
          {overlap && <div style={{ fontSize: 12, color: '#b91c1c', marginTop: 8 }}>You can't trade a resource for itself.</div>}
          <button data-testid="send-offer" onClick={canOffer ? () => { actions.ctOffer(offerGive, offerWant); onClose(); } : undefined}
                  style={btn('#1d4ed8', '#fff', canOffer)}>Offer to the table</button>
        </>
      )}
      <button onClick={onClose} style={btn('#f3f4f6', '#6b7280')}>Close</button>
    </Sheet>
  );
}

function SettingsSheet({ onClose, onResign }) {
  return (
    <Sheet onClose={onClose}>
      <div style={{ fontSize: 18, fontWeight: 700, color: '#111827', marginBottom: 4 }}>⚙️ Settings</div>
      <div style={{ fontSize: 13, color: '#9ca3af', marginBottom: 20 }}>Game options</div>
      <button onClick={onResign} style={{
        width: '100%', background: '#fef2f2', color: '#dc2626',
        border: '2px solid #fca5a5', borderRadius: 14, padding: '16px',
        fontSize: 16, fontWeight: 700, cursor: 'pointer', marginBottom: 4,
      }}>🏳️ Resign Game</button>
      <button onClick={onClose} style={btn('#f3f4f6', '#6b7280')}>Close</button>
    </Sheet>
  );
}

function GameLog({ entries, onClose }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 100,
      display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#1e1b2e', borderRadius: '20px 20px 0 0', maxHeight: '60%',
        display: 'flex', flexDirection: 'column', width: '100%', maxWidth: 520, margin: '0 auto',
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

// ── Trade offers on the table ────────────────────────────────

function OfferBanner({ state, playerId, name, actions }) {
  const t = state.trade;
  const mine = t.from === playerId;
  const others = state.playerOrder.filter(id => id !== t.from);
  const me = state.players[playerId];
  const answer = t.responses[playerId];

  const row = {
    background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 12, padding: '8px 10px', marginBottom: 8,
  };

  if (mine) {
    return (
      <div data-testid="my-offer" style={row}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#1e3a8a' }}>
          Your offer: <Cards cards={t.give} /> → <Cards cards={t.want} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
          {others.map(id => {
            const r = t.responses[id];
            return (
              <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <span style={{ flex: 1, color: '#374151' }}>{name(id)}</span>
                {r === 'accept' ? (
                  <button data-testid={`confirm-${id}`} onClick={() => actions.ctConfirm(id)} style={{
                    background: '#15803d', color: '#fff', border: 'none', borderRadius: 8, padding: '5px 12px', fontWeight: 700, cursor: 'pointer',
                  }}>✓ Trade with {name(id)}</button>
                ) : (
                  <span style={{ color: r === 'decline' ? '#b91c1c' : '#9ca3af', fontWeight: 600 }}>
                    {r === 'decline' ? '✗ declined' : 'thinking…'}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <button data-testid="cancel-offer" onClick={actions.ctCancelTrade} style={{
          marginTop: 8, background: 'none', border: 'none', color: '#6b7280', fontSize: 12, cursor: 'pointer', padding: 0,
        }}>Cancel offer</button>
      </div>
    );
  }

  if (!me) return null;
  const affordable = canPay(me.resources, t.want);
  return (
    <div data-testid="their-offer" style={row}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#1e3a8a' }}>
        {name(t.from)} offers <Cards cards={t.give} /> for your <Cards cards={t.want} />
      </div>
      {answer ? (
        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
          {answer === 'accept' ? `You accepted — waiting for ${name(t.from)}…` : 'You declined.'}
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <button data-testid="accept-offer" onClick={affordable ? () => actions.ctRespond(true) : undefined} style={{
            flex: 1, border: 'none', borderRadius: 10, padding: '8px', fontWeight: 700, fontSize: 14,
            background: affordable ? '#15803d' : '#e5e7eb', color: affordable ? '#fff' : '#9ca3af',
            cursor: affordable ? 'pointer' : 'not-allowed',
          }}>{affordable ? 'Accept' : "Can't afford"}</button>
          <button data-testid="decline-offer" onClick={() => actions.ctRespond(false)} style={{
            flex: 1, border: 'none', borderRadius: 10, padding: '8px', fontWeight: 700, fontSize: 14,
            background: '#fee2e2', color: '#b91c1c', cursor: 'pointer',
          }}>Decline</button>
        </div>
      )}
    </div>
  );
}

// ── The screen ───────────────────────────────────────────────

export default function CatanBoard({ gameState, playerId, playerNames, actions, resignedPlayer }) {
  const [mode,  setMode]  = useState(null);     // road | settlement | city: what a tap on the board builds
  const [sheet, setSheet] = useState(null);     // trade | dev
  const [showLog, setShowLog] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const state     = gameState;
  const order     = state.playerOrder;
  const me        = state.players[playerId];
  const inSetup   = state.phase === 'setup';
  const over      = state.phase === 'gameover';
  const currentId = order[state.currentPlayerIndex];
  const isMyTurn  = currentId === playerId && !over;
  const stage     = state.turnStage;
  const name      = id => playerNames?.[id] ?? state.playerNames?.[id] ?? 'Player';

  const myMain = isMyTurn && stage === 'main';
  const buildMode = myMain ? mode : null;
  const placed = inSetup ? state.setup.placed : null;
  const pendingDiscard = me && stage === 'discard' ? state.discarding[playerId] : undefined;

  // What the board lets you tap right now.
  const targets = useMemo(() => {
    const none = { vertices: new Set(), edges: new Set(), hexes: new Set() };
    if (!me || !isMyTurn) return none;
    if (inSetup) {
      return placed === null
        ? { ...none, vertices: new Set(legalSettlementVertices(state, playerId, { setup: true })) }
        : { ...none, edges: new Set(legalRoadEdges(state, playerId, { from: placed })) };
    }
    if (stage === 'robber') {
      return { ...none, hexes: new Set(state.hexes.filter(h => h.id !== state.robber).map(h => h.id)) };
    }
    if (stage === 'roadBuilding') return { ...none, edges: new Set(legalRoadEdges(state, playerId)) };
    if (buildMode === 'road')       return { ...none, edges: new Set(legalRoadEdges(state, playerId)) };
    if (buildMode === 'settlement') return { ...none, vertices: new Set(legalSettlementVertices(state, playerId)) };
    if (buildMode === 'city')       return { ...none, vertices: new Set(legalCityVertices(state, playerId)) };
    return none;
  }, [state, me, playerId, isMyTurn, inSetup, placed, stage, buildMode]);

  const can = useMemo(() => {
    if (!me || !myMain) return {};
    return {
      road:       me.pieces.road > 0 && canPay(me.resources, COSTS.road) && legalRoadEdges(state, playerId).length > 0,
      settlement: me.pieces.settlement > 0 && canPay(me.resources, COSTS.settlement) && legalSettlementVertices(state, playerId).length > 0,
      city:       me.pieces.city > 0 && canPay(me.resources, COSTS.city) && legalCityVertices(state, playerId).length > 0,
      dev:        state.devDeck > 0 && canPay(me.resources, COSTS.dev),
    };
  }, [state, me, playerId, myMain]);

  const ratios = useMemo(() => (me ? tradeRatios(state, playerId) : null), [state, me, playerId]);

  function onVertex(id) {
    if (inSetup || buildMode === 'settlement') actions.ctSettlement(id);
    else if (buildMode === 'city') actions.ctCity(id);
    setMode(null);
  }
  function onEdge(id) {
    actions.ctRoad(id);
    setMode(null);
  }
  function onHex(id) {
    actions.ctRobber(id);
  }

  // ── Status line ──
  let status, tone = 'idle';
  if (over) status = state.winner ? `${name(state.winner)} won the game` : 'Game over';
  else if (inSetup) {
    const who = state.setup.seq[state.setup.index];
    if (who === playerId) { status = placed === null ? 'Place a settlement' : 'Now place a road next to it'; tone = 'active'; }
    else status = `${name(who)} is placing…`;
  } else if (pendingDiscard !== undefined) { status = `Discard ${pendingDiscard} cards`; tone = 'active'; }
  else if (stage === 'discard') {
    const waiting = Object.keys(state.discarding).map(name).join(', ');
    status = `Waiting for ${waiting} to discard…`;
  } else if (isMyTurn) {
    tone = 'active';
    status = {
      roll:         'Your turn — roll the dice',
      robber:       'Move the robber — tap a tile',
      steal:        'Choose who to rob',
      roadBuilding: `Place your free road${state.freeRoads > 1 ? 's' : ''} (${state.freeRoads} left)`,
      main:         buildMode ? `Tap a spot to build a ${buildMode}` : 'Build, trade, or end your turn',
    }[stage];
  } else status = `${name(currentId)} is ${stage === 'roll' ? 'about to roll' : stage === 'robber' ? 'moving the robber' : 'playing'}…`;

  const lastLog = state.log[state.log.length - 1]?.message;
  const iconBtn = {
    background: '#f3f4f6', border: 'none', borderRadius: 10, width: 36, height: 36, fontSize: 18,
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
  };
  const canPlayDev = {
    any:  isMyTurn && (stage === 'roll' || stage === 'main') && !state.devPlayed,
    main: myMain,
  };

  const buildBtn = (kind, icon, label, cost) => {
    const on = !!can[kind];
    const active = buildMode === kind;
    return (
      <button key={kind} data-testid={`build-${kind}`} disabled={!on}
              onClick={() => setMode(active ? null : kind)}
              style={{
                flex: 1, minWidth: 0, borderRadius: 12, padding: '7px 2px', cursor: on ? 'pointer' : 'not-allowed',
                border: `2px solid ${active ? '#facc15' : on ? '#16a34a' : '#e5e7eb'}`,
                background: active ? '#fef9c3' : on ? '#f0fdf4' : '#f9fafb',
                color: on ? '#14532d' : '#9ca3af', opacity: on ? 1 : 0.7,
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
              }}>
        <span style={{ fontSize: 19, lineHeight: 1.1 }}>{icon}</span>
        <span style={{ fontSize: 11, fontWeight: 700 }}>{label}</span>
        <span style={{ fontSize: 10, letterSpacing: '-0.02em' }}>{cost}</span>
      </button>
    );
  };

  const primary = (bg, enabled = true) => ({
    flex: 1, border: 'none', borderRadius: 12, padding: '12px', fontSize: 15, fontWeight: 800,
    color: '#fff', background: enabled ? bg : '#d1d5db', cursor: enabled ? 'pointer' : 'not-allowed',
  });
  const secondary = on => ({
    flex: 1, border: '1px solid #d1d5db', borderRadius: 12, padding: '10px 4px', fontSize: 13, fontWeight: 700,
    background: '#fff', color: on ? '#111827' : '#9ca3af', cursor: on ? 'pointer' : 'not-allowed',
  });

  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column', background: '#f3f4f6', fontFamily: FONT,
      maxWidth: 560, margin: '0 auto', width: '100%',
    }}>
      {/* ── Header ── */}
      <div style={{
        background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '8px 14px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
      }}>
        <span style={{ fontWeight: 800, fontSize: 16, color: '#111827' }}>🏝️ Catan</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            fontSize: 12, fontWeight: 600, borderRadius: 20, padding: '4px 12px',
            background: isMyTurn ? '#dcfce7' : '#f3f4f6', color: isMyTurn ? '#166534' : '#6b7280',
            border: `1px solid ${isMyTurn ? '#86efac' : '#e5e7eb'}`,
          }}>
            {isMyTurn ? '✦ Your Turn' : `${name(currentId)}'s turn`}
          </div>
          <button onClick={() => setShowLog(true)} style={iconBtn} title="Game log">📋</button>
          <button onClick={() => setShowSettings(true)} style={iconBtn}>⚙️</button>
        </div>
      </div>

      {resignedPlayer && (
        <div style={{
          background: '#fef2f2', borderBottom: '1px solid #fca5a5', padding: '8px 16px',
          fontSize: 13, fontWeight: 600, color: '#dc2626', textAlign: 'center', flexShrink: 0,
        }}>
          {resignedPlayer} has resigned from the game
        </div>
      )}

      {/* ── Scoreboard ── */}
      <div style={{ display: 'flex', gap: 6, padding: '8px 8px 4px', flexShrink: 0 }}>
        {order.map(id => (
          <PlayerTile key={id} state={state} id={id} name={name(id)} current={id === currentId && !over} isMe={id === playerId} />
        ))}
      </div>

      <div data-testid="status" style={{
        background: tone === 'active' ? '#ecfdf5' : '#fff', borderTop: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb',
        padding: '6px 14px', textAlign: 'center', flexShrink: 0,
        fontSize: 13, fontWeight: 700, color: tone === 'active' ? '#166534' : '#6b7280',
      }}>
        {status}
        {lastLog && <div style={{ fontSize: 11, fontWeight: 500, color: '#9ca3af', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{lastLog}</div>}
      </div>

      {/* ── Board ── */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative', background: '#1b5f8f' }}>
        <BoardSvg state={state} targets={targets} onVertex={onVertex} onEdge={onEdge} onHex={onHex} />
        {state.dice && (
          <div data-testid="dice" style={{
            position: 'absolute', left: 8, bottom: 8, background: 'rgba(255,255,255,0.92)', borderRadius: 12,
            padding: '2px 10px', display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <span style={{ fontSize: 34, lineHeight: 1.15, color: '#111827' }}>{DICE[state.dice[0] - 1]}{DICE[state.dice[1] - 1]}</span>
            <span style={{ fontSize: 18, fontWeight: 800, color: state.dice[0] + state.dice[1] === 7 ? '#b91c1c' : '#111827' }}>
              {state.dice[0] + state.dice[1]}
            </span>
          </div>
        )}
      </div>

      {/* ── Dock ── */}
      <div style={{ background: '#fff', borderTop: '1px solid #e5e7eb', padding: '8px 10px 12px', flexShrink: 0 }}>
        {state.trade && stage === 'main' && !over && (
          <OfferBanner state={state} playerId={playerId} name={name} actions={actions} />
        )}

        {me && (
          <div style={{ display: 'flex', gap: 5, marginBottom: 8 }}>
            {RESOURCES.map(r => <ResourceCard key={r} resource={r} count={me.resources[r]} testId={`hand-${r}`} dim={me.resources[r] === 0} />)}
          </div>
        )}

        {isMyTurn && stage === 'roll' && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <button data-testid="roll" onClick={actions.ctRoll} style={primary('#b45309')}>🎲 Roll dice</button>
            {canPlayDev.any && me.devCards.some(c => c.type !== 'victoryPoint' && c.turn !== state.turnNumber) && (
              <button data-testid="open-dev" onClick={() => setSheet('dev')} style={{ ...secondary(true), flex: '0 0 38%' }}>🃏 Play a card</button>
            )}
          </div>
        )}

        {myMain && (
          <>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              {buildBtn('road', '🛣️', 'Road', '🪵🧱')}
              {buildBtn('settlement', '🏠', 'Settlement', '🪵🧱🐑🌾')}
              {buildBtn('city', '🏙️', 'City', '🌾🌾🪨🪨🪨')}
              <button data-testid="open-dev" onClick={() => setSheet('dev')} style={{
                flex: 1, minWidth: 0, borderRadius: 12, padding: '7px 2px', cursor: 'pointer',
                border: '2px solid #ddd6fe', background: '#f5f3ff', color: '#5b21b6',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
              }}>
                <span style={{ fontSize: 19, lineHeight: 1.1 }}>🃏</span>
                <span style={{ fontSize: 11, fontWeight: 700 }}>Cards ({me.devCards.length})</span>
                <span style={{ fontSize: 10 }}>🐑🌾🪨</span>
              </button>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button data-testid="open-trade" onClick={() => setSheet('trade')} style={secondary(true)}>🤝 Trade</button>
              <button data-testid="end-turn" onClick={() => { setMode(null); actions.ctEnd(); }} style={primary('#1d4ed8')}>End turn ▶</button>
            </div>
          </>
        )}

        {!isMyTurn && me && !over && (
          <div style={{ fontSize: 12, color: '#9ca3af', textAlign: 'center' }}>
            {inSetup ? 'Each player places two settlements and two roads — the second settlement earns its neighbouring resources.'
              : `First to ${WIN_POINTS} victory points wins.`}
          </div>
        )}
        {isMyTurn && inSetup && (
          <div style={{ fontSize: 12, color: '#6b7280', textAlign: 'center' }}>
            Tap a glowing spot on the board.
          </div>
        )}
        {isMyTurn && (stage === 'robber' || stage === 'roadBuilding') && (
          <div style={{ fontSize: 12, color: '#6b7280', textAlign: 'center' }}>Tap a glowing spot on the board.</div>
        )}
      </div>

      {/* ── Sheets ── */}
      {pendingDiscard !== undefined && (
        <DiscardSheet me={me} need={pendingDiscard} onDiscard={actions.ctDiscard} />
      )}
      {isMyTurn && stage === 'steal' && (
        <StealSheet victims={state.stealFrom} name={name} state={state} onSteal={actions.ctSteal} />
      )}
      {sheet === 'trade' && myMain && (
        <TradeSheet state={state} me={me} ratios={ratios} actions={actions} onClose={() => setSheet(null)} />
      )}
      {sheet === 'dev' && me && isMyTurn && (stage === 'roll' || stage === 'main') && (
        <DevSheet
          state={state} me={me} canPlay={canPlayDev}
          onBuy={actions.ctBuyDev}
          onPlay={(type, options) => { actions.ctPlayDev(type, options); setSheet(null); }}
          onClose={() => setSheet(null)}
        />
      )}

      {showLog && <GameLog entries={state.log ?? []} onClose={() => setShowLog(false)} />}
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
