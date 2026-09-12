import { api } from '../api';
import { me, level, refreshMe, toast, on, store } from '../state';
import { goto } from '../game';
import { sfx, music, setSfx, setVolume, setTrack, TRACKS } from './audio';
import {
  DAILY_CAP, PLANTS, CARDS, plantById, previewReward, plotsUnlocked, plotPrice, STAGES, caseSlots, gardenTiles,
  LOOTBOX_PRICE, GEM_PRICE_COINS, FREEZES_PER_MONTH, GROWTH_OPTIONS, growthCost, growthMs, spinBaseCoins, type Task, type Plot, type FriendRow, type Reel,
} from '../shared/rules';

/** Escape user-supplied text before it goes into innerHTML. */
export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const overlay = () => document.getElementById('overlay')!;
const fmtMin = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m} min`);
const fmtMs = (ms: number) => { const mi = Math.ceil(ms / 60000); return mi >= 60 ? `${Math.floor(mi / 60)}h ${mi % 60}m` : `${mi}m`; };
const bucket = (m: number) => (m <= 30 ? '0 - 30 min' : m <= 60 ? '30 min - 1 hr' : m <= 180 ? '1 - 3 hrs' : '3+ hrs');
const stars = (d: number) => `<span class="stars">${'★'.repeat(d)}<span class="off">${'★'.repeat(3 - d)}</span></span>`;
const dateOf = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const err = (e: unknown) => { toast((e as Error).message, 'err'); sfx.error(); };
const ico = (n: string, cls = '') => `<img class="ico ${cls}" src="/assets/ui/${n}.png" alt="" />`;
const num = (n: number | string) => `<span class="num">${n}</span>`;

// ---------- panel plumbing ----------
let panelEl: HTMLElement | null = null;
export function isPanelOpen() { return !!panelEl; }
export function closePanel() { panelEl?.remove(); panelEl = null; stopFriendsPoll(); renderMini(); }
export function openPanel(html: string, cls = ''): HTMLElement {
  closePanel();
  const back = document.createElement('div'); back.className = 'panel-back';
  back.innerHTML = `<div class="panel ${cls}"><button class="x" aria-label="Close">✕</button>${html}</div>`;
  back.addEventListener('click', (e) => { if (e.target === back) closePanel(); });
  back.querySelector('.x')!.addEventListener('click', closePanel);
  overlay().appendChild(back); panelEl = back; renderMini();
  return back.querySelector('.panel')!;
}
const name = (n: string) => { if (panelEl) panelEl.dataset.name = n; };
export function setHint(text: string | null) {
  let el = document.getElementById('hint');
  if (!text) { el?.remove(); return; }
  if (!el) { el = document.createElement('div'); el.id = 'hint'; overlay().appendChild(el); }
  if (el.textContent !== text) el.textContent = text;
}
/** Modal yes/no. Resolves true on confirm. */
export function confirmDialog(title: string, body: string, yes = 'Yes', no = 'Cancel'): Promise<boolean> {
  return new Promise((resolve) => {
    const p = openPanel(`<h2>${esc(title)}</h2><p class="sub" style="font-size:18px;margin-top:8px">${esc(body)}</p><div class="form-actions"><button class="btn sage" id="c-yes">${esc(yes)}</button><button class="btn rose" id="c-no">${esc(no)}</button></div>`);
    name('confirm');
    const done = (v: boolean) => { closePanel(); resolve(v); };
    p.querySelector('#c-yes')!.addEventListener('click', () => done(true));
    p.querySelector('#c-no')!.addEventListener('click', () => done(false));
    panelEl!.querySelector('.x')!.addEventListener('click', () => resolve(false));
  });
}
const dailyBar = () => { const d = me().daily; const pct = Math.min(100, Math.round((d.xp / DAILY_CAP.xp) * 100)); return `<div class="daily"><div class="row"><span>${ico('streak')} Daily progress ${pct < 100 ? (pct < 50 ? '- keep going!' : '- you are doing great!') : '- daily cap reached!'}</span><span>${num(d.xp)}/${num(DAILY_CAP.xp)} XP · ${num(d.coins)}/${num(DAILY_CAP.coins)} coins</span></div><div class="bar"><i style="width:${pct}%"></i></div></div>`; };

// ---------- navbar + HUD ----------
const NAV = [['pomodoro', 'P', 'Pomodoro'], ['tasks', 'T', 'Tasks'], ['map', 'M', 'Map'], ['inventory', 'I', 'Inventory'], ['shop', 'Q', 'Shop'], ['settings', 'Esc', 'Settings']] as const;
const openers: Record<string, () => void> = { pomodoro: () => pomodoroPanel(), tasks: () => tasksPanel(), map: mapPanel, inventory: () => inventoryPanel(), shop: () => shopPanel(), settings: settingsPanel };
export function mountNavbar() {
  if (document.getElementById('navbar')) return;
  const nav = document.createElement('div'); nav.id = 'navbar';
  nav.innerHTML = `<span class="logo">IKIGAI</span><div class="hud"></div><div class="nav-icons">${NAV.map(([k, key, title]) => `<button class="nav-btn" data-open="${k}" title="${title} (${key})"><img src="/assets/ui/icon_${k}.png" alt="" /><span>${title}</span><kbd>${key}</kbd></button>`).join('')}</div>`;
  document.body.appendChild(nav);
  nav.querySelectorAll<HTMLElement>('[data-open]').forEach((b) => b.addEventListener('click', () => { sfx.click(); openers[b.dataset.open!](); }));
  renderHud(); on('me', renderHud);
  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    if (e.key === 'Escape') { if (panelEl?.dataset.name === 'confirm' || panelEl?.dataset.name === 'tutorial') return; if (panelEl) closePanel(); else settingsPanel(); return; }
    const k = { p: 'pomodoro', t: 'tasks', m: 'map', i: 'inventory', q: 'shop' }[e.key.toLowerCase()];
    if (k && !e.repeat) { if (panelEl?.dataset.name === k) closePanel(); else { sfx.click(); openers[k](); } }
  });
}
function renderHud() {
  const u = me().user, lv = level();
  const pct = lv.next ? Math.round((lv.into / lv.next) * 100) : 100;
  document.querySelector('#navbar .hud')!.innerHTML = `
    <div class="xp"><span>${ico('xp', 'sm')} Level ${num(lv.level)} · ${lv.next ? `${num(lv.into)}/${num(lv.next)} XP` : 'MAX'}</span><div class="bar"><i style="width:${pct}%"></i></div></div>
    <span class="pill" title="Coins">${ico('coin')}${num(u.coins)}</span><span class="pill" title="Gems">${ico('gem')}${num(u.gems)}</span><span class="pill" title="Day streak">${ico('streak')}${num(u.streak)}<small>day${u.streak === 1 ? '' : 's'}</small></span>`;
}

// ---------- tasks (with folders) ----------
let taskFolder: string | null = null; // null = all
export function tasksPanel(folder: string | null = taskFolder) {
  taskFolder = folder;
  const all = me().tasks;
  const folders = [...new Set(all.map((t) => t.folder).filter(Boolean))].sort();
  const tasks = folder === null ? all : all.filter((t) => t.folder === folder);
  const row = (t: Task) => {
    const done = !!t.completed_at, pts = done ? t.xp_awarded : previewReward(t.difficulty, t.est_minutes).xp;
    return `<div class="task ${done ? 'done' : ''}" data-id="${t.id}">
      <div class="check" data-act="complete" title="${done ? 'Completed' : 'Mark complete'}">${done ? '✓' : ''}</div>
      <div><div class="name">${esc(t.name)}</div><div class="desc">${esc(t.description)}${t.folder ? ` <span class="tag">📁 ${esc(t.folder)}</span>` : ''}</div></div>
      <div class="meta">${stars(t.difficulty)}<span><span class="pts">${ico('xp', 'sm')} +${num(pts)} XP${t.pomodoro && !done ? ' ×2' : ''}</span> 📅 ${dateOf(t.created_at)}</span><span>⏱ ${bucket(t.est_minutes)} (${fmtMin(t.est_minutes)})</span></div>
      <div class="acts">${done ? '' : '<button class="play" data-act="start" title="Start focus timer">▶</button>'}<select class="mv" title="Move to folder"><option value="">📁 none</option>${folders.map((f) => `<option ${t.folder === f ? 'selected' : ''} value="${esc(f)}">${esc(f)}</option>`).join('')}<option value="__new">+ new folder…</option></select><button class="del" data-act="delete" title="Delete">🗑</button></div></div>`;
  };
  const p = openPanel(`<div class="panel-head"><div><h2>📖 My Tasks</h2><p class="sub">Small steps, big progress.</p></div><button class="btn sm" id="new-task">+ New Task</button></div>
    ${dailyBar()}
    <div class="tabs folders"><button data-f="" class="${folder === null ? 'on' : ''}">All (${all.length})</button>${folders.map((f) => `<button data-f="${esc(f)}" class="${folder === f ? 'on' : ''}">📁 ${esc(f)} (${all.filter((t) => t.folder === f).length})</button>`).join('')}<button id="add-folder" title="New folder">+ folder</button></div>
    <div class="task-list">${tasks.length ? tasks.map(row).join('') : '<p class="sub">No tasks here yet. Plant one!</p>'}</div>
    <p class="sub" style="text-align:center;margin-top:12px">🌱 Progress looks good on you. 🌱</p>`, 'wide');
  name('tasks');
  p.querySelector('#new-task')!.addEventListener('click', () => createTaskPanel(folder ?? ''));
  p.querySelectorAll<HTMLElement>('.folders [data-f]').forEach((b) => b.addEventListener('click', () => tasksPanel(b.dataset.f || null)));
  p.querySelector('#add-folder')!.addEventListener('click', () => { const f = prompt('Folder name (e.g. School, Gym, Side projects):'); if (f?.trim()) createTaskPanel(f.trim().slice(0, 30)); });
  p.querySelectorAll<HTMLSelectElement>('.mv').forEach((s) => s.addEventListener('change', async () => {
    const id = Number(s.closest<HTMLElement>('.task')!.dataset.id);
    let f = s.value;
    if (f === '__new') { f = (prompt('Folder name:') || '').trim().slice(0, 30); if (!f) return tasksPanel(); }
    try { await api.post(`/api/tasks/${id}/folder`, { folder: f }); await refreshMe(); tasksPanel(); } catch (e) { err(e); }
  }));
  p.querySelectorAll<HTMLElement>('[data-act]').forEach((b) => b.addEventListener('click', async () => {
    const id = Number(b.closest<HTMLElement>('.task')!.dataset.id), t = all.find((x) => x.id === id)!;
    try {
      if (b.dataset.act === 'complete' && !t.completed_at) await completeTask(id);
      else if (b.dataset.act === 'delete') { await api.del(`/api/tasks/${id}`); await refreshMe(); tasksPanel(); }
      else if (b.dataset.act === 'start') { await api.post(`/api/tasks/${id}/start`); await refreshMe(); pomodoroPanel(id); }
    } catch (e) { err(e); }
  }));
}
async function completeTask(id: number) {
  const r = await api.post<{ xp: number; coins: number; capped: boolean; leveledUp: boolean; level: number; streak: number }>(`/api/tasks/${id}/complete`);
  await refreshMe();
  sfx.coin();
  toast(`+${r.xp} XP · +${r.coins} coins${r.capped ? ' (daily cap reached)' : ''} · ${r.streak} day streak`, 'reward');
  if (r.leveledUp) { sfx.levelUp(); setTimeout(() => toast(`🎉 Level ${r.level}! Your garden grew.`, 'reward'), 600); }
  if (panelEl?.dataset.name === 'tasks') tasksPanel();
}
export function createTaskPanel(folder = '') {
  let difficulty = 1, est = 20, mode: '0-30' | '30-60' | '60-180' | '180+' = '0-30';
  const folders = [...new Set(me().tasks.map((t) => t.folder).filter(Boolean))].sort();
  if (folder && !folders.includes(folder)) folders.push(folder);
  const p = openPanel(`<h2 style="text-align:center">🌱 Create a Task</h2><p class="sub" style="text-align:center">Plant a task today, grow a better tomorrow.</p>
    <form class="form" id="task-form">
      <label>🌱 Task Name</label><input type="text" name="name" maxlength="50" required placeholder="e.g. Finish database homework" /><div class="count"><span id="c1">0</span>/50</div>
      <label>📝 Description</label><textarea name="description" maxlength="200" rows="2" placeholder="Add more details about your task..."></textarea><div class="count"><span id="c2">0</span>/200</div>
      <label>📁 Folder</label><div style="display:flex;gap:8px"><select name="folder" style="flex:1;padding:8px;border:3px solid #d9c8a5;background:#fff9ea"><option value="">none</option>${folders.map((f) => `<option value="${esc(f)}" ${f === folder ? 'selected' : ''}>${esc(f)}</option>`).join('')}</select><input type="text" name="newfolder" maxlength="30" placeholder="or type a new folder" style="flex:1" /></div>
      <label>⛰ Difficulty</label><div class="choice" id="diff">
        <button type="button" data-d="1" class="on">⭐<br/>Easy<small>+10 XP base</small></button><button type="button" data-d="2">⭐⭐<br/>Medium<small>+20 XP base</small></button><button type="button" data-d="3">⭐⭐⭐<br/>Hard<small>+35 XP base</small></button></div>
      <label>⏱ Estimated Time</label><div class="choice" id="time">
        <button type="button" data-m="0-30" class="on">🌱 0 - 30 mins</button><button type="button" data-m="30-60">⏳ 30 mins - 1 hr</button><button type="button" data-m="60-180">🕐 1 hr - 3 hrs</button><button type="button" data-m="180+">📅 3+ hrs</button></div>
      <div id="time-extra"></div>
      <div class="reward-preview" id="preview"></div>
      <div class="form-actions"><button class="btn sage" type="submit" data-start="0">🌱 Create Task</button><button class="btn" type="submit" data-start="1">▶ Start Task</button></div>
      <p class="sub" style="text-align:center;margin-top:10px">🌱 Small steps make a big garden.</p>
    </form>`);
  name('create');
  const form = p.querySelector<HTMLFormElement>('#task-form')!;
  const fName = form.elements.namedItem('name') as HTMLInputElement, fDesc = form.elements.namedItem('description') as HTMLTextAreaElement;
  const fFolder = form.elements.namedItem('folder') as HTMLSelectElement, fNew = form.elements.namedItem('newfolder') as HTMLInputElement;
  const preview = () => { const r = previewReward(difficulty, est); p.querySelector('#preview')!.innerHTML = `You will get ${num(r.xp)} XP + ${num(r.coins)} coins (${fmtMin(est)}) · 2× XP with the focus timer`; };
  const extra = () => {
    const box = p.querySelector('#time-extra')!;
    if (mode === '60-180') box.innerHTML = `<label>Exact time (minutes)</label><input type="number" id="exact" min="60" max="180" value="${est}" />`;
    else if (mode === '180+') box.innerHTML = `<label>How long? <b id="sl-v">${fmtMin(est)}</b> (max 5 hrs)</label><input type="range" id="slider" min="180" max="300" step="15" value="${est}" style="width:100%" />`;
    else box.innerHTML = '';
    box.querySelector('#exact')?.addEventListener('input', (e) => { est = Math.min(180, Math.max(60, Number((e.target as HTMLInputElement).value) || 60)); preview(); });
    box.querySelector('#slider')?.addEventListener('input', (e) => { est = Number((e.target as HTMLInputElement).value); box.querySelector('#sl-v')!.textContent = fmtMin(est); preview(); });
  };
  const pick = (sel: string, cb: (b: HTMLElement) => void) => p.querySelectorAll<HTMLElement>(`${sel} button`).forEach((b) => b.addEventListener('click', () => { p.querySelectorAll(`${sel} button`).forEach((x) => x.classList.remove('on')); b.classList.add('on'); cb(b); preview(); }));
  pick('#diff', (b) => (difficulty = Number(b.dataset.d)));
  pick('#time', (b) => { mode = b.dataset.m as typeof mode; est = { '0-30': 20, '30-60': 45, '60-180': 90, '180+': 240 }[mode]; extra(); });
  fName.addEventListener('input', () => (p.querySelector('#c1')!.textContent = String(fName.value.length)));
  fDesc.addEventListener('input', () => (p.querySelector('#c2')!.textContent = String(fDesc.value.length)));
  let start = false;
  form.querySelectorAll<HTMLButtonElement>('[data-start]').forEach((b) => b.addEventListener('click', () => (start = b.dataset.start === '1')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const t = await api.post<Task>('/api/tasks', { name: fName.value, description: fDesc.value, folder: fNew.value.trim() || fFolder.value, difficulty, est_minutes: est, start });
      await refreshMe(); sfx.plant();
      if (start) pomodoroPanel(t.id); else tasksPanel(t.folder || null);
    } catch (ex) { err(ex); }
  });
  preview();
}

// ---------- pomodoro ----------
interface Pomo { phase: 'work' | 'break'; rep: number; reps: number; work: number; brk: number; endsAt: number; paused: number | null; taskId: number | null; done: boolean }
let pomo: Pomo | null = null;
let pomoTimer: number | undefined;
const mmss = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const remaining = () => (pomo ? (pomo.paused !== null ? pomo.paused : pomo.endsAt - Date.now()) : 0);
function pomoTick() {
  if (!pomo || pomo.paused !== null || pomo.done) return;
  if (remaining() > 0) return renderPomo();
  if (pomo.phase === 'work') {
    api.post('/api/pomodoro/complete', { task_id: pomo.taskId, minutes: pomo.work }).then(refreshMe).catch(() => {});
    sfx.chime();
    if (pomo.rep >= pomo.reps) { pomo.done = true; toast(pomo.taskId ? 'Focus session done! Mark the task complete for 2× XP.' : 'All sessions done. Nice work!', 'reward'); }
    else { pomo.phase = 'break'; pomo.endsAt = Date.now() + pomo.brk * 60_000; toast('Break time ☕'); }
  } else { pomo.phase = 'work'; pomo.rep++; pomo.endsAt = Date.now() + pomo.work * 60_000; sfx.chime(); toast(`Session ${pomo.rep} of ${pomo.reps} - focus!`); }
  renderPomo();
}
function startPomo(work: number, brk: number, reps: number, taskId: number | null) {
  pomo = { phase: 'work', rep: 1, reps, work, brk, endsAt: Date.now() + work * 60_000, paused: null, taskId, done: false };
  clearInterval(pomoTimer); pomoTimer = window.setInterval(pomoTick, 500);
}
export function pomodoroPanel(taskId: number | null = null) {
  const u = me().user;
  const task = taskId !== null ? me().tasks.find((t) => t.id === taskId) : undefined;
  let work = task ? task.est_minutes : u.pomo_work, brk = u.pomo_break, reps = task ? 1 : u.pomo_reps;
  if (pomo && !pomo.done && (task ? pomo.taskId !== task.id : true)) { work = pomo.work; brk = pomo.brk; reps = pomo.reps; }
  const p = openPanel(`<div class="pomo">
    <div class="clock"><h2>⏱ Focus Time</h2>${task ? `<p class="sub">${esc(task.name)} · 2× XP when completed</p>` : '<p class="sub">Every finished session is logged to your lifetime stats.</p>'}
      <div class="face"><div class="time num" id="pt">${mmss(work * 60_000)}</div></div><div class="phase" id="pp">ready</div>
      <div class="form-actions"><button class="btn" id="p-start">▶ Start</button><button class="btn rose" id="p-reset">■ Reset</button>${task ? '<button class="btn sage" id="p-done">✓ Done</button>' : ''}</div>
      <div class="dots" id="pd"></div></div>
    <div><h2>Settings</h2>
      <div class="stepper"><span>Work Duration</span><div><button data-k="work" data-d="-5">−</button><b class="num" id="s-work">${work} min</b><button data-k="work" data-d="5">+</button></div></div>
      <div class="stepper"><span>Break Duration</span><div><button data-k="brk" data-d="-1">−</button><b class="num" id="s-brk">${brk} min</b><button data-k="brk" data-d="1">+</button></div></div>
      <div class="stepper"><span>Repetitions</span><div><button data-k="reps" data-d="-1">−</button><b class="num" id="s-reps">${reps}</b><button data-k="reps" data-d="1">+</button></div></div>
      <p class="sub">Settings apply when you press Start.${task ? '' : ' Saved as your defaults.'}</p>
      <p class="sub">Lifetime: ${num(me().stats.pomodoros ?? 0)} sessions · ${num(me().stats.focus_minutes ?? 0)} focus minutes</p></div></div>`, 'wide');
  name('pomodoro');
  const vals = { work, brk, reps };
  p.querySelectorAll<HTMLElement>('.stepper button').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.k as keyof typeof vals, lim = { work: [5, 120], brk: [1, 60], reps: [1, 8] }[k];
    vals[k] = Math.min(lim[1], Math.max(lim[0], vals[k] + Number(b.dataset.d)));
    p.querySelector(`#s-${k}`)!.textContent = k === 'reps' ? String(vals[k]) : `${vals[k]} min`;
    if (!pomo || pomo.done) p.querySelector('#pt')!.textContent = mmss(vals.work * 60_000);
  }));
  p.querySelector('#p-start')!.addEventListener('click', async () => {
    sfx.click();
    if (pomo && !pomo.done) { pomo.paused === null ? (pomo.paused = remaining()) : ((pomo.endsAt = Date.now() + pomo.paused), (pomo.paused = null)); return renderPomo(); }
    startPomo(vals.work, vals.brk, vals.reps, task?.id ?? null);
    if (!task) api.post('/api/me/settings', { pomo_work: vals.work, pomo_break: vals.brk, pomo_reps: vals.reps }).then(refreshMe).catch(() => {});
    renderPomo();
  });
  p.querySelector('#p-reset')!.addEventListener('click', () => { pomo = null; clearInterval(pomoTimer); renderPomo(); });
  p.querySelector('#p-done')?.addEventListener('click', async () => { try { await completeTask(task!.id); if (pomo?.taskId === task!.id) { pomo = null; clearInterval(pomoTimer); } closePanel(); } catch (e) { err(e); } });
  renderPomo();
}
function renderPomo() {
  const p = panelEl?.dataset.name === 'pomodoro' ? panelEl : null;
  if (p) {
    const pt = p.querySelector('#pt')!, pp = p.querySelector('#pp')!, btn = p.querySelector('#p-start')!, dots = p.querySelector('#pd')!;
    if (pomo) {
      pt.textContent = mmss(remaining());
      pp.textContent = pomo.done ? 'done ✓' : `${pomo.phase === 'work' ? 'work' : 'break'} · session ${pomo.rep} of ${pomo.reps}${pomo.paused !== null ? ' · paused' : ''}`;
      btn.textContent = pomo.done ? '▶ Start again' : pomo.paused !== null ? '▶ Resume' : '⏸ Pause';
      dots.innerHTML = Array.from({ length: pomo.reps * 2 }, (_, i) => { const rep = Math.floor(i / 2) + 1, ph = i % 2 ? 'break' : 'work'; const cur = rep === pomo!.rep && ph === pomo!.phase && !pomo!.done; const done = pomo!.done || rep < pomo!.rep || (rep === pomo!.rep && ph === 'work' && pomo!.phase === 'break'); return `<span class="${cur ? 'on' : done ? 'done' : ''}"><i></i>${ph}</span>`; }).join('');
    } else { pp.textContent = 'ready'; btn.textContent = '▶ Start'; dots.innerHTML = ''; }
  }
  renderMini();
}
function renderMini() {
  let el = document.getElementById('mini-timer');
  if (!pomo || pomo.done || panelEl) { el?.remove(); return; }
  if (!el) { el = document.createElement('div'); el.id = 'mini-timer'; el.addEventListener('click', () => pomodoroPanel(pomo?.taskId ?? null)); overlay().appendChild(el); }
  el.innerHTML = `Focus Time<b class="num">${mmss(remaining())}</b><small>${pomo.phase}${pomo.paused !== null ? ' · paused' : ''} · ${pomo.rep}/${pomo.reps}</small>`;
}

