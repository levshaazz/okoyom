import { useEffect, useRef, useState } from 'preact/hooks';
import { HERO } from '../data/seed';
import { openSwitcher } from '../lib/browser-store';
import { unreadCount } from '../lib/books';
import { gmPendingCount, pendingCountForHero } from '../lib/domain';
import { href } from '../lib/paths';
import { GUEST } from '../lib/store';
import type { Session } from '../lib/types';
import { IconBag, IconBook, IconGive, IconMap, IconNote, IconSheet, IconWait, IconWatch } from './icons';
import { useCampaign } from './use-campaign';

interface Props {
  page: string;
}

const PLAYER_NAV = [
  { id: 'home', href: '/', label: 'Главная' },
  { id: 'kontora', href: '/kontora', label: 'Контора' },
  { id: 'letopis', href: '/letopis', label: 'Летопись' },
  { id: 'karta', href: '/karta', label: 'Карта' },
  { id: 'viki', href: '/viki', label: 'Вики' },
  { id: 'hodoki', href: '/hodoki', label: 'Ходоки' },
  { id: 'biblioteka', href: '/biblioteka', label: 'Библиотека' },
];

const GM_NAV = [
  { id: 'master', href: '/master', label: 'Пульт' },
  { id: 'dozor', href: '/master/dozor', label: 'Дозор' },
  { id: 'geroi', href: '/master/geroi', label: 'Герои' },
  { id: 'zapiski', href: '/master/zapiski', label: 'Записки' },
  { id: 'mir', href: '/master/mir', label: 'Мир: вики и карта' },
  { id: 'karta', href: '/karta', label: 'Карта' },
  { id: 'vydat', href: '/master/vydat', label: 'Выдать' },
  { id: 'letopis', href: '/letopis', label: 'Летопись' },
];

export function EnterButton({ look, label }: { look: string; label: string }) {
  return (
    <button type="button" class={look} onClick={() => openSwitcher()}>
      {label}
    </button>
  );
}

