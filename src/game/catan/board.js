// ============================================================
// CATAN — board geometry
//
// The island is the base game's 19 hexes (radius 2). Its shape never changes,
// so the topology — which vertices and edges exist and what touches what — is
// built once and shared by the engine, the bots and the client. Only the
// terrain, number tokens and harbours are dealt per game, and those live in the
// game state, indexed by the ids here.
//
// Hexes are pointy-topped. Each hex has six corners (vertices, where
// settlements and cities go) and six sides (edges, where roads go).
// ============================================================

export const RESOURCES = ['lumber', 'brick', 'wool', 'grain', 'ore'];

export const RESOURCE_NAMES = {
  lumber: 'Lumber', brick: 'Brick', wool: 'Wool', grain: 'Grain', ore: 'Ore',
};

export const TERRAIN_RESOURCE = {
  forest: 'lumber', hills: 'brick', pasture: 'wool', fields: 'grain', mountains: 'ore', desert: null,
};

const TERRAIN_BAG = [
  ...Array(4).fill('forest'), ...Array(4).fill('pasture'), ...Array(4).fill('fields'),
  ...Array(3).fill('hills'),  ...Array(3).fill('mountains'), 'desert',
];
const NUMBER_BAG = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];

// Nine harbours: four 3:1 and one 2:1 for each resource.
const PORT_BAG = ['any', 'any', 'any', 'any', ...RESOURCES];

// Chance of a number out of 36, as the dots printed on its token.
export const pips = n => (n ? 6 - Math.abs(7 - n) : 0);

const SQRT3 = Math.sqrt(3);

function buildTopology() {
  const hexes = [];
  for (let r = -2; r <= 2; r++) {
    for (let q = -2; q <= 2; q++) {
      if (Math.abs(q + r) > 2) continue;
      hexes.push({
        id: hexes.length, q, r, x: SQRT3 * (q + r / 2), y: 1.5 * r,
        vertices: [], edges: [], neighbors: [],
      });
    }
  }

  const vertexAt = new Map();
  const vertices = [];
  for (const hex of hexes) {
    for (let i = 0; i < 6; i++) {
      const angle = ((60 * i - 30) * Math.PI) / 180;
      const x = hex.x + Math.cos(angle);
      const y = hex.y + Math.sin(angle);
      const key = `${Math.round(x * 1000)},${Math.round(y * 1000)}`;
      let v = vertexAt.get(key);
      if (!v) {
        v = { id: vertices.length, x, y, hexes: [], neighbors: [], edges: [] };
        vertexAt.set(key, v);
        vertices.push(v);
      }
      v.hexes.push(hex.id);
      hex.vertices.push(v.id);
    }
  }

  const edgeAt = new Map();
  const edges = [];
  for (const hex of hexes) {
    for (let i = 0; i < 6; i++) {
      const a = hex.vertices[i];
      const b = hex.vertices[(i + 1) % 6];
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      let e = edgeAt.get(key);
      if (!e) {
        e = { id: edges.length, a, b, hexes: [] };
        edgeAt.set(key, e);
        edges.push(e);
        vertices[a].edges.push(e.id);
        vertices[b].edges.push(e.id);
        vertices[a].neighbors.push(b);
        vertices[b].neighbors.push(a);
      }
      e.hexes.push(hex.id);
      hex.edges.push(e.id);
    }
  }

  for (const e of edges) {
    if (e.hexes.length === 2) {
      hexes[e.hexes[0]].neighbors.push(e.hexes[1]);
      hexes[e.hexes[1]].neighbors.push(e.hexes[0]);
    }
  }

  return { hexes, vertices, edges };
}

export const TOPOLOGY = buildTopology();

// Where the harbours can sit: nine of the thirty coastal edges, spaced 4,3,3
// apart all the way round.
function buildPortSlots() {
  const { hexes, vertices, edges } = TOPOLOGY;
  const coast = edges
    .filter(e => e.hexes.length === 1)
    .map(e => {
      const a = vertices[e.a];
      const b = vertices[e.b];
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const hex = hexes[e.hexes[0]];
      const dx = mx - hex.x;
      const dy = my - hex.y;
      const len = Math.hypot(dx, dy);
      return {
        edge: e.id, a: e.a, b: e.b, hex: hex.id, mx, my,
        // Where the harbour's marker is drawn: out to sea from the edge.
        x: mx + (dx / len) * 0.68, y: my + (dy / len) * 0.68,
        angle: Math.atan2(my, mx),
      };
    })
    .sort((p, q) => p.angle - q.angle);

  const picks = [0, 4, 7, 10, 14, 17, 20, 24, 27];
  return picks.map(i => coast[i]);
}

export const PORT_SLOTS = buildPortSlots();

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// A random island. The red numbers (6 and 8) never touch each other, which is
// how online Catan deals its boards too.
export function generateLayout() {
  const terrain = shuffle(TERRAIN_BAG);
  const land = terrain.map((t, id) => id).filter(id => terrain[id] !== 'desert');

  let numbers;
  for (let tries = 0; tries < 500; tries++) {
    numbers = shuffle(NUMBER_BAG);
    const at = {};
    land.forEach((hexId, i) => { at[hexId] = numbers[i]; });
    const clash = land.some(id => (at[id] === 6 || at[id] === 8)
      && TOPOLOGY.hexes[id].neighbors.some(n => at[n] === 6 || at[n] === 8));
    if (!clash) break;
  }

  const hexes = TOPOLOGY.hexes.map(h => ({
    id: h.id,
    terrain: terrain[h.id],
    resource: TERRAIN_RESOURCE[terrain[h.id]],
    num: null,
  }));
  land.forEach((hexId, i) => { hexes[hexId].num = numbers[i]; });

  return { hexes, ports: shuffle(PORT_BAG) };
}
