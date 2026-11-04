import { writeAudit } from './audit';
import { DomainError } from './errors';
import type {
  Actor,
  HandFill,
  HandSide,
  Hands,
  Hero,
  Item,
  ItemInstance,
  OpMeta,
  SpellRow,
  Wield,
  World,
} from './types';

const BOTH: Wield[] = ['two', 'bow', 'crossbow'];

export function wieldOf(item: Item): Wield | null {
  const value = item.props.wield;
  if (
    value === 'one' ||
    value === 'two' ||
    value === 'bow' ||
    value === 'crossbow' ||
    value === 'staff' ||
    value === 'shield' ||
    value === 'torch' ||
    value === 'combat_scroll'
  ) {
    return value;
  }
  if (item.kind === 'combat_scroll') return 'combat_scroll';
  if (item.kind === 'weapon') return 'one';
  return null;
}

export function occupiesBoth(wield: Wield): boolean {
  return BOTH.includes(wield);
}

export function emptyHands(): Hands {
  return { left: null, right: null };
}

export function brokenArm(hero: Hero, side: HandSide): boolean {
  return hero.injuries.some((row) => {
    const text = row.toLowerCase();
    if (!text.includes('перелом') || !text.includes('рук')) return false;
    if (side === 'left') return text.includes('лев');
    return text.includes('прав');
  });
}

export function anyBrokenArm(hero: Hero): boolean {
  return brokenArm(hero, 'left') || brokenArm(hero, 'right');
}

function owner(actor: Actor, heroId: string): void {
  const own =
    (actor.role === 'player' && actor.heroId === heroId) ||
    (actor.role === 'gm' && actor.preview && actor.heroId === heroId);
  if (!own) throw new DomainError('Руки правит только сам герой.');
}

function heroOf(world: World, id: string): Hero {
  const hero = world.heroes.find((row) => row.id === id);
  if (!hero) throw new DomainError('Такого героя нет.');
  return hero;
}

function spellOf(world: World, heroId: string, name: string): SpellRow {
  const spell = world.spells.find((row) => row.hero_id === heroId && row.spell === name);
  if (!spell) throw new DomainError('Это заклинание не выучено.');
  return spell;
}

/** Порог ступени: 1→0, 2→25, 3→50, 4→75, 5→100. */
export function tierNeed(tier: number): number {
  return [0, 0, 25, 50, 75, 100][tier] ?? 0;
}

export function castWarning(skillValue: number, tier: number): string | null {
  if (skillValue >= tierNeed(tier)) return null;
  return 'Ступень выше навыка школы: сотворение стоит ×2 и с −20.';
}

function skillValue(world: World, heroId: string, skill: string): number {
  return world.skills.find((row) => row.hero_id === heroId && row.skill === skill)?.value ?? 15;
}

function hasPerk(world: World, heroId: string, perk: string): boolean {
  return world.perks.some((row) => row.hero_id === heroId && row.perk === perk);
}

function hasSchoolPerk(world: World, heroId: string, school: string): boolean {
  return world.perks.some((row) => row.hero_id === heroId && row.skill === school);
}

function instanceOf(world: World, id: string): ItemInstance {
  const row = world.item_instances.find((item) => item.id === id);
  if (!row) throw new DomainError('Вещи уже нет.');
  return row;
}

function catalog(world: World, itemId: string): Item {
  const row = world.items.find((item) => item.id === itemId);
  if (!row) throw new DomainError('Предмета нет в каталоге.');
  return row;
}

function handsHold(hero: Hero, instanceId: string): boolean {
  return [hero.hands.left, hero.hands.right].some((fill) => fill?.kind === 'item' && fill.instanceId === instanceId);
}

function releaseItem(world: World, hero: Hero, instanceId: string, now: string): void {
  if (handsHold(hero, instanceId)) return;
  const inst = world.item_instances.find((row) => row.id === instanceId);
  if (inst && inst.location === 'worn') {
    inst.location = 'bag';
    inst.updated_at = now;
  }
}

function clearSide(world: World, hero: Hero, side: HandSide, now: string): void {
  const fill = hero.hands[side];
  if (!fill) return;
  if (fill.kind === 'item' && fill.grip === 'both') {
    hero.hands.left = null;
    hero.hands.right = null;
    releaseItem(world, hero, fill.instanceId, now);
    return;
  }
  hero.hands[side] = null;
  if (fill.kind === 'item') releaseItem(world, hero, fill.instanceId, now);
}

