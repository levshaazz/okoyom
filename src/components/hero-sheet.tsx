import { useState } from 'preact/hooks';
import { openSwitcher } from '../lib/browser-store';
import {
  canEditHero,
  canSeeSecrets,
  capacitySlots,
  carryWeight,
  isGm,
  pendingMarkCount,
  pendingRequests,
} from '../lib/domain';
import { formatWhen } from '../lib/format';
import { href } from '../lib/paths';
import { formatQ, pct } from '../lib/rational';
import { SKILL_GROUPS } from '../lib/skills';
import type { ChangeRequest, Hero, World } from '../lib/types';
import { Bar, Decide, Notices, Pips, useNotice } from './bits';
import { HandsPanel } from './hands';
import { useCampaign } from './use-campaign';

type Tab = 'list' | 'perks' | 'spells' | 'craft' | 'journal' | 'books' | 'notes' | 'gift' | 'money';

const DESK_TABS: { id: Tab | 'bag'; label: string }[] = [
  { id: 'list', label: 'Лист' },
  { id: 'perks', label: 'Перки' },
  { id: 'spells', label: 'Заклинания' },
  { id: 'bag', label: 'Инвентарь' },
  { id: 'craft', label: 'Ремесло' },
  { id: 'journal', label: 'Журнал' },
  { id: 'books', label: 'Книги' },
  { id: 'notes', label: 'Заметки' },
];

const MOB_TABS: { id: Tab; label: string }[] = [
  { id: 'list', label: 'Навыки' },
  { id: 'perks', label: 'Перки' },
  { id: 'gift', label: 'Дар' },
  { id: 'journal', label: 'Журнал' },
  { id: 'money', label: 'Деньги' },
];

