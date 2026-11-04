import { useEffect, useState } from 'preact/hooks';
import { getStore } from '../lib/browser-store';
import type { DataStore } from '../lib/store';
import type { Session, World } from '../lib/types';

export function useCampaign() {
  const [store] = useState<DataStore>(() => getStore());
  const [session, setSession] = useState<Session | null>(null);
  const [world, setWorld] = useState<World | null>(null);
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const pull = () => {
      setSession(store.getSession());
      setWorld(store.getWorld());
    };
    store
      .ready()
      .then(() => {
        if (!live) return;
        pull();
        setBooting(false);
      })
      .catch(() => {
        if (!live) return;
        setBootError('Не удалось открыть локальные данные.');
        setBooting(false);
      });
    const unsub = store.subscribe(() => {
      if (live) pull();
    });
    return () => {
      live = false;
      unsub();
    };
  }, [store]);

  return { store, session, world, booting, bootError };
}
