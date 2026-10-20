import { TOPOLOGY, PORT_SLOTS, pips } from '../../game/catan/board.js';

// ── Palette ──────────────────────────────────────────────────

export const PLAYER_COLORS = [
  { fill: '#ef4444', dark: '#991b1b', name: 'Red' },
  { fill: '#3b82f6', dark: '#1e3a8a', name: 'Blue' },
  { fill: '#f97316', dark: '#9a3412', name: 'Orange' },
  { fill: '#f8fafc', dark: '#475569', name: 'White' },
];

export const TERRAIN_STYLE = {
  forest:    { fill: '#2f7d3b', icon: '🌲' },
  hills:     { fill: '#c45a2c', icon: '🧱' },
  pasture:   { fill: '#a3d96c', icon: '🐑' },
  fields:    { fill: '#f0cd4f', icon: '🌾' },
  mountains: { fill: '#8c96a6', icon: '⛰️' },
  desert:    { fill: '#e6d5a0', icon: '🏜️' },
};

export const RESOURCE_ICON = { lumber: '🪵', brick: '🧱', wool: '🐑', grain: '🌾', ore: '🪨' };

export const RESOURCE_COLOR = {
  lumber: '#2f7d3b', brick: '#c45a2c', wool: '#8fcf55', grain: '#e8bd2a', ore: '#7b8696',
};

const HEX_POINTS = [0, 1, 2, 3, 4, 5]
  .map(i => {
    const a = ((60 * i - 30) * Math.PI) / 180;
    return `${Math.cos(a).toFixed(4)},${Math.sin(a).toFixed(4)}`;
  })
  .join(' ');

// ── Pieces ───────────────────────────────────────────────────

function Settlement({ x, y, color, city }) {
  const c = PLAYER_COLORS[color];
  const d = city
    ? 'M-0.34,0.2 L-0.34,-0.08 L-0.12,-0.08 L-0.12,-0.3 L0.06,-0.42 L0.2,-0.3 L0.2,-0.04 L0.34,-0.04 L0.34,0.2 Z'
    : 'M-0.22,0.2 L-0.22,-0.04 L0,-0.28 L0.22,-0.04 L0.22,0.2 Z';
  return (
    <g transform={`translate(${x} ${y})`} style={{ pointerEvents: 'none' }}>
      <path d={d} fill={c.fill} stroke={c.dark} strokeWidth="0.07" strokeLinejoin="round" className="ct-pop" />
    </g>
  );
}

function Road({ edge, color }) {
  const a = TOPOLOGY.vertices[edge.a];
  const b = TOPOLOGY.vertices[edge.b];
  const c = PLAYER_COLORS[color];
  return (
    <g style={{ pointerEvents: 'none' }} className="ct-fade">
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={c.dark} strokeWidth="0.3" strokeLinecap="round" />
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={c.fill} strokeWidth="0.18" strokeLinecap="round" />
    </g>
  );
}

function Robber({ x, y }) {
  return (
    <g transform={`translate(${x} ${y})`} style={{ pointerEvents: 'none' }}>
      <path d="M-0.17,0.24 Q-0.15,0 0,-0.02 Q0.15,0 0.17,0.24 Z" fill="#374151" stroke="#111827" strokeWidth="0.05" />
      <circle cx="0" cy="-0.14" r="0.12" fill="#374151" stroke="#111827" strokeWidth="0.05" />
    </g>
  );
}

// ── The board ────────────────────────────────────────────────

