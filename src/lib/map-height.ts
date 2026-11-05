import { MAP_MANIFEST } from '../data/map-manifest';

/** Уровень моря процедурного запасного берега, в долях 0…1. Нарисованный край живёт в метрах. */
export const PROCEDURAL_SEA = 0.36;

/** Детерминированный шум. Одинаковые координаты дают одну и ту же высоту. */
function hash2(ix: number, iy: number): number {
  let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

export function valueNoise(x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = fade(x - x0);
  const ty = fade(y - y0);
  const a = hash2(x0, y0);
  const b = hash2(x0 + 1, y0);
  const c = hash2(x0, y0 + 1);
  const d = hash2(x0 + 1, y0 + 1);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

export function fbm(x: number, y: number, octaves = 5): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, y * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

/** Береговая линия учебного края: море на западе, бухта у гавани. */
export function coastX(ny: number): number {
  const bay = Math.exp(-((ny - 0.5) ** 2) / 0.018) * 0.07;
  return 0.18 + 0.035 * Math.sin(ny * 8.5) + 0.02 * Math.sin(ny * 17) + bay;
}

const RIVER: Array<[number, number]> = [
  [0.78, 0.16],
  [0.66, 0.28],
  [0.55, 0.4],
  [0.46, 0.58],
  [0.34, 0.52],
  [0.22, 0.5],
];

function riverDistance(nx: number, ny: number): number {
  let best = 1;
  for (let i = 0; i < RIVER.length - 1; i++) {
    const [ax, ay] = RIVER[i]!;
    const [bx, by] = RIVER[i + 1]!;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((nx - ax) * dx + (ny - ay) * dy) / len2));
    const px = ax + dx * t - nx;
    const py = ay + dy * t - ny;
    best = Math.min(best, Math.hypot(px, py));
  }
  return best;
}

function mountain(nx: number, ny: number): number {
  const peaks: Array<[number, number, number]> = [
    [0.8, 0.18, 0.92],
    [0.9, 0.12, 0.8],
    [0.7, 0.14, 0.7],
    [0.86, 0.32, 0.55],
    [0.62, 0.22, 0.48],
  ];
  let h = 0;
  for (const [px, py, amp] of peaks) {
    const d = (nx - px) ** 2 / 0.012 + (ny - py) ** 2 / 0.02;
    h = Math.max(h, amp * Math.exp(-d));
  }
  return h;
}

/** Высота 0…1 процедурного запасного берега. Ниже PROCEDURAL_SEA — море. */
export function sampleHeight(nx: number, ny: number): number {
  const coast = coastX(ny);
  const inland = Math.max(0, nx - coast);
  const shelf = Math.min(1, inland / 0.08);
  const hills = fbm(nx * 3.2 + 2, ny * 3.2 + 5, 5);
  const detail = fbm(nx * 9 + 1, ny * 9 + 3, 3);
  let h = 0.34 + shelf * (0.08 + hills * 0.22 + detail * 0.05);
  h += mountain(nx, ny) * shelf;
  const rd = riverDistance(nx, ny);
  if (inland > 0.012 && rd < 0.05) {
    const carve = Math.pow(1 - rd / 0.05, 1.6);
    const bed = PROCEDURAL_SEA - 0.015 + (1 - carve) * 0.05;
    h = h * (1 - carve) + Math.min(h, bed) * carve;
  }
  if (nx < coast) {
    const depth = (coast - nx) / 0.18;
    h = 0.22 - depth * 0.12 + detail * 0.015;
  }
  return Math.max(0, Math.min(1, h));
}

export function isWater(nx: number, ny: number): boolean {
  if (nx < coastX(ny) - 0.004) return true;
  return riverDistance(nx, ny) < 0.012 && nx > coastX(ny);
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  const k = Math.max(0, Math.min(1, t));
  return {
    r: a.r + (b.r - a.r) * k,
    g: a.g + (b.g - a.g) * k,
    b: a.b + (b.b - a.b) * k,
  };
}

