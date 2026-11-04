import { canEditHero, heroById, isGm } from './domain';
import { DomainError } from './errors';
import type {
  Actor,
  OpMeta,
  WikiAudience,
  WikiBlock,
  WikiBlockKind,
  WikiCat,
  WikiGrant,
  WikiMargin,
  WikiMarginKind,
  WikiPage,
  WikiVisibility,
  World,
} from './types';

export const WIKI_CATS: { id: WikiCat; label: string }[] = [
  { id: 'narody', label: 'Народы' },
  { id: 'mesta', label: 'Места' },
  { id: 'bogi', label: 'Боги' },
  { id: 'frakcii', label: 'Фракции' },
  { id: 'bestiarij', label: 'Бестиарий' },
  { id: 'predmety', label: 'Предметы' },
];

export const WIKI_VIS: { id: WikiVisibility; label: string; short: string }[] = [
  { id: 'draft', label: 'Черновик', short: 'черновик' },
  { id: 'hidden', label: 'Скрыто', short: 'скрыто' },
  { id: 'public', label: 'Открыто всем', short: 'всем' },
  { id: 'players', label: 'Открыто ходокам', short: 'ходокам' },
  { id: 'heroes', label: 'Открыто героям', short: 'героям' },
];

export function catLabel(cat: WikiCat): string {
  return WIKI_CATS.find((row) => row.id === cat)?.label ?? cat;
}

export function visLabel(visibility: WikiVisibility): string {
  return WIKI_VIS.find((row) => row.id === visibility)?.label ?? visibility;
}

export function visShort(visibility: WikiVisibility): string {
  return WIKI_VIS.find((row) => row.id === visibility)?.short ?? visibility;
}

function requireGm(actor: Actor): void {
  if (!isGm(actor)) throw new DomainError('Статью правит только мастер.');
}

/** Игрок или мастер в режиме «как видит игрок». */
export function isPlaying(actor: Actor): boolean {
  return actor.role === 'player' || (actor.role === 'gm' && actor.preview && Boolean(actor.heroId));
}

function knownCat(cat: string): cat is WikiCat {
  return WIKI_CATS.some((row) => row.id === cat);
}

function knownVis(visibility: string): visibility is WikiVisibility {
  return WIKI_VIS.some((row) => row.id === visibility);
}

/**
 * Видит ли актор слой статьи или раздела.
 * Грант с block_id = null покрывает статью и все её разделы «героям».
 * Грант на раздел не открывает остальные разделы и не открывает скрытую статью.
 *
 * TODO(supabase): ту же развилку должна делать RLS-политика, а не клиент.
 * Скрытый текст не имеет права приезжать в браузер.
 */
export function canSeeLayer(
  actor: Actor,
  visibility: WikiVisibility,
  grants: WikiGrant[],
  pageSlug: string,
  blockId: string | null,
): boolean {
  if (isGm(actor)) return true;
  if (visibility === 'draft' || visibility === 'hidden') return false;
  if (visibility === 'public') return true;
  if (!isPlaying(actor) || !actor.heroId) return false;
  if (visibility === 'players') return true;
  return grants.some((grant) => {
    if (grant.hero_id !== actor.heroId || grant.page_slug !== pageSlug) return false;
    if (blockId === null) return grant.block_id === null;
    return grant.block_id === null || grant.block_id === blockId;
  });
}

export function canSeePage(actor: Actor, page: WikiPage, grants: WikiGrant[]): boolean {
  return canSeeLayer(actor, page.visibility, grants, page.slug, null);
}

export function canSeeBlock(actor: Actor, page: WikiPage, block: WikiBlock, grants: WikiGrant[]): boolean {
  if (!canSeePage(actor, page, grants)) return false;
  return canSeeLayer(actor, block.visibility, grants, page.slug, block.id);
}

export function visiblePages(world: World, actor: Actor): WikiPage[] {
  return world.wiki_pages
    .filter((page) => canSeePage(actor, page, world.wiki_grants))
    .sort((a, b) => a.title.localeCompare(b.title, 'ru'));
}

export function visibleBlocks(world: World, actor: Actor, slug: string): WikiBlock[] {
  const page = world.wiki_pages.find((row) => row.slug === slug);
  if (!page || !canSeePage(actor, page, world.wiki_grants)) return [];
  return world.wiki_blocks
    .filter((block) => block.page_slug === slug && canSeeBlock(actor, page, block, world.wiki_grants))
    .sort((a, b) => a.ord - b.ord);
}

