import { useState, useMemo } from 'react';
import BoardSvg, { PLAYER_COLORS, RESOURCE_ICON, RESOURCE_COLOR } from './BoardSvg.jsx';
import { RESOURCES, RESOURCE_NAMES } from '../../game/catan/board.js';
import {
  COSTS, DEV_NAMES, HAND_LIMIT, canPay, cardsIn, pointsOf, tradeRatios, longestRoadOf,
  legalSettlementVertices, legalCityVertices, legalRoadEdges, WIN_POINTS,
} from '../../game/catan/engine.js';

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

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

function PlayerTile({ state, id, name, current, isMe, chip }) {
  const p = state.players[id];
  const c = PLAYER_COLORS[p.color];
  const light = p.color === 3;
  const roadHolder = state.longestRoad.holder === id;
  const armyHolder = state.largestArmy.holder === id;
  const stat = (hot) => ({ color: hot ? '#fde047' : '#e2e8f0', fontWeight: hot ? 800 : 600 });
  return (
    <div data-testid={`player-${id}`} style={{ flex: 1, minWidth: 0, maxWidth: 170 }}>
      <div style={{
        borderRadius: 10, overflow: 'hidden', background: '#16305f',
        boxShadow: current ? '0 0 0 2px #facc15, 0 2px 8px rgba(0,0,0,0.35)' : '0 2px 6px rgba(0,0,0,0.3)',
        transition: 'box-shadow 200ms',
      }}>
        <div style={{
          background: c.fill, height: 26, display: 'flex', alignItems: 'center', gap: 4, paddingRight: 6,
          color: light ? '#1f2937' : '#fff',
        }}>
          <span data-testid={`points-${id}`} style={{
            width: 28, height: 28, margin: '-2px 0 -2px -2px', borderRadius: '50%', background: '#111827', color: '#fff',
            border: `2px solid ${c.dark}`, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 15, fontWeight: 800, flexShrink: 0, zIndex: 1,
          }}>{pointsOf(state, id)}</span>
          <span style={{ fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {isMe ? 'You' : name}
          </span>
        </div>
        <div style={{
          height: 44, padding: '4px 8px', display: 'grid', gridTemplateColumns: '1fr 1fr',
          alignContent: 'center', columnGap: 4, rowGap: 1, fontSize: 11.5,
        }}>
          <span title="Resource cards" style={stat()}>🎴 {cardsIn(p)}</span>
          <span title="Development cards" style={stat()}>🃏 {p.devCount ?? p.devCards.length}</span>
          <span title="Knights played (Largest Army)" style={stat(armyHolder)}>⚔️ {p.knights}</span>
          <span title="Longest road" style={stat(roadHolder)}>🛣️ {longestRoadOf(state, id)}</span>
        </div>
      </div>
      <div style={{ height: 38, marginTop: 3, visibility: chip ? 'visible' : 'hidden' }}>
        {chip && (
          <div key={chip.title + chip.sub} className="ct-chip" style={{
            height: '100%', borderRadius: 8, background: chip.tone === 'active' ? '#3b82f6' : 'rgba(15,35,75,0.75)',
            color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            lineHeight: 1.2, padding: '0 4px', textAlign: 'center', overflow: 'hidden',
          }}>
            <span style={{ fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{chip.title}</span>
            <span style={{ fontSize: 10.5, opacity: 0.85, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{chip.sub}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sheets ───────────────────────────────────────────────────

function Sheet({ onClose, children, testId }) {
  return (
    <div onClick={onClose} className="ct-fade" style={{
      position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(17,24,39,0.5)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      <div data-testid={testId} className="ct-sheet" onClick={e => e.stopPropagation()} style={{
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

// ── Fixed-layout pieces ──────────────────────────────────────

const PIPS = {
  1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
};

function Die({ value, dim }) {
  return (
    <div style={{
      width: 46, height: 46, borderRadius: 10, background: '#f8fafc', boxShadow: '0 3px 0 #94a3b8, 0 4px 8px rgba(0,0,0,0.3)',
      display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gridTemplateRows: 'repeat(3, 1fr)',
      padding: 7, opacity: dim ? 0.5 : 1, transition: 'opacity 200ms',
    }}>
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} style={{
          width: 8, height: 8, borderRadius: '50%', placeSelf: 'center',
          background: PIPS[value].includes(i) ? '#1e293b' : 'transparent',
        }} />
      ))}
    </div>
  );
}

// A card in the hand strip: art, with the count in a corner badge.
function HandCard({ bg, icon, count, testId, onClick, label }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag data-testid={testId} onClick={onClick} className="ct-card-in" style={{
      position: 'relative', flex: '0 0 auto', width: 52, height: 74, borderRadius: 9, background: bg,
      border: '2px solid rgba(255,255,255,0.7)', boxShadow: '0 2px 5px rgba(0,0,0,0.35)', padding: 0,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
      cursor: onClick ? 'pointer' : 'default', color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.45)',
    }}>
      <span style={{ fontSize: 26, lineHeight: 1 }}>{icon}</span>
      {label && <span style={{ fontSize: 9, fontWeight: 700 }}>{label}</span>}
      <span style={{
        position: 'absolute', top: -5, right: -5, minWidth: 20, height: 20, borderRadius: 10, background: '#2563eb',
        border: '2px solid #fff', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center',
        justifyContent: 'center', padding: '0 3px', textShadow: 'none',
      }}>{count}</span>
    </Tag>
  );
}

const DEV_ICON = { knight: '⚔️', roadBuilding: '🛣️', yearOfPlenty: '🎁', monopoly: '🎩', victoryPoint: '🏆' };

function ActionButton({ icon, label, onClick, enabled, hot, testId }) {
  return (
    <button data-testid={testId} onClick={enabled ? onClick : undefined} disabled={!enabled}
            className={hot ? 'ct-hot' : undefined} style={{
      width: 74, height: 60, borderRadius: 14, flexShrink: 0,
      background: hot ? '#38bdf8' : enabled ? '#7cc3ee' : '#4d86b8',
      border: `3px solid ${hot ? '#fff' : enabled ? '#d9f1ff' : '#6d9cc7'}`,
      boxShadow: '0 3px 8px rgba(0,0,0,0.3)', color: '#0f2f55', opacity: enabled ? 1 : 0.6,
      cursor: enabled ? 'pointer' : 'default', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 0, padding: 0,
    }}>
      <span style={{ fontSize: 24, lineHeight: 1.1 }}>{icon}</span>
      <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.02em' }}>{label}</span>
    </button>
  );
}

function InfoSheet({ onClose }) {
  const rows = [
    ['🛣️ Road', '🪵🧱'], ['🏠 Settlement', '🪵🧱🐑🌾'], ['🏙️ City', '🌾🌾🪨🪨🪨'], ['🃏 Development card', '🐑🌾🪨'],
  ];
  return (
    <Sheet onClose={onClose}>
      <div style={{ fontSize: 18, fontWeight: 800, color: '#111827', marginBottom: 10 }}>Building costs</div>
      {rows.map(([n, c]) => (
        <div key={n} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid #f3f4f6', fontSize: 15 }}>
          <span style={{ fontWeight: 700, color: '#111827' }}>{n}</span><span>{c}</span>
        </div>
      ))}
      <div style={{ fontSize: 12.5, color: '#6b7280', marginTop: 12, lineHeight: 1.5 }}>
        First to {WIN_POINTS} victory points wins. Settlement 1 point, city 2, Longest Road 2, Largest Army 2.
      </div>
      <button onClick={onClose} style={btn('#f3f4f6', '#6b7280')}>Close</button>
    </Sheet>
  );
}

const topBtn = {
  width: 40, height: 40, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.85)', background: 'rgba(15,35,75,0.55)',
  color: '#fff', fontSize: 19, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
};

// ── The screen ───────────────────────────────────────────────
//
// The layout never changes shape: top bar, player row, board, action row and
// hand strip are all fixed heights, and everything that comes and goes (trade
// offers, the latest log line, the build menu) floats over the board or fills
// a slot that is always there. Buttons dim when they can't be used rather than
// disappearing, so the board never moves.

export default function CatanBoard({ gameState, playerId, playerNames, actions, resignedPlayer }) {
  const [mode,  setMode]  = useState(null);     // road | settlement | city: what a tap on the board builds
  const [sheet, setSheet] = useState(null);     // trade | dev | info
  const [showLog, setShowLog] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showBuild, setShowBuild] = useState(false);
  const [lastDice, setLastDice] = useState(null);

  const state     = gameState;
  const order     = state.playerOrder;
  const me        = state.players[playerId];
  const inSetup   = state.phase === 'setup';
  const over      = state.phase === 'gameover';
  const currentId = order[state.currentPlayerIndex];
  const isMyTurn  = currentId === playerId && !over;
  const stage     = state.turnStage;
  const name      = id => playerNames?.[id] ?? state.playerNames?.[id] ?? 'Player';

  // The dice stay on the table after the turn ends, like the real thing.
  if (state.dice && (!lastDice || lastDice[0] !== state.dice[0] || lastDice[1] !== state.dice[1])) {
    setLastDice(state.dice);
  }
  const shownDice = state.dice ?? lastDice;

  // You come first in the row; the others follow in turn order.
  const mySeat = Math.max(0, order.indexOf(playerId));
  const seats  = [...order.slice(mySeat), ...order.slice(0, mySeat)];

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

  // ── What the current player's tile says ──
  const NOW = { roll: 'Rolling…', robber: 'Robber', steal: 'Stealing…', roadBuilding: 'Free roads', main: 'Playing…' };
  let chip;
  if (over) chip = { title: 'Winner!', sub: name(state.winner), tone: 'active' };
  else if (inSetup) {
    const who = state.setup.seq[state.setup.index];
    const mine = who === playerId;
    const next = state.setup.placed === null ? 'Settlement' : 'Road';
    chip = { who, title: mine ? `Place ${next}` : 'Setup', sub: mine ? 'Tap a glowing spot' : `Placing ${next.toLowerCase()}…`, tone: mine ? 'active' : 'idle' };
  } else if (stage === 'discard') {
    const waiting = Object.keys(state.discarding);
    chip = { who: currentId, title: 'Discarding', sub: pendingDiscard !== undefined ? `Discard ${pendingDiscard}` : `${waiting.map(name).join(', ')}`, tone: pendingDiscard !== undefined ? 'active' : 'idle' };
  } else if (isMyTurn) {
    const t = {
      roll:         ['Your Turn', 'Roll the dice'],
      robber:       ['Move Robber', 'Tap a tile'],
      steal:        ['Steal', 'Choose a player'],
      roadBuilding: ['Free Roads', `${state.freeRoads} left — tap a road`],
      main:         buildMode ? [`Build ${buildMode[0].toUpperCase()}${buildMode.slice(1)}`, 'Tap a glowing spot'] : ['Your Turn', 'Build, trade, end'],
    }[stage] ?? ['Your Turn', ''];
    chip = { who: currentId, title: t[0], sub: t[1], tone: 'active' };
  } else chip = { who: currentId, title: 'Their Turn', sub: NOW[stage] ?? 'Playing…', tone: 'idle' };
  const chipFor = id => (chip && (chip.who ?? currentId) === id ? chip : null);

  const lastLog = state.log[state.log.length - 1];
  const canPlayDev = {
    any:  isMyTurn && (stage === 'roll' || stage === 'main') && !state.devPlayed,
    main: myMain,
  };

  // The one big button: roll, then end turn, and an hourglass while you wait.
  const primary = isMyTurn && stage === 'roll'
    ? { icon: '🎲', label: 'ROLL', testId: 'roll', on: actions.ctRoll, enabled: true, hot: true }
    : myMain
      ? { icon: '⏭️', label: 'END TURN', testId: 'end-turn', on: () => { setMode(null); setShowBuild(false); actions.ctEnd(); }, enabled: true, hot: false }
      : { icon: '⏳', label: over ? 'DONE' : 'WAIT', testId: 'wait', on: undefined, enabled: false, hot: false };

  const buildRow = (kind, icon, label, cost) => {
    const on = !!can[kind];
    return (
      <button key={kind} data-testid={`build-${kind}`} disabled={!on}
              onClick={() => { setMode(buildMode === kind ? null : kind); setShowBuild(false); }}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', border: 'none',
                borderBottom: '1px solid rgba(255,255,255,0.12)', background: buildMode === kind ? '#2563eb' : 'transparent',
                color: '#fff', opacity: on ? 1 : 0.4, cursor: on ? 'pointer' : 'default', textAlign: 'left',
              }}>
        <span style={{ fontSize: 20 }}>{icon}</span>
        <span style={{ flex: 1, fontSize: 14, fontWeight: 700 }}>{label}</span>
        <span style={{ fontSize: 13 }}>{cost}</span>
      </button>
    );
  };

  const myDev = me ? ['knight', 'roadBuilding', 'yearOfPlenty', 'monopoly', 'victoryPoint']
    .map(type => [type, me.devCards.filter(c => c.type === type).length]).filter(([, n]) => n > 0) : [];

  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column', background: '#2b6198', fontFamily: FONT,
      maxWidth: 560, margin: '0 auto', width: '100%', position: 'relative', overflow: 'hidden', userSelect: 'none',
    }}>
      {/* ── Top bar ── */}
      <div style={{ height: 54, padding: '0 10px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, position: 'relative', zIndex: 30 }}>
        <button onClick={() => setShowSettings(true)} style={topBtn} title="Settings" aria-label="Settings">⚙️</button>
        <button onClick={() => setSheet('info')} style={{ ...topBtn, fontFamily: 'Georgia, serif', fontStyle: 'italic', fontWeight: 700 }} title="Costs" aria-label="Building costs">i</button>
        <div data-testid="bank" style={{
          flex: 1, minWidth: 0, display: 'flex', justifyContent: 'center', gap: 3, background: 'rgba(15,35,75,0.45)',
          borderRadius: 10, padding: '4px 5px',
        }}>
          {RESOURCES.map(r => (
            <span key={r} title={RESOURCE_NAMES[r]} style={{
              flex: 1, maxWidth: 40, textAlign: 'center', borderRadius: 5, background: RESOURCE_COLOR[r], color: '#fff',
              fontSize: 11, fontWeight: 800, padding: '2px 0', lineHeight: 1.2, textShadow: '0 1px 1px rgba(0,0,0,0.4)',
            }}>{RESOURCE_ICON[r]}{state.bank[r]}</span>
          ))}
          <span title="Development cards left" style={{
            flex: 1, maxWidth: 40, textAlign: 'center', borderRadius: 5, background: '#7c3aed', color: '#fff',
            fontSize: 11, fontWeight: 800, padding: '2px 0', lineHeight: 1.2,
          }}>🃏{state.devDeck}</span>
        </div>
        <button data-testid="build-menu" onClick={() => setShowBuild(v => !v)} style={{ ...topBtn, width: 54, borderRadius: 20, gap: 2, fontSize: 18 }}
                title="Build" aria-label="Build menu">🏠<span style={{ fontSize: 11 }}>{showBuild ? '▲' : '▼'}</span></button>
      </div>

      {/* ── Players ── */}
      <div style={{ height: 112, display: 'flex', justifyContent: 'center', gap: 8, padding: '0 10px', flexShrink: 0 }}>
        {seats.map(id => (
          <PlayerTile key={id} state={state} id={id} name={name(id)} isMe={id === playerId}
                      current={id === currentId && !over} chip={chipFor(id)} />
        ))}
      </div>

      {/* ── Board ── */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <BoardSvg state={state} targets={targets} onVertex={onVertex} onEdge={onEdge} onHex={onHex} />

        {resignedPlayer && (
          <div style={{
            position: 'absolute', top: 6, left: 10, right: 10, background: '#fef2f2', border: '1px solid #fca5a5',
            borderRadius: 10, padding: '6px 12px', fontSize: 13, fontWeight: 600, color: '#dc2626', textAlign: 'center', zIndex: 25,
          }}>{resignedPlayer} has resigned from the game</div>
        )}

        {state.trade && stage === 'main' && !over && (
          <div style={{ position: 'absolute', top: 6, left: 10, right: 10, zIndex: 20, maxHeight: '70%', overflowY: 'auto' }}>
            <OfferBanner state={state} playerId={playerId} name={name} actions={actions} />
          </div>
        )}

        {!state.trade && lastLog && (
          <div data-testid="status" key={state.log.length} className="ct-fade" style={{
            position: 'absolute', top: 4, left: '50%', transform: 'translateX(-50%)', maxWidth: '92%', pointerEvents: 'none',
            background: 'rgba(15,35,75,0.62)', color: '#e8f1fb', fontSize: 11.5, fontWeight: 600, borderRadius: 12,
            padding: '3px 12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{lastLog.message}</div>
        )}

        {shownDice && (
          <div data-testid="dice" key={`${state.turnNumber}-${shownDice[0]}-${shownDice[1]}-${state.dice ? 1 : 0}`}
               className={state.dice ? 'ct-roll' : undefined}
               style={{ position: 'absolute', right: 10, bottom: 8, display: 'flex', gap: 8, pointerEvents: 'none' }}>
            <Die value={shownDice[0]} dim={!state.dice} />
            <Die value={shownDice[1]} dim={!state.dice} />
          </div>
        )}

        <button onClick={() => setShowLog(true)} style={{ ...topBtn, position: 'absolute', left: 10, bottom: 8, borderRadius: 12 }}
                title="Game log" aria-label="Game log">📋</button>
      </div>

      {/* ── Action row ── */}
      <div style={{ height: 72, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, padding: '0 10px', flexShrink: 0 }}>
        <ActionButton testId="open-trade" icon="🤝" label="TRADE" enabled={myMain} onClick={() => setSheet('trade')} />
        <ActionButton testId="open-dev" icon="🃏" label="CARDS" enabled={!!me && !over} onClick={() => setSheet('dev')} />
        <ActionButton testId={primary.testId} icon={primary.icon} label={primary.label} enabled={primary.enabled}
                      hot={primary.hot} onClick={primary.on} />
      </div>

      {/* ── Hand ── */}
      <div data-testid="hand" style={{
        height: 96, background: '#1b3f78', borderTop: '2px solid #14305c', flexShrink: 0, display: 'flex', alignItems: 'center',
        gap: 8, padding: '0 14px', paddingBottom: 'env(safe-area-inset-bottom)', overflowX: 'auto', overflowY: 'hidden',
      }}>
        {me && RESOURCES.filter(r => me.resources[r] > 0).map(r => (
          <HandCard key={r} testId={`hand-${r}`} bg={RESOURCE_COLOR[r]} icon={RESOURCE_ICON[r]} count={me.resources[r]} />
        ))}
        {me && myDev.length > 0 && <span style={{ width: 6, flexShrink: 0 }} />}
        {myDev.map(([type, n]) => (
          <HandCard key={type} testId={`devcard-${type}`} bg="#7c3aed" icon={DEV_ICON[type]} count={n}
                    label={DEV_NAMES[type]?.split(' ')[0]} onClick={() => setSheet('dev')} />
        ))}
      </div>

      {/* ── Build menu (floats over the board) ── */}
      {showBuild && (
        <>
          <div onClick={() => setShowBuild(false)} style={{ position: 'absolute', inset: 0, zIndex: 28 }} />
          <div className="ct-fade" style={{
            position: 'absolute', top: 52, right: 10, width: 230, zIndex: 29, borderRadius: 12, overflow: 'hidden',
            background: '#16305f', boxShadow: '0 6px 18px rgba(0,0,0,0.4)',
          }}>
            {buildRow('road', '🛣️', 'Road', '🪵🧱')}
            {buildRow('settlement', '🏠', 'Settlement', '🪵🧱🐑🌾')}
            {buildRow('city', '🏙️', 'City', '🌾🌾🪨🪨🪨')}
            {!myMain && <div style={{ color: '#9db8d9', fontSize: 11.5, padding: '8px 12px' }}>You can build on your turn, after rolling.</div>}
          </div>
        </>
      )}

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
      {sheet === 'dev' && me && !over && (
        <DevSheet
          state={state} me={me} canPlay={canPlayDev}
          onBuy={actions.ctBuyDev}
          onPlay={(type, options) => { actions.ctPlayDev(type, options); setSheet(null); }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'info' && <InfoSheet onClose={() => setSheet(null)} />}

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
