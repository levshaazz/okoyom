import { useState } from 'preact/hooks';
import {
  chronicleFeed,
  clockPane,
  placeLabels,
  renderChronicle,
  visibleMemories,
  visibleParts,
  type ChronicleEntryInput,
} from '../lib/chronicle';
import { isGm } from '../lib/domain';
import { href } from '../lib/paths';
import type { Actor, ChronicleEntry, ChronicleVisibility, World } from '../lib/types';
import { Notices, Pips, useNotice } from './bits';
import { useCampaign } from './use-campaign';

function ruDate(iso: string): string {
  const date = new Date(`${iso}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function actorOf(session: { role: Actor['role']; heroId: string | null; preview: boolean }): Actor {
  return { role: session.role, heroId: session.heroId, preview: session.role === 'gm' ? session.preview : false };
}

function playing(actor: Actor): boolean {
  return actor.role === 'player' || (actor.role === 'gm' && actor.preview && Boolean(actor.heroId));
}

export default function ChronicleApp() {
  const { store, session, world, booting, bootError } = useCampaign();
  const [heroId, setHeroId] = useState<string | 'all'>('all');
  const [place, setPlace] = useState<string | 'all'>('all');
  const notice = useNotice();

  if (bootError) return <p class="page">{bootError}</p>;
  if (booting || !world || !session) return <p class="page dim">Открываем летопись…</p>;

  const actor = actorOf(session);
  const feed = chronicleFeed(world, actor, { heroId, place });
  const places = placeLabels(world, actor);
  const pane = clockPane(world, actor, new Date().toISOString());
  const planned = world.sessions.find((row) => row.status === 'planned');

  async function run(action: () => Promise<void>, ok: string) {
    try {
      await action();
      notice.flash(ok);
    } catch (reason) {
      notice.fail(reason);
    }
  }

  return (
    <div class="page chronicle-page">
      <Notices error={notice.error} toast={notice.toast} />
      <header class="chronicle-head">
        <div>
          <h1>Летопись</h1>
          <p class="dim small">Пишет мастер после вылазки. Игроки добавляют, что запомнили. Часть записи может быть только для тех, кто там был.</p>
        </div>
      </header>
      <div class="filters" role="tablist">
        <button type="button" class={heroId === 'all' && place === 'all' ? 'badge solid' : 'badge g'} onClick={() => { setHeroId('all'); setPlace('all'); }}>
          Все · {chronicleFeed(world, actor, { heroId: 'all', place: 'all' }).length}
        </button>
        {playing(actor) && actor.heroId && (
          <button type="button" class={heroId === actor.heroId ? 'badge solid' : 'badge g'} onClick={() => setHeroId(actor.heroId!)}>
            С моим героем
          </button>
        )}
        {places.map((label) => (
          <button key={label} type="button" class={place === label ? 'badge solid' : 'badge g'} onClick={() => setPlace(place === label ? 'all' : label)}>
            {label}
          </button>
        ))}
      </div>
      <div class="chronicle-layout">
        <div class="tl">
          {feed.length === 0 && <p class="dim">В этом срезе записей нет.</p>}
          {feed.map((entry, index) => (
            <EntryCard
              key={entry.id}
              world={world}
              actor={actor}
              entry={entry}
              featured={index === 0}
              onMemory={(body) => run(() => store.addChronicleMemory(entry.id, body), 'Воспоминание записано.')}
              onDropMemory={(id) => run(() => store.removeChronicleMemory(id), 'Воспоминание убрано.')}
              onAddPart={(input) => run(() => store.saveChroniclePart({ id: null, entryId: entry.id, ...input }), 'Часть добавлена.')}
            />
          ))}
          {isGm(actor) && <EntryForm onSave={(input) => run(() => store.saveChronicleEntry(input), 'Запись сохранена.')} heroes={world.heroes} />}
        </div>
        <aside class="stack">
          <article class="panel gl">
            <div class="ptitle">Приметы</div>
            {pane.omens.length === 0 && <p class="small dim">Пока тишина. Приметы выпускает мастер.</p>}
            <ul class="omen-list small">
              {pane.omens.map((omen) => (
                <li key={omen.id}>◇ {omen.text}</li>
              ))}
            </ul>
            <p class="xs dim">Шкалы мира мастер держит при себе. Здесь только то, что видно с берега.</p>
          </article>
          {pane.clocks && (
            <article class="panel">
              <div class="ptitle">Часы мира</div>
              <p class="xs dim">Игрокам уходят только приметы. Заполнение и заметка остаются у мастера.</p>
              {pane.clocks.map((clock) => (
                <div key={clock.id} class="clock-card">
                  <div class="row spread">
                    <b>{clock.title}</b>
                    <span class="xs dim">
                      {clock.filled} / {clock.segments}
                    </span>
                  </div>
                  <Pips filled={clock.filled} max={clock.segments} />
                  {clock.notes && <p class="small dim">{clock.notes}</p>}
                  <button type="button" class="btn sm" onClick={() => void run(() => store.advanceWorldClock(clock.id), 'Часы сдвинулись.')}>
                    Ещё деление
                  </button>
                  <OmenForm onSave={(text) => run(() => store.saveOmen({ clockId: clock.id, text, visibility: 'players' }), 'Примета выпущена.')} />
                </div>
              ))}
            </article>
          )}
          {planned && (
            <article class="panel">
              <div class="ptitle">Следующая вылазка</div>
              <div class="salt">{planned.title}</div>
              <p class="small dim">
                {ruDate(planned.starts_at.slice(0, 10))} · {planned.game_date}
              </p>
              <p class="xs dim">Запись на вылазку появится вместе с сервером. Сейчас это объявление.</p>
            </article>
          )}
        </aside>
      </div>
    </div>
  );
}

function EntryCard({
  world,
  actor,
  entry,
  featured,
  onMemory,
  onDropMemory,
  onAddPart,
}: {
  world: World;
  actor: Actor;
  entry: ChronicleEntry;
  featured: boolean;
  onMemory: (body: string) => void;
  onDropMemory: (id: string) => void;
  onAddPart: (input: { body: string; visibility: ChronicleVisibility }) => void;
}) {
  const parts = visibleParts(world, actor, entry);
  const memories = visibleMemories(world, actor, entry);
  const fallen = entry.fallen.length > 0;
  const [body, setBody] = useState('');
  const [partBody, setPartBody] = useState('');
  const [partVis, setPartVis] = useState<ChronicleVisibility>('party');

  return (
    <article class={fallen ? 'ev fall' : featured ? 'ev big' : 'ev'}>
      <div class="dt">
        <b>{entry.game_date}</b>
        <span>{ruDate(entry.real_date)}</span>
      </div>
      <div class="body">
        <div class="xs asc dim">
          {entry.visibility === 'public' ? 'всем' : entry.visibility === 'players' ? 'ходокам' : 'только участникам'}
          {entry.loot ? ` · добыча: ${entry.loot}` : ''}
        </div>
        <h2 class="et">{entry.title}</h2>
        <div class="tag-row">
          {entry.hero_ids.map((id) => {
            const hero = world.heroes.find((row) => row.id === id);
            if (!hero) return null;
            return (
              <a key={id} class="badge g" href={href(`/hodoki/${hero.slug}`)}>
                {hero.name}
              </a>
            );
          })}
        </div>
        {entry.lead_md && <div class="chronicle-prose" dangerouslySetInnerHTML={{ __html: renderChronicle(entry.lead_md) }} />}
        {entry.places.length > 0 && (
          <p class="small">
            Места:{' '}
            {entry.places.map((place, index) => (
              <span key={place.label}>
                {index > 0 ? ', ' : ''}
                {place.wiki_slug ? <a class="gold" href={href(`/viki#${place.wiki_slug}`)}>{place.label}</a> : place.label}
                {place.map_label ? (
                  <>
                    {' '}
                    <a class="dim" href={href('/karta')}>
                      на карте
                    </a>
                  </>
                ) : null}
              </span>
            ))}
          </p>
        )}
        {entry.fallen.map((row) => (
          <p key={row.name} class="fallen-line">
            Пал: {row.name}. {row.note}
          </p>
        ))}
        {parts.map((part) =>
          part.body ? (
            <div key={part.id} class="chronicle-prose" dangerouslySetInnerHTML={{ __html: renderChronicle(part.body) }} />
          ) : (
            <p key={part.id} class="veil">
              Эта часть видна только участникам вылазки.
            </p>
          ),
        )}
        {memories.length > 0 && (
          <ul class="memories">
            {memories.map((memory) => {
              const hero = world.heroes.find((row) => row.id === memory.hero_id);
              return (
                <li key={memory.id}>
                  <span class="xs dim">{hero?.name ?? 'герой'} вспоминает</span>
                  <p>{memory.body}</p>
                  {(isGm(actor) || memory.hero_id === actor.heroId) && (
                    <button type="button" class="btn ghost sm" onClick={() => onDropMemory(memory.id)}>
                      Убрать
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {playing(actor) && (
          <form
            class="memory-form"
            onSubmit={(event) => {
              event.preventDefault();
              onMemory(body);
              setBody('');
            }}
          >
            <textarea
              rows={2}
              value={body}
              placeholder="Что запомнилось с этой вылазки"
              onInput={(event) => setBody((event.currentTarget as HTMLTextAreaElement).value)}
            />
            <button type="submit" class="btn sm" disabled={!body.trim()}>
              Добавить воспоминание
            </button>
          </form>
        )}
        {isGm(actor) && (
          <form
            class="memory-form"
            onSubmit={(event) => {
              event.preventDefault();
              onAddPart({ body: partBody, visibility: partVis });
              setPartBody('');
            }}
          >
            <div class="chip-row">
              <button type="button" class={partVis === 'public' ? 'chip on' : 'chip'} onClick={() => setPartVis('public')}>
                всем
              </button>
              <button type="button" class={partVis === 'players' ? 'chip on' : 'chip'} onClick={() => setPartVis('players')}>
                ходокам
              </button>
              <button type="button" class={partVis === 'party' ? 'chip on' : 'chip'} onClick={() => setPartVis('party')}>
                только участникам
              </button>
            </div>
            <textarea
              rows={2}
              value={partBody}
              placeholder="Часть записи. «Только участникам» другие не прочитают."
              onInput={(event) => setPartBody((event.currentTarget as HTMLTextAreaElement).value)}
            />
            <button type="submit" class="btn sm pri" disabled={!partBody.trim()}>
              Добавить часть
            </button>
          </form>
        )}
      </div>
    </article>
  );
}

function OmenForm({ onSave }: { onSave: (text: string) => void }) {
  const [text, setText] = useState('');
  return (
    <form
      class="memory-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(text);
        setText('');
      }}
    >
      <textarea
        rows={2}
        value={text}
        placeholder="Примета, которую увидят ходоки. Сами часы им не показываем."
        onInput={(event) => setText((event.currentTarget as HTMLTextAreaElement).value)}
      />
      <button type="submit" class="btn sm pri" disabled={!text.trim()}>
        Выпустить примету
      </button>
    </form>
  );
}

function EntryForm({
  heroes,
  onSave,
}: {
  heroes: World['heroes'];
  onSave: (input: ChronicleEntryInput) => void;
}) {
  const [realDate, setRealDate] = useState('2026-11-04');
  const [gameDate, setGameDate] = useState('');
  const [title, setTitle] = useState('');
  const [lead, setLead] = useState('');
  const [loot, setLoot] = useState('');
  const [place, setPlace] = useState('');
  const [wiki, setWiki] = useState('');
  const [fallen, setFallen] = useState('');
  const [visibility, setVisibility] = useState<ChronicleVisibility>('public');
  const [heroIds, setHeroIds] = useState<string[]>([]);

  return (
    <form
      class="panel form chronicle-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({
          id: null,
          realDate,
          gameDate,
          title,
          lead,
          heroIds,
          places: place.trim() ? [{ label: place, wikiSlug: wiki, mapLabel: place }] : [],
          loot,
          fallen: fallen.trim() ? [{ name: fallen, note: '' }] : [],
          visibility,
        });
        setTitle('');
        setLead('');
        setLoot('');
        setPlace('');
        setWiki('');
        setFallen('');
      }}
    >
      <div class="ptitle">Новая запись</div>
      <div class="two">
        <label>
          Настоящая дата
          <input type="date" value={realDate} onInput={(event) => setRealDate((event.currentTarget as HTMLInputElement).value)} />
        </label>
        <label>
          Дата мира
          <input value={gameDate} onInput={(event) => setGameDate((event.currentTarget as HTMLInputElement).value)} />
        </label>
      </div>
      <label>
        Название
        <input value={title} onInput={(event) => setTitle((event.currentTarget as HTMLInputElement).value)} />
      </label>
      <label>
        Текст
        <textarea rows={4} value={lead} onInput={(event) => setLead((event.currentTarget as HTMLTextAreaElement).value)} />
      </label>
      <div class="two">
        <label>
          Место
          <input value={place} onInput={(event) => setPlace((event.currentTarget as HTMLInputElement).value)} />
        </label>
        <label>
          Адрес в вики
          <input value={wiki} placeholder="slug" onInput={(event) => setWiki((event.currentTarget as HTMLInputElement).value)} />
        </label>
      </div>
      <label>
        Добыча
        <input value={loot} onInput={(event) => setLoot((event.currentTarget as HTMLInputElement).value)} />
      </label>
      <label>
        Пал (имя, если был)
        <input value={fallen} onInput={(event) => setFallen((event.currentTarget as HTMLInputElement).value)} />
      </label>
      <div class="check-row">
        {heroes.map((hero) => (
          <label key={hero.id} class="check">
            <input
              type="checkbox"
              checked={heroIds.includes(hero.id)}
              onChange={() =>
                setHeroIds((current) => (current.includes(hero.id) ? current.filter((id) => id !== hero.id) : [...current, hero.id]))
              }
            />
            {hero.name}
          </label>
        ))}
      </div>
      <div class="chip-row">
        <button type="button" class={visibility === 'public' ? 'chip on' : 'chip'} onClick={() => setVisibility('public')}>
          всем
        </button>
        <button type="button" class={visibility === 'players' ? 'chip on' : 'chip'} onClick={() => setVisibility('players')}>
          ходокам
        </button>
        <button type="button" class={visibility === 'party' ? 'chip on' : 'chip'} onClick={() => setVisibility('party')}>
          только участникам
        </button>
      </div>
      <button type="submit" class="btn pri">
        Записать
      </button>
    </form>
  );
}