export default function Chrome({ page }: Props) {
  const { store, session, world } = useCampaign();
  const dialog = useRef<HTMLDialogElement>(null);
  const [note, setNote] = useState<string | null>(null);
  const view = session ?? GUEST;
  const gmChrome = view.role === 'gm' && !view.preview;
  const hero = world?.heroes.find((row) => row.id === view.heroId) ?? null;
  const pending =
    world && hero ? pendingCountForHero(world, hero.id) : world && gmChrome ? gmPendingCount(world) : 0;
  const mail = world && hero ? unreadCount(world, hero.id) : 0;

  useEffect(() => {
    const open = () => dialog.current?.showModal();
    window.addEventListener('okoyom-switcher', open);
    return () => window.removeEventListener('okoyom-switcher', open);
  }, []);

  function go(next: Session, path: string) {
    store.setSession(next);
    dialog.current?.close();
    window.location.assign(href(path));
  }

  async function reset() {
    if (!window.confirm('Вернуть пробных героев к семени? Локальные правки в этом браузере сотрутся.')) return;
    await store.resetWorld();
    setNote('Пробные герои возвращены.');
  }

  const sheetPath = hero ? `/hodoki/${hero.slug}` : '/hodoki';
  const bagPath = hero ? `/hodoki/${hero.slug}/sumka` : '/hodoki';
  const links = gmChrome ? GM_NAV : PLAYER_NAV;
  const homeHref = gmChrome ? '/master' : '/';

  return (
    <div class="chrome">
      <header class={gmChrome ? 'top gmtop' : 'top'}>
        <div class="top-inner">
          <a class="logo" href={href(homeHref)}>
            ОКОЁМ <small>{gmChrome ? '· МАСТЕРСКАЯ' : '· ХОДОКИ'}</small>
          </a>
          <nav class="nav" aria-label={gmChrome ? 'Мастерская' : 'Кампания'}>
            {links.map((link) => (
              <a key={link.id} class={page === link.id || (link.id === 'hodoki' && page === 'list') ? 'on' : ''} href={href(link.href)}>
                {link.label}
              </a>
            ))}
          </nav>
          <div class="right">
            {view.role === 'guest' && (
              <>
                <span class="dim hide-sm">Гость</span>
                <button type="button" class="btn pri" onClick={() => openSwitcher()}>
                  Войти героем
                </button>
              </>
            )}
            {view.role !== 'guest' && !gmChrome && (
              <>
                <a class="badge" href={href('/zhdut')}>
                  ⏳ {pending} ждут мастера
                </a>
                <span class="live hide-sm" title="Сервера нет. Лист лежит в этом браузере.">
                  <i />
                  локально
                </span>
                <a class="bell" href={href('/zapiski')} title={mail ? `Непрочитанных записок: ${mail}` : 'Записки'}>
                  ✉
                  {mail > 0 && <b class="mb">{mail}</b>}
                </a>
                <button type="button" class="who hide-sm" onClick={() => openSwitcher()}>
                  {hero?.name ?? 'Герой'}
                </button>
                <Portrait heroPath={hero?.portrait_path ?? null} letter={hero?.name[0] ?? '?'} onClick={() => openSwitcher()} />
              </>
            )}
            {gmChrome && (
              <>
                <span class="live hide-sm" title="Живой стол ещё не подключён. Всё хранится в браузере.">
                  <i />
                  сессии нет · локально
                </span>
                <button
                  type="button"
                  class="gmeye hide-sm"
                  onClick={() => {
                    const id = view.heroId ?? HERO.rimte;
                    store.setSession({ role: 'gm', heroId: id, preview: true });
                    const slug = world?.heroes.find((row) => row.id === id)?.slug ?? 'rimte';
                    window.location.assign(href(`/hodoki/${slug}`));
                  }}
                >
                  👁 как видит игрок
                </button>
                <span class="hide-sm">Мастер</span>
                <button type="button" class="ava gm" onClick={() => openSwitcher()} aria-label="Пробный вход">
                  М
                </button>
              </>
            )}
          </div>
        </div>
      </header>
      {view.preview && (
        <div class="preview-bar">
          <span>Просмотр глазами игрока · {hero?.name ?? 'герой'}. Это не выход и не защита.</span>
          <button
            type="button"
            class="btn sm"
            onClick={() => {
              store.setSession({ role: 'gm', heroId: view.heroId, preview: false });
              window.location.assign(href('/master'));
            }}
          >
            Вернуться в мастерскую
          </button>
        </div>
      )}

      {view.role === 'guest' && (
        <nav class="mnav" aria-label="Низ экрана">
          <a class={page === 'home' ? 'on' : ''} href={href('/')}>
            <IconSheet />
            Главная
          </a>
          <a class={page === 'hodoki' || page === 'list' ? 'on' : ''} href={href('/hodoki')}>
            <IconMap />
            Ходоки
          </a>
          <a class={page === 'viki' ? 'on' : ''} href={href('/viki')}>
            <IconBook />
            Вики
          </a>
          <button type="button" onClick={() => openSwitcher()}>
            <IconWait />
            Войти
          </button>
        </nav>
      )}
      {view.role !== 'guest' && !gmChrome && (
        <nav class="mnav" aria-label="Низ экрана">
          <a class={page === 'list' ? 'on' : ''} href={href(sheetPath)}>
            <IconSheet />
            Лист
          </a>
          <a class={page === 'karta' ? 'on' : ''} href={href('/karta')}>
            <IconMap />
            Карта
          </a>
          <a class={page === 'viki' ? 'on' : ''} href={href('/viki')}>
            <IconBook />
            Вики
          </a>
          <a class={page === 'sumka' ? 'on' : ''} href={href(bagPath)}>
            <IconBag />
            Сумка
          </a>
          <a class={page === 'zhdut' ? 'on' : ''} href={href('/zhdut')}>
            {pending > 0 && <b class="mb">{pending}</b>}
            <IconWait />
            Ждут
          </a>
        </nav>
      )}
      {gmChrome && (
        <nav class="mnav gmnav" aria-label="Мастерская">
          <a class={page === 'master' ? 'on' : ''} href={href('/master')}>
            {pending > 0 && <b class="mb">{pending}</b>}
            <IconWait />
            Пульт
          </a>
          <a class={page === 'dozor' ? 'on' : ''} href={href('/master/dozor')}>
            <IconWatch />
            Дозор
          </a>
          <a class={page === 'geroi' ? 'on' : ''} href={href('/master/geroi')}>
            <IconSheet />
            Герои
          </a>
          <a class={page === 'zapiski' ? 'on' : ''} href={href('/master/zapiski')}>
            <IconNote />
            Записка
          </a>
          <a class={page === 'mir' ? 'on' : ''} href={href('/master/mir')}>
            <IconMap />
            Мир
          </a>
          <a class={page === 'karta' ? 'on' : ''} href={href('/karta')}>
            <IconMap />
            Карта
          </a>
          <a class={page === 'vydat' ? 'on' : ''} href={href('/master/vydat')}>
            <IconGive />
            Выдать
          </a>
        </nav>
      )}

      <dialog class="switcher" ref={dialog} onClick={(event) => {
        if (event.target === dialog.current) dialog.current?.close();
      }}>
        <h2>Пробный вход</h2>
        <p class="small">
          Это не учётная запись и не защита. Роль пишется только в этот браузер. Любой, кто откроет страницу, может
          назваться мастером. Настоящий вход — код мастера, логин и пароль — появится вместе с Supabase.
        </p>
        <p class="xs dim">
          Тестовые Дары тоже лежат в коде страницы. Чужой Дар прячет интерфейс, не сервер. Тайн кампании в репозитории нет.
        </p>
        <div class="switch-list">
          <button type="button" class={view.role === 'guest' ? 'btn on' : 'btn ghost'} onClick={() => go(GUEST, '/')}>
            Гость
          </button>
          <button type="button" class={view.role === 'player' && view.heroId === HERO.rimte ? 'btn on' : 'btn'} onClick={() => go({ role: 'player', heroId: HERO.rimte, preview: false }, '/hodoki/rimte')}>
            Римте Норейка · игрок
          </button>
          <button type="button" class={view.role === 'player' && view.heroId === HERO.toivo ? 'btn on' : 'btn'} onClick={() => go({ role: 'player', heroId: HERO.toivo, preview: false }, '/hodoki/toivo')}>
            Тойво Салми · игрок
          </button>
          <button type="button" class={view.role === 'player' && view.heroId === HERO.zhdan ? 'btn on' : 'btn'} onClick={() => go({ role: 'player', heroId: HERO.zhdan, preview: false }, '/hodoki/zhdan')}>
            Ждан Корш · игрок
          </button>
          <button type="button" class={view.role === 'gm' && !view.preview ? 'btn on' : 'btn red'} onClick={() => go({ role: 'gm', heroId: null, preview: false }, '/master')}>
            Мастер
          </button>
        </div>
        <div class="row spread">
          <button type="button" class="btn ghost sm" onClick={() => void reset()}>
            Сбросить пробные данные
          </button>
          <button type="button" class="btn ghost sm" onClick={() => dialog.current?.close()}>
            Закрыть
          </button>
        </div>
        {note && <p class="xs gold">{note}</p>}
      </dialog>
    </div>
  );
}

function Portrait({ heroPath, letter, onClick }: { heroPath: string | null; letter: string; onClick: () => void }) {
  if (heroPath) {
    return <button type="button" class="icon-btn" onClick={onClick} aria-label="Пробный вход"><img class="ava" src={href(heroPath)} alt="" /></button>;
  }
  return (
    <button type="button" class="ava-fallback" onClick={onClick} aria-label="Пробный вход">
      {letter}
    </button>
  );
}