// ---------- map ----------
export function mapPanel() {
  const p = openPanel(`<div class="panel-head"><h2>🗺 Map</h2><p class="sub">Click a place to teleport.</p></div>
    <div class="map-img"><img src="/assets/ui/map.png" alt="Map" />
      <button class="hotspot" style="left:50%;top:24%" data-to="house" aria-label="Home"></button>
      <button class="hotspot" style="left:13.5%;top:54%" data-to="garden" aria-label="My Garden"></button>
      <button class="hotspot" style="left:89%;top:54%" data-to="friends" aria-label="Friends' Gardens"></button>
      <div class="hotspot locked" style="left:51.5%;top:70%" title="Coming soon"><span>${ico('lock', 'sm')} locked</span></div>
    </div>`, 'wide');
  name('map');
  p.querySelectorAll<HTMLElement>('[data-to]').forEach((b) => b.addEventListener('click', () => {
    sfx.click(); closePanel();
    if (b.dataset.to === 'house') goto('House', { spawn: 'center' });
    else if (b.dataset.to === 'garden') goto('Garden', { ownerId: me().user.id, spawn: 'gate' });
    else friendsPanel();
  }));
}

// ---------- inventory ----------
export function inventoryPanel(tab: 'seeds' | 'cards' = 'seeds') {
  const m = me(), u = m.user;
  const seeds = m.inventory.filter((i) => i.qty > 0);
  const body = tab === 'seeds'
    ? `<div class="slots big">${seeds.map((s) => { const pl = plantById(s.plant_id)!; return `<div class="slot seed" title="${pl.name} seeds"><div class="bag">${ico('seedbag', 'bag')}<img class="pl" src="/assets/plants/plant_${pl.sprite}.png" alt="" /></div><span class="nm">${pl.name}</span><span class="rar ${pl.rarity}">${pl.rarity}</span><span class="qty num">×${s.qty}</span></div>`; }).join('')}${Array.from({ length: Math.max(0, 8 - seeds.length) }, () => `<div class="slot empty">${ico('seedbag', 'bag dim')}<span class="nm">empty</span></div>`).join('')}</div><p class="sub" style="margin-top:10px">Walk onto a plot in your garden and press E to plant a seed. Buy more in the shop (Q).</p>`
    : `<div class="card-row">${m.cards.map((c) => cardHtml(CARDS[c.card_id], false, c.slot !== null ? `case slot ${c.slot + 1}` : 'in inventory')).join('') || '<p class="sub">No cards yet. Buy them with gems in the shop.</p>'}</div><p class="sub" style="margin-top:10px">Display cards in the case inside your house (press E by the bookshelf).</p>`;
  const p = openPanel(`<div class="panel-head"><h2>🎒 Inventory</h2></div>${dailyBar()}
    <div class="card-row" style="margin-bottom:14px"><div class="stat-box">${ico('gem')}<div><small>Gems</small><b class="num">${u.gems}</b></div></div><div class="stat-box">${ico('coin')}<div><small>Coins</small><b class="num">${u.coins}</b></div></div><div class="stat-box">${ico('streak')}<div><small>Streak</small><b class="num">${u.streak}</b></div></div></div>
    <div class="tabs"><button data-t="seeds" class="${tab === 'seeds' ? 'on' : ''}">🌱 Seeds (${seeds.reduce((s, x) => s + x.qty, 0)})</button><button data-t="cards" class="${tab === 'cards' ? 'on' : ''}">🃏 Cards (${m.cards.length})</button></div>${body}`, 'wide');
  name('inventory');
  p.querySelectorAll<HTMLElement>('.tabs button').forEach((b) => b.addEventListener('click', () => inventoryPanel(b.dataset.t as 'seeds')));
}
export function cardHtml(c: { id: number; name: string; rarity: string; art: boolean }, locked: boolean, foot = '') {
  const art = c.art ? `<img src="/assets/cards/card_${c.id}.png" alt="" />` : `<span>${['🦊', '🦉', '🐟', '🦌', '🐼', '🐇', '🦦', '🦋', '🐈', '🐺', '🔥', '🐉'][c.id] ?? '🐾'}</span>`;
  return `<div class="tcard ${locked ? 'locked' : ''}"><div class="head rar ${c.rarity}">${locked ? '?' : c.rarity}</div><div class="art">${locked ? ico('lock') : art}</div><div class="nm">${locked ? '???' : c.name}${foot ? `<br/><small>${foot}</small>` : ''}</div></div>`;
}

