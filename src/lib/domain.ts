import { addQ, mulQ, q, type Q } from './rational';
import { isSkillName, xpThreshold } from './skills';
import type {
  Actor,
  ChangeRequest,
  Hero,
  Item,
  ItemInstance,
  ItemKind,
  OpMeta,
  SkillRow,
  World,
} from './types';

export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainError';
  }
}

export function actorOf(session: { role: Actor['role']; heroId: string | null; preview: boolean }): Actor {
  return {
    role: session.role,
    heroId: session.heroId,
    preview: session.role === 'gm' ? session.preview : false,
  };
}

export function isGm(actor: Actor): boolean {
  return actor.role === 'gm' && !actor.preview;
}

export function canEditHero(actor: Actor, heroId: string): boolean {
  if (actor.role === 'player') return actor.heroId === heroId;
  if (actor.role === 'gm' && actor.preview) return actor.heroId === heroId;
  return false;
}

/** Gifts are for the owner and the real GM, not for another player and not in preview of someone else. */
export function canSeeSecrets(actor: Actor, heroId: string): boolean {
  if (isGm(actor)) return true;
  return canEditHero(actor, heroId);
}

export function heroById(world: World, id: string): Hero {
  const hero = world.heroes.find((row) => row.id === id);
  if (!hero) throw new DomainError('Такого героя нет.');
  return hero;
}

export function heroBySlug(world: World, slug: string): Hero | undefined {
  return world.heroes.find((row) => row.slug === slug);
}

export function skillRow(world: World, heroId: string, skill: string): SkillRow | undefined {
  return world.skills.find((row) => row.hero_id === heroId && row.skill === skill);
}

export function pendingRequests(world: World, heroId: string): ChangeRequest[] {
  return world.change_requests.filter((row) => row.hero_id === heroId && row.status === 'pending');
}

export function pendingMarkCount(world: World, heroId: string, skill: string): number {
  return pendingRequests(world, heroId).filter(
    (row) => row.kind === 'skill_mark' && row.payload.skill === skill,
  ).length;
}

export function pendingCountForHero(world: World, heroId: string): number {
  const requests = pendingRequests(world, heroId).length;
  const transfers = world.transfers.filter(
    (row) => row.status === 'pending' && (row.from_hero === heroId || row.to_hero === heroId),
  ).length;
  return requests + transfers;
}

export function gmPendingCount(world: World): number {
  return (
    world.change_requests.filter((row) => row.status === 'pending').length +
    world.transfers.filter((row) => row.status === 'pending').length
  );
}

const CARRIED: Array<ItemInstance['location']> = ['bag', 'worn', 'stash', 'in_transfer'];

export function gearWeight(world: World, heroId: string): Q {
  let sum = q(0, 1);
  for (const inst of world.item_instances) {
    if (inst.owner_hero_id !== heroId) continue;
    if (!CARRIED.includes(inst.location)) continue;
    const item = world.items.find((row) => row.id === inst.item_id);
    if (!item) continue;
    sum = addQ(sum, mulQ(item.weight, inst.qty));
  }
  return sum;
}

/** Coin purse is a third of a slot when the wallet is not empty. */
export const PURSE_WEIGHT = q(1, 3);

export function carryWeight(world: World, hero: Hero): Q {
  let sum = gearWeight(world, hero.id);
  const coins = hero.coin_crowns + hero.coin_scales + hero.coin_copper + hero.coin_receipts;
  if (coins > 0) sum = addQ(sum, PURSE_WEIGHT);
  return sum;
}

export function capacitySlots(hero: Hero): number {
  return hero.stamina_max / 10;
}

export function priceLabel(item: Item, qty: number): string {
  if (item.price <= 0) return '—';
  if (item.lot > 1) {
    if (qty === item.lot) return String(item.price);
    const scaled = (item.price * qty) / item.lot;
    return Number.isInteger(scaled) ? String(scaled) : '—';
  }
  if (qty === 1) return String(item.price);
  if (item.price === 1) return String(qty);
  return `${qty}×${item.price}`;
}

export function itemOf(world: World, instance: ItemInstance): Item {
  const item = world.items.find((row) => row.id === instance.item_id);
  if (!item) throw new DomainError('Предмета нет в каталоге.');
  return item;
}

function requireOwner(actor: Actor, heroId: string): void {
  if (!canEditHero(actor, heroId)) throw new DomainError('Это может править только сам герой.');
}

function requireGm(actor: Actor): void {
  if (!isGm(actor)) throw new DomainError('Решает только мастер.');
}

function touchHero(hero: Hero, now: string, patch: Partial<Hero>): Hero {
  return { ...hero, ...patch, updated_at: now };
}

