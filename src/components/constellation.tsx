import { useRef, useState } from 'preact/hooks';
import { TIER_LABELS, SPELL_SCHOOLS } from '../data/constellations';
import { isGm } from '../lib/domain';
import { treeView, spellSky, perkPoints } from '../lib/constellation';
import { SKILL_GROUPS } from '../lib/skills';
import { href } from '../lib/paths';
import { Notices, useNotice } from './bits';
import { useCampaign } from './use-campaign';

interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}

function fitStars(stars: Array<{ x: number; y: number }>): View {
  if (!stars.length) return { x: 0, y: 0, w: 900, h: 700 };
  const minX = Math.min(...stars.map((star) => star.x)) - 120;
  const maxX = Math.max(...stars.map((star) => star.x)) + 120;
  const minY = Math.min(...stars.map((star) => star.y)) - 70;
  const maxY = Math.max(...stars.map((star) => star.y)) + 80;
  return { x: minX, y: minY, w: Math.max(320, maxX - minX), h: Math.max(320, maxY - minY) };
}

export default function Constellation({ slug }: { slug: string }) {
  const { store, session, world, booting, bootError } = useCampaign();
  const [skill, setSkill] = useState('Одноручное');
  const [mode, setMode] = useState<'skills' | 'spells'>('skills');
  const [view, setView] = useState<View>({ x: 60, y: -30, w: 800, h: 870 });
  const notice = useNotice();
  const viewRef = useRef(view);
  viewRef.current = view;
  const drag = useRef({ x: 0, y: 0, vx: 40, vy: -40, vw: 900, vh: 900, pointers: new Map<number, { x: number; y: number }>() });

  if (bootError) return <p class="page">{bootError}</p>;
  if (booting || !world || !session) return <p class="page dim">Открываем небо…</p>;
  const hero = world.heroes.find((row) => row.slug === slug);
  if (!hero) return <p class="page">Такого ходока нет.</p>;
  if (session.role === 'guest') {
    return (
      <p class="page">
        Созвездие закрыто для гостя. <a class="gold" href={href(`/hodoki/${slug}`)}>К карточке</a>
      </p>
    );
  }

  const gm = isGm(session);
  const editable = session.role === 'player' ? session.heroId === hero.id : session.preview && session.heroId === hero.id;
  const tree = treeView(world, hero, skill, gm);
  const spells = spellSky(world, hero.id, gm);
  const points = perkPoints(world, hero);

  async function take(name: string) {
    try {
      await store.requestPerk(hero!.id, name, skill);
      notice.flash('Перк ждёт мастера');
    } catch (reason) {
      notice.fail(reason);
    }
  }

  function onWheel(event: WheelEvent) {
    event.preventDefault();
    const factor = event.deltaY > 0 ? 1.12 : 0.88;
    setView((current) => {
      const w = Math.min(2200, Math.max(280, current.w * factor));
      const h = Math.min(2200, Math.max(280, current.h * factor));
      return { x: current.x + (current.w - w) / 2, y: current.y + (current.h - h) / 2, w, h };
    });
  }

  function pointerDown(event: PointerEvent) {
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    const bag = drag.current;
    const current = viewRef.current;
    bag.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    bag.x = event.clientX;
    bag.y = event.clientY;
    bag.vx = current.x;
    bag.vy = current.y;
    bag.vw = current.w;
    bag.vh = current.h;
  }

  function pointerMove(event: PointerEvent) {
    const bag = drag.current;
    if (!bag.pointers.has(event.pointerId)) return;
    bag.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const svg = event.currentTarget as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    if (bag.pointers.size >= 2) {
      const [a, b] = [...bag.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const start = bag.vw;
      const nextW = Math.min(2200, Math.max(280, (start * 180) / dist));
      setView({ x: bag.vx + (start - nextW) / 2, y: bag.vy + (bag.vh - nextW) / 2, w: nextW, h: nextW });
      return;
    }
    const dx = ((event.clientX - bag.x) / rect.width) * bag.vw;
    const dy = ((event.clientY - bag.y) / rect.height) * bag.vh;
    setView({ x: bag.vx - dx, y: bag.vy - dy, w: bag.vw, h: bag.vh });
  }

  function pointerUp(event: PointerEvent) {
    drag.current?.pointers.delete(event.pointerId);
  }

  return (
    <div class="sky-page">
      <Notices error={notice.error} toast={notice.toast} />
      <header class="sky-bar">
        <a class="btn ghost sm" href={href(`/hodoki/${hero.slug}`)}>К листу</a>
        <strong class="salt">{hero.name}</strong>
        <span class="xs dim">очко перка {points.free} свободно · {points.spent} взято · {points.pending} ждут</span>
        <div class="filters">
          <button type="button" class={mode === 'skills' ? 'badge solid' : 'badge g'} onClick={() => { setMode('skills'); setView(fitStars(treeView(world, hero, skill, gm).stars)); }}>Навыки</button>
          <button type="button" class={mode === 'spells' ? 'badge solid' : 'badge g'} onClick={() => { setMode('spells'); setView({ x: 0, y: 0, w: 1080, h: 820 }); }}>Заклинания</button>
        </div>
        {gm && <span class="badge">мастер видит всё дерево</span>}
      </header>
      {mode === 'skills' && (
        <div class="skill-picks">
          {SKILL_GROUPS.flatMap((group) => group.skills).map((name) => (
            <button key={name} type="button" class={name === skill ? 'badge solid' : 'badge g'} onClick={() => { setSkill(name); setView(fitStars(treeView(world, hero, name, gm).stars)); }}>
              {name}
            </button>
          ))}
        </div>
      )}
      <p class="sky-caption xs">
        {mode === 'skills'
          ? `${skill} ${tree.skillValue} · отметки ${tree.marks} · ${gm ? 'полное дерево' : tree.hiddenCount ? `в ветке ещё ${tree.hiddenCount} без названий` : 'ветка открыта до конца'}`
          : gm
            ? 'Все учебные заклинания. Тусклые герой ещё не выучил.'
            : 'Только выученные. Чужие и неоткрытые школы молчат.'}
      </p>
      <svg
        class="sky"
        preserveAspectRatio="xMidYMid meet"
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        onWheel={onWheel}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerUp}
      >
        {Array.from({ length: 40 }, (_, i) => (
          <circle key={i} class="dust" cx={(i * 97) % 1000} cy={(i * 53) % 900} r={(i % 3) + 0.4} />
        ))}
        {mode === 'skills' &&
          tree.lines.map((line) => {
            const from = tree.stars.find((star) => star.id === line.from);
            const to = tree.stars.find((star) => star.id === line.to);
            if (!from || !to) return null;
            return <line key={`${line.from}-${line.to}`} class="sky-line" x1={from.x} y1={from.y} x2={to.x} y2={to.y} />;
          })}
        {mode === 'skills' &&
          tree.stars.map((star) => (
            <g key={star.id} class={`star ${star.state} ${star.pending ? 'pending' : ''} ${star.open ? 'open' : ''}`} transform={`translate(${star.x} ${star.y})`}>
              <circle
                r={star.state === 'fog' ? 7 : 16}
                onClick={() => {
                  if (!editable || !star.reachable || !star.open || star.pending || star.state === 'taken') return;
                  void take(star.name);
                }}
              />
              {star.state !== 'fog' && (
                <text y="34" text-anchor="middle">
                  {star.name}
                </text>
              )}
              {star.state === 'next' && !star.open && star.name && (
                <text y="50" class="need" text-anchor="middle">
                  откроется при {star.threshold}
                </text>
              )}
              {star.pending && (
                <text y="50" class="need" text-anchor="middle">
                  ждёт мастера
                </text>
              )}
            </g>
          ))}
        {mode === 'spells' &&
          SPELL_SCHOOLS.map((school, index) => (
            <text key={school} class="school-label" x={120 + index * 150} y={40} text-anchor="middle">
              {school}
            </text>
          ))}
        {mode === 'spells' &&
          spells.map((star) => {
            const column = SPELL_SCHOOLS.indexOf(star.school as (typeof SPELL_SCHOOLS)[number]);
            const x = 120 + Math.max(0, column) * 150;
            const y = 140 + (star.tier - 1) * 130;
            return (
              <g key={star.name} class={star.learned ? 'star taken' : 'star next'} transform={`translate(${x} ${y})`}>
                <circle r="14" />
                <text y="32" text-anchor="middle">
                  {star.name}
                </text>
                <text y="48" class="need" text-anchor="middle">
                  {TIER_LABELS[star.tier]}
                </text>
              </g>
            );
          })}
      </svg>
    </div>
  );
}
