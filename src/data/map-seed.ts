import type { MapCell, MapMarker, MapPin, MapReveal, MapTerrain, World, WorldMap } from '../lib/types';

const MAP_ID = 'test-map';

function terrainAt(cx: number, cy: number): MapTerrain {
  if (cx <= 1) return 'sea';
  if (cx === 2) return 'coast';
  if (cy >= 5 && cx < 6) return 'marsh';
  if (cx >= 7 && cy <= 3) return 'hills';
  if (cy <= 1 && cx >= 3) return 'forest';
  return 'road';
}

/**
 * Учебная карта. «Медный курган» лежит в тумане.
 * «Лысый холм» открыт только Римте и до открытия самоназвания подписан по-русски.
 * «?» — место уже на открытой клетке, но имя ещё не названо.
 */
export function mapSeed(hero: { rimte: string; toivo: string }): Pick<
  World,
  'world_map' | 'map_cells' | 'map_reveals' | 'map_markers' | 'map_pins'
> {
  const world_map: WorldMap = {
    id: MAP_ID,
    title: 'Учебный берег',
    cols: 10,
    rows: 7,
    image_data: null,
  };
  const map_cells: MapCell[] = [];
  for (let cy = 0; cy < 7; cy++) {
    for (let cx = 0; cx < 10; cx++) {
      map_cells.push({ map_id: MAP_ID, cx, cy, terrain: terrainAt(cx, cy) });
    }
  }
  const openAll: Array<[number, number]> = [
    [2, 2],
    [2, 3],
    [2, 4],
    [3, 2],
    [3, 3],
    [3, 4],
    [4, 3],
    [4, 4],
    [5, 2],
    [5, 3],
  ];
  const map_reveals: MapReveal[] = openAll.map(([cx, cy]) => ({
    map_id: MAP_ID,
    cx,
    cy,
    scope: 'all',
    hero_id: null,
  }));
  map_reveals.push({ map_id: MAP_ID, cx: 6, cy: 2, scope: 'hero', hero_id: hero.rimte });

  const map_markers: MapMarker[] = [
    {
      id: 'm-harbor',
      map_id: MAP_ID,
      x: 0.28,
      y: 0.48,
      kind: 'city',
      endonym: 'Нордхавн',
      name_ru: 'Гавань',
      name_state: 'full',
      visibility: 'public',
      hero_ids: [],
      wiki_slug: 'gavany',
    },
    {
      id: 'm-ford',
      map_id: MAP_ID,
      x: 0.46,
      y: 0.58,
      kind: 'town',
      endonym: 'Вади',
      name_ru: 'Речной брод',
      name_state: 'ru',
      visibility: 'public',
      hero_ids: [],
      wiki_slug: null,
    },
    {
      id: 'm-question',
      map_id: MAP_ID,
      x: 0.55,
      y: 0.36,
      kind: 'wild',
      endonym: 'Кальв',
      name_ru: 'Лысый холм',
      name_state: 'unknown',
      visibility: 'public',
      hero_ids: [],
      wiki_slug: null,
    },
    {
      id: 'm-hill',
      map_id: MAP_ID,
      x: 0.66,
      y: 0.32,
      kind: 'camp',
      endonym: 'Нордкальв',
      name_ru: 'Северный холм',
      name_state: 'ru',
      visibility: 'heroes',
      hero_ids: [hero.rimte],
      wiki_slug: 'holmy',
    },
    {
      id: 'm-barrow',
      map_id: MAP_ID,
      x: 0.84,
      y: 0.68,
      kind: 'ruin',
      endonym: 'Медьюр',
      name_ru: 'Медный курган',
      name_state: 'full',
      visibility: 'public',
      hero_ids: [],
      wiki_slug: null,
    },
  ];

  const map_pins: MapPin[] = [
    {
      id: 'pin-toivo',
      map_id: MAP_ID,
      x: 0.4,
      y: 0.5,
      hero_id: hero.toivo,
      label: 'Моя стоянка у склада',
    },
  ];

  return { world_map, map_cells, map_reveals, map_markers, map_pins };
}
