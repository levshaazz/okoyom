import { describe, expect, it } from 'vitest';
import { HERO, createSeedWorld } from '../data/seed';
import {
  addChronicleMemory,
  advanceWorldClock,
  chronicleFeed,
  clockPane,
  renderChronicle,
  visibleEntries,
  visibleParts,
} from './chronicle';
import { DomainError } from './errors';
import { CampaignStore, memoryHooks } from './store';
import type { Actor, OpMeta } from './types';

const guest: Actor = { role: 'guest', heroId: null, preview: false };
const rimte: Actor = { role: 'player', heroId: HERO.rimte, preview: false };
const toivo: Actor = { role: 'player', heroId: HERO.toivo, preview: false };
const zhdan: Actor = { role: 'player', heroId: HERO.zhdan, preview: false };
const gm: Actor = { role: 'gm', heroId: null, preview: false };
const meta: OpMeta = { id: 'id-c', opId: 'op-c', now: '2026-11-04T12:00:00.000Z' };
const NOW = '2026-11-04T12:00:00.000Z';

describe('видимость летописи', () => {
  it('гость видит только публичные записи и не читает закрытую часть', () => {
    const world = createSeedWorld();
    const titles = visibleEntries(world, guest).map((entry) => entry.id);
    expect(titles).toEqual(['ch-harbor', 'ch-vern']);
    const harbor = world.chronicle_entries.find((entry) => entry.id === 'ch-harbor')!;
    const parts = visibleParts(world, guest, harbor);
    expect(parts.find((part) => part.id === 'chp-harbor-party')?.body).toBeNull();
    expect(JSON.stringify(parts)).not.toContain('тихий уговор');
    expect(JSON.stringify(visibleEntries(world, guest))).not.toContain('закрытый костёр');
    expect(clockPane(world, guest, NOW).clocks).toBeNull();
    expect(clockPane(world, guest, NOW).omens).toEqual([]);
  });

  it('участник видит свою часть, посторонний ходок — нет; приметы есть, часов нет', () => {
    const world = createSeedWorld();
    expect(visibleEntries(world, rimte).map((entry) => entry.id)).toContain('ch-fire');
    expect(visibleEntries(world, toivo).map((entry) => entry.id)).not.toContain('ch-fire');
    const harbor = world.chronicle_entries.find((entry) => entry.id === 'ch-harbor')!;
    expect(visibleParts(world, rimte, harbor).find((part) => part.id === 'chp-harbor-party')?.body).toContain('тихий уговор');
    expect(visibleParts(world, zhdan, harbor).find((part) => part.id === 'chp-harbor-party')?.body).toBeNull();
    expect(JSON.stringify(visibleParts(world, zhdan, harbor))).not.toContain('тихий уговор');
    const pane = clockPane(world, rimte, NOW);
    expect(pane.clocks).toBeNull();
    expect(pane.omens.map((omen) => omen.text)).toEqual(['На тестовой гавани прибавилось пустых бочек.']);
    expect(JSON.stringify(pane)).not.toContain('не показывать цифру');
    expect(JSON.stringify(pane)).not.toContain('"filled"');
    const gmPane = clockPane(world, gm, NOW);
    expect(gmPane.clocks?.[0]?.filled).toBe(2);
    expect(gmPane.clocks?.[0]?.notes).toContain('не показывать цифру');
    expect(visibleParts(world, gm, harbor).some((part) => part.body?.includes('тихий уговор'))).toBe(true);
  });

  it('лента фильтруется по герою и месту', () => {
    const world = createSeedWorld();
    expect(chronicleFeed(world, guest, { heroId: HERO.toivo, place: 'all' }).map((entry) => entry.id)).toEqual([
      'ch-harbor',
      'ch-vern',
    ]);
    expect(chronicleFeed(world, guest, { heroId: 'all', place: 'Северный холм' })).toEqual([]);
    expect(chronicleFeed(world, rimte, { heroId: HERO.zhdan, place: 'Северный холм' }).map((entry) => entry.id)).toEqual([
      'ch-fire',
    ]);
  });

  it('воспоминание пишет герой, которому видна запись, и не пишет гость', async () => {
    const store = new CampaignStore(memoryHooks({ session: rimte }));
    await store.ready();
    await store.addChronicleMemory('ch-harbor', 'Я нёс фонарь.');
    expect(store.getWorld().chronicle_memories.some((row) => row.body.includes('фонарь'))).toBe(true);
    store.setSession(guest);
    await expect(store.addChronicleMemory('ch-harbor', 'чужое')).rejects.toThrow(DomainError);
    store.setSession(toivo);
    await expect(store.addChronicleMemory('ch-fire', 'меня там не было')).rejects.toThrow(DomainError);
    expect(() => addChronicleMemory(createSeedWorld(), zhdan, 'ch-harbor', 'тоже был рядом', meta)).not.toThrow();
    const advanced = advanceWorldClock(createSeedWorld(), gm, 'clock-trial');
    expect(advanced.world_clocks[0]?.filled).toBe(3);
    expect(() => advanceWorldClock(createSeedWorld(), rimte, 'clock-trial')).toThrow(DomainError);
    const html = renderChronicle('Тихо <script>x</script> и **важно**');
    expect(html).not.toContain('<script>');
    expect(html).toContain('<strong>важно</strong>');
  });
});
