import { describe, expect, it } from 'vitest';
import { HERO, createSeedWorld } from '../data/seed';
import { decideRequest, useItem, withdrawRequest } from './domain';
import { benchView, enchantTier, queueCraft } from './craft';
import { watchFlags } from './watch';
import type { Actor, Item, OpMeta, World } from './types';

const meta: OpMeta = { id: 'm1', opId: 'm1', now: '2026-11-04T12:00:00.000Z', splitId: 'split' };
const rimte: Actor = { role: 'player', heroId: HERO.rimte, preview: false };
const toivo: Actor = { role: 'player', heroId: HERO.toivo, preview: false };
const guest: Actor = { role: 'guest', heroId: null, preview: false };
const gm: Actor = { role: 'gm', heroId: null, preview: false };

function accept(world: World, id: string, now = meta.now): World {
  return decideRequest(world, gm, id, true, '', now);
}

function put(world: World, heroId: string, item: Item, instanceId: string, qty = 1, props: Record<string, unknown> = {}): void {
  if (!world.items.some((row) => row.id === item.id)) world.items.push(item);
  world.item_instances.push({
    id: instanceId,
    item_id: item.id,
    qty,
    owner_hero_id: heroId,
    location: 'bag',
    custom_name: null,
    props,
    secret: false,
    notes: null,
    created_at: meta.now,
    updated_at: meta.now,
  });
}

const herb = (id: string, name: string): Item => ({
  id,
  name,
  kind: 'ingredient',
  weight: { n: 1, d: 5 },
  price: 1,
  lot: 1,
  props: {},
  public_desc: 'Пробный ингредиент.',
});

