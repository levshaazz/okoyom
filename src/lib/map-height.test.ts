import { describe, expect, it } from 'vitest';
import { MAP_MANIFEST } from '../data/map-manifest';
import { buildHeightGrid, coastX, isWater, sampleColor, sampleHeight } from './map-height';

describe('процедурный тестовый край', () => {
  it('море ниже суши, горы выше берега, река уходит в воду', () => {
    const sea = sampleHeight(0.05, 0.4);
    const shore = sampleHeight(0.3, 0.48);
    const peak = sampleHeight(0.8, 0.18);
    expect(sea).toBeLessThan(MAP_MANIFEST.seaLevel);
    expect(shore).toBeGreaterThan(sea);
    expect(peak).toBeGreaterThan(shore);
    expect(isWater(0.05, 0.4)).toBe(true);
    expect(isWater(0.46, 0.58)).toBe(true);
    expect(coastX(0.5)).toBeLessThan(0.3);
  });

  it('цвет моря синее снега, сетка детерминирована', () => {
    const water = sampleColor(0.04, 0.4);
    const snow = sampleColor(0.8, 0.18);
    expect(water.b).toBeGreaterThan(water.r);
    expect(snow.r).toBeGreaterThan(water.r);
    const a = buildHeightGrid(8);
    const b = buildHeightGrid(8);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(a.length).toBe(81);
  });

  it('манифест по умолчанию процедурный и без чужих файлов', () => {
    expect(MAP_MANIFEST.albedoUrl).toBeNull();
    expect(MAP_MANIFEST.heightUrl).toBeNull();
    expect(MAP_MANIFEST.waterUrl).toBeNull();
    expect(MAP_MANIFEST.heightEncoding).toBe('rg16');
    expect(MAP_MANIFEST.widthVersts).toBeGreaterThan(0);
  });
});
