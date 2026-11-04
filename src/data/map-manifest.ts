/**
 * Единственное место, куда позже подставляются настоящие файлы края.
 * Пока все URL пустые: страница собирает процедурный тестовый берег.
 * Настоящей географии кампании здесь нет.
 *
 * heightEncoding:
 * - r8 — яркость красного канала, 0 море … 255 вершины;
 * - rg16 — высота = (R * 256 + G) / 65535, так 16 бит читаются обычным canvas.
 * waterUrl — белый (R > 128) означает воду. Если пусто, вода там, где высота ниже моря.
 */
export type HeightEncoding = 'r8' | 'rg16';

export interface MapManifest {
  id: string;
  title: string;
  widthVersts: number;
  heightVersts: number;
  /** Доля меньшей стороны карты, на которую поднимается вершина высотой 1. */
  heightScale: number;
  seaLevel: number;
  albedoUrl: string | null;
  heightUrl: string | null;
  heightEncoding: HeightEncoding;
  waterUrl: string | null;
  cols: number;
  rows: number;
}

export const MAP_MANIFEST: MapManifest = {
  id: 'test-coast',
  title: 'Учебный берег',
  widthVersts: 40,
  heightVersts: 28,
  heightScale: 0.28,
  seaLevel: 0.36,
  albedoUrl: null,
  heightUrl: null,
  heightEncoding: 'rg16',
  waterUrl: null,
  cols: 10,
  rows: 7,
};
