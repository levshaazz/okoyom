import { useEffect, useState } from 'preact/hooks';
import { isGm } from '../lib/domain';
import { href } from '../lib/paths';
import type { WikiBlockKind, WikiCat, WikiPage, WikiVisibility } from '../lib/types';
import { catLabel, grantsFor, visShort, WIKI_CATS } from '../lib/wiki';
import { Notices, useNotice } from './bits';
import { useCampaign } from './use-campaign';
import { RevealBar } from './wiki-ui';

const EMPTY = {
  slug: '',
  title: '',
  cat: 'mesta' as WikiCat,
  endonym: '',
  endonymGloss: '',
  aliases: '',
  visibility: 'draft' as WikiVisibility,
  heroIds: [] as string[],
};

export default function WikiDesk() {
  const { store, session, world, booting, bootError } = useCampaign();
  const [slug, setSlug] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState(EMPTY);
  const notice = useNotice();

  useEffect(() => {
    if (!world) return;
    if (!slug && !creating && world.wiki_pages[0]) setSlug(world.wiki_pages[0].slug);
  }, [world, slug, creating]);

  useEffect(() => {
    if (!world || creating) return;
    const page = world.wiki_pages.find((row) => row.slug === slug);
    if (!page) return;
    setDraft({
      slug: page.slug,
      title: page.title,
      cat: page.cat,
      endonym: page.endonym,
      endonymGloss: page.endonym_gloss,
      aliases: page.aliases.join(', '),
      visibility: page.visibility,
      heroIds: grantsFor(world.wiki_grants, page.slug, null),
    });
  }, [slug, creating, world]);

  if (bootError) return <p class="page">{bootError}</p>;
  if (booting || !world || !session) return <p class="page dim">Открываем мастерскую…</p>;
  if (!isGm(session)) {
    return (
      <div class="page stub">
        <h1>Мир: вики</h1>
        <p>Редактор открыт мастеру. В пробном входе это роль «мастер» — не защита.</p>
        <a class="btn" href={href('/viki')}>
          Читать вики
        </a>
      </div>
    );
  }

  const heroes = world.heroes.map((hero) => ({ id: hero.id, name: hero.name }));
  const page = world.wiki_pages.find((row) => row.slug === slug) ?? null;

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
      <header class="wiki-head">
        <div>
          <h1>Мир: вики</h1>
          <p class="dim small">
            Редактор Markdown. Клик по статусу открывает статью или раздел. Черновик и скрытое видит только мастер.
            TODO(supabase): скрытые разделы закроет RLS — сейчас отсев в интерфейсе, а весь мир лежит в IndexedDB.
          </p>
        </div>
        <a class="btn ghost sm" href={href('/viki')}>
          Как видит вики
        </a>
      </header>
      <div class="wiki-desk">
        <aside class="panel">
          <div class="row spread">
            <div class="ptitle">Статьи</div>
            <button
              type="button"
              class="btn sm"
              onClick={() => {
                setCreating(true);
                setSlug(null);
                setDraft(EMPTY);
              }}
            >
              Новая
            </button>
          </div>
          <ul class="wiki-desk-list">
            {world.wiki_pages
              .slice()
              .sort((a, b) => a.title.localeCompare(b.title, 'ru'))
              .map((row) => (
                <li key={row.slug}>
                  <button
                    type="button"
                    class={!creating && slug === row.slug ? 'on' : ''}
                    onClick={() => {
                      setCreating(false);
                      setSlug(row.slug);
                    }}
                  >
                    <span>{row.title}</span>
                    <span class="xs dim">
                      {catLabel(row.cat)} · {visShort(row.visibility)}
                    </span>
                  </button>
                </li>
              ))}
          </ul>
        </aside>
        <div class="stack">
          <form
            class="panel form wiki-form"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await store.saveWikiPage(draft);
                setCreating(false);
                setSlug(draft.slug.trim().toLowerCase());
              }, 'Статья сохранена.');
            }}
          >
            <div class="ptitle">{creating ? 'Новая статья' : 'Статья'}</div>
            <label>
              Адрес
              <input
                value={draft.slug}
                disabled={!creating && Boolean(page)}
                onInput={(event) => setDraft({ ...draft, slug: (event.currentTarget as HTMLInputElement).value })}
              />
            </label>
            <label>
              Название
              <input value={draft.title} onInput={(event) => setDraft({ ...draft, title: (event.currentTarget as HTMLInputElement).value })} />
            </label>
            <label>
              Раздел
              <select value={draft.cat} onChange={(event) => setDraft({ ...draft, cat: (event.currentTarget as HTMLSelectElement).value as WikiCat })}>
                {WIKI_CATS.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.label}
                  </option>
                ))}
              </select>
            </label>
            <div class="two">
              <label>
                Самоназвание
                <input
                  value={draft.endonym}
                  onInput={(event) => setDraft({ ...draft, endonym: (event.currentTarget as HTMLInputElement).value })}
                />
              </label>
              <label>
                Пояснение
                <input
                  value={draft.endonymGloss}
                  onInput={(event) => setDraft({ ...draft, endonymGloss: (event.currentTarget as HTMLInputElement).value })}
                />
              </label>
            </div>
            <label>
              Другие имена через запятую
              <input
                value={draft.aliases}
                onInput={(event) => setDraft({ ...draft, aliases: (event.currentTarget as HTMLInputElement).value })}
              />
            </label>
            <RevealBar
              visibility={draft.visibility}
              heroIds={draft.heroIds}
              heroes={heroes}
              onApply={(visibility, heroIds) => setDraft({ ...draft, visibility, heroIds })}
            />
            <div class="row">
              <button type="submit" class="btn pri">
                Сохранить статью
              </button>
              {page && (
                <button
                  type="button"
                  class="btn red sm"
                  onClick={() => {
                    if (!window.confirm(`Стереть статью «${page.title}»?`)) return;
                    void run(async () => {
                      await store.removeWikiPage(page.slug);
                      setSlug(null);
                      setCreating(false);
                    }, 'Статья стерта.');
                  }}
                >
                  Стереть
                </button>
              )}
              {page && (
                <a class="btn ghost sm" href={href(`/viki#${page.slug}`)}>
                  Открыть
                </a>
              )}
            </div>
          </form>
          {page && <BlockList page={page} heroes={heroes} run={run} />}
        </div>
      </div>
    </div>
  );
}