export function setStat(
  world: World,
  actor: Actor,
  heroId: string,
  stat: 'health' | 'magic' | 'stamina',
  value: number,
  now: string,
): World {
  requireOwner(actor, heroId);
  const next = structuredClone(world);
  const hero = heroById(next, heroId);
  const max = stat === 'health' ? hero.health_max : stat === 'magic' ? hero.magic_max : hero.stamina_max;
  if (!Number.isFinite(value)) throw new DomainError('Нужно число.');
  const clamped = Math.max(0, Math.min(max, Math.round(value)));
  const patch: Partial<Hero> =
    stat === 'health' ? { health: clamped } : stat === 'magic' ? { magic: clamped } : { stamina: clamped };
  Object.assign(hero, touchHero(hero, now, patch));
  return next;
}

export function saveNote(world: World, actor: Actor, heroId: string, body: string, meta: OpMeta): World {
  requireOwner(actor, heroId);
  const next = structuredClone(world);
  const text = body.trim();
  const existing = next.notes.find((row) => row.hero_id === heroId && row.target === 'sheet');
  if (!text) {
    next.notes = next.notes.filter((row) => row !== existing);
    return next;
  }
  if (existing) {
    existing.body = text;
    return next;
  }
  next.notes.push({
    id: meta.id,
    hero_id: heroId,
    target: 'sheet',
    body: text,
    created_at: meta.now,
  });
  return next;
}

export function queueSkillMark(world: World, actor: Actor, heroId: string, skill: string, meta: OpMeta): World {
  requireOwner(actor, heroId);
  if (!isSkillName(skill)) throw new DomainError('Такого навыка нет.');
  const row = skillRow(world, heroId, skill);
  if (!row) throw new DomainError('Навык не записан на листе.');
  const pending = pendingMarkCount(world, heroId, skill);
  if (row.marks + pending >= 3) throw new DomainError('Отметок за сессию уже три.');
  const next = structuredClone(world);
  next.change_requests.push({
    id: meta.id,
    hero_id: heroId,
    kind: 'skill_mark',
    payload: { skill },
    summary: `Отметка навыка «${skill}»`,
    status: 'pending',
    gm_comment: null,
    decided_by: null,
    decided_at: null,
    client_op_id: meta.opId,
    created_at: meta.now,
  });
  return next;
}

export function queuePerk(
  world: World,
  actor: Actor,
  heroId: string,
  perk: string,
  skill: string,
  meta: OpMeta,
): World {
  requireOwner(actor, heroId);
  const name = perk.trim();
  if (!name) throw new DomainError('Нужно название перка.');
  if (skill && !isSkillName(skill)) throw new DomainError('Такого навыка нет.');
  if (world.perks.some((row) => row.hero_id === heroId && row.perk === name)) {
    throw new DomainError('Перк уже на листе.');
  }
  if (
    pendingRequests(world, heroId).some((row) => row.kind === 'perk' && row.payload.perk === name)
  ) {
    throw new DomainError('Заявка на этот перк уже ждёт.');
  }
  const next = structuredClone(world);
  next.change_requests.push({
    id: meta.id,
    hero_id: heroId,
    kind: 'perk',
    payload: { perk: name, skill },
    summary: `Перк «${name}»${skill ? ` · ${skill}` : ''}`,
    status: 'pending',
    gm_comment: null,
    decided_by: null,
    decided_at: null,
    client_op_id: meta.opId,
    created_at: meta.now,
  });
  return next;
}

export function queueDrop(world: World, actor: Actor, instanceId: string, meta: OpMeta): World {
  const inst = world.item_instances.find((row) => row.id === instanceId);
  if (!inst) throw new DomainError('Вещи уже нет.');
  requireOwner(actor, inst.owner_hero_id);
  if (inst.location === 'worn') throw new DomainError('Сначала снимите вещь.');
  if (inst.location === 'in_transfer') throw new DomainError('Вещь уже в передаче.');
  if (inst.location === 'ground') throw new DomainError('Вещь уже выброшена.');
  const waiting = pendingRequests(world, inst.owner_hero_id).some(
    (row) => row.kind === 'other' && row.payload.action === 'drop' && row.payload.instance_id === instanceId,
  );
  if (waiting) throw new DomainError('Выброс уже ждёт мастера.');
  const item = itemOf(world, inst);
  const next = structuredClone(world);
  next.change_requests.push({
    id: meta.id,
    hero_id: inst.owner_hero_id,
    kind: 'other',
    payload: { action: 'drop', instance_id: instanceId },
    summary: `Выбросить «${inst.custom_name ?? item.name}»`,
    status: 'pending',
    gm_comment: null,
    decided_by: null,
    decided_at: null,
    client_op_id: meta.opId,
    created_at: meta.now,
  });
  return next;
}

