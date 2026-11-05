import type { Q } from './rational';

/**
 * Local mirror of the campaign tables (spec §3).
 * Fields marked «лист» are not Postgres columns yet: the sheet needs them,
 * and a later migration can lift them out. Secrets of the real campaign
 * do not belong in this repo — hero_secrets here are fictional test fixtures.
 */

export type Role = 'guest' | 'player' | 'gm';

export interface Session {
  role: Role;
  heroId: string | null;
  /** GM chrome hidden; mutations act as heroId. Not a logout. */
  preview: boolean;
}

export interface Actor {
  role: Role;
  heroId: string | null;
  preview: boolean;
}

export interface Member {
  user_id: string;
  display_name: string;
  role: 'player' | 'gm';
  joined_at: string;
}

export type HeroStatus = 'alive' | 'wounded' | 'fallen' | 'retired';

export interface Hero {
  id: string;
  slug: string;
  name: string;
  people: string;
  /** лист: подпись игрока на портрете */
  player_label: string;
  age: number | null;
  portrait_path: string | null;
  level: number;
  xp: number;
  xp_next: number;
  health: number;
  magic: number;
  stamina: number;
  health_max: number;
  magic_max: number;
  stamina_max: number;
  coin_crowns: number;
  coin_scales: number;
  coin_copper: number;
  /** лист: расписки Компании, не монета */
  coin_receipts: number;
  status: HeroStatus;
  injuries: string[];
  /** лист */
  death_marks: number;
  bio: string;
  fallen_on: string | null;
  epitaph: string | null;
  /** лист */
  tags: string[];
  /** лист */
  people_ability: { name: string; text: string; ready: boolean };
  /** лист */
  downtime: number;
  downtime_label: string;
  /** лист */
  reputation: { name: string; value: number }[];
  /** Слоты рук. Броня на теле по-прежнему location worn и в руки не входит. */
  hands: Hands;
  loadouts: Loadout[];
  created_at: string;
  updated_at: string;
}

export interface HeroPlayer {
  hero_id: string;
  user_id: string;
}

/** Fictional gift shown to the owner and the GM. carrier_note stays empty. */
export interface HeroSecret {
  hero_id: string;
  gift: string;
  gift_step: string;
  gift_text: string;
  gift_next: string;
  gift_price: string;
  price_track: number;
  price_max: number;
  carrier_note: string | null;
}

export interface SkillRow {
  hero_id: string;
  skill: string;
  value: number;
  marks: number;
}

export interface PerkRow {
  hero_id: string;
  perk: string;
  /** лист: навык для подписи, пока нет каталога перков */
  skill: string;
  taken_at: string;
}

export interface SpellRow {
  hero_id: string;
  spell: string;
  school: string;
  cost: number;
  /** 1 ученик … 5 мастер. Порог навыка: 0 / 25 / 50 / 75 / 100. */
  tier: number;
}

export interface KnowledgeRow {
  hero_id: string;
  kind: 'ingredient_prop' | 'recipe' | 'blueprint' | 'language';
  ref: string;
  detail: string;
}

export type ItemKind =
  | 'weapon'
  | 'armor'
  | 'ammo'
  | 'potion'
  | 'ingredient'
  | 'book'
  | 'note'
  | 'soulgem'
  | 'tool'
  | 'misc'
  /** Свиток знания: название заклинания в props.spell, игроку его не показывают. */
  | 'spell_tome'
  /** Одноразовый боевой свиток, его берут в руку. */
  | 'combat_scroll';

/** Как вещь садится в руку. Лук, арбалет и двуручное занимают обе. */
export type Wield = 'one' | 'two' | 'bow' | 'crossbow' | 'staff' | 'shield' | 'torch' | 'combat_scroll';

export type HandSide = 'left' | 'right';

export type HandFill =
  | null
  | { kind: 'item'; instanceId: string; grip: 'one' | 'both' }
  | { kind: 'spell'; spell: string };

export interface Hands {
  left: HandFill;
  right: HandFill;
}

/** До четырёх наборов, как избранное в Скайриме. */
export interface Loadout {
  id: string;
  name: string;
  hands: Hands;
}

export interface ItemEffect {
  stat: 'health' | 'magic' | 'stamina';
  amount: number;
}

export interface Item {
  id: string;
  name: string;
  kind: ItemKind;
  /** Weight of a single unit, in slots. */
  weight: Q;
  /** Price of one lot, in crowns. 0 = no price. */
  price: number;
  /** Units per priced lot. Arrows: 20 arrows cost `price` together. */
  lot: number;
  props: Record<string, unknown>;
  public_desc: string;
}

