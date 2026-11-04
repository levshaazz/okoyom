import { heroById, isGm } from './domain';
import { DomainError } from './errors';
import type {
  Actor,
  MapCell,
  MapMarker,
  MapMarkerKind,
  MapMarkerVisibility,
  MapNameState,
  MapPin,
  OpMeta,
  World,
  WorldMap,
} from './types';

export const MARKER_KINDS: { id: MapMarkerKind; label: string }[] = [
  { id: 'city', label: 'Город' },
  { id: 'town', label: 'Поселение' },
  { id: 'ruin', label: 'Руины' },
  { id: 'cave', label: 'Пещера' },
  { id: 'camp', label: 'Лагерь' },
  { id: 'wild', label: 'Урочище' },
];

function playing(actor: Actor): boolean {
  return actor.role === 'player' || (actor.role === 'gm' && actor.preview && Boolean(actor.heroId));
}

function requireGm(actor: Actor): void {
  if (!isGm(actor)) throw new DomainError('Карту правит только мастер.');
}

export function cellOf(map: WorldMap, x: number, y: number): { cx: number; cy: number } {
  const cx = Math.min(map.cols - 1, Math.max(0, Math.floor(x * map.cols)));
  const cy = Math.min(map.rows - 1, Math.max(0, Math.floor(y * map.rows)));
  return { cx, cy };
}

/** Клетка открыта всем, не только одному герою. Мастер по этому слою рисует туман. */
export function openToAll(world: World, cx: number, cy: number): boolean {
  return world.map_reveals.some((row) => row.cx === cx && row.cy === cy && row.scope === 'all');
}

export function isRevealed(world: World, actor: Actor, cx: number, cy: number): boolean {
  if (isGm(actor)) return true;
  return world.map_reveals.some((row) => {
    if (row.cx !== cx || row.cy !== cy) return false;
    if (row.scope === 'all') return true;
    return playing(actor) && row.hero_id === actor.heroId;
  });
}

function markerVisible(actor: Actor, marker: MapMarker): boolean {
  if (isGm(actor)) return true;
  if (marker.visibility === 'gm') return false;
  if (marker.visibility === 'public') return true;
  if (!playing(actor) || !actor.heroId) return false;
  if (marker.visibility === 'players') return true;
  return marker.hero_ids.includes(actor.heroId);
}

/** Маркер виден, только если открыта его клетка и слой маркера пускает актора. */
export function visibleMarkers(world: World, actor: Actor): MapMarker[] {
  return world.map_markers.filter((marker) => {
    const cell = cellOf(world.world_map, marker.x, marker.y);
    if (!isRevealed(world, actor, cell.cx, cell.cy)) return false;
    return markerVisible(actor, marker);
  });
}

export function visibleCells(world: World, actor: Actor): MapCell[] {
  if (isGm(actor)) return world.map_cells;
  return world.map_cells.filter((cell) => isRevealed(world, actor, cell.cx, cell.cy));
}

/** Личные пометки: свои и все у мастера. Общая метка отряда видна ходокам. Туман автора не прячет. */
export function visiblePins(world: World, actor: Actor): MapPin[] {
  if (isGm(actor)) return world.map_pins;
  if (!playing(actor) || !actor.heroId) return [];
  return world.map_pins.filter((pin) => pin.shared || pin.hero_id === actor.heroId);
}

function boxBlur(source: Float32Array, size: number, radius: number): Float32Array {
  const pass = new Float32Array(source.length);
  const out = new Float32Array(source.length);
  const blur = (from: Float32Array, to: Float32Array, horizontal: boolean) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let sum = 0;
        let n = 0;
        for (let k = -radius; k <= radius; k++) {
          const sx = horizontal ? Math.min(size - 1, Math.max(0, x + k)) : x;
          const sy = horizontal ? y : Math.min(size - 1, Math.max(0, y + k));
          sum += from[sy * size + sx] ?? 0;
          n++;
        }
        to[y * size + x] = sum / n;
      }
    }
  };
  blur(source, pass, true);
  blur(pass, out, false);
  return out;
}

