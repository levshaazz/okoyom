import { canEditHero, heroById, isGm } from './domain';
import { DomainError } from './errors';
import type {
  Actor,
  ChronicleEntry,
  ChronicleMemory,
  ChroniclePlace,
  ChronicleVisibility,
  Omen,
  OpMeta,
  World,
  WorldClock,
} from './types';

function playing(actor: Actor): boolean {
  return actor.role === 'player' || (actor.role === 'gm' && actor.preview && Boolean(actor.heroId));
}

function requireGm(actor: Actor): void {
  if (!isGm(actor)) throw new DomainError('Летопись пишет только мастер.');
}

function knownVis(value: string): value is ChronicleVisibility {
  return value === 'public' || value === 'players' || value === 'party';
}

/** Видит ли актор слой записи или её части. party — только герои из списка участников. */
export function canSeeChronicle(actor: Actor, visibility: ChronicleVisibility, heroIds: string[]): boolean {
  if (isGm(actor)) return true;
  if (visibility === 'public') return true;
  if (!playing(actor) || !actor.heroId) return false;
  if (visibility === 'players') return true;
  return heroIds.includes(actor.heroId);
}

export function visibleEntries(world: World, actor: Actor): ChronicleEntry[] {
  return world.chronicle_entries
    .filter((entry) => canSeeChronicle(actor, entry.visibility, entry.hero_ids))
    .sort((a, b) => b.real_date.localeCompare(a.real_date) || b.id.localeCompare(a.id));
}

export interface ShownPart {
  id: string;
  ord: number;
  visibility: ChronicleVisibility;
  /** null — текст удержан: часть видна только участникам. */
  body: string | null;
}

export function visibleParts(world: World, actor: Actor, entry: ChronicleEntry): ShownPart[] {
  if (!canSeeChronicle(actor, entry.visibility, entry.hero_ids)) return [];
  return world.chronicle_parts
    .filter((part) => part.entry_id === entry.id)
    .sort((a, b) => a.ord - b.ord)
    .map((part) => ({
      id: part.id,
      ord: part.ord,
      visibility: part.visibility,
      body: canSeeChronicle(actor, part.visibility, entry.hero_ids) ? part.body_md : null,
    }));
}

