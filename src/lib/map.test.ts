import { describe, expect, it } from 'vitest';
import { HERO, createSeedWorld } from '../data/seed';
import { DomainError } from './errors';
import {
  isRevealed,
  markerLabel,
  paintCells,
  rasterFog,
  visibleCells,
  visibleMarkers,
  visiblePins,
} from './map';
import { CampaignStore, memoryHooks } from './store';
import type { Actor } from './types';

const guest: Actor = { role: 'guest', heroId: null, preview: false };
const rimte: Actor = { role: 'player', heroId: HERO.rimte, preview: false };
const toivo: Actor = { role: 'player', heroId: HERO.toivo, preview: false };
const gm: Actor = { role: 'gm', heroId: null, preview: false };

function ids(actor: Actor) {
  return visibleMarkers(createSeedWorld(), actor).map((marker) => marker.id);
}

describe('туман и подписи карты', () => {
  it('гость видит только открытые всем места и не читает закрытые имена', () => {
    expect(ids(guest).sort()).toEqual(['m-ford', 'm-harbor', 'm-question']);
    const world = createSeedWorld();
    const harbor = world.map_markers.find((marker) => marker.id === 'm-harbor')!;
    const ford = world.map_markers.find((marker) => marker.id === 'm-ford')!;
    const question = world.map_markers.find((marker) => marker.id === 'm-question')!;
    expect(markerLabel(harbor, guest)).toEqual({ primary: 'Нордхавн', secondary: 'Гавань' });
    expect(markerLabel(ford, guest)).toEqual({ primary: 'Речной брод', secondary: null });
    expect(markerLabel(question, guest)).toEqual({ primary: '?', secondary: null });
    expect(JSON.stringify(visibleMarkers(world, guest))).not.toContain('Медьюр');
    expect(JSON.stringify(visibleMarkers(world, guest))).not.toContain('Нордкальв');
    expect(visibleCells(world, guest).some((cell) => cell.cx === 8 && cell.cy === 4)).toBe(false);
    expect(visiblePins(world, guest)).toEqual([]);
  });

  it('клетка героя и личная пометка не уходят чужому, мастер видит всё', () => {
    const world = createSeedWorld();
    expect(ids(rimte)).toContain('m-hill');
    expect(ids(toivo)).not.toContain('m-hill');
    expect(isRevealed(world, rimte, 6, 2)).toBe(true);
    expect(isRevealed(world, toivo, 6, 2)).toBe(false);
    expect(markerLabel(world.map_markers.find((marker) => marker.id === 'm-hill')!, rimte).primary).toBe('Северный холм');
    expect(visiblePins(world, toivo).map((pin) => pin.label).sort()).toEqual(['Моя стоянка у склада', 'Стоянка отряда']);
    expect(visiblePins(world, rimte).map((pin) => pin.label)).toEqual(['Стоянка отряда']);
    expect(visiblePins(world, gm)).toHaveLength(2);
    expect(ids(gm)).toContain('m-barrow');
    expect(markerLabel(world.map_markers.find((marker) => marker.id === 'm-barrow')!, gm).primary).toBe('Медьюр');
  });

  it('мастер снимает туман кликом по клетке, игрок — нет', async () => {
    const store = new CampaignStore(memoryHooks({ session: gm }));
    await store.ready();
    expect(isRevealed(store.getWorld(), guest, 8, 4)).toBe(false);
    await store.paintCells([{ cx: 8, cy: 4 }], 'all', [], true);
    expect(visibleMarkers(store.getWorld(), guest).some((marker) => marker.id === 'm-barrow')).toBe(true);
    store.setSession(rimte);
    await expect(store.paintCells([{ cx: 8, cy: 4 }], 'all', [], false)).rejects.toThrow(DomainError);
    const hidden = paintCells(createSeedWorld(), gm, [{ cx: 2, cy: 3 }], 'all', [], false);
    expect(isRevealed(hidden, guest, 2, 3)).toBe(false);
    expect(visibleMarkers(hidden, guest).some((marker) => marker.id === 'm-harbor')).toBe(false);
  });

  it('маска тумана мягкая: открытая клетка прозрачна, дальний край закрыт', () => {
    const mask = rasterFog(createSeedWorld(), guest, 48);
    const at = (nx: number, ny: number) => mask[Math.floor(ny * 48) * 48 + Math.floor(nx * 48)] ?? 1;
    expect(at(0.28, 0.48)).toBeLessThan(0.35);
    expect(at(0.02, 0.02)).toBeGreaterThan(0.85);
    expect(at(0.84, 0.68)).toBeGreaterThan(0.7);
  });
});