// ---------- shop ----------
interface ShopInfo { plants: number[]; discovered: number[]; cards: number[]; daily: { spun: number } }
export async function shopPanel(tab: 'shop' | 'plants' | 'cards' = 'shop') {
  let info: ShopInfo;
  try { info = await api.get<ShopInfo>('/api/shop'); } catch (e) { return err(e); }
  const m = me(), u = m.user, owned = new Set(m.cards.map((c) => c.card_id)), disc = new Set(info.discovered);
  const head = `<div class="panel-head"><div><h2>${{ shop: '🏪 Welcome to the shop!', plants: '🌿 Plant Collection', cards: '🃏 Card Collection' }[tab]}</h2><p class="sub">${{ shop: 'Coins buy seeds and gems. Gems buy animal cards for your home.', plants: 'Collect different plants to decorate your garden!', cards: 'Animals of the wild, one card at a time.' }[tab]}</p></div>
    <div class="card-row"><span class="stat-box">${ico('coin')} <b class="num">${u.coins}</b></span><span class="stat-box">${ico('gem')} <b class="num">${u.gems}</b></span></div></div>
    <div class="tabs"><button data-t="shop" class="${tab === 'shop' ? 'on' : ''}">🏪 Shop</button><button data-t="plants" class="${tab === 'plants' ? 'on' : ''}">🌿 Plants ${disc.size}/${PLANTS.length}</button><button data-t="cards" class="${tab === 'cards' ? 'on' : ''}">🃏 Cards ${owned.size}/${CARDS.length}</button></div>`;
  let body = '';
  if (tab === 'shop') {
    body = `<div style="display:grid;grid-template-columns:1fr 320px;gap:18px">
      <div><h3 style="margin:6px 0">🌱 Seeds</h3><div class="shop-grid">${info.plants.map((id) => { const pl = plantById(id)!; return `<div class="shop-item"><b>${pl.name}</b><span class="rar ${pl.rarity}">${pl.rarity}</span><div class="bag">${ico('seedbag', 'bag')}<img class="pl" src="/assets/plants/plant_${pl.sprite}.png" alt="" /></div><span class="price">${ico('coin', 'sm')} ${num(pl.price)}</span><button class="btn sm sage" data-buy="${pl.id}">Buy seed</button></div>`; }).join('')}
        <div class="shop-item"><b>Mystery Lootbox</b><span class="rar rare">5% rare</span><span style="font-size:44px;line-height:64px">🎁</span><span class="price">${ico('coin', 'sm')} ${num(LOOTBOX_PRICE)}</span><button class="btn sm" id="lootbox">Open</button></div>
        <div class="shop-item"><b>Gem</b><span class="rar epic">premium</span>${ico('gem', 'lg')}<span class="price">${ico('coin', 'sm')} ${num(GEM_PRICE_COINS)}</span><button class="btn sm" id="buygem">Buy 1 gem</button></div></div>
        <h3 style="margin:14px 0 6px">🃏 Cards</h3><div class="card-row">${info.cards.length ? info.cards.map((id) => { const c = CARDS[id]; return `<div>${cardHtml(c, false)}<button class="btn sm rose" style="width:150px;margin-top:6px" data-card="${c.id}">${ico('gem', 'sm')} ${num(c.price)}</button></div>`; }).join('') : '<p class="sub">You own every card. Legendary.</p>'}</div></div>
      <div class="spin-box"><h3 style="margin:4px 0">🎰 Daily Spin</h3><p style="margin:4px 0;font-size:14px">Pull the lever once a day. <b>Guaranteed ${num(spinBaseCoins(u.streak))} coins</b> every pull (streak bonus +${10 * Math.min(20, u.streak)}), triple on 3 coins, gems on 💎.</p>
        <div class="machine"><div class="reels"><div class="reel">${ico('coin', 'lg')}</div><div class="reel">🌱</div><div class="reel">${ico('gem', 'lg')}</div></div>
          <button class="lever" id="spin" ${info.daily.spun ? 'disabled' : ''} title="${info.daily.spun ? 'Come back tomorrow' : 'Pull!'}"><span class="stick"></span><span class="knob"></span></button></div>
        <p style="font-size:13px;margin:8px 0 0">${info.daily.spun ? 'Spun today - come back tomorrow' : '← pull the handle'}</p></div></div>`;
  } else if (tab === 'plants') {
    body = `<div class="shop-grid">${PLANTS.map((pl) => `<div class="shop-item ${disc.has(pl.id) ? '' : 'owned'}"><img src="/assets/plants/plant_${pl.sprite}.png" alt="" style="${disc.has(pl.id) ? '' : 'filter:brightness(0) opacity(.5)'}" /><b>${pl.name}</b><span class="rar ${pl.rarity}">${pl.rarity}</span><span class="price">${disc.has(pl.id) ? 'Discovered' : 'Not collected'}</span></div>`).join('')}</div>`;
  } else {
    body = `<div class="card-row">${CARDS.map((c) => cardHtml(c, !owned.has(c.id))).join('')}</div>`;
  }
  const p = openPanel(head + body, 'xwide');
  name('shop');
  p.querySelectorAll<HTMLElement>('.tabs button').forEach((b) => b.addEventListener('click', () => shopPanel(b.dataset.t as 'shop')));
  const act = async (fn: () => Promise<unknown>, after: () => void) => { try { await fn(); await refreshMe(); after(); } catch (e) { err(e); } };
  p.querySelectorAll<HTMLElement>('[data-buy]').forEach((b) => b.addEventListener('click', () => act(() => api.post('/api/shop/seed', { plant_id: Number(b.dataset.buy) }), () => { sfx.coin(); toast(`Bought a ${plantById(Number(b.dataset.buy))!.name} seed`); shopPanel(); })));
  p.querySelectorAll<HTMLElement>('[data-card]').forEach((b) => b.addEventListener('click', () => act(() => api.post('/api/shop/card', { card_id: Number(b.dataset.card) }), () => { sfx.chime(); toast(`${CARDS[Number(b.dataset.card)].name} added to your collection!`, 'reward'); shopPanel(); })));
  p.querySelector('#lootbox')?.addEventListener('click', () => act(async () => { const r = await api.post<{ plant_id: number; rarity: string }>('/api/shop/lootbox'); sfx.chime(); toast(`🎁 ${r.rarity.toUpperCase()}: ${plantById(r.plant_id)!.name} seed!`, 'reward'); }, () => shopPanel()));
  p.querySelector('#buygem')?.addEventListener('click', () => act(() => api.post('/api/shop/gems', { qty: 1 }), () => { sfx.coin(); shopPanel(); }));
  p.querySelector('#spin')?.addEventListener('click', async () => {
    const btn = p.querySelector<HTMLButtonElement>('#spin')!, reels = [...p.querySelectorAll<HTMLElement>('.reel')];
    const icon: Record<Reel, string> = { coin: ico('coin', 'lg'), sprout: '🌱', gem: ico('gem', 'lg') };
    btn.disabled = true; btn.classList.add('pulled'); sfx.click();
    try {
      const r = await api.post<{ reels: Reel[]; coins: number; gems: number }>('/api/shop/spin');
      reels.forEach((el) => el.classList.add('spinning'));
      const spinner = setInterval(() => { reels.forEach((el) => { if (el.classList.contains('spinning')) el.innerHTML = [icon.coin, '🌱', icon.gem][Math.floor(Math.random() * 3)]; }); sfx.spin(); }, 90);
      r.reels.forEach((sym, i) => setTimeout(() => { reels[i].classList.remove('spinning'); reels[i].innerHTML = icon[sym]; }, 900 + i * 500));
      setTimeout(async () => { clearInterval(spinner); sfx.coin(); toast(`+${r.coins} coins${r.gems ? ` · +${r.gems} gems!` : ''}`, 'reward'); await refreshMe(); if (panelEl?.dataset.name === 'shop') shopPanel(); }, 2200);
    } catch (e) { err(e); btn.disabled = false; btn.classList.remove('pulled'); }
  });
}

