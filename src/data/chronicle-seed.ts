import type { ChronicleEntry, ChronicleMemory, ChroniclePart, Omen, World, WorldClock } from '../lib/types';

/**
 * Пробная летопись. Канарейки для тестов видимости:
 * «тихий уговор» — часть только для участников,
 * «закрытый костёр» — запись только участникам (Римте и Ждан),
 * «не показывать цифру» — заметка часов, игрокам не отдаётся.
 */
export function chronicleSeed(hero: {
  rimte: string;
  toivo: string;
  zhdan: string;
}): Pick<World, 'chronicle_entries' | 'chronicle_parts' | 'chronicle_memories' | 'world_clocks' | 'omens'> {
  const entries: ChronicleEntry[] = [
    {
      id: 'ch-harbor',
      real_date: '2026-11-01',
      game_date: '9 учебного месяца',
      title: 'Пробный выход к гавани',
      lead_md: 'Римте и Тойво дошли до учебной гавани и вернулись до темноты. Это пробная запись, не событие кампании.',
      hero_ids: [hero.rimte, hero.toivo],
      places: [{ label: 'Гавань', wiki_slug: 'gavany', map_label: 'учебная гавань' }],
      loot: 'пробная верёвка, 4 кроны',
      fallen: [],
      visibility: 'public',
      session_id: null,
    },
    {
      id: 'ch-fire',
      real_date: '2026-10-28',
      game_date: '5 учебного месяца',
      title: 'Разговор, которого не было у гостя',
      lead_md: 'Ходоки сидели у закрытого костра и не звали посторонних. Гостю этой записи нет.',
      hero_ids: [hero.rimte, hero.zhdan],
      places: [{ label: 'Северный холм', wiki_slug: 'holmy', map_label: null }],
      loot: '',
      fallen: [],
      visibility: 'party',
      session_id: null,
    },
    {
      id: 'ch-vern',
      real_date: '2026-10-18',
      game_date: '28 учебного месяца',
      title: 'Пустая лодка Верна',
      lead_md: 'Пробный павший. Верн Короткий — выдуманное имя для ленты, его нет среди героев и в лоре кампании.',
      hero_ids: [hero.toivo],
      places: [{ label: 'Гавань', wiki_slug: 'gavany', map_label: 'пирс' }],
      loot: '',
      fallen: [{ name: 'Верн Короткий', hero_id: null, note: 'Не вернулся с пробной тропы. Лодка стоит пустой.' }],
      visibility: 'public',
      session_id: null,
    },
  ];

  const parts: ChroniclePart[] = [
    {
      id: 'chp-harbor-open',
      entry_id: 'ch-harbor',
      ord: 1,
      body_md: 'Шли по меткам на учебном берегу. В складе нашли верёвку и оставили её Конторе.',
      visibility: 'public',
    },
    {
      id: 'chp-harbor-party',
      entry_id: 'ch-harbor',
      ord: 2,
      body_md: 'Только участникам: у костра был тихий уговор никому не рассказывать, кто нёс верёвку.',
      visibility: 'party',
    },
  ];

  const memories: ChronicleMemory[] = [
    {
      id: 'chm-toivo',
      entry_id: 'ch-harbor',
      hero_id: hero.toivo,
      body: 'Запомнил скрип пирса, не саму дорогу.',
      created_at: '2026-11-02T12:00:00.000Z',
    },
  ];

  const clocks: WorldClock[] = [
    {
      id: 'clock-trial',
      title: 'Пробные часы',
      segments: 6,
      filled: 2,
      notes: 'Заметка мастера: не показывать цифру игрокам.',
    },
  ];

  const omens: Omen[] = [
    {
      id: 'omen-barrels',
      clock_id: 'clock-trial',
      text: 'На тестовой гавани прибавилось пустых бочек.',
      shown_from: '2026-11-01T00:00:00.000Z',
      visibility: 'players',
    },
  ];

  return {
    chronicle_entries: entries,
    chronicle_parts: parts,
    chronicle_memories: memories,
    world_clocks: clocks,
    omens,
  };
}
