import { createSeedWorld } from '../data/seed';
import {
  applyLoadout,
  confirmEvent,
  decideRequest,
  decideTransfer,
  deleteLoadout,
  grantItem,
  learnSpellTome,
  queueDrop,
  queuePerk,
  queueSkillMark,
  queueTransfer,
  rollbackEvent,
  saveLoadout,
  saveNote,
  setEquipped,
  setHand,
  setStat,
  useItem,
  withdrawRequest,
  withdrawTransfer,
} from './domain';
import { markLetterRead, openBook, sendLetter } from './books';
import {
  addChronicleMemory,
  advanceWorldClock,
  removeChronicleEntry,
  removeChronicleMemory,
  saveChronicleEntry,
  saveChroniclePart,
  saveOmen,
  saveWorldClock,
  type ChronicleEntryInput,
  type ChroniclePartInput,
  type OmenInput,
  type WorldClockInput,
} from './chronicle';
import type { LearnedSpell } from './combat';
import { queueCraft, type CraftOrder } from './craft';
import type { HandFill, HandSide, Session, WikiVisibility, World } from './types';
import { SEED_REVISION } from './types';
import {
  addWikiMargin,
  moveWikiBlock,
  removeWikiBlock,
  removeWikiPage,
  saveWikiBlock,
  saveWikiPage,
  setWikiVisibility,
  removeWikiMargin,
  type WikiBlockInput,
  type WikiMarginInput,
  type WikiPageInput,
  type WikiTarget,
} from './wiki';

export const GUEST: Session = { role: 'guest', heroId: null, preview: false };

export interface DataStore {
  ready(): Promise<void>;
  getWorld(): World;
  getSession(): Session;
  setSession(session: Session): void;
  subscribe(listener: () => void): () => void;
  resetWorld(): Promise<void>;
  requestSkillMark(heroId: string, skill: string): Promise<void>;
  requestPerk(heroId: string, perk: string, skill: string): Promise<void>;
  requestDrop(instanceId: string): Promise<void>;
  requestTransfer(instanceId: string, toHeroId: string, qty: number): Promise<void>;
  withdrawRequest(id: string): Promise<void>;
  withdrawTransfer(id: string): Promise<void>;
  decideRequest(id: string, accept: boolean, comment: string): Promise<void>;
  decideTransfer(id: string, accept: boolean, comment: string): Promise<void>;
  setEquipped(instanceId: string, worn: boolean): Promise<void>;
  setStat(heroId: string, stat: 'health' | 'magic' | 'stamina', value: number): Promise<void>;
  useItem(instanceId: string): Promise<string>;
  grantItem(heroId: string, itemId: string, qty: number): Promise<void>;
  saveNote(heroId: string, body: string): Promise<void>;
  openBook(copyId: string): Promise<{ applied: string | null; pages: { n: number; body: string }[] }>;
  sendLetter(input: { title: string; body: string; from: string; heroIds: string[]; asItem: boolean }): Promise<void>;
  markLetterRead(letterId: string): Promise<void>;
  setHand(heroId: string, side: HandSide, fill: HandFill): Promise<void>;
  saveLoadout(heroId: string, name: string): Promise<void>;
  applyLoadout(heroId: string, loadoutId: string): Promise<void>;
  deleteLoadout(heroId: string, loadoutId: string): Promise<void>;
  learnSpellTome(instanceId: string): Promise<{ message: string; learned: LearnedSpell | null }>;
  requestCraft(heroId: string, order: CraftOrder): Promise<void>;
  rollbackEvent(eventId: string): Promise<void>;
  confirmEvent(eventId: string): Promise<void>;
  /**
   * Летопись. Позже — RPC мастера для записей и private.world_clocks.
   * Воспоминание игрока — insert под RLS на видимую запись.
   * TODO(supabase): части «только участникам» и часы мира не отдаются SELECT-ом.
   */
  saveChronicleEntry(input: ChronicleEntryInput): Promise<void>;
  saveChroniclePart(input: ChroniclePartInput): Promise<void>;
  removeChronicleEntry(id: string): Promise<void>;
  addChronicleMemory(entryId: string, body: string): Promise<void>;
  removeChronicleMemory(id: string): Promise<void>;
  saveWorldClock(input: WorldClockInput): Promise<void>;
  advanceWorldClock(clockId: string): Promise<void>;
  saveOmen(input: OmenInput): Promise<void>;
  /**
   * Вики. Позже: gm_reveal_block, сохранение страниц — RPC мастера;
   * заметки игрока — insert в wiki_margins под RLS (личные видит автор и мастер).
   * TODO(supabase): выборка страниц и поиска идёт под RLS, скрытый раздел не приходит клиенту.
   */
  saveWikiPage(input: WikiPageInput): Promise<void>;
  saveWikiBlock(input: WikiBlockInput): Promise<void>;
  removeWikiPage(slug: string): Promise<void>;
  removeWikiBlock(id: string): Promise<void>;
  moveWikiBlock(id: string, dir: -1 | 1): Promise<void>;
  setWikiVisibility(target: WikiTarget, visibility: WikiVisibility, heroIds: string[]): Promise<void>;
  addWikiMargin(input: WikiMarginInput): Promise<void>;
  removeWikiMargin(id: string): Promise<void>;
}