/**
 * Маска тумана: 1 — закрыто, 0 — открыто. Края размыты.
 * Мастер видит закрытое для всех как плотный туман, клетки «только герою» — реже.
 * TODO(supabase): маска строится из map_reveals, которые RLS уже отфильтровал.
 */
export const FOG_SIZE = 96;

export function rasterFog(world: World, actor: Actor, size = FOG_SIZE): Float32Array {
  const raw = new Float32Array(size * size);
  const gm = isGm(actor);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cell = cellOf(world.world_map, (x + 0.5) / size, (y + 0.5) / size);
      let hidden = 1;
      if (gm) hidden = openToAll(world, cell.cx, cell.cy) ? 0 : 0.72;
      else hidden = isRevealed(world, actor, cell.cx, cell.cy) ? 0 : 1;
      raw[y * size + x] = hidden;
    }
  }
  const radius = Math.max(1, Math.round(size / world.world_map.cols / 3));
  return boxBlur(raw, size, radius);
}

export interface MarkerLabel {
  primary: string;
  secondary: string | null;
}

/**
 * Самоназвание крупно, русский перевод мелко — только когда имя открыто.
 * До этого русское имя или «?». Сырой endonym в подпись не попадает.
 * TODO(supabase): колонка endonym не должна уезжать, пока name_state не full.
 */
export function markerLabel(marker: MapMarker, actor: Actor): MarkerLabel {
  if (!isGm(actor) && marker.name_state === 'unknown') return { primary: '?', secondary: null };
  if (!isGm(actor) && marker.name_state !== 'full') return { primary: marker.name_ru || '?', secondary: null };
  if (!marker.endonym) return { primary: marker.name_ru || '?', secondary: null };
  return { primary: marker.endonym, secondary: marker.name_ru || null };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) throw new DomainError('Нужна точка на карте.');
  return Math.min(1, Math.max(0, value));
}

export interface MarkerInput {
  id: string | null;
  x: number;
  y: number;
  kind: MapMarkerKind;
  endonym: string;
  nameRu: string;
  nameState: MapNameState;
  visibility: MapMarkerVisibility;
  heroIds: string[];
  wikiSlug: string;
  blurb?: string;
  threat?: string;
  loot?: string;
  visits?: string;
  hook?: string;
  rumor?: boolean;
}

export function saveMarker(world: World, actor: Actor, input: MarkerInput, meta: OpMeta): World {
  requireGm(actor);
  if (!MARKER_KINDS.some((row) => row.id === input.kind)) throw new DomainError('Такого значка нет.');
  if (input.nameState !== 'unknown' && input.nameState !== 'ru' && input.nameState !== 'full') {
    throw new DomainError('Так имя не открывают.');
  }
  if (!['public', 'players', 'heroes', 'gm'].includes(input.visibility)) throw new DomainError('Так метку не открыть.');
  const nameRu = input.nameRu.trim();
  if (!nameRu && input.nameState !== 'unknown') throw new DomainError('Нужно русское имя.');
  const heroIds = [...new Set(input.heroIds)];
  if (input.visibility === 'heroes') {
    if (!heroIds.length) throw new DomainError('Выберите героев.');
    for (const heroId of heroIds) heroById(world, heroId);
  }
  const next = structuredClone(world);
  const existing = input.id ? next.map_markers.find((row) => row.id === input.id) : undefined;
  if (input.id && !existing) throw new DomainError('Метки нет.');
  const marker: MapMarker = {
    id: input.id ?? meta.id,
    map_id: next.world_map.id,
    x: clamp01(input.x),
    y: clamp01(input.y),
    kind: input.kind,
    endonym: input.endonym.trim(),
    name_ru: nameRu,
    name_state: input.nameState,
    visibility: input.visibility,
    hero_ids: input.visibility === 'heroes' ? heroIds : [],
    wiki_slug: input.wikiSlug.trim() || null,
    blurb: input.blurb ?? existing?.blurb ?? '',
    threat: input.threat ?? existing?.threat ?? '',
    loot: input.loot ?? existing?.loot ?? '',
    visits: input.visits ?? existing?.visits ?? '',
    hook: input.hook ?? existing?.hook ?? '',
    rumor: input.rumor ?? existing?.rumor ?? false,
  };
  if (existing) Object.assign(existing, marker, { id: existing.id });
  else next.map_markers.push(marker);
  return next;
}

