import { describe, expect, it } from 'vitest';
import { MAP_MANIFEST } from '../data/map-manifest';
import { forestPlacements, softenForestMask } from './map-forest';
import {
  ROAD_STYLE,
  buildRoadRibbon,
  parseRoads,
  roadNetwork,
  simplifyPath,
  subdividePolyline,
  tierFromMaskValue,
  traceMaskRoads,
} from './map-roads';

describe('маска и схема дорог', () => {
  it('узнаёт четыре ступени маски и молчит на пустом', () => {
    expect(tierFromMaskValue(255)).toBe('tract');
    expect(tierFromMaskValue(170)).toBe('road');
    expect(tierFromMaskValue(110)).toBe('sail');
    expect(tierFromMaskValue(85)).toBe('trail');
    expect(tierFromMaskValue(0)).toBeNull();
    expect(tierFromMaskValue(40)).toBeNull();
    expect(tierFromMaskValue(128)).toBe('sail');
  });

  it('собирает ломаную из тонкой и из двойной линии, шум пропускает', () => {
    const width = 12;
    const height = 6;
    const pixels = new Uint8Array(width * height);
    for (let x = 1; x <= 8; x++) pixels[2 * width + x] = 255;
    for (let y = 1; y <= 4; y++) pixels[y * width + 10] = 85;
    for (let x = 2; x <= 7; x++) {
      pixels[4 * width + x] = 170;
      pixels[5 * width + x] = 170;
    }
    pixels[0] = 20;
    const roads = traceMaskRoads(pixels, width, height);
    const tract = roads.filter((road) => road.tier === 'tract');
    const trail = roads.filter((road) => road.tier === 'trail');
    const road = roads.filter((road) => road.tier === 'road');
    expect(tract).toHaveLength(1);
    expect(trail).toHaveLength(1);
    expect(road).toHaveLength(1);
    expect(tract[0]?.points[0]?.x).toBeLessThan(0.2);
    expect(tract[0]?.points.at(-1)?.x).toBeGreaterThan(0.6);
    expect(trail[0]?.points[0]?.y).toBeLessThan(trail[0]?.points.at(-1)?.y ?? 0);
    expect(roads.some((row) => row.tier === 'sail')).toBe(false);
  });

  it('кривой json не попадает в сцену', () => {
    const roads = parseRoads([
      { id: 'ok', tier: 'road', points: [{ x: 0.1, y: 0.2 }, { x: 0.4, y: 0.5 }], name: 'Test', assumed: true },
      { id: 'bad-tier', tier: 'river', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
      { id: 'short', tier: 'trail', points: [{ x: 0.2, y: 0.2 }] },
      { id: 'outside', tier: 'sail', points: [{ x: -0.1, y: 0.2 }, { x: 0.2, y: 0.3 }] },
      { id: 'label', tier: 'tract', label: 'TEST', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
    ]);
    expect(roads.map((road) => road.id)).toEqual(['ok', 'label']);
    expect(roads[0]?.assumed).toBe(true);
    expect(roads[0]?.name).toBe('Test');
    expect(roads[1]?.label).toBe('TEST');
    expect(roads[1]?.assumed).toBeUndefined();
  });

  it('прямую ужимает, угол оставляет, лента не короче двух точек', () => {
    const straight = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
      { x: 1, y: 0 },
    ];
    expect(simplifyPath(straight, 0.01)).toHaveLength(2);
    const corner = simplifyPath(
      [
        { x: 0, y: 0 },
        { x: 0.5, y: 0.4 },
        { x: 1, y: 0 },
      ],
      0.05,
    );
    expect(corner).toHaveLength(3);
    const dense = subdividePolyline(
      [
        { x: 0, y: 0 },
        { x: 0.2, y: 0 },
      ],
      0.05,
    );
    expect(dense.length).toBeGreaterThan(2);
    expect(dense[0]).toEqual({ x: 0, y: 0 });
    expect(dense.at(-1)).toEqual({ x: 0.2, y: 0 });
    const ribbon = buildRoadRibbon(
      [{ id: 't', tier: 'tract', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }],
      (point) => ({ x: point.x, y: 0, z: point.y }),
      1,
    );
    expect(ribbon.index.length).toBe(6);
    expect(ribbon.side[0]).toBe(-1);
    expect(ribbon.side[1]).toBe(1);
    expect(ribbon.width[0]).toBeCloseTo(ROAD_STYLE.tract.worldWidth, 5);
    expect(ROAD_STYLE.tract.worldWidth).toBeGreaterThan(ROAD_STYLE.road.worldWidth);
    expect(ROAD_STYLE.road.worldWidth).toBeGreaterThan(ROAD_STYLE.trail.worldWidth);
    expect(ROAD_STYLE.trail.pattern).toBe('dash');
    expect(ROAD_STYLE.sail.pattern).toBe('dot');
    expect(ROAD_STYLE.tract.color).not.toBe(ROAD_STYLE.trail.color);
  });
});

describe('тестовые дороги Test Coast', () => {
  it('четыре яруса связывают шесть мест, тропа помечена как предполагаемая', () => {
    expect(MAP_MANIFEST.roads.map((road) => road.tier).sort()).toEqual(['road', 'sail', 'tract', 'trail']);
    expect(MAP_MANIFEST.roads.some((road) => road.assumed && road.tier === 'trail')).toBe(true);
    expect(new Set(MAP_MANIFEST.roads.map((road) => road.id)).size).toBe(MAP_MANIFEST.roads.length);
    const net = roadNetwork(MAP_MANIFEST.places, MAP_MANIFEST.roads, 0.03);
    expect(net.touched.sort()).toEqual(MAP_MANIFEST.places.map((place) => place.name).sort());
    expect(net.connected).toBe(true);
    expect(MAP_MANIFEST.roadsUrl).toBeNull();
  });
});

describe('лес по маске', () => {
  it('ставит кроны только на лес и не на воду, мягкая маска светлее у края', () => {
    const mask = new Uint8Array(16).fill(255);
    const placed = forestPlacements(mask, 4, 4, 4, 4, (nx) => nx < 0.5);
    expect(placed.length).toBeGreaterThan(0);
    expect(placed.every((tree) => tree.x >= 0.5)).toBe(true);
    expect(forestPlacements(new Uint8Array(16), 4, 4, 4, 4)).toEqual([]);
    const sharp = new Uint8Array(8 * 4);
    for (let x = 0; x < 4; x++) sharp[x] = 255;
    const soft = softenForestMask(sharp, 8, 4, 4, 2);
    expect(soft[0]).toBeGreaterThan(200);
    expect(soft[3]).toBeLessThan(soft[0] ?? 0);
  });
});
