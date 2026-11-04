import { useState } from 'preact/hooks';
import { canEditHero, describeFill, handHints } from '../lib/domain';
import type { HandFill, HandSide, Hero, World } from '../lib/types';
import type { DataStore } from '../lib/store';
import { Notices, useNotice } from './bits';

function Palm({ side }: { side: HandSide }) {
  return (
    <svg class="hand-svg" viewBox="0 0 64 72" aria-hidden="true">
      <g transform={side === 'left' ? 'translate(64 0) scale(-1 1)' : undefined}>
        <path d="M24 66 V34" />
        <path d="M24 40 c-10-1-14-14-6-18" />
        <path d="M30 66 V24 c0-8 12-8 12 2 v22" />
        <path d="M42 28 c1-10 12-8 11 2 v18" />
        <path d="M50 32 c1-8 10-6 8 3 v14" />
        <path d="M18 46 h28 v16 h-28z" />
      </g>
    </svg>
  );
}

export function HandsPanel({
  world,
  hero,
  store,
  editable,
}: {
  world: World;
  hero: Hero;
  store: DataStore;
  editable: boolean;
}) {
  const notice = useNotice();
  const [name, setName] = useState('');
  const spells = world.spells.filter((row) => row.hero_id === hero.id);
  const both =
    hero.hands.left?.kind === 'item' &&
    hero.hands.right?.kind === 'item' &&
    hero.hands.left.grip === 'both' &&
    hero.hands.left.instanceId === hero.hands.right.instanceId;
  const hints = handHints(world, hero);

  async function run(action: () => Promise<void>, ok: string) {
    try {
      await action();
      notice.flash(ok);
    } catch (reason) {
      notice.fail(reason);
    }
  }

  function putSpell(side: HandSide, spell: string) {
    const fill: HandFill = spell ? { kind: 'spell', spell } : null;
    void run(() => store.setHand(hero.id, side, fill), spell ? 'Заклинание в руке' : 'Рука свободна');
  }

  return (
    <div class="panel hands-panel">
      <Notices error={notice.error} toast={notice.toast} />
      <div class="ptitle">В руках</div>
      <div class={both ? 'hands both' : 'hands'}>
        {both ? (
          <div class="hand-cell">
            <Palm side="right" />
            <div class="xs dim">обе</div>
            <b>{describeFill(world, hero.hands.left)}</b>
            {editable && (
              <button type="button" class="btn ghost sm" onClick={() => void run(() => store.setHand(hero.id, 'left', null), 'Руки свободны')}>
                Убрать
              </button>
            )}
          </div>
        ) : (
          (['left', 'right'] as const).map((side) => (
            <div key={side} class="hand-cell">
              <Palm side={side} />
              <div class="xs dim">{side === 'left' ? 'левая' : 'правая'}</div>
              <b>{describeFill(world, hero.hands[side])}</b>
              {editable && hero.hands[side] && (
                <button type="button" class="btn ghost sm" onClick={() => void run(() => store.setHand(hero.id, side, null), 'Рука свободна')}>
                  Убрать
                </button>
              )}
              {editable && spells.length > 0 && (
                <label class="hand-spell">
                  Заклинание
                  <select
                    value={hero.hands[side]?.kind === 'spell' ? hero.hands[side].spell : ''}
                    onChange={(event) => putSpell(side, (event.currentTarget as HTMLSelectElement).value)}
                  >
                    <option value="">не в руке</option>
                    {spells.map((spell) => (
                      <option key={spell.spell} value={spell.spell}>
                        {spell.spell}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          ))
        )}
      </div>
      {hints.length > 0 && (
        <ul class="hint-list">
          {hints.map((hint) => (
            <li key={hint}>{hint}</li>
          ))}
        </ul>
      )}
      <div class="ptitle">Избранное</div>
      <div class="favs">
        {hero.loadouts.map((set) => (
          <span key={set.id} class="fav">
            <button type="button" class="btn sm" disabled={!editable} onClick={() => void run(() => store.applyLoadout(hero.id, set.id), `Набор «${set.name}»`)}>
              {set.name}
            </button>
            {editable && (
              <button type="button" class="btn ghost sm" aria-label={`Стереть набор ${set.name}`} onClick={() => void run(() => store.deleteLoadout(hero.id, set.id), 'Набор стёрт')}>
                ×
              </button>
            )}
          </span>
        ))}
        {hero.loadouts.length === 0 && <span class="xs dim">Наборов нет. Можно запомнить до четырёх.</span>}
      </div>
      {editable && hero.loadouts.length < 4 && (
        <form
          class="fav-form"
          onSubmit={(event) => {
            event.preventDefault();
            const title = name;
            void run(async () => {
              await store.saveLoadout(hero.id, title);
              setName('');
            }, 'Набор запомнен');
          }}
        >
          <input
            value={name}
            maxLength={24}
            placeholder="Имя набора"
            aria-label="Имя набора"
            onInput={(event) => setName((event.currentTarget as HTMLInputElement).value)}
          />
          <button class="btn sm" type="submit">Запомнить</button>
        </form>
      )}
    </div>
  );
}

export function canEditHands(session: { role: 'guest' | 'player' | 'gm'; heroId: string | null; preview: boolean }, heroId: string): boolean {
  return canEditHero(session, heroId);
}