export function moveMarker(world: World, actor: Actor, id: string, x: number, y: number): World {
  requireGm(actor);
  const next = structuredClone(world);
  const marker = next.map_markers.find((row) => row.id === id);
  if (!marker) throw new DomainError('Метки нет.');
  marker.x = clamp01(x);
  marker.y = clamp01(y);
  return next;
}

export function removeMarker(world: World, actor: Actor, id: string): World {
  requireGm(actor);
  const next = structuredClone(world);
  if (!next.map_markers.some((row) => row.id === id)) throw new DomainError('Метки нет.');
  next.map_markers = next.map_markers.filter((row) => row.id !== id);
  return next;
}

export function paintCells(
  world: World,
  actor: Actor,
  cells: { cx: number; cy: number }[],
  scope: 'all' | 'hero',
  heroIds: string[],
  open: boolean,
): World {
  requireGm(actor);
  if (scope !== 'all' && scope !== 'hero') throw new DomainError('Так туман не снять.');
  const targets = scope === 'hero' ? [...new Set(heroIds)] : [null];
  if (scope === 'hero' && !targets.length) throw new DomainError('Выберите героев.');
  for (const heroId of targets) if (heroId) heroById(world, heroId);
  const next = structuredClone(world);
  const map = next.world_map;
  for (const cell of cells) {
    if (cell.cx < 0 || cell.cy < 0 || cell.cx >= map.cols || cell.cy >= map.rows) {
      throw new DomainError('Клетка за краем карты.');
    }
    for (const heroId of targets) {
      const same = (row: World['map_reveals'][number]) =>
        row.cx === cell.cx && row.cy === cell.cy && row.scope === scope && row.hero_id === heroId;
      if (open) {
        if (!next.map_reveals.some(same)) {
          next.map_reveals.push({ map_id: map.id, cx: cell.cx, cy: cell.cy, scope, hero_id: heroId });
        }
      } else {
        next.map_reveals = next.map_reveals.filter((row) => !same(row));
      }
    }
  }
  return next;
}

export function addMapPin(world: World, actor: Actor, x: number, y: number, label: string, meta: OpMeta): World {
  if (!playing(actor) || !actor.heroId) throw new DomainError('Пометку ставит герой.');
  const text = label.trim();
  if (!text) throw new DomainError('Подпишите пометку.');
  const next = structuredClone(world);
  next.map_pins.push({
    id: meta.id,
    map_id: next.world_map.id,
    x: clamp01(x),
    y: clamp01(y),
    hero_id: actor.heroId,
    label: text,
    shared: false,
  });
  return next;
}

export function removeMapPin(world: World, actor: Actor, id: string): World {
  const next = structuredClone(world);
  const pin = next.map_pins.find((row) => row.id === id);
  if (!pin) throw new DomainError('Пометки нет.');
  if (!isGm(actor) && pin.hero_id !== actor.heroId) throw new DomainError('Чужую пометку не стереть.');
  next.map_pins = next.map_pins.filter((row) => row.id !== id);
  return next;
}

/** Картинка подложки в этом браузере. null — снова тестовый рисунок. */
export function setMapImage(world: World, actor: Actor, imageData: string | null): World {
  requireGm(actor);
  if (imageData !== null) {
    if (!imageData.startsWith('data:image/')) throw new DomainError('Нужна картинка.');
    if (imageData.length > 700_000) throw new DomainError('Файл слишком большой для пробного хранилища.');
  }
  const next = structuredClone(world);
  next.world_map.image_data = imageData;
  return next;
}