export function setEquipped(world: World, actor: Actor, instanceId: string, worn: boolean, now: string): World {
  const next = structuredClone(world);
  const inst = next.item_instances.find((row) => row.id === instanceId);
  if (!inst) throw new DomainError('Вещи уже нет.');
  requireOwner(actor, inst.owner_hero_id);
  if (inst.location === 'in_transfer' || inst.location === 'ground') {
    throw new DomainError('Эту вещь сейчас нельзя надеть.');
  }
  const item = itemOf(next, inst);
  if (item.kind !== 'weapon' && item.kind !== 'armor') {
    throw new DomainError('Надеваются оружие и броня.');
  }
  inst.location = worn ? 'worn' : 'bag';
  inst.updated_at = now;
  return next;
}

function effectOf(item: Item): { stat: 'health' | 'magic' | 'stamina'; amount: number } | null {
  const effect = item.props.effect;
  if (!effect || typeof effect !== 'object') return null;
  const stat = (effect as { stat?: unknown }).stat;
  const amount = (effect as { amount?: unknown }).amount;
  if (stat !== 'health' && stat !== 'magic' && stat !== 'stamina') return null;
  if (typeof amount !== 'number' || amount <= 0) return null;
  return { stat, amount };
}

export function useItem(world: World, actor: Actor, instanceId: string, now: string): { world: World; message: string } {
  const next = structuredClone(world);
  const inst = next.item_instances.find((row) => row.id === instanceId);
  if (!inst) throw new DomainError('Вещи уже нет.');
  requireOwner(actor, inst.owner_hero_id);
  if (inst.location !== 'bag' && inst.location !== 'worn') throw new DomainError('Вещь не под рукой.');
  const item = itemOf(next, inst);
  const effect = effectOf(item);
  if (!effect) throw new DomainError('Этим нельзя воспользоваться.');
  const hero = heroById(next, inst.owner_hero_id);
  const max = hero[`${effect.stat}_max`];
  const current = hero[effect.stat];
  const updated = Math.min(max, current + effect.amount);
  Object.assign(hero, touchHero(hero, now, { [effect.stat]: updated }));
  inst.qty -= 1;
  inst.updated_at = now;
  if (inst.qty <= 0) {
    next.item_instances = next.item_instances.filter((row) => row.id !== inst.id);
  }
  const statName = effect.stat === 'health' ? 'здоровья' : effect.stat === 'magic' ? 'магии' : 'выносливости';
  const gained = updated - current;
  return {
    world: next,
    message: gained > 0 ? `Выпито: +${gained} ${statName}.` : `Выпито. ${statName[0]!.toUpperCase()}${statName.slice(1)} уже полные.`,
  };
}

export function queueTransfer(
  world: World,
  actor: Actor,
  instanceId: string,
  toHeroId: string,
  qty: number,
  meta: OpMeta,
): World {
  const inst = world.item_instances.find((row) => row.id === instanceId);
  if (!inst) throw new DomainError('Вещи уже нет.');
  requireOwner(actor, inst.owner_hero_id);
  if (inst.location === 'worn') throw new DomainError('Сначала снимите вещь.');
  if (inst.location === 'in_transfer') throw new DomainError('Вещь уже в передаче.');
  if (!Number.isInteger(qty) || qty < 1 || qty > inst.qty) throw new DomainError('Столько отдать нельзя.');
  if (toHeroId === inst.owner_hero_id) throw new DomainError('Некому отдавать: это вы.');
  const target = world.heroes.find((row) => row.id === toHeroId);
  if (!target || (target.status !== 'alive' && target.status !== 'wounded')) {
    throw new DomainError('Герой не может принять вещь.');
  }
  const next = structuredClone(world);
  const source = next.item_instances.find((row) => row.id === instanceId)!;
  const item = itemOf(next, source);
  let movingId = source.id;
  if (qty < source.qty) {
    source.qty -= qty;
    source.updated_at = meta.now;
    movingId = meta.splitId ?? meta.id;
    next.item_instances.push({
      ...source,
      id: movingId,
      qty,
      location: 'in_transfer',
      created_at: meta.now,
      updated_at: meta.now,
    });
  } else {
    source.location = 'in_transfer';
    source.updated_at = meta.now;
  }
  next.transfers.push({
    id: meta.id,
    instance_id: movingId,
    item_id: item.id,
    qty,
    from_hero: inst.owner_hero_id,
    to_hero: toHeroId,
    kind: 'give',
    status: 'pending',
    reason: null,
    client_op_id: meta.opId,
    created_by: actor.heroId ?? 'gm',
    created_at: meta.now,
  });
  return next;
}

