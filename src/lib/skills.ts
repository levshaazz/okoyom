export const SKILL_GROUPS = [
  {
    id: 'warrior',
    title: 'Воин',
    skills: ['Одноручное', 'Двуручное', 'Стрельба', 'Блок', 'Тяжёлая броня', 'Кузнечное'],
  },
  {
    id: 'mage',
    title: 'Маг',
    skills: ['Разрушение', 'Изменение', 'Восстановление', 'Наваждение', 'Призыв', 'Зачарование'],
  },
  {
    id: 'thief',
    title: 'Вор',
    skills: ['Скрытность', 'Лёгкая броня', 'Взлом', 'Ловкость рук', 'Красноречие', 'Алхимия'],
  },
] as const;

export const SKILL_NAMES: string[] = SKILL_GROUPS.flatMap((group) => [...group.skills]);

export function isSkillName(name: string): boolean {
  return SKILL_NAMES.includes(name);
}

export function skillGroup(name: string): string {
  return SKILL_GROUPS.find((group) => (group.skills as readonly string[]).includes(name))?.title ?? '';
}

/** Level L costs 8 + 2L experience to leave. */
export function xpThreshold(level: number): number {
  return 8 + 2 * level;
}
