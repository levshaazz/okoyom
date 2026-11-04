import { describe, expect, it } from 'vitest';
import { HERO, createSeedWorld } from '../data/seed';
import {
  DomainError,
  applyLoadout,
  handHints,
  learnSpellTome,
  rollbackEvent,
  saveLoadout,
  setHand,
} from './domain';
import type { Actor, OpMeta, World } from './types';

const rimte: Actor = { role: 'player', heroId: HERO.rimte, preview: false };
const toivo: Actor = { role: 'player', heroId: HERO.toivo, preview: false };
const zhdan: Actor = { role: 'player', heroId: HERO.zhdan, preview: false };
const gm: Actor = { role: 'gm', heroId: null, preview: false };
const meta: OpMeta = { id: 'id-1', opId: 'op-1', now: '2026-11-04T18:00:00.000Z', splitId: 'id-split' };

const BOW = 'b1000000-0000-4000-8000-000000000001';
const SWORD = 'b1000000-0000-4000-8000-000000000002';
const SHIELD = 'b3000000-0000-4000-8000-000000000002';
const TOME = 'b1000000-0000-4000-8000-00000000000f';
const TOME_T = 'b2000000-0000-4000-8000-000000000006';
const TOME_Z = 'b3000000-0000-4000-8000-000000000006';

function hero(world: World, id: string) {
  return world.heroes.find((row) => row.id === id)!;
}

describe('две руки', () => {
  it('лук занимает обе руки, одноручное освобождает их', () => {
    const world = createSeedWorld();
    const sheet = hero(world, HERO.rimte);
    expect(sheet.hands.left?.kind).toBe('item');
    expect(sheet.hands.right).toMatchObject({ instanceId: BOW, grip: 'both' });
    const next = setHand(world, rimte, HERO.rimte, 'right', { kind: 'item', instanceId: SWORD, grip: 'one' }, meta);
    const after = hero(next, HERO.rimte);
    expect(after.hands.right).toMatchObject({ instanceId: SWORD, grip: 'one' });
    expect(after.hands.left).toBeNull();
    expect(next.item_instances.find((row) => row.id === BOW)?.location).toBe('bag');
    expect(next.audit_log.some((row) => row.action === 'hands' && row.hero_id === HERO.rimte)).toBe(true);
  });

  it('щит только в левую', () => {
    const world = createSeedWorld();
    expect(() => setHand(world, zhdan, HERO.zhdan, 'right', { kind: 'item', instanceId: SHIELD, grip: 'one' }, meta)).toThrow(
      /левую/,
    );
  });

  it('без «Двойного вихря» вторая рука с −20, с перком — без штрафа', () => {
    const world = createSeedWorld();
    const copy = structuredClone(world.item_instances.find((row) => row.id === SWORD)!);
    copy.id = 'extra-sword';
    world.item_instances.push(copy);
    const left = setHand(world, rimte, HERO.rimte, 'left', { kind: 'item', instanceId: 'extra-sword', grip: 'one' }, meta);
    const dual = setHand(left, rimte, HERO.rimte, 'right', { kind: 'item', instanceId: SWORD, grip: 'one' }, {
      ...meta,
      id: 'id-2',
    });
    expect(handHints(dual, hero(dual, HERO.rimte)).join(' ')).toMatch(/−20/);
    dual.perks.push({ hero_id: HERO.rimte, perk: 'Двойной вихрь', skill: 'Одноручное', taken_at: meta.now });
    expect(handHints(dual, hero(dual, HERO.rimte)).join(' ')).toMatch(/без штрафа/);
    expect(handHints(dual, hero(dual, HERO.rimte)).join(' ')).not.toMatch(/−20/);
  });

  it('щит и оружие показывают блок', () => {
    const text = handHints(createSeedWorld(), hero(createSeedWorld(), HERO.zhdan)).join(' ');
    expect(text).toMatch(/d100 ≤ 28 \+ 20/);
  });

  it('одно заклинание в двух руках требует перк школы', () => {
    const world = createSeedWorld();
    world.perks = world.perks.filter((row) => row.perk !== 'Ученик восстановления');
    const left = setHand(world, toivo, HERO.toivo, 'left', { kind: 'spell', spell: 'Лечение' }, meta);
    const both = setHand(left, toivo, HERO.toivo, 'right', { kind: 'spell', spell: 'Лечение' }, { ...meta, id: 'id-r' });
    expect(handHints(both, hero(both, HERO.toivo)).join(' ')).toMatch(/Нужен перк школы/);
    const skilled = createSeedWorld();
    const a = setHand(skilled, toivo, HERO.toivo, 'right', { kind: 'spell', spell: 'Лечение' }, meta);
    expect(handHints(a, hero(a, HERO.toivo)).join(' ')).toMatch(/Двойное сотворение/);
  });

  it('разные заклинания можно без перка школы', () => {
    const world = createSeedWorld();
    world.perks = world.perks.filter((row) => row.hero_id !== HERO.toivo);
    const next = setHand(world, toivo, HERO.toivo, 'right', { kind: 'spell', spell: 'Свет' }, meta);
    const hints = handHints(next, hero(next, HERO.toivo)).join(' ');
    expect(hints).not.toMatch(/Нужен перк школы/);
  });

  it('перелом левой руки закрывает руку, лук и щит', () => {
    const world = createSeedWorld();
    hero(world, HERO.rimte).injuries = ['Перелом левой руки'];
    expect(() => setHand(world, rimte, HERO.rimte, 'left', { kind: 'spell', spell: 'Лечение' }, meta)).toThrow(/сломана/);
    expect(() =>
      setHand(world, rimte, HERO.rimte, 'right', { kind: 'item', instanceId: BOW, grip: 'both' }, meta),
    ).toThrow(/нельзя двуручное/);
    hero(world, HERO.zhdan).injuries = ['Перелом правой руки'];
    expect(() => setHand(world, zhdan, HERO.zhdan, 'left', { kind: 'item', instanceId: SHIELD, grip: 'one' }, meta)).toThrow(
      /нельзя двуручное/,
    );
  });

  it('избранное хранит до четырёх наборов и возвращает руки', () => {
    let world = createSeedWorld();
    world = saveLoadout(world, rimte, HERO.rimte, 'Запасной', meta);
    world = setHand(world, rimte, HERO.rimte, 'right', { kind: 'item', instanceId: SWORD, grip: 'one' }, {
      ...meta,
      id: 'swap',
    });
    expect(hero(world, HERO.rimte).hands.left).toBeNull();
    world = applyLoadout(world, rimte, HERO.rimte, 'fav-rimte-bow', { ...meta, id: 'back' });
    expect(hero(world, HERO.rimte).hands.left).toMatchObject({ instanceId: BOW, grip: 'both' });
    world = saveLoadout(world, rimte, HERO.rimte, 'Второй', { ...meta, id: 'b' });
    world = saveLoadout(world, rimte, HERO.rimte, 'Третий', { ...meta, id: 'c' });
    expect(hero(world, HERO.rimte).loadouts).toHaveLength(4);
    expect(() => saveLoadout(world, rimte, HERO.rimte, 'Пятый', { ...meta, id: 'e' })).toThrow(DomainError);
  });
});