function BlockList({
  page,
  heroes,
  run,
}: {
  page: WikiPage;
  heroes: { id: string; name: string }[];
  run: (action: () => Promise<void>, ok: string) => Promise<void>;
}) {
  const { store, world } = useCampaign();
  const blocks = (world?.wiki_blocks ?? []).filter((block) => block.page_slug === page.slug).sort((a, b) => a.ord - b.ord);
  const [fresh, setFresh] = useState(false);

  return (
    <div class="stack">
      <div class="row spread">
        <h2>Разделы</h2>
        <button type="button" class="btn sm" onClick={() => setFresh(true)}>
          Добавить раздел
        </button>
      </div>
      {blocks.map((block) => (
        <BlockCard
          key={block.id}
          id={block.id}
          kind={block.kind}
          body={block.body_md}
          visibility={block.visibility}
          heroIds={grantsFor(world?.wiki_grants ?? [], page.slug, block.id)}
          heroes={heroes}
          onSave={(input) => run(() => store.saveWikiBlock({ id: block.id, pageSlug: page.slug, ...input }), 'Раздел сохранён.')}
          onDrop={() => run(() => store.removeWikiBlock(block.id), 'Раздел убран.')}
          onMove={(dir) => run(() => store.moveWikiBlock(block.id, dir), 'Порядок изменён.')}
        />
      ))}
      {fresh && (
        <BlockCard
          id={null}
          kind="para"
          body=""
          visibility="draft"
          heroIds={[]}
          heroes={heroes}
          onSave={(input) =>
            run(async () => {
              await store.saveWikiBlock({ id: null, pageSlug: page.slug, ...input });
              setFresh(false);
            }, 'Раздел добавлен.')
          }
          onDrop={() => setFresh(false)}
          onMove={() => undefined}
        />
      )}
    </div>
  );
}

function BlockCard({
  id,
  kind,
  body,
  visibility,
  heroIds,
  heroes,
  onSave,
  onDrop,
  onMove,
}: {
  id: string | null;
  kind: WikiBlockKind;
  body: string;
  visibility: WikiVisibility;
  heroIds: string[];
  heroes: { id: string; name: string }[];
  onSave: (input: { kind: WikiBlockKind; body: string; visibility: WikiVisibility; heroIds: string[] }) => void;
  onDrop: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const [draftKind, setKind] = useState(kind);
  const [draftBody, setBody] = useState(body);
  const [draftVis, setVis] = useState(visibility);
  const [draftHeroes, setHeroes] = useState(heroIds);

  return (
    <form
      class="panel wiki-block-edit"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({ kind: draftKind, body: draftBody, visibility: draftVis, heroIds: draftHeroes });
      }}
    >
      <div class="row spread">
        <label>
          Вид
          <select value={draftKind} onChange={(event) => setKind((event.currentTarget as HTMLSelectElement).value as WikiBlockKind)}>
            <option value="heading">Заголовок</option>
            <option value="para">Текст</option>
            <option value="infobox">Карточка</option>
          </select>
        </label>
        {id && (
          <span class="row">
            <button type="button" class="btn ghost sm" onClick={() => onMove(-1)}>
              Выше
            </button>
            <button type="button" class="btn ghost sm" onClick={() => onMove(1)}>
              Ниже
            </button>
          </span>
        )}
      </div>
      <textarea
        rows={draftKind === 'heading' ? 2 : 6}
        value={draftBody}
        placeholder={draftKind === 'infobox' ? 'Ключ|значение, ссылка [[slug|имя]]' : 'Markdown. Ссылка: [[slug|имя]]'}
        onInput={(event) => setBody((event.currentTarget as HTMLTextAreaElement).value)}
      />
      <RevealBar
        visibility={draftVis}
        heroIds={draftHeroes}
        heroes={heroes}
        onApply={(next, ids) => {
          setVis(next);
          setHeroes(ids);
        }}
      />
      <div class="row">
        <button type="submit" class="btn pri sm">
          {id ? 'Сохранить раздел' : 'Добавить'}
        </button>
        <button type="button" class="btn ghost sm" onClick={onDrop}>
          {id ? 'Удалить' : 'Отмена'}
        </button>
      </div>
    </form>
  );
}
