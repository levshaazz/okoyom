import { useState } from 'preact/hooks';
import { visShort, WIKI_VIS } from '../lib/wiki';
import type { WikiVisibility } from '../lib/types';

export function RevealBar({
  visibility,
  heroIds,
  heroes,
  onApply,
}: {
  visibility: WikiVisibility;
  heroIds: string[];
  heroes: { id: string; name: string }[];
  onApply: (visibility: WikiVisibility, heroIds: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>(heroIds);
  const names = heroIds
    .map((id) => heroes.find((hero) => hero.id === id)?.name)
    .filter(Boolean)
    .join(', ');

  return (
    <div class="wiki-reveal">
      <div class="wiki-vis">
        <span class="xs dim">
          {visShort(visibility)}
          {names ? ` · ${names}` : ''}
        </span>
        {visibility !== 'public' && (
          <button type="button" class="chip on" onClick={() => onApply('public', [])}>
            открыть всем
          </button>
        )}
        <button
          type="button"
          class={open ? 'chip on' : 'chip'}
          onClick={() => {
            setPicked(heroIds);
            setOpen((value) => !value);
          }}
        >
          статус
        </button>
      </div>
      {open && (
        <div class="wiki-heroes">
          {WIKI_VIS.map((row) => (
            <button
              key={row.id}
              type="button"
              class={visibility === row.id ? 'chip on' : 'chip'}
              onClick={() => {
                if (row.id === 'heroes') return;
                setOpen(false);
                onApply(row.id, []);
              }}
            >
              {row.label}
            </button>
          ))}
          {heroes.map((hero) => (
            <label key={hero.id} class="check">
              <input
                type="checkbox"
                checked={picked.includes(hero.id)}
                onChange={() =>
                  setPicked((current) =>
                    current.includes(hero.id) ? current.filter((id) => id !== hero.id) : [...current, hero.id],
                  )
                }
              />
              {hero.name}
            </label>
          ))}
          <button
            type="button"
            class="btn sm pri"
            onClick={() => {
              setOpen(false);
              onApply('heroes', picked);
            }}
          >
            Открыть выбранным
          </button>
        </div>
      )}
    </div>
  );
}