export interface StoreHooks {
  loadWorld(): Promise<World | null>;
  saveWorld(world: World): Promise<void>;
  loadSession(): Session;
  saveSession(session: Session): void;
  now(): string;
  id(): string;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

/**
 * In-memory campaign store. Pages talk only to DataStore.
 * A Supabase implementation can replace the hooks without rewriting the UI:
 * each method maps onto the RPC of the same name (request_change, gm_decide, …).
 */
export class CampaignStore implements DataStore {
  private world: World;
  private session: Session;
  private listeners = new Set<() => void>();
  private readyPromise: Promise<void>;

  constructor(private hooks: StoreHooks) {
    this.world = createSeedWorld();
    this.session = GUEST;
    this.readyPromise = this.hydrate();
  }

  ready(): Promise<void> {
    return this.readyPromise;
  }

  private async hydrate(): Promise<void> {
    this.session = this.hooks.loadSession();
    const saved = await this.hooks.loadWorld();
    if (saved && saved.revision === SEED_REVISION && Array.isArray(saved.heroes)) {
      this.world = saved;
    } else if (saved) {
      this.world = createSeedWorld();
      await this.hooks.saveWorld(this.world);
    }
    if (this.session.role === 'player' || (this.session.role === 'gm' && this.session.preview)) {
      const known = this.world.heroes.some((hero) => hero.id === this.session.heroId);
      if (!known) {
        this.session = { ...this.session, heroId: this.world.heroes[0]?.id ?? null };
        this.hooks.saveSession(this.session);
      }
    }
  }

  getWorld(): World {
    return clone(this.world);
  }

  getSession(): Session {
    return { ...this.session };
  }