describe('свиток знания', () => {
  it('учит заклинание и списывает свиток одной правкой журнала', () => {
    const world = createSeedWorld();
    const result = learnSpellTome(world, rimte, TOME, meta);
    expect(result.changed).toBe(true);
    expect(result.learned?.spell).toBe('Искра');
    expect(result.message).toMatch(/Вы выучили: Искра/);
    expect(result.world.spells.some((row) => row.spell === 'Искра' && row.hero_id === HERO.rimte)).toBe(true);
    expect(result.world.item_instances.some((row) => row.id === TOME)).toBe(false);
    const events = result.world.audit_log.filter((row) => row.action === 'learn_spell_tome');
    expect(events).toHaveLength(1);
    expect(world.item_instances.some((row) => row.id === TOME)).toBe(true);
    expect(world.spells.some((row) => row.spell === 'Искра')).toBe(false);
  });

  it('уже известное не тратит свиток', () => {
    const world = createSeedWorld();
    world.spells.push({ hero_id: HERO.rimte, spell: 'Искра', school: 'Разрушение', cost: 12, tier: 1 });
    const result = learnSpellTome(world, rimte, TOME, meta);
    expect(result.changed).toBe(false);
    expect(result.message).toBe('Вы уже знаете это.');
    expect(result.world.item_instances.some((row) => row.id === TOME)).toBe(true);
  });

  it('ступень выше навыка учится, но с предупреждением', () => {
    const result = learnSpellTome(createSeedWorld(), toivo, TOME_T, meta);
    expect(result.learned?.spell).toBe('Круг жизни');
    expect(result.learned?.warning).toMatch(/×2/);
    expect(result.message).toMatch(/×2/);
  });

  it('за столом живой сессии свиток не читается', () => {
    expect(() => learnSpellTome(createSeedWorld(), zhdan, TOME_Z, meta)).toThrow(/вне боя/);
    const world = createSeedWorld();
    expect(world.item_instances.some((row) => row.id === TOME_Z)).toBe(true);
  });

  it('откат возвращает свиток и снимает заклинание', () => {
    const learned = learnSpellTome(createSeedWorld(), rimte, TOME, meta);
    const event = learned.world.audit_log.find((row) => row.action === 'learn_spell_tome')!;
    const back = rollbackEvent(learned.world, gm, event.id, { ...meta, id: 'undo' });
    expect(back.spells.some((row) => row.spell === 'Искра')).toBe(false);
    expect(back.item_instances.some((row) => row.id === TOME)).toBe(true);
    expect(back.audit_log.find((row) => row.id === event.id)?.reverted_by).toBe('undo');
  });
});
