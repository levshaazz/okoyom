/** Где ставить кроны. Маска леса — 8 бит, белое значит лес. Вода кроны не получает. */

export interface ForestPlacement {
  x: number;
  y: number;
  scale: number;
  yaw: number;
}

function hash(ix: number, iy: number): number {
  let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function sample(src: ArrayLike<number>, sw: number, sh: number, nx: number, ny: number): number {
  const x = Math.min(sw - 1, Math.max(0, Math.floor(nx * Math.max(1, sw - 1))));
  const y = Math.min(sh - 1, Math.max(0, Math.floor(ny * Math.max(1, sh - 1))));
  return src[y * sw + x] ?? 0;
}

/**
 * Редкая сетка по маске. `cols`/`rows` — бюджет: на телефоне сетка реже,
 * дальние кроны всё равно гаснут в шейдере, а полог остаётся.
 */
export function forestPlacements(
  forest: ArrayLike<number>,
  width: number,
  height: number,
  cols: number,
  rows: number,
  blocked?: (nx: number, ny: number) => boolean,
): ForestPlacement[] {
  const out: ForestPlacement[] = [];
  const gx = Math.max(1, cols);
  const gy = Math.max(1, rows);
  for (let iy = 0; iy < gy; iy++) {
    for (let ix = 0; ix < gx; ix++) {
      const jx = hash(ix, iy);
      const jy = hash(ix + 19, iy + 7);
      const nx = Math.min(0.999, Math.max(0.001, (ix + 0.18 + jx * 0.64) / gx));
      const ny = Math.min(0.999, Math.max(0.001, (iy + 0.18 + jy * 0.64) / gy));
      if (sample(forest, width, height, nx, ny) < 128) continue;
      if (blocked?.(nx, ny)) continue;
      const shade = hash(ix + 3, iy + 11);
      out.push({
        x: nx,
        y: ny,
        scale: 0.7 + shade * 0.62,
        yaw: hash(ix + 5, iy + 13) * Math.PI * 2,
      });
    }
  }
  return out;
}

/** Мягкая маска для полога: граница леса не ступенькой сетки. y=0 — север. */
export function softenForestMask(src: Uint8Array, sw: number, sh: number, dw: number, dh: number): Uint8Array {
  const out = new Uint8Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor((y * sh) / dh);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * sh) / dh));
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor((x * sw) / dw);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * sw) / dw));
      let sum = 0;
      let n = 0;
      for (let py = y0; py < y1; py += 2) {
        const row = py * sw;
        for (let px = x0; px < x1; px += 2) {
          sum += src[row + px] ?? 0;
          n++;
        }
      }
      out[y * dw + x] = Math.round(sum / Math.max(1, n));
    }
  }
  return out;
}

export function redChannel(data: Uint8ClampedArray | Uint8Array, channels = 4): Uint8Array {
  const pixels = Math.floor(data.length / channels);
  const out = new Uint8Array(pixels);
  for (let i = 0; i < pixels; i++) out[i] = data[i * channels] ?? 0;
  return out;
}
