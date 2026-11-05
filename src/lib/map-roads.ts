/**
 * Дороги карты. Массив в манифесте и/или маска PNG приводятся к одним лентам.
 * Координаты — доли карты 0…1, левый верхний угол, север сверху.
 * Настоящий материк подключится теми же полями; здесь только схема и тестовый край.
 */

export const ROAD_TIERS = ['tract', 'road', 'trail', 'sail'] as const;
export type RoadTier = (typeof ROAD_TIERS)[number];

export interface RoadPoint {
  x: number;
  y: number;
}

export interface MapRoad {
  id: string;
  tier: RoadTier;
  name?: string;
  label?: string;
  points: RoadPoint[];
  assumed?: boolean;
}

export type RoadPattern = 'solid' | 'dash' | 'dot';

export interface RoadStyle {
  worldWidth: number;
  minPx: number;
  color: string;
  pattern: RoadPattern;
}

/** Тракт шире и светлее, тропа тонкая пунктиром, морской ход — точки. */
export const ROAD_STYLE: Record<RoadTier, RoadStyle> = {
  tract: { worldWidth: 0.11, minPx: 7, color: '#f0ddb0', pattern: 'solid' },
  road: { worldWidth: 0.072, minPx: 5, color: '#c49255', pattern: 'solid' },
  trail: { worldWidth: 0.042, minPx: 3.4, color: '#8a5a32', pattern: 'dash' },
  sail: { worldWidth: 0.055, minPx: 4.5, color: '#f4fbfc', pattern: 'dot' },
};

export function isRoadTier(value: unknown): value is RoadTier {
  return typeof value === 'string' && (ROAD_TIERS as readonly string[]).includes(value);
}

/**
 * Серый или красный канал маски.
 * 255 — тракт, 170 — дорога, 110 — морской ход, 85 — тропа.
 * Между ступеньками полоса пустая, чтобы шум не становился дорогой.
 */
export function tierFromMaskValue(value: number): RoadTier | null {
  if (value >= 213) return 'tract';
  if (value >= 140 && value < 213) return 'road';
  if (value >= 98 && value < 140) return 'sail';
  if (value >= 60 && value < 98) return 'trail';
  return null;
}

function finite01(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

/** Кривые строки выбрасываются: страница не должна падать из-за черновика материка. */
export function parseRoads(value: unknown): MapRoad[] {
  if (!Array.isArray(value)) return [];
  const roads: MapRoad[] = [];
  for (const row of value) {
    if (!row || typeof row !== 'object') continue;
    const record = row as Record<string, unknown>;
    if (typeof record.id !== 'string' || !record.id.trim() || !isRoadTier(record.tier)) continue;
    if (!Array.isArray(record.points) || record.points.length < 2) continue;
    const points: RoadPoint[] = [];
    let ok = true;
    for (const point of record.points) {
      if (!point || typeof point !== 'object') {
        ok = false;
        break;
      }
      const x = (point as { x?: unknown }).x;
      const y = (point as { y?: unknown }).y;
      if (!finite01(x) || !finite01(y)) {
        ok = false;
        break;
      }
      points.push({ x, y });
    }
    if (!ok) continue;
    const road: MapRoad = { id: record.id, tier: record.tier, points };
    if (typeof record.name === 'string' && record.name.trim()) road.name = record.name;
    if (typeof record.label === 'string' && record.label.trim()) road.label = record.label;
    if (record.assumed === true) road.assumed = true;
    roads.push(road);
  }
  return roads;
}

export function simplifyPath(points: RoadPoint[], epsilon: number): RoadPoint[] {
  if (points.length < 3) return points.map((point) => ({ x: point.x, y: point.y }));
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const next = stack.pop();
    if (!next) break;
    const [a, b] = next;
    const start = points[a];
    const end = points[b];
    if (!start || !end) continue;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len2 = dx * dx + dy * dy || 1e-12;
    let maxD = 0;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const point = points[i];
      if (!point) continue;
      const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / len2));
      const d = Math.hypot(point.x - (start.x + dx * t), point.y - (start.y + dy * t));
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx >= 0 && maxD > epsilon) {
      keep[idx] = true;
      stack.push([a, idx], [idx, b]);
    }
  }
  return points.filter((_, index) => keep[index]).map((point) => ({ x: point.x, y: point.y }));
}

