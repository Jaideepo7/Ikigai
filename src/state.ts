import { api } from './api';
import { levelFromXp, plantById, type MeResponse } from './shared/rules';

/** Single client-side store. `bus` fires 'me' after every refresh so HUD + scenes re-render. */
export const bus = new EventTarget();
export const store: { me: MeResponse | null } = { me: null };

export function me(): MeResponse {
  if (!store.me) throw new Error('not signed in');
  return store.me;
}
export function level() { return levelFromXp(me().user.xp); }

export async function refreshMe(): Promise<MeResponse> {
  store.me = await api.get<MeResponse>('/api/me');
  // Ignore retired seeds and plots when reading a response from an older worker.
  store.me.inventory = store.me.inventory.filter((seed) => plantById(seed.plant_id));
  store.me.plots = store.me.plots.filter((plot) => !plot.plant_id || plantById(plot.plant_id));
  bus.dispatchEvent(new Event('me'));
  return store.me;
}
export const on = (ev: string, fn: () => void) => bus.addEventListener(ev, fn);
export const emit = (ev: string) => bus.dispatchEvent(new Event(ev));

export function toast(text: string, kind: 'ok' | 'err' | 'reward' = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = text;
  document.getElementById('toasts')!.appendChild(el);
  setTimeout(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 400); }, 3200);
}
