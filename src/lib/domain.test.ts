import { describe, expect, it } from 'vitest';
import { HERO, createSeedWorld } from '../data/seed';
import {
  DomainError,
  canSeeSecrets,
  capacitySlots,
  carryWeight,
  decideRequest,
  gearWeight,
  pendingCountForHero,
  pendingMarkCount,
  queueDrop,
  queueSkillMark,
  queueTransfer,
  setEquipped,
  useItem,
  withdrawTransfer,
} from './domain';
import { formatQ, formatWeight } from './rational';
import { CampaignStore, memoryHooks } from './store';
import type { Actor, OpMeta } from './types';

const player: Actor = { role: 'player', heroId: HERO.rimte, preview: false };
const other: Actor = { role: 'player', heroId: HERO.toivo, preview: false };
const gm: Actor = { role: 'gm', heroId: null, preview: false };
const guest: Actor = { role: 'guest', heroId: null, preview: false };

const meta: OpMeta = { id: 'id-1', opId: 'op-1', now: '2026-11-04T12:00:00.000Z', splitId: 'id-split' };

describe('груз Римте', () => {
  it('считает слоты дробями и вместимость от Выносливости', () => {
    const world = createSeedWorld();
    const rimte = world.heroes[0]!;
    expect(rimte.slug).toBe('rimte');
    expect(capacitySlots(rimte)).toBe(13);
    expect(formatWeight(gearWeight(world, rimte.id))).toBe('11 2/15');
    expect(formatQ(carryWeight(world, rimte))).toBe('11 7/15');
  });
});

describe('отметки навыка', () => {
  it('кладёт отметку в очередь и не растит навык, пока мастер не примет', async () => {
    const store = new CampaignStore(memoryHooks({ session: player }));
    await store.ready();
    const before = store.getWorld().skills.find((row) => row.hero_id === HERO.rimte && row.skill === 'Взлом')!;
    expect(before.marks).toBe(0);
    expect(before.value).toBe(21);
    await store.requestSkillMark(HERO.rimte, 'Взлом');
    const mid = store.getWorld();
    const skill = mid.skills.find((row) => row.hero_id === HERO.rimte && row.skill === 'Взлом')!;
    expect(skill.marks).toBe(0);
    expect(skill.value).toBe(21);
    expect(pendingMarkCount(mid, HERO.rimte, 'Взлом')).toBe(1);
    const request = mid.change_requests.find((row) => row.kind === 'skill_mark' && row.status === 'pending')!;
    store.setSession(gm);
    await store.decideRequest(request.id, true, 'видела за столом');
    const after = store.getWorld().skills.find((row) => row.hero_id === HERO.rimte && row.skill === 'Взлом')!;
    expect(after.marks).toBe(1);
    expect(after.value).toBe(21);
    const decided = store.getWorld().change_requests.find((row) => row.id === request.id)!;
    expect(decided.status).toBe('approved');
    expect(decided.gm_comment).toBe('видела за столом');
  });

  it('отклонение не ставит отметку', async () => {
    const store = new CampaignStore(memoryHooks({ session: player }));
    await store.ready();
    await store.requestSkillMark(HERO.rimte, 'Взлом');
    const request = store.getWorld().change_requests.find((row) => row.kind === 'skill_mark' && row.status === 'pending')!;
    store.setSession(gm);
    await store.decideRequest(request.id, false, 'не было ставки');
    const skill = store.getWorld().skills.find((row) => row.hero_id === HERO.rimte && row.skill === 'Взлом')!;
    expect(skill.marks).toBe(0);
  });

  it('не даёт четвёртую отметку', () => {
    const world = createSeedWorld();
    const row = world.skills.find((skill) => skill.hero_id === HERO.rimte && skill.skill === 'Стрельба')!;
    row.marks = 3;
    expect(() => queueSkillMark(world, player, HERO.rimte, 'Стрельба', meta)).toThrow(DomainError);
  });

  it('гость и чужой герой не отмечают', () => {
    const world = createSeedWorld();
    expect(() => queueSkillMark(world, guest, HERO.rimte, 'Взлом', meta)).toThrow(/только сам герой/);
    expect(() => queueSkillMark(world, other, HERO.rimte, 'Взлом', meta)).toThrow(/только сам герой/);
  });
});