/** Личное видят автор и мастер. Общее — те, кому видна статья. Гость полей не видит. */
export function canSeeMargin(actor: Actor, margin: WikiMargin, pageVisible: boolean): boolean {
  if (!pageVisible && !isGm(actor)) return false;
  if (isGm(actor)) return true;
  if (!isPlaying(actor) || !actor.heroId) return false;
  if (margin.audience === 'personal') return margin.hero_id === actor.heroId;
  return pageVisible;
}

export function visibleMargins(world: World, actor: Actor, slug: string): WikiMargin[] {
  const page = world.wiki_pages.find((row) => row.slug === slug);
  const pageVisible = Boolean(page && canSeePage(actor, page, world.wiki_grants));
  return world.wiki_margins
    .filter((margin) => margin.page_slug === slug && canSeeMargin(actor, margin, pageVisible))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export interface WikiHit {
  slug: string;
  title: string;
  cat: WikiCat;
  endonym: string;
  kind: 'article' | 'rumor';
  snippet: string;
}

function fold(value: string): string {
  return value.toLocaleLowerCase('ru');
}

function snippetAround(text: string, query: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const at = fold(flat).indexOf(fold(query));
  if (at < 0) return flat.slice(0, 160);
  const start = Math.max(0, at - 48);
  const end = Math.min(flat.length, at + query.length + 90);
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
}

/**
 * Поиск только по слою, который актор и так видит.
 * Черновик, скрытый раздел и чужая личная заметка в выдачу не попадают.
 */
export function searchWiki(world: World, actor: Actor, query: string, cat: WikiCat | 'all'): WikiHit[] {
  const needle = query.trim();
  if (needle.length < 2) return [];
  const q = fold(needle);
  const hits: WikiHit[] = [];
  for (const page of visiblePages(world, actor)) {
    if (cat !== 'all' && page.cat !== cat) continue;
    const blocks = visibleBlocks(world, actor, page.slug);
    const margins = visibleMargins(world, actor, page.slug);
    const ownText = [page.title, page.endonym, page.endonym_gloss, ...page.aliases, ...blocks.map((block) => block.body_md)];
    const articleHit = ownText.find((text) => fold(text).includes(q));
    if (articleHit) {
      hits.push({
        slug: page.slug,
        title: page.title,
        cat: page.cat,
        endonym: page.endonym,
        kind: 'article',
        snippet: snippetAround(articleHit, needle),
      });
      continue;
    }
    const rumor = margins.find((margin) => margin.kind === 'rumor' && fold(margin.body).includes(q));
    if (rumor) {
      hits.push({
        slug: page.slug,
        title: page.title,
        cat: page.cat,
        endonym: page.endonym,
        kind: 'rumor',
        snippet: snippetAround(rumor.body, needle),
      });
    }
  }
  return hits;
}

export function linkedSlugs(markdown: string): string[] {
  const found = new Set<string>();
  for (const match of markdown.matchAll(/\[\[([a-z0-9-]+)(?:\|[^\]]*)?\]\]/g)) {
    if (match[1]) found.add(match[1]);
  }
  return [...found];
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Подсветка уже экранированного текста. */
export function highlightSafe(text: string, query: string): string {
  const safe = escapeHtml(text);
  const needle = query.trim();
  if (needle.length < 2) return safe;
  const re = new RegExp(escapeRegExp(needle), 'ig');
  return safe.replace(re, (match) => `<mark>${match}</mark>`);
}

export interface WikiLinkCtx {
  href: (slug: string) => string;
  title: (slug: string) => string;
}

function inline(text: string, ctx: WikiLinkCtx): string {
  let html = escapeHtml(text);
  html = html.replace(/\[\[([a-z0-9-]+)\|([^\]]+)\]\]/g, (_all, slug: string, label: string) => {
    return `<a href="${escapeHtml(ctx.href(slug))}">${label}</a>`;
  });
  html = html.replace(/\[\[([a-z0-9-]+)\]\]/g, (_all, slug: string) => {
    return `<a href="${escapeHtml(ctx.href(slug))}">${escapeHtml(ctx.title(slug))}</a>`;
  });
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  return html;
}

