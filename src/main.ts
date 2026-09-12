import './style.css';
import { api, ApiError } from './api';
import { refreshMe, store, toast } from './state';
import { landing, loginScreen, signupScreen, adminScreen, selectScreen } from './ui/screens';
import { startGame } from './game';

const app = document.getElementById('app')!;

export function show(html: string) { app.innerHTML = html; app.classList.remove('hidden'); window.scrollTo(0, 0); }

export const routes = {
  landing: () => show(landing()),
  login: () => show(loginScreen()),
  signup: () => show(signupScreen()),
  admin: () => show(adminScreen()),
  select: () => show(selectScreen()),
  game: async () => { app.classList.add('hidden'); await startGame(); },
};

async function boot() {
  try { await refreshMe(); } catch (e) {
    if (e instanceof ApiError && e.status === 401) return routes.landing();
    toast('Server unreachable', 'err'); return routes.landing();
  }
  if (store.me!.user.character === null) routes.select(); else routes.game();
}

// delegated clicks for data-go="route" links + auth forms
app.addEventListener('click', (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>('[data-go]');
  if (t) { e.preventDefault(); (routes as any)[t.dataset.go!](); }
});
app.addEventListener('submit', async (e) => {
  const form = e.target as HTMLFormElement;
  if (!form.dataset.auth) return;
  e.preventDefault();
  const fd = new FormData(form);
  const err = form.querySelector('.err')!;
  err.textContent = '';
  if (form.dataset.auth === 'signup' && fd.get('password') !== fd.get('verify')) { err.textContent = 'Passwords do not match'; return; }
  try {
    const action = form.dataset.auth === 'admin' ? ((e as SubmitEvent).submitter as HTMLButtonElement | null)?.value : form.dataset.auth;
    await api.post(`/api/auth/${action}`, { username: fd.get('username'), password: fd.get('password') });
    await boot();
  } catch (ex) { err.textContent = (ex as Error).message; }
});

boot();