function sideName(side: HandSide): string {
  return side === 'left' ? 'Левая' : 'Правая';
}

/**
 * Смена руки сразу, как надеть броню. Пишется в журнал.
 * Двуручное, лук и арбалет занимают обе руки.
 */
export function setHand(world: World, actor: Actor, heroId: string, side: HandSide, fill: HandFill, meta: OpMeta): World {
  owner(actor, heroId);
  const next = structuredClone(world);
  const hero = heroOf(next, heroId);
  if (brokenArm(hero, side) && fill) {
    throw new DomainError(`${sideName(side)} рука сломана — в неё ничего не взять.`);
  }
  const before = structuredClone(hero.hands);

  if (!fill) {
    clearSide(next, hero, side, meta.now);
  } else if (fill.kind === 'spell') {
    spellOf(next, heroId, fill.spell);
    clearSide(next, hero, side, meta.now);
    hero.hands[side] = { kind: 'spell', spell: fill.spell };
  } else {
    const inst = instanceOf(next, fill.instanceId);
    if (inst.owner_hero_id !== heroId) throw new DomainError('Это чужая вещь.');
    if (inst.location === 'in_transfer' || inst.location === 'ground') {
      throw new DomainError('Эту вещь сейчас нельзя взять в руку.');
    }
    const item = catalog(next, inst.item_id);
    const wield = wieldOf(item);
    if (!wield) throw new DomainError('Это не берётся в руку.');
    if ((occupiesBoth(wield) || wield === 'shield') && anyBrokenArm(hero)) {
      throw new DomainError('С переломом руки нельзя двуручное, щит и лук.');
    }
    if (wield === 'shield' && side !== 'left') throw new DomainError('Щит берут только в левую руку.');
    if (occupiesBoth(wield)) {
      clearSide(next, hero, 'left', meta.now);
      clearSide(next, hero, 'right', meta.now);
      const both: HandFill = { kind: 'item', instanceId: inst.id, grip: 'both' };
      hero.hands.left = both;
      hero.hands.right = structuredClone(both);
    } else {
      clearSide(next, hero, side, meta.now);
      const other: HandSide = side === 'left' ? 'right' : 'left';
      const otherFill = hero.hands[other];
      if (otherFill?.kind === 'item' && otherFill.instanceId === inst.id) {
        hero.hands[other] = null;
      }
      hero.hands[side] = { kind: 'item', instanceId: inst.id, grip: 'one' };
    }
    inst.location = 'worn';
    inst.updated_at = meta.now;
  }

  hero.updated_at = meta.now;
  writeAudit(next, actor, meta, {
    hero_id: heroId,
    action: 'hands',
    summary: fill ? `В ${side === 'left' ? 'левую' : 'правую'} руку` : `Освободил ${side === 'left' ? 'левую' : 'правую'} руку`,
    before: { hands: before as unknown as Record<string, unknown> },
    after: { hands: structuredClone(hero.hands) as unknown as Record<string, unknown> },
    undo: { kind: 'hands', hands: before },
  });
  return next;
}

export function handHints(world: World, hero: Hero): string[] {
  const hints: string[] = [];
  const left = hero.hands.left;
  const right = hero.hands.right;
  if (anyBrokenArm(hero)) {
    const which = [brokenArm(hero, 'left') ? 'левая' : '', brokenArm(hero, 'right') ? 'правая' : ''].filter(Boolean).join(' и ');
    hints.push(`Перелом руки (${which}): эта рука закрыта, двуручное, щит и лук нельзя.`);
  }
  const leftItem = left?.kind === 'item' ? catalogOrNull(world, left.instanceId) : null;
  const rightItem = right?.kind === 'item' ? catalogOrNull(world, right.instanceId) : null;
  const weaponish = (item: Item | null) => {
    const wield = item ? wieldOf(item) : null;
    return wield === 'one' || wield === 'staff';
  };
  if (left?.kind === 'item' && right?.kind === 'item' && left.grip === 'one' && right.grip === 'one' && weaponish(leftItem) && weaponish(rightItem)) {
    if (hasPerk(world, hero.id, 'Двойной вихрь')) {
      hints.push('Оружие в обеих руках. Перк «Двойной вихрь»: вторая рука без штрафа.');
    } else {
      hints.push('Оружие в обеих руках можно. Без перка «Двойной вихрь» атака второй (левой) рукой с −20.');
    }
  }
  if (leftItem && wieldOf(leftItem) === 'shield' && rightItem && weaponish(rightItem)) {
    const block = skillValue(world, hero.id, 'Блок');
    hints.push(`Щит и оружие. Блок: d100 ≤ ${block} + 20.`);
  }
  if (left?.kind === 'spell' && right?.kind === 'spell') {
    if (left.spell === right.spell) {
      const spell = world.spells.find((row) => row.hero_id === hero.id && row.spell === left.spell);
      const school = spell?.school ?? 'школы';
      if (spell && hasSchoolPerk(world, hero.id, spell.school)) {
        hints.push(`Двойное сотворение «${left.spell}»: перк школы «${school}» есть.`);
      } else {
        hints.push(`Одно заклинание в обеих руках. Нужен перк школы «${school}», иначе это не двойное сотворение.`);
      }
    }
  }
  for (const fill of [left, right]) {
    if (fill?.kind !== 'spell') continue;
    const spell = world.spells.find((row) => row.hero_id === hero.id && row.spell === fill.spell);
    if (!spell) continue;
    const warning = castWarning(skillValue(world, hero.id, spell.school), spell.tier);
    if (warning) hints.push(`«${spell.spell}». ${warning}`);
  }
  return hints;
}

