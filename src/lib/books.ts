import { writeAudit } from './audit';
import { DomainError } from './errors';
import type { Actor, BookCopy, BookPage, OpMeta, World } from './types';

function isOwner(actor: Actor, heroId: string): boolean {
  return (actor.role === 'player' && actor.heroId === heroId) || (actor.role === 'gm' && actor.preview && actor.heroId === heroId);
}

function isRealGm(actor: Actor): boolean {
  return actor.role === 'gm' && !actor.preview;
}

export function copyByInstance(world: World, instanceId: string): BookCopy | undefined {
  return world.book_copies.find((row) => row.instance_id === instanceId);
}

/** Текст только у текущего держателя и у мастера. Гость и чужой герой получают пусто. */
export function pagesFor(world: World, actor: Actor, copyId: string): BookPage[] | null {
  const copy = world.book_copies.find((row) => row.id === copyId);
  if (!copy) return null;
  if (!isRealGm(actor) && !isOwner(actor, copy.holder_hero_id)) return null;
  return world.book_pages.filter((page) => page.book_id === copy.book_id).sort((a, b) => a.n - b.n);
}

export function openBook(
  world: World,
  actor: Actor,
  copyId: string,
  meta: OpMeta,
): { world: World; pages: BookPage[]; applied: string | null; changed: boolean } {
  const pages = pagesFor(world, actor, copyId);
  if (!pages) throw new DomainError('Эту книгу читает только тот, у кого она в руках.');
  const copy = world.book_copies.find((row) => row.id === copyId)!;
  const book = world.books.find((row) => row.id === copy.book_id);
  if (!book) throw new DomainError('Книги нет в каталоге.');
  const reader = isRealGm(actor) ? null : actor.heroId;
  if (!reader || copy.first_read_by.includes(reader)) {
    return { world, pages, applied: null, changed: false };
  }
  const next = structuredClone(world);
  const row = next.book_copies.find((entry) => entry.id === copyId)!;
  row.first_read_by.push(reader);
  let applied: string | null = null;
  if (book.skill_bonus) {
    const skill = next.skills.find((entry) => entry.hero_id === reader && entry.skill === book.skill_bonus!.skill);
    if (skill) {
      const before = skill.value;
      skill.value = Math.min(100, skill.value + book.skill_bonus.amount);
      applied = `+${skill.value - before} к ${skill.skill}`;
    }
  }
  writeAudit(next, actor, meta, {
    hero_id: reader,
    action: 'book_read',
    summary: applied ? `Первое прочтение «${book.title}»: ${applied}` : `Прочитано «${book.title}»`,
    before: book.skill_bonus ? { skill: book.skill_bonus.skill } : null,
    after: { book: book.id, applied },
    undo: null,
  });
  return { world: next, pages, applied, changed: true };
}

export function unreadCount(world: World, heroId: string): number {
  return world.letter_recipients.filter((row) => row.hero_id === heroId && row.holder && !row.read_at).length;
}

export function lettersFor(world: World, actor: Actor, heroId: string) {
  if (!isRealGm(actor) && !isOwner(actor, heroId)) return [];
  return world.letters
    .filter((letter) => world.letter_recipients.some((row) => row.letter_id === letter.id && row.hero_id === heroId && (isRealGm(actor) || row.holder)))
    .map((letter) => ({
      letter,
      recipient: world.letter_recipients.find((row) => row.letter_id === letter.id && row.hero_id === heroId)!,
    }));
}

export function markLetterRead(world: World, actor: Actor, letterId: string, meta: OpMeta): World {
  const next = structuredClone(world);
  const row = next.letter_recipients.find((entry) => entry.letter_id === letterId && isOwner(actor, entry.hero_id) && entry.holder);
  if (!row) throw new DomainError('Этой записки у вас нет.');
  if (row.read_at) return world;
  row.read_at = meta.now;
  writeAudit(next, actor, meta, {
    hero_id: row.hero_id,
    action: 'letter_read',
    summary: 'Записка прочтена',
    before: { read_at: null },
    after: { letterId, read_at: meta.now },
    undo: null,
  });
  return next;
}

export function sendLetter(
  world: World,
  actor: Actor,
  input: { title: string; body: string; from: string; heroIds: string[]; asItem: boolean },
  meta: OpMeta,
): World {
  if (!isRealGm(actor)) throw new DomainError('Записку пишет мастер.');
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title || !body) throw new DomainError('Нужны заголовок и текст.');
  if (!input.heroIds.length) throw new DomainError('Выберите хотя бы одного героя.');
  const next = structuredClone(world);
  const letterId = meta.id;
  next.letters.push({
    id: letterId,
    from_label: input.from.trim() || 'мастер',
    title,
    body,
    created_at: meta.now,
  });
  const granted: string[] = [];
  input.heroIds.forEach((heroId, index) => {
    if (!next.heroes.some((hero) => hero.id === heroId)) throw new DomainError('Такого героя нет.');
    next.letter_recipients.push({ letter_id: letterId, hero_id: heroId, read_at: null, holder: true });
    if (input.asItem) {
      const instanceId = `${meta.id}-item-${index}`;
      if (!next.items.some((item) => item.id === 'letter')) {
        next.items.push({
          id: 'letter',
          name: 'Записка',
          kind: 'note',
          weight: { n: 0, d: 1 },
          price: 0,
          lot: 1,
          props: {},
          public_desc: 'Сложенная записка. Текст виден только держателю.',
        });
      }
      next.item_instances.push({
        id: instanceId,
        item_id: 'letter',
        qty: 1,
        owner_hero_id: heroId,
        location: 'bag',
        custom_name: title,
        props: { letter_id: letterId },
        secret: true,
        notes: null,
        created_at: meta.now,
        updated_at: meta.now,
      });
      granted.push(instanceId);
    }
    writeAudit(next, actor, { ...meta, id: `${meta.id}-audit-${index}` }, {
      hero_id: heroId,
      action: 'gm_letter',
      summary: `Записка «${title}»`,
      before: null,
      after: { letterId, granted },
      undo: null,
    });
  });
  return next;
}

/** После принятой передачи книга и записка-вещь меняют держателя. */
export function moveHolders(world: World, instanceId: string, toHero: string, now: string): void {
  for (const copy of world.book_copies) {
    if (copy.instance_id === instanceId) copy.holder_hero_id = toHero;
  }
  const inst = world.item_instances.find((row) => row.id === instanceId);
  const letterId = typeof inst?.props.letter_id === 'string' ? inst.props.letter_id : null;
  if (!letterId || !inst) return;
  const from = inst.owner_hero_id;
  for (const row of world.letter_recipients) {
    if (row.letter_id === letterId && row.hero_id === from) row.holder = false;
  }
  const target = world.letter_recipients.find((row) => row.letter_id === letterId && row.hero_id === toHero);
  if (target) target.holder = true;
  else world.letter_recipients.push({ letter_id: letterId, hero_id: toHero, read_at: null, holder: true });
  void now;
}
