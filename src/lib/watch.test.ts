import { describe, expect, it } from 'vitest';
import { HERO, createSeedWorld } from '../data/seed';
import { confirmEvent } from './domain';
import { watchFlags } from './watch';

const gm = { role: 'gm' as const, heroId: null, preview: false };

describe('дозор', () => {
  it('подсвечивает Ждана: выше максимума, перегруз, отметки, сироту, сессию и разрыв журнала', () => {
    const world = createSeedWorld();
    const zhdan = world.heroes.find((row) => row.id === HERO.zhdan)!;
    const codes = watchFlags(world, zhdan).map((row) => row.code);
    expect(codes).toContain('above_max');
    expect(codes).toContain('overload');
    expect(codes).toContain('too_many_marks');
    expect(codes).toContain('orphan_item');
    expect(codes).toContain('unconfirmed');
    expect(codes).toContain('resource_gap');
    expect(watchFlags(world, zhdan).some((row) => row.text.includes('Чужой сундук'))).toBe(true);
  });

  it('у Римте нет этих флагов, у Тойво есть заднее число', () => {
    const world = createSeedWorld();
    const rimte = world.heroes.find((row) => row.id === HERO.rimte)!;
    const toivo = world.heroes.find((row) => row.id === HERO.toivo)!;
    expect(watchFlags(world, rimte).map((row) => row.code)).not.toContain('orphan_item');
    expect(watchFlags(world, rimte)).toHaveLength(0);
    expect(watchFlags(world, toivo).some((row) => row.code === 'backdated')).toBe(true);
  });

  it('подтверждение мастера снимает флаг сессии', () => {
    const world = createSeedWorld();
    const event = world.audit_log.find((row) => row.id === 'zhdan-session-edit')!;
    const next = confirmEvent(world, gm, event.id, {
      id: 'ok',
      opId: 'ok',
      now: '2026-11-04T19:00:00.000Z',
    });
    const zhdan = next.heroes.find((row) => row.id === HERO.zhdan)!;
    expect(watchFlags(next, zhdan).some((row) => row.code === 'unconfirmed')).toBe(false);
  });
});
