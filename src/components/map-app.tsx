import { useEffect, useRef, useState } from 'preact/hooks';
import { isGm } from '../lib/domain';
import { href } from '../lib/paths';
import { MAP_MANIFEST } from '../data/map-manifest';
import { sampleColor } from '../lib/map-height';
import {
  FOG_SIZE,
  cellOf,
  isRevealed,
  markerLabel,
  rasterFog,
  visibleMarkers,
  visiblePins,
} from '../lib/map';
import type { Actor, MapMarker, World } from '../lib/types';
import { Notices, useNotice } from './bits';
import type { SceneLayers } from '../lib/map-view-model';
import type { MapScene } from './map-scene';
import { useCampaign } from './use-campaign';

function actorOf(session: { role: Actor['role']; heroId: string | null; preview: boolean }): Actor {
  return { role: session.role, heroId: session.heroId, preview: session.role === 'gm' ? session.preview : false };
}

const LAYERS: SceneLayers = {
  places: true,
  threats: true,
  rumors: true,
  pins: true,
  routes: false,
  party: false,
  endonym: true,
  translation: true,
};

export default function MapApp() {
  const { store, session, world, booting, bootError } = useCampaign();
  const stageRef = useRef<HTMLDivElement>(null);
  const glRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<MapScene | null>(null);
  const handlers = useRef({ onMarker: (_id: string) => {}, onGround: (_x: number, _y: number) => {} });
  const [sceneReady, setSceneReady] = useState(false);
  const [flat, setFlat] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [layers, setLayers] = useState<SceneLayers>(LAYERS);
  const [mode, setMode] = useState<'look' | 'fog' | 'place' | 'pin'>('look');
  const [fogOpen, setFogOpen] = useState(true);
  const [fogHero, setFogHero] = useState('all');
  const [pinLabel, setPinLabel] = useState('');
  const notice = useNotice();

  const actor = session ? actorOf(session) : null;
  const gm = actor ? isGm(actor) : false;

  useEffect(() => {
    if (!world || !glRef.current || !overlayRef.current) return;
    let dead = false;
    const canvas = glRef.current;
    const overlay = overlayRef.current;
    void import('./map-scene')
      .then(async (mod) => {
        if (!mod.canUseWebGL()) {
          setFlat(true);
          return;
        }
        const mobile = window.matchMedia('(max-width: 800px)').matches;
        const scene = await mod.mountMapScene(canvas, overlay, mobile, {
          onMarker: (id) => handlers.current.onMarker(id),
          onGround: (x, y) => handlers.current.onGround(x, y),
        });
        if (dead) {
          scene.dispose();
          return;
        }
        sceneRef.current = scene;
        setSceneReady(true);
      })
      .catch(() => setFlat(true));
    return () => {
      dead = true;
      sceneRef.current?.dispose();
      sceneRef.current = null;
      setSceneReady(false);
    };
  }, [Boolean(world)]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(() => sceneRef.current?.resize());
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !world || !actor) return;
    scene.setFog(rasterFog(world, actor, FOG_SIZE), FOG_SIZE);
    scene.setLayers(layers);
    scene.setMarkers(
      visibleMarkers(world, actor).map((marker) => {
        const label = markerLabel(marker, actor);
        return {
          id: marker.id,
          x: marker.x,
          y: marker.y,
          primary: label.primary,
          secondary: label.secondary,
          rumor: marker.rumor || marker.name_state === 'unknown',
        };
      }),
    );
    scene.setPins(
      visiblePins(world, actor).map((pin) => ({
        x: pin.x,
        y: pin.y,
        label: pin.label,
        shared: pin.shared,
      })),
    );
    scene.setZones(
      world.map_zones.filter((zone) => {
        const cell = cellOf(world.world_map, zone.x, zone.y);
        return isRevealed(world, actor, cell.cx, cell.cy);
      }),
    );
    scene.setRoutes(
      world.map_routes.filter((route) =>
        route.points.some((point) => {
          const cell = cellOf(world.world_map, point.x, point.y);
          return isRevealed(world, actor, cell.cx, cell.cy);
        }),
      ),
    );
    scene.setAlbedo(world.world_map.image_data);
  }, [world, session, layers, sceneReady]);

  if (bootError) return <p class="page">{bootError}</p>;
  if (booting || !world || !session || !actor) return <p class="page dim">Открываем карту…</p>;

  const markers = visibleMarkers(world, actor);
  const current = markers.find((marker) => marker.id === selected) ?? null;

  async function run(action: () => Promise<void>, ok?: string) {
    try {
      await action();
      if (ok) notice.flash(ok);
    } catch (reason) {
      notice.fail(reason);
    }
  }

  handlers.current.onMarker = (id) => setSelected(id);
  handlers.current.onGround = (x, y) => {
    if (mode === 'look') {
      setSelected(null);
      return;
    }
    if (!gm && mode !== 'pin') return;
    const cell = cellOf(world.world_map, x, y);
    if (gm && mode === 'fog') {
      const scope = fogHero === 'all' ? 'all' : 'hero';
      void run(
        () => store.paintCells([cell], scope, fogHero === 'all' ? [] : [fogHero], fogOpen),
        fogOpen ? 'Туман редеет.' : 'Клетка снова в тумане.',
      );
      return;
    }
    if (gm && mode === 'place') {
      void run(
        () =>
          store.saveMarker({
            id: null,
            x,
            y,
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
    if (mode === 'pin') {
      if (!pinLabel.trim()) {
        notice.fail(new Error('Сначала подпишите пометку.'));
        return;
      }
      void run(() => store.addMapPin(x, y, pinLabel), 'Пометка поставлена.');
      setPinLabel('');
      setMode('look');
    }
  };

  function toggle<K extends keyof SceneLayers>(key: K) {
    setLayers((currentLayers) => ({ ...currentLayers, [key]: !currentLayers[key] }));
  }

  return (
    <div class="map-stage" ref={stageRef}>
      <Notices error={notice.error} toast={notice.toast} />
      {flat ? (
        <FlatMap world={world} actor={actor} onMarker={(id) => setSelected(id)} />
      ) : (
        <>
          <canvas ref={glRef} class="map-gl" />
          <canvas ref={overlayRef} class="map-overlay" />
        </>
      )}
      <div class="map-zoom">
        <button type="button" onClick={() => sceneRef.current?.zoom(0.86)} aria-label="Приблизить">
          +
        </button>
        <button type="button" onClick={() => sceneRef.current?.zoom(1.16)} aria-label="Отдалить">
          −
        </button>
      </div>
      <button type="button" class="map-north" onClick={() => sceneRef.current?.north()}>
        На север
      </button>
      <aside class="map-layers">
        <div class="ptitle">Слои</div>
        <Layer on={layers.places} label="Открытые места" click={() => toggle('places')} />
        <Layer on={layers.threats} label="Зоны угрозы" click={() => toggle('threats')} />
        <Layer on={layers.rumors} label="Слухи (непроверено)" rumor click={() => toggle('rumors')} />
        <Layer on={layers.pins} label="Мои метки" click={() => toggle('pins')} />
        <Layer on={layers.routes} label="Маршруты вылазок" click={() => toggle('routes')} />
        <Layer on={layers.party} label="Метки отряда" click={() => toggle('party')} />
        <div class="rule" />
        <div class="xs dim">Подписи</div>
        <div class="chip-row">
          <button type="button" class={layers.endonym ? 'chip on' : 'chip'} onClick={() => toggle('endonym')}>
            Самоназвание
          </button>
          <button type="button" class={layers.translation ? 'chip on' : 'chip'} onClick={() => toggle('translation')}>
            Перевод
          </button>
        </div>
        {gm && (
          <>
            <div class="rule" />
            <div class="chip-row">
              <button type="button" class={mode === 'look' ? 'chip on' : 'chip'} onClick={() => setMode('look')}>
                Смотреть
              </button>
              <button type="button" class={mode === 'fog' ? 'chip on' : 'chip'} onClick={() => setMode('fog')}>
                Туман
              </button>
              <button type="button" class={mode === 'place' ? 'chip on' : 'chip'} onClick={() => setMode('place')}>
                Метка
              </button>
            </div>
            {mode === 'fog' && (
              <div class="map-fog-tools">
                <button type="button" class={fogOpen ? 'chip on' : 'chip'} onClick={() => setFogOpen(true)}>
                  Открыть
                </button>
                <button type="button" class={!fogOpen ? 'chip on' : 'chip'} onClick={() => setFogOpen(false)}>
                  Закрыть
                </button>
                <select value={fogHero} onChange={(event) => setFogHero((event.currentTarget as HTMLSelectElement).value)}>
                  <option value="all">всем</option>
                  {world.heroes.map((hero) => (
                    <option key={hero.id} value={hero.id}>
                      {hero.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <label class="map-file xs dim">
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
                    void run(() => store.setMapImage(result), 'Подложка в этом браузере.');
                  };
                  reader.readAsDataURL(file);
                }}
              />
            </label>
          </>
        )}
        {actor.role === 'player' && (
          <form
            class="map-pin-form"
            onSubmit={(event) => {
              event.preventDefault();
              setMode('pin');
            }}
          >
            <input
              value={pinLabel}
              placeholder="Моя пометка"
              onInput={(event) => setPinLabel((event.currentTarget as HTMLInputElement).value)}
            />
            <button type="submit" class="btn sm">
              Поставить
            </button>
          </form>
        )}
        <p class="xs dim map-hint">
          Левая кнопка — сдвиг, правая или два пальца — наклон и поворот, колесо — масштаб. Туман закрывает неоткрытое.
        </p>
      </aside>
      {current && (
        <InfoCard
          marker={current}
          actor={actor}
          onClose={() => setSelected(null)}
          onSave={(patch) =>
            run(
              () =>
                store.saveMarker({
                  id: current.id,
                  x: current.x,
                  y: current.y,
                  kind: current.kind,
                  endonym: patch.endonym,
                  nameRu: patch.nameRu,
                  nameState: patch.nameState,
                  visibility: patch.visibility,
                  heroIds: patch.heroIds,
                  wikiSlug: patch.wikiSlug,
                  blurb: current.blurb,
                  threat: current.threat,
                  loot: current.loot,
                  visits: current.visits,
                  hook: current.hook,
                  rumor: current.rumor,
                }),
              'Метка сохранена.',
            )
          }
        />
      )}
      {flat && <p class="map-fallback">Плоский вид: WebGL недоступен. Та же тестовая текстура и те же метки.</p>}
    </div>
  );
}

function Layer({ on, label, click, rumor = false }: { on: boolean; label: string; click: () => void; rumor?: boolean }) {
  return (
    <button type="button" class={rumor ? 'map-layer rumor' : 'map-layer'} onClick={click}>
      <i class={on ? 'on' : ''} />
      {label}
    </button>
  );
}

function InfoCard({
  marker,
  actor,
  onClose,
  onSave,
}: {
  marker: MapMarker;
  actor: Actor;
  onClose: () => void;
  onSave: (patch: { endonym: string; nameRu: string; nameState: MapMarker['name_state']; visibility: MapMarker['visibility']; heroIds: string[]; wikiSlug: string }) => void;
}) {
  const label = markerLabel(marker, actor);
  const gm = isGm(actor);
  const [endonym, setEndonym] = useState(marker.endonym);
  const [nameRu, setNameRu] = useState(marker.name_ru);
  const showLink = Boolean(marker.wiki_slug) && (gm || marker.name_state !== 'unknown');
  return (
    <aside class="map-card">
      <div class="row spread">
        <div class="xs dim asc">{marker.threat ? `угроза ${marker.threat}` : 'учебный край'}</div>
        <button type="button" class="btn ghost sm" onClick={onClose}>
          Закрыть
        </button>
      </div>
      <div class="map-card-title">{label.primary}</div>
      {label.secondary && <p class="map-card-sub">{label.secondary}</p>}
      {marker.rumor && <p class="xs rumor-ink">слух · непроверено</p>}
      {marker.blurb && <p class="small">{marker.blurb}</p>}
      {(marker.loot || marker.visits || marker.hook) && (
        <table class="map-facts">
          <tbody>
            {marker.loot && (
              <tr>
                <td>Добыча</td>
                <td>{marker.loot}</td>
              </tr>
            )}
            {marker.visits && (
              <tr>
                <td>Были</td>
                <td>{marker.visits}</td>
              </tr>
            )}
            {marker.hook && (
              <tr>
                <td>Зацепка</td>
                <td class="gold">{marker.hook}</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      {showLink && (
        <a class="btn sm" href={href(`/viki#${marker.wiki_slug}`)}>
          Статья в вики
        </a>
      )}
      {gm && (
        <form
          class="map-edit"
          onSubmit={(event) => {
            event.preventDefault();
            onSave({
              endonym,
              nameRu,
              nameState: marker.name_state === 'unknown' ? 'ru' : marker.name_state === 'ru' ? 'full' : 'full',
              visibility: marker.visibility === 'gm' ? 'public' : marker.visibility,
              heroIds: marker.hero_ids,
              wikiSlug: marker.wiki_slug ?? '',
            });
          }}
        >
          <label>
            Русское имя
            <input value={nameRu} onInput={(event) => setNameRu((event.currentTarget as HTMLInputElement).value)} />
          </label>
          <label>
            Самоназвание
            <input value={endonym} onInput={(event) => setEndonym((event.currentTarget as HTMLInputElement).value)} />
          </label>
          <button type="submit" class="btn pri sm">
            Открыть имя
          </button>
          <p class="xs dim">Клик по рельефу в режиме «Туман» открывает клетку. «Метка» ставит новую.</p>
        </form>
      )}
    </aside>
  );
}

function FlatMap({
  world,
  actor,
  onMarker,
}: {
  world: World;
  actor: Actor;
  onMarker: (id: string) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const photo = useRef<HTMLImageElement | null>(null);
  const view = useRef({ x: 0, y: 0, w: 1, h: 1 });
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const paint = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.floor(rect.width);
      canvas.height = Math.floor(rect.height);
      const v = view.current;
      const img = photo.current;
      if (img && img.complete && img.naturalWidth) {
        ctx.drawImage(
          img,
          v.x * img.naturalWidth,
          v.y * img.naturalHeight,
          v.w * img.naturalWidth,
          v.h * img.naturalHeight,
          0,
          0,
          canvas.width,
          canvas.height,
        );
      } else {
        const image = ctx.createImageData(canvas.width, canvas.height);
        for (let y = 0; y < canvas.height; y++) {
          for (let x = 0; x < canvas.width; x++) {
            const nx = v.x + (x / canvas.width) * v.w;
            const ny = v.y + (y / canvas.height) * v.h;
            const color = sampleColor(nx, ny);
            const i = (y * canvas.width + x) * 4;
            image.data[i] = color.r;
            image.data[i + 1] = color.g;
            image.data[i + 2] = color.b;
            image.data[i + 3] = 255;
          }
        }
        ctx.putImageData(image, 0, 0);
      }
      const cols = world.world_map.cols;
      const rows = world.world_map.rows;
      ctx.fillStyle = 'rgba(12, 14, 16, 0.86)';
      for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) {
          if (isRevealed(world, actor, cx, cy)) continue;
          const x0 = ((cx / cols - v.x) / v.w) * canvas.width;
          const y0 = ((cy / rows - v.y) / v.h) * canvas.height;
          const x1 = (((cx + 1) / cols - v.x) / v.w) * canvas.width;
          const y1 = (((cy + 1) / rows - v.y) / v.h) * canvas.height;
          ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
        }
      }
      ctx.textAlign = 'center';
      ctx.fillStyle = '#f6efdc';
      ctx.font = '20px "Cormorant SC", serif';
      for (const marker of visibleMarkers(world, actor)) {
        const label = markerLabel(marker, actor);
        const sx = ((marker.x - v.x) / v.w) * canvas.width;
        const sy = ((marker.y - v.y) / v.h) * canvas.height;
        ctx.fillText(label.primary, sx, sy);
      }
    };
    let dead = false;
    if (MAP_MANIFEST.albedoUrl && !photo.current) {
      const img = new Image();
      img.onload = () => {
        if (dead) return;
        photo.current = img;
        paint();
      };
      img.src = MAP_MANIFEST.albedoUrl;
    }
    paint();
    let drag: { x: number; y: number } | null = null;
    const down = (event: PointerEvent) => {
      drag = { x: event.clientX, y: event.clientY };
    };
    const move = (event: PointerEvent) => {
      if (!drag) return;
      const rect = canvas.getBoundingClientRect();
      view.current.x -= ((event.clientX - drag.x) / rect.width) * view.current.w;
      view.current.y -= ((event.clientY - drag.y) / rect.height) * view.current.h;
      drag = { x: event.clientX, y: event.clientY };
      paint();
    };
    const up = (event: PointerEvent) => {
      drag = null;
      const rect = canvas.getBoundingClientRect();
      const nx = view.current.x + ((event.clientX - rect.left) / rect.width) * view.current.w;
      const ny = view.current.y + ((event.clientY - rect.top) / rect.height) * view.current.h;
      const hit = visibleMarkers(world, actor).find((marker) => Math.hypot(marker.x - nx, marker.y - ny) < 0.04);
      if (hit) onMarker(hit.id);
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    return () => {
      dead = true;
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
    };
  }, [world, actor, onMarker]);
  return <canvas ref={ref} class="map-gl" />;
}
