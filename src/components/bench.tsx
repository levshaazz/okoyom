import { useState } from 'preact/hooks';
import { EFFECTS, SMITH_RECIPES, SMITH_TIERS } from '../data/craft';
import { benchView } from '../lib/craft';
import type { CraftOrder } from '../lib/craft';
import { canEditHero } from '../lib/domain';
import { href } from '../lib/paths';
import { Notices, useNotice } from './bits';
import { useCampaign } from './use-campaign';

type Station = 'alchemy' | 'smith' | 'enchant';

export default function Bench({ slug }: { slug: string }) {
  const { store, session, world, booting } = useCampaign();
  const [station, setStation] = useState<Station>('alchemy');
  const [picked, setPicked] = useState<string[]>([]);
  const [tier, setTier] = useState(1);
  const notice = useNotice();

  if (booting || !world || !session) return <p class="page dim">Открываем верстак…</p>;
  const hero = world.heroes.find((row) => row.slug === slug);
  if (!hero) return <p class="page">Такого ходока нет.</p>;
  const view = benchView(world, session, hero.id);
  if (!view) {
    return (
      <div class="page">
        <h1>Верстак закрыт</h1>
        <p>Свойства, рецепты и чары видны только самому герою и мастеру.</p>
      </div>
    );
  }
  const editable = canEditHero(session, hero.id) && view.canCraft;
  const pending = world.change_requests.filter((row) => row.hero_id === hero.id && row.kind === 'craft' && row.status === 'pending');

  function toggle(id: string) {
    setPicked((list) => (list.includes(id) ? list.filter((row) => row !== id) : list.length >= 3 ? list : [...list, id]));
  }

  async function send(order: CraftOrder) {
    try {
      await store.requestCraft(hero!.id, order);
      notice.flash('Заявка ждёт мастера');
      setPicked([]);
    } catch (reason) {
      notice.fail(reason);
    }
  }

  const gems = world.item_instances.filter((inst) => inst.owner_hero_id === hero.id && inst.location === 'bag' && world.items.find((item) => item.id === inst.item_id)?.kind === 'soulgem');
  const gear = world.item_instances.filter((inst) => {
    if (inst.owner_hero_id !== hero.id || inst.location !== 'bag') return false;
    const item = world.items.find((row) => row.id === inst.item_id);
    return item?.kind === 'weapon' || item?.kind === 'armor';
  });
  const ingots = world.item_instances.filter((inst) => inst.owner_hero_id === hero.id && inst.location === 'bag' && world.items.find((item) => item.id === inst.item_id)?.props.craft === 'ingot');

  return (
    <div class="page bench">
      <div class="row spread">
        <h1>Верстак · {hero.name}</h1>
        <a class="btn ghost sm" href={href(`/hodoki/${slug}/sumka`)}>К сумке</a>
      </div>
      <p class="dim small">Даунтайм: {view.downtime}. Каждая заявка — одно действие, тяжёлая броня — два. Мастер принимает, и вещь появляется в сумке. Пачка «пять варок за действие» — заглушка до сервера.</p>
      <Notices error={notice.error} toast={notice.toast} />
      <div class="filters">
        {([['alchemy', 'Алхимия'], ['smith', 'Кузня'], ['enchant', 'Зачарование']] as const).map(([id, label]) => (
          <button key={id} type="button" class={station === id ? 'badge solid' : 'badge g'} onClick={() => { setStation(id); setPicked([]); }}>{label}</button>
        ))}
      </div>

      {station === 'alchemy' && (
        <section class="panel">
          <div class="ptitle">Стол алхимика</div>
          <ul class="plain-list">
            {view.ingredients.map((row) => (
              <li key={row.instanceId}>
                <button type="button" class={picked.includes(row.instanceId) ? 'btn' : 'btn ghost'} onClick={() => toggle(row.instanceId)}>
                  {row.name} ×{row.qty}
                </button>
                <span class="xs dim"> {row.known.map((name) => name ?? '?').join(' · ')}</span>
              </li>
            ))}
            {view.ingredients.length === 0 && <li class="dim">В сумке нет ингредиентов.</li>}
          </ul>
          {editable && (
            <div class="actions">
              <button type="button" class="btn" disabled={picked.length !== 1} onClick={() => send({ action: 'taste', instanceIds: picked })}>Проба</button>
              <button type="button" class="btn" disabled={picked.length < 2} onClick={() => send({ action: 'experiment', instanceIds: picked })}>Эксперимент</button>
            </div>
          )}
          <div class="ptitle">Рецепты</div>
          {view.recipes.length === 0 && <p class="dim small">Рецепт появляется после удачного эксперимента.</p>}
          {view.recipes.map((recipe) => (
            <p key={recipe.ref} class="small">{recipe.ref} · {recipe.detail.split(',').map((code) => EFFECTS[code]?.name ?? code).join(', ')}</p>
          ))}
        </section>
      )}

      {station === 'smith' && (
        <section class="panel">
          <div class="ptitle">Горн</div>
          <div class="filters">
            {SMITH_TIERS.map((row) => (
              <button key={row.tier} type="button" class={tier === row.tier ? 'badge solid' : 'badge g'} onClick={() => setTier(row.tier)}>{row.label}</button>
            ))}
          </div>
          <div class="actions">
            {SMITH_RECIPES.map((recipe) => (
              <button key={recipe.id} type="button" class="btn" disabled={!editable} onClick={() => send({ action: 'smith', recipeId: recipe.id, tier })}>
                {recipe.name} · {recipe.actions === 2 ? '2 действия' : '1 действие'}
              </button>
            ))}
          </div>
          <p class="dim small">Слитков в сумке: {ingots.reduce((sum, row) => sum + row.qty, 0)}.</p>
          <div class="ptitle">Улучшение</div>
          {gear.map((inst) => {
            const item = world.items.find((row) => row.id === inst.item_id)!;
            return (
              <p key={inst.id}>
                <button type="button" class="btn ghost sm" disabled={!editable || ingots.length === 0} onClick={() => send({ action: 'improve', instanceIds: [inst.id, ingots[0]!.id] })}>
                  Точить: {item.name}
                </button>
              </p>
            );
          })}
        </section>
      )}

      {station === 'enchant' && (
        <section class="panel">
          <div class="ptitle">Стол чар</div>
          <p class="small">Изученные чары: {view.charms.length ? view.charms.map((row) => row.name).join(', ') : 'пока нет. Расколдуйте вещь.'}</p>
          {gear.map((inst) => {
            const item = world.items.find((row) => row.id === inst.item_id)!;
            const charm = inst.props.charm ?? item.props.charm;
            return (
              <p key={inst.id} class="small">
                {item.name}
                {charm && editable && (
                  <button type="button" class="btn ghost sm" onClick={() => send({ action: 'disenchant', instanceIds: [inst.id] })}>Расколдовать</button>
                )}
                {!charm && editable && view.charms[0] && gems.some((gem) => gem.props.filled === true || world.items.find((row) => row.id === gem.item_id)?.props.filled === true) && (
                  <button type="button" class="btn ghost sm" onClick={() => {
                    const gem = gems.find((row) => row.props.filled === true || world.items.find((itemRow) => itemRow.id === row.item_id)?.props.filled === true);
                    if (!gem) return;
                    void send({ action: 'enchant', instanceIds: [inst.id, gem.id], charmId: view.charms[0]!.id });
                  }}>Наложить {view.charms[0].name}</button>
                )}
              </p>
            );
          })}
          <p class="dim small">Сосудов в сумке: {gems.length}. На стол кладут наполненный.</p>
        </section>
      )}

      <section>
        <div class="ptitle">Ждёт мастера</div>
        {pending.length === 0 && <p class="dim small">Заявок нет.</p>}
        {pending.map((row) => <p key={row.id} class="pend small">{row.summary}</p>)}
      </section>
    </div>
  );
}
