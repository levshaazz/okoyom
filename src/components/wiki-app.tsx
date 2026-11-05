import { useEffect, useMemo, useState } from 'preact/hooks';
import { isGm } from '../lib/domain';
import { formatWhen } from '../lib/format';
import { href } from '../lib/paths';
import type { Actor, WikiAudience, WikiCat, WikiMarginKind, WikiPage, WikiVisibility, World } from '../lib/types';
import {
  catLabel,
  grantsFor,
  highlightSafe,
  infoboxRows,
  linkedSlugs,
  renderWikiMarkdown,
  searchWiki,
  visLabel,
  visShort,
  visibleBlocks,
  visibleMargins,
  visiblePages,
  WIKI_CATS,
  canSeePage,
  isPlaying,
} from '../lib/wiki';
import { Notices, useNotice } from './bits';
import { useCampaign } from './use-campaign';
import { RevealBar } from './wiki-ui';

function readSlug(): string | null {
  if (typeof location === 'undefined') return null;
  const raw = location.hash.replace(/^#/, '');
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function actorOf(session: { role: Actor['role']; heroId: string | null; preview: boolean }): Actor {
  return { role: session.role, heroId: session.heroId, preview: session.role === 'gm' ? session.preview : false };
}

export default function WikiApp() {
  const { store, session, world, booting, bootError } = useCampaign();
  const [slug, setSlug] = useState<string | null>(readSlug);
  const notice = useNotice();

  useEffect(() => {
    const read = () => setSlug(readSlug());
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);

  if (bootError) return <p class="page">{bootError}</p>;
  if (booting || !world || !session) return <p class="page dim">Открываем вики…</p>;

  const actor = actorOf(session);
  async function run(action: () => Promise<void>, ok: string) {
    try {
      await action();
      notice.flash(ok);
    } catch (reason) {
      notice.fail(reason);
    }
  }

  return (
    <div class="page wiki-page">
      <Notices error={notice.error} toast={notice.toast} />
      {slug ? (
        <WikiArticle
          world={world}
          actor={actor}
          slug={slug}
          onReveal={(target, visibility, heroIds) =>
            run(() => store.setWikiVisibility(target, visibility, heroIds), 'Видимость обновлена.')
          }
          onMargin={(input) => run(() => store.addWikiMargin(input), input.kind === 'rumor' ? 'Слух записан как непроверенный.' : 'Заметка на полях.')}
          onDropMargin={(id) => run(() => store.removeWikiMargin(id), 'Поля очищены.')}
        />
      ) : (
        <WikiHome world={world} actor={actor} />
      )}
    </div>
  );
}

function WikiHome({ world, actor }: { world: World; actor: Actor }) {
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<WikiCat | 'all'>('all');
  const pages = visiblePages(world, actor);
  const inCat = cat === 'all' ? pages : pages.filter((page) => page.cat === cat);
  const searching = query.trim().length >= 2;
  const hits = searching ? searchWiki(world, actor, query, cat) : [];
  const rumors = world.wiki_margins.filter((margin) => margin.kind === 'rumor' && margin.hero_id === actor.heroId);

  return (
    <>
      <header class="wiki-head">
        <div>
          <h1>Вики Окоёма</h1>
          <p class="dim small">
            Что уже открыто. Пишет мастер. Слухи игроков помечены как непроверенные.
            {actor.role === 'guest' && ' Гостю видны только статьи, открытые всем.'}
          </p>
        </div>
        <div class="wiki-counts">
          <span class="badge ok">Всем · {pages.filter((page) => page.visibility === 'public').length}</span>
          {actor.role !== 'guest' && (
            <span class="badge g">Ходокам · {pages.filter((page) => page.visibility === 'players').length}</span>
          )}
          {isPlaying(actor) && (
            <span class="badge solid">Лично вам · {pages.filter((page) => page.visibility === 'heroes').length}</span>
          )}
        </div>
      </header>
      <div class="wiki-home">
        <div>
          <label class="wiki-search">
            <span class="srch-ic" aria-hidden="true">
              ⌕
            </span>
            <input
              value={query}
              placeholder="Искать в открытом слое…"
              onInput={(event) => setQuery((event.currentTarget as HTMLInputElement).value)}
            />
            <span class="xs dim">{searching ? `${hits.length} совпадений` : 'от двух букв'}</span>
          </label>
          <div class="filters" role="tablist">
            <button type="button" class={cat === 'all' ? 'badge solid' : 'badge g'} onClick={() => setCat('all')}>
              Все
            </button>
            {WIKI_CATS.map((row) => (
              <button key={row.id} type="button" class={cat === row.id ? 'badge solid' : 'badge g'} onClick={() => setCat(row.id)}>
                {row.label}
              </button>
            ))}
          </div>
          {searching ? (
            <div class="wiki-hits">
              {hits.length === 0 && <p class="dim">В открытом слое ничего не нашлось. Скрытое в поиск не попадает.</p>}
              {hits.map((hit) => (
                <a key={`${hit.kind}-${hit.slug}`} class={hit.kind === 'rumor' ? 'wiki-hit ru' : 'wiki-hit'} href={`#${hit.slug}`}>
                  <div class="xs dim asc">{hit.kind === 'rumor' ? 'Слух · непроверено' : catLabel(hit.cat)}</div>
                  <div class="wiki-hit-title">
                    {hit.title}
                    {hit.endonym && <span class="dim small"> · {hit.endonym}</span>}
                  </div>
                  <p class="small dim" dangerouslySetInnerHTML={{ __html: highlightSafe(hit.snippet, query) }} />
                </a>
              ))}
              <p class="xs dim">Черновики, скрытые разделы и чужие личные заметки в эту выдачу не входят.</p>
            </div>
          ) : (
            <ul class="wiki-catalog">
              {inCat.map((page) => (
                <li key={page.slug}>
                  <a href={`#${page.slug}`}>
                    <span class="xs dim asc">{catLabel(page.cat)}</span>
                    <span class="wiki-hit-title">
                      {page.title}
                      {page.endonym && <span class="dim small"> · {page.endonym}</span>}
                      {page.visibility !== 'public' && <span class="dim small"> · {visShort(page.visibility)}</span>}
                    </span>
                  </a>
                </li>
              ))}
              {inCat.length === 0 && <li class="dim">В этом разделе пока ничего не открыто.</li>}
            </ul>
          )}
        </div>
        <aside class="stack">
          <div>
            <div class="ptitle">Разделы</div>
            <div class="wiki-cats">
              {WIKI_CATS.map((row) => {
                const count = pages.filter((page) => page.cat === row.id).length;
                return (
                  <button key={row.id} type="button" class={cat === row.id ? 'on' : ''} onClick={() => setCat(row.id)}>
                    <b>{row.label}</b>
                    <span>{count}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <article class="panel">
            <div class="ptitle">Недавно в слое</div>
            <ul class="plain-list">
              {pages
                .slice()
                .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
                .slice(0, 4)
                .map((page) => (
                  <li key={page.slug}>
                    <a class="gold" href={`#${page.slug}`}>
                      {page.title}
                    </a>
                    <span class="xs dim"> · {catLabel(page.cat)}</span>
                  </li>
                ))}
            </ul>
          </article>
          {isPlaying(actor) && (
            <article class="panel pend">
              <div class="ptitle">Ваши слухи</div>
              {rumors.length === 0 && <p class="small dim">Общих слухов вы ещё не оставляли. Личные мастер тоже видит, другие игроки — нет.</p>}
              <ul class="plain-list">
                {rumors.map((rumor) => (
                  <li key={rumor.id}>
                    <i class="rumor-ink">«{rumor.body}»</i>
                    <div class="xs dim">
                      непроверено · {rumor.audience === 'personal' ? 'личная · ' : 'общая · '}
                      {formatWhen(rumor.created_at)}
                    </div>
                  </li>
                ))}
              </ul>
            </article>
          )}
          {isGm(actor) && (
            <p class="small">
              <a class="gold" href={href('/master/mir')}>
                Править статьи в мастерской →
              </a>
            </p>
          )}
        </aside>
      </div>
    </>
  );
}

function WikiArticle({
  world,
  actor,
  slug,
  onReveal,
  onMargin,
  onDropMargin,
}: {
  world: World;
  actor: Actor;
  slug: string;
  onReveal: (target: { slug: string; blockId: string | null }, visibility: WikiVisibility, heroIds: string[]) => void;
  onMargin: (input: { pageSlug: string; kind: WikiMarginKind; audience: WikiAudience; body: string }) => void;
  onDropMargin: (id: string) => void;
}) {
  const page = world.wiki_pages.find((row) => row.slug === slug);
  const allowed = Boolean(page && canSeePage(actor, page, world.wiki_grants));
  if (!page || !allowed) {
    return (
      <div class="stub">
        <p class="xs dim">
          <a href={href('/viki')}>Вики</a>
        </p>
        <h1>В открытом слое такой статьи нет</h1>
        <p>Либо адрес неверный, либо текст ещё не открыт вам. Скрытое не подтверждается.</p>
        <a class="btn" href={href('/viki')}>
          К оглавлению
        </a>
      </div>
    );
  }
  return (
    <ArticleBody
      world={world}
      actor={actor}
      page={page}
      onReveal={onReveal}
      onMargin={onMargin}
      onDropMargin={onDropMargin}
    />
  );
}

function ArticleBody({
  world,
  actor,
  page,
  onReveal,
  onMargin,
  onDropMargin,
}: {
  world: World;
  actor: Actor;
  page: WikiPage;
  onReveal: (target: { slug: string; blockId: string | null }, visibility: WikiVisibility, heroIds: string[]) => void;
  onMargin: (input: { pageSlug: string; kind: WikiMarginKind; audience: WikiAudience; body: string }) => void;
  onDropMargin: (id: string) => void;
}) {
  const blocks = visibleBlocks(world, actor, page.slug);
  const margins = visibleMargins(world, actor, page.slug);
  const heroes = world.heroes.map((hero) => ({ id: hero.id, name: hero.name }));
  const gm = isGm(actor);
  const ctx = useMemo(
    () => ({
      href: (slug: string) => `#${slug}`,
      title: (slug: string) => world.wiki_pages.find((row) => row.slug === slug)?.title ?? slug,
    }),
    [world],
  );
  const prose = blocks.filter((block) => block.kind !== 'infobox');
  const boxes = blocks.filter((block) => block.kind === 'infobox');
  const related = [
    ...new Set(blocks.flatMap((block) => linkedSlugs(block.body_md))),
  ]
    .map((slug) => world.wiki_pages.find((row) => row.slug === slug))
    .filter((row): row is WikiPage => Boolean(row && canSeePage(actor, row, world.wiki_grants)));
  const toc = prose.filter((block) => block.kind === 'heading');
  const sameCat = visiblePages(world, actor).filter((row) => row.cat === page.cat && row.slug !== page.slug);

  return (
    <div class="wiki-article">
      <aside class="wiki-toc">
        <a class="xs dim" href={href('/viki')}>
          ← К оглавлению
        </a>
        <div class="xs dim asc">{catLabel(page.cat)}</div>
        <div class="toc">
          {sameCat.slice(0, 8).map((row) => (
            <a key={row.slug} href={`#${row.slug}`}>
              {row.title}
            </a>
          ))}
          <a class="on" href={`#${page.slug}`}>
            {page.title}
          </a>
        </div>
        {toc.length > 0 && (
          <>
            <div class="rule" />
            <div class="xs dim asc">На странице</div>
            <div class="toc">
              {toc.map((block) => (
                <button key={block.id} type="button" onClick={() => document.getElementById(`b-${block.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                  {block.body_md}
                </button>
              ))}
              <button type="button" onClick={() => document.getElementById('wiki-margins')?.scrollIntoView({ behavior: 'smooth' })}>
                Поля · {margins.length}
              </button>
            </div>
          </>
        )}
      </aside>
      <article>
        <div class="xs dim asc">Вики · {catLabel(page.cat)}</div>
        <div class="wiki-title">
          <h1>{page.title}</h1>
          {page.endonym && (
            <p class="wiki-endonym">
              <span class="sc salt">{page.endonym}</span>
              {page.endonym_gloss && <span class="dim"> · {page.endonym_gloss}</span>}
            </p>
          )}
        </div>
        <div class={page.visibility === 'public' ? 'wiki-seal ok' : 'wiki-seal'}>
          <span class="seal">✓</span>
          <b>{visLabel(page.visibility)}</b>
          <span class="dim">· правка {formatWhen(page.updated_at)}</span>
        </div>
        {gm && (
          <RevealBar
            visibility={page.visibility}
            heroIds={grantsFor(world.wiki_grants, page.slug, null)}
            heroes={heroes}
            onApply={(visibility, heroIds) => onReveal({ slug: page.slug, blockId: null }, visibility, heroIds)}
          />
        )}
        <div class="wiki-prose">
          {prose.map((block) => {
            const secret = block.visibility === 'draft' || block.visibility === 'hidden' || block.visibility === 'heroes';
            return (
              <section key={block.id} id={`b-${block.id}`} class={gm && secret ? 'wiki-block secret' : 'wiki-block'}>
                {block.kind === 'heading' ? <h2>{block.body_md}</h2> : <div dangerouslySetInnerHTML={{ __html: renderWikiMarkdown(block.body_md, ctx) }} />}
                {gm && (
                  <RevealBar
                    visibility={block.visibility}
                    heroIds={grantsFor(world.wiki_grants, page.slug, block.id)}
                    heroes={heroes}
                    onApply={(visibility, heroIds) => onReveal({ slug: page.slug, blockId: block.id }, visibility, heroIds)}
                  />
                )}
              </section>
            );
          })}
        </div>
        <div id="wiki-margins">
          {margins.map((margin) => {
            const author = world.heroes.find((hero) => hero.id === margin.hero_id);
            const mine = margin.hero_id === actor.heroId;
            return (
              <div key={margin.id} class={margin.kind === 'rumor' ? 'wiki-rumor' : 'wiki-note'}>
                <div class="xs asc">
                  {margin.kind === 'rumor' ? 'Слух · непроверено' : 'Заметка'}
                  {' · '}
                  {author?.name ?? 'герой'}
                  {margin.audience === 'personal' ? ' · личная' : ' · общая'}
                  {gm && margin.audience === 'personal' ? ' · видит мастер' : ''}
                </div>
                <p>{margin.kind === 'rumor' ? `«${margin.body}»` : margin.body}</p>
                {(mine || gm) && (
                  <button type="button" class="btn ghost sm" onClick={() => onDropMargin(margin.id)}>
                    Убрать
                  </button>
                )}
              </div>
            );
          })}
          {isPlaying(actor) && <MarginForm onSubmit={(input) => onMargin({ pageSlug: page.slug, ...input })} />}
          {actor.role === 'guest' && <p class="xs dim">Гость читает открытое. Заметки и слухи оставляют герои.</p>}
        </div>
      </article>
      <aside class="stack wiki-side">
        {boxes.map((box) => (
          <article key={box.id} class="panel gl wiki-card">
            <div class="sc salt wiki-card-title">{page.title}</div>
            {page.endonym && <p class="xs dim center">{page.endonym}</p>}
            <table class="wiki-box">
              <tbody>
                {infoboxRows(box.body_md).map((row) => (
                  <tr key={row.key}>
                    <td>{row.key}</td>
                    <td dangerouslySetInnerHTML={{ __html: renderWikiMarkdown(row.value, ctx).replace(/^<p>|<\/p>$/g, '') }} />
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
        ))}
        <article class="panel">
          <div class="ptitle">Связано</div>
          <div class="tag-row">
            {related.length === 0 && <span class="dim small">В открытом слое связей нет.</span>}
            {related.map((row) => (
              <a key={row.slug} class="badge g" href={`#${row.slug}`}>
                {row.title}
              </a>
            ))}
          </div>
          <div class="rule" />
          <a class="gold small" href={href('/karta')}>
            ◇ Показать на карте
          </a>
          <p class="xs dim">Карта ещё без тумана: ссылка ведёт на заглушку, пока не готов следующий срез.</p>
        </article>
        {gm && (
          <p class="small">
            <a class="gold" href={href('/master/mir')}>
              Редактор Markdown →
            </a>
          </p>
        )}
      </aside>
    </div>
  );
}

function MarginForm({
  onSubmit,
}: {
  onSubmit: (input: { kind: WikiMarginKind; audience: WikiAudience; body: string }) => void;
}) {
  const [kind, setKind] = useState<WikiMarginKind>('note');
  const [audience, setAudience] = useState<WikiAudience>('personal');
  const [body, setBody] = useState('');

  return (
    <form
      class="wiki-margin-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ kind, audience, body });
        setBody('');
      }}
    >
      <div class="ptitle">На полях</div>
      <div class="wiki-vis">
        <button type="button" class={kind === 'note' ? 'chip on' : 'chip'} onClick={() => setKind('note')}>
          Заметка
        </button>
        <button type="button" class={kind === 'rumor' ? 'chip on' : 'chip'} onClick={() => setKind('rumor')}>
          Слух
        </button>
        <button type="button" class={audience === 'personal' ? 'chip on' : 'chip'} onClick={() => setAudience('personal')}>
          Личная
        </button>
        <button type="button" class={audience === 'shared' ? 'chip on' : 'chip'} onClick={() => setAudience('shared')}>
          Общая
        </button>
      </div>
      <textarea
        value={body}
        rows={3}
        placeholder={kind === 'rumor' ? 'Слух останется непроверенным, пока мастер не вплетёт его в статью.' : 'Заметка на полях. Личную увидите вы и мастер.'}
        onInput={(event) => setBody((event.currentTarget as HTMLTextAreaElement).value)}
      />
      <button type="submit" class="btn pri sm" disabled={!body.trim()}>
        {kind === 'rumor' ? 'Оставить слух' : 'Оставить заметку'}
      </button>
    </form>
  );
}