function rgb(hex: string): Rgb {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

const SEA = rgb('#1a4660');
const SHALLOW = rgb('#3e7f86');
const FOAM = rgb('#d5d2c0');
const SAND = rgb('#d2bc90');
const GRASS = rgb('#6f8446');
const MEADOW = rgb('#a2a15a');
const FOREST = rgb('#2c4633');
const DIRT = rgb('#8d6d45');
const ROCK = rgb('#6a6158');
const SNOW = rgb('#f2efe6');
const RIVER_INK = rgb('#2a5968');

/** Цвет альбедо процедурного края. Не рисует подписи и не знает имён мест. */
export function sampleColor(nx: number, ny: number): Rgb {
  const h = sampleHeight(nx, ny);
  const water = isWater(nx, ny);
  const coast = coastX(ny);
  const grain = fbm(nx * 18 + 4, ny * 18 + 9, 2);
  const blot = fbm(nx * 5 + 8, ny * 5 + 2, 3);
  if (water && nx < coast) {
    const deep = Math.min(1, (coast - nx) / 0.12);
    let col = mix(SHALLOW, SEA, deep);
    if (deep < 0.18) col = mix(FOAM, col, deep / 0.18);
    return mix(col, rgb('#16384c'), grain * 0.25);
  }
  if (water) return mix(RIVER_INK, SHALLOW, grain);
  const beach = Math.min(1, Math.max(0, (nx - coast) / 0.03));
  let land = mix(SAND, mix(MEADOW, GRASS, blot), beach);
  if (h > 0.48) land = mix(land, FOREST, Math.min(1, (h - 0.48) / 0.12) * (0.45 + blot));
  if (h > 0.62) land = mix(land, DIRT, Math.min(1, (h - 0.62) / 0.1));
  if (h > 0.7) land = mix(land, ROCK, Math.min(1, (h - 0.7) / 0.08));
  if (h > 0.78) land = mix(land, SNOW, Math.min(1, (h - 0.78) / 0.12));
  const shade = 0.9 + grain * 0.16;
  return { r: land.r * shade, g: land.g * shade, b: land.b * shade };
}

/** Процедурную высоту переносит в шкалу манифеста: PROCEDURAL_SEA становится уровнем моря. */
export function proceduralNormalized(nx: number, ny: number): number {
  const h = sampleHeight(nx, ny);
  const span = MAP_MANIFEST.heightMaxM - MAP_MANIFEST.heightMinM || 1;
  const seaN = (MAP_MANIFEST.seaLevelM - MAP_MANIFEST.heightMinM) / span;
  if (h >= PROCEDURAL_SEA) return seaN + ((h - PROCEDURAL_SEA) / (1 - PROCEDURAL_SEA)) * (1 - seaN);
  return (h / PROCEDURAL_SEA) * seaN;
}

export function normalizedToMeters(height01: number): number {
  return MAP_MANIFEST.heightMinM + height01 * (MAP_MANIFEST.heightMaxM - MAP_MANIFEST.heightMinM);
}

/** Мировые единицы вверх от уровня моря. `mapWidth` — ширина края в тех же единицах, что и сетка. */
export function liftMeters(meters: number, mapWidth: number): number {
  const spanM = MAP_MANIFEST.widthSpan * MAP_MANIFEST.metersPerSpan;
  const metersPerWorld = spanM / mapWidth;
  return ((meters - MAP_MANIFEST.seaLevelM) / metersPerWorld) * MAP_MANIFEST.verticalExaggeration;
}

/** Вода, если так говорит маска или если точка ниже уровня моря. Маска пляжа дырявая. */
export function countsAsWater(mask: number, meters: number): boolean {
  return mask >= 0.5 || meters < MAP_MANIFEST.seaLevelM;
}

/**
 * Сжимает uint16-карту высот до сетки.
 * `min` оставляет самый низкий отсчёт в окне, чтобы мелководье не растворилось в среднем.
 */
export function resampleU16(
  data: Uint16Array,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
  mode: 'avg' | 'min',
  radius: number,
): Uint16Array {
  const out = new Uint16Array(dw * dh);
  const rad = Math.max(0, radius);
  for (let y = 0; y < dh; y++) {
    const cy = Math.min(sh - 1, Math.max(0, Math.round((y / Math.max(1, dh - 1)) * (sh - 1))));
    for (let x = 0; x < dw; x++) {
      const cx = Math.min(sw - 1, Math.max(0, Math.round((x / Math.max(1, dw - 1)) * (sw - 1))));
      let acc = mode === 'min' ? 65535 : 0;
      let n = 0;
      for (let oy = -rad; oy <= rad; oy++) {
        const sy = Math.min(sh - 1, Math.max(0, cy + oy));
        const row = sy * sw;
        for (let ox = -rad; ox <= rad; ox++) {
          const sx = Math.min(sw - 1, Math.max(0, cx + ox));
          const v = data[row + sx] ?? 0;
          if (mode === 'min') acc = v < acc ? v : acc;
          else acc += v;
          n++;
        }
      }
      out[y * dw + x] = mode === 'min' ? acc : Math.round(acc / Math.max(1, n));
    }
  }
  return out;
}

/** Лёгкое размытие сетки высот. Прямоугольная, не только квадратная. */
export function blurRect(src: Float32Array, w: number, h: number, radius: number): Float32Array {
  const pass = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const blur = (from: Float32Array, to: Float32Array, horizontal: boolean) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0;
        let n = 0;
        for (let k = -radius; k <= radius; k++) {
          const sx = horizontal ? Math.min(w - 1, Math.max(0, x + k)) : x;
          const sy = horizontal ? y : Math.min(h - 1, Math.max(0, y + k));
          sum += from[sy * w + sx] ?? 0;
          n++;
        }
        to[y * w + x] = sum / n;
      }
    }
  };
  blur(src, pass, true);
  blur(pass, out, false);
  return out;
}

/** Сетка высот (seg+1)², row-major, y с севера на юг. */
export function buildHeightGrid(segments: number): Float32Array {
  const n = segments + 1;
  const data = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      data[y * n + x] = sampleHeight(x / segments, y / segments);
    }
  }
  return data;
}
