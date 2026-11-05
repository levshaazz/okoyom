import { useState } from 'preact/hooks';
import { lettersFor, unreadCount } from '../lib/books';
import { isGm } from '../lib/domain';
import { Notices, useNotice } from './bits';
import { useCampaign } from './use-campaign';

export function LetterBox() {
  const { store, session, world, booting } = useCampaign();
  const [open, setOpen] = useState<string | null>(null);
  const notice = useNotice();
  if (booting || !world || !session) return <p class="page dim">Открываем записки…</p>;
  const heroId = isGm(session) ? null : session.heroId;
  if (!heroId && !isGm(session)) return <p class="page">Записки видны герою.</p>;
  const mine = heroId ? lettersFor(world, session, heroId) : [];
  const current = mine.find((row) => row.letter.id === open);
  return (
    <div class="page">
      <h1>Записки</h1>
      <p class="dim small">Непрочитанных: {heroId ? unreadCount(world, heroId) : 0}. Чужим текст не показывается.</p>
      <Notices error={notice.error} toast={notice.toast} />
      <ul class="plain-list">
        {mine.map(({ letter, recipient }) => (
          <li key={letter.id}>
            <button type="button" class="btn ghost" onClick={() => { setOpen(letter.id); if (!recipient.read_at) void store.markLetterRead(letter.id).catch((reason) => notice.fail(reason)); }}>
              {letter.title} · {letter.from_label} {recipient.read_at ? '' : '· новое'}
            </button>
          </li>
        ))}
        {mine.length === 0 && <li class="dim">Пока пусто.</li>}
      </ul>
      {current && (
        <article class="parchment note-sheet">
          <p class="xs dim">{current.letter.from_label}</p>
          <h2>{current.letter.title}</h2>
          <p>{current.letter.body}</p>
        </article>
      )}
    </div>
  );
}

export function GmLetters() {
  const { store, session, world, booting } = useCampaign();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [from, setFrom] = useState('мастер');
  const [picked, setPicked] = useState<string[]>([]);
  const [asItem, setAsItem] = useState(true);
  const notice = useNotice();
  if (booting || !world || !session) return <p class="page dim">Открываем записки…</p>;
  if (!isGm(session)) return <p class="page">Пишет только мастер.</p>;
  return (
    <div class="page">
      <h1>Скрытая записка</h1>
      <p class="dim small">Текст увидят только выбранные герои. Мастер видит, кто уже прочёл.</p>
      <Notices error={notice.error} toast={notice.toast} />
      <form class="form" onSubmit={(event) => {
        event.preventDefault();
        void (async () => {
          try {
            await store.sendLetter({ title, body, from, heroIds: picked, asItem });
            notice.flash('Записка отдана');
            setTitle('');
            setBody('');
          } catch (reason) {
            notice.fail(reason);
          }
        })();
      }}>
        <label>От кого<input value={from} onInput={(event) => setFrom((event.currentTarget as HTMLInputElement).value)} /></label>
        <label>Заголовок<input value={title} onInput={(event) => setTitle((event.currentTarget as HTMLInputElement).value)} /></label>
        <label>Текст<textarea value={body} onInput={(event) => setBody((event.currentTarget as HTMLTextAreaElement).value)} /></label>
        <div class="filters">
          {world.heroes.map((hero) => (
            <button key={hero.id} type="button" class={picked.includes(hero.id) ? 'badge solid' : 'badge g'} onClick={() => setPicked((list) => list.includes(hero.id) ? list.filter((id) => id !== hero.id) : [...list, hero.id])}>
              {hero.name}
            </button>
          ))}
        </div>
        <label class="row"><input type="checkbox" checked={asItem} onChange={(event) => setAsItem((event.currentTarget as HTMLInputElement).checked)} /> Положить в сумку как вещь</label>
        <button class="btn pri" type="submit">Отдать</button>
      </form>
      <ul class="plain-list">
        {world.letters.map((letter) => {
          const readers = world.letter_recipients.filter((row) => row.letter_id === letter.id);
          return (
            <li key={letter.id}>
              <b>{letter.title}</b> · {letter.from_label}
              <div class="xs dim">{readers.map((row) => `${world.heroes.find((hero) => hero.id === row.hero_id)?.name}: ${row.read_at ? 'прочтено' : 'не читал'}`).join(' · ')}</div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