function mergeIntoBag(world: World, inst: ItemInstance, now: string): void {
  const twin = world.item_instances.find(
    (row) =>
      row.id !== inst.id &&
      row.owner_hero_id === inst.owner_hero_id &&
      row.item_id === inst.item_id &&
      row.location === 'bag' &&
      row.secret === inst.secret &&
      JSON.stringify(row.props) === JSON.stringify(inst.props) &&
      row.custom_name === inst.custom_name,
  );
  if (twin) {
    twin.qty += inst.qty;
    twin.updated_at = now;
    world.item_instances = world.item_instances.filter((row) => row.id !== inst.id);
    return;
  }
  inst.location = 'bag';
  inst.updated_at = now;
}

export function withdrawRequest(world: World, actor: Actor, requestId: string): World {
  const next = structuredClone(world);
  const request = next.change_requests.find((row) => row.id === requestId);
  if (!request) throw new DomainError('Заявки нет.');
  if (request.status !== 'pending') throw new DomainError('Заявка уже решена.');
  if (!canEditHero(actor, request.hero_id) && !isGm(actor)) {
    throw new DomainError('Отозвать может только герой.');
  }
  request.status = 'withdrawn';
  return next;
}

export function withdrawTransfer(world: World, actor: Actor, transferId: string, now: string): World {
  const next = structuredClone(world);
  const transfer = next.transfers.find((row) => row.id === transferId);
  if (!transfer) throw new DomainError('Передачи нет.');
  if (transfer.status !== 'pending') throw new DomainError('Передача уже решена.');
  if (!canEditHero(actor, transfer.from_hero) && !isGm(actor)) {
    throw new DomainError('Отозвать может только отдающий.');
  }
  transfer.status = 'rejected';
  transfer.reason = 'отозвано';
  const inst = next.item_instances.find((row) => row.id === transfer.instance_id);
  if (inst) mergeIntoBag(next, inst, now);
  return next;
}

function applyApproved(world: World, request: ChangeRequest, now: string): void {
  if (request.kind === 'skill_mark') {
    const skill = String(request.payload.skill ?? '');
    const row = world.skills.find((entry) => entry.hero_id === request.hero_id && entry.skill === skill);
    if (!row) throw new DomainError('Навык не записан на листе.');
    if (row.marks >= 3) throw new DomainError('Отметок уже три — принять нельзя.');
    row.marks += 1;
    return;
  }
  if (request.kind === 'perk') {
    const perk = String(request.payload.perk ?? '').trim();
    const skill = String(request.payload.skill ?? '');
    if (!perk) throw new DomainError('В заявке нет названия перка.');
    if (world.perks.some((row) => row.hero_id === request.hero_id && row.perk === perk)) {
      throw new DomainError('Перк уже на листе.');
    }
    world.perks.push({ hero_id: request.hero_id, perk, skill, taken_at: now });
    return;
  }
  if (request.kind === 'level_up') {
    const hero = heroById(world, request.hero_id);
    if (hero.xp < hero.xp_next) throw new DomainError('Не хватает опыта для уровня.');
    const level = hero.level + 1;
    Object.assign(
      hero,
      touchHero(hero, now, {
        level,
        xp: hero.xp - hero.xp_next,
        xp_next: xpThreshold(level),
      }),
    );
    return;
  }
  if (request.kind === 'craft') {
    const name = String(request.payload.name ?? 'Поделка');
    const kind = (request.payload.kind as ItemKind) ?? 'misc';
    const weight = request.payload.weight as Q | undefined;
    const qty = Number(request.payload.qty ?? 1);
    if (!weight || typeof weight.n !== 'number' || typeof weight.d !== 'number') {
      throw new DomainError('У поделки не задан груз.');
    }
    const itemId = `craft-${request.id}`;
    world.items.push({
      id: itemId,
      name,
      kind,
      weight: q(weight.n, weight.d),
      price: 0,
      lot: 1,
      props: (request.payload.props as Record<string, unknown>) ?? {},
      public_desc: String(request.payload.public_desc ?? 'Собрано в ремесле и подтверждено мастером.'),
    });
    world.item_instances.push({
      id: `inst-${request.id}`,
      item_id: itemId,
      qty: Math.max(1, qty),
      owner_hero_id: request.hero_id,
      location: 'bag',
      custom_name: null,
      props: {},
      secret: false,
      notes: null,
      created_at: now,
      updated_at: now,
    });
    return;
  }
  if (request.kind === 'rumor') {
    const rumor = world.rumors.find((row) => row.id === request.payload.rumor_id);
    if (rumor) rumor.status = 'published';
    return;
  }
  if (request.kind === 'other' && request.payload.action === 'drop') {
    const inst = world.item_instances.find((row) => row.id === request.payload.instance_id);
    if (!inst) throw new DomainError('Вещи уже нет.');
    inst.location = 'ground';
    inst.updated_at = now;
    return;
  }
  if (request.kind === 'book_read') {
    const title = String(request.payload.title ?? 'книга');
    world.knowledge.push({
      hero_id: request.hero_id,
      kind: 'blueprint',
      ref: String(request.payload.book_id ?? title),
      detail: `Прочитано: ${title}`,
    });
  }
}

