import { useEffect, useRef, useState } from 'preact/hooks';
import { canEditHero, capacitySlots, carryWeight, isGm, itemOf, priceLabel, veilOf, visibleInstances, wieldOf } from '../lib/domain';
import { href } from '../lib/paths';
import { formatQ, formatWeight, mulQ } from '../lib/rational';
import type { ChangeRequest, Item, ItemInstance, ItemKind, World } from '../lib/types';
import { Cells, Decide, Notices, useNotice } from './bits';
import { HandsPanel } from './hands';
import type { LearnedSpell } from '../lib/combat';
import { KindGlyph } from './icons';
import { useCampaign } from './use-campaign';

type Filter = 'all' | 'worn' | 'weapon' | 'potion' | 'ingredient' | 'book';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Всё' },
  { id: 'worn', label: 'Надето' },
  { id: 'weapon', label: 'Оружие' },
  { id: 'potion', label: 'Зелья' },
  { id: 'ingredient', label: 'Травы' },
  { id: 'book', label: 'Книги' },
];

const GROUP_ORDER = ['weapon', 'armor', 'scroll', 'potion', 'ingredient', 'soulgem', 'book', 'misc'] as const;

const GROUP_LABEL: Record<string, string> = {
  weapon: 'Оружие',
  armor: 'Броня',
  potion: 'Зелья',
  ingredient: 'Ингредиенты',
  soulgem: 'Сосуды душ',
  book: 'Книги и записки',
  scroll: 'Свитки',
  tool: 'Прочее',
  misc: 'Прочее',
};

function occupies(item: Item): boolean {
  const wield = wieldOf(item);
  return wield === 'two' || wield === 'bow' || wield === 'crossbow';
}

function groupOf(kind: ItemKind): string {
  if (kind === 'ammo') return 'weapon';
  if (kind === 'note') return 'book';
  if (kind === 'tool') return 'misc';
  if (kind === 'spell_tome' || kind === 'combat_scroll') return 'scroll';
  return kind;
}

function matches(filter: Filter, item: Item, location: ItemInstance['location']): boolean {
  if (filter === 'all') return true;
  if (filter === 'worn') return location === 'worn';
  if (filter === 'weapon') return item.kind === 'weapon' || item.kind === 'ammo';
  if (filter === 'book') return item.kind === 'book' || item.kind === 'note';
  return item.kind === filter;
}

