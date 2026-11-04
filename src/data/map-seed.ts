import { MAP_MANIFEST, type CoastPlace } from './map-manifest';
import type { MapCell, MapMarker, MapPin, MapReveal, MapRoute, MapTerrain, MapZone, World, WorldMap } from '../lib/types';

const MAP_ID = 'test-map';

function placeNamed(name: string): CoastPlace {
  const found = MAP_MANIFEST.places.find((row) => row.name === name);
  if (!found) throw new Error(name);
  return found;
}

function terrainAt(cx: number, cy: number): MapTerrain {
  if (cx <= 1 && cy >= 3) return 'sea';
  if (cx <= 2 && cy >= 4) return 'coast';
  if (cy <= 2 && cx >= 7) return 'hills';
  if (cy <= 2 && cx >= 3) return 'forest';
  return 'road';
}

/**
 * Учебные метки нарисованного Test Coast. Имена служебные, это не география кампании.
 * «Pine Ridge» лежит в тумане. «Mill Lake» открыто только Римте, самоназвание ещё спрятано.
 * «Lighthouse Point» уже на открытой клетке, но имя не названо — на карте знак вопроса.
 */
export function mapSeed(hero: { rimte: string; toivo: string }): Pick<
  World,
  'world_map' | 'map_cells' | 'map_reveals' | 'map_markers' | 'map_pins' | 'map_zones' | 'map_routes'
> {
  const harbor = placeNamed('Test Harbor');
  const light = placeNamed('Lighthouse Point');
  const lake = placeNamed('Mill Lake');
  const bridge = placeNamed('Old Bridge');
  const ridge = placeNamed('Pine Ridge');
  const island = placeNamed('Seal Island');

  const world_map: WorldMap = {
    id: MAP_ID,
    title: 'Тестовый берег',
    cols: MAP_MANIFEST.cols,
    rows: MAP_MANIFEST.rows,
    image_data: null,
  };
  const map_cells: MapCell[] = [];
  for (let cy = 0; cy < MAP_MANIFEST.rows; cy++) {
    for (let cx = 0; cx < MAP_MANIFEST.cols; cx++) {
      map_cells.push({ map_id: MAP_ID, cx, cy, terrain: terrainAt(cx, cy) });
    }
  }

  const map_reveals: MapReveal[] = [];
  for (let cy = 0; cy < MAP_MANIFEST.rows; cy++) {
    for (let cx = 0; cx < MAP_MANIFEST.cols; cx++) {
      const south = cy >= 3 && cx <= 6;
      const fields = cy === 2 && cx >= 1 && cx <= 5;
      const woods = cy <= 1 && cx >= 2 && cx <= 4;
      if (south || fields || woods) {
        map_reveals.push({ map_id: MAP_ID, cx, cy, scope: 'all', hero_id: null });
      }
    }
  }
  map_reveals.push({ map_id: MAP_ID, cx: 6, cy: 2, scope: 'hero', hero_id: hero.rimte });

  const map_markers: MapMarker[] = [
    {
      id: 'm-harbor',
      map_id: MAP_ID,
      x: harbor.x,
      y: harbor.y,
      kind: 'city',
      endonym: harbor.name,
      name_ru: 'Тестовая гавань',
      name_state: 'full',
      visibility: 'public',
      hero_ids: [],
      wiki_slug: null,
      blurb: 'Служебная гавань тестового берега. Это не география кампании.',
      threat: '1–3',
      loot: '',
      visits: 'пробный выход',
      hook: '',
      rumor: false,
    },
    {
      id: 'm-bridge',
      map_id: MAP_ID,
      x: bridge.x,
      y: bridge.y,
      kind: 'town',
      endonym: bridge.name,
      name_ru: 'Старый мост',
      name_state: 'ru',
      visibility: 'public',
      hero_ids: [],
      wiki_slug: null,
      blurb: 'Мост на тестовой реке. Самоназвание ещё не открыто.',
      threat: '1–3',
      loot: '',
      visits: '',
      hook: '',
      rumor: false,
    },
    {
      id: 'm-light',
      map_id: MAP_ID,
      x: light.x,
      y: light.y,
      kind: 'wild',
      endonym: light.name,
      name_ru: 'Маяк',
      name_state: 'unknown',
      visibility: 'public',
      hero_ids: [],
      wiki_slug: null,
      blurb: 'Имя этого места ещё не названо. Пока на карте только знак вопроса.',
      threat: '2–5',
      loot: '',
      visits: '',
      hook: '',
      rumor: true,
    },
    {
      id: 'm-lake',
      map_id: MAP_ID,
      x: lake.x,
      y: lake.y,
      kind: 'wild',
      endonym: lake.name,
      name_ru: 'Мельничное озеро',
      name_state: 'ru',
      visibility: 'heroes',
      hero_ids: [hero.rimte],
      wiki_slug: null,
      blurb: 'Озеро открыто одному герою. Самоназвание пока спрятано.',
      threat: '2–5',
      loot: '',
      visits: '',
      hook: '',
      rumor: false,
    },
    {
      id: 'm-ridge',
      map_id: MAP_ID,
      x: ridge.x,
      y: ridge.y,
      kind: 'wild',
      endonym: ridge.name,
      name_ru: 'Сосновый хребет',
      name_state: 'full',
      visibility: 'public',
      hero_ids: [],
      wiki_slug: null,
      blurb: 'Хребет в тумане. Пока клетка закрыта, место не рисуется ходокам.',
      threat: '6+',
      loot: '',
      visits: '',
      hook: '',
      rumor: false,
    },
    {
      id: 'm-island',
      map_id: MAP_ID,
      x: island.x,
      y: island.y,
      kind: 'wild',
      endonym: island.name,
      name_ru: 'Остров тюленей',
      name_state: 'full',
      visibility: 'public',
      hero_ids: [],
      wiki_slug: null,
      blurb: 'Малый остров у тестового берега.',
      threat: '1–3',
      loot: '',
      visits: '',
      hook: '',
      rumor: false,
    },
  ];

  const map_pins: MapPin[] = [
    {
      id: 'pin-toivo',
      map_id: MAP_ID,
      x: 0.44,
      y: 0.66,
      hero_id: hero.toivo,
      label: 'Моя стоянка у склада',
      shared: false,
    },
    {
      id: 'pin-party',
      map_id: MAP_ID,
      x: 0.5,
      y: 0.6,
      hero_id: hero.rimte,
      label: 'Стоянка отряда',
      shared: true,
    },
  ];

  const map_zones: MapZone[] = [
    { id: 'z-harbor', x: harbor.x, y: harbor.y, radius: 0.06, tone: 'low' },
    { id: 'z-lake', x: lake.x, y: lake.y, radius: 0.05, tone: 'mid' },
    { id: 'z-ridge', x: ridge.x, y: ridge.y, radius: 0.06, tone: 'high' },
  ];

  const map_routes: MapRoute[] = [
    {
      id: 'route-shore',
      points: [
        { x: light.x, y: light.y },
        { x: harbor.x, y: harbor.y },
        { x: bridge.x, y: bridge.y },
      ],
    },
  ];

  return { world_map, map_cells, map_reveals, map_markers, map_pins, map_zones, map_routes };
}
