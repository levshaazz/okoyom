import { CHARMS, EFFECTS, INGREDIENTS, SMITH_RECIPES, SMITH_TIERS, VESSELS, type CharmDef, type VesselId } from '../data/craft';
import { writeAudit } from './audit';
import { liveSessionId } from './audit';
import { DomainError } from './errors';
import { q } from './rational';
import type { Actor, ChangeRequest, Item, ItemInstance, OpMeta, World } from './types';

export interface CraftOrder {
  action: 'taste' | 'experiment' | 'brew' | 'smith' | 'improve' | 'disenchant' | 'enchant' | 'recharge' | 'repair';
  instanceIds?: string[];
  recipeId?: string;
  tier?: number;
  charmId?: string;
}

const POTION_TIER = ['малое', 'среднее', 'большое', 'великое'] as const;

function owns(actor: Actor, heroId: string): boolean {
  return (actor.role === 'player' && actor.heroId === heroId) || (actor.role === 'gm' && actor.preview && actor.heroId === heroId);
}

function isRealGm(actor: Actor): boolean {
  return actor.role === 'gm' && !actor.preview;
}

function itemOf(world: World, inst: ItemInstance): Item {
  const item = world.items.find((row) => row.id === inst.item_id);
  if (!item) throw new DomainError('Предмета нет в каталоге.');
  return item;
}

function bag(world: World, heroId: string, instanceId: string): ItemInstance {
  const inst = world.item_instances.find((row) => row.id === instanceId);
  if (!inst || inst.owner_hero_id !== heroId || inst.qty < 1) throw new DomainError('Этой вещи нет в сумке.');
  if (inst.location !== 'bag') throw new DomainError('Сначала уберите вещь в сумку.');
  return inst;
}

function merged(world: World, inst: ItemInstance): Record<string, unknown> {
  return { ...itemOf(world, inst).props, ...inst.props };
}

function skillOf(world: World, heroId: string, skill: string): number {
  return world.skills.find((row) => row.hero_id === heroId && row.skill === skill)?.value ?? 0;
}

function hasPerk(world: World, heroId: string, name: string): boolean {
  return world.perks.some((row) => row.hero_id === heroId && row.perk === name);
}

function perkCount(world: World, heroId: string, prefix: string): number {
  return world.perks.filter((row) => row.hero_id === heroId && row.perk.startsWith(prefix)).length;
}