// ---------- settings ----------
export function settingsPanel() {
  const m = me(), u = m.user, s = m.stats;
  const tog = (k: string, val: number, label: string, hint = '') => `<div class="setting"><span>${label}${hint ? `<br/><small>${hint}</small>` : ''}</span><div class="toggle ${val ? 'on' : ''}" data-k="${k}"><i></i></div></div>`;
  const stat = (k: string, label: string) => `<div><b class="num">${s[k] ?? 0}</b>${label}</div>`;
  const p = openPanel(`<h2>⚙ Settings</h2><p class="sub">${esc(u.username)} · friend code <b>${u.friend_code}</b>${u.is_admin ? ' · admin' : ''}</p>
    ${tog('music', u.music, '🎵 Music')}
    <div class="setting sub-setting"><span>Track</span><div class="choice small" id="tracks">${TRACKS.map((t, i) => `<button data-track="${i}" class="${u.music_track === i ? 'on' : ''}">${t}</button>`).join('')}</div></div>
    <div class="setting sub-setting"><span>Volume <b class="num" id="vol-v">${u.music_volume}</b></span><input type="range" id="vol" min="0" max="100" value="${u.music_volume}" /></div>
    ${tog('sfx', u.sfx, '🔊 Sound effects', 'steps, planting, coins')}
    <div class="setting"><span>❄ Freeze garden<br/><small>Away for a while? Plants will not wither and your streak is safe. Your farm is closed while frozen. ${num(m.freezesLeft)} of ${FREEZES_PER_MONTH} freezes left this month.</small></span><div class="toggle ${u.frozen ? 'on' : ''}" id="freeze"><i></i></div></div>
    <div class="setting"><span>🌱 Growth pace<br/><small>How long plants take to grow. Faster costs more coins to feed.</small></span><div class="choice small" id="growth">${GROWTH_OPTIONS.map((g) => `<button data-g="${g.value}" class="${u.growth === g.value ? 'on' : ''}" title="${g.desc}">${g.label}</button>`).join('')}</div></div>
    <div class="setting"><span>🎓 Tutorial</span><button class="btn sm" id="tut">Replay walkthrough</button></div>
    <h3 style="margin:16px 0 4px">📊 Lifetime stats</h3><div class="stats-grid">${stat('tasks_completed', 'tasks completed')}${stat('xp_earned', 'XP earned')}${stat('coins_earned', 'coins earned')}${stat('minutes_worked', 'minutes on tasks')}${stat('pomodoros', 'focus sessions')}${stat('focus_minutes', 'focus minutes')}${stat('best_streak', 'best streak')}${stat('plants_planted', 'plants planted')}${stat('plants_grown', 'plants matured')}${stat('plots_bought', 'plots bought')}${stat('spins', 'daily spins')}${stat('cards_collected', 'cards collected')}</div>
    <div class="form-actions" style="margin-top:18px"><button class="btn rose" id="signout">Sign out</button></div>`);
  name('settings');
  const save = async (body: Record<string, unknown>) => { try { await api.post('/api/me/settings', body); await refreshMe(); } catch (e) { err(e); } };
  p.querySelectorAll<HTMLElement>('.toggle[data-k]').forEach((t) => t.addEventListener('click', async () => {
    const k = t.dataset.k!, val = t.classList.contains('on') ? 0 : 1;
    t.classList.toggle('on', !!val); sfx.click();
    await save({ [k]: val });
    if (k === 'music') music(!!val); if (k === 'sfx') setSfx(!!val);
  }));
  p.querySelectorAll<HTMLElement>('#tracks button').forEach((b) => b.addEventListener('click', async () => { p.querySelectorAll('#tracks button').forEach((x) => x.classList.remove('on')); b.classList.add('on'); setTrack(Number(b.dataset.track)); await save({ music_track: Number(b.dataset.track) }); }));
  const vol = p.querySelector<HTMLInputElement>('#vol')!;
  vol.addEventListener('input', () => { setVolume(Number(vol.value)); p.querySelector('#vol-v')!.textContent = vol.value; });
  vol.addEventListener('change', () => save({ music_volume: Number(vol.value) }));
  p.querySelectorAll<HTMLElement>('#growth button').forEach((b) => b.addEventListener('click', async () => { p.querySelectorAll('#growth button').forEach((x) => x.classList.remove('on')); b.classList.add('on'); await save({ growth: Number(b.dataset.g) }); toast(`Growth pace: ${b.textContent}`); }));
  p.querySelector('#freeze')!.addEventListener('click', async () => {
    const on = !u.frozen;
    if (on && !(await confirmDialog('Freeze your garden?', `Your farm closes until you unfreeze it. Plants will not wither and your streak is safe. This uses 1 of your ${m.freezesLeft} remaining freezes this month.`, 'Freeze', 'Not now'))) return settingsPanel();
    try { await api.post('/api/me/freeze', { on }); await refreshMe(); toast(on ? 'Garden frozen ❄' : 'Garden unfrozen'); } catch (e) { err(e); }
    settingsPanel();
  });
  p.querySelector('#tut')!.addEventListener('click', () => tutorial());
  p.querySelector('#signout')!.addEventListener('click', async () => { await api.post('/api/auth/logout'); location.reload(); });
}