export function visibleMemories(world: World, actor: Actor, entry: ChronicleEntry): ChronicleMemory[] {
  if (!canSeeChronicle(actor, entry.visibility, entry.hero_ids)) return [];
  return world.chronicle_memories
    .filter((row) => row.entry_id === entry.id)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export function chronicleFeed(
  world: World,
  actor: Actor,
  filter: { heroId: string | 'all'; place: string | 'all' },
): ChronicleEntry[] {
  return visibleEntries(world, actor).filter((entry) => {
    if (filter.heroId !== 'all' && !entry.hero_ids.includes(filter.heroId)) return false;
    if (filter.place !== 'all' && !entry.places.some((place) => place.label === filter.place)) return false;
    return true;
  });
}

export function placeLabels(world: World, actor: Actor): string[] {
  const labels = new Set<string>();
  for (const entry of visibleEntries(world, actor)) {
    for (const place of entry.places) labels.add(place.label);
  }
  return [...labels].sort((a, b) => a.localeCompare(b, 'ru'));
}

export interface ClockPane {
  /** null у игрока и гостя: сами часы и прогресс им не отдаются. */
  clocks: WorldClock[] | null;
  omens: Omen[];
}

/**
 * Игрок видит только приметы. Мастер видит часы, заполнение и заметку.
 * TODO(supabase): world_clocks живут в private и не входят в ответ игрока.
 */
export function clockPane(world: World, actor: Actor, now: string): ClockPane {
  const omens = world.omens
    .filter((omen) => omen.shown_from <= now)
    .filter((omen) => {
      if (isGm(actor)) return true;
      if (omen.visibility === 'public') return true;
      return playing(actor) && omen.visibility === 'players';
    })
    .sort((a, b) => a.shown_from.localeCompare(b.shown_from));
  return { clocks: isGm(actor) ? world.world_clocks.map((clock) => ({ ...clock })) : null, omens };
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

/** Короткий текст записи: абзацы и жирный. HTML из источника не проходит. */
export function renderChronicle(source: string): string {
  const lines = source.replaceAll('\r\n', '\n').split('\n');
  const blocks: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (!para.length) return;
    const html = para
      .map((line) => escapeHtml(line).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>'))
      .join('<br>');
    blocks.push(`<p>${html}</p>`);
    para = [];
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) flush();
    else para.push(line);
  }
  flush();
  return blocks.join('');
}

export interface ChronicleEntryInput {
  id: string | null;
  realDate: string;
  gameDate: string;
  title: string;
  lead: string;
  heroIds: string[];
  places: { label: string; wikiSlug: string; mapLabel: string }[];
  loot: string;
  fallen: { name: string; note: string }[];
  visibility: ChronicleVisibility;
}

function placesOf(raw: ChronicleEntryInput['places']): ChroniclePlace[] {
  return raw
    .map((place) => ({
      label: place.label.trim(),
      wiki_slug: place.wikiSlug.trim() || null,
      map_label: place.mapLabel.trim() || null,
    }))
    .filter((place) => place.label);
}

export function saveChronicleEntry(world: World, actor: Actor, input: ChronicleEntryInput, meta: OpMeta): World {
  requireGm(actor);
  const title = input.title.trim();
  if (!title) throw new DomainError('Нужно название записи.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.realDate)) throw new DomainError('Нужна настоящая дата.');
  if (!input.gameDate.trim()) throw new DomainError('Нужна дата мира.');
  if (!knownVis(input.visibility)) throw new DomainError('Такой видимости нет.');
  const heroIds = [...new Set(input.heroIds)];
  for (const heroId of heroIds) heroById(world, heroId);
  const next = structuredClone(world);
  const entry: ChronicleEntry = {
    id: input.id ?? meta.id,
    real_date: input.realDate,
    game_date: input.gameDate.trim(),
    title,
    lead_md: input.lead.trim(),
    hero_ids: heroIds,
    places: placesOf(input.places),
    loot: input.loot.trim(),
    fallen: input.fallen
      .map((row) => ({ name: row.name.trim(), hero_id: null, note: row.note.trim() }))
      .filter((row) => row.name),
    visibility: input.visibility,
    session_id: null,
  };
  const existing = input.id ? next.chronicle_entries.find((row) => row.id === input.id) : undefined;
  if (input.id && !existing) throw new DomainError('Записи нет.');
  if (existing) Object.assign(existing, entry, { id: existing.id, session_id: existing.session_id });
  else next.chronicle_entries.push(entry);
  return next;
}

export interface ChroniclePartInput {
  id: string | null;
  entryId: string;
  body: string;
  visibility: ChronicleVisibility;
}

export function saveChroniclePart(world: World, actor: Actor, input: ChroniclePartInput, meta: OpMeta): World {
  requireGm(actor);
  const body = input.body.trim();
  if (!body) throw new DomainError('Пустую часть не пишем.');
  if (!knownVis(input.visibility)) throw new DomainError('Такой видимости нет.');
  const next = structuredClone(world);
  const entry = next.chronicle_entries.find((row) => row.id === input.entryId);
  if (!entry) throw new DomainError('Записи нет.');
  let part = input.id ? next.chronicle_parts.find((row) => row.id === input.id) : undefined;
  if (input.id && !part) throw new DomainError('Части нет.');
  if (!part) {
    const ord = next.chronicle_parts.filter((row) => row.entry_id === entry.id).reduce((max, row) => Math.max(max, row.ord), 0) + 1;
    part = { id: meta.id, entry_id: entry.id, ord, body_md: body, visibility: input.visibility };
    next.chronicle_parts.push(part);
  } else {
    part.body_md = body;
    part.visibility = input.visibility;
  }
  return next;
}

export function removeChronicleEntry(world: World, actor: Actor, id: string): World {
  requireGm(actor);
  const next = structuredClone(world);
  if (!next.chronicle_entries.some((row) => row.id === id)) throw new DomainError('Записи нет.');
  next.chronicle_entries = next.chronicle_entries.filter((row) => row.id !== id);
  next.chronicle_parts = next.chronicle_parts.filter((row) => row.entry_id !== id);
  next.chronicle_memories = next.chronicle_memories.filter((row) => row.entry_id !== id);
  return next;
}

export function addChronicleMemory(world: World, actor: Actor, entryId: string, body: string, meta: OpMeta): World {
  if (!canEditHero(actor, actor.heroId ?? '')) throw new DomainError('Воспоминание оставляет сам герой.');
  const text = body.trim();
  if (!text) throw new DomainError('Напишите, что запомнилось.');
  const entry = world.chronicle_entries.find((row) => row.id === entryId);
  if (!entry || !canSeeChronicle(actor, entry.visibility, entry.hero_ids)) {
    throw new DomainError('Этой записи вам не видно.');
  }
  const next = structuredClone(world);
  next.chronicle_memories.push({
    id: meta.id,
    entry_id: entryId,
    hero_id: actor.heroId ?? '',
    body: text,
    created_at: meta.now,
  });
  return next;
}

export function removeChronicleMemory(world: World, actor: Actor, id: string): World {
  const next = structuredClone(world);
  const memory = next.chronicle_memories.find((row) => row.id === id);
  if (!memory) throw new DomainError('Воспоминания нет.');
  if (!isGm(actor) && !canEditHero(actor, memory.hero_id)) throw new DomainError('Чужое воспоминание не стереть.');
  next.chronicle_memories = next.chronicle_memories.filter((row) => row.id !== id);
  return next;
}

export interface WorldClockInput {
  id: string | null;
  title: string;
  segments: number;
  notes: string;
}

export function saveWorldClock(world: World, actor: Actor, input: WorldClockInput, meta: OpMeta): World {
  requireGm(actor);
  const title = input.title.trim();
  if (!title) throw new DomainError('Нужно имя часов.');
  if (!Number.isInteger(input.segments) || input.segments < 1 || input.segments > 24) {
    throw new DomainError('Делений от 1 до 24.');
  }
  const next = structuredClone(world);
  const existing = input.id ? next.world_clocks.find((row) => row.id === input.id) : undefined;
  if (input.id && !existing) throw new DomainError('Часов нет.');
  if (existing) {
    existing.title = title;
    existing.segments = input.segments;
    existing.filled = Math.min(existing.filled, input.segments);
    existing.notes = input.notes.trim();
  } else {
    next.world_clocks.push({
      id: meta.id,
      title,
      segments: input.segments,
      filled: 0,
      notes: input.notes.trim(),
    });
  }
  return next;
}

export function advanceWorldClock(world: World, actor: Actor, clockId: string): World {
  requireGm(actor);
  const next = structuredClone(world);
  const clock = next.world_clocks.find((row) => row.id === clockId);
  if (!clock) throw new DomainError('Часов нет.');
  clock.filled = Math.min(clock.segments, clock.filled + 1);
  return next;
}

export interface OmenInput {
  clockId: string;
  text: string;
  visibility: 'public' | 'players';
}

export function saveOmen(world: World, actor: Actor, input: OmenInput, meta: OpMeta): World {
  requireGm(actor);
  const text = input.text.trim();
  if (!text) throw new DomainError('Пустую примету не выпускаем.');
  if (input.visibility !== 'public' && input.visibility !== 'players') throw new DomainError('Кому показывать примету?');
  const next = structuredClone(world);
  if (!next.world_clocks.some((row) => row.id === input.clockId)) throw new DomainError('Часов нет.');
  next.omens.push({
    id: meta.id,
    clock_id: input.clockId,
    text,
    shown_from: meta.now,
    visibility: input.visibility,
  });
  return next;
}
