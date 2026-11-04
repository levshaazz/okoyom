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
import type { LearnedSpell } from './combat';
import { queueCraft, type CraftOrder } from './craft';
import type { HandFill, HandSide } from './types';
import type { Session, World } from './types';
import { SEED_REVISION } from './types';

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
  setHand(heroId: string, side: HandSide, fill: HandFill): Promise<void>;
  saveLoadout(heroId: string, name: string): Promise<void>;
  applyLoadout(heroId: string, loadoutId: string): Promise<void>;
  deleteLoadout(heroId: string, loadoutId: string): Promise<void>;
  learnSpellTome(instanceId: string): Promise<{ message: string; learned: LearnedSpell | null }>;
  requestCraft(heroId: string, order: CraftOrder): Promise<void>;
  rollbackEvent(eventId: string): Promise<void>;
  confirmEvent(eventId: string): Promise<void>;
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

  async requestCraft(heroId: string, order: CraftOrder): Promise<void> {
    await this.ready();
    await this.commit(queueCraft(this.world, this.session, heroId, order, this.meta()));
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
