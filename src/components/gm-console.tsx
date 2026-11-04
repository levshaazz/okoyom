import { gmPendingCount, isGm, pendingCountForHero } from '../lib/domain';
import { href } from '../lib/paths';
import { pct } from '../lib/rational';
import { QueueList } from './queue';
import { useCampaign } from './use-campaign';

export default function GmConsole() {
  const { store, session, world, booting, bootError } = useCampaign();
  if (bootError) return <p class="page">{bootError}</p>;
  if (booting || !world || !session) return <p class="page dim">Открываем пульт…</p>;
  if (!isGm(session)) {
    return (
      <div class="page stub">
        <h1>Пульт</h1>
        <p>Мастерская в пробном входе открыта только роли «мастер». Это по-прежнему не защита: данные лежат в браузере.</p>
      </div>
    );
  }
  const pending = gmPendingCount(world);
  const sessionRow = world.sessions[0];
  return (
    <div class="page">
      <div class="row spread">
        <h1>Пульт</h1>
        <span class="dim small">{sessionRow ? `${sessionRow.title} · ${sessionRow.status === 'live' ? 'идёт' : 'не идёт'}` : 'Сессии нет'}</span>
      </div>
      <p class="small dim">Живой стол не подключён, поэтому передача всегда через эту ленту. Заявок в очереди: {pending}.</p>
      <div class="gm-layout">
        <QueueList world={world} session={session} store={store} heroId={null} />
        <div class="stack">
          <div class="panel">
            <div class="ptitle">Герои</div>
            {world.heroes.map((hero) => (
              <a key={hero.id} class="hero-mini" href={href(`/hodoki/${hero.slug}`)}>
                <span class="ava-fallback">{hero.name[0]}</span>
                <span>
                  <b class="salt">{hero.name}</b> <span class="xs dim">ур. {hero.level}</span>
                  <span class="bars3">
                    <i><u class={`pct-${pct(hero.health, hero.health_max)} bar-h`} /></i>
                    <i><u class={`pct-${pct(hero.magic, hero.magic_max)} bar-m`} /></i>
                    <i><u class={`pct-${pct(hero.stamina, hero.stamina_max)} bar-s`} /></i>
                  </span>
                </span>
                <span class="badge xs">{pendingCountForHero(world, hero.id) || '—'}</span>
              </a>
            ))}
          </div>
          <div class="panel">
            <div class="ptitle">Быстро</div>
            <div class="stack">
              <a class="btn" href={href('/master/vydat')}>Выдать предмет</a>
              <span class="btn ghost" title="Появится с сервером">Записка — позже</span>
              <span class="btn ghost" title="Появится с сервером">Туман карты — позже</span>
            </div>
            <p class="xs dim">Часы мира в этот репозиторий не кладём. Игрокам на главной видны только приметы.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
