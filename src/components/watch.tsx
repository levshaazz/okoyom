import { useState } from 'preact/hooks';
import { isGm, pendingRequests } from '../lib/domain';
import { href } from '../lib/paths';
import type { Hero } from '../lib/types';
import { heroWatchLine, recentEvents, todayTableIds, watchFlags } from '../lib/watch';
import { Bar, Decide, Notices, useNotice } from './bits';
import { useCampaign } from './use-campaign';

export default function Watch() {
  const { store, session, world, booting, bootError } = useCampaign();
  const [mode, setMode] = useState<'all' | 'table' | 'pick'>('all');
  const [picked, setPicked] = useState<string[]>([]);
  const [feedHero, setFeedHero] = useState('all');
  const notice = useNotice();

  if (bootError) return <p class="page">{bootError}</p>;
  if (booting || !world || !session) return <p class="page dim">Открываем дозор…</p>;
  if (!isGm(session)) {
    return (
      <div class="page stub">
        <h1>Дозор</h1>
        <p>Экран мастера. В пробном входе его открывает роль «мастер» — это не защита.</p>
      </div>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const tableIds = todayTableIds(world, today);
  const heroes = world.heroes.filter((hero) => {
    if (mode === 'table') return tableIds.includes(hero.id);
    if (mode === 'pick') return picked.includes(hero.id);
    return true;
  });
  const feed = world.audit_log
    .filter((row) => feedHero === 'all' || row.hero_id === feedHero)
    .slice()
    .reverse();

  async function run(action: () => Promise<void>, ok: string) {
    try {
      await action();
      notice.flash(ok);
    } catch (reason) {
      notice.fail(reason);
    }
  }

  function togglePick(id: string) {
    setPicked((current) => (current.includes(id) ? current.filter((row) => row !== id) : [...current, id]));
  }

  return (
    <div class="page">
      <div class="row spread">
        <h1>Дозор</h1>
        <span class="xs dim">Лента обновляется вместе с листом в этом браузере.</span>
      </div>
      <Notices error={notice.error} toast={notice.toast} />
      <div class="filters">
        <button type="button" class={mode === 'all' ? 'badge solid' : 'badge g'} onClick={() => setMode('all')}>Все</button>
        <button type="button" class={mode === 'table' ? 'badge solid' : 'badge g'} onClick={() => setMode('table')}>Сегодняшний стол</button>
        <button type="button" class={mode === 'pick' ? 'badge solid' : 'badge g'} onClick={() => setMode('pick')}>Выбрать</button>
      </div>
      {mode === 'pick' && (
        <div class="filters">
          {world.heroes.map((hero) => (
            <button key={hero.id} type="button" class={picked.includes(hero.id) ? 'badge solid' : 'badge g'} onClick={() => togglePick(hero.id)}>
              {hero.name}
            </button>
          ))}
        </div>
      )}
      {mode === 'table' && tableIds.length === 0 && <p class="dim">Сегодня за столом никого. Живая сессия или дата сегодня.</p>}

      <div class="watch-table-wrap">
        <table class="watch-table">
          <thead>
            <tr>
              <th>Герой</th>
              <th>Полосы</th>
              <th>Руки</th>
              <th>Броня</th>
              <th>Состояния</th>
              <th>Груз</th>
              <th>Ждут</th>
            </tr>
          </thead>
          <tbody>
            {heroes.map((hero) => {
              const line = heroWatchLine(world, hero);
              return (
                <tr key={hero.id} class={line.flags.length ? 'flagged' : ''}>
                  <td>
                    <a class="salt" href={href(`/hodoki/${hero.slug}`)}>{hero.name}</a>
                    <div class="xs dim">ур. {hero.level}</div>
                  </td>
                  <td class="bars-cell">
                    <Mini hero={hero} />
                  </td>
                  <td>{line.hands}</td>
                  <td>{line.armor}</td>
                  <td>{stateText(hero)}</td>
                  <td>{line.load}</td>
                  <td>{line.pending || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div class="watch-cards">
        {heroes.map((hero) => {
          const line = heroWatchLine(world, hero);
          const pending = pendingRequests(world, hero.id);
          return (
            <article key={hero.id} class={line.flags.length ? 'panel watch-card flagged' : 'panel watch-card'}>
              <div class="row spread">
                <h2>{hero.name}</h2>
                <span class="xs dim">ур. {hero.level}</span>
              </div>
              <Mini hero={hero} />
              <p class="small">Руки: {line.hands}</p>
              <p class="small">Броня: {line.armor}</p>
              <p class="small">Состояния: {stateText(hero)}</p>
              <p class="small">Груз {line.load} · ждут {line.pending}</p>
              <Flags flags={line.flags} />
              <p class="xs dim">Последнее</p>
              <ul class="plain-list xs">
                {recentEvents(world, hero.id).map((event) => (
                  <li key={event.id}>{event.summary}</li>
                ))}
              </ul>
              <div class="actions">
                <a class="btn sm" href={href(`/hodoki/${hero.slug}`)}>Лист</a>
                {pending.slice(0, 2).map((row) => (
                  <span key={row.id} class="decide-inline">
                    <span class="xs">{row.summary}</span>
                    <Decide
                      onDecide={(accept, comment) =>
                        void run(() => store.decideRequest(row.id, accept, comment), accept ? 'Принято' : 'Отклонено')
                      }
                    />
                  </span>
                ))}
              </div>
            </article>
          );
        })}
      </div>

      <div class="watch-flags-desk">
        {heroes.map((hero) => {
          const flags = watchFlags(world, hero);
          if (!flags.length) return null;
          return (
            <div key={hero.id} class="flag-block">
              <b class="salt">{hero.name}</b>
              <Flags flags={flags} />
            </div>
          );
        })}
      </div>

      <section class="panel feed">
        <div class="row spread">
          <div class="ptitle">Лента</div>
          <select value={feedHero} onChange={(event) => setFeedHero((event.currentTarget as HTMLSelectElement).value)}>
            <option value="all">Все герои</option>
            {world.heroes.map((hero) => (
              <option key={hero.id} value={hero.id}>{hero.name}</option>
            ))}
          </select>
        </div>
        <ul class="feed-list">
          {feed.slice(0, 40).map((event) => {
            const who = world.heroes.find((hero) => hero.id === event.hero_id)?.name ?? '';
            return (
              <li key={event.id} class={event.backdated ? 'backdated' : ''}>
                <span class="xs dim">{event.at.slice(0, 16).replace('T', ' ')} · {event.actor_label} · {event.source}</span>
                <div>
                  <b>{who}</b> {event.summary}
                  {event.reverted_by && <span class="badge g xs">откатили</span>}
                </div>
                {event.undo && !event.reverted_by && (
                  <button type="button" class="btn ghost sm" onClick={() => void run(() => store.rollbackEvent(event.id), 'Откатили')}>
                    Откатить
                  </button>
                )}
                {event.source === 'player' && event.session_id && !event.reverted_by && (
                  <button type="button" class="btn sm" onClick={() => void run(() => store.confirmEvent(event.id), 'Подтверждено')}>
                    Подтвердить
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function Mini({ hero }: { hero: Hero }) {
  return (
    <div class="mini-bars">
      <span>Зд {hero.health}/{hero.health_max}</span>
      <Bar tone="h" value={Math.min(hero.health, hero.health_max)} max={hero.health_max} />
      <span>Ма {hero.magic}/{hero.magic_max}</span>
      <Bar tone="mg" value={Math.min(hero.magic, hero.magic_max)} max={hero.magic_max} />
      <span>Вы {hero.stamina}/{hero.stamina_max}</span>
      <Bar tone="st" value={Math.min(hero.stamina, hero.stamina_max)} max={hero.stamina_max} />
    </div>
  );
}

function Flags({ flags }: { flags: { code: string; text: string }[] }) {
  if (!flags.length) return null;
  return (
    <ul class="flag-list">
      {flags.map((flag) => (
        <li key={flag.code + flag.text} class="flag">{flag.text}</li>
      ))}
    </ul>
  );
}

function stateText(hero: Hero): string {
  const bits = [...hero.injuries];
  if (hero.death_marks) bits.push(`отметки смерти ${hero.death_marks}`);
  if (hero.status === 'wounded') bits.push('ранен');
  if (hero.status === 'fallen') bits.push('пал');
  return bits.join(', ') || 'нет';
}