/** Режет ломаную, чтобы лента легла на рельеф, а не хордой через хребет. */
export function subdividePolyline(points: RoadPoint[], step: number): RoadPoint[] {
  if (points.length < 2) return points.map((point) => ({ x: point.x, y: point.y }));
  const out: RoadPoint[] = [];
  const span = Math.max(1e-6, step);
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (!a || !b) continue;
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(dist / span));
    for (let s = 0; s < n; s++) {
      const t = s / n;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  const last = points[points.length - 1];
  if (last) out.push({ x: last.x, y: last.y });
  return out;
}

function neighbors(x: number, y: number, width: number, height: number): Array<[number, number]> {
  const found: Array<[number, number]> = [];
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue;
      const nx = x + ox;
      const ny = y + oy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      found.push([nx, ny]);
    }
  }
  return found;
}

/**
 * Тонкая маска (осевая линия) становится ломаными.
 * Соседние пиксели той же ступени съедаются, чтобы штрих в 2 пикселя не дал две дороги.
 */
export function traceMaskRoads(pixels: ArrayLike<number>, width: number, height: number): MapRoad[] {
  if (width < 2 || height < 1 || pixels.length < width * height) return [];
  const used = new Uint8Array(width * height);
  const roads: MapRoad[] = [];
  const at = (x: number, y: number) => pixels[y * width + x] ?? 0;
  for (const tier of ROAD_TIERS) {
    const open = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= width || y >= height) return false;
      const index = y * width + x;
      return !used[index] && tierFromMaskValue(at(x, y)) === tier;
    };
    const starts: number[] = [];
    const rest: number[] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (tierFromMaskValue(at(x, y)) !== tier) continue;
        const index = y * width + x;
        let degree = 0;
        for (const [nx, ny] of neighbors(x, y, width, height)) {
          if (tierFromMaskValue(at(nx, ny)) === tier) degree++;
        }
        if (degree <= 1) starts.push(index);
        else rest.push(index);
      }
    }
    let ordinal = 0;
    const walk = (sx: number, sy: number) => {
      const path: RoadPoint[] = [];
      let x = sx;
      let y = sy;
      let prevX = x;
      let prevY = y;
      let hasPrev = false;
      while (open(x, y)) {
        const index = y * width + x;
        used[index] = 1;
        path.push({ x: (x + 0.5) / width, y: (y + 0.5) / height });
        let bestX = -1;
        let bestY = -1;
        let bestScore = -Infinity;
        const around: Array<[number, number]> = [];
        for (const [nx, ny] of neighbors(x, y, width, height)) {
          if (!open(nx, ny)) continue;
          around.push([nx, ny]);
          const dirX = nx - x;
          const dirY = ny - y;
          const score = hasPrev ? dirX * (x - prevX) + dirY * (y - prevY) : 0;
          if (score > bestScore) {
            bestScore = score;
            bestX = nx;
            bestY = ny;
          }
        }
        for (const [nx, ny] of around) {
          if (nx === bestX && ny === bestY) continue;
          used[ny * width + nx] = 1;
        }
        if (bestX < 0) break;
        prevX = x;
        prevY = y;
        hasPrev = true;
        x = bestX;
        y = bestY;
      }
      return path;
    };
    for (const index of [...starts, ...rest]) {
      if (used[index]) continue;
      const path = walk(index % width, Math.floor(index / width));
      if (path.length < 3) continue;
      const points = simplifyPath(path, 1.25 / Math.max(width, height));
      if (points.length < 2) continue;
      roads.push({ id: `mask-${tier}-${ordinal++}`, tier, points });
    }
  }
  return roads;
}

export interface RibbonSample {
  x: number;
  y: number;
  z: number;
}

export interface RoadRibbon {
  position: Float32Array;
  side: Float32Array;
  sideDir: Float32Array;
  width: Float32Array;
  minPx: Float32Array;
  along: Float32Array;
  pattern: Float32Array;
  assumed: Float32Array;
  color: Float32Array;
  uv: Float32Array;
  index: Uint32Array;
}

function hexRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

function patternOf(style: RoadStyle, assumed: boolean): number {
  if (style.pattern === 'dot') return 2;
  if (style.pattern === 'dash' || assumed) return 1;
  return 0;
}