export default function Inventory({ slug }: { slug: string }) {
  const { store, session, world, booting, bootError } = useCampaign();
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [openSwipe, setOpenSwipe] = useState<string | null>(null);
  const [transferFor, setTransferFor] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [target, setTarget] = useState('');
  const [wide, setWide] = useState(false);
  const [learned, setLearned] = useState<LearnedSpell | null>(null);
  const notice = useNotice();

  useEffect(() => {
    const query = window.matchMedia('(min-width: 801px)');
    const apply = () => setWide(query.matches);
    apply();
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, []);

  if (bootError) return <p class="page">{bootError}</p>;
  if (booting || !world || !session) return <p class="page dim">Открываем сумку…</p>;
  const hero = world.heroes.find((row) => row.slug === slug);
  if (!hero) return <p class="page">Такого ходока нет.</p>;
  if (session.role === 'guest') {
    return (
      <p class="page">
        Сумка закрыта для гостя.{' '}
        <a class="gold" href={href(`/hodoki/${slug}`)}>К карточке</a>
      </p>
    );
  }

  const actor = session;
  const editable = canEditHero(actor, hero.id);
  const gm = isGm(actor);
  const instances = visibleInstances(world, actor, hero.id).filter((row) => matchesFilter(world, row, filter));
  const crafts = world.change_requests.filter(
    (row) => row.hero_id === hero.id && row.status === 'pending' && row.kind === 'craft' && (filter === 'all' || filter === 'potion'),
  );
  const grouped = new Map<string, ItemInstance[]>();
  for (const inst of instances) {
    const item = world.items.find((row) => row.id === inst.item_id);
    if (!item) continue;
    const key = groupOf(item.kind);
    grouped.set(key, [...(grouped.get(key) ?? []), inst]);
  }
  const visibleIds = [...instances.map((row) => row.id), ...crafts.map((row) => row.id)];
  const active = selected && visibleIds.includes(selected) ? selected : wide ? (visibleIds[0] ?? null) : null;
  const selectedInst = instances.find((row) => row.id === active) ?? null;
  const selectedCraft = crafts.find((row) => row.id === active) ?? null;

  async function run(action: () => Promise<unknown>, ok?: string) {
    try {
      const message = await action();
      notice.flash(typeof message === 'string' ? message : ok ?? 'Готово');
    } catch (reason) {
      notice.fail(reason);
    }
  }

  const others = world.heroes.filter((row) => row.id !== hero.id && (row.status === 'alive' || row.status === 'wounded'));
  const carry = carryWeight(world, hero);
  const slots = capacitySlots(hero);

  return (
    <div class="page">
      <Notices error={notice.error} toast={notice.toast} />
      <HandsPanel world={world} hero={hero} store={store} editable={editable} />
      <div class="tabs desk-only">
        <a href={href(`/hodoki/${hero.slug}`)}>Лист</a>
        <a href={href(`/hodoki/${hero.slug}`)}>Перки</a>
        <span class="on">Инвентарь</span>
      </div>
      <div class="bag-layout">
        <div class="panel">
          <div class="row spread">
            <div class="filters chips" role="tablist">
              {FILTERS.map((item) => (
                <button key={item.id} type="button" class={filter === item.id ? 'badge solid' : 'badge g'} onClick={() => setFilter(item.id)}>
                  {item.label}
                </button>
              ))}
            </div>
            <span class="dim small hide-sm">Сортировка: по типу</span>
          </div>
          <div class="it hd" aria-hidden="true">
            <span />
            <span>Предмет</span>
            <span />
            <span class="r">Груз</span>
            <span class="r">Цена</span>
          </div>
          <div class="bag-list">
            {GROUP_ORDER.map((group) => {
              const rows = grouped.get(group) ?? [];
              const extra = group === 'potion' ? crafts : [];
              if (!rows.length && !extra.length) return null;
              return (
                <div key={group}>
                  <div class="gh">{GROUP_LABEL[group]}</div>
                  {rows.map((inst) => (
                    <BagRow
                      key={inst.id}
                      world={world}
                      inst={inst}
                      selected={active === inst.id}
                      open={openSwipe === inst.id}
                      onSelect={() => {
                        setSelected(inst.id);
                        setOpenSwipe(null);
                      }}
                      onSwipe={(open) => setOpenSwipe(open ? inst.id : null)}
                      editable={editable}
                      onTransfer={() => {
                        setTransferFor(inst.id);
                        setQty(1);
                        setTarget(others[0]?.id ?? '');
                      }}
                      onDrop={() => run(() => store.requestDrop(inst.id), 'Выброс ждёт мастера')}
                      onSmith={() => { window.location.assign(href(`/hodoki/${slug}/verstak`)); }}
                    />
                  ))}
                  {extra.map((row) => (
                    <div key={row.id}>
                      <button type="button" class={active === row.id ? 'it sel pend' : 'it pend'} onClick={() => setSelected(row.id)}>
                        <span class="eq">◇</span>
                        <span>{String(row.payload.name ?? row.summary)}</span>
                        <span class="dim">ждёт</span>
                        <span class="r">⅓</span>
                        <span class="r dim">—</span>
                      </button>
                      <button type="button" class="mob-row pend" onClick={() => setSelected(row.id)}>
                        <KindGlyph kind="potion" />
                        <span>
                          <b class="salt">{String(row.payload.name ?? row.summary)}</b>
                          <span class="badge xs">ждёт мастера</span>
                          <span class="xs dim block-line">{row.summary}</span>
                        </span>
                      </button>
                    </div>
                  ))}
                </div>
              );
            })}
            {instances.length === 0 && crafts.length === 0 && <p class="dim">В этом отделении пусто.</p>}
          </div>
          <div class="bag-foot">
            <div class="row spread small">
              <span class="asc">
                Груз <b class="salt">{formatQ(carry)} / {slots}</b>{' '}
                <span class="dim">(Выносливость {hero.stamina_max} / 10)</span>
              </span>
              <span class="dim hide-sm">
                Кроны {hero.coin_crowns} · чешуйки {hero.coin_scales} · медка {hero.coin_copper} · расписки {hero.coin_receipts}
              </span>
            </div>
            <Cells used={carry} slots={slots} />
            {cmpOver(carry, slots) && <p class="xs warn">Перегруз: нельзя бежать, проверки ловкости −20.</p>}
          </div>
        </div>

        {(selectedInst || selectedCraft) && (
          <Card
            world={world}
            inst={selectedInst}
            craft={selectedCraft}
            editable={editable}
            gm={gm}
            onClose={() => setSelected(null)}
            onEquip={(worn) => selectedInst && run(() => store.setEquipped(selectedInst.id, worn), worn ? 'Надето' : 'Снято')}
            onUse={() => selectedInst && run(() => store.useItem(selectedInst.id))}
            onDrop={() => selectedInst && run(() => store.requestDrop(selectedInst.id), 'Выброс ждёт мастера')}
            onTransfer={() => {
              if (!selectedInst) return;
              setTransferFor(selectedInst.id);
              setQty(1);
              setTarget(others[0]?.id ?? '');
            }}
            onSmith={() => { window.location.assign(href(`/hodoki/${slug}/verstak`)); }}
            onWithdrawRequest={(id) => run(() => store.withdrawRequest(id), 'Заявку отозвали')}
            onWithdrawTransfer={(id) => run(() => store.withdrawTransfer(id), 'Передачу отозвали')}
            onDecide={(id, accept, comment) => run(() => store.decideRequest(id, accept, comment), accept ? 'Принято' : 'Отклонено')}
            onDecideTransfer={(id, accept, comment) => run(() => store.decideTransfer(id, accept, comment), accept ? 'Передано' : 'Передача отклонена')}
            onTake={(side) => selectedInst && run(() => store.setHand(hero.id, side, { kind: 'item', instanceId: selectedInst.id, grip: 'one' }), side === 'left' ? 'В левой руке' : 'В правой руке')}
            onLearn={() => {
              if (!selectedInst) return;
              void (async () => {
                try {
                  const result = await store.learnSpellTome(selectedInst.id);
                  if (result.learned) setLearned(result.learned);
                  else notice.flash(result.message);
                } catch (reason) {
                  notice.fail(reason);
                }
              })();
            }}
          />
        )}
      </div>

      {learned && (
        <div class="modal-back" onClick={(event) => { if (event.currentTarget === event.target) setLearned(null); }}>
          <div class="modal-card learn-card" role="dialog" aria-labelledby="learned-title">
            <p class="kicker">Свиток знания</p>
            <h2 id="learned-title">Вы выучили</h2>
            <p class="learn-name">{learned.spell}</p>
            <p>{learned.school} · ступень {learned.tier}</p>
            {learned.warning && <p class="gold">{learned.warning}</p>}
            <button type="button" class="btn pri" onClick={() => setLearned(null)}>Закрыть</button>
          </div>
        </div>
      )}
      {transferFor && (
        <div class="modal-back" onClick={(event) => { if (event.currentTarget === event.target) setTransferFor(null); }}>
          <div class="modal-card" role="dialog" aria-labelledby="transfer-title">
          <h2 id="transfer-title">Передать</h2>
          <p class="small">
            В этом срезе нет живого стола, поэтому передача всегда ждёт мастера. Вещь уходит в «в передаче»: её нельзя выпить и отдать второй раз, пока мастер не решит.
          </p>
          <form
            class="form"
            onSubmit={(event) => {
              event.preventDefault();
              const id = transferFor;
              void (async () => {
                try {
                  await store.requestTransfer(id, target, qty);
                  notice.flash('Передача ждёт мастера');
                  setTransferFor(null);
                } catch (reason) {
                  notice.fail(reason);
                }
              })();
            }}
          >
            <label>
              Кому
              <select value={target} onChange={(event) => setTarget((event.currentTarget as HTMLSelectElement).value)}>
                {others.map((row) => (
                  <option key={row.id} value={row.id}>{row.name}</option>
                ))}
              </select>
            </label>
            <label>
              Сколько
              <input
                type="number"
                min={1}
                max={world.item_instances.find((row) => row.id === transferFor)?.qty ?? 1}
                value={qty}
                onInput={(event) => setQty(Number((event.currentTarget as HTMLInputElement).value))}
              />
            </label>
            <div class="actions">
              <button class="btn pri" type="submit">В очередь мастеру</button>
              <button class="btn ghost" type="button" onClick={() => setTransferFor(null)}>Отмена</button>
            </div>
          </form>
          </div>
        </div>
      )}
    </div>
  );
}

function matchesFilter(world: World, inst: ItemInstance, filter: Filter): boolean {
  const item = world.items.find((row) => row.id === inst.item_id);
  if (!item) return false;
  return matches(filter, item, inst.location);
}

function cmpOver(used: { n: number; d: number }, slots: number): boolean {
  return used.n > slots * used.d;
}

function BagRow({
  world,
  inst,
  selected,
  open,
  onSelect,
  onSwipe,
  editable,
  onTransfer,
  onDrop,
  onSmith,
}: {
  world: World;
  inst: ItemInstance;
  selected: boolean;
  open: boolean;
  onSelect: () => void;
  onSwipe: (open: boolean) => void;
  editable: boolean;
  onTransfer: () => void;
  onDrop: () => void;
  onSmith: () => void;
}) {
  const item = itemOf(world, inst);
  const dropWait = world.change_requests.some(
    (row) => row.status === 'pending' && row.payload.action === 'drop' && row.payload.instance_id === inst.id,
  );
  const weight = formatWeight(mulQ(item.weight, inst.qty));
  const name = `${inst.custom_name ?? item.name}${inst.qty > 1 ? ` ×${inst.qty}` : ''}`;
  const detail = item.kind === 'spell_tome'
    ? item.public_desc
    : String(item.props.damage ?? item.props.armor ?? item.props.subtype ?? '');
  const drag = useRef({ x: 0, y: 0, moved: false });
  function pointerDown(event: PointerEvent) {
    drag.current = { x: event.clientX, y: event.clientY, moved: false };
  }
  function pointerUp(event: PointerEvent) {
    const dx = event.clientX - drag.current.x;
    const dy = event.clientY - drag.current.y;
    if (Math.abs(dx) < 24 || Math.abs(dy) > Math.abs(dx)) return;
    drag.current.moved = true;
    onSwipe(dx < 0);
  }
  const pendingLook = dropWait || inst.location === 'in_transfer';
  return (
    <div class={open ? 'swipe open' : 'swipe'}>
      <div class="swipe-actions">
        <button type="button" class="btn sm" onClick={onTransfer}>Передать</button>
        <button type="button" class="btn ghost sm" onClick={onSmith}>В кузню</button>
        <button type="button" class="btn red sm" onClick={onDrop}>Выбросить</button>
      </div>
      <div class="swipe-face">
      <button
        type="button"
        class={selected ? 'it sel' : pendingLook ? 'it pend' : 'it'}
        onClick={() => {
          if (drag.current.moved) return;
          onSelect();
        }}
        onPointerDown={pointerDown}
        onPointerUp={pointerUp}
      >
        <span class={inst.location === 'worn' ? 'eq' : 'eq dim'}>{inst.location === 'worn' ? '◆' : ''}</span>
        <span>
          {name}{' '}
          {inst.location === 'in_transfer' && <span class="badge xs">в передаче</span>}
          {dropWait && <span class="badge xs">выбросить</span>}
          {item.kind === 'book' && <span class="badge xs">книга</span>}
        </span>
        <span class="dim">{detail}</span>
        <span class="r">{weight}</span>
        <span class="r dim">{priceLabel(item, inst.qty)}</span>
      </button>
      <button
        type="button"
        class={pendingLook ? 'mob-row pend' : selected ? 'mob-row sel' : 'mob-row'}
        onClick={() => {
          if (drag.current.moved) return;
          onSelect();
        }}
        onPointerDown={pointerDown}
        onPointerUp={pointerUp}
      >
        <KindGlyph kind={item.kind} />
        <span>
          <b class="salt">{name}</b>{' '}
          {inst.location === 'worn' && <span class="badge ok xs">надет</span>}
          {inst.location === 'in_transfer' && <span class="badge xs">ждёт мастера</span>}
          {dropWait && <span class="badge xs">выбросить · ждёт</span>}
          <span class="xs dim block-line">
            {detail ? `${detail} · ` : ''}груз {weight}
            {editable ? '' : ' · чужая сумка'}
          </span>
        </span>
      </button>
      </div>
    </div>
  );
}

function Card({
  world,
  inst,
  craft,
  editable,
  gm,
  onClose,
  onEquip,
  onUse,
  onDrop,
  onTransfer,
  onSmith,
  onWithdrawRequest,
  onWithdrawTransfer,
  onDecide,
  onDecideTransfer,
  onTake,
  onLearn,
}: {
  world: World;
  inst: ItemInstance | null;
  craft: ChangeRequest | null;
  editable: boolean;
  gm: boolean;
  onClose: () => void;
  onEquip: (worn: boolean) => void;
  onUse: () => void;
  onDrop: () => void;
  onTransfer: () => void;
  onSmith: () => void;
  onWithdrawRequest: (id: string) => void;
  onWithdrawTransfer: (id: string) => void;
  onDecide: (id: string, accept: boolean, comment: string) => void;
  onDecideTransfer: (id: string, accept: boolean, comment: string) => void;
  onTake: (side: 'left' | 'right') => void;
  onLearn: () => void;
}) {
  if (craft && !inst) {
    return (
      <aside class="panel item-card mobile-sheet">
        <div class="grab" />
        <div class="card-pad">
          <div class="row spread">
            <h2>{String(craft.payload.name ?? craft.summary)}</h2>
            <span class="badge">ждёт мастера</span>
          </div>
          <p>{String(craft.payload.public_desc ?? craft.summary)}</p>
          <p class="xs dim">Пока мастер не примет, зелья в сумке нет.</p>
          {editable && <button type="button" class="btn ghost" onClick={() => onWithdrawRequest(craft.id)}>Отозвать</button>}
          {gm && <Decide onDecide={(accept, comment) => onDecide(craft.id, accept, comment)} />}
          <button type="button" class="btn ghost sm mob-skill" onClick={onClose}>Закрыть</button>
        </div>
      </aside>
    );
  }
  if (!inst) return null;
  const item = itemOf(world, inst);
  const effect = item.props.effect && typeof item.props.effect === 'object';
  const drop = world.change_requests.find((row) => row.status === 'pending' && row.payload.action === 'drop' && row.payload.instance_id === inst.id);
  const transfer = world.transfers.find((row) => row.status === 'pending' && row.instance_id === inst.id);
  const worn = inst.location === 'worn';
  const fields: { k: string; v: string }[] = [];
  const props = item.props;
  if (typeof props.skill === 'string') fields.push({ k: 'Навык', v: props.skill });
  if (typeof props.special === 'string') fields.push({ k: 'Особое', v: props.special });
  if (typeof props.enchant === 'string') fields.push({ k: 'Чары', v: props.enchant });
  if (typeof props.origin === 'string') fields.push({ k: 'Откуда', v: props.origin });
  return (
    <aside class="panel gl item-card mobile-sheet">
      <div class="grab" />
      <div class="art" aria-hidden="true">
        {item.id === 'bow-harpoon' ? <BowArt /> : <KindGlyph kind={item.kind} />}
      </div>
      <div class="card-pad">
        <div class="row spread">
          <h2>{inst.custom_name ?? item.name}</h2>
          {worn && <span class="badge ok">надет</span>}
          {inst.location === 'in_transfer' && <span class="badge">в передаче</span>}
          {drop && <span class="badge">к выбросу</span>}
        </div>
        <p class="small dim">{GROUP_LABEL[groupOf(item.kind)] ?? item.kind}{typeof props.subtype === 'string' ? ` · ${props.subtype}` : ''}</p>
        <div class="kv-row">
          <div class="kv"><span>{typeof props.damage === 'string' ? 'Урон' : typeof props.armor === 'string' ? 'Броня' : 'Суть'}</span><b>{String(props.damage ?? props.armor ?? '—')}</b></div>
          <div class="kv"><span>Качество</span><b>{String(props.quality ?? '—')}</b></div>
          <div class="kv"><span>Груз</span><b>{formatWeight(mulQ(item.weight, inst.qty))}</b></div>
          <div class="kv"><span>Цена</span><b>{priceLabel(item, inst.qty)}</b></div>
        </div>
        <p class="small">{item.public_desc}</p>
        {fields.length > 0 && (
          <table class="prop-table small">
            <tbody>
              {fields.map((field) => (
                <tr key={field.k}><td class="k">{field.k}</td><td>{field.v}</td></tr>
              ))}
            </tbody>
          </table>
        )}
        {item.kind === 'spell_tome' && <p class="xs dim">{veilOf(item).hint}</p>}
        {editable && inst.location !== 'in_transfer' && !drop && (
          <div class="actions">
            {item.kind === 'spell_tome' && (
              <button type="button" class="btn pri" onClick={onLearn}>Прочесть и выучить</button>
            )}
            {wieldOf(item) && wieldOf(item) !== 'shield' && !occupies(item) && (
              <>
                <button type="button" class="btn" onClick={() => onTake('left')}>Взять в левую</button>
                <button type="button" class="btn" onClick={() => onTake('right')}>Взять в правую</button>
              </>
            )}
            {wieldOf(item) === 'shield' && (
              <button type="button" class="btn" onClick={() => onTake('left')}>Взять в левую</button>
            )}
            {occupies(item) && (
              <button type="button" class="btn" onClick={() => onTake('right')}>В обе руки</button>
            )}
            {item.kind === 'armor' && !wieldOf(item) && (
              <button type="button" class="btn" onClick={() => onEquip(!worn)}>{worn ? 'Снять' : 'Надеть'}</button>
            )}
            {effect && <button type="button" class="btn pri" onClick={onUse}>Выпить</button>}
            <button type="button" class="btn ghost" onClick={onTransfer}>Передать…</button>
            <button type="button" class="btn ghost" onClick={onSmith}>В кузню</button>
            <button type="button" class="btn ghost" onClick={onDrop} disabled={worn}>Выбросить</button>
          </div>
        )}
        {editable && drop && <button type="button" class="btn ghost" onClick={() => onWithdrawRequest(drop.id)}>Отозвать выброс</button>}
        {editable && transfer && <button type="button" class="btn ghost" onClick={() => onWithdrawTransfer(transfer.id)}>Отозвать передачу</button>}
        {gm && drop && <Decide onDecide={(accept, comment) => onDecide(drop.id, accept, comment)} />}
        {gm && transfer && <Decide onDecide={(accept, comment) => onDecideTransfer(transfer.id, accept, comment)} />}
        {!editable && <p class="xs dim">Чужая сумка. Надеть, выпить и отдать может только хозяин.</p>}
        {worn && editable && <p class="xs dim">Сначала снимите — потом можно передать или выбросить.</p>}
        <p class="xs dim">Передача и выброс ждут мастера. Надеть, снять и выпить зелье — сразу.</p>
        <button type="button" class="btn ghost sm mob-skill" onClick={onClose}>Закрыть</button>
      </div>
    </aside>
  );
}

function BowArt() {
  return (
    <svg viewBox="0 0 440 210" aria-hidden="true">
      <path d="M40 180 Q220 -60 400 180" fill="none" stroke="#8a6a3e" stroke-width="12" stroke-linecap="round" />
      <path d="M40 180 Q220 -60 400 180" fill="none" stroke="#c09a62" stroke-width="3" stroke-linecap="round" opacity="0.6" />
      <path d="M190 72 h60 v24 h-60z" fill="#3a2a1b" stroke="#cfc4a2" stroke-width="1" />
      <path d="M198 76 l44 16 M198 92 l44 -16" stroke="#7b5a35" stroke-width="2" />
      <line x1="60" y1="150" x2="400" y2="150" stroke="#b8b1a0" stroke-width="3" />
      <path d="M400 150 l-16 -8 l5 8 l-5 8z" fill="#d8d2c4" />
    </svg>
  );
}
