import { describe, expect, it } from 'vitest';
import { MAP_MANIFEST } from '../data/map-manifest';
import {
  PROCEDURAL_SEA,
  blurRect,
  buildHeightGrid,
  coastX,
  countsAsWater,
  isWater,
  liftMeters,
  normalizedToMeters,
  resampleU16,
  sampleColor,
  sampleHeight,
} from './map-height';

describe('процедурный запасной берег', () => {
  it('море ниже суши, горы выше берега, река уходит в воду', () => {
    const sea = sampleHeight(0.05, 0.4);
    const shore = sampleHeight(0.3, 0.48);
    const peak = sampleHeight(0.8, 0.18);
    expect(sea).toBeLessThan(PROCEDURAL_SEA);
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
});

describe('нарисованный Test Coast', () => {
  it('манифест указывает на файлы края, а не на процедурный берег', () => {
    expect(MAP_MANIFEST.albedoUrl).toContain('albedo.jpg');
    expect(MAP_MANIFEST.heightUrl).toContain('height16.png');
    expect(MAP_MANIFEST.waterUrl).toContain('water.png');
    expect(MAP_MANIFEST.forestUrl).toContain('forest.png');
    expect(MAP_MANIFEST.heightEncoding).toBe('u16');
    expect(MAP_MANIFEST.heightMinM).toBe(-80);
    expect(MAP_MANIFEST.heightMaxM).toBe(800);
    expect(MAP_MANIFEST.seaLevelM).toBe(0);
    expect(MAP_MANIFEST.widthSpan).toBe(40);
    expect(MAP_MANIFEST.heightSpan).toBe(22.5);
    expect(MAP_MANIFEST.places).toHaveLength(6);
    expect(MAP_MANIFEST.verticalExaggeration).toBeGreaterThanOrEqual(3);
    expect(MAP_MANIFEST.verticalExaggeration).toBeLessThanOrEqual(5);
  });

  it('нулевая высота — уровень моря, вершина 800 м, преувеличение честное', () => {
    expect(normalizedToMeters(0)).toBe(-80);
    expect(normalizedToMeters(80 / 880)).toBeCloseTo(0, 5);
    expect(normalizedToMeters(1)).toBe(800);
    const peak = liftMeters(800, 24);
    const honest = 800 / ((40 * 1000) / 24);
    expect(peak / honest).toBeCloseTo(MAP_MANIFEST.verticalExaggeration, 5);
  });

  it('мелководье ниже нуля — вода, даже если маска его пропустила', () => {
    expect(countsAsWater(0, -0.2)).toBe(true);
    expect(countsAsWater(0, 3)).toBe(false);
    expect(countsAsWater(1, 115)).toBe(true);
    const src = new Uint16Array(4 * 2);
    src.fill(6000);
    src[1] = 1000;
    const minned = resampleU16(src, 4, 2, 2, 1, 'min', 1);
    expect(minned[0]).toBe(1000);
    const nearest = resampleU16(src, 4, 2, 2, 1, 'avg', 0);
    expect(nearest[0]).toBe(6000);
    const grid = Float32Array.from([0, 1, 0, 1]);
    const soft = blurRect(grid, 2, 2, 1);
    expect(soft[0]).toBeLessThan(1);
    expect(soft[0]).toBeGreaterThan(0);
  });
});
