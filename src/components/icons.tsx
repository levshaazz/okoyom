import type { ComponentChildren } from 'preact';

function Svg({ children }: { children: ComponentChildren }) {
  return (
    <svg class="ic" viewBox="0 0 24 24" aria-hidden="true">
      {children}
    </svg>
  );
}

export function IconSheet() {
  return (
    <Svg>
      <path d="M6 3h9l4 4v14H6z M9 10h7 M9 14h7 M9 18h4" />
    </Svg>
  );
}
export function IconMap() {
  return (
    <Svg>
      <path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z M9 4v14 M15 6v14" />
    </Svg>
  );
}
export function IconBook() {
  return (
    <Svg>
      <path d="M4 5h7a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H4z M20 5h-7 M20 5v13h-7" />
    </Svg>
  );
}
export function IconBag() {
  return (
    <Svg>
      <path d="M5 8h14l-1 12H6z M9 8V6a3 3 0 0 1 6 0v2" />
    </Svg>
  );
}
export function IconWait() {
  return (
    <Svg>
      <path d="M7 3h10 M7 21h10 M8 3c0 5 8 5 8 9s-8 4-8 9 M16 3c0 5-8 5-8 9s8 4 8 9" />
    </Svg>
  );
}
export function IconNote() {
  return (
    <Svg>
      <path d="M6 3h9l4 4v14H6z M8 12h8 M8 16h5" />
    </Svg>
  );
}
export function IconGive() {
  return (
    <Svg>
      <path d="M4 12h12 M12 6l6 6-6 6 M4 7v10" />
    </Svg>
  );
}

export function KindGlyph({ kind }: { kind: string }) {
  const path =
    kind === 'weapon'
      ? 'M7 25 L20 8 M20 8 h5 v5 M9 23 l-3 4'
      : kind === 'ammo'
        ? 'M8 24 L24 8 M8 24 h6 M20 8 v6'
        : kind === 'armor'
          ? 'M8 8 h16 v6 l-2 12 H10 L8 14z'
          : kind === 'potion'
            ? 'M13 4 h6 M14 8 h4 v3 l4 12 H10 L14 11z'
            : kind === 'ingredient'
              ? 'M16 28 V12 M16 16 c-6 0-8-6-4-8 M16 18 c6 1 8-5 4-8'
              : kind === 'book' || kind === 'note'
                ? 'M6 6 h8 a2 2 0 0 1 2 2 v16 H8 a2 2 0 0 1-2-2z M16 6 h8 v16 h-8'
                : kind === 'soulgem'
                  ? 'M16 4 l8 8 -8 16 -8-16z'
                  : 'M8 14 h16 M12 10 h8 v14 H12z';
  return (
    <span class="kind-ic" aria-hidden="true">
      <svg viewBox="0 0 32 32">
        <path d={path} />
      </svg>
    </span>
  );
}