// `targets` says what can be tapped right now: { vertices, edges, hexes } as
// Sets of ids. The matching handlers fire when one is tapped.
export default function BoardSvg({ state, targets, onVertex, onEdge, onHex }) {
  const { hexes, ports, buildings, roads, robber } = state;
  const colorOf = id => state.players[id]?.color ?? 0;

  return (
    <svg
      viewBox="-5.45 -4.85 10.9 9.7"
      style={{ width: '100%', height: '100%', display: 'block' }}
      data-testid="catan-board"
    >
      {/* Harbours */}
      {PORT_SLOTS.map((slot, i) => {
        const type = ports[i];
        const a = TOPOLOGY.vertices[slot.a];
        const b = TOPOLOGY.vertices[slot.b];
        return (
          <g key={`port-${i}`} style={{ pointerEvents: 'none' }}>
            <line x1={a.x} y1={a.y} x2={slot.x} y2={slot.y} stroke="#e8d9a8" strokeWidth="0.07" strokeDasharray="0.12 0.08" />
            <line x1={b.x} y1={b.y} x2={slot.x} y2={slot.y} stroke="#e8d9a8" strokeWidth="0.07" strokeDasharray="0.12 0.08" />
            <circle cx={slot.x} cy={slot.y} r="0.38" fill="#f6ecc9" stroke="#b79b4b" strokeWidth="0.06" />
            <text x={slot.x} y={slot.y - 0.06} textAnchor="middle" fontSize="0.3" dominantBaseline="middle">
              {type === 'any' ? '⚓' : RESOURCE_ICON[type]}
            </text>
            <text x={slot.x} y={slot.y + 0.23} textAnchor="middle" fontSize="0.2" fontWeight="800" fill="#5b4a14">
              {type === 'any' ? '3:1' : '2:1'}
            </text>
          </g>
        );
      })}

      {/* Tiles */}
      {hexes.map(hex => {
        const geo = TOPOLOGY.hexes[hex.id];
        const style = TERRAIN_STYLE[hex.terrain];
        const canMove = targets.hexes.has(hex.id);
        const red = hex.num === 6 || hex.num === 8;
        return (
          <g key={hex.id} transform={`translate(${geo.x} ${geo.y})`}
             onClick={canMove ? () => onHex(hex.id) : undefined}
             style={{ cursor: canMove ? 'pointer' : 'default' }}
             data-testid={`hex-${hex.id}`}>
            <polygon points={HEX_POINTS} fill={style.fill} stroke="#f3e7c0" strokeWidth="0.06" strokeLinejoin="round" />
            {hex.terrain === 'desert' ? (
              <text x="0" y="0.02" textAnchor="middle" dominantBaseline="middle" fontSize="0.55">{style.icon}</text>
            ) : (
              <>
                <text x="0" y="-0.46" textAnchor="middle" dominantBaseline="middle" fontSize="0.4">{style.icon}</text>
                <circle cx="0" cy="0.12" r="0.34" fill="#fbf3d6" stroke="#8a7a45" strokeWidth="0.04" />
                <text x="0" y="0.1" textAnchor="middle" dominantBaseline="middle" fontSize="0.37"
                      fontWeight="800" fill={red ? '#c81e1e' : '#1f2937'}>{hex.num}</text>
                <text x="0" y="0.31" textAnchor="middle" dominantBaseline="middle" fontSize="0.15"
                      fill={red ? '#c81e1e' : '#4b5563'}>{'•'.repeat(pips(hex.num))}</text>
              </>
            )}
            {canMove && <polygon points={HEX_POINTS} fill="rgba(255,255,255,0.38)" stroke="#fde047" strokeWidth="0.12" strokeLinejoin="round" className="ct-pulse" />}
          </g>
        );
      })}

      {/* Roads */}
      {Object.entries(roads).map(([eid, owner]) => (
        <Road key={`road-${eid}`} edge={TOPOLOGY.edges[eid]} color={colorOf(owner)} />
      ))}

      {/* Open roads to tap */}
      {TOPOLOGY.edges.filter(e => targets.edges.has(e.id)).map(e => {
        const a = TOPOLOGY.vertices[e.a];
        const b = TOPOLOGY.vertices[e.b];
        return (
          <g key={`edge-${e.id}`} onClick={() => onEdge(e.id)} style={{ cursor: 'pointer' }} data-testid={`edge-${e.id}`}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#fff" strokeWidth="0.2" strokeLinecap="round" className="ct-pulse" />
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth="0.5" strokeLinecap="round" />
          </g>
        );
      })}

      {/* Buildings */}
      {Object.entries(buildings).map(([vid, b]) => {
        const v = TOPOLOGY.vertices[vid];
        return <Settlement key={`b-${vid}`} x={v.x} y={v.y} color={colorOf(b.owner)} city={b.type === 'city'} />;
      })}

      {/* Open spots to tap */}
      {TOPOLOGY.vertices.filter(v => targets.vertices.has(v.id)).map(v => (
        <g key={`v-${v.id}`} onClick={() => onVertex(v.id)} style={{ cursor: 'pointer' }} data-testid={`vertex-${v.id}`}>
          <circle cx={v.x} cy={v.y} r="0.2" fill="rgba(255,255,255,0.85)" stroke="#fff" strokeWidth="0.06" className="ct-pulse" />
          <circle cx={v.x} cy={v.y} r="0.4" fill="transparent" />
        </g>
      ))}

      {/* The robber */}
      <Robber x={TOPOLOGY.hexes[robber].x + 0.46} y={TOPOLOGY.hexes[robber].y + 0.18} />
    </svg>
  );
}
