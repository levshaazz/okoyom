import { useEffect, useRef, useState } from 'preact/hooks';
import { isGm } from '../lib/domain';
import { href } from '../lib/paths';
import {
  MARKER_KINDS,
  cellOf,
  isRevealed,
  markerLabel,
  openToAll,
  visibleCells,
  visibleMarkers,
  visiblePins,
  type MarkerInput,
} from '../lib/map';
import type { Actor, MapMarker, MapMarkerKind, MapTerrain, World } from '../lib/types';
import { Notices, useNotice } from './bits';
import { useCampaign } from './use-campaign';

const WORLD_W = 1000;
const WORLD_H = 700;

interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Drag {
  kind: 'pan' | 'marker' | 'pinch';
  id?: string;
  lx: number;
  ly: number;
  moved: number;
  dist: number;
}

const FILL: Record<MapTerrain, string> = {
  sea: '#6d8494',
  coast: '#cbb892',
  marsh: '#6d7c5c',
  forest: '#3f5340',
  hills: '#8d7d58',
  road: '#c4a36a',
};

function playing(actor: Actor): boolean {
  return actor.role === 'player' || (actor.role === 'gm' && actor.preview && Boolean(actor.heroId));
}

function actorOf(session: { role: Actor['role']; heroId: string | null; preview: boolean }): Actor {
  return { role: session.role, heroId: session.heroId, preview: session.role === 'gm' ? session.preview : false };
}

function worldPoint(svg: SVGSVGElement, clientX: number, clientY: number, view: View) {
  const rect = svg.getBoundingClientRect();
  const px = (clientX - rect.left) / rect.width;
  const py = (clientY - rect.top) / rect.height;
  return { x: view.x + px * view.w, y: view.y + py * view.h };
}

function clampView(view: View): View {
  const w = Math.min(1200, Math.max(240, view.w));
  const h = Math.min(840, Math.max(168, view.h));
  return {
    w,
    h,
    x: Math.min(WORLD_W - w * 0.25, Math.max(-w * 0.25, view.x)),
    y: Math.min(WORLD_H - h * 0.25, Math.max(-h * 0.25, view.y)),
  };
}

