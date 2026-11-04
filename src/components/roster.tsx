import { isGm, pendingCountForHero } from '../lib/domain';
import { href } from '../lib/paths';
import { pct } from '../lib/rational';
import { useCampaign } from './use-campaign';

export default function Roster({ variant }: { variant: 'party' | 'gm' }) {
  const { world, session, booting, bootError } = useCampaign();
  if (bootError) return <p class="page">{bootError}</p>;
  if (booting || !world || !session) return <p class="page dim">Открываем ходоков…</p>;
  if (variant === 'gm' && !isGm(session)) {
    return (
      <div class="page stub">
        <h1>Герои</h1>
        <p>Список мастерской открыт роли «мастер» в пробном входе.</p>
        <p><a class="gold" href={href('/hodoki')}>Общие карточки</a></p>
      </div>
    );
  }
  const member = session.role !== 'guest';
  return (
    <div class="page">
      <h1>{variant === 'gm' ? 'Герои' : 'Ходоки'}</h1>
      <p class="dim small">
        {member
          ? 'Полный лист открыт вошедшим. Дар чужого героя всё равно скрыт.'
          : 'Гость видит карточку: имя, народ, уровень и «в строю».'}
      </p>
      <div class="roster">
        {world.heroes.map((hero) => {
          const state = hero.status === 'fallen' ? 'пал' : hero.status === 'retired' ? 'отошёл' : hero.status === 'wounded' && member ? 'ранен' : 'в строю';
          return (
            <a key={hero.id} class="panel card" href={href(`/hodoki/${hero.slug}`)}>
              <div class="shot">
                {hero.portrait_path ? <img src={href(hero.portrait_path)} alt="" /> : <span>{hero.name[0]}</span>}
              </div>
              <div class="meta">
                <h2>{hero.name}</h2>
                <p class="small dim">{hero.people} · уровень {hero.level} · {state}</p>
                {member && (
                  <span class="bars3">
                    <i><u class={`pct-${pct(hero.health, hero.health_max)} bar-h`} /></i>
                    <i><u class={`pct-${pct(hero.magic, hero.magic_max)} bar-m`} /></i>
                    <i><u class={`pct-${pct(hero.stamina, hero.stamina_max)} bar-s`} /></i>
                  </span>
                )}
                {variant === 'gm' && <p class="xs dim">ждут: {pendingCountForHero(world, hero.id)}</p>}
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}