// ---------- friends (live refresh while open) ----------
let friendsPoll: number | undefined, friendsLast = '';
function stopFriendsPoll() { clearInterval(friendsPoll); friendsPoll = undefined; }
export async function friendsPanel(silent = false) {
  let data: { friends: FriendRow[]; code: string };
  try { data = await api.get('/api/friends'); } catch (e) { return err(e); }
  const json = JSON.stringify(data);
  if (silent && json === friendsLast) return;
  friendsLast = json;
  const row = (f: FriendRow) => `<div class="friend" data-id="${f.id}"><img src="/assets/chars/portrait_${f.character ?? 0}.png" alt="" /><span class="dot ${f.online ? 'on' : ''}"></span>
    <div class="grow"><b>${esc(f.username)}</b><br/><small>${f.status === 'accepted' ? (f.online ? 'in a garden now' : 'offline') : f.status === 'incoming' ? 'wants to be your friend' : 'request sent'}</small></div>
    ${f.status === 'accepted' ? `<button class="btn sm sage" data-visit="${f.id}">Visit</button>` : f.status === 'incoming' ? `<button class="btn sm sage" data-accept="${f.id}">Accept</button>` : ''}<button class="btn sm rose" data-remove="${f.id}" title="${f.status === 'incoming' ? 'Decline' : 'Remove'}">✕</button></div>`;
  const typed = (panelEl?.dataset.name === 'friends' && (panelEl.querySelector('#fcode') as HTMLInputElement | null)?.value) || '';
  const p = openPanel(`<h2>👥 Friends</h2><p class="sub">Share your code so friends can add you. Visit anyone online to walk around their garden together. Updates live.</p>
    <div class="code-box"><span>Your code</span><span class="code">${data.code}</span><input id="fcode" maxlength="6" placeholder="FRIEND CODE" value="${esc(typed)}" /><button class="btn sm" id="fadd">Add</button></div>
    ${data.friends.map(row).join('') || '<p class="sub">No friends yet. Send someone your code!</p>'}`);
  name('friends');
  if (!friendsPoll) friendsPoll = window.setInterval(() => friendsPanel(true), 4000);
  p.querySelector('#fadd')!.addEventListener('click', async () => { try { await api.post('/api/friends/request', { code: (p.querySelector('#fcode') as HTMLInputElement).value }); toast('Request sent!'); friendsLast = ''; friendsPanel(); } catch (e) { err(e); } });
  p.querySelectorAll<HTMLElement>('[data-accept]').forEach((b) => b.addEventListener('click', async () => { try { await api.post('/api/friends/accept', { user_id: Number(b.dataset.accept) }); sfx.chime(); friendsLast = ''; friendsPanel(); } catch (e) { err(e); } }));
  p.querySelectorAll<HTMLElement>('[data-remove]').forEach((b) => b.addEventListener('click', async () => { try { await api.del(`/api/friends/${b.dataset.remove}`); friendsLast = ''; friendsPanel(); } catch (e) { err(e); } }));
  p.querySelectorAll<HTMLElement>('[data-visit]').forEach((b) => b.addEventListener('click', () => { closePanel(); goto('Garden', { ownerId: Number(b.dataset.visit), spawn: 'gate' }); }));
}
/** Owner side: someone is knocking. Non-modal card in the top-right. */
export function knockPrompt(nameText: string, character: number, answer: (accept: boolean) => void) {
  document.getElementById('knock')?.remove();
  const el = document.createElement('div'); el.id = 'knock';
  el.innerHTML = `<img src="/assets/chars/portrait_${character}.png" alt="" /><div><b>${esc(nameText)}</b> is at your gate.<br/><small>Let them into your garden?</small><div class="form-actions" style="justify-content:flex-start;margin-top:8px"><button class="btn sm sage" id="k-yes">Let in</button><button class="btn sm rose" id="k-no">Not now</button></div></div>`;
  overlay().appendChild(el); sfx.chime();
  el.querySelector('#k-yes')!.addEventListener('click', () => { answer(true); el.remove(); });
  el.querySelector('#k-no')!.addEventListener('click', () => { answer(false); el.remove(); });
  setTimeout(() => { if (el.isConnected) { answer(false); el.remove(); } }, 45_000);
}
/** Visitor side: waiting for the owner. Pass null to hide. */
export function waitingOverlay(owner: string | null, cancel?: () => void) {
  document.getElementById('waiting')?.remove();
  if (!owner) return;
  const el = document.createElement('div'); el.id = 'waiting';
  el.innerHTML = `<div class="panel" style="width:420px;text-align:center"><h2>🚪 Knocking...</h2><p class="sub">Waiting for <b>${esc(owner)}</b> to let you in.</p><div class="dots-anim"><i></i><i></i><i></i></div><button class="btn rose sm" id="w-cancel">Go back home</button></div>`;
  overlay().appendChild(el);
  el.querySelector('#w-cancel')!.addEventListener('click', () => { el.remove(); cancel?.(); });
}
/** Garden HUD (own garden): level, plots, next unlock, quick buttons. */
export function gardenHud(n: number) {
  const m = me(), lv = level().level, owned = m.plots.length, unlocked = plotsUnlocked(lv);
  let el = document.getElementById('garden-hud');
  if (!el) { el = document.createElement('div'); el.id = 'garden-hud'; overlay().appendChild(el); }
  el.innerHTML = `<b>🌿 Level ${num(lv)} garden</b> <small>${n}×${n} tiles</small><br/>Plots ${num(owned)}/${num(unlocked)}${owned < unlocked ? ` · next ${plotPrice(owned) ? `${ico('coin', 'sm')} ${num(plotPrice(owned))}` : 'free'}` : ` · level ${num(lv + 1)} unlocks more`}${m.user.wither ? `<br/><span style="color:#b55">withering ${m.user.wither}/4 - finish a task today</span>` : ''}
    <div class="form-actions" style="justify-content:flex-start;margin-top:6px"><button class="btn sm" data-o="inventory">🎒 Seeds</button><button class="btn sm" data-o="shop">🏪 Shop</button></div>`;
  el.querySelectorAll<HTMLElement>('[data-o]').forEach((b) => b.addEventListener('click', () => openers[b.dataset.o!]()));
}
export function hideGardenHud() { document.getElementById('garden-hud')?.remove(); }

