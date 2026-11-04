/** Weight and prices stay exact: a slot is a rational, never a float. */

export interface Q {
  n: number;
  d: number;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

export function q(n: number, d = 1): Q {
  if (d === 0) throw new Error('Нулевой знаменатель');
  if (d < 0) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}

export function addQ(a: Q, b: Q): Q {
  return q(a.n * b.d + b.n * a.d, a.d * b.d);
}

export function mulQ(a: Q, k: number): Q {
  return q(a.n * k, a.d);
}

export function cmpQ(a: Q, b: Q): number {
  return a.n * b.d - b.n * a.d;
}

const GLYPH: Record<string, string> = {
  '1/2': '½',
  '1/3': '⅓',
  '2/3': '⅔',
  '1/4': '¼',
  '3/4': '¾',
  '1/5': '⅕',
  '2/5': '⅖',
  '3/5': '⅗',
  '4/5': '⅘',
  '1/6': '⅙',
  '5/6': '⅚',
  '1/8': '⅛',
  '3/8': '⅜',
  '5/8': '⅝',
  '7/8': '⅞',
};

/** Mixed number. Whole and a vulgar fraction sit tight when the fraction is a single glyph. */
export function formatQ(value: Q): string {
  const signed = q(value.n, value.d);
  if (signed.n === 0) return '0';
  const sign = signed.n < 0 ? '−' : '';
  const n = Math.abs(signed.n);
  const whole = Math.floor(n / signed.d);
  const rem = n % signed.d;
  if (rem === 0) return sign + String(whole);
  const key = `${rem}/${signed.d}`;
  const frac = GLYPH[key] ?? `${rem}/${signed.d}`;
  if (!whole) return sign + frac;
  return GLYPH[key] ? `${sign}${whole}${frac}` : `${sign}${whole} ${frac}`;
}

export function formatWeight(value: Q): string {
  if (value.n === 0) return '—';
  return formatQ(value);
}

/** 0–100, for the width utility classes (no inline styles: CSP). */
export function pct(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((part / whole) * 100)));
}

export function pctOfQ(value: Q): number {
  if (value.d === 0) return 0;
  return Math.max(0, Math.min(100, Math.round((Math.abs(value.n) / value.d) * 100)));
}