export default function MapApp() {
  const { store, session, world, booting, bootError } = useCampaign();
  const svgRef = useRef<SVGSVGElement>(null);
  const viewRef = useRef<View>({ x: 40, y: 40, w: 780, h: 546 });
  const [view, setView] = useState<View>(viewRef.current);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<Drag | null>(null);
  const [ghost, setGhostState] = useState<{ id: string; x: number; y: number } | null>(null);
  const ghostRef = useRef<{ id: string; x: number; y: number } | null>(null);
  function setGhost(value: { id: string; x: number; y: number } | null) {
    ghostRef.current = value;
    setGhostState(value);
  }
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<'look' | 'fog' | 'place' | 'pin'>('look');
  const [fogOpen, setFogOpen] = useState(true);
  const [fogHero, setFogHero] = useState<string>('all');
  const [pinLabel, setPinLabel] = useState('');
  const notice = useNotice();

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const current = viewRef.current;
      const rect = svg.getBoundingClientRect();
      const px = (event.clientX - rect.left) / rect.width;
      const py = (event.clientY - rect.top) / rect.height;
      const factor = event.deltaY > 0 ? 1.12 : 0.89;
      const w = current.w * factor;
      const h = current.h * factor;
      const fx = current.x + px * current.w;
      const fy = current.y + py * current.h;
      const next = clampView({ x: fx - px * w, y: fy - py * h, w, h });
      viewRef.current = next;
      setView(next);
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [booting, world]);

  if (bootError) return <p class="page">{bootError}</p>;
  if (booting || !world || !session) return <p class="page dim">Открываем карту…</p>;

  const actor = actorOf(session);
  const gm = isGm(actor);
  const markers = visibleMarkers(world, actor);
  const cells = visibleCells(world, actor);
  const pins = visiblePins(world, actor);
  const selectedMarker = markers.find((marker) => marker.id === selected) ?? null;
  const cellSize = WORLD_W / world.world_map.cols;
  const sheet = world.world_map;

  function zoom(factor: number) {
    const current = viewRef.current;
    const w = current.w * factor;
    const h = current.h * factor;
    const next = clampView({
      x: current.x + (current.w - w) / 2,
      y: current.y + (current.h - h) / 2,
      w,
      h,
    });
    viewRef.current = next;
    setView(next);
  }

  async function run(action: () => Promise<void>, ok?: string) {
    try {
      await action();
      if (ok) notice.flash(ok);
    } catch (reason) {
      notice.fail(reason);
    }
  }

  function onPointerDown(event: PointerEvent) {
    const svg = svgRef.current;
    if (!svg) return;
    svg.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const markerNode = (event.target as Element).closest?.('[data-marker]');
    const markerId = markerNode?.getAttribute('data-marker');
    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      drag.current = { kind: 'pinch', lx: event.clientX, ly: event.clientY, moved: 0, dist: Math.hypot(a.x - b.x, a.y - b.y) };
      return;
    }
    if (markerId && gm && mode !== 'fog') {
      drag.current = { kind: 'marker', id: markerId, lx: event.clientX, ly: event.clientY, moved: 0, dist: 0 };
      setSelected(markerId);
      return;
    }
    drag.current = { kind: 'pan', lx: event.clientX, ly: event.clientY, moved: 0, dist: 0 };
  }

  function onPointerMove(event: PointerEvent) {
    const svg = svgRef.current;
    const currentDrag = drag.current;
    if (!svg || !currentDrag) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (currentDrag.kind === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (currentDrag.dist > 0 && dist > 0) {
        const factor = currentDrag.dist / dist;
        const current = viewRef.current;
        const w = current.w * factor;
        const h = current.h * factor;
        const next = clampView({
          x: current.x + (current.w - w) / 2,
          y: current.y + (current.h - h) / 2,
          w,
          h,
        });
        viewRef.current = next;
        setView(next);
        currentDrag.dist = dist;
      }
      return;
    }
    const dx = event.clientX - currentDrag.lx;
    const dy = event.clientY - currentDrag.ly;
    currentDrag.moved += Math.abs(dx) + Math.abs(dy);
    currentDrag.lx = event.clientX;
    currentDrag.ly = event.clientY;
    if (currentDrag.kind === 'marker' && currentDrag.id) {
      const point = worldPoint(svg, event.clientX, event.clientY, viewRef.current);
      setGhost({ id: currentDrag.id, x: point.x / WORLD_W, y: point.y / WORLD_H });
      return;
    }
    const rect = svg.getBoundingClientRect();
    const current = viewRef.current;
    const next = clampView({
      ...current,
      x: current.x - dx * (current.w / rect.width),
      y: current.y - dy * (current.h / rect.height),
    });
    viewRef.current = next;
    setView(next);
  }

  function onPointerUp(event: PointerEvent) {
    const svg = svgRef.current;
    const currentDrag = drag.current;
    pointers.current.delete(event.pointerId);
    if (!svg || !currentDrag) return;
    const moved = currentDrag.moved;
    const markerId = currentDrag.id;
    drag.current = pointers.current.size ? drag.current : null;
    if (currentDrag.kind === 'marker' && markerId && ghostRef.current && moved > 6) {
      const point = ghostRef.current;
      setGhost(null);
      void run(() => store.moveMarker(markerId, point.x, point.y));
      return;
    }
    setGhost(null);
    if (moved > 6) return;
    const point = worldPoint(svg, event.clientX, event.clientY, viewRef.current);
    const fx = point.x / WORLD_W;
    const fy = point.y / WORLD_H;
    const cell = cellOf(sheet, fx, fy);
    if (gm && mode === 'fog') {
      const scope = fogHero === 'all' ? 'all' : 'hero';
      const heroIds = fogHero === 'all' ? [] : [fogHero];
      void run(() => store.paintCells([cell], scope, heroIds, fogOpen), fogOpen ? 'Клетка открыта.' : 'Клетка снова в тумане.');
      return;
    }
    if (gm && mode === 'place') {
      void run(
        () =>
          store.saveMarker({
            id: null,
            x: fx,
            y: fy,
            kind: 'town',
            endonym: '',
            nameRu: 'Новая метка',
            nameState: 'ru',
            visibility: 'gm',
            heroIds: [],
            wikiSlug: '',
          }),
        'Метка поставлена. Пока её видит только мастер.',
      );
      return;
    }
    if (playing(actor) && mode === 'pin') {
      if (!pinLabel.trim()) {
        notice.fail(new Error('Сначала подпишите пометку.'));
        return;
      }
      void run(() => store.addMapPin(fx, fy, pinLabel), 'Пометка поставлена.');
      setPinLabel('');
      setMode('look');
    }
  }

  function markerPoint(marker: MapMarker) {
    if (ghost && ghost.id === marker.id) return { x: ghost.x * WORLD_W, y: ghost.y * WORLD_H };
    return { x: marker.x * WORLD_W, y: marker.y * WORLD_H };
  }

  return (
    <div class="map-stage">
      <Notices error={notice.error} toast={notice.toast} />
      <svg
        ref={svgRef}
        class="map-svg"
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <rect x={-40} y={-40} width={WORLD_W + 80} height={WORLD_H + 80} class="map-board" />
        {world.world_map.image_data && (
          <image href={world.world_map.image_data} x={0} y={0} width={WORLD_W} height={WORLD_H} />
        )}
        {!world.world_map.image_data &&
          cells.map((cell) => <Terrain key={`${cell.cx}-${cell.cy}`} cx={cell.cx} cy={cell.cy} terrain={cell.terrain} size={cellSize} />)}
        {world.map_cells
          .filter((cell) => (gm ? !openToAll(world, cell.cx, cell.cy) : !isRevealed(world, actor, cell.cx, cell.cy)))
          .map((cell) => (
            <rect
              key={`fog-${cell.cx}-${cell.cy}`}
              x={cell.cx * cellSize}
              y={cell.cy * cellSize}
              width={cellSize + 1}
              height={cellSize + 1}
              class={gm ? 'map-fog edit' : 'map-fog'}
            />
          ))}
        {markers.map((marker) => {
          const point = markerPoint(marker);
          const label = markerLabel(marker, actor);
          return (
            <g
              key={marker.id}
              data-marker={marker.id}
              transform={`translate(${point.x} ${point.y})`}
              class={selected === marker.id ? 'map-marker on' : 'map-marker'}
            >
              <MarkerShape kind={marker.kind} />
              <text y={-18} textAnchor="middle" class={marker.name_state === 'unknown' && !gm ? 'map-name unknown' : 'map-name'}>
                {label.primary}
              </text>
              {label.secondary && (
                <text y={20} textAnchor="middle" class="map-sub">
                  {label.secondary}
                </text>
              )}
            </g>
          );
        })}
        {pins.map((pin) => (
          <g key={pin.id} transform={`translate(${pin.x * WORLD_W} ${pin.y * WORLD_H})`} class="map-note">
            <path d="M0 16 C -8 6 -10 2 -10 -2 a10 10 0 0 1 20 0 c0 4 -2 8 -10 18z" />
            <text y={-8} textAnchor="middle" class="map-note-label">
              {pin.label}
            </text>
          </g>
        ))}
      </svg>
      <div class="map-zoom">
        <button type="button" onClick={() => zoom(0.85)} aria-label="Приблизить">
          +
        </button>
        <button type="button" onClick={() => zoom(1.18)} aria-label="Отдалить">
          −
        </button>
      </div>
      <div class="map-tools">
        {gm && (
          <>
            <button type="button" class={mode === 'look' ? 'chip on' : 'chip'} onClick={() => setMode('look')}>
              Смотреть
            </button>
            <button type="button" class={mode === 'fog' ? 'chip on' : 'chip'} onClick={() => setMode('fog')}>
              Туман
            </button>
            <button type="button" class={mode === 'place' ? 'chip on' : 'chip'} onClick={() => setMode('place')}>
              Метка
            </button>
          </>
        )}
        {playing(actor) && (
          <button type="button" class={mode === 'pin' ? 'chip on' : 'chip'} onClick={() => setMode('pin')}>
            Моя пометка
          </button>
        )}
      </div>
      {gm && mode === 'fog' && (
        <div class="map-fog-bar">
          <button type="button" class={fogOpen ? 'chip on' : 'chip'} onClick={() => setFogOpen(true)}>
            Открыть
          </button>
          <button type="button" class={!fogOpen ? 'chip on' : 'chip'} onClick={() => setFogOpen(false)}>
            Закрыть
          </button>
          <label class="xs dim">
            кому
            <select value={fogHero} onChange={(event) => setFogHero((event.currentTarget as HTMLSelectElement).value)}>
              <option value="all">всем</option>
              {world.heroes.map((hero) => (
                <option key={hero.id} value={hero.id}>
                  {hero.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {playing(actor) && mode === 'pin' && (
        <form
          class="map-pin-form"
          onSubmit={(event) => {
            event.preventDefault();
          }}
        >
          <input
            value={pinLabel}
            placeholder="Текст пометки, затем коснитесь карты"
            onInput={(event) => setPinLabel((event.currentTarget as HTMLInputElement).value)}
          />
        </form>
      )}
      {selectedMarker && (
        <MarkerCard
          key={selectedMarker.id}
          world={world}
          actor={actor}
          marker={selectedMarker}
          onClose={() => setSelected(null)}
          onSave={(input) => run(() => store.saveMarker(input), 'Метка сохранена.')}
          onDrop={() =>
            run(async () => {
              await store.removeMarker(selectedMarker.id);
              setSelected(null);
            }, 'Метка снята.')
          }
        />
      )}
      {gm && <Underlay world={world} onSet={(data) => run(() => store.setMapImage(data), data ? 'Подложка заменена в этом браузере.' : 'Снова тестовый берег.')} />}
      <p class="map-scale">
        <span />
        учебный берег
      </p>
    </div>
  );
}

function Terrain({ cx, cy, terrain, size }: { cx: number; cy: number; terrain: MapTerrain; size: number }) {
  const x = cx * size;
  const y = cy * size;
  const shift = ((cx * 3 + cy * 5) % 7) * 6;
  return (
    <g>
      <rect x={x} y={y} width={size + 0.5} height={size + 0.5} fill={FILL[terrain]} />
      {terrain === 'sea' && <path d={`M${x + 8} ${y + 30} q 12 -8 24 0 t 24 0`} class="map-wave" />}
      {terrain === 'forest' && (
        <>
          <circle cx={x + 28 + shift} cy={y + 40} r={9} class="map-tree" />
          <circle cx={x + 52} cy={y + 62} r={7} class="map-tree" />
        </>
      )}
      {terrain === 'hills' && <path d={`M${x + 10} ${y + 70} q 20 -36 40 0 t 40 0`} class="map-hill" />}
      {terrain === 'coast' && <path d={`M${x} ${y + 20} q 20 16 40 0 t 40 4`} class="map-shore" />}
      {terrain === 'marsh' && <circle cx={x + 40} cy={y + 48} r={4} class="map-pool" />}
    </g>
  );
}

function MarkerShape({ kind }: { kind: MapMarkerKind }) {
  if (kind === 'city') return <rect x={-5} y={-5} width={10} height={10} transform="rotate(45)" class="map-shape city" />;
  if (kind === 'ruin') return <path d="M-7 5 L-7 -1 L0 -7 L7 -1 L7 5 Z" class="map-shape ruin" />;
  if (kind === 'cave') return <path d="M-8 5 Q0 -8 8 5 Z" class="map-shape cave" />;
  if (kind === 'camp') return <path d="M0 -7 L5 5 L-5 5 Z" class="map-shape camp" />;
  if (kind === 'wild') return <circle r={4} class="map-shape wild" />;
  return <circle r={5} class="map-shape town" />;
}

function MarkerCard({
  world,
  actor,
  marker,
  onClose,
  onSave,
  onDrop,
}: {
  world: World;
  actor: Actor;
  marker: MapMarker;
  onClose: () => void;
  onSave: (input: MarkerInput) => void;
  onDrop: () => void;
}) {
  const label = markerLabel(marker, actor);
  const gm = isGm(actor);
  const [draft, setDraft] = useState<MarkerInput>({
    id: marker.id,
    x: marker.x,
    y: marker.y,
    kind: marker.kind,
    endonym: marker.endonym,
    nameRu: marker.name_ru,
    nameState: marker.name_state,
    visibility: marker.visibility,
    heroIds: marker.hero_ids,
    wikiSlug: marker.wiki_slug ?? '',
  });
  const link = marker.wiki_slug && (gm || marker.name_state !== 'unknown');

  return (
    <aside class="map-card">
      <div class="row spread">
        <div class="xs dim asc">{MARKER_KINDS.find((row) => row.id === marker.kind)?.label}</div>
        <button type="button" class="btn ghost sm" onClick={onClose}>
          Закрыть
        </button>
      </div>
      <div class="map-card-title">{label.primary}</div>
      {label.secondary && <p class="small dim">{label.secondary}</p>}
      {link && (
        <a class="btn sm" href={href(`/viki#${marker.wiki_slug}`)}>
          Статья в вики
        </a>
      )}
      {gm && (
        <form
          class="map-edit"
          onSubmit={(event) => {
            event.preventDefault();
            onSave({ ...draft, x: marker.x, y: marker.y });
          }}
        >
          <label>
            Русское имя
            <input value={draft.nameRu} onInput={(event) => setDraft({ ...draft, nameRu: (event.currentTarget as HTMLInputElement).value })} />
          </label>
          <label>
            Самоназвание
            <input value={draft.endonym} onInput={(event) => setDraft({ ...draft, endonym: (event.currentTarget as HTMLInputElement).value })} />
          </label>
          <label>
            Значок
            <select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: (event.currentTarget as HTMLSelectElement).value as MapMarkerKind })}>
              {MARKER_KINDS.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.label}
                </option>
              ))}
            </select>
          </label>
          <div class="chip-row">
            <button type="button" class={draft.nameState === 'unknown' ? 'chip on' : 'chip'} onClick={() => setDraft({ ...draft, nameState: 'unknown' })}>
              ?
            </button>
            <button type="button" class={draft.nameState === 'ru' ? 'chip on' : 'chip'} onClick={() => setDraft({ ...draft, nameState: 'ru' })}>
              по-русски
            </button>
            <button type="button" class={draft.nameState === 'full' ? 'chip on' : 'chip'} onClick={() => setDraft({ ...draft, nameState: 'full' })}>
              самоназвание
            </button>
          </div>
          <div class="chip-row">
            <button type="button" class={draft.visibility === 'public' ? 'chip on' : 'chip'} onClick={() => setDraft({ ...draft, visibility: 'public' })}>
              всем
            </button>
            <button type="button" class={draft.visibility === 'players' ? 'chip on' : 'chip'} onClick={() => setDraft({ ...draft, visibility: 'players' })}>
              ходокам
            </button>
            <button type="button" class={draft.visibility === 'heroes' ? 'chip on' : 'chip'} onClick={() => setDraft({ ...draft, visibility: 'heroes' })}>
              героям
            </button>
            <button type="button" class={draft.visibility === 'gm' ? 'chip on' : 'chip'} onClick={() => setDraft({ ...draft, visibility: 'gm' })}>
              только мне
            </button>
          </div>
          {draft.visibility === 'heroes' && (
            <div class="check-row">
              {world.heroes.map((hero) => (
                <label key={hero.id} class="check">
                  <input
                    type="checkbox"
                    checked={draft.heroIds.includes(hero.id)}
                    onChange={() =>
                      setDraft({
                        ...draft,
                        heroIds: draft.heroIds.includes(hero.id)
                          ? draft.heroIds.filter((id) => id !== hero.id)
                          : [...draft.heroIds, hero.id],
                      })
                    }
                  />
                  {hero.name}
                </label>
              ))}
            </div>
          )}
          <label>
            Адрес вики
            <input value={draft.wikiSlug} onInput={(event) => setDraft({ ...draft, wikiSlug: (event.currentTarget as HTMLInputElement).value })} />
          </label>
          <div class="row">
            <button type="submit" class="btn pri sm">
              Сохранить
            </button>
            <button type="button" class="btn red sm" onClick={onDrop}>
              Снять
            </button>
          </div>
          <p class="xs dim">Тащите метку, чтобы сдвинуть. Подложка ниже — пробный рисунок, настоящую карту сюда не кладём.</p>
        </form>
      )}
    </aside>
  );
}

function Underlay({ world, onSet }: { world: World; onSet: (data: string | null) => void }) {
  return (
    <form class="map-underlay">
      <label class="xs dim">
        Подложка
        <input
          type="file"
          accept="image/*"
          onChange={(event) => {
            const file = (event.currentTarget as HTMLInputElement).files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
              const result = typeof reader.result === 'string' ? reader.result : null;
              onSet(result);
            };
            reader.readAsDataURL(file);
          }}
        />
      </label>
      {world.world_map.image_data && (
        <button type="button" class="btn ghost sm" onClick={() => onSet(null)}>
          Тестовый берег
        </button>
      )}
    </form>
  );
}