export default function HeroSheet({ slug }: { slug: string }) {
  const { store, session, world, booting, bootError } = useCampaign();
  const [tab, setTab] = useState<Tab>('list');
  const [perkName, setPerkName] = useState('');
  const [perkSkill, setPerkSkill] = useState('Одноручное');
  const [showBase, setShowBase] = useState(false);
  const notice = useNotice();

  if (bootError) return <p class="page">{bootError}</p>;
  if (booting || !world || !session) return <p class="page dim">Открываем лист…</p>;

  const hero = world.heroes.find((row) => row.slug === slug);
  if (!hero) return <p class="page">Такого ходока нет.</p>;
  if (session.role === 'guest') return <GuestCard hero={hero} />;

  const actor = session;
  const editable = canEditHero(actor, hero.id);
  const gm = isGm(actor);
  const secrets = canSeeSecrets(actor, hero.id) ? world.hero_secrets.find((row) => row.hero_id === hero.id) : null;
  const skills = world.skills.filter((row) => row.hero_id === hero.id);
  const perks = world.perks.filter((row) => row.hero_id === hero.id);
  const spells = world.spells.filter((row) => row.hero_id === hero.id);
  const quests = world.quests.filter((row) => row.hero_id === hero.id);
  const requests = world.change_requests.filter((row) => row.hero_id === hero.id);
  const pending = pendingRequests(world, hero.id);
  const perkWait = pending.find((row) => row.kind === 'perk');
  const note = world.notes.find((row) => row.hero_id === hero.id && row.target === 'sheet');
  const books = world.item_instances.filter((row) => {
    if (row.owner_hero_id !== hero.id || row.location === 'ground') return false;
    const item = world.items.find((entry) => entry.id === row.item_id);
    return item?.kind === 'book' || item?.kind === 'note';
  });

  async function run(action: () => Promise<unknown>, ok?: string) {
    try {
      await action();
      if (ok) notice.flash(ok);
      else notice.setError(null);
    } catch (reason) {
      notice.fail(reason);
    }
  }

  function addMark(skill: string) {
    return run(() => store.requestSkillMark(hero!.id, skill), `«${skill}» ждёт мастера`);
  }
  function withdrawMark(skill: string) {
    const rows = requests.filter((row) => row.status === 'pending' && row.kind === 'skill_mark' && row.payload.skill === skill);
    const last = rows[rows.length - 1];
    if (!last) return;
    return run(() => store.withdrawRequest(last.id), 'Заявку отозвали');
  }

  const carry = carryWeight(world, hero);
  const slots = capacitySlots(hero);

  return (
    <div class="page">
      <Notices error={notice.error} toast={notice.toast} />
      <div class="mob-only-block">
        <div class="mob-head">
          {hero.portrait_path ? (
            <img src={href(hero.portrait_path)} alt="" />
          ) : (
            <span class="monogram">{hero.name[0]}</span>
          )}
          <div>
            <h2>{hero.name}</h2>
            <div class="xs dim">
              {hero.people} · ур. {hero.level}
              {hero.tags[1] ? ` · ${hero.tags[1]}` : ''}
            </div>
            <Bar tone="xp" value={hero.xp} max={hero.xp_next} />
            <div class="xs dim">опыт {hero.xp} / {hero.xp_next}</div>
          </div>
        </div>
        <div>
          <MobStat label="Здоровье" value={hero.health} max={hero.health_max} tone="h" />
          <MobStat label="Магия" value={hero.magic} max={hero.magic_max} tone="mg" />
          <MobStat label="Выносл." value={hero.stamina} max={hero.stamina_max} tone="st" />
        </div>
      </div>

      <div class="sheet">
        <div class="stack col-left">
          <div class="panel portrait desk-only">
            {hero.portrait_path ? <img src={href(hero.portrait_path)} alt="" /> : <span class="monogram big">{hero.name[0]}</span>}
            <div class="cap">
              <h2>{hero.name}</h2>
              <div class="small">{hero.people} · {hero.player_label}</div>
            </div>
          </div>
          <div class="panel desk-only">
            <div class="row spread">
              <span class="sc salt">Уровень {hero.level}</span>
              <span class="small dim">опыт {hero.xp} / {hero.xp_next}</span>
            </div>
            <Bar tone="xp" value={hero.xp} max={hero.xp_next} />
            <StatField label="Здоровье" tone="h" value={hero.health} max={hero.health_max} editable={editable} onCommit={(value) => run(() => store.setStat(hero.id, 'health', value))} />
            <StatField label="Магия" tone="mg" value={hero.magic} max={hero.magic_max} editable={editable} onCommit={(value) => run(() => store.setStat(hero.id, 'magic', value))} />
            <StatField label="Выносливость" tone="st" value={hero.stamina} max={hero.stamina_max} editable={editable} onCommit={(value) => run(() => store.setStat(hero.id, 'stamina', value))} />
            <div class="rule" />
            <div class="row spread small">
              <span>Груз <b class="salt">{formatQ(carry)}</b> / {slots}</span>
              <span>
                Отметки смерти <span class="gold">{'◆'.repeat(hero.death_marks)}</span>
                <span class="dim">{'◇'.repeat(Math.max(0, 3 - hero.death_marks))}</span>
              </span>
            </div>
            {!editable && <p class="xs dim">Чужой лист. Полосы правит сам герой — сразу, без очереди.</p>}
          </div>
          <HandsPanel world={world} hero={hero} store={store} editable={editable} />
          {perkWait && (
            <div class="panel pend">
              <div class="small">
                <b class="gold">Очко перка</b> → «{String(perkWait.payload.perk)}»
                <br />
                <span class="dim xs">взято {formatWhen(perkWait.created_at)} · ждёт мастера</span>
              </div>
              {gm && <Decide onDecide={(accept, comment) => run(() => store.decideRequest(perkWait.id, accept, comment), accept ? 'Перк принят' : 'Перк отклонён')} />}
            </div>
          )}
        </div>

        <div class="stack col-main">
          <div class="tabs desk-only" role="tablist">
            {DESK_TABS.map((item) => {
              if (item.id === 'bag') {
                return (
                  <a key={item.id} href={href(`/hodoki/${hero.slug}/sumka`)}>
                    {item.label}
                  </a>
                );
              }
              const id = item.id;
              return (
                <button key={id} type="button" class={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
                  {item.label}
                </button>
              );
            })}
          </div>
          <div class="tabs mob-skill" role="tablist">
            {MOB_TABS.map((item) => (
              <button key={item.id} type="button" class={tab === item.id ? 'on' : ''} onClick={() => setTab(item.id)}>
                {item.label}
              </button>
            ))}
          </div>

          {tab === 'list' && (
            <>
              <div class="panel">
                <div class="ptitle">Навыки</div>
                <div class="skills-desk">
                  {SKILL_GROUPS.map((group) => (
                    <div key={group.id}>
                      <div class="group-label gold">{group.title}</div>
                      {group.skills.map((name) => (
                        <SkillDesk
                          key={name}
                          name={name}
                          value={skills.find((row) => row.skill === name)?.value ?? 15}
                          marks={skills.find((row) => row.skill === name)?.marks ?? 0}
                          pending={pendingMarkCount(world, hero.id, name)}
                          editable={editable}
                          onAdd={() => addMark(name)}
                          onWithdraw={() => withdrawMark(name)}
                        />
                      ))}
                    </div>
                  ))}
                </div>
                <div class="mob-skill">
                  <MobileSkills
                    world={world}
                    heroId={hero.id}
                    showBase={showBase}
                    editable={editable}
                    onAdd={addMark}
                    onWithdraw={withdrawMark}
                    onToggle={() => setShowBase((value) => !value)}
                  />
                </div>
                <p class="xs dim">◆ — отметки за сессию, до трёх. Пунктир ждёт мастера. Рост навыка бросают за столом, сайт кубики не кидает.</p>
              </div>
              <div class="two desk-only">
                <div class="panel"><Journal hero={hero} quests={quests} /></div>
                <div class="panel"><Money hero={hero} carryLabel={formatQ(carry)} slots={slots} /></div>
              </div>
            </>
          )}

          {tab === 'perks' && (
            <div class="panel">
              <div class="ptitle">Перки</div>
              <PerkList perks={perks} pending={pending} gm={gm} editable={editable} storeDecide={(id, accept, comment) => run(() => store.decideRequest(id, accept, comment), accept ? 'Принято' : 'Отклонено')} onWithdraw={(id) => run(() => store.withdrawRequest(id), 'Заявку отозвали')} />
              {editable && (
                <form
                  class="form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void (async () => {
                      try {
                        await store.requestPerk(hero.id, perkName, perkSkill);
                        setPerkName('');
                        notice.flash('Перк ждёт мастера');
                      } catch (reason) {
                        notice.fail(reason);
                      }
                    })();
                  }}
                >
                  <label>
                    Навык
                    <select value={perkSkill} onChange={(event) => setPerkSkill((event.currentTarget as HTMLSelectElement).value)}>
                      {SKILL_GROUPS.flatMap((group) => group.skills).map((name) => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Название перка
                    <input required maxLength={80} value={perkName} onInput={(event) => setPerkName((event.currentTarget as HTMLInputElement).value)} />
                  </label>
                  <button class="btn pri" type="submit">Попросить перк</button>
                  <p class="xs dim">Порог и свободное очко проверяет мастер. Сайт только кладёт заявку в очередь.</p>
                </form>
              )}
            </div>
          )}

          {tab === 'spells' && (
            <div class="panel">
              <div class="ptitle">Заклинания</div>
              {spells.length === 0 && <p class="dim">Заклинаний нет.</p>}
              <ul class="plain-list">
                {spells.map((spell) => (
                  <li key={spell.spell}>
                    <span class="salt">{spell.spell}</span> · {spell.school} · {spell.cost} магии
                  </li>
                ))}
              </ul>
            </div>
          )}

          {tab === 'craft' && (
            <div class="panel">
              <div class="ptitle">Ремесло</div>
              <p>Рецепты, пробы и даунтайм появятся отдельным срезом. Опыт, который уже ждёт мастера, виден в сумке и в очереди.</p>
              {pending.filter((row) => row.kind === 'craft').map((row) => (
                <p key={row.id} class="pend small">{row.summary} · ждёт мастера</p>
              ))}
            </div>
          )}

          {(tab === 'journal' || tab === 'books') && (
            <div class="stack">
              {tab === 'journal' && <div class="panel"><Journal hero={hero} quests={quests} /></div>}
              <div class="panel">
                <div class="ptitle">Книги и записки</div>
                {books.length === 0 && <p class="dim">На руках пусто.</p>}
                <ul class="plain-list">
                  {books.map((row) => {
                    const item = world.items.find((entry) => entry.id === row.item_id);
                    return (
                      <li key={row.id}>
                        <span class="salt">{item?.name}</span>
                        <div class="xs dim">{item?.public_desc}</div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          )}

          {tab === 'notes' && (
            <div class="panel">
              <div class="ptitle">Заметки</div>
              <p class="xs dim">Свободная правка: пишется сразу, мастера не ждёт. Мастер эти заметки видит.</p>
              <textarea
                class="note-box hand"
                disabled={!editable && !gm}
                defaultValue={note?.body ?? ''}
                key={note?.body ?? ''}
                onBlur={(event) => {
                  if (!editable) return;
                  void run(() => store.saveNote(hero.id, (event.currentTarget as HTMLTextAreaElement).value), 'Заметка сохранена');
                }}
              />
            </div>
          )}

          {tab === 'gift' && (
            <div class="panel gift">
              <Gift secrets={secrets} hidden={!canSeeSecrets(actor, hero.id)} />
            </div>
          )}

          {tab === 'money' && (
            <div class="panel">
              <Money hero={hero} carryLabel={formatQ(carry)} slots={slots} />
            </div>
          )}
        </div>

        <div class="stack col-right desk-only">
          <div class="panel gift">
            <Gift secrets={secrets} hidden={!secrets} />
          </div>
          <div class="panel">
            <div class="ptitle">Теги</div>
            <div class="tag-row">
              {hero.tags.map((tag) => (
                <span key={tag} class="badge g">{tag}</span>
              ))}
            </div>
            <div class="ptitle">Способность народа</div>
            <div class="small">
              <b class="salt">{hero.people_ability.name}</b> — {hero.people_ability.text}{' '}
              <span class={hero.people_ability.ready ? 'badge ok xs' : 'badge g xs'}>{hero.people_ability.ready ? 'готово' : 'потрачено'}</span>
            </div>
          </div>
          <div class="panel">
            <div class="ptitle">Перки</div>
            <PerkList perks={perks} pending={pending} gm={gm} editable={editable} storeDecide={(id, accept, comment) => run(() => store.decideRequest(id, accept, comment), accept ? 'Принято' : 'Отклонено')} onWithdraw={(id) => run(() => store.withdrawRequest(id), 'Заявку отозвали')} />
            <div class="xs dim">{hero.injuries.length ? hero.injuries.join(' · ') : 'Травм нет'}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function GuestCard({ hero }: { hero: Hero }) {
  const state = hero.status === 'fallen' ? 'пал' : hero.status === 'retired' ? 'отошёл' : 'в строю';
  return (
    <div class="page">
      <article class="panel guest-card">
        {hero.portrait_path ? <img src={href(hero.portrait_path)} alt="" /> : <div class="monogram big">{hero.name[0]}</div>}
        <h1>{hero.name}</h1>
        <p>{hero.people} · уровень {hero.level}</p>
        <p class="gold">{state}</p>
        {hero.status === 'fallen' && hero.epitaph && <p class="hand">{hero.epitaph}</p>}
        <p class="small dim">Полный лист — здоровье, навыки, сумка, Дар — виден только ходокам кампании.</p>
        <button type="button" class="btn pri" onClick={() => openSwitcher()}>Войти героем</button>
      </article>
    </div>
  );
}

function MobStat({ label, value, max, tone }: { label: string; value: number; max: number; tone: 'h' | 'mg' | 'st' }) {
  return (
    <div class="mob-stat">
      <span>{label}</span>
      <Bar tone={tone} value={value} max={max} />
      <span class="dim xs">{value}/{max}</span>
    </div>
  );
}

function StatField({
  label,
  tone,
  value,
  max,
  editable,
  onCommit,
}: {
  label: string;
  tone: 'h' | 'mg' | 'st';
  value: number;
  max: number;
  editable: boolean;
  onCommit: (value: number) => void;
}) {
  return (
    <>
      <div class="stat">
        <span>{label}</span>
        <span class="stat-val">
          {editable && (
            <button type="button" class="step" aria-label={`Меньше: ${label}`} onClick={() => onCommit(value - 1)}>−</button>
          )}
          {editable ? (
            <input
              aria-label={label}
              inputMode="numeric"
              defaultValue={String(value)}
              key={value}
              onBlur={(event) => {
                const next = Number((event.currentTarget as HTMLInputElement).value);
                if (Number.isFinite(next)) onCommit(next);
              }}
            />
          ) : (
            <b>{value}</b>
          )}
          <small>/ {max}</small>
          {editable && (
            <button type="button" class="step" aria-label={`Больше: ${label}`} onClick={() => onCommit(value + 1)}>+</button>
          )}
        </span>
      </div>
      <Bar tone={tone} value={value} max={max} />
    </>
  );
}

function Marks({
  name,
  marks,
  pending,
  editable,
  onAdd,
  onWithdraw,
}: {
  name: string;
  marks: number;
  pending: number;
  editable: boolean;
  onAdd: () => void;
  onWithdraw: () => void;
}) {
  const nodes = [];
  for (let i = 0; i < 3; i++) {
    const state = i < marks ? 'on' : i < marks + pending ? 'wait' : '';
    if (!editable || state === 'on') nodes.push(<i key={i} class={`mk ${state}`} />);
    else {
      nodes.push(
        <button
          key={i}
          type="button"
          class={`mk ${state}`}
          aria-label={state === 'wait' ? `Снять заявку: ${name}` : `Отметить навык ${name}`}
          onClick={state === 'wait' ? onWithdraw : onAdd}
        />,
      );
    }
  }
  return <span class="mks">{nodes}</span>;
}

function SkillDesk(props: {
  name: string;
  value: number;
  marks: number;
  pending: number;
  editable: boolean;
  onAdd: () => void;
  onWithdraw: () => void;
}) {
  const raised = props.value > 15 || props.marks > 0 || props.pending > 0;
  return (
    <div class="sk">
      <span class={raised ? 'salt' : ''}>{props.name}</span>
      <Marks {...props} />
      <b>{props.value}</b>
      <div class="sbar"><i class={`pct-${pct(props.value, 100)}`} /></div>
    </div>
  );
}

function MobileSkills({
  world,
  heroId,
  showBase,
  editable,
  onAdd,
  onWithdraw,
  onToggle,
}: {
  world: World;
  heroId: string;
  showBase: boolean;
  editable: boolean;
  onAdd: (skill: string) => void;
  onWithdraw: (skill: string) => void;
  onToggle: () => void;
}) {
  const rows = world.skills
    .filter((row) => row.hero_id === heroId)
    .map((row) => ({ ...row, pending: pendingMarkCount(world, heroId, row.skill) }))
    .sort((a, b) => b.value - a.value || a.skill.localeCompare(b.skill, 'ru'));
  const base = rows.filter((row) => row.value === 15 && row.marks === 0 && row.pending === 0);
  const shown = showBase ? rows : rows.filter((row) => !base.includes(row));
  return (
    <div>
      {shown.map((row) => {
        const diamonds = '◆'.repeat(row.marks) + (row.pending ? '◇'.repeat(row.pending) : '');
        return (
          <div key={row.skill}>
            <button
              type="button"
              class="s-line"
              onClick={() => {
                if (!editable) return;
                if (row.marks + row.pending >= 3) {
                  if (row.pending) onWithdraw(row.skill);
                  return;
                }
                onAdd(row.skill);
              }}
            >
              <span>{row.skill}</span>
              <b>{row.value}</b>
              <span class="bar xp"><i class={`pct-${pct(row.value, 100)}`} /></span>
              <em>{diamonds}</em>
            </button>
          </div>
        );
      })}
      {base.length > 0 && (
        <button type="button" class="btn ghost sm" onClick={onToggle}>
          {showBase ? 'Скрыть базовые' : `ещё ${base.length} навыков по 15`}
        </button>
      )}
      <p class="xs dim">Нажатие ставит отметку в очередь. На полном навыке нажатие снимает ожидающую.</p>
    </div>
  );
}

function Journal({ hero, quests }: { hero: Hero; quests: World['quests'] }) {
  return (
    <div>
      <div class="ptitle">Журнал</div>
      {quests.map((quest) => (
        <div key={quest.id} class="small">
          <span class="salt">{quest.title}</span> {quest.status === 'active' && <span class="badge g xs">активный</span>}
          <ul class="plain-list">
            {quest.steps.map((step) => (
              <li key={step.text}>{step.done ? '☑' : '☐'} {step.text}</li>
            ))}
          </ul>
          {quest.margin && <div class="hand gold">{quest.margin}</div>}
        </div>
      ))}
      <p class="xs dim">Даунтайм: <b class="salt">{hero.downtime}</b> действия · {hero.downtime_label}</p>
    </div>
  );
}

function Money({ hero, carryLabel, slots }: { hero: Hero; carryLabel: string; slots: number }) {
  return (
    <div>
      <div class="ptitle">Деньги</div>
      <div class="money small">
        <span>Кроны</span><b class="gold">{hero.coin_crowns}</b>
        <span>Чешуйки</span><b>{hero.coin_scales}</b>
        <span>Медка</span><b>{hero.coin_copper}</b>
        <span>Расписки Компании</span><b>{hero.coin_receipts}</b>
      </div>
      <div class="rule" />
      <p class="xs">Вес кошеля: ⅓ ячейки. Вместе с вещами груз {carryLabel} / {slots}.</p>
      <p class="xs dim">
        Репутация:{' '}
        {hero.reputation.map((row) => `${row.name} ${row.value > 0 ? '+' : ''}${row.value}`).join(' · ') || '—'}
      </p>
    </div>
  );
}

function Gift({ secrets, hidden }: { secrets: World['hero_secrets'][number] | null | undefined; hidden: boolean }) {
  if (hidden || !secrets) {
    return (
      <>
        <div class="ptitle">Дар</div>
        <p class="small dim">Дар, Цена и носитель видны только самому герою и мастеру.</p>
      </>
    );
  }
  return (
    <>
      <div class="ptitle">Дар · {secrets.gift}</div>
      <div class="small">
        <b class="salt">{secrets.gift_step}</b>
        <br />
        {secrets.gift_text}
      </div>
      <p class="small dim">{secrets.gift_next}</p>
      <div class="rule" />
      <div class="row spread small">
        <span>Цена — <b class="gold">{secrets.gift_price}</b></span>
        <span>{secrets.price_track} / {secrets.price_max}</span>
      </div>
      <Pips filled={secrets.price_track} max={secrets.price_max} />
      <p class="xs dim">Носитель скрыт · знают только вы и мастер</p>
    </>
  );
}

function PerkList({
  perks,
  pending,
  gm,
  editable,
  storeDecide,
  onWithdraw,
}: {
  perks: World['perks'];
  pending: ChangeRequest[];
  gm: boolean;
  editable: boolean;
  storeDecide: (id: string, accept: boolean, comment: string) => void;
  onWithdraw: (id: string) => void;
}) {
  const waiting = pending.filter((row) => row.kind === 'perk');
  return (
    <ul class="perk-list small">
      {perks.map((perk) => (
        <li key={perk.perk}>✦ <span class="salt">{perk.perk}</span> <span class="dim xs">{perk.skill}</span></li>
      ))}
      {waiting.map((row) => (
        <li key={row.id} class="pend">
          ✧ <span class="gold">{String(row.payload.perk)}</span> <span class="badge xs">ждёт мастера</span>
          {editable && (
            <button type="button" class="btn ghost sm" onClick={() => onWithdraw(row.id)}>Отозвать</button>
          )}
          {gm && <Decide onDecide={(accept, comment) => storeDecide(row.id, accept, comment)} />}
        </li>
      ))}
    </ul>
  );
}