/** Лента вдоль ломаной. Ширина в шейдере не уже minPx, чтобы ход читался и с высоты. */
export function buildRoadRibbon(
  roads: MapRoad[],
  sample: (point: RoadPoint, tier: RoadTier) => RibbonSample,
  step = 0.007,
): RoadRibbon {
  const center: Array<{ x: number; y: number; z: number; along: number; u: number; v: number; tier: RoadTier; assumed: number }> = [];
  const breaks: number[] = [];
  for (const road of roads) {
    if (road.points.length < 2) continue;
    const line = subdividePolyline(road.points, step);
    const begin = center.length;
    let along = 0;
    for (let i = 0; i < line.length; i++) {
      const point = line[i];
      if (!point) continue;
      const world = sample(point, road.tier);
      if (i > 0) {
        const prev = center[center.length - 1];
        if (prev) along += Math.hypot(world.x - prev.x, world.z - prev.z);
      }
      center.push({
        x: world.x,
        y: world.y,
        z: world.z,
        along,
        u: point.x,
        v: 1 - point.y,
        tier: road.tier,
        assumed: road.assumed ? 1 : 0,
      });
    }
    if (center.length - begin >= 2) breaks.push(begin, center.length);
  }
  const count = center.length * 2;
  const position = new Float32Array(count * 3);
  const side = new Float32Array(count);
  const sideDir = new Float32Array(count * 2);
  const width = new Float32Array(count);
  const minPx = new Float32Array(count);
  const along = new Float32Array(count);
  const pattern = new Float32Array(count);
  const assumed = new Float32Array(count);
  const color = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const indices: number[] = [];
  for (let b = 0; b < breaks.length; b += 2) {
    const from = breaks[b] ?? 0;
    const to = breaks[b + 1] ?? from;
    for (let i = from; i < to; i++) {
      const curr = center[i];
      if (!curr) continue;
      const prev = center[Math.max(from, i - 1)] ?? curr;
      const next = center[Math.min(to - 1, i + 1)] ?? curr;
      let tx = next.x - prev.x;
      let tz = next.z - prev.z;
      const len = Math.hypot(tx, tz) || 1;
      tx /= len;
      tz /= len;
      const sx = -tz;
      const sz = tx;
      const style = ROAD_STYLE[curr.tier];
      const rgb = hexRgb(style.color);
      const pat = patternOf(style, curr.assumed > 0);
      for (const sign of [-1, 1]) {
        const v = i * 2 + (sign < 0 ? 0 : 1);
        position[v * 3] = curr.x;
        position[v * 3 + 1] = curr.y;
        position[v * 3 + 2] = curr.z;
        side[v] = sign;
        sideDir[v * 2] = sx;
        sideDir[v * 2 + 1] = sz;
        width[v] = style.worldWidth;
        minPx[v] = style.minPx;
        along[v] = curr.along;
        pattern[v] = pat;
        assumed[v] = curr.assumed;
        color[v * 3] = rgb[0];
        color[v * 3 + 1] = rgb[1];
        color[v * 3 + 2] = rgb[2];
        uv[v * 2] = curr.u;
        uv[v * 2 + 1] = curr.v;
      }
      if (i < to - 1) {
        const a = i * 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
  }
  return {
    position,
    side,
    sideDir,
    width,
    minPx,
    along,
    pattern,
    assumed,
    color,
    uv,
    index: new Uint32Array(indices),
  };
}

export interface RoadPlace {
  name: string;
  x: number;
  y: number;
}

/** Каждое место рядом с какой-нибудь вершиной, и все они в одной сети. */
export function roadNetwork(
  places: RoadPlace[],
  roads: MapRoad[],
  maxDist: number,
): { touched: string[]; connected: boolean } {
  const near = places.map(() => [] as number[]);
  roads.forEach((road, roadIndex) => {
    places.forEach((place, placeIndex) => {
      const hit = road.points.some((point) => Math.hypot(point.x - place.x, point.y - place.y) <= maxDist);
      if (hit) near[placeIndex]?.push(roadIndex);
    });
  });
  const parent = places.map((_, index) => index);
  const find = (index: number): number => {
    const head = parent[index];
    if (head === undefined || head === index) return index;
    const root = find(head);
    parent[index] = root;
    return root;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (let i = 0; i < places.length; i++) {
    for (let j = i + 1; j < places.length; j++) {
      const left = near[i] ?? [];
      const right = new Set(near[j] ?? []);
      if (left.some((roadIndex) => right.has(roadIndex))) union(i, j);
    }
  }
  const touched = places.filter((_, index) => (near[index]?.length ?? 0) > 0).map((place) => place.name);
  const roots = new Set(places.map((_, index) => ((near[index]?.length ?? 0) > 0 ? find(index) : -1)).filter((index) => index >= 0));
  return { touched, connected: touched.length === places.length && roots.size === 1 };
}
