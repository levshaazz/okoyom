/**
 * Созвездия перков и учебный каталог заклинаний.
 * Полностью по правилам расписано только Одноручное (§3.3).
 * TODO(мастер): остальные ветки по 6–10 узлов живут у мастера и не должны
 * попадать в публичный бандл. Здесь у них один-два тестовых узла, чтобы
 * созвездие и правило «виден только следующий» можно было проверить.
 * TODO(supabase): игроку отдавать только уже взятые и следующие узлы (RPC),
 * не весь граф.
 */

export interface PerkNode {
  id: string;
  skill: string;
  name: string;
  threshold: number;
  /** Пусто — корень ветки. */
  requires: string[];
  /** any: хватает одного предшественника (Удар-гром). */
  requiresMode: 'all' | 'any';
  effect: string;
  x: number;
  y: number;
}

export interface SpellStar {
  name: string;
  school: string;
  /** 1 Новичок … 5 Мастер. Пороги как в правилах: 0 / 25 / 50 / 75 / 100. */
  tier: number;
  cost: number;
}

export const TIER_LABELS = ['', 'Новичок', 'Ученик', 'Адепт', 'Эксперт', 'Мастер'] as const;

export const SPELL_SCHOOLS = ['Разрушение', 'Изменение', 'Восстановление', 'Наваждение', 'Призыв', 'Зачарование'] as const;

const one = (partial: Omit<PerkNode, 'skill' | 'requiresMode'> & { requiresMode?: 'all' | 'any' }): PerkNode => ({
  skill: 'Одноручное',
  requiresMode: partial.requiresMode ?? 'all',
  ...partial,
});

/** Ветка Одноручного — пример из правил, целиком. */
const ONE_HANDED: PerkNode[] = [
  one({ id: 'one-firm-1', name: 'Твёрдая рука I', threshold: 15, requires: [], effect: '+2 к урону одноручным оружием', x: 480, y: 760 }),
  one({ id: 'one-firm-2', name: 'Твёрдая рука II', threshold: 40, requires: ['one-firm-1'], effect: '+4 к урону одноручным (вместо +2)', x: 280, y: 580 }),
  one({ id: 'one-firm-3', name: 'Твёрдая рука III', threshold: 70, requires: ['one-firm-2'], effect: '+6 к урону одноручным (вместо +4)', x: 180, y: 380 }),
  one({ id: 'one-stance', name: 'Боевая стойка', threshold: 25, requires: ['one-firm-1'], effect: 'Силовая атака одноручным стоит 15 Выносливости вместо 20', x: 480, y: 560 }),
  one({ id: 'one-whirl', name: 'Двойной вихрь', threshold: 30, requires: ['one-firm-1'], effect: 'Силовая атака двумя оружиями без штрафа −20 на вторую руку', x: 700, y: 580 }),
  one({ id: 'one-grip', name: 'Хватка мастера', threshold: 40, requires: ['one-stance'], effect: 'Вид оружия при взятии: клинок, топор или булава — свой приём на крите', x: 360, y: 360 }),
  one({ id: 'one-rush', name: 'Натиск', threshold: 50, requires: ['one-stance'], effect: 'Рывок и силовая атака одним действием. При попадании +1 кость урона', x: 620, y: 360 }),
  one({ id: 'one-sweep', name: 'Подсечка', threshold: 60, requires: ['one-rush'], effect: 'Силовая атака может сбить цель с ног', x: 740, y: 180 }),
  one({ id: 'one-execute', name: 'Казнь', threshold: 75, requires: ['one-grip'], effect: 'Силовая атака по раненой цели: обычный враг гибнет. Раз в сцену', x: 280, y: 180 }),
  one({
    id: 'one-thunder',
    name: 'Удар-гром',
    threshold: 90,
    requires: ['one-execute', 'one-sweep'],
    requiresMode: 'any',
    effect: 'Раз в сцену попавшая силовая атака парализует цель на раунд',
    x: 500,
    y: 40,
  }),
];

function testPair(skill: string, rootName: string, rootAt: number, childName: string, childAt: number, childEffect: string): PerkNode[] {
  const root = `${skill}-root`;
  const child = `${skill}-next`;
  return [
    { id: root, skill, name: rootName, threshold: rootAt, requires: [], requiresMode: 'all', effect: 'Тестовый корень ветки. Остальное дерево ещё не выложено.', x: 480, y: 640 },
    { id: child, skill, name: childName, threshold: childAt, requires: [root], requiresMode: 'all', effect: childEffect, x: 480, y: 360 },
  ];
}

