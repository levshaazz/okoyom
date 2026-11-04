import type { Actor, AuditEvent, AuditSource, OpMeta, World } from './types';

export function auditSource(actor: Actor): AuditSource {
  if (actor.role === 'gm' && !actor.preview) return 'gm';
  if (actor.role === 'player' || (actor.role === 'gm' && actor.preview)) return 'player';
  return 'system';
}

export function actorLabel(actor: Actor): string {
  if (actor.role === 'gm' && !actor.preview) return 'Мастер';
  if (actor.role === 'gm' && actor.preview) return 'мастер глазами игрока';
  if (actor.role === 'player') return 'игрок';
  return 'система';
}

export function liveSessionId(world: World, heroId: string): string | null {
  const session = world.sessions.find((row) => row.status === 'live' && row.table_heroes.includes(heroId));
  return session?.id ?? null;
}

/** Дописывает событие. `backdated`, если время раньше предыдущей записи этого героя. */
export function writeAudit(
  world: World,
  actor: Actor,
  meta: OpMeta,
  event: {
    hero_id: string;
    action: string;
    summary: string;
    before: unknown;
    after: unknown;
    undo: unknown;
    confirms?: string | null;
    id?: string;
  },
): AuditEvent {
  const previous = [...world.audit_log].reverse().find((row) => row.hero_id === event.hero_id);
  const row: AuditEvent = {
    id: event.id ?? meta.id,
    at: meta.now,
    hero_id: event.hero_id,
    actor_label: actorLabel(actor),
    source: auditSource(actor),
    action: event.action,
    summary: event.summary,
    before: event.before,
    after: event.after,
    undo: event.undo,
    reverted_by: null,
    confirms: event.confirms ?? null,
    session_id: liveSessionId(world, event.hero_id),
    backdated: previous ? meta.now < previous.at : false,
  };
  world.audit_log.push(row);
  return row;
}