// ---------- garden plot dialog ----------
export function plotDialog(tx: number, ty: number, plot: Plot | null) {
  const m = me(), lv = level().level;
  let html = '';
  if (!plot) {
    const owned = m.plots.length, unlocked = plotsUnlocked(lv), price = plotPrice(owned);
    const need = Math.ceil((owned + 1 - 4) / 2) + 1;
    html = owned >= unlocked
      ? `<h2>🌱 Empty ground</h2><p class="sub">All ${unlocked} plots for level ${lv} are in use. Reach level ${need} to unlock more.</p>`
      : `<h2>🌱 Dig a plot here?</h2><p class="sub">Tile ${tx + 1},${ty + 1} · plot ${owned + 1} of ${unlocked} unlocked · ${price ? `costs ${ico('coin', 'sm')} ${num(price)}` : 'free!'}</p><div class="form-actions"><button class="btn sage" id="buy">Dig plot${price ? ` (${price} coins)` : ''}</button></div>`;
  } else if (!plot.plant_id) {
    const seeds = m.inventory.filter((i) => i.qty > 0);
    html = `<h2>🌱 Plant a seed</h2><p class="sub">Pick something from your inventory.</p><div class="slots big">${seeds.map((s) => { const pl = plantById(s.plant_id)!; return `<div class="slot seed" style="cursor:pointer" data-plant="${pl.id}"><div class="bag">${ico('seedbag', 'bag')}<img class="pl" src="/assets/plants/plant_${pl.sprite}.png" alt="" /></div><span class="nm">${pl.name}</span><span class="qty num">×${s.qty}</span></div>`; }).join('') || '<p class="sub">No seeds. Visit the shop (Q).</p>'}</div>`;
  } else {
    const pl = plantById(plot.plant_id)!, stage = ['Seed', 'Sprout', 'Growing', 'Mature'][plot.stage];
    const growing = plot.ready_at && plot.ready_at > Date.now();
    html = `<h2>${pl.name}</h2><p class="sub">${stage} · stage ${plot.stage}/${STAGES}${m.user.wither ? ` · withering ${m.user.wither}/4 - complete tasks to revive` : ''}</p>
      <div style="text-align:center"><img src="${plot.stage >= 3 ? `/assets/plants/plant_${pl.sprite}.png` : `/assets/tiles/crop_${plot.stage}.png`}" style="height:96px" alt="" /></div>
      ${growing ? `<p class="sub" style="text-align:center">Growing... ready in ${fmtMs(plot.ready_at! - Date.now())}</p>`
        : plot.stage >= STAGES ? '<p class="sub" style="text-align:center">Fully grown. Looking good!</p>'
        : `<div class="form-actions"><button class="btn sage" id="feed">🌾 Feed (${growthCost(plot.stage, m.user.growth)} coins) · grows in ${fmtMs(growthMs(plot.stage, m.user.growth))}</button></div>`}
      <div class="form-actions"><button class="btn rose sm" id="clear">Remove plant</button></div>`;
  }
  const p = openPanel(html);
  name('plot');
  const act = async (fn: () => Promise<unknown>, msg: string) => { try { await fn(); await refreshMe(); sfx.plant(); toast(msg, 'reward'); closePanel(); } catch (e) { err(e); } };
  p.querySelector('#buy')?.addEventListener('click', () => act(() => api.post('/api/plots/buy', { tx, ty }), 'New plot ready for planting'));
  p.querySelectorAll<HTMLElement>('[data-plant]').forEach((b) => b.addEventListener('click', () => act(() => api.post(`/api/plots/${plot!.id}/plant`, { plant_id: Number(b.dataset.plant) }), `Planted ${plantById(Number(b.dataset.plant))!.name}. Feed it to start growing.`)));
  p.querySelector('#feed')?.addEventListener('click', () => act(() => api.post(`/api/plots/${plot!.id}/feed`), 'Fed! Come back when the timer ends.'));
  p.querySelector('#clear')?.addEventListener('click', async () => { if (await confirmDialog('Remove this plant?', 'The seed is not refunded.', 'Remove', 'Keep')) act(() => api.post(`/api/plots/${plot!.id}/clear`), 'Plot cleared'); });
}

