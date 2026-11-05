/**
 * Пробный каталог ремесла: три ингредиента, три чары, пороги тиров.
 * Полные таблицы свойств, чар и материалов остаются у мастера и сюда не входят.
 * TODO(supabase): игрок получает только уже открытые свойства. Считать варку,
 * пробу и ступень чар должен RPC, а не бандл Pages.
 */

export interface EffectDef {
  name: string;
  harmful: boolean;
  /** малое / среднее / большое / великое */
  scale: [string, string, string, string];
  boon?: 'insight' | 'masters_hand';
  stat?: 'health' | 'magic' | 'stamina';
  amounts?: [number, number, number, number];
}

export const EFFECTS: Record<string, EffectDef> = {
  ВЗ: { name: 'Восстановить здоровье', harmful: false, scale: ['+25', '+50', '+100', '+150'], stat: 'health', amounts: [25, 50, 100, 150] },
  ВМ: { name: 'Восстановить магию', harmful: false, scale: ['+25', '+50', '+100', '+150'], stat: 'magic', amounts: [25, 50, 100, 150] },
  ВВ: { name: 'Восстановить выносливость', harmful: false, scale: ['+25', '+50', '+100', '+150'], stat: 'stamina', amounts: [25, 50, 100, 150] },
  ТШ: { name: 'Тихий шаг', harmful: false, scale: ['+10 к Скрытности', '+20', '+30', '+30 и сцена'] },
  УЗ: { name: 'Урон здоровью', harmful: true, scale: ['малый яд', 'средний яд', 'большой яд', 'великий яд'] },
  УВ: { name: 'Урон выносливости', harmful: true, scale: ['−20', '−40', '−60', '−60'] },
  ОЗ: { name: 'Озарение', harmful: false, scale: ['+1 ступень чар', '+1 ступень чар', '+1 ступень чар', '+1 ступень чар'], boon: 'insight' },
  РМ: { name: 'Рука мастера', harmful: false, scale: ['+1 к заточке', '+1 к заточке', '+1 к заточке', '+1 к заточке'], boon: 'masters_hand' },
};

/** Четыре свойства в фиксированном порядке. Игрок видит только открытые номера. */
export const INGREDIENTS: Record<string, [string, string, string, string]> = {
  'ing-rust': ['ТШ', 'ВЗ', 'УВ', 'ВВ'],
  'ing-root': ['ТШ', 'УЗ', 'ВМ', 'ВМ'],
  'ing-plakun': ['ВЗ', 'ВМ', 'УЗ', 'ТШ'],
  'ing-glint': ['ОЗ', 'ВМ', 'ТШ', 'УВ'],
  'ing-spark': ['ОЗ', 'УЗ', 'ВВ', 'ВЗ'],
  'ing-bile': ['УЗ', 'ВЗ', 'ТШ', 'ВМ'],
  'ing-dust': ['УЗ', 'УВ', 'УЗ', 'УВ'],
  'ing-mist': ['ВМ', 'ВВ', 'ВЗ', 'ВМ'],
  'ing-thorn': ['ТШ', 'УВ', 'УЗ', 'ВМ'],
};

export interface CharmDef {
  id: string;
  name: string;
  target: 'weapon' | 'armor';
  skill?: string;
  amounts?: [number, number, number, number];
  lines: [string, string, string, string];
}

export const CHARMS: CharmDef[] = [
  { id: 'burn', name: 'Жгучая', target: 'weapon', lines: ['+1d6 огнём', '+2d6 огнём', '+3d6 огнём', '+4d6 огнём'] },
  {
    id: 'fortify-alchemy',
    name: 'Укрепить алхимию',
    target: 'armor',
    skill: 'Алхимия',
    amounts: [5, 10, 15, 20],
    lines: ['+5 к Алхимии', '+10 к Алхимии', '+15 к Алхимии', '+20 к Алхимии'],
  },
  {
    id: 'fortify-smith',
    name: 'Укрепить кузнечное',
    target: 'armor',
    skill: 'Кузнечное',
    amounts: [5, 10, 15, 20],
    lines: ['+5 к Кузнечному', '+10 к Кузнечному', '+15 к Кузнечному', '+20 к Кузнечному'],
  },
];

export const VESSELS = {
  small: { tier: 1, charges: 5, label: 'малый' },
  medium: { tier: 2, charges: 10, label: 'средний' },
  large: { tier: 3, charges: 15, label: 'большой' },
  grand: { tier: 4, charges: 20, label: 'великий' },
} as const;

export type VesselId = keyof typeof VESSELS;

/** Перк тира. Имена тиров 3–6 намеренно без рабочих названий из правил. */
export const SMITH_TIERS: { tier: number; label: string; perk: string | null }[] = [
  { tier: 1, label: 'Железо', perk: null },
  { tier: 2, label: 'Сталь', perk: 'Сталевар' },
  { tier: 3, label: 'Тир 3', perk: 'Тонкая работа' },
  { tier: 4, label: 'Тир 4', perk: 'Глубинная ковка' },
  { tier: 5, label: 'Тир 5', perk: 'Небесный горн' },
  { tier: 6, label: 'Тир 6', perk: 'Легенда горна' },
];

export interface SmithRecipe {
  id: string;
  name: string;
  kind: 'weapon' | 'armor';
  ingots: number;
  leather: number;
  actions: number;
  damage?: string;
  armor?: string;
  wield?: string;
}

export const SMITH_RECIPES: SmithRecipe[] = [
  { id: 'dagger', name: 'Кинжал', kind: 'weapon', ingots: 1, leather: 1, actions: 1, damage: '1d4', wield: 'one' },
  { id: 'onehand', name: 'Одноручный меч', kind: 'weapon', ingots: 1, leather: 1, actions: 1, damage: '1d8', wield: 'one' },
  { id: 'twohand', name: 'Двуручное', kind: 'weapon', ingots: 2, leather: 1, actions: 1, damage: '2d6', wield: 'two' },
  { id: 'bow', name: 'Лук', kind: 'weapon', ingots: 2, leather: 1, actions: 1, damage: '1d8', wield: 'bow' },
  { id: 'shield', name: 'Щит', kind: 'armor', ingots: 2, leather: 0, actions: 1, armor: '1', wield: 'shield' },
  { id: 'light', name: 'Лёгкая броня', kind: 'armor', ingots: 1, leather: 3, actions: 1, armor: '3' },
  { id: 'heavy', name: 'Тяжёлая броня', kind: 'armor', ingots: 4, leather: 1, actions: 2, armor: '6' },
];