export function weekKey(iso: string): string {
  const date = new Date(iso);
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${week}`;
}

function indexesOf(world: World, heroId: string, itemId: string): number[] {
  const row = world.knowledge.find((entry) => entry.hero_id === heroId && entry.kind === 'ingredient_prop' && entry.ref === itemId);
  if (!row?.detail) return [];
  return row.detail.split(',').map((part) => Number(part)).filter((n) => n >= 1 && n <= 4);
}

function learnIndexes(world: World, heroId: string, itemId: string, indexes: number[]): void {
  let row = world.knowledge.find((entry) => entry.hero_id === heroId && entry.kind === 'ingredient_prop' && entry.ref === itemId);
  if (!row) {
    row = { hero_id: heroId, kind: 'ingredient_prop', ref: itemId, detail: '' };
    world.knowledge.push(row);
  }
  const have = new Set(indexesOf(world, heroId, itemId));
  for (const index of indexes) have.add(index);
  row.detail = [...have].sort((a, b) => a - b).join(',');
}

function effectsOf(itemId: string): [string, string, string, string] {
  const effects = INGREDIENTS[itemId];
  if (!effects) throw new DomainError('Этого ингредиента нет в пробном каталоге. Полная таблица у мастера.');
  return effects;
}

function takeQty(world: World, inst: ItemInstance, qty: number, now: string): void {
  if (inst.qty < qty) throw new DomainError('Не хватает материала.');
  inst.qty -= qty;
  inst.updated_at = now;
  if (inst.qty <= 0) world.item_instances = world.item_instances.filter((row) => row.id !== inst.id);
}

function takeMaterial(world: World, heroId: string, qty: number, now: string, match: (item: Item, inst: ItemInstance) => boolean): void {
  let left = qty;
  const hits = world.item_instances.filter((inst) => {
    if (inst.owner_hero_id !== heroId || inst.location !== 'bag') return false;
    return match(itemOf(world, inst), inst);
  });
  for (const inst of hits) {
    if (left <= 0) break;
    const use = Math.min(inst.qty, left);
    takeQty(world, inst, use, now);
    left -= use;
  }
  if (left > 0) throw new DomainError('Не хватает материала.');
}

function spendDowntime(world: World, heroId: string, cost: number): number {
  if (cost <= 0) return 0;
  const hero = world.heroes.find((row) => row.id === heroId);
  if (!hero) throw new DomainError('Такого героя нет.');
  if (hero.downtime < cost) throw new DomainError('Не хватает действий даунтайма.');
  hero.downtime -= cost;
  return cost;
}

export function refundCraft(world: World, request: ChangeRequest): void {
  const cost = Number(request.payload.downtime_cost ?? 0);
  if (!cost || request.payload.refunded) return;
  const hero = world.heroes.find((row) => row.id === request.hero_id);
  if (hero) hero.downtime += cost;
  request.payload.refunded = true;
}

function noteMark(world: World, heroId: string, skill: string, now: string): { skill?: string; week?: string } {
  const week = weekKey(now);
  const already = world.audit_log.some((event) => {
    if (event.hero_id !== heroId || event.action !== 'craft' || event.reverted_by) return false;
    const after = event.after as { markSkill?: string; markWeek?: string } | null;
    return after?.markSkill === skill && after.markWeek === week;
  });
  const row = world.skills.find((entry) => entry.hero_id === heroId && entry.skill === skill);
  if (!row || already || row.marks >= 3) return {};
  row.marks += 1;
  return { skill, week };
}

function pushResult(
  world: World,
  request: ChangeRequest,
  now: string,
  spec: { name: string; kind: Item['kind']; weightN: number; weightD: number; qty: number; desc: string; props: Record<string, unknown>; instProps?: Record<string, unknown> },
): string {
  const itemId = `craft-${request.id}`;
  const instanceId = `inst-${request.id}`;
  world.items.push({
    id: itemId,
    name: spec.name,
    kind: spec.kind,
    weight: q(spec.weightN, spec.weightD),
    price: 0,
    lot: 1,
    props: spec.props,
    public_desc: spec.desc,
  });
  world.item_instances.push({
    id: instanceId,
    item_id: itemId,
    qty: spec.qty,
    owner_hero_id: request.hero_id,
    location: 'bag',
    custom_name: null,
    props: spec.instProps ?? {},
    secret: false,
    notes: null,
    created_at: now,
    updated_at: now,
  });
  return instanceId;
}

function potionStep(world: World, heroId: string, harmful: boolean): number {
  const fortify = bestFortify(world, heroId, 'Алхимия');
  const skill = skillOf(world, heroId, 'Алхимия') + fortify;
  let step = skill < 35 ? 0 : skill < 70 ? 1 : 2;
  step += perkCount(world, heroId, 'Сила зелий');
  if (harmful && hasPerk(world, heroId, 'Отравитель')) step += 1;
  return Math.min(3, step);
}

/** Один внешний бонус: наибольшая чара навыка, остальные не складываются. */
export function bestFortify(world: World, heroId: string, skill: string): number {
  let best = 0;
  for (const inst of world.item_instances) {
    if (inst.owner_hero_id !== heroId || inst.location !== 'worn') continue;
    const props = merged(world, inst);
    if (props.fortifySkill !== skill || typeof props.fortifyAmount !== 'number') continue;
    best = Math.max(best, props.fortifyAmount);
  }
  return Math.min(40, best);
}

function fortifySum(world: World, heroId: string, skill: string): number {
  let sum = 0;
  for (const inst of world.item_instances) {
    if (inst.owner_hero_id !== heroId || inst.location === 'ground') continue;
    const props = merged(world, inst);
    if (props.fortifySkill === skill && typeof props.fortifyAmount === 'number') sum += props.fortifyAmount;
  }
  return sum;
}

function sharedEffects(itemIds: string[]): string[] {
  const lists = itemIds.map((id) => effectsOf(id));
  return lists[0]!.filter((code) => lists.every((list) => list.includes(code)));
}

function pairKey(ids: string[]): string {
  return [...ids].sort().join('+');
}

function rememberRecipe(world: World, heroId: string, itemIds: string[], codes: string[]): void {
  const ref = pairKey(itemIds);
  const detail = codes.join(',');
  const row = world.knowledge.find((entry) => entry.hero_id === heroId && entry.kind === 'recipe' && entry.ref === ref);
  if (row) row.detail = detail;
  else world.knowledge.push({ hero_id: heroId, kind: 'recipe', ref, detail });
}

function rememberBarren(world: World, heroId: string, itemIds: string[]): void {
  const ref = pairKey(itemIds);
  if (world.knowledge.some((entry) => entry.hero_id === heroId && entry.kind === 'barren' && entry.ref === ref)) return;
  world.knowledge.push({ hero_id: heroId, kind: 'barren', ref, detail: '' });
}

function brewPotion(world: World, request: ChangeRequest, itemIds: string[], codes: string[], now: string): string {
  const heroId = request.hero_id;
  const harmfulOnly = codes.every((code) => EFFECTS[code]?.harmful);
  const step = potionStep(world, heroId, harmfulOnly);
  const keep = hasPerk(world, heroId, 'Чистота') ? codes.filter((code) => !EFFECTS[code]?.harmful) : codes;
  const used = keep.length > 0 ? keep : codes;
  const label = POTION_TIER[step];
  const names = used.map((code) => EFFECTS[code]?.name ?? code);
  const scales = used.map((code) => EFFECTS[code]?.scale[step] ?? '');
  const poison = used.every((code) => EFFECTS[code]?.harmful);
  const boon = used.map((code) => EFFECTS[code]?.boon).find(Boolean) ?? null;
  const statCode = used.find((code) => EFFECTS[code]?.stat);
  const stat = statCode ? EFFECTS[statCode]! : null;
  const name = poison ? `Яд: ${names.join(', ')}` : `Зелье: ${names.join(', ')}`;
  const desc = `${label}. ${names.map((title, index) => `${title} ${scales[index]}`).join('. ')}.`;
  const props: Record<string, unknown> = { effects: used, tier: label };
  if (boon) props.boon = boon;
  if (stat?.stat && stat.amounts) props.effect = { stat: stat.stat, amount: stat.amounts[step] };
  const qty = hasPerk(world, heroId, 'Щедрая варка') ? 2 : 1;
  return pushResult(world, request, now, {
    name,
    kind: 'potion',
    weightN: 1,
    weightD: 3,
    qty,
    desc,
    props,
  });
}

function improveBonus(skill: number, armor: boolean): number {
  const table: [number, number][] = armor
    ? [[100, 3], [90, 3], [75, 2], [60, 2], [50, 1], [30, 1]]
    : [[100, 4], [90, 3], [75, 3], [60, 2], [50, 2], [30, 1], [25, 1]];
  for (const [min, bonus] of table) if (skill >= min) return bonus;
  return 0;
}

function enchantTierFromSkill(skill: number): number {
  if (skill >= 90) return 4;
  if (skill >= 60) return 3;
  if (skill >= 30) return 2;
  return 1;
}

function vesselOf(props: Record<string, unknown>): VesselId {
  const raw = props.vessel;
  if (raw === 'medium' || raw === 'large' || raw === 'grand' || raw === 'small') return raw;
  return 'small';
}

function hasBoon(world: World, heroId: string, boon: string): boolean {
  return world.knowledge.some((row) => row.hero_id === heroId && row.kind === 'boon' && row.ref === boon);
}

function consumeBoon(world: World, heroId: string, boon: string): void {
  world.knowledge = world.knowledge.filter((row) => !(row.hero_id === heroId && row.kind === 'boon' && row.ref === boon));
}

export function grantBoon(world: World, heroId: string, boon: 'insight' | 'masters_hand'): void {
  if (hasBoon(world, heroId, boon)) return;
  world.knowledge.push({ hero_id: heroId, kind: 'boon', ref: boon, detail: '1' });
}

/**
 * Ступень чар. Внешний бонус один: либо озарение, либо чара навыка, что сильнее.
 * Ступень сосуда режет результат. Вещь тира 4+ поднимает потолок сосуда на 1, не выше IV.
 */
export function enchantTier(world: World, heroId: string, gemTier: number, itemTier: number): { tier: number; usedInsight: boolean } {
  const baseSkill = skillOf(world, heroId, 'Зачарование');
  const fortify = bestFortify(world, heroId, 'Зачарование');
  const perk = perkCount(world, heroId, 'Сила чар');
  const bare = enchantTierFromSkill(baseSkill) + perk;
  const withCharm = enchantTierFromSkill(baseSkill + fortify) + perk;
  const insight = hasBoon(world, heroId, 'insight');
  const withInsight = bare + (insight ? 1 : 0);
  const skillTier = Math.max(withCharm, withInsight);
  const usedInsight = insight && withInsight >= withCharm;
  const gemCap = Math.min(4, gemTier + (itemTier >= 4 ? 1 : 0));
  return { tier: Math.max(1, Math.min(4, skillTier, gemCap)), usedInsight };
}

function charmDef(id: string): CharmDef | undefined {
  return CHARMS.find((row) => row.id === id);
}

function knownCharm(world: World, heroId: string, charmId: string): boolean {
  return world.knowledge.some((row) => row.hero_id === heroId && row.kind === 'charm' && row.ref === charmId);
}

function learnCharm(world: World, heroId: string, charmId: string, name: string): void {
  if (knownCharm(world, heroId, charmId)) return;
  world.knowledge.push({ hero_id: heroId, kind: 'charm', ref: charmId, detail: name });
}

function assertWorkshop(world: World, heroId: string): void {
  if (liveSessionId(world, heroId)) throw new DomainError('Ремесло базы не делают за столом, пока сессия идёт.');
}

export function queueCraft(world: World, actor: Actor, heroId: string, order: CraftOrder, meta: OpMeta): World {
  if (!owns(actor, heroId)) throw new DomainError('Ремеслом занимается сам герой.');
  assertWorkshop(world, heroId);
  const next = structuredClone(world);
  const cost = previewCost(next, heroId, order);
  const spent = spendDowntime(next, heroId, cost);
  next.change_requests.push({
    id: meta.id,
    hero_id: heroId,
    kind: 'craft',
    payload: { action: order.action, instanceIds: order.instanceIds ?? [], recipeId: order.recipeId ?? null, tier: order.tier ?? null, charmId: order.charmId ?? null, downtime_cost: spent },
    summary: previewSummary(next, heroId, order),
    status: 'pending',
    gm_comment: null,
    decided_by: null,
    decided_at: null,
    client_op_id: meta.opId,
    created_at: meta.now,
  });
  return next;
}

function previewCost(world: World, heroId: string, order: CraftOrder): number {
  if (order.action === 'repair') {
    const inst = bag(world, heroId, order.instanceIds?.[0] ?? '');
    if (merged(world, inst).damaged !== true) throw new DomainError('Вещь не повреждена.');
    return 0;
  }
  if (order.action === 'recharge') {
    checkGear(world, heroId, order);
    return 0;
  }
  if (order.action === 'smith') {
    const recipe = SMITH_RECIPES.find((row) => row.id === order.recipeId);
    if (!recipe) throw new DomainError('Такого рецепта ковки нет.');
    const tier = order.tier ?? 1;
    const gate = SMITH_TIERS.find((row) => row.tier === tier);
    if (!gate) throw new DomainError('Такого тира нет.');
    if (gate.perk && !hasPerk(world, heroId, gate.perk)) throw new DomainError(`Нужен перк «${gate.perk}».`);
    if (skillOf(world, heroId, 'Кузнечное') < 15) throw new DomainError('Кузнечное ещё не открыто.');
    let ingots = recipe.ingots;
    if (recipe.id === 'heavy' && hasPerk(world, heroId, 'Бережливый горн')) ingots = Math.max(1, ingots - 1);
    const haveIngots = countMaterial(world, heroId, (item, inst) => item.props.craft === 'ingot' && Number(merged(world, inst).tier ?? item.props.tier) === tier);
    const haveLeather = countMaterial(world, heroId, (item) => item.props.craft === 'leather');
    if (haveIngots < ingots || haveLeather < recipe.leather) throw new DomainError('Не хватает слитков или кожи.');
    return recipe.actions;
  }
  if (order.action === 'taste' || order.action === 'experiment' || order.action === 'brew') {
    checkAlchemy(world, heroId, order);
    return 1;
  }
  if (order.action === 'improve' || order.action === 'disenchant' || order.action === 'enchant') {
    checkGear(world, heroId, order);
    return 1;
  }
  throw new DomainError('Такого ремесла нет.');
}

function countMaterial(world: World, heroId: string, match: (item: Item, inst: ItemInstance) => boolean): number {
  return world.item_instances.reduce((sum, inst) => {
    if (inst.owner_hero_id !== heroId || inst.location !== 'bag') return sum;
    return match(itemOf(world, inst), inst) ? sum + inst.qty : sum;
  }, 0);
}

function checkAlchemy(world: World, heroId: string, order: CraftOrder): void {
  const ids = order.instanceIds ?? [];
  if (order.action === 'taste') {
    if (ids.length !== 1) throw new DomainError('Для пробы нужен один ингредиент.');
    const inst = bag(world, heroId, ids[0]!);
    effectsOf(inst.item_id);
    return;
  }
  if (order.action === 'experiment') {
    if (ids.length < 2 || ids.length > 3) throw new DomainError('Эксперимент смешивает два или три ингредиента.');
    const itemIds = ids.map((id) => bag(world, heroId, id).item_id);
    if (new Set(itemIds).size !== itemIds.length) throw new DomainError('Нужны разные ингредиенты.');
    itemIds.forEach(effectsOf);
    return;
  }
  const ref = order.recipeId ?? '';
  const recipe = world.knowledge.find((row) => row.hero_id === heroId && row.kind === 'recipe' && row.ref === ref);
  if (!recipe) throw new DomainError('Такого рецепта нет.');
  const need = ref.split('+');
  const itemIds = ids.map((id) => bag(world, heroId, id).item_id);
  if (pairKey(itemIds) !== pairKey(need)) throw new DomainError('В сумке не те ингредиенты, что в рецепте.');
}

function checkGear(world: World, heroId: string, order: CraftOrder): void {
  const ids = order.instanceIds ?? [];
  if (order.action === 'improve') {
    if (ids.length !== 2) throw new DomainError('Нужны вещь и слиток.');
    const piece = bag(world, heroId, ids[0]!);
    const ingot = bag(world, heroId, ids[1]!);
    const pieceItem = itemOf(world, piece);
    if (pieceItem.kind !== 'weapon' && pieceItem.kind !== 'armor') throw new DomainError('Улучшают оружие и броню.');
    if (itemOf(world, ingot).props.craft !== 'ingot') throw new DomainError('Нужен слиток того же тира.');
    const pieceTier = Number(merged(world, piece).tier ?? 1);
    const ingotTier = Number(merged(world, ingot).tier ?? itemOf(world, ingot).props.tier ?? 0);
    if (ingotTier !== pieceTier) throw new DomainError('Слиток другого тира.');
    const charmed = Boolean(merged(world, piece).charm);
    if (charmed && !hasPerk(world, heroId, 'Тайная ковка')) throw new DomainError('Зачарованную вещь улучшает только «Тайная ковка».');
    return;
  }
  if (order.action === 'disenchant') {
    const inst = bag(world, heroId, ids[0] ?? '');
    const props = merged(world, inst);
    if (props.unique === true) throw new DomainError('Артефакт расколдовать нельзя.');
    if (typeof props.charm !== 'string') throw new DomainError('На вещи нет чар.');
    return;
  }
  if (order.action === 'enchant') {
    if (ids.length !== 2 || !order.charmId) throw new DomainError('Нужны вещь, сосуд и известная чара.');
    const piece = bag(world, heroId, ids[0]!);
    const gem = bag(world, heroId, ids[1]!);
    const charm = order.charmId;
    if (!knownCharm(world, heroId, charm)) throw new DomainError('Эта чара ещё не изучена.');
    const def = charmDef(charm);
    const pieceItem = itemOf(world, piece);
    const target = def?.target ?? 'weapon';
    if (target === 'weapon' && pieceItem.kind !== 'weapon') throw new DomainError('Эта чара ложится на оружие.');
    if (target === 'armor' && pieceItem.kind !== 'armor') throw new DomainError('Эта чара ложится на броню или украшение.');
    const props = merged(world, piece);
    const charms = [props.charm, props.charm2].filter((value) => typeof value === 'string');
    if (charms.length >= 2 || (charms.length === 1 && !hasPerk(world, heroId, 'Двойные чары'))) {
      throw new DomainError('На вещи уже есть чары.');
    }
    const gemProps = merged(world, gem);
    if (itemOf(world, gem).kind !== 'soulgem' || gemProps.filled !== true) throw new DomainError('Нужен наполненный сосуд.');
    if (def?.skill && def.amounts) {
      const tierGuess = enchantTier(world, heroId, VESSELS[vesselOf(gemProps)].tier, Number(props.tier ?? 1)).tier;
      const amount = def.amounts[tierGuess - 1] ?? 0;
      if (fortifySum(world, heroId, def.skill) + amount > 40) throw new DomainError('Потолок «укрепить навык» — +40.');
    }
    return;
  }
  if (order.action === 'recharge') {
    const weapon = bag(world, heroId, ids[0] ?? '');
    const gem = bag(world, heroId, ids[1] ?? '');
    if (itemOf(world, weapon).kind !== 'weapon') throw new DomainError('Заряжают оружие.');
    if (merged(world, gem).filled !== true) throw new DomainError('Сосуд пуст.');
  }
}

function previewSummary(world: World, heroId: string, order: CraftOrder): string {
  const name = (id?: string) => {
    if (!id) return 'вещь';
    const inst = world.item_instances.find((row) => row.id === id);
    return inst ? itemOf(world, inst).name : 'вещь';
  };
  if (order.action === 'taste') return `Проба: ${name(order.instanceIds?.[0])}`;
  if (order.action === 'experiment') return `Эксперимент: ${(order.instanceIds ?? []).map((id) => name(id)).join(' + ')}`;
  if (order.action === 'brew') return `Варка по рецепту ${order.recipeId}`;
  if (order.action === 'smith') {
    const recipe = SMITH_RECIPES.find((row) => row.id === order.recipeId);
    const tier = SMITH_TIERS.find((row) => row.tier === order.tier);
    return `Ковка: ${recipe?.name ?? 'вещь'} · ${tier?.label ?? ''}`;
  }
  if (order.action === 'improve') return `Улучшение: ${name(order.instanceIds?.[0])}`;
  if (order.action === 'disenchant') return `Расколдовка: ${name(order.instanceIds?.[0])}`;
  if (order.action === 'enchant') return `Зачарование: ${name(order.instanceIds?.[0])}`;
  if (order.action === 'recharge') return `Перезарядка: ${name(order.instanceIds?.[0])}`;
  return `Починка: ${name(order.instanceIds?.[0])}`;
}

export function resolveCraft(world: World, request: ChangeRequest, now: string): void {
  const order: CraftOrder = {
    action: request.payload.action as CraftOrder['action'],
    instanceIds: (request.payload.instanceIds as string[]) ?? [],
    recipeId: (request.payload.recipeId as string | null) ?? undefined,
    tier: (request.payload.tier as number | null) ?? undefined,
    charmId: (request.payload.charmId as string | null) ?? undefined,
  };
  const heroId = request.hero_id;
  let granted: string[] = [];
  let summary = request.summary;
  let skill = 'Алхимия';
  if (order.action === 'taste') {
    const inst = bag(world, heroId, order.instanceIds?.[0] ?? '');
    const effects = effectsOf(inst.item_id);
    const open = hasPerk(world, heroId, 'Знаток трав') ? [1, 2] : [1];
    learnIndexes(world, heroId, inst.item_id, open);
    const hero = world.heroes.find((row) => row.id === heroId)!;
    if (EFFECTS[effects[0]!]?.harmful) hero.health = Math.max(0, hero.health - 5);
    takeQty(world, inst, 1, now);
    summary = `Проба «${itemOf(world, inst).name}»: открыто ${open.length}`;
  } else if (order.action === 'experiment' || order.action === 'brew') {
    const ids = order.instanceIds ?? [];
    const insts = ids.map((id) => bag(world, heroId, id));
    const itemIds = insts.map((inst) => inst.item_id);
    const codes = order.action === 'brew'
      ? (world.knowledge.find((row) => row.hero_id === heroId && row.kind === 'recipe' && row.ref === order.recipeId)?.detail.split(',').filter(Boolean) ?? [])
      : sharedEffects(itemIds);
    if (order.action === 'experiment' && codes.length === 0) {
      rememberBarren(world, heroId, itemIds);
      for (const inst of insts) takeQty(world, inst, 1, now);
      summary = 'Эксперимент: общих свойств нет';
    } else {
      if (codes.length === 0) throw new DomainError('В рецепте нет свойств.');
      if (order.action === 'experiment') {
        itemIds.forEach((itemId, index) => {
          const effects = effectsOf(itemId);
          const found = effects.map((code, effectIndex) => (codes.includes(code) ? effectIndex + 1 : 0)).filter((n) => n > 0);
          learnIndexes(world, heroId, itemIds[index]!, found);
        });
        rememberRecipe(world, heroId, itemIds, codes);
      }
      granted = [brewPotion(world, request, itemIds, codes, now)];
      for (const inst of insts) takeQty(world, inst, 1, now);
      summary = order.action === 'brew' ? 'Варка по рецепту' : 'Эксперимент удался';
    }
  } else if (order.action === 'smith') {
    skill = 'Кузнечное';
    const recipe = SMITH_RECIPES.find((row) => row.id === order.recipeId)!;
    const tier = order.tier ?? 1;
    let ingots = recipe.ingots;
    if (recipe.id === 'heavy' && hasPerk(world, heroId, 'Бережливый горн')) ingots = Math.max(1, ingots - 1);
    takeMaterial(world, heroId, ingots, now, (item, inst) => item.props.craft === 'ingot' && Number(merged(world, inst).tier ?? item.props.tier) === tier);
    if (recipe.leather) takeMaterial(world, heroId, recipe.leather, now, (item) => item.props.craft === 'leather');
    const label = SMITH_TIERS.find((row) => row.tier === tier)?.label ?? `Тир ${tier}`;
    const damage = recipe.damage ? `${recipe.damage}${tier > 1 ? ` +${tier - 1}` : ''}` : undefined;
    granted = [pushResult(world, request, now, {
      name: `${recipe.name} · ${label}`,
      kind: recipe.kind,
      weightN: recipe.kind === 'armor' ? 2 : 1,
      weightD: 1,
      qty: 1,
      desc: 'Сковано в базе и подтверждено мастером.',
      props: { tier, damage, armor: recipe.armor, wield: recipe.wield, quality: '+0' },
    })];
    summary = `Сковано: ${recipe.name} · ${label}`;
  } else if (order.action === 'improve') {
    skill = 'Кузнечное';
    const piece = bag(world, heroId, order.instanceIds?.[0] ?? '');
    const ingot = bag(world, heroId, order.instanceIds?.[1] ?? '');
    const armor = itemOf(world, piece).kind === 'armor';
    const fortify = bestFortify(world, heroId, 'Кузнечное');
    const boon = hasBoon(world, heroId, 'masters_hand') ? 1 : 0;
    const fromCharm = improveBonus(skillOf(world, heroId, 'Кузнечное') + fortify, armor);
    const fromBoon = improveBonus(skillOf(world, heroId, 'Кузнечное'), armor) + boon;
    let bonus = Math.max(fromCharm, fromBoon);
    const tier = Number(merged(world, piece).tier ?? 1);
    const gate = SMITH_TIERS.find((row) => row.tier === tier);
    if (gate?.perk && !hasPerk(world, heroId, gate.perk)) bonus = Math.min(bonus, 1);
    const cap = armor ? 3 : 4;
    bonus = Math.min(cap, bonus);
    if (fromBoon >= fromCharm && boon) consumeBoon(world, heroId, 'masters_hand');
    piece.props = { ...piece.props, quality: `+${bonus}` };
    piece.updated_at = now;
    takeQty(world, ingot, 1, now);
    summary = `Улучшено до +${bonus}`;
  } else if (order.action === 'disenchant') {
    skill = 'Зачарование';
    const inst = bag(world, heroId, order.instanceIds?.[0] ?? '');
    const props = merged(world, inst);
    const charmId = String(props.charm);
    const name = charmDef(charmId)?.name ?? String(props.enchant ?? charmId);
    learnCharm(world, heroId, charmId, name);
    if (hasPerk(world, heroId, 'Чуткая расколдовка')) {
      inst.props = { ...inst.props, charm: null, enchant: 'нет' };
      inst.updated_at = now;
      summary = `Чара «${name}» изучена, вещь уцелела`;
    } else {
      world.item_instances = world.item_instances.filter((row) => row.id !== inst.id);
      summary = `Чара «${name}» изучена, вещь уничтожена`;
    }
  } else if (order.action === 'enchant') {
    skill = 'Зачарование';
    const piece = bag(world, heroId, order.instanceIds?.[0] ?? '');
    const gem = bag(world, heroId, order.instanceIds?.[1] ?? '');
    const charmId = order.charmId ?? '';
    const def = charmDef(charmId);
    const gemProps = merged(world, gem);
    const itemTier = Number(merged(world, piece).tier ?? 1);
    const rolled = enchantTier(world, heroId, VESSELS[vesselOf(gemProps)].tier, itemTier);
    const line = def?.lines[rolled.tier - 1] ?? `ступень ${rolled.tier}`;
    const name = def?.name ?? charmId;
    const slot = merged(world, piece).charm ? 'charm2' : 'charm';
    const nextProps: Record<string, unknown> = { ...piece.props, [slot]: charmId, enchant: `${name} · ${line}` };
    if (def?.target === 'weapon' || itemOf(world, piece).kind === 'weapon') {
      const charges = chargeAmount(vesselOf(gemProps), hasPerk(world, heroId, 'Знаток сосудов'));
      nextProps.charges = Number(piece.props.charges ?? 0) + charges;
    }
    if (def?.skill && def.amounts) {
      nextProps.fortifySkill = def.skill;
      nextProps.fortifyAmount = def.amounts[rolled.tier - 1];
    }
    piece.props = nextProps;
    piece.updated_at = now;
    if (rolled.usedInsight) consumeBoon(world, heroId, 'insight');
    takeQty(world, gem, 1, now);
    summary = `Наложено «${name}», ступень ${rolled.tier}`;
  } else if (order.action === 'recharge') {
    skill = 'Зачарование';
    const weapon = bag(world, heroId, order.instanceIds?.[0] ?? '');
    const gem = bag(world, heroId, order.instanceIds?.[1] ?? '');
    const amount = chargeAmount(vesselOf(merged(world, gem)), hasPerk(world, heroId, 'Знаток сосудов'));
    weapon.props = { ...weapon.props, charges: Number(weapon.props.charges ?? merged(world, weapon).charges ?? 0) + amount };
    weapon.updated_at = now;
    takeQty(world, gem, 1, now);
    summary = `Перезарядка +${amount}`;
  } else if (order.action === 'repair') {
    skill = 'Кузнечное';
    const inst = bag(world, heroId, order.instanceIds?.[0] ?? '');
    if (merged(world, inst).damaged !== true) throw new DomainError('Вещь не повреждена.');
    inst.props = { ...inst.props, damaged: false };
    inst.updated_at = now;
    summary = 'Починено в базе';
  }
  const mark = noteMark(world, heroId, skill, now);
  const hero = world.heroes.find((row) => row.id === heroId);
  writeAudit(world, { role: 'gm', heroId: null, preview: false }, { id: `craft-${request.id}`, opId: request.id, now }, {
    hero_id: heroId,
    action: 'craft',
    summary,
    before: null,
    after: {
      granted,
      markSkill: mark.skill ?? null,
      markWeek: mark.week ?? null,
      health: hero?.health,
      magic: hero?.magic,
      stamina: hero?.stamina,
    },
    undo: null,
  });
}

function chargeAmount(vessel: VesselId, scholar: boolean): number {
  const order: VesselId[] = ['small', 'medium', 'large', 'grand'];
  let index = order.indexOf(vessel);
  if (scholar) index = Math.min(3, index + 1);
  return VESSELS[order[index]!].charges;
}

export interface IngredientView {
  instanceId: string;
  itemId: string;
  name: string;
  qty: number;
  /** null — свойство скрыто. Четыре клетки. */
  known: (string | null)[];
}

export function benchView(world: World, actor: Actor, heroId: string): {
  ingredients: IngredientView[];
  recipes: { ref: string; detail: string }[];
  charms: { id: string; name: string }[];
  downtime: number;
  canCraft: boolean;
} | null {
  if (!owns(actor, heroId) && !isRealGm(actor)) return null;
  const gm = isRealGm(actor);
  const ingredients: IngredientView[] = [];
  for (const inst of world.item_instances) {
    if (inst.owner_hero_id !== heroId || inst.location !== 'bag') continue;
    const item = world.items.find((row) => row.id === inst.item_id);
    if (!item || item.kind !== 'ingredient') continue;
    const table = INGREDIENTS[item.id];
    const open = new Set(indexesOf(world, heroId, item.id));
    const known = [1, 2, 3, 4].map((index) => {
      if (!table) return null;
      if (gm || open.has(index)) return EFFECTS[table[index - 1]!]?.name ?? table[index - 1]!;
      return null;
    });
    ingredients.push({ instanceId: inst.id, itemId: item.id, name: item.name, qty: inst.qty, known });
  }
  const recipes = world.knowledge.filter((row) => row.hero_id === heroId && row.kind === 'recipe').map((row) => ({ ref: row.ref, detail: row.detail }));
  const learned = world.knowledge.filter((row) => row.hero_id === heroId && row.kind === 'charm');
  const charms = gm
    ? CHARMS.map((row) => ({ id: row.id, name: row.name }))
    : learned.map((row) => ({ id: row.ref, name: row.detail }));
  const hero = world.heroes.find((row) => row.id === heroId);
  return { ingredients, recipes, charms, downtime: hero?.downtime ?? 0, canCraft: owns(actor, heroId) };
}
