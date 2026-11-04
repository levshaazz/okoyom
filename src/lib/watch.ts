import { capacitySlots, carryWeight, pendingCountForHero } from './domain';
import { describeFill } from './combat';
import { cmpQ, formatQ, q } from './rational';
import type { AuditEvent, Hero, World } from './types';

export interface WatchFlag {
  code: string;
  text: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function provenance(world: World, heroId: string): Set<string> {
  const ids = new Set<string>();
  for (const event of world.audit_log) {
    if (event.reverted_by) continue;
    const after = asRecord(event.after);
    if (!after) continue;
    if (event.hero_id === heroId && Array.isArray(after.instances)) {
      for (const id of after.instances) ids.add(String(id));
    }
    if (typeof after.instanceId === 'string' && (event.hero_id === heroId || event.action === 'transfer')) {
      ids.add(after.instanceId);
    }
    if (Array.isArray(after.granted)) {
      for (const id of after.granted) ids.add(String(id));
    }
  }
  for (const transfer of world.transfers) {
    if (transfer.status === 'done' && (transfer.to_hero === heroId || transfer.kind === 'gm_grant')) {
      if (transfer.to_hero === heroId) ids.add(transfer.instance_id);
    }
  }
  return ids;
}

function latestResources(world: World, heroId: string): { health?: number; magic?: number; stamina?: number } {
  const found: { health?: number; magic?: number; stamina?: number } = {};
  for (const event of world.audit_log) {
    if (event.hero_id !== heroId || event.reverted_by) continue;
    const after = asRecord(event.after);
    if (!after) continue;
    for (const key of ['health', 'magic', 'stamina'] as const) {
      if (typeof after[key] === 'number') found[key] = after[key];
    }
  }
  return found;
}

function unconfirmed(world: World, event: AuditEvent): boolean {
  if (event.source !== 'player' || !event.session_id || event.reverted_by) return false;
  if (event.action === 'confirm') return false;
  return !world.audit_log.some((row) => row.confirms === event.id && !row.reverted_by);
}

/** Красные пометки дозора. Объяснение показывается рядом с карточкой. */
export function watchFlags(world: World, hero: Hero): WatchFlag[] {
  const flags: WatchFlag[] = [];
  if (hero.health > hero.health_max) {
    flags.push({ code: 'above_max', text: `Здоровье ${hero.health} выше максимума ${hero.health_max}.` });
  }
  if (hero.magic > hero.magic_max) {
    flags.push({ code: 'above_max', text: `Магия ${hero.magic} выше максимума ${hero.magic_max}.` });
  }
  if (hero.stamina > hero.stamina_max) {
    flags.push({ code: 'above_max', text: `Выносливость ${hero.stamina} выше максимума ${hero.stamina_max}.` });
  }
  for (const skill of world.skills) {
    if (skill.hero_id !== hero.id) continue;
    if (skill.value > 100) {
      flags.push({ code: 'above_max', text: `Навык «${skill.skill}» ${skill.value} выше 100.` });
    }
    if (skill.marks > 3) {
      flags.push({
        code: 'too_many_marks',
        text: `«${skill.skill}»: отметок ${skill.marks}. За сессию можно не больше трёх.`,
      });
    }
  }
  const used = carryWeight(world, hero);
  const slots = capacitySlots(hero);
  if (cmpQ(used, q(slots)) > 0) {
    flags.push({ code: 'overload', text: `Перегруз: груз ${formatQ(used)} при лимите ${slots}.` });
  }
  const known = provenance(world, hero.id);
  for (const inst of world.item_instances) {
    if (inst.owner_hero_id !== hero.id || inst.location === 'ground') continue;
    if (!known.has(inst.id)) {
      const item = world.items.find((row) => row.id === inst.item_id);
      flags.push({
        code: 'orphan_item',
        text: `«${item?.name ?? 'вещь'}» без записи о выдаче, находке или крафте.`,
      });
    }
  }
  for (const event of world.audit_log) {
    if (event.hero_id !== hero.id) continue;
    if (event.backdated) {
      flags.push({ code: 'backdated', text: `Правка задним числом: ${event.summary}.` });
    }
    if (unconfirmed(world, event)) {
      flags.push({
        code: 'unconfirmed',
        text: `Во время сессии без подтверждения мастера: ${event.summary}.`,
      });
    }
  }
  const expected = latestResources(world, hero.id);
  for (const key of ['health', 'magic', 'stamina'] as const) {
    if (expected[key] === undefined) continue;
    if (expected[key] !== hero[key]) {
      const label = key === 'health' ? 'Здоровье' : key === 'magic' ? 'Магия' : 'Выносливость';
      flags.push({
        code: 'resource_gap',
        text: `${label} сейчас ${hero[key]}, в журнале последнее значение ${expected[key]}. События на эту разницу нет.`,
      });
    }
  }
  return flags;
}

export function recentEvents(world: World, heroId: string, limit = 3): AuditEvent[] {
  return world.audit_log.filter((row) => row.hero_id === heroId).slice(-limit).reverse();
}

export function heroWatchLine(world: World, hero: Hero): {
  hands: string;
  armor: string;
  load: string;
  pending: number;
  flags: WatchFlag[];
} {
  const both =
    hero.hands.left?.kind === 'item' &&
    hero.hands.right?.kind === 'item' &&
    hero.hands.left.instanceId === hero.hands.right.instanceId &&
    hero.hands.left.grip === 'both';
  const hands = both
    ? describeFill(world, hero.hands.left)
    : `Л ${describeFill(world, hero.hands.left)} · П ${describeFill(world, hero.hands.right)}`;
  const inHand = new Set<string>();
  for (const fill of [hero.hands.left, hero.hands.right]) {
    if (fill?.kind === 'item') inHand.add(fill.instanceId);
  }
  const armor = world.item_instances
    .filter((row) => row.owner_hero_id === hero.id && row.location === 'worn' && !inHand.has(row.id))
    .map((row) => world.items.find((item) => item.id === row.item_id)?.name)
    .filter((name): name is string => !!name);
  return {
    hands,
    armor: armor.join(', ') || '—',
    load: `${formatQ(carryWeight(world, hero))} / ${capacitySlots(hero)}`,
    pending: pendingCountForHero(world, hero.id),
    flags: watchFlags(world, hero),
  };
}

export function todayTableIds(world: World, today: string): string[] {
  const ids = new Set<string>();
  for (const session of world.sessions) {
    const day = session.starts_at.slice(0, 10);
    if (session.status === 'live' || day === today) {
      for (const id of session.table_heroes) ids.add(id);
    }
  }
  return [...ids];
}
