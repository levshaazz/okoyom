/** Public landing copy. No GM-only lore. */

export interface Job {
  title: string;
  from: string;
  where: string;
  threat: number;
  /** Replaces the five diamonds when the board writes a number instead. */
  threatMark?: string;
  pay: string;
}

export interface ChronicleCard {
  realDate: string;
  gameDate: string;
  title: string;
  body: string;
  tags: { kind: 'ok' | 'rumor'; text: string }[];
}

export const LANDING = {
  kicker: '12 Солевея 40 П · Причал (Уостас)',
  title: 'Ходоки',
  lede: 'Сорок лет назад море ушло. Пирсы Причала висят над сухим дном, а Контора ходоков платит за всё, что найдено внизу и принесено обратно.',
  outing: {
    title: 'Суббота, 7 ноября',
    meta: '18:00 · у Ани · 4 из 5 мест',
    text: 'Секлума, остовы у Второй вешки. Заказ «Утопленница на сухом месте».',
    party: 'Римте · Брин Кэдох · Тойво · Лучано Ферро',
  },
};

export const JOBS: Job[] = [
  {
    title: 'Утопленница на сухом месте',
    from: 'от старосты дальнего порта',
    where: 'Секлума',
    threat: 2,
    pay: '30 кр. расписками',
  },
  {
    title: 'Лес пришёл за долгом',
    from: 'засечное подворье',
    where: 'Опушка',
    threat: 3,
    pay: '45 кр.',
  },
  {
    title: 'Сопроводить реликвию',
    from: 'Коллегия Фаэста',
    where: 'Старый Берег',
    threat: 5,
    pay: '120 кр.',
  },
  {
    title: 'Беглые',
    from: 'без подписи',
    where: 'Тузкыр',
    threat: 5,
    threatMark: '7',
    pay: 'по головам',
  },
];

export const CHRONICLE: ChronicleCard[] = [
  {
    realDate: '1 ноября 2026',
    gameDate: '9 Солевея 40 П',
    title: 'Ладья в соли',
    body: 'Римте, Брин и Тойво дошли до остова у Второй вешки. В трюме — бочка с морской водой и записка. Кто-то возит соль-воду на сухое дно каждый вечер.',
    tags: [
      { kind: 'ok', text: 'открыто: Секлума' },
      { kind: 'rumor', text: 'слух: Донный город' },
    ],
  },
];

export const OMENS = [
  'На сухих пирсах прибавилось пустых лодок.',
  'Водоноши подняли цену: ведро — полторы чешуйки.',
  'С востока говорят, что степь горит вторую неделю.',
  'Над Чашей ночью видно Око. Старики не выходят.',
];

export const DISCOVERIES = [
  { kind: 'g' as const, text: 'Места · Секлума (Мелководье)' },
  { kind: 'g' as const, text: 'Травы · Плакун-трава' },
  { kind: 'g' as const, text: 'Лица · Даукас' },
  { kind: 'rumor' as const, text: 'Слух · Донный город платит за морскую воду' },
];
