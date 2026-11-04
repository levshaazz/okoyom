import { describe, expect, it } from 'vitest';
import { HERO, createSeedWorld } from '../data/seed';
import { DomainError } from './errors';
import { CampaignStore, memoryHooks } from './store';
import type { Actor, OpMeta } from './types';
import {
  addWikiMargin,
  canSeePage,
  renderWikiMarkdown,
  searchWiki,
  setWikiVisibility,
  visibleBlocks,
  visibleMargins,
  visiblePages,
} from './wiki';

const guest: Actor = { role: 'guest', heroId: null, preview: false };
const rimte: Actor = { role: 'player', heroId: HERO.rimte, preview: false };
const toivo: Actor = { role: 'player', heroId: HERO.toivo, preview: false };
const gm: Actor = { role: 'gm', heroId: null, preview: false };
const preview: Actor = { role: 'gm', heroId: HERO.toivo, preview: true };
const meta: OpMeta = { id: 'id-w', opId: 'op-w', now: '2026-11-04T12:00:00.000Z' };
const link = { href: (slug: string) => `#${slug}`, title: (slug: string) => slug };

describe('видимость вики', () => {
  it('гость видит только открытое всем и не находит скрытый текст', () => {
    const world = createSeedWorld();
    const slugs = visiblePages(world, guest).map((page) => page.slug);
    expect(slugs).toEqual(expect.arrayContaining(['gavany', 'rechniki', 'artel', 'storozh']));
    expect(slugs).not.toEqual(expect.arrayContaining(['brod', 'kolokol', 'holmy']));
    expect(visibleBlocks(world, guest, 'gavany').map((block) => block.id)).not.toContain('wb-gavany-cellar');
    expect(visibleBlocks(world, guest, 'storozh').map((block) => block.id)).not.toContain('wb-storozh-draft');
    expect(searchWiki(world, guest, 'ключ-улитка', 'all')).toEqual([]);
    expect(searchWiki(world, guest, 'перевозный', 'all')).toEqual([]);
    expect(searchWiki(world, guest, 'третье веко', 'all')).toEqual([]);
    expect(searchWiki(world, guest, 'глухой звон', 'all')).toEqual([]);
    expect(searchWiki(world, guest, 'синий фонарь', 'all')).toEqual([]);
    expect(visibleMargins(world, guest, 'gavany')).toEqual([]);
  });

  it('игрок видит слой ходоков и свои разделы, но не чужие и не черновик', () => {
    const world = createSeedWorld();
    expect(visiblePages(world, rimte).map((page) => page.slug)).toContain('brod');
    expect(visiblePages(world, rimte).map((page) => page.slug)).not.toContain('holmy');
    expect(visiblePages(world, toivo).map((page) => page.slug)).toContain('holmy');
    expect(visibleBlocks(world, rimte, 'gavany').some((block) => block.body_md.includes('ключ-улитка'))).toBe(true);
    expect(visibleBlocks(world, toivo, 'gavany').some((block) => block.body_md.includes('ключ-улитка'))).toBe(false);
    expect(searchWiki(world, rimte, 'ключ-улитка', 'all').map((hit) => hit.slug)).toEqual(['gavany']);
    expect(searchWiki(world, toivo, 'ключ-улитка', 'all')).toEqual([]);
    expect(searchWiki(world, rimte, 'перевозный камень', 'all')[0]?.slug).toBe('brod');
    expect(searchWiki(world, rimte, 'третье веко', 'all')).toEqual([]);
    expect(searchWiki(world, rimte, 'синий фонарь', 'all')).toEqual([]);
    expect(searchWiki(world, rimte, 'глухой', 'all')).toEqual([]);
    expect(searchWiki(world, gm, 'глухой звон', 'all')[0]?.slug).toBe('kolokol');
    expect(searchWiki(world, gm, 'третье веко', 'all')[0]?.slug).toBe('storozh');
  });

  it('личные заметки видит автор и мастер, общий слух помечен и виден тем, кому видна статья', () => {
    const world = createSeedWorld();
    const rimteNotes = visibleMargins(world, rimte, 'gavany');
    expect(rimteNotes.map((row) => row.id).sort()).toEqual(['wm-rimte-note', 'wm-rimte-rumor']);
    const toivoNotes = visibleMargins(world, toivo, 'gavany');
    expect(toivoNotes.map((row) => row.id).sort()).toEqual(['wm-rimte-rumor', 'wm-toivo-note']);
    expect(visibleMargins(world, gm, 'gavany')).toHaveLength(3);
    expect(visibleMargins(world, preview, 'gavany').map((row) => row.id)).toEqual(['wm-rimte-rumor', 'wm-toivo-note']);
    const rumor = rimteNotes.find((row) => row.kind === 'rumor');
    expect(rumor?.audience).toBe('shared');
    expect(rumor?.body).toMatch(/колокол/);

    const next = addWikiMargin(
      world,
      toivo,
      { pageSlug: 'gavany', kind: 'rumor', audience: 'personal', body: 'Тихий причал за складом.' },
      meta,
    );
    expect(visibleMargins(next, rimte, 'gavany').some((row) => row.body.includes('Тихий причал'))).toBe(false);
    expect(visibleMargins(next, gm, 'gavany').some((row) => row.body.includes('Тихий причал'))).toBe(true);
    expect(() => addWikiMargin(world, rimte, { pageSlug: 'holmy', kind: 'note', audience: 'shared', body: 'нет' }, meta)).toThrow(
      DomainError,
    );
    expect(() => addWikiMargin(world, guest, { pageSlug: 'gavany', kind: 'note', audience: 'shared', body: 'нет' }, meta)).toThrow(
      DomainError,
    );
  });

  it('мастер открывает скрытую статью кликом, игрок — нет', async () => {
    const store = new CampaignStore(memoryHooks({ session: gm }));
    await store.ready();
    expect(canSeePage(guest, store.getWorld().wiki_pages.find((page) => page.slug === 'kolokol')!, store.getWorld().wiki_grants)).toBe(
      false,
    );
    await store.setWikiVisibility({ slug: 'kolokol', blockId: null }, 'public', []);
    expect(visiblePages(store.getWorld(), guest).some((page) => page.slug === 'kolokol')).toBe(true);
    store.setSession(rimte);
    await expect(store.setWikiVisibility({ slug: 'kolokol', blockId: null }, 'hidden', [])).rejects.toThrow(DomainError);
    const opened = setWikiVisibility(createSeedWorld(), gm, { slug: 'gavany', blockId: 'wb-gavany-cellar' }, 'players', [], meta.now);
    expect(visibleBlocks(opened, toivo, 'gavany').some((block) => block.id === 'wb-gavany-cellar')).toBe(true);
    expect(() => setWikiVisibility(createSeedWorld(), gm, { slug: 'holmy', blockId: null }, 'heroes', [], meta.now)).toThrow(/героя/);
  });

  it('поиск режет выдачу разделом и не тащит html', () => {
    const world = createSeedWorld();
    expect(searchWiki(world, guest, 'га', 'all').length).toBeGreaterThan(0);
    expect(searchWiki(world, guest, 'гавань', 'narody')).toEqual([]);
    expect(searchWiki(world, guest, 'га', 'mesta').every((hit) => hit.cat === 'mesta')).toBe(true);
    const html = renderWikiMarkdown('Привет <script>alert(1)</script> [[gavany|Гавань]] и *курсив*', link);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('href="#gavany"');
    expect(html).toContain('<em>курсив</em>');
    expect(renderWikiMarkdown('[[net-takogo]]', link)).toContain('href="#net-takogo"');
  });
});
