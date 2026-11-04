/** Site paths respect Astro's `base` (`/okoyom` on GitHub Pages). */
export function href(path: string): string {
  const base = import.meta.env.BASE_URL ?? '/';
  const prefix = base.endsWith('/') ? base.slice(0, -1) : base;
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${prefix}${suffix}` || '/';
}

export function asset(path: string): string {
  return href(path);
}