// ---------- card case (in the house) ----------
export function cardCasePanel() {
  const m = me(), slots = caseSlots(level().level), owned = m.cards;
  const p = openPanel(`<h2>🖼 Card Case</h2><p class="sub">${slots} display slots at level ${level().level} (+2 every 5 levels). Pick a card for each slot.</p>
    <div class="slots case">${Array.from({ length: slots }, (_, i) => { const c = owned.find((x) => x.slot === i); return `<div class="slot">${c ? cardHtml(CARDS[c.card_id], false).replace('class="tcard', 'style="width:100%" class="tcard') : '<div style="padding-top:30px">empty</div>'}<select data-slot="${i}" style="width:100%;margin-top:4px"><option value="">— empty —</option>${owned.map((x) => `<option value="${x.card_id}" ${x.slot === i ? 'selected' : ''}>${CARDS[x.card_id].name}</option>`).join('')}</select></div>`; }).join('')}</div>`, 'wide');
  name('case');
  p.querySelectorAll<HTMLSelectElement>('select').forEach((s) => s.addEventListener('change', async () => {
    const slot = Number(s.dataset.slot);
    try {
      const prev = owned.find((x) => x.slot === slot);
      if (prev && String(prev.card_id) !== s.value) await api.post(`/api/cards/${prev.card_id}/place`, { slot: null });
      if (s.value) await api.post(`/api/cards/${s.value}/place`, { slot });
      await refreshMe(); sfx.click(); cardCasePanel();
    } catch (e) { err(e); }
  }));
}