describe('ремесло', () => {
  it('пробу видит только герой: знаток открывает два свойства, вредное бьёт слегка', () => {
    const world = createSeedWorld();
    const before = benchView(world, rimte, HERO.rimte)!;
    const rust = before.ingredients.find((row) => row.itemId === 'ing-rust')!;
    expect(rust.known[0]).toBe('Тихий шаг');
    expect(rust.known[2]).toBeNull();
    expect(benchView(world, toivo, HERO.rimte)).toBeNull();
    expect(benchView(world, gm, HERO.rimte)!.ingredients.find((row) => row.itemId === 'ing-rust')!.known[2]).toBe('Урон выносливости');

    put(world, HERO.rimte, herb('ing-bile', 'Жёлчь'), 'bile-1', 2);
    const hero = world.heroes.find((row) => row.id === HERO.rimte)!;
    const health = hero.health;
    const queued = queueCraft(world, rimte, HERO.rimte, { action: 'taste', instanceIds: ['bile-1'] }, meta);
    const done = accept(queued, 'm1');
    const known = done.knowledge.find((row) => row.ref === 'ing-bile' && row.kind === 'ingredient_prop')!;
    expect(known.detail).toBe('1,2');
    expect(done.heroes.find((row) => row.id === HERO.rimte)!.health).toBe(health - 5);
    expect(benchView(done, rimte, HERO.rimte)!.ingredients.find((row) => row.itemId === 'ing-bile')!.known).toEqual([
      'Урон здоровью',
      'Восстановить здоровье',
      null,
      null,
    ]);
    expect(benchView(done, toivo, HERO.rimte)).toBeNull();
  });

  it('эксперимент открывает общее свойство, пустая пара запоминается, варка по рецепту повторяет зелье', () => {
    const world = createSeedWorld();
    const queued = queueCraft(world, rimte, HERO.rimte, {
      action: 'experiment',
      instanceIds: ['b1000000-0000-4000-8000-000000000006', 'b1000000-0000-4000-8000-000000000008'],
    }, meta);
    const done = accept(queued, 'm1');
    const potion = done.items.find((row) => row.id === 'craft-m1')!;
    expect(potion.name).toContain('Тихий шаг');
    expect(potion.props.effects).toEqual(['ТШ']);
    expect(done.knowledge.some((row) => row.kind === 'recipe' && row.ref === 'ing-root+ing-rust')).toBe(true);
    expect(done.item_instances.find((row) => row.id === 'inst-m1')?.owner_hero_id).toBe(HERO.rimte);
    expect(watchFlags(done, done.heroes.find((row) => row.id === HERO.rimte)!).some((flag) => flag.code === 'orphan_item' && flag.text.includes('Тихий шаг'))).toBe(false);

    put(done, HERO.rimte, herb('ing-dust', 'Пыль'), 'dust-1');
    put(done, HERO.rimte, herb('ing-mist', 'Дымка'), 'mist-1');
    const barren = accept(queueCraft(done, rimte, HERO.rimte, { action: 'experiment', instanceIds: ['dust-1', 'mist-1'] }, { ...meta, id: 'm2' }), 'm2');
    expect(barren.knowledge.some((row) => row.kind === 'barren')).toBe(true);
    expect(barren.items.some((row) => row.id === 'craft-m2')).toBe(false);

    const brewed = accept(queueCraft(barren, rimte, HERO.rimte, {
      action: 'brew',
      recipeId: 'ing-root+ing-rust',
      instanceIds: ['b1000000-0000-4000-8000-000000000006', 'b1000000-0000-4000-8000-000000000008'],
    }, { ...meta, id: 'm3' }), 'm3');
    expect(brewed.items.some((row) => row.id === 'craft-m3')).toBe(true);
  });

  it('чистота убирает вред, щедрая варка даёт две дозы, откат возвращает даунтайм', () => {
    const world = createSeedWorld();
    world.perks.push({ hero_id: HERO.rimte, perk: 'Чистота', skill: 'Алхимия', taken_at: meta.now });
    world.perks.push({ hero_id: HERO.rimte, perk: 'Щедрая варка', skill: 'Алхимия', taken_at: meta.now });
    put(world, HERO.rimte, herb('ing-thorn', 'Колючка'), 'thorn-1', 2);
    const before = world.heroes.find((row) => row.id === HERO.rimte)!.downtime;
    const queued = queueCraft(world, rimte, HERO.rimte, {
      action: 'experiment',
      instanceIds: ['b1000000-0000-4000-8000-000000000006', 'thorn-1'],
    }, meta);
    expect(queued.heroes.find((row) => row.id === HERO.rimte)!.downtime).toBe(before - 1);
    const done = accept(queued, 'm1');
    expect(done.items.find((row) => row.id === 'craft-m1')!.props.effects).toEqual(['ТШ']);
    expect(done.item_instances.find((row) => row.id === 'inst-m1')!.qty).toBe(2);
    const back = withdrawRequest(queued, rimte, 'm1');
    expect(back.heroes.find((row) => row.id === HERO.rimte)!.downtime).toBe(before);
    expect(() => queueCraft(world, guest, HERO.rimte, { action: 'taste', instanceIds: ['b1000000-0000-4000-8000-000000000006'] }, meta)).toThrow(/сам герой/);
  });

  it('ковка знает тир и цену действия, зачарованную вещь точит только тайная ковка', () => {
    const world = createSeedWorld();
    world.heroes.find((row) => row.id === HERO.toivo)!.downtime = 6;
    expect(() => queueCraft(world, toivo, HERO.toivo, { action: 'smith', recipeId: 'dagger', tier: 2 }, meta)).toThrow(/Сталевар/);
    const forged = accept(queueCraft(world, toivo, HERO.toivo, { action: 'smith', recipeId: 'dagger', tier: 1 }, meta), 'm1');
    expect(forged.items.find((row) => row.id === 'craft-m1')!.name).toContain('Железо');
    const stock = forged.item_instances.find((row) => row.id === 'b2000000-0000-4000-8000-000000000008')!;
    stock.qty = 8;
    const heavy = queueCraft(forged, toivo, HERO.toivo, { action: 'smith', recipeId: 'heavy', tier: 1 }, { ...meta, id: 'm2' });
    expect(heavy.change_requests.find((row) => row.id === 'm2')!.payload.downtime_cost).toBe(2);

    const piece = forged.item_instances.find((row) => row.id === 'b2000000-0000-4000-8000-00000000000a')!;
    piece.props = { ...piece.props, charm: 'burn' };
    expect(() => queueCraft(forged, toivo, HERO.toivo, {
      action: 'improve',
      instanceIds: [piece.id, 'b2000000-0000-4000-8000-000000000008'],
    }, { ...meta, id: 'm3' })).toThrow(/Тайная ковка/);
    piece.props = { tier: 1 };
    forged.skills.find((row) => row.hero_id === HERO.toivo && row.skill === 'Кузнечное')!.value = 50;
    const improved = accept(queueCraft(forged, toivo, HERO.toivo, {
      action: 'improve',
      instanceIds: [piece.id, 'b2000000-0000-4000-8000-000000000008'],
    }, { ...meta, id: 'm4' }), 'm4');
    expect(improved.item_instances.find((row) => row.id === piece.id)!.props.quality).toBe('+2');
  });

  it('расколдовка учит чару навсегда, сосуд ограничивает ступень, петля бонусов не складывается', () => {
    const world = createSeedWorld();
    const learned = accept(queueCraft(world, toivo, HERO.toivo, {
      action: 'disenchant',
      instanceIds: ['b2000000-0000-4000-8000-00000000000b'],
    }, meta), 'm1');
    expect(learned.knowledge.some((row) => row.hero_id === HERO.toivo && row.kind === 'charm' && row.ref === 'burn')).toBe(true);
    expect(learned.item_instances.some((row) => row.id === 'b2000000-0000-4000-8000-00000000000b')).toBe(false);
    expect(learned.knowledge.some((row) => row.hero_id === HERO.rimte && row.kind === 'charm')).toBe(false);

    const enchanted = accept(queueCraft(learned, toivo, HERO.toivo, {
      action: 'enchant',
      instanceIds: ['b2000000-0000-4000-8000-00000000000a', 'b2000000-0000-4000-8000-00000000000c'],
      charmId: 'burn',
    }, { ...meta, id: 'm2' }), 'm2');
    const dagger = enchanted.item_instances.find((row) => row.id === 'b2000000-0000-4000-8000-00000000000a')!;
    expect(dagger.props.charm).toBe('burn');
    expect(dagger.props.charges).toBe(5);
    expect(enchanted.item_instances.some((row) => row.id === 'b2000000-0000-4000-8000-00000000000c')).toBe(false);
    expect(watchFlags(enchanted, enchanted.heroes.find((row) => row.id === HERO.toivo)!).some((flag) => flag.code === 'orphan_item' && flag.text.includes('кинжал'))).toBe(false);

    world.skills.find((row) => row.hero_id === HERO.toivo && row.skill === 'Зачарование')!.value = 25;
    world.knowledge.push({ hero_id: HERO.toivo, kind: 'boon', ref: 'insight', detail: '1' });
    world.item_instances.find((row) => row.id === 'b2000000-0000-4000-8000-000000000002')!.props = { fortifySkill: 'Зачарование', fortifyAmount: 30 };
    const limited = enchantTier(world, HERO.toivo, 4, 1);
    expect(limited.tier).toBe(2);
    world.knowledge = world.knowledge.filter((row) => row.ref !== 'insight');
    world.item_instances.find((row) => row.id === 'b2000000-0000-4000-8000-000000000002')!.props = {};
    world.skills.find((row) => row.hero_id === HERO.toivo && row.skill === 'Зачарование')!.value = 90;
    expect(enchantTier(world, HERO.toivo, 1, 1).tier).toBe(1);
    expect(enchantTier(world, HERO.toivo, 1, 4).tier).toBe(2);
  });

  it('зелье озарения копится до следующего наложения и тратится один раз', () => {
    const world = createSeedWorld();
    put(world, HERO.rimte, {
      id: 'potion-insight',
      name: 'Зелье озарения',
      kind: 'potion',
      weight: { n: 1, d: 3 },
      price: 0,
      lot: 1,
      props: { boon: 'insight' },
      public_desc: 'Следующая чара на ступень выше.',
    }, 'insight-1');
    const drunk = useItem(world, rimte, 'insight-1', meta);
    expect(drunk.world.knowledge.some((row) => row.kind === 'boon' && row.ref === 'insight')).toBe(true);
    expect(drunk.world.item_instances.some((row) => row.id === 'insight-1')).toBe(false);
  });
});