export function decideRequest(
  world: World,
  actor: Actor,
  requestId: string,
  accept: boolean,
  comment: string,
  now: string,
): World {
  requireGm(actor);
  const next = structuredClone(world);
  const request = next.change_requests.find((row) => row.id === requestId);
  if (!request) throw new DomainError('Заявки нет.');
  if (request.status !== 'pending') throw new DomainError('Заявка уже решена.');
  if (accept) applyApproved(next, request, now);
  if (request.kind === 'rumor' && !accept) {
    const rumor = next.rumors.find((row) => row.id === request.payload.rumor_id);
    if (rumor) rumor.status = 'rejected';
  }
  request.status = accept ? 'approved' : 'rejected';
  request.gm_comment = comment.trim() || null;
  request.decided_by = 'gm';
  request.decided_at = now;
  return next;
}

export function decideTransfer(
  world: World,
  actor: Actor,
  transferId: string,
  accept: boolean,
  comment: string,
  now: string,
): World {
  requireGm(actor);
  const next = structuredClone(world);
  const transfer = next.transfers.find((row) => row.id === transferId);
  if (!transfer) throw new DomainError('Передачи нет.');
  if (transfer.status !== 'pending') throw new DomainError('Передача уже решена.');
  const inst = next.item_instances.find((row) => row.id === transfer.instance_id);
  if (!inst) throw new DomainError('Вещи уже нет.');
  if (accept) {
    inst.owner_hero_id = transfer.to_hero;
    mergeIntoBag(next, inst, now);
    transfer.status = 'done';
  } else {
    mergeIntoBag(next, inst, now);
    transfer.status = 'rejected';
  }
  transfer.reason = comment.trim() || transfer.reason;
  return next;
}

export function grantItem(
  world: World,
  actor: Actor,
  heroId: string,
  itemId: string,
  qty: number,
  meta: OpMeta,
): World {
  requireGm(actor);
  if (!Number.isInteger(qty) || qty < 1) throw new DomainError('Нужно количество больше нуля.');
  const item = world.items.find((row) => row.id === itemId);
  if (!item) throw new DomainError('Предмета нет в каталоге.');
  heroById(world, heroId);
  const next = structuredClone(world);
  const inst: ItemInstance = {
    id: meta.id,
    item_id: itemId,
    qty,
    owner_hero_id: heroId,
    location: 'bag',
    custom_name: null,
    props: {},
    secret: false,
    notes: null,
    created_at: meta.now,
    updated_at: meta.now,
  };
  const bagTwin = next.item_instances.find(
    (row) =>
      row.owner_hero_id === heroId &&
      row.item_id === itemId &&
      row.location === 'bag' &&
      !row.secret &&
      !row.custom_name,
  );
  const stackable = bagTwin && item.kind !== 'weapon' && item.kind !== 'armor' && item.kind !== 'book';
  if (stackable && bagTwin) {
    bagTwin.qty += qty;
    bagTwin.updated_at = meta.now;
  } else {
    next.item_instances.push(inst);
  }
  next.transfers.push({
    id: meta.opId,
    instance_id: stackable && bagTwin ? bagTwin.id : meta.id,
    item_id: itemId,
    qty,
    from_hero: heroId,
    to_hero: heroId,
    kind: 'gm_grant',
    status: 'done',
    reason: 'выдано мастером',
    client_op_id: meta.opId,
    created_by: 'gm',
    created_at: meta.now,
  });
  return next;
}

export function visibleInstances(world: World, actor: Actor, heroId: string): ItemInstance[] {
  return world.item_instances.filter((row) => {
    if (row.owner_hero_id !== heroId) return false;
    if (row.location === 'ground') return false;
    if (row.secret && !canSeeSecrets(actor, heroId)) return false;
    if (actor.role === 'guest') return false;
    return true;
  });
}