export type ItemLocation = 'bag' | 'worn' | 'stash' | 'ground' | 'in_transfer';

export interface ItemInstance {
  id: string;
  item_id: string;
  qty: number;
  owner_hero_id: string;
  location: ItemLocation;
  custom_name: string | null;
  props: Record<string, unknown>;
  secret: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type TransferKind = 'give' | 'gm_grant' | 'gm_take' | 'trade';
export type TransferStatus = 'done' | 'pending' | 'rejected';

export interface Transfer {
  id: string;
  instance_id: string;
  item_id: string;
  qty: number;
  from_hero: string;
  to_hero: string;
  kind: TransferKind;
  status: TransferStatus;
  reason: string | null;
  client_op_id: string;
  created_by: string;
  created_at: string;
}

export type ChangeKind =
  | 'perk'
  | 'level_up'
  | 'skill_mark'
  | 'craft'
  | 'book_read'
  | 'rumor'
  | 'buy'
  | 'sell'
  | 'spell'
  | 'other';

export type ChangeStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';

export interface ChangeRequest {
  id: string;
  hero_id: string;
  kind: ChangeKind;
  payload: Record<string, unknown>;
  summary: string;
  status: ChangeStatus;
  gm_comment: string | null;
  decided_by: string | null;
  decided_at: string | null;
  client_op_id: string;
  created_at: string;
}

export interface Rumor {
  id: string;
  hero_id: string;
  text: string;
  heard_where: string;
  status: 'pending' | 'published' | 'kept_gm' | 'rejected';
  anonymous: boolean;
}

export interface Quest {
  id: string;
  hero_id: string;
  title: string;
  status: 'active' | 'done';
  steps: { text: string; done: boolean }[];
  margin: string | null;
}

export interface Note {
  id: string;
  hero_id: string;
  target: string;
  body: string;
  created_at: string;
}

export type AuditSource = 'player' | 'gm' | 'system';

/**
 * Журнал аудита. Каждая правка листа — событие.
 * TODO(supabase): настоящий audit_log пишет триггер; здесь тот же смысл в локальном мире.
 */
export interface AuditEvent {
  id: string;
  at: string;
  hero_id: string;
  actor_label: string;
  source: AuditSource;
  action: string;
  summary: string;
  before: unknown;
  after: unknown;
  /** Как вернуть лист. null — откат не предложен. */
  undo: unknown;
  reverted_by: string | null;
  /** id события, которое мастер подтвердил. */
  confirms: string | null;
  session_id: string | null;
  backdated: boolean;
}

export interface GameSession {
  id: string;
  starts_at: string;
  game_date: string;
  title: string;
  status: 'planned' | 'live' | 'done';
  table_heroes: string[];
}

export interface World {
  revision: number;
  members: Member[];
  heroes: Hero[];
  hero_players: HeroPlayer[];
  hero_secrets: HeroSecret[];
  skills: SkillRow[];
  perks: PerkRow[];
  spells: SpellRow[];
  knowledge: KnowledgeRow[];
  items: Item[];
  item_instances: ItemInstance[];
  transfers: Transfer[];
  change_requests: ChangeRequest[];
  rumors: Rumor[];
  quests: Quest[];
  notes: Note[];
  sessions: GameSession[];
  audit_log: AuditEvent[];
  books: Book[];
  book_pages: BookPage[];
  book_copies: BookCopy[];
  letters: Letter[];
  letter_recipients: LetterRecipient[];
}

export const SEED_REVISION = 3;

export interface Book {
  id: string;
  title: string;
  author: string;
  /** Обучающая книга: бонус один раз первому прочтению держателя. */
  skill_bonus: { skill: string; amount: number } | null;
}

export interface BookPage {
  book_id: string;
  n: number;
  body: string;
}

export interface BookCopy {
  id: string;
  book_id: string;
  holder_hero_id: string;
  instance_id: string;
  first_read_by: string[];
}

export interface Letter {
  id: string;
  from_label: string;
  title: string;
  body: string;
  created_at: string;
}

export interface LetterRecipient {
  letter_id: string;
  hero_id: string;
  read_at: string | null;
  holder: boolean;
}

export interface OpMeta {
  id: string;
  opId: string;
  now: string;
  /** Second id when a transfer splits a stack. */
  splitId?: string;
}