describe('сумка', () => {
  it('надеть и снять — свободная правка, без очереди', () => {
    const world = createSeedWorld();
    const sword = 'b1000000-0000-4000-8000-000000000002';
    const wornOff = setEquipped(world, player, sword, false, meta.now);
    expect(wornOff.item_instances.find((row) => row.id === sword)?.location).toBe('bag');
    expect(wornOff.change_requests).toHaveLength(world.change_requests.length);
  });

  it('зелье сразу лечит и уменьшает стопку', () => {
    const world = createSeedWorld();
    const potion = 'b1000000-0000-4000-8000-000000000005';
    const result = useItem(world, player, potion, meta.now);
    expect(result.message).toContain('+18');
    const hero = result.world.heroes.find((row) => row.id === HERO.rimte)!;
    expect(hero.health).toBe(130);
    expect(result.world.item_instances.find((row) => row.id === potion)?.qty).toBe(1);
  });

  it('выброс ждёт мастера и снимает вещь только после «принять»', () => {
    const world = createSeedWorld();
    const rope = 'b1000000-0000-4000-8000-00000000000d';
    const queued = queueDrop(world, player, rope, meta);
    expect(queued.item_instances.find((row) => row.id === rope)?.location).toBe('bag');
    const request = queued.change_requests.find((row) => row.payload.action === 'drop')!;
    const dropped = decideRequest(queued, gm, request.id, true, '', meta.now);
    expect(dropped.item_instances.find((row) => row.id === rope)?.location).toBe('ground');
  });

  it('передача вне стола режет стопку и ждёт мастера, отзыв склеивает обратно', () => {
    const world = createSeedWorld();
    const arrows = 'b1000000-0000-4000-8000-000000000003';
    const queued = queueTransfer(world, player, arrows, HERO.toivo, 5, meta);
    const left = queued.item_instances.find((row) => row.id === arrows)!;
    expect(left.qty).toBe(15);
    expect(left.location).toBe('bag');
    const moving = queued.item_instances.find((row) => row.id === meta.splitId)!;
    expect(moving.qty).toBe(5);
    expect(moving.location).toBe('in_transfer');
    const transfer = queued.transfers[0]!;
    expect(transfer.status).toBe('pending');
    const back = withdrawTransfer(queued, player, transfer.id, meta.now);
    const stack = back.item_instances.find((row) => row.item_id === 'ammo-harpoon' && row.owner_hero_id === HERO.rimte)!;
    expect(stack.qty).toBe(20);
    expect(stack.location).toBe('bag');
    expect(back.transfers[0]?.status).toBe('rejected');
  });
});

describe('уровень и тайны', () => {
  it('принятый уровень Тойво поднимает лист и сбрасывает порог', async () => {
    const store = new CampaignStore(memoryHooks({ session: gm }));
    await store.ready();
    await store.decideRequest('c2000000-0000-4000-8000-000000000001', true, '');
    const toivo = store.getWorld().heroes.find((row) => row.id === HERO.toivo)!;
    expect(toivo.level).toBe(4);
    expect(toivo.xp).toBe(0);
    expect(toivo.xp_next).toBe(16);
  });

  it('Дар видят хозяин и мастер, не другой игрок', () => {
    expect(canSeeSecrets(player, HERO.rimte)).toBe(true);
    expect(canSeeSecrets(gm, HERO.rimte)).toBe(true);
    expect(canSeeSecrets(other, HERO.rimte)).toBe(false);
    expect(canSeeSecrets(guest, HERO.rimte)).toBe(false);
    expect(canSeeSecrets({ role: 'gm', heroId: HERO.toivo, preview: true }, HERO.rimte)).toBe(false);
    expect(canSeeSecrets({ role: 'gm', heroId: HERO.toivo, preview: true }, HERO.toivo)).toBe(true);
  });

  it('у Римте три заявки ждут', () => {
    expect(pendingCountForHero(createSeedWorld(), HERO.rimte)).toBe(3);
  });
});
