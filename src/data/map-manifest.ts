import { parseRoads, type MapRoad } from '../lib/map-roads';
import { asset } from '../lib/paths';
import coast from './test-coast.json';

/**
 * Единственное место, откуда страница берёт тестовый край.
 * Сейчас это нарисованный Test Coast из `public/map/` и `test-coast.json`.
 * Чтобы подставить другой край, меняют json (файлы, метры, места) и кладут картинки в `public/map/`.
 * Настоящей географии кампании здесь нет.
 *
 * heightEncoding:
 * - u16 — одноканальный 16-битный PNG, m = min + v/65535*(max-min). Canvas его портит, читаем через fast-png;
 * - r8 — яркость красного канала, 0…255;
 * - rg16 — высота = (R * 256 + G) / 65535, если 16 бит уже разложены в два 8-битных канала.
 * waterUrl — белый (R > 128) означает воду. В шейдере вода ещё и там, где высота ниже уровня моря:
 * маска пляжа не всегда захватывает мелководье.
 * forestUrl — белый (R > 128) означает лес. Слой «Леса» красит и поднимает полог.
 * roads — ломаные в долях карты. roadsUrl — необязательная маска:
 * 255 тракт, 170 дорога, 110 морской ход, 85 тропа. Оба источника рисуются, если заданы.
 * Поля те же, когда вместо Test Coast подставят настоящий материк.
 */
export type HeightEncoding = 'r8' | 'rg16' | 'u16';

export interface CoastPlace {
  name: string;
  type: string;
  x: number;
  y: number;
  elevation_m: number;
}

export interface MapManifest {
  id: string;
  title: string;
  /** Протяжённость края. Числа — в `spanUnit` (у Test Coast это километры). */
  widthSpan: number;
  heightSpan: number;
  spanUnit: string;
  metersPerSpan: number;
  heightMinM: number;
  heightMaxM: number;
  seaLevelM: number;
  /**
   * Во сколько раз вертикаль выше честного горизонтального масштаба.
   * В json у края предложен диапазон 1.5–3. ×10 на этих горах даёт иглы, поэтому сайт держит 4
   * и слегка размывает сетку высот.
   */
  verticalExaggeration: number;
  albedoUrl: string | null;
  heightUrl: string | null;
  heightEncoding: HeightEncoding;
  waterUrl: string | null;
  forestUrl: string | null;
  /** PNG осевых линий или null. Ступени: 255 / 170 / 110 / 85. */
  roadsUrl: string | null;
  roads: MapRoad[];
  cols: number;
  rows: number;
  places: CoastPlace[];
}

const encoding: HeightEncoding = coast.height.encoding.startsWith('uint16') ? 'u16' : 'r8';
const coastFiles = coast.files as typeof coast.files & { roads?: string };

export const MAP_MANIFEST: MapManifest = {
  id: 'test-coast',
  title: coast.name,
  widthSpan: coast.size_km[0],
  heightSpan: coast.size_km[1],
  spanUnit: 'км',
  metersPerSpan: 1000,
  heightMinM: coast.height.min_m,
  heightMaxM: coast.height.max_m,
  seaLevelM: coast.height.sea_level_m,
  verticalExaggeration: 4,
  albedoUrl: asset(`/map/${coast.files.albedo}`),
  heightUrl: asset(`/map/${coast.files.height}`),
  heightEncoding: encoding,
  waterUrl: asset(`/map/${coast.files.water}`),
  forestUrl: asset(`/map/${coast.files.forest}`),
  roadsUrl: coastFiles.roads ? asset(`/map/${coastFiles.roads}`) : null,
  roads: parseRoads(coast.roads),
  cols: 10,
  rows: 7,
  places: coast.places,
};