// ---------- sleep (end-of-day summary) ----------
export function sleepPanel() {
  const m = me(), d = m.daily, done = m.tasks.filter((t) => t.completed_at && new Date(t.completed_at).toDateString() === new Date().toDateString());
  const p = openPanel(`<h2 style="text-align:center">🌙 Good night</h2><p class="sub" style="text-align:center">Here is your day, ${esc(m.user.username)}.</p>
    <div class="card-row" style="margin:14px 0"><div class="stat-box"><div><small>Tasks done</small><b class="num">${d.tasks_done}</b></div></div><div class="stat-box">${ico('xp')}<div><small>XP today</small><b class="num">${d.xp}</b></div></div><div class="stat-box">${ico('coin')}<div><small>Coins today</small><b class="num">${d.coins}</b></div></div><div class="stat-box">${ico('streak')}<div><small>Streak</small><b class="num">${m.user.streak}</b></div></div></div>
    ${done.length ? `<div class="task-list">${done.map((t) => `<div class="task done"><div class="check">✓</div><div><div class="name">${esc(t.name)}</div></div><div class="meta"><span class="pts">+${t.xp_awarded} XP</span></div><div></div></div>`).join('')}</div>` : '<p class="sub" style="text-align:center">No tasks finished yet today. Tomorrow is a new leaf.</p>'}
    <p class="sub" style="text-align:center;margin-top:12px">${m.user.streak ? `Keep the streak alive tomorrow: one task keeps your garden green.` : 'Finish one task tomorrow to start a streak.'}</p>
    <div class="form-actions"><button class="btn sage" id="wake">☀ Wake up</button></div>`);
  name('sleep');
  p.querySelector('#wake')!.addEventListener('click', closePanel);
}

// ---------- tutorial ----------
const STEPS: [string, string][] = [
  ['Welcome to Ikigai 🌱', 'Your garden only grows when you do. Finish real tasks to earn XP and coins, then spend them on your garden.'],
  ['Move around', 'WASD or the arrow keys walk. Hold Shift to run. Press F to wave at friends.'],
  ['Your task book 📖', 'Press T (or E at your desk) to add tasks with a difficulty and time estimate. Completing them pays XP + coins. Organize them in folders.'],
  ['Focus timer ⏱', 'Press P for the Pomodoro timer, or ▶ on a task. A task finished after a focus session pays double XP.'],
  ['The garden 🌿', 'Walk out the bottom door. Stand on a tile and press E to dig a plot, plant a seed, or feed a plant. Feeding starts a real-time growth timer.'],
  ['Streaks and withering 🍂', 'Finish at least one task a day to keep your streak. Miss two days and your plants start to grey. Freeze the garden in Settings when you are away (2 per month).'],
  ['Shop and cards 🏪', 'Press Q for seeds, gems and the daily spin. Gems buy animal cards to display in the case by your bookshelf.'],
  ['Friends 👥', 'Walk through the door on the right to add friends by code. Visit their garden, wave and chat with Enter. They decide whether to let you in.'],
];
export function tutorial(step = 0) {
  if (step >= STEPS.length) { closePanel(); api.post('/api/me/settings', { tutorial_done: 1 }).then(refreshMe).catch(() => {}); return; }
  const [title, body] = STEPS[step];
  const p = openPanel(`<div class="tut"><small>Walkthrough ${step + 1} / ${STEPS.length}</small><h2>${title}</h2><p>${body}</p>
    <div class="form-actions"><button class="btn sage" id="t-next">${step === STEPS.length - 1 ? 'Start growing' : 'Next →'}</button><button class="btn sm" id="t-skip">Skip</button></div></div>`);
  name('tutorial');
  p.querySelector('#t-next')!.addEventListener('click', () => { sfx.click(); tutorial(step + 1); });
  p.querySelector('#t-skip')!.addEventListener('click', () => tutorial(STEPS.length));
}
export { store, gardenTiles };