function catalogOrNull(world: World, instanceId: string): Item | null {
  const inst = world.item_instances.find((row) => row.id === instanceId);
  if (!inst) return null;
  return world.items.find((row) => row.id === inst.item_id) ?? null;
}

export function describeFill(world: World, fill: HandFill): string {
  if (!fill) return 'пусто';
  if (fill.kind === 'spell') return fill.spell;
  const item = catalogOrNull(world, fill.instanceId);
  if (!item) return 'пусто';
  return fill.grip === 'both' ? `${item.name} · обе руки` : item.name;
}

export function saveLoadout(world: World, actor: Actor, heroId: string, name: string, meta: OpMeta): World {
  owner(actor, heroId);
  const title = name.trim();
  if (!title) throw new DomainError('Назовите набор.');
  const next = structuredClone(world);
  const hero = heroOf(next, heroId);
  if (hero.loadouts.length >= 4) throw new DomainError('Избранного уже четыре. Сотрите набор.');
  hero.loadouts.push({ id: meta.id, name: title, hands: structuredClone(hero.hands) });
  writeAudit(next, actor, { ...meta, id: `${meta.id}-audit` }, {
    hero_id: heroId,
    action: 'loadout_save',
    summary: `Избранное «${title}»`,
    before: null,
    after: { loadout: title },
    undo: { kind: 'drop_loadout', id: meta.id },
  });
  return next;
}

export function deleteLoadout(world: World, actor: Actor, heroId: string, loadoutId: string, meta: OpMeta): World {
  owner(actor, heroId);
  const next = structuredClone(world);
  const hero = heroOf(next, heroId);
  const found = hero.loadouts.find((row) => row.id === loadoutId);
  if (!found) throw new DomainError('Такого набора нет.');
  hero.loadouts = hero.loadouts.filter((row) => row.id !== loadoutId);
  writeAudit(next, actor, meta, {
    hero_id: heroId,
    action: 'loadout_drop',
    summary: `Снят набор «${found.name}»`,
    before: { name: found.name },
    after: null,
    undo: null,
  });
  return next;
}