export const PERK_NODES: PerkNode[] = [
  ...ONE_HANDED,
  ...testPair('Стрельба', 'Зоркий глаз', 20, 'Дальняя тетива', 45, 'Тест: дальний выстрел без штрафа −10.'),
  ...testPair('Скрытность', 'Тихий шаг', 15, 'Удар из тени', 40, 'Тест: урон из скрытности ×2.'),
  ...testPair('Алхимия', 'Знаток трав', 20, 'Полевой лекарь', 25, 'Тест: стабилизация +20 без набора.'),
  ...testPair('Блок', 'Плотный щит', 20, 'Контрудар', 40, 'Тест: после удачного блока — ответный удар.'),
  ...testPair('Разрушение', 'Бережливая искра', 15, 'Стихия', 40, 'Тест: новичок школы стоит вдвое дешевле.'),
  ...testPair('Красноречие', 'Торг', 20, 'Ровный голос', 40, 'Тест: скидка у торговца и ложь без первой подозрительности.'),
  ...testPair('Двуручное', 'Размах', 20, 'Тяжёлый замах', 45, 'Тест: двуручное +1 кость на силовую.'),
  ...testPair('Тяжёлая броня', 'Привычная сталь', 20, 'Глухая поступь', 45, 'Тест: штраф скрытности от лат −10 вместо −20.'),
  ...testPair('Кузнечное', 'Сталевар', 30, 'Тонкая работа', 45, 'Тест: чертёж стали и качество +1.'),
  ...testPair('Изменение', 'Тихая материя', 20, 'Двойное сотворение', 50, 'Тест: одно заклинание школы в обеих руках.'),
  ...testPair('Восстановление', 'Тёплая рука', 20, 'Двойное сотворение', 50, 'Тест: одно заклинание школы в обеих руках.'),
  ...testPair('Наваждение', 'Шёпот', 20, 'Двойное сотворение', 50, 'Тест: одно заклинание школы в обеих руках.'),
  ...testPair('Призыв', 'Тонкий зов', 20, 'Двойное сотворение', 50, 'Тест: одно заклинание школы в обеих руках.'),
  ...testPair('Зачарование', 'Ученик глифа', 20, 'Чуткая расколдовка', 40, 'Тест: расколдовка снимает чары, вещь остаётся.'),
  ...testPair('Лёгкая броня', 'Мягкий шаг', 20, 'Уклон', 40, 'Тест: уклонение стоит 5 Выносливости.'),
  ...testPair('Взлом', 'Чуткий слух', 20, 'Тихая отмычка', 40, 'Тест: сломанная отмычка не звенит.'),
  ...testPair('Ловкость рук', 'Лёгкие пальцы', 20, 'Подмена', 40, 'Тест: подмена предмета без отдельной проверки.'),
];

/** Учебный список. Невыученные игрок на небе не видит. */
export const SPELL_STARS: SpellStar[] = [
  { name: 'Искра', school: 'Разрушение', tier: 1, cost: 12 },
  { name: 'Огненный шар', school: 'Разрушение', tier: 2, cost: 30 },
  { name: 'Цепная молния', school: 'Разрушение', tier: 3, cost: 55 },
  { name: 'Свет', school: 'Изменение', tier: 1, cost: 10 },
  { name: 'Каменная кожа', school: 'Изменение', tier: 2, cost: 30 },
  { name: 'Невидимость', school: 'Изменение', tier: 3, cost: 55 },
  { name: 'Лечение', school: 'Восстановление', tier: 1, cost: 20 },
  { name: 'Круг жизни', school: 'Восстановление', tier: 4, cost: 40 },
  { name: 'Страх', school: 'Наваждение', tier: 1, cost: 15 },
  { name: 'Призвать духа-волка', school: 'Призыв', tier: 2, cost: 35 },
  { name: 'Слабый глиф', school: 'Зачарование', tier: 1, cost: 0 },
];

export function nodesForSkill(skill: string): PerkNode[] {
  return PERK_NODES.filter((node) => node.skill === skill);
}
