import { describe, expect, it } from 'vitest';
import { HERO, createSeedWorld } from '../data/seed';
import { queuePerk } from './domain';
import { perkPoints, spellSky, treeView } from './constellation';
import type { OpMeta } from './types';

const meta: OpMeta = { id: 'p1', opId: 'p1', now: '2026-11-04T12:00:00.000Z' };
const rimte = { role: 'player' as const, heroId: HERO.rimte, preview: false };

describe('созвездие перков', () => {
  it('при Твёрдой руке I видны только три следующих узла, остальные без имён', () => {
    const world = createSeedWorld();
    const hero = world.heroes.find((row) => row.id === HERO.rimte)!;
    const tree = treeView(world, hero, 'Одноручное', false);
    const named = tree.stars.filter((star) => star.name).map((star) => star.name).sort();
    expect(named).toEqual(['Боевая стойка', 'Двойной вихрь', 'Твёрдая рука I', 'Твёрдая рука II']);
    expect(tree.stars.find((star) => star.name === 'Боевая стойка')?.pending).toBe(true);
    expect(tree.stars.find((star) => star.name === 'Твёрдая рука II')?.open).toBe(false);
    expect(tree.stars.find((star) => star.name === 'Двойной вихрь')?.open).toBe(false);
    expect(tree.hiddenCount).toBe(6);
    expect(tree.stars.filter((star) => star.state === 'fog').every((star) => star.name === '')).toBe(true);
    expect(tree.skillValue).toBe(28);
    expect(tree.marks).toBe(1);
  });

  it('мастер видит имена всей ветки', () => {
    const world = createSeedWorld();
    const hero = world.heroes.find((row) => row.id === HERO.rimte)!;
    const tree = treeView(world, hero, 'Одноручное', true);
    expect(tree.hiddenCount).toBe(0);
    expect(tree.stars.find((star) => star.id === 'one-thunder')?.name).toBe('Удар-гром');
    expect(tree.lines.length).toBeGreaterThan(6);
  });

  it('глубокий перк и лишнее очко не берутся', () => {
    const world = createSeedWorld();
    expect(perkPoints(world, world.heroes.find((row) => row.id === HERO.rimte)!).free).toBe(0);
    expect(() => queuePerk(world, rimte, HERO.rimte, 'Казнь', 'Одноручное', meta)).toThrow(/предыдущий/);
    expect(() => queuePerk(world, rimte, HERO.rimte, 'Двойной вихрь', 'Одноручное', meta)).toThrow(/очка/);
  });

  it('игрок не видит невыученные заклинания, мастер видит', () => {
    const world = createSeedWorld();
    const player = spellSky(world, HERO.toivo, false).map((star) => star.name).sort();
    expect(player).toEqual(['Лечение', 'Свет']);
    const gm = spellSky(world, HERO.toivo, true);
    expect(gm.length).toBeGreaterThan(player.length);
    expect(gm.find((star) => star.name === 'Огненный шар')?.learned).toBe(false);
    expect(gm.find((star) => star.name === 'Лечение')?.learned).toBe(true);
  });
});
