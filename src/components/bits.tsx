import { useState } from 'preact/hooks';
import type { Q } from '../lib/rational';
import { pct } from '../lib/rational';

export function Bar({ tone, value, max }: { tone: 'h' | 'mg' | 'st' | 'xp'; value: number; max: number }) {
  return (
    <div class={`bar ${tone}`}>
      <i class={`pct-${pct(value, max)}`} />
    </div>
  );
}

export function Cells({ used, slots }: { used: Q; slots: number }) {
  const whole = Math.floor(Math.abs(used.n) / used.d);
  const rem = Math.abs(used.n) % used.d;
  const frac = used.d ? Math.round((rem / used.d) * 100) : 0;
  const count = Math.max(slots, whole + (rem > 0 ? 1 : 0));
  const cells = [];
  for (let i = 0; i < count; i++) {
    const over = i >= slots ? ' over' : '';
    if (i < whole) cells.push(<i key={i} class={`u${over}`} />);
    else if (i === whole && rem > 0) cells.push(<i key={i} class={`p${over}`}><b class={`pct-${frac}`} /></i>);
    else cells.push(<i key={i} class={over.trim()} />);
  }
  return <div class="cells" aria-hidden="true">{cells}</div>;
}

export function Pips({ filled, max }: { filled: number; max: number }) {
  const nodes = [];
  for (let i = 0; i < max; i++) nodes.push(<i key={i} class={i < filled ? 'on' : ''} />);
  return <div class="pips">{nodes}</div>;
}

export function Decide({
  onDecide,
}: {
  onDecide: (accept: boolean, comment: string) => void;
}) {
  const [comment, setComment] = useState('');
  return (
    <div class="decide">
      <input
        value={comment}
        placeholder="Комментарий игроку"
        onInput={(event) => setComment((event.currentTarget as HTMLInputElement).value)}
      />
      <button type="button" class="btn ok sm" onClick={() => onDecide(true, comment)}>
        ✓ Принять
      </button>
      <button type="button" class="btn red sm" onClick={() => onDecide(false, comment)}>
        ✕ Отклонить
      </button>
    </div>
  );
}

export function useNotice() {
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  function fail(reason: unknown) {
    setError(reason instanceof Error ? reason.message : 'Не вышло.');
  }
  function flash(text: string) {
    setError(null);
    setToast(text);
    window.setTimeout(() => setToast(null), 2800);
  }
  return { error, toast, fail, flash, setError };
}

export function Notices({ error, toast }: { error: string | null; toast: string | null }) {
  return (
    <>
      {error && (
        <p class="banner" role="alert">
          {error}
        </p>
      )}
      {toast && (
        <div class="toast-note" role="status">
          {toast}
        </div>
      )}
    </>
  );
}
