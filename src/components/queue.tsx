import { canEditHero, isGm } from '../lib/domain';
import { formatWhen, kindLabel } from '../lib/format';
import { href } from '../lib/paths';
import type { DataStore } from '../lib/store';
import type { ChangeRequest, Session, Transfer, World } from '../lib/types';
import { Decide, Notices, useNotice } from './bits';
import { useCampaign } from './use-campaign';

export function WaitingPage() {
  const { store, session, world, booting, bootError } = useCampaign();
  if (bootError) return <p class="page">{bootError}</p>;
  if (booting || !world || !session) return <p class="page dim">Открываем очередь…</p>;
  if (session.role === 'guest') {
    return (
      <div class="page">
        <h1>Ждут мастера</h1>
        <p>Очередь видна герою и мастеру. Сначала выберите пробный вход.</p>
      </div>
    );
  }
  const gm = isGm(session);
  const heroId = gm ? null : session.heroId;
  return (
    <div class="page">
      <h1>Ждут мастера</h1>
      <p class="dim">
        {gm
          ? 'Все заявки пробных героев. Решение пишется в этот браузер.'
          : 'Проверяемые правки. Свободные — надеть, снять, выпить, заметка — уже на листе.'}
      </p>
      <QueueList world={world} session={session} store={store} heroId={heroId} />
      <div class="panel discover">
        <span class="badge xs">⏳ ждёт</span>
        <span class="small">мастер ещё не решил</span>
        <span class="badge ok xs">✓ принято</span>
        <span class="small">уже на листе</span>
        <span class="badge no xs">✕ отклонено</span>
        <span class="small">с причиной</span>
      </div>
    </div>
  );
}

export function QueueList({
  world,
  session,
  store,
  heroId,
}: {
  world: World;
  session: Session;
  store: DataStore;
  heroId: string | null;
}) {
  const notice = useNotice();
  const gm = isGm(session);
  const requests = world.change_requests
    .filter((row) => row.status !== 'withdrawn' && (heroId === null || row.hero_id === heroId))
    .sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending') || b.created_at.localeCompare(a.created_at));
  const transfers = world.transfers
    .filter((row) => heroId === null || row.from_hero === heroId || row.to_hero === heroId)
    .sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending'));

  async function run(action: () => Promise<void>, ok: string) {
    try {
      await action();
      notice.flash(ok);
    } catch (reason) {
      notice.fail(reason);
    }
  }

  return (
    <div class="panel queue">
      <Notices error={notice.error} toast={notice.toast} />
      {requests.map((row) => (
        <RequestRow
          key={row.id}
          world={world}
          row={row}
          gm={gm}
          editable={canEditHero(session, row.hero_id)}
          onWithdraw={() => run(() => store.withdrawRequest(row.id), 'Заявку отозвали')}
          onDecide={(accept, comment) => run(() => store.decideRequest(row.id, accept, comment), accept ? 'Принято' : 'Отклонено')}
        />
      ))}
      {transfers.map((row) => (
        <TransferRow
          key={row.id}
          world={world}
          row={row}
          gm={gm}
          editable={canEditHero(session, row.from_hero)}
          onWithdraw={() => run(() => store.withdrawTransfer(row.id), 'Передачу отозвали')}
          onDecide={(accept, comment) => run(() => store.decideTransfer(row.id, accept, comment), accept ? 'Передано' : 'Отклонено')}
        />
      ))}
      {requests.length === 0 && transfers.length === 0 && <p class="dim">Очередь пуста.</p>}
    </div>
  );
}

function heroName(world: World, id: string): string {
  return world.heroes.find((row) => row.id === id)?.name ?? 'герой';
}

function RequestRow({
  world,
  row,
  gm,
  editable,
  onWithdraw,
  onDecide,
}: {
  world: World;
  row: ChangeRequest;
  gm: boolean;
  editable: boolean;
  onWithdraw: () => void;
  onDecide: (accept: boolean, comment: string) => void;
}) {
  const status = row.status === 'approved' ? '✓ принято' : row.status === 'rejected' ? '✕ отклонено' : '⏳ ждёт';
  const klass = row.status === 'approved' ? 'k ok' : row.status === 'rejected' ? 'k no' : 'k';
  return (
    <article class="rq">
      <span class={klass}>{status}</span>
      <div>
        <div class="xs gold">{heroName(world, row.hero_id)} · {kindLabel(row.kind)}</div>
        <b>{row.summary}</b>
        {row.gm_comment && <div class="xs"><i class="warn">«{row.gm_comment}»</i> <span class="dim">— мастер</span></div>}
        <div class="xs dim">{formatWhen(row.created_at)}</div>
        {row.status === 'pending' && gm && <Decide onDecide={onDecide} />}
      </div>
      {row.status === 'pending' && editable && (
        <button type="button" class="btn ghost sm" onClick={onWithdraw}>Отозвать</button>
      )}
      {row.status === 'pending' && !editable && <a class="xs dim" href={href(`/hodoki/${world.heroes.find((hero) => hero.id === row.hero_id)?.slug ?? ''}`)}>к листу</a>}
    </article>
  );
}

function TransferRow({
  world,
  row,
  gm,
  editable,
  onWithdraw,
  onDecide,
}: {
  world: World;
  row: Transfer;
  gm: boolean;
  editable: boolean;
  onWithdraw: () => void;
  onDecide: (accept: boolean, comment: string) => void;
}) {
  if (row.kind === 'gm_grant') return null;
  const item = world.items.find((entry) => entry.id === row.item_id);
  const status = row.status === 'done' ? '✓ передано' : row.status === 'rejected' ? '✕ отклонено' : '⏳ ждёт';
  const klass = row.status === 'done' ? 'k ok' : row.status === 'rejected' ? 'k no' : 'k';
  return (
    <article class="rq">
      <span class={klass}>{status}</span>
      <div>
        <div class="xs gold">передача</div>
        <b>
          {item?.name ?? 'вещь'} ×{row.qty}: {heroName(world, row.from_hero)} → {heroName(world, row.to_hero)}
        </b>
        {row.reason && <div class="xs dim">{row.reason}</div>}
        {row.status === 'pending' && gm && <Decide onDecide={onDecide} />}
      </div>
      {row.status === 'pending' && editable && (
        <button type="button" class="btn ghost sm" onClick={onWithdraw}>Отозвать</button>
      )}
    </article>
  );
}