  setSession(session: Session): void {
    const next: Session = {
      role: session.role,
      heroId: session.role === 'guest' ? null : session.heroId,
      preview: session.role === 'gm' ? session.preview : false,
    };
    this.session = next;
    this.hooks.saveSession(next);
    this.emit();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private meta(split = false) {
    return {
      id: this.hooks.id(),
      opId: this.hooks.id(),
      now: this.hooks.now(),
      splitId: split ? this.hooks.id() : undefined,
    };
  }

  private async commit(world: World): Promise<void> {
    await this.hooks.saveWorld(world);
    this.world = world;
    this.emit();
  }

  async resetWorld(): Promise<void> {
    await this.ready();
    await this.commit(createSeedWorld());
  }

  async requestSkillMark(heroId: string, skill: string): Promise<void> {
    await this.ready();
    await this.commit(queueSkillMark(this.world, this.session, heroId, skill, this.meta()));
  }

  async requestPerk(heroId: string, perk: string, skill: string): Promise<void> {
    await this.ready();
    await this.commit(queuePerk(this.world, this.session, heroId, perk, skill, this.meta()));
  }

  async requestDrop(instanceId: string): Promise<void> {
    await this.ready();
    await this.commit(queueDrop(this.world, this.session, instanceId, this.meta()));
  }

  async requestTransfer(instanceId: string, toHeroId: string, qty: number): Promise<void> {
    await this.ready();
    await this.commit(queueTransfer(this.world, this.session, instanceId, toHeroId, qty, this.meta(true)));
  }

  async withdrawRequest(id: string): Promise<void> {
    await this.ready();
    await this.commit(withdrawRequest(this.world, this.session, id));
  }

  async withdrawTransfer(id: string): Promise<void> {
    await this.ready();
    await this.commit(withdrawTransfer(this.world, this.session, id, this.hooks.now()));
  }

  async decideRequest(id: string, accept: boolean, comment: string): Promise<void> {
    await this.ready();
    await this.commit(decideRequest(this.world, this.session, id, accept, comment, this.hooks.now()));
  }

  async decideTransfer(id: string, accept: boolean, comment: string): Promise<void> {
    await this.ready();
    await this.commit(decideTransfer(this.world, this.session, id, accept, comment, this.hooks.now()));
  }

  async setEquipped(instanceId: string, worn: boolean): Promise<void> {
    await this.ready();
    await this.commit(setEquipped(this.world, this.session, instanceId, worn, this.hooks.now()));
  }

  async setStat(heroId: string, stat: 'health' | 'magic' | 'stamina', value: number): Promise<void> {
    await this.ready();
    await this.commit(setStat(this.world, this.session, heroId, stat, value, this.meta()));
  }

  async useItem(instanceId: string): Promise<string> {
    await this.ready();
    const result = useItem(this.world, this.session, instanceId, this.meta());
    await this.commit(result.world);
    return result.message;
  }

  async setHand(heroId: string, side: HandSide, fill: HandFill): Promise<void> {
    await this.ready();
    await this.commit(setHand(this.world, this.session, heroId, side, fill, this.meta()));
  }

  async saveLoadout(heroId: string, name: string): Promise<void> {
    await this.ready();
    await this.commit(saveLoadout(this.world, this.session, heroId, name, this.meta()));
  }

  async applyLoadout(heroId: string, loadoutId: string): Promise<void> {
    await this.ready();
    await this.commit(applyLoadout(this.world, this.session, heroId, loadoutId, this.meta()));
  }

  async deleteLoadout(heroId: string, loadoutId: string): Promise<void> {
    await this.ready();
    await this.commit(deleteLoadout(this.world, this.session, heroId, loadoutId, this.meta()));
  }

  async learnSpellTome(instanceId: string): Promise<{ message: string; learned: LearnedSpell | null }> {
    await this.ready();
    const result = learnSpellTome(this.world, this.session, instanceId, this.meta());
    if (result.changed) await this.commit(result.world);
    return { message: result.message, learned: result.learned };
  }

  async rollbackEvent(eventId: string): Promise<void> {
    await this.ready();
    await this.commit(rollbackEvent(this.world, this.session, eventId, this.meta()));
  }

  async confirmEvent(eventId: string): Promise<void> {
    await this.ready();
    await this.commit(confirmEvent(this.world, this.session, eventId, this.meta()));
  }

  async grantItem(heroId: string, itemId: string, qty: number): Promise<void> {
    await this.ready();
    await this.commit(grantItem(this.world, this.session, heroId, itemId, qty, this.meta()));
  }

  async saveNote(heroId: string, body: string): Promise<void> {
    await this.ready();
    await this.commit(saveNote(this.world, this.session, heroId, body, this.meta()));
  }

  async saveChronicleEntry(input: ChronicleEntryInput): Promise<void> {
    await this.ready();
    await this.commit(saveChronicleEntry(this.world, this.session, input, this.meta()));
  }

  async saveChroniclePart(input: ChroniclePartInput): Promise<void> {
    await this.ready();
    await this.commit(saveChroniclePart(this.world, this.session, input, this.meta()));
  }

  async removeChronicleEntry(id: string): Promise<void> {
    await this.ready();
    await this.commit(removeChronicleEntry(this.world, this.session, id));
  }

  async addChronicleMemory(entryId: string, body: string): Promise<void> {
    await this.ready();
    await this.commit(addChronicleMemory(this.world, this.session, entryId, body, this.meta()));
  }

  async removeChronicleMemory(id: string): Promise<void> {
    await this.ready();
    await this.commit(removeChronicleMemory(this.world, this.session, id));
  }

  async saveWorldClock(input: WorldClockInput): Promise<void> {
    await this.ready();
    await this.commit(saveWorldClock(this.world, this.session, input, this.meta()));
  }

  async advanceWorldClock(clockId: string): Promise<void> {
    await this.ready();
    await this.commit(advanceWorldClock(this.world, this.session, clockId));
  }

  async saveOmen(input: OmenInput): Promise<void> {
    await this.ready();
    await this.commit(saveOmen(this.world, this.session, input, this.meta()));
  }

  async saveWikiPage(input: WikiPageInput): Promise<void> {
    await this.ready();
    await this.commit(saveWikiPage(this.world, this.session, input, this.hooks.now()));
  }

  async saveWikiBlock(input: WikiBlockInput): Promise<void> {
    await this.ready();
    await this.commit(saveWikiBlock(this.world, this.session, input, this.meta()));
  }

  async removeWikiPage(slug: string): Promise<void> {
    await this.ready();
    await this.commit(removeWikiPage(this.world, this.session, slug));
  }

  async removeWikiBlock(id: string): Promise<void> {
    await this.ready();
    await this.commit(removeWikiBlock(this.world, this.session, id));
  }

  async moveWikiBlock(id: string, dir: -1 | 1): Promise<void> {
    await this.ready();
    await this.commit(moveWikiBlock(this.world, this.session, id, dir));
  }

  async setWikiVisibility(target: WikiTarget, visibility: WikiVisibility, heroIds: string[]): Promise<void> {
    await this.ready();
    await this.commit(setWikiVisibility(this.world, this.session, target, visibility, heroIds, this.hooks.now()));
  }

  async addWikiMargin(input: WikiMarginInput): Promise<void> {
    await this.ready();
    await this.commit(addWikiMargin(this.world, this.session, input, this.meta()));
  }

  async removeWikiMargin(id: string): Promise<void> {
    await this.ready();
    await this.commit(removeWikiMargin(this.world, this.session, id));
  }

  async requestCraft(heroId: string, order: CraftOrder): Promise<void> {
    await this.ready();
    await this.commit(queueCraft(this.world, this.session, heroId, order, this.meta()));
  }

  async openBook(copyId: string): Promise<{ applied: string | null; pages: { n: number; body: string }[] }> {
    await this.ready();
    const result = openBook(this.world, this.session, copyId, this.meta());
    if (result.changed) await this.commit(result.world);
    return { applied: result.applied, pages: result.pages.map((page) => ({ n: page.n, body: page.body })) };
  }

  async sendLetter(input: { title: string; body: string; from: string; heroIds: string[]; asItem: boolean }): Promise<void> {
    await this.ready();
    await this.commit(sendLetter(this.world, this.session, input, this.meta()));
  }

  async markLetterRead(letterId: string): Promise<void> {
    await this.ready();
    await this.commit(markLetterRead(this.world, this.session, letterId, this.meta()));
  }
}

export function memoryHooks(initial?: { world?: World; session?: Session }): StoreHooks {
  let world = initial?.world ? structuredClone(initial.world) : null;
  let session = initial?.session ? { ...initial.session } : GUEST;
  let n = 0;
  return {
    loadWorld: async () => (world ? structuredClone(world) : null),
    saveWorld: async (next) => {
      world = structuredClone(next);
    },
    loadSession: () => ({ ...session }),
    saveSession: (next) => {
      session = { ...next };
    },
    now: () => '2026-11-04T12:00:00.000Z',
    id: () => `test-${++n}`,
  };
}
