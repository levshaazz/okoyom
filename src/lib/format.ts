export function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function signed(n: number): string {
  if (n > 0) return `+${n}`;
  return String(n);
}

const KIND_LABEL: Record<string, string> = {
  perk: 'перк',
  level_up: 'уровень',
  skill_mark: 'отметка',
  craft: 'ремесло',
  book_read: 'книга',
  rumor: 'слух',
  buy: 'покупка',
  sell: 'продажа',
  spell: 'заклинание',
  other: 'правка',
  give: 'передача',
};

export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}
