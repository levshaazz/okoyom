import { useEffect, useState } from 'preact/hooks';
import { href } from '../lib/paths';
import type { BookPage } from '../lib/types';
import { useCampaign } from './use-campaign';

export default function BookReader({ copyId }: { copyId: string }) {
  const { store, session, world, booting } = useCampaign();
  const [pages, setPages] = useState<BookPage[] | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [denied, setDenied] = useState(false);
  const [wide, setWide] = useState(true);

  useEffect(() => {
    const query = window.matchMedia('(min-width: 801px)');
    const apply = () => setWide(query.matches);
    apply();
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    if (booting || !session) return;
    let live = true;
    store.openBook(copyId).then((result) => {
      if (!live) return;
      setPages(result.pages);
      setApplied(result.applied);
    }).catch(() => {
      if (live) setDenied(true);
    });
    return () => { live = false; };
  }, [booting, session, copyId, store]);

  if (booting || !world) return <p class="page dim">Открываем книгу…</p>;
  const copy = world.book_copies.find((row) => row.id === copyId);
  const book = world.books.find((row) => row.id === copy?.book_id);
  if (denied || !book) {
    return (
      <div class="page stub">
        <h1>Книга закрыта</h1>
        <p>Текст есть только у того, кто держит экземпляр. Гостю и чужому герою страниц нет.</p>
        <a class="btn" href={href('/hodoki')}>К ходокам</a>
      </div>
    );
  }
  const step = wide ? 2 : 1;
  const left = pages?.[index];
  const right = wide ? pages?.[index + 1] : null;
  const max = Math.max(0, (pages?.length ?? 1) - step);

  function turn(delta: number) {
    setIndex((current) => Math.min(max, Math.max(0, current + delta * step)));
  }

  return (
    <div class="book-room"
      onPointerDown={(event) => { (event.currentTarget as HTMLElement).dataset.x = String(event.clientX); }}
      onPointerUp={(event) => {
        const start = Number((event.currentTarget as HTMLElement).dataset.x ?? event.clientX);
        const dx = event.clientX - start;
        if (Math.abs(dx) > 50) turn(dx < 0 ? 1 : -1);
      }}
    >
      <div class="book-bar">
        <a class="btn ghost sm" href={href(`/hodoki/${world.heroes.find((hero) => hero.id === copy?.holder_hero_id)?.slug ?? ''}/sumka`)}>К сумке</a>
        <h1>{book.title}</h1>
        <span class="dim small">{book.author}</span>
      </div>
      {applied && <p class="badge ok book-gain">Первое прочтение: {applied}</p>}
      <div class={wide ? 'book-spread' : 'book-spread one'}>
        <article class="parchment">
          <h2>{book.title}</h2>
          <p>{left?.body ?? '…'}</p>
          <span class="page-no">— {left?.n ?? 1} —</span>
        </article>
        {wide && (
          <article class="parchment">
            {right && <h2>{book.title}</h2>}
            <p>{right?.body ?? ''}</p>
            {right && <span class="page-no">— {right.n} —</span>}
          </article>
        )}
      </div>
      <div class="book-turn">
        <button type="button" class="btn" onClick={() => turn(-1)} disabled={index === 0}>Назад</button>
        <button type="button" class="btn" onClick={() => turn(1)} disabled={index >= max}>Дальше</button>
      </div>
    </div>
  );
}
