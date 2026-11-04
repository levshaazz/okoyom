import { writeAudit } from './audit';
import { DomainError } from './errors';
import type { Actor, Hands, Hero, ItemInstance, OpMeta, World } from './types';

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function heroOf(world: World, id: string): Hero {
  const hero = world.heroes.find((row) => row.id === id);
  if (!hero) throw new DomainError('Такого героя нет.');
  return hero;
}

function applyUndo(world: World, hero: Hero, undo: Record<string, unknown>, now: string): void {
  if (undo.kind === 'stat') {
    const stat = undo.stat;
    const value = Number(undo.value);
    if (stat !== 'health' && stat !== 'magic' && stat !== 'stamina') throw new DomainError('Нечего откатывать.');
    hero[stat] = value;
    hero.updated_at = now;
    return;
  }
  if (undo.kind === 'hands') {
    const hands = undo.hands as Hands;
    for (const side of ['left', 'right'] as const) {
      const fill = hero.hands[side];
      if (fill?.kind === 'item') {
        const inst = world.item_instances.find((row) => row.id === fill.instanceId);
        if (inst) {
          inst.location = 'bag';
          inst.updated_at = now;
        }
      }
    }
    hero.hands = structuredClone(hands);
    for (const side of ['left', 'right'] as const) {
      const fill = hero.hands[side];
      if (fill?.kind === 'item') {
        const inst = world.item_instances.find((row) => row.id === fill.instanceId);
        if (inst) {
          inst.location = 'worn';
          inst.updated_at = now;
        }
      }
    }
    hero.updated_at = now;
    return;
  }
  if (undo.kind === 'learn_tome') {
    const spell = String(undo.spell ?? '');
    world.spells = world.spells.filter((row) => !(row.hero_id === hero.id && row.spell === spell));
    const instance = undo.instance as ItemInstance;
    if (instance && !world.item_instances.some((row) => row.id === instance.id)) {
      world.item_instances.push(structuredClone(instance));
    }
    return;
  }
  if (undo.kind === 'skill_mark') {
    const skill = String(undo.skill ?? '');
    const row = world.skills.find((entry) => entry.hero_id === hero.id && entry.skill === skill);
    if (!row) throw new DomainError('Навыка нет.');
    row.marks = Math.max(0, row.marks - 1);
    return;
  }
  if (undo.kind === 'grant') {
    const instanceId = String(undo.instanceId ?? '');
    for (const side of ['left', 'right'] as const) {
      const fill = hero.hands[side];
      if (fill?.kind === 'item' && fill.instanceId === instanceId) hero.hands[side] = null;
    }
    world.item_instances = world.item_instances.filter((row) => row.id !== instanceId);
    return;
  }
  if (undo.kind === 'drop_loadout') {
    hero.loadouts = hero.loadouts.filter((row) => row.id !== undo.id);
    return;
  }
  throw new DomainError('Это событие нельзя откатить.');
}

export function rollbackEvent(world: World, actor: Actor, eventId: string, meta: OpMeta): World {
  if (!(actor.role === 'gm' && !actor.preview)) throw new DomainError('Откатывает только мастер.');
  const next = structuredClone(world);
  const event = next.audit_log.find((row) => row.id === eventId);
  if (!event) throw new DomainError('События нет.');
  if (event.reverted_by) throw new DomainError('Это уже откатили.');
  const undo = asRecord(event.undo);
  if (!undo) throw new DomainError('Это событие нельзя откатить.');
  const hero = heroOf(next, event.hero_id);
  applyUndo(next, hero, undo, meta.now);
  event.reverted_by = meta.id;
  writeAudit(next, actor, meta, {
    hero_id: event.hero_id,
    action: 'rollback',
    summary: `Откат: ${event.summary}`,
    before: event.after,
    after: event.before,
    undo: null,
  });
  return next;
}

export function confirmEvent(world: World, actor: Actor, eventId: string, meta: OpMeta): World {
  if (!(actor.role === 'gm' && !actor.preview)) throw new DomainError('Подтверждает только мастер.');
  const next = structuredClone(world);
  const event = next.audit_log.find((row) => row.id === eventId);
  if (!event) throw new DomainError('События нет.');
  if (next.audit_log.some((row) => row.confirms === eventId)) throw new DomainError('Уже подтверждено.');
  writeAudit(next, actor, meta, {
    hero_id: event.hero_id,
    action: 'confirm',
    summary: `Подтверждено: ${event.summary}`,
    before: null,
    after: { confirms: eventId },
    undo: null,
    confirms: eventId,
  });
  return next;
}
