import { describe, expect, it } from 'vitest';
import { HERO, createSeedWorld } from '../data/seed';
import { decideTransfer, queueTransfer } from './domain';
import { lettersFor, openBook, pagesFor, sendLetter, unreadCount } from './books';
import type { OpMeta } from './types';

const meta: OpMeta = { id: 'm1', opId: 'm1', now: '2026-11-04T12:00:00.000Z', splitId: 'split' };
const rimte = { role: 'player' as const, heroId: HERO.rimte, preview: false };
const toivo = { role: 'player' as const, heroId: HERO.toivo, preview: false };
const guest = { role: 'guest' as const, heroId: null, preview: false };
const gm = { role: 'gm' as const, heroId: null, preview: false };

describe('книги и записки', () => {
  it('текст книги есть только у держателя', () => {
    const world = createSeedWorld();
    expect(pagesFor(world, rimte, 'copy-pilot')?.length).toBe(3);
    expect(pagesFor(world, toivo, 'copy-pilot')).toBeNull();
    expect(pagesFor(world, guest, 'copy-pilot')).toBeNull();
    expect(pagesFor(world, gm, 'copy-pilot')?.length).toBe(3);
  });

  it('обучающая книга даёт навык один раз и пишет журнал', () => {
    const world = createSeedWorld();
    const before = world.skills.find((row) => row.hero_id === HERO.toivo && row.skill === 'Скрытность')!.value;
    const first = openBook(world, toivo, 'copy-quiet', meta);
    expect(first.applied).toBe('+2 к Скрытность');
    expect(first.world.skills.find((row) => row.hero_id === HERO.toivo && row.skill === 'Скрытность')!.value).toBe(before + 2);
    expect(first.world.audit_log.some((row) => row.action === 'book_read')).toBe(true);
    const second = openBook(first.world, toivo, 'copy-quiet', { ...meta, id: 'm2' });
    expect(second.changed).toBe(false);
    expect(second.world.skills.find((row) => row.hero_id === HERO.toivo && row.skill === 'Скрытность')!.value).toBe(before + 2);
  });

  it('записка видна адресату, мастер видит непрочитанное, передача сменяет держателя книги', () => {
    const world = createSeedWorld();
    expect(unreadCount(world, HERO.rimte)).toBe(1);
    expect(lettersFor(world, toivo, HERO.toivo)).toHaveLength(0);
    expect(lettersFor(world, gm, HERO.rimte)[0]?.recipient.read_at).toBeNull();
    const sent = sendLetter(world, gm, { title: 'Тихо', body: 'Ждите.', from: 'мастер', heroIds: [HERO.zhdan], asItem: true }, meta);
    expect(unreadCount(sent, HERO.zhdan)).toBe(1);
    expect(sent.item_instances.some((row) => row.owner_hero_id === HERO.zhdan && row.props.letter_id === 'm1')).toBe(true);
    const queued = queueTransfer(world, rimte, 'b1000000-0000-4000-8000-00000000000a', HERO.toivo, 1, { ...meta, id: 'tr' });
    const transfer = queued.transfers.find((row) => row.status === 'pending')!;
    const done = decideTransfer(queued, gm, transfer.id, true, '', meta.now);
    expect(done.book_copies.find((row) => row.id === 'copy-pilot')?.holder_hero_id).toBe(HERO.toivo);
    expect(pagesFor(done, rimte, 'copy-pilot')).toBeNull();
    expect(pagesFor(done, toivo, 'copy-pilot')?.length).toBe(3);
  });
});