/** Узкий Markdown: заголовки, списки, жирный, курсив, внутренние [[ссылки]]. HTML из текста не проходит. */
export function renderWikiMarkdown(source: string, ctx: WikiLinkCtx): string {
  const lines = source.replaceAll('\r\n', '\n').split('\n');
  const out: string[] = [];
  let para: string[] = [];
  let list: string[] = [];
  const flushPara = () => {
    if (!para.length) return;
    out.push(`<p>${para.map((line) => inline(line, ctx)).join('<br>')}</p>`);
    para = [];
  };
  const flushList = () => {
    if (!list.length) return;
    out.push(`<ul>${list.map((item) => `<li>${inline(item, ctx)}</li>`).join('')}</ul>`);
    list = [];
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushPara();
      flushList();
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading?.[1] && heading[2]) {
      flushPara();
      flushList();
      const level = heading[1].length + 1;
      out.push(`<h${level}>${inline(heading[2], ctx)}</h${level}>`);
      continue;
    }
    if (line.startsWith('- ')) {
      flushPara();
      list.push(line.slice(2));
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  return out.join('');
}

export interface WikiTarget {
  slug: string;
  blockId: string | null;
}

function applyGrants(world: World, target: WikiTarget, visibility: WikiVisibility, heroIds: string[]): void {
  world.wiki_grants = world.wiki_grants.filter(
    (grant) => !(grant.page_slug === target.slug && grant.block_id === target.blockId),
  );
  if (visibility !== 'heroes') return;
  const unique = [...new Set(heroIds)];
  if (!unique.length) throw new DomainError('Выберите хотя бы одного героя.');
  for (const heroId of unique) {
    heroById(world, heroId);
    world.wiki_grants.push({ page_slug: target.slug, block_id: target.blockId, hero_id: heroId });
  }
}

export function setWikiVisibility(
  world: World,
  actor: Actor,
  target: WikiTarget,
  visibility: WikiVisibility,
  heroIds: string[],
  now: string,
): World {
  requireGm(actor);
  if (!knownVis(visibility)) throw new DomainError('Такого статуса нет.');
  const next = structuredClone(world);
  if (target.blockId === null) {
    const page = next.wiki_pages.find((row) => row.slug === target.slug);
    if (!page) throw new DomainError('Статьи нет.');
    page.visibility = visibility;
    page.updated_at = now;
  } else {
    const block = next.wiki_blocks.find((row) => row.id === target.blockId && row.page_slug === target.slug);
    if (!block) throw new DomainError('Раздела нет.');
    block.visibility = visibility;
    const page = next.wiki_pages.find((row) => row.slug === target.slug);
    if (page) page.updated_at = now;
  }
  applyGrants(next, target, visibility, heroIds);
  return next;
}

export interface WikiPageInput {
  slug: string;
  title: string;
  cat: WikiCat;
  endonym: string;
  endonymGloss: string;
  aliases: string;
  visibility: WikiVisibility;
  heroIds: string[];
}

export function saveWikiPage(world: World, actor: Actor, input: WikiPageInput, now: string): World {
  requireGm(actor);
  const slug = input.slug.trim().toLowerCase();
  if (!/^[a-z0-9-]{2,48}$/.test(slug)) throw new DomainError('Адрес: латиница, цифры и дефис, от 2 знаков.');
  const title = input.title.trim();
  if (!title) throw new DomainError('Нужно название.');
  if (!knownCat(input.cat)) throw new DomainError('Такого раздела нет.');
  if (!knownVis(input.visibility)) throw new DomainError('Такого статуса нет.');
  const next = structuredClone(world);
  const page: WikiPage = {
    slug,
    title,
    cat: input.cat,
    endonym: input.endonym.trim(),
    endonym_gloss: input.endonymGloss.trim(),
    aliases: input.aliases
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean),
    visibility: input.visibility,
    updated_at: now,
  };
  const existing = next.wiki_pages.find((row) => row.slug === slug);
  if (existing) Object.assign(existing, page);
  else next.wiki_pages.push(page);
  applyGrants(next, { slug, blockId: null }, input.visibility, input.heroIds);
  return next;
}

export interface WikiBlockInput {
  id: string | null;
  pageSlug: string;
  kind: WikiBlockKind;
  body: string;
  visibility: WikiVisibility;
  heroIds: string[];
}

export function saveWikiBlock(world: World, actor: Actor, input: WikiBlockInput, meta: OpMeta): World {
  requireGm(actor);
  const body = input.body.trim();
  if (!body) throw new DomainError('Пустой раздел не сохраняем.');
  if (input.kind !== 'heading' && input.kind !== 'para' && input.kind !== 'infobox') {
    throw new DomainError('Такого вида раздела нет.');
  }
  if (!knownVis(input.visibility)) throw new DomainError('Такого статуса нет.');
  const next = structuredClone(world);
  const page = next.wiki_pages.find((row) => row.slug === input.pageSlug);
  if (!page) throw new DomainError('Сначала сохраните статью.');
  let block = input.id ? next.wiki_blocks.find((row) => row.id === input.id) : undefined;
  if (input.id && !block) throw new DomainError('Раздела нет.');
  if (!block) {
    const ord = next.wiki_blocks.filter((row) => row.page_slug === page.slug).reduce((max, row) => Math.max(max, row.ord), 0) + 1;
    block = { id: meta.id, page_slug: page.slug, ord, kind: input.kind, body_md: body, visibility: input.visibility };
    next.wiki_blocks.push(block);
  } else {
    block.kind = input.kind;
    block.body_md = body;
    block.visibility = input.visibility;
    block.page_slug = page.slug;
  }
  page.updated_at = meta.now;
  applyGrants(next, { slug: page.slug, blockId: block.id }, input.visibility, input.heroIds);
  return next;
}

