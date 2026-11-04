import { useState } from 'preact/hooks';
import { isGm } from '../lib/domain';
import { Notices, useNotice } from './bits';
import { useCampaign } from './use-campaign';

export default function GrantForm() {
  const { store, session, world, booting, bootError } = useCampaign();
  const [heroId, setHeroId] = useState('');
  const [itemId, setItemId] = useState('');
  const [qty, setQty] = useState(1);
  const notice = useNotice();

  if (bootError) return <p class="page">{bootError}</p>;
  if (booting || !world || !session) return <p class="page dim">Открываем выдачу…</p>;
  if (!isGm(session)) {
    return (
      <div class="page stub">
        <h1>Выдать</h1>
        <p>Выдавать вещи может роль «мастер» в пробном входе. Вещь сразу падает в сумку — это местное решение, без сервера.</p>
      </div>
    );
  }
  const hero = heroId || world.heroes[0]?.id || '';
  const item = itemId || world.items[0]?.id || '';
  return (
    <div class="page">
      <h1>Выдать</h1>
      <p class="dim small">Каталог пробный. Выдача пишется в сумку этого браузера сразу.</p>
      <Notices error={notice.error} toast={notice.toast} />
      <form
        class="form"
        onSubmit={(event) => {
          event.preventDefault();
          void (async () => {
            try {
              await store.grantItem(hero, item, qty);
              const who = world.heroes.find((row) => row.id === hero)?.name ?? 'герой';
              const what = world.items.find((row) => row.id === item)?.name ?? 'вещь';
              notice.flash(`${what} → ${who}`);
            } catch (reason) {
              notice.fail(reason);
            }
          })();
        }}
      >
        <label>
          Герой
          <select value={hero} onChange={(event) => setHeroId((event.currentTarget as HTMLSelectElement).value)}>
            {world.heroes.map((row) => (
              <option key={row.id} value={row.id}>{row.name}</option>
            ))}
          </select>
        </label>
        <label>
          Предмет
          <select value={item} onChange={(event) => setItemId((event.currentTarget as HTMLSelectElement).value)}>
            {world.items.map((row) => (
              <option key={row.id} value={row.id}>{row.name}</option>
            ))}
          </select>
        </label>
        <label>
          Количество
          <input type="number" min={1} max={99} value={qty} onInput={(event) => setQty(Number((event.currentTarget as HTMLInputElement).value))} />
        </label>
        <button class="btn pri" type="submit">Положить в сумку</button>
      </form>
    </div>
  );
}
