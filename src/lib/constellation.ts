import { nodesForSkill, PERK_NODES, SPELL_STARS, type PerkNode } from '../data/constellations';
import { DomainError } from './errors';
import type { Hero, World } from './types';

export type StarState = 'taken' | 'next' | 'fog';

export interface StarView {
  id: string;
  name: string;
  effect: string;
  threshold: number;
  x: number;
  y: number;
  state: StarState;
  /** Порог навыка уже взят. */
  open: boolean;
  pending: boolean;
  /** Предшественники взяты, перк ещё нет — его можно просить. */
  reachable: boolean;
}

export interface TreeView {
  stars: StarView[];
  lines: Array<{ from: string; to: string }>;
  hiddenCount: number;
  skillValue: number;
  marks: number;
}

function takenNames(world: World, heroId: string, skill: string): Set<string> {
  return new Set(world.perks.filter((row) => row.hero_id === heroId && row.skill === skill).map((row) => row.perk));
}

function pendingNames(world: World, heroId: string): Set<string> {
  return new Set(
    world.change_requests
      .filter((row) => row.hero_id === heroId && row.status === 'pending' && row.kind === 'perk')
      .map((row) => String(row.payload.perk ?? '')),
  );
}

export function prereqMet(node: PerkNode, taken: Set<string>, byId: Map<string, PerkNode>): boolean {
  if (node.requires.length === 0) return true;
  const names = node.requires.map((id) => byId.get(id)?.name).filter((name): name is string => !!name);
  if (node.requiresMode === 'any') return names.some((name) => taken.has(name));
  return names.every((name) => taken.has(name));
}

/** Очки перков: 1 на старте и ещё одно за каждый уровень. Заявки в очереди тоже держат очко. */
export function perkPoints(world: World, hero: Hero): { total: number; spent: number; pending: number; free: number } {
  const total = hero.level;
  const spent = world.perks.filter((row) => row.hero_id === hero.id).length;
  const pending = world.change_requests.filter((row) => row.hero_id === hero.id && row.status === 'pending' && row.kind === 'perk').length;
  return { total, spent, pending, free: total - spent - pending };
}

export function treeView(world: World, hero: Hero, skill: string, gm: boolean): TreeView {
  const nodes = nodesForSkill(skill);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const taken = takenNames(world, hero.id, skill);
  const pending = pendingNames(world, hero.id);
  const skillRow = world.skills.find((row) => row.hero_id === hero.id && row.skill === skill);
  const nextIds = new Set(
    nodes.filter((node) => !taken.has(node.name) && prereqMet(node, taken, byId)).map((node) => node.id),
  );
  const stars: StarView[] = nodes.map((node) => {
    const isTaken = taken.has(node.name);
    const isNext = nextIds.has(node.id);
    const state: StarState = isTaken ? 'taken' : isNext || gm ? 'next' : 'fog';
    const show = state !== 'fog';
    return {
      id: node.id,
      name: show ? node.name : '',
      effect: show ? node.effect : '',
      threshold: show ? node.threshold : 0,
      x: node.x,
      y: node.y,
      state: isTaken ? 'taken' : isNext ? 'next' : gm ? 'next' : 'fog',
      open: (skillRow?.value ?? 0) >= node.threshold,
      pending: pending.has(node.name),
      reachable: isNext && !isTaken,
    };
  });
  const visible = new Set(stars.filter((star) => star.state !== 'fog').map((star) => star.id));
  const lines = nodes.flatMap((node) =>
    node.requires
      .filter((from) => gm || (visible.has(from) && visible.has(node.id)))
      .map((from) => ({ from, to: node.id })),
  );
  return {
    stars: gm ? stars.map((star) => (star.state === 'fog' ? { ...star, state: 'next' as const } : star)) : stars,
    lines,
    hiddenCount: gm ? 0 : stars.filter((star) => star.state === 'fog').length,
    skillValue: skillRow?.value ?? 0,
    marks: skillRow?.marks ?? 0,
  };
}

export interface SpellView {
  name: string;
  school: string;
  tier: number;
  cost: number;
  learned: boolean;
}

/** Игрок видит только выученные. Мастер — весь учебный каталог. */
export function spellSky(world: World, heroId: string, gm: boolean): SpellView[] {
  const known = learnedSpells(world, heroId);
  return SPELL_STARS.filter((star) => gm || known.has(star.name)).map((star) => ({
    ...star,
    learned: known.has(star.name),
  }));
}

export function learnedSpells(world: World, heroId: string): Set<string> {
  return new Set(world.spells.filter((row) => row.hero_id === heroId).map((row) => row.spell));
}

/** Заявка на перк из каталога: только следующий узел, свободное очко, порог проверит очередь (серый узел тоже можно попросить — мастер увидит). */
export function assertPerkRequest(world: World, heroId: string, name: string, skill: string): void {
  const node = PERK_NODES.find((row) => row.name === name && (!skill || row.skill === skill));
  if (!node) return;
  const hero = world.heroes.find((row) => row.id === heroId);
  if (!hero) throw new DomainError('Такого героя нет.');
  const nodes = nodesForSkill(node.skill);
  const byId = new Map(nodes.map((row) => [row.id, row]));
  const taken = takenNames(world, heroId, node.skill);
  if (!prereqMet(node, taken, byId)) throw new DomainError('Сначала нужен предыдущий перк ветки.');
  const points = perkPoints(world, hero);
  if (points.free < 1) throw new DomainError('Нет свободного очка перка.');
  const value = world.skills.find((row) => row.hero_id === heroId && row.skill === node.skill)?.value ?? 0;
  if (value < node.threshold) {
    throw new DomainError(`Рано: «${node.name}» откроется при навыке ${node.threshold}. Сейчас ${value}.`);
  }
}