export function removeWikiPage(world: World, actor: Actor, slug: string): World {
  requireGm(actor);
  const next = structuredClone(world);
  if (!next.wiki_pages.some((row) => row.slug === slug)) throw new DomainError('Статьи нет.');
  next.wiki_pages = next.wiki_pages.filter((row) => row.slug !== slug);
  next.wiki_blocks = next.wiki_blocks.filter((row) => row.page_slug !== slug);
  next.wiki_grants = next.wiki_grants.filter((row) => row.page_slug !== slug);
  next.wiki_margins = next.wiki_margins.filter((row) => row.page_slug !== slug);
  return next;
}

export function removeWikiBlock(world: World, actor: Actor, id: string): World {
  requireGm(actor);
  const next = structuredClone(world);
  const block = next.wiki_blocks.find((row) => row.id === id);
  if (!block) throw new DomainError('Раздела нет.');
  next.wiki_blocks = next.wiki_blocks.filter((row) => row.id !== id);
  next.wiki_grants = next.wiki_grants.filter((row) => row.block_id !== id);
  return next;
}

export function moveWikiBlock(world: World, actor: Actor, id: string, dir: -1 | 1): World {
  requireGm(actor);
  const next = structuredClone(world);
  const block = next.wiki_blocks.find((row) => row.id === id);
  if (!block) throw new DomainError('Раздела нет.');
  const siblings = next.wiki_blocks.filter((row) => row.page_slug === block.page_slug).sort((a, b) => a.ord - b.ord);
  const index = siblings.findIndex((row) => row.id === id);
  const neighbor = siblings[index + dir];
  if (!neighbor) return next;
  const ord = block.ord;
  block.ord = neighbor.ord;
  neighbor.ord = ord;
  return next;
}

export interface WikiMarginInput {
  pageSlug: string;
  kind: WikiMarginKind;
  audience: WikiAudience;
  body: string;
}

export function addWikiMargin(world: World, actor: Actor, input: WikiMarginInput, meta: OpMeta): World {
  if (!canEditHero(actor, actor.heroId ?? '')) throw new DomainError('Заметку оставляет сам герой.');
  const body = input.body.trim();
  if (!body) throw new DomainError('Напишите текст.');
  if (input.kind !== 'note' && input.kind !== 'rumor') throw new DomainError('Это не заметка и не слух.');
  if (input.audience !== 'personal' && input.audience !== 'shared') throw new DomainError('Выберите, кому видно.');
  const page = world.wiki_pages.find((row) => row.slug === input.pageSlug);
  if (!page || !canSeePage(actor, page, world.wiki_grants)) throw new DomainError('Этой статьи вам не видно.');
  const next = structuredClone(world);
  const margin: WikiMargin = {
    id: meta.id,
    page_slug: input.pageSlug,
    hero_id: actor.heroId ?? '',
    kind: input.kind,
    audience: input.audience,
    body,
    created_at: meta.now,
  };
  next.wiki_margins.push(margin);
  return next;
}

export function removeWikiMargin(world: World, actor: Actor, id: string): World {
  const next = structuredClone(world);
  const margin = next.wiki_margins.find((row) => row.id === id);
  if (!margin) throw new DomainError('Заметки нет.');
  if (!isGm(actor) && !canEditHero(actor, margin.hero_id)) throw new DomainError('Чужую заметку не стереть.');
  next.wiki_margins = next.wiki_margins.filter((row) => row.id !== id);
  return next;
}

export function grantsFor(grants: WikiGrant[], slug: string, blockId: string | null): string[] {
  return grants.filter((grant) => grant.page_slug === slug && grant.block_id === blockId).map((grant) => grant.hero_id);
}

export function infoboxRows(body: string): { key: string; value: string }[] {
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const cut = line.indexOf('|');
      if (cut < 0) return { key: line, value: '' };
      return { key: line.slice(0, cut).trim(), value: line.slice(cut + 1).trim() };
    });
}