export function applyLoadout(world: World, actor: Actor, heroId: string, loadoutId: string, meta: OpMeta): World {
  owner(actor, heroId);
  const hero = heroOf(world, heroId);
  const set = hero.loadouts.find((row) => row.id === loadoutId);
  if (!set) throw new DomainError('Такого набора нет.');
  for (const side of ['left', 'right'] as const) {
    const fill = set.hands[side];
    if (fill?.kind === 'item') {
      const inst = world.item_instances.find((row) => row.id === fill.instanceId);
      if (!inst || inst.owner_hero_id !== heroId || inst.location === 'ground' || inst.location === 'in_transfer') {
        throw new DomainError('В наборе есть вещь, которой уже нет в сумке.');
      }
    }
    if (fill?.kind === 'spell') spellOf(world, heroId, fill.spell);
  }
  const both = set.hands.left?.kind === 'item' && set.hands.left.grip === 'both';
  if (both && anyBrokenArm(hero)) throw new DomainError('С переломом руки этот набор не взять.');
  let next = world;
  next = setHand(next, actor, heroId, 'left', null, { ...meta, id: `${meta.id}-clear-l`, now: meta.now });
  next = setHand(next, actor, heroId, 'right', null, { ...meta, id: `${meta.id}-clear-r`, now: meta.now });
  const rightFirst = set.hands.right?.kind === 'item' && set.hands.right.grip === 'both' ? 'right' : 'left';
  const order: HandSide[] = rightFirst === 'left' ? ['left', 'right'] : ['right', 'left'];
  for (const side of order) {
    const fill = set.hands[side];
    if (!fill) continue;
    if (fill.kind === 'item' && fill.grip === 'both' && side === 'right' && nextHero(next, heroId).hands.left?.kind === 'item') {
      continue;
    }
    next = setHand(next, actor, heroId, side, fill, { ...meta, id: `${meta.id}-${side}`, now: meta.now });
  }
  writeAudit(next, actor, { ...meta, id: `${meta.id}-apply` }, {
    hero_id: heroId,
    action: 'loadout_apply',
    summary: `Избранное «${set.name}»`,
    before: null,
    after: { loadout: set.name },
    undo: null,
  });
  return next;
}

function nextHero(world: World, id: string): Hero {
  return heroOf(world, id);
}

export function inFight(world: World, heroId: string): boolean {
  return world.sessions.some((row) => row.status === 'live' && row.table_heroes.includes(heroId));
}

export interface LearnedSpell {
  spell: string;
  school: string;
  tier: number;
  warning: string | null;
}

/**
 * Прочесть свиток знания.
 * TODO(supabase): props.spell нельзя отдавать клиенту. Раскрытие — RPC learn_spell_tome.
 * На Pages имя лежит в бандле; интерфейс его не показывает, пока свиток не прочитан.
 */
export function learnSpellTome(
  world: World,
  actor: Actor,
  instanceId: string,
  meta: OpMeta,
): { world: World; learned: LearnedSpell | null; message: string; changed: boolean } {
  const inst = world.item_instances.find((row) => row.id === instanceId);
  if (!inst) throw new DomainError('Свитка уже нет.');
  owner(actor, inst.owner_hero_id);
  const item = catalog(world, inst.item_id);
  if (item.kind !== 'spell_tome') throw new DomainError('Это не свиток знания.');
  const spellName = String(item.props.spell ?? '');
  const school = String(item.props.school ?? '');
  const tier = Number(item.props.tier ?? 1);
  const cost = Number(item.props.cost ?? 10);
  if (!spellName || !school) throw new DomainError('В свитке не записано заклинание.');
  if (inFight(world, inst.owner_hero_id)) {
    throw new DomainError('Свиток знания читают вне боя, не за столом.');
  }
  const known = world.spells.some((row) => row.hero_id === inst.owner_hero_id && row.spell === spellName);
  if (known) {
    return { world, learned: null, message: 'Вы уже знаете это.', changed: false };
  }
  const next = structuredClone(world);
  const row = next.item_instances.find((entry) => entry.id === instanceId)!;
  const snapshot = structuredClone(row);
  row.qty -= 1;
  if (row.qty <= 0) next.item_instances = next.item_instances.filter((entry) => entry.id !== row.id);
  next.spells.push({
    hero_id: inst.owner_hero_id,
    spell: spellName,
    school,
    cost,
    tier,
  });
  const warning = castWarning(skillValue(next, inst.owner_hero_id, school), tier);
  writeAudit(next, actor, meta, {
    hero_id: inst.owner_hero_id,
    action: 'learn_spell_tome',
    summary: `Выучено «${spellName}»`,
    before: { spell: null },
    after: { spell: spellName, school, tier, instanceId },
    undo: { kind: 'learn_tome', spell: spellName, instance: snapshot },
  });
  const tierName = ['', 'ученик', 'подмастерье', 'адепт', 'эксперт', 'мастер'][tier] ?? String(tier);
  const message = warning
    ? `Вы выучили: ${spellName}. ${school}, ступень «${tierName}». ${warning}`
    : `Вы выучили: ${spellName}. ${school}, ступень «${tierName}».`;
  return {
    world: next,
    changed: true,
    learned: { spell: spellName, school, tier, warning },
    message,
  };
}

export function veilOf(item: Item): { title: string; text: string; hint: string } {
  return {
    title: item.name,
    text: item.public_desc,
    hint: typeof item.props.hint === 'string' ? item.props.hint : '',
  };
}
