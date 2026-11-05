import type { WikiBlock, WikiGrant, WikiMargin, WikiPage, World } from '../lib/types';

/**
 * Нейтральные пробные статьи. Это не лор кампании: имена и тайны выдуманы для проверки видимости.
 * Канареечные слова (ключ-улитка, перевозный камень, третье веко, глухой звон, синий фонарь)
 * держат тесты: гость и чужой герой не должны находить скрытый текст поиском.
 */
export function wikiSeed(hero: { rimte: string; toivo: string }): Pick<World, 'wiki_pages' | 'wiki_blocks' | 'wiki_grants' | 'wiki_margins'> {
  const t0 = '2026-11-01T12:00:00.000Z';
  const t1 = '2026-11-02T12:00:00.000Z';
  const t2 = '2026-11-03T12:00:00.000Z';

  const pages: WikiPage[] = [
    {
      slug: 'rechniki',
      title: 'Речники',
      cat: 'narody',
      endonym: 'Василай',
      endonym_gloss: 'пробное «речные»',
      aliases: ['речной народ'],
      visibility: 'public',
      updated_at: t0,
    },
    {
      slug: 'gavany',
      title: 'Гавань',
      cat: 'mesta',
      endonym: 'Нордхавн',
      endonym_gloss: 'пробное «северная гавань»',
      aliases: ['учебный порт'],
      visibility: 'public',
      updated_at: t2,
    },
    {
      slug: 'brod',
      title: 'Хранитель брода',
      cat: 'bogi',
      endonym: 'Бродар',
      endonym_gloss: 'пробное «у брода»',
      aliases: [],
      visibility: 'players',
      updated_at: t1,
    },
    {
      slug: 'artel',
      title: 'Дозорная артель',
      cat: 'frakcii',
      endonym: '',
      endonym_gloss: '',
      aliases: ['артель'],
      visibility: 'public',
      updated_at: t0,
    },
    {
      slug: 'storozh',
      title: 'Болотный сторож',
      cat: 'bestiarij',
      endonym: '',
      endonym_gloss: '',
      aliases: ['камышовый'],
      visibility: 'public',
      updated_at: t1,
    },
    {
      slug: 'kolokol',
      title: 'Медный колокольчик',
      cat: 'predmety',
      endonym: '',
      endonym_gloss: '',
      aliases: ['колокол'],
      visibility: 'hidden',
      updated_at: t0,
    },
    {
      slug: 'holmy',
      title: 'Северный холм',
      cat: 'mesta',
      endonym: 'Кальв',
      endonym_gloss: 'пробное «лысый»',
      aliases: [],
      visibility: 'heroes',
      updated_at: t2,
    },
  ];

  const blocks: WikiBlock[] = [
    { id: 'wb-rechniki-h', page_slug: 'rechniki', ord: 1, kind: 'heading', body_md: 'У реки', visibility: 'public' },
    {
      id: 'wb-rechniki-p',
      page_slug: 'rechniki',
      ord: 2,
      kind: 'para',
      body_md: 'Пробный народ учебной карты. Живут у [[gavany|Гавани]] и возят груз для [[artel|Дозорной артели]]. Тайн кампании в этом тексте нет.',
      visibility: 'public',
    },
    {
      id: 'wb-rechniki-secret',
      page_slug: 'rechniki',
      ord: 3,
      kind: 'para',
      body_md: 'Скрытая пометка мастера: синий фонарь зажигают только в этой тестовой байке.',
      visibility: 'hidden',
    },
    { id: 'wb-gavany-h', page_slug: 'gavany', ord: 1, kind: 'heading', body_md: 'Порт', visibility: 'public' },
    {
      id: 'wb-gavany-p',
      page_slug: 'gavany',
      ord: 2,
      kind: 'para',
      body_md:
        'Пробная гавань на краю учебной карты. Пирсы, склад и доска заказов. Отсюда ходят к [[rechniki|Речникам]]. Настоящей географии кампании здесь нет.',
      visibility: 'public',
    },
    {
      id: 'wb-gavany-box',
      page_slug: 'gavany',
      ord: 3,
      kind: 'infobox',
      body_md: 'Край|Тестовое побережье\nКто здесь|[[artel|Дозорная артель]]\nПометка|Пробные данные, не лор',
      visibility: 'public',
    },
    { id: 'wb-gavany-cellar-h', page_slug: 'gavany', ord: 4, kind: 'heading', body_md: 'Погреб', visibility: 'heroes' },
    {
      id: 'wb-gavany-cellar',
      page_slug: 'gavany',
      ord: 5,
      kind: 'para',
      body_md: 'Раздел открыт одному герою. В погребе лежит ключ-улитка.',
      visibility: 'heroes',
    },
    {
      id: 'wb-brod',
      page_slug: 'brod',
      ord: 1,
      kind: 'para',
      body_md: 'Пробное божество брода. Ходокам известно: перевозный камень лежит на середине. Гостю эту статью не отдают.',
      visibility: 'players',
    },
    {
      id: 'wb-artel',
      page_slug: 'artel',
      ord: 1,
      kind: 'para',
      body_md: 'Пробная артель дозора. Берёт заказы на [[gavany|Гавани]] и не хранит секретов кампании.',
      visibility: 'public',
    },
    {
      id: 'wb-storozh',
      page_slug: 'storozh',
      ord: 1,
      kind: 'para',
      body_md: 'Пробная тварь. Стоит в камышах и не трогает тех, кто идёт по тропе.',
      visibility: 'public',
    },
    {
      id: 'wb-storozh-draft',
      page_slug: 'storozh',
      ord: 2,
      kind: 'para',
      body_md: 'Черновик мастера: третье веко открывается только в тесте.',
      visibility: 'draft',
    },
    {
      id: 'wb-kolokol',
      page_slug: 'kolokol',
      ord: 1,
      kind: 'para',
      body_md: 'Скрытый предмет. Глухой звон слышен только мастеру, пока статью не откроют.',
      visibility: 'hidden',
    },
    {
      id: 'wb-holmy',
      page_slug: 'holmy',
      ord: 1,
      kind: 'para',
      body_md: 'Пробный холм. Три сосны на макушке. Статья открыта одному герою.',
      visibility: 'heroes',
    },
  ];

  const grants: WikiGrant[] = [
    { page_slug: 'gavany', block_id: 'wb-gavany-cellar-h', hero_id: hero.rimte },
    { page_slug: 'gavany', block_id: 'wb-gavany-cellar', hero_id: hero.rimte },
    { page_slug: 'holmy', block_id: null, hero_id: hero.toivo },
  ];

  const margins: WikiMargin[] = [
    {
      id: 'wm-rimte-note',
      page_slug: 'gavany',
      hero_id: hero.rimte,
      kind: 'note',
      audience: 'personal',
      body: 'Спуститься в погреб, пока светло.',
      created_at: t1,
    },
    {
      id: 'wm-rimte-rumor',
      page_slug: 'gavany',
      hero_id: hero.rimte,
      kind: 'rumor',
      audience: 'shared',
      body: 'У гавани якобы звенит колокол без языка.',
      created_at: t2,
    },
    {
      id: 'wm-toivo-note',
      page_slug: 'gavany',
      hero_id: hero.toivo,
      kind: 'note',
      audience: 'personal',
      body: 'Личная пометка Тойво у гавани.',
      created_at: t2,
    },
  ];

  return { wiki_pages: pages, wiki_blocks: blocks, wiki_grants: grants, wiki_margins: margins };
}
