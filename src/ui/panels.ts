import { api } from '../api';
import { me, level, refreshMe, toast, on, store } from '../state';
import { goto } from '../game';
import { sfx, music, setSfx } from './audio';
import {
  DAILY_CAP, PLANTS, CARDS, plantById, previewReward, plotsUnlocked, plotPrice, STAGE_FEED_COINS, STAGE_MS, STAGES, caseSlots,
  LOOTBOX_PRICE, GEM_PRICE_COINS, spinBaseCoins, type Task, type Plot, type FriendRow, type Reel,
} from '../shared/rules';

/** Escape user-supplied text before it goes into innerHTML. */
export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const overlay = () => document.getElementById('overlay')!;
const fmtMin = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m} min`);
const bucket = (m: number) => (m <= 30 ? '0 - 30 min' : m <= 60 ? '30 min - 1 hr' : m <= 180 ? '1 - 3 hrs' : '3+ hrs');
const stars = (d: number) => `<span class="stars">${'★'.repeat(d)}<span class="off">${'★'.repeat(3 - d)}</span></span>`;
const dateOf = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const err = (e: unknown) => { toast((e as Error).message, 'err'); sfx.error(); };

// ---------- panel plumbing ----------
let panelEl: HTMLElement | null = null;
let onEsc: (() => void) | null = null;
export function isPanelOpen() { return !!panelEl; }
export function closePanel() { panelEl?.remove(); panelEl = null; onEsc = null; renderMini(); }
export function openPanel(html: string, cls = ''): HTMLElement {
  closePanel();
  const back = document.createElement('div'); back.className = 'panel-back';
  back.innerHTML = `<div class="panel ${cls}"><button class="x" aria-label="Close">✕</button>${html}</div>`;
  back.addEventListener('click', (e) => { if (e.target === back) closePanel(); });
  back.querySelector('.x')!.addEventListener('click', closePanel);
  overlay().appendChild(back); panelEl = back; renderMini();
  return back.querySelector('.panel')!;
}
export function setHint(text: string | null) {
  let el = document.getElementById('hint');
  if (!text) { el?.remove(); return; }
  if (!el) { el = document.createElement('div'); el.id = 'hint'; overlay().appendChild(el); }
  el.textContent = text;
}
const dailyBar = () => { const d = me().daily; const pct = Math.min(100, Math.round((d.xp / DAILY_CAP.xp) * 100)); return `<div class="daily"><div class="row"><span>🌱 Daily progress ${pct < 100 ? (pct < 50 ? '- keep going!' : '- you\'re doing great!') : '- daily cap reached!'}</span><span>${d.xp}/${DAILY_CAP.xp} XP · ${d.coins}/${DAILY_CAP.coins} coins</span></div><div class="bar"><i style="width:${pct}%"></i></div></div>`; };

// ---------- navbar + HUD ----------
const NAV = [['pomodoro', 'P', 'Pomodoro'], ['tasks', 'T', 'Task Book'], ['map', 'M', 'Map'], ['inventory', 'I', 'Inventory'], ['shop', 'Q', 'Shop'], ['settings', 'Esc', 'Settings']] as const;
const openers: Record<string, () => void> = { pomodoro: () => pomodoroPanel(), tasks: tasksPanel, map: mapPanel, inventory: inventoryPanel, shop: () => shopPanel(), settings: settingsPanel };
export function mountNavbar() {
  if (document.getElementById('navbar')) return;
  const nav = document.createElement('div'); nav.id = 'navbar';
  nav.innerHTML = `<span class="logo">IKIGAI</span><div class="hud"></div><div class="nav-icons">${NAV.map(([k, key, title]) => `<button class="nav-btn" data-open="${k}" title="${title}"><img src="/assets/ui/icon_${k}.png" alt="" />${key}</button>`).join('')}</div>`;
  document.body.appendChild(nav);
  nav.querySelectorAll<HTMLElement>('[data-open]').forEach((b) => b.addEventListener('click', () => { sfx.click(); openers[b.dataset.open!](); }));
  renderHud(); on('me', renderHud);
  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    if (e.key === 'Escape') { if (onEsc) onEsc(); else if (panelEl) closePanel(); else settingsPanel(); return; }
    const k = { p: 'pomodoro', t: 'tasks', m: 'map', i: 'inventory', q: 'shop' }[e.key.toLowerCase()];
    if (k && !e.repeat) { if (panelEl?.dataset.name === k) closePanel(); else { sfx.click(); openers[k](); } }
  });
}
function renderHud() {
  const u = me().user, lv = level();
  const pct = lv.next ? Math.round((lv.into / lv.next) * 100) : 100;
  document.querySelector('#navbar .hud')!.innerHTML = `
    <div class="xp"><span>Lv ${lv.level} · ${lv.next ? `${lv.into}/${lv.next} XP` : 'MAX'}</span><div class="bar"><i style="width:${pct}%"></i></div></div>
    <span class="pill">🪙 ${u.coins}</span><span class="pill">💎 ${u.gems}</span><span class="pill">🔥 ${u.streak}</span>`;
}
const name = (n: string) => { if (panelEl) panelEl.dataset.name = n; };

// ---------- tasks ----------
export function tasksPanel() {
  const tasks = me().tasks;
  const row = (t: Task) => {
    const done = !!t.completed_at, pts = done ? t.xp_awarded : previewReward(t.difficulty, t.est_minutes).xp;
    return `<div class="task ${done ? 'done' : ''}" data-id="${t.id}">
      <div class="check" data-act="complete">${done ? '✓' : ''}</div>
      <div><div class="name">${esc(t.name)}</div><div class="desc">${esc(t.description)}</div></div>
      <div class="meta">${stars(t.difficulty)}<span><span class="pts">⭐ +${pts} pts${t.pomodoro && !done ? ' ×2' : ''}</span> 📅 ${dateOf(t.created_at)}</span><span>⏱ ${bucket(t.est_minutes)} (${fmtMin(t.est_minutes)})</span></div>
      <div>${done ? '' : '<button class="play" data-act="start" title="Start focus timer">▶</button>'} <button class="del" data-act="delete" title="Delete">🗑</button></div></div>`;
  };
  const p = openPanel(`<div class="panel-head"><div><h2>My Tasks</h2><p class="sub">Small steps, big progress.</p></div><button class="btn sm" id="new-task">+ New Task</button></div>
    ${dailyBar()}<div class="task-list">${tasks.length ? tasks.map(row).join('') : '<p class="sub">No tasks yet. Plant one!</p>'}</div>
    <p class="sub" style="text-align:center;margin-top:12px">🌱 Progress looks good on you. 🌱</p>`, 'wide');
  name('tasks');
  p.querySelector('#new-task')!.addEventListener('click', createTaskPanel);
  p.querySelectorAll<HTMLElement>('[data-act]').forEach((b) => b.addEventListener('click', async () => {
    const id = Number(b.closest<HTMLElement>('.task')!.dataset.id), t = tasks.find((x) => x.id === id)!;
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
  toast(`+${r.xp} XP · +${r.coins} coins${r.capped ? ' (daily cap reached)' : ''} · 🔥 ${r.streak} day streak`, 'reward');
  if (r.leveledUp) { sfx.levelUp(); setTimeout(() => toast(`🎉 Level ${r.level}! Your garden grew.`, 'reward'), 600); }
  if (panelEl?.dataset.name === 'tasks') tasksPanel();
}
export function createTaskPanel() {
  let difficulty = 1, est = 20, mode: '0-30' | '30-60' | '60-180' | '180+' = '0-30';
  const p = openPanel(`<h2 style="text-align:center">🌱 Create a Task</h2><p class="sub" style="text-align:center">Plant a task today, grow a better tomorrow.</p>
    <form class="form" id="task-form">
      <label>🌱 Task Name</label><input type="text" name="name" maxlength="50" required placeholder="e.g. Finish database homework" /><div class="count"><span id="c1">0</span>/50</div>
      <label>📝 Description</label><textarea name="description" maxlength="200" rows="2" placeholder="Add more details about your task..."></textarea><div class="count"><span id="c2">0</span>/200</div>
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
  const preview = () => { const r = previewReward(difficulty, est); p.querySelector('#preview')!.textContent = `You'll get ${r.xp} XP + ${r.coins} coins (${fmtMin(est)}) · 2× XP with the focus timer`; };
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
  const fName = form.elements.namedItem('name') as HTMLInputElement, fDesc = form.elements.namedItem('description') as HTMLTextAreaElement;
  fName.addEventListener('input', () => (p.querySelector('#c1')!.textContent = String(fName.value.length)));
  fDesc.addEventListener('input', () => (p.querySelector('#c2')!.textContent = String(fDesc.value.length)));
  let start = false;
  form.querySelectorAll<HTMLButtonElement>('[data-start]').forEach((b) => b.addEventListener('click', () => (start = b.dataset.start === '1')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const t = await api.post<Task>('/api/tasks', { name: fName.value, description: fDesc.value, difficulty, est_minutes: est, start });
      await refreshMe(); sfx.plant();
      if (start) pomodoroPanel(t.id); else tasksPanel();
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
  // task mode: a single countdown of the estimate; otherwise the user's saved pomodoro settings
  let work = task ? task.est_minutes : u.pomo_work, brk = u.pomo_break, reps = task ? 1 : u.pomo_reps;
  if (pomo && !pomo.done && (task ? pomo.taskId !== task.id : true)) { work = pomo.work; brk = pomo.brk; reps = pomo.reps; }
  const p = openPanel(`<div class="pomo">
    <div class="clock"><h2>Focus Time</h2>${task ? `<p class="sub">⏱ ${esc(task.name)} · 2× XP when completed</p>` : '<p class="sub">Every finished session is logged to your lifetime stats.</p>'}
      <div class="face"><div class="time" id="pt">${mmss(work * 60_000)}</div></div><div class="phase" id="pp">ready</div>
      <div class="form-actions"><button class="btn" id="p-start">▶ Start</button><button class="btn rose" id="p-reset">■ Reset</button>${task ? '<button class="btn sage" id="p-done">✓ Done</button>' : ''}</div>
      <div class="dots" id="pd"></div></div>
    <div><h2>Settings</h2>
      <div class="stepper"><span>Work Duration</span><div><button data-k="work" data-d="-5">−</button><b id="s-work">${work} min</b><button data-k="work" data-d="5">+</button></div></div>
      <div class="stepper"><span>Break Duration</span><div><button data-k="brk" data-d="-1">−</button><b id="s-brk">${brk} min</b><button data-k="brk" data-d="1">+</button></div></div>
      <div class="stepper"><span>Repetitions</span><div><button data-k="reps" data-d="-1">−</button><b id="s-reps">${reps}</b><button data-k="reps" data-d="1">+</button></div></div>
      <p class="sub">Settings apply when you press Start.${task ? '' : ' Saved as your defaults.'}</p>
      <p class="sub">Lifetime: ${me().stats.pomodoros ?? 0} sessions · ${me().stats.focus_minutes ?? 0} focus minutes</p></div></div>`, 'wide');
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
  el.innerHTML = `Focus Time<b>${mmss(remaining())}</b><small>${pomo.phase}${pomo.paused !== null ? ' · paused' : ''} · ${pomo.rep}/${pomo.reps}</small>`;
}

// ---------- map ----------
export function mapPanel() {
  const p = openPanel(`<div class="panel-head"><h2>🗺 Map</h2><p class="sub">Click a place to teleport.</p></div>
    <div class="map-img"><img src="/assets/ui/map.png" alt="Map" />
      <button class="hotspot" style="left:52%;top:31%" data-to="house">🏠 Home<small>Productivity</small></button>
      <button class="hotspot" style="left:17%;top:63%" data-to="garden">🌱 My Garden</button>
      <button class="hotspot" style="left:86%;top:63%" data-to="friends">👥 Friends' Gardens</button>
      <button class="hotspot locked" disabled title="Coming soon">🔒 The Fountain<small>locked</small></button>
    </div>`, 'wide');
  name('map');
  (p.querySelector('.hotspot.locked') as HTMLElement).style.cssText = 'left:52%;top:75%';
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
    ? `<div class="slots">${seeds.map((s) => { const pl = plantById(s.plant_id)!; return `<div class="slot" title="${pl.name}"><img src="/assets/plants/plant_${pl.sprite}.png" alt="" /><span class="nm">${pl.name}</span><span class="qty">×${s.qty}</span></div>`; }).join('')}${Array.from({ length: Math.max(0, 12 - seeds.length) }, () => '<div class="slot">🌱</div>').join('')}</div><p class="sub" style="margin-top:10px">Walk onto a plot in your garden and press E to plant a seed.</p>`
    : `<div class="card-row">${m.cards.map((c) => cardHtml(CARDS[c.card_id], false, c.slot !== null ? `case slot ${c.slot + 1}` : 'in inventory')).join('') || '<p class="sub">No cards yet. Buy them with gems in the shop.</p>'}</div><p class="sub" style="margin-top:10px">Display cards in the case inside your house (press E by the bookshelf).</p>`;
  const p = openPanel(`${dailyBar()}
    <div class="card-row" style="margin-bottom:14px"><div class="stat-box">💎<div><small>Gems</small><b>${u.gems}</b></div></div><div class="stat-box">🪙<div><small>Coins</small><b>${u.coins}</b></div></div><div class="stat-box">🔥<div><small>Streak</small><b>${u.streak}</b></div></div></div>
    <div class="tabs"><button data-t="seeds" class="${tab === 'seeds' ? 'on' : ''}">🌱 Seeds</button><button data-t="cards" class="${tab === 'cards' ? 'on' : ''}">🃏 Cards</button></div>${body}`, 'wide');
  name('inventory');
  p.querySelectorAll<HTMLElement>('.tabs button').forEach((b) => b.addEventListener('click', () => inventoryPanel(b.dataset.t as 'seeds')));
}
export function cardHtml(c: { id: number; name: string; rarity: string; art: boolean }, locked: boolean, foot = '') {
  const art = c.art ? `<img src="/assets/cards/card_${c.id}.png" alt="" />` : `<span>${['🦊', '🦉', '🐟', '🦌', '🐼', '🐇', '🦦', '🦋', '🐈', '🐺', '🔥', '🐉'][c.id] ?? '🐾'}</span>`;
  return `<div class="tcard ${locked ? 'locked' : ''}"><div class="head rar ${c.rarity}">${locked ? '🔒' : c.rarity}</div><div class="art">${locked ? '🔒' : art}</div><div class="nm">${locked ? '???' : c.name}${foot ? `<br/><small>${foot}</small>` : ''}</div></div>`;
}

// ---------- shop ----------
interface ShopInfo { plants: number[]; discovered: number[]; cards: number[]; daily: { spun: number } }
export async function shopPanel(tab: 'shop' | 'plants' | 'cards' = 'shop') {
  let info: ShopInfo;
  try { info = await api.get<ShopInfo>('/api/shop'); } catch (e) { return err(e); }
  const m = me(), u = m.user, owned = new Set(m.cards.map((c) => c.card_id)), disc = new Set(info.discovered);
  const head = `<div class="panel-head"><div><h2>${{ shop: 'Welcome to the shop!', plants: '🌿 Plant Collection', cards: '🃏 Card Collection' }[tab]}</h2><p class="sub">${{ shop: 'Use your coins to get plants and gems to collect cards for your home.', plants: 'Collect different plants to decorate your garden!', cards: 'Animals of the wild, one card at a time.' }[tab]}</p></div>
    <div class="card-row"><span class="stat-box">🪙 <b>${u.coins}</b></span><span class="stat-box">💎 <b>${u.gems}</b></span></div></div>
    <div class="tabs"><button data-t="shop" class="${tab === 'shop' ? 'on' : ''}">🏪 Shop</button><button data-t="plants" class="${tab === 'plants' ? 'on' : ''}">🌿 Plants ${disc.size}/${PLANTS.length}</button><button data-t="cards" class="${tab === 'cards' ? 'on' : ''}">🃏 Cards ${owned.size}/${CARDS.length}</button></div>`;
  let body = '';
  if (tab === 'shop') {
    body = `<div style="display:grid;grid-template-columns:1fr 300px;gap:18px">
      <div><h3 style="margin:6px 0">🌱 Plants</h3><div class="shop-grid">${info.plants.map((id) => { const pl = plantById(id)!; return `<div class="shop-item"><b>${pl.name}</b><span class="rar ${pl.rarity}">${pl.rarity}</span><img src="/assets/plants/plant_${pl.sprite}.png" alt="" /><span class="price">🪙 ${pl.price}</span><button class="btn sm sage" data-buy="${pl.id}">Buy seed</button></div>`; }).join('')}
        <div class="shop-item"><b>Mystery Lootbox</b><span class="rar rare">5% rare</span><span style="font-size:44px">🎁</span><span class="price">🪙 ${LOOTBOX_PRICE}</span><button class="btn sm" id="lootbox">Open</button></div>
        <div class="shop-item"><b>Gem</b><span class="rar epic">premium</span><span style="font-size:44px">💎</span><span class="price">🪙 ${GEM_PRICE_COINS}</span><button class="btn sm" id="buygem">Buy 1 gem</button></div></div>
        <h3 style="margin:14px 0 6px">🃏 Cards</h3><div class="card-row">${info.cards.length ? info.cards.map((id) => { const c = CARDS[id]; return `<div>${cardHtml(c, false)}<button class="btn sm rose" style="width:150px;margin-top:6px" data-card="${c.id}">💎 ${c.price}</button></div>`; }).join('') : '<p class="sub">You own every card. Legendary.</p>'}</div></div>
      <div class="spin-box"><h3 style="margin:4px 0">🎰 Daily Spin</h3><p style="margin:4px 0;font-size:14px">Spin once a day for coins and rare gems! Streak bonus: +${Math.min(200, 10 * u.streak)} coins (base ${spinBaseCoins(u.streak)})</p>
        <div class="reels"><div class="reel">🪙</div><div class="reel">🌱</div><div class="reel">💎</div></div>
        <button class="btn" id="spin" ${info.daily.spun ? 'disabled' : ''}>${info.daily.spun ? 'Come back tomorrow' : 'Spin'}</button><p style="font-size:12px;margin:8px 0 0">1 spin per day · 3× 🪙 = triple coins · 💎 count = gems</p></div></div>`;
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
    const btn = p.querySelector<HTMLButtonElement>('#spin')!, reels = [...p.querySelectorAll<HTMLElement>('.reel')], icon: Record<Reel, string> = { coin: '🪙', sprout: '🌱', gem: '💎' };
    btn.disabled = true;
    try {
      const r = await api.post<{ reels: Reel[]; coins: number; gems: number }>('/api/shop/spin');
      reels.forEach((el) => el.classList.add('spinning'));
      const spinner = setInterval(() => { reels.forEach((el) => { if (el.classList.contains('spinning')) el.textContent = ['🪙', '🌱', '💎'][Math.floor(Math.random() * 3)]; }); sfx.spin(); }, 90);
      r.reels.forEach((sym, i) => setTimeout(() => { reels[i].classList.remove('spinning'); reels[i].textContent = icon[sym]; }, 900 + i * 500));
      setTimeout(async () => { clearInterval(spinner); sfx.coin(); toast(`+${r.coins} coins${r.gems ? ` · +${r.gems} gems!` : ''}`, 'reward'); await refreshMe(); if (panelEl?.dataset.name === 'shop') shopPanel(); }, 2200);
    } catch (e) { err(e); btn.disabled = false; }
  });
}

// ---------- settings ----------
export function settingsPanel() {
  const m = me(), u = m.user, s = m.stats;
  const tog = (k: string, val: number, label: string, hint = '') => `<div class="setting"><span>${label}${hint ? `<br/><small style="font-size:12px;color:#6b5a48">${hint}</small>` : ''}</span><div class="toggle ${val ? 'on' : ''}" data-k="${k}"><i></i></div></div>`;
  const stat = (k: string, label: string) => `<div><b>${s[k] ?? 0}</b>${label}</div>`;
  const p = openPanel(`<h2>⚙ Settings</h2><p class="sub">${esc(u.username)} · friend code <b>${u.friend_code}</b></p>
    ${tog('music', u.music, '🎵 Music', 'soft lofi loop')}${tog('sfx', u.sfx, '🔊 Sound effects', 'steps, planting, coins')}
    ${tog('frozen', u.frozen, '❄ Freeze garden', 'away for a while? plants will not wither and your streak is safe')}
    <h3 style="margin:16px 0 4px">📊 Lifetime stats</h3><div class="stats-grid">${stat('tasks_completed', 'tasks completed')}${stat('xp_earned', 'XP earned')}${stat('coins_earned', 'coins earned')}${stat('minutes_worked', 'minutes on tasks')}${stat('pomodoros', 'focus sessions')}${stat('focus_minutes', 'focus minutes')}${stat('best_streak', 'best streak')}${stat('plants_planted', 'plants planted')}${stat('plants_grown', 'plants matured')}${stat('plots_bought', 'plots bought')}${stat('spins', 'daily spins')}${stat('cards_collected', 'cards collected')}</div>
    <div class="form-actions" style="margin-top:18px"><button class="btn rose" id="signout">Sign out</button></div>`);
  name('settings');
  p.querySelectorAll<HTMLElement>('.toggle').forEach((t) => t.addEventListener('click', async () => {
    const k = t.dataset.k!, val = t.classList.contains('on') ? 0 : 1;
    t.classList.toggle('on', !!val);
    try { await api.post('/api/me/settings', { [k]: val }); await refreshMe(); if (k === 'music') music(!!val); if (k === 'sfx') setSfx(!!val); sfx.click(); } catch (e) { err(e); }
  }));
  p.querySelector('#signout')!.addEventListener('click', async () => { await api.post('/api/auth/logout'); location.reload(); });
}

// ---------- friends ----------
export async function friendsPanel() {
  let data: { friends: FriendRow[]; code: string };
  try { data = await api.get('/api/friends'); } catch (e) { return err(e); }
  const row = (f: FriendRow) => `<div class="friend" data-id="${f.id}"><img src="/assets/chars/portrait_${f.character ?? 0}.png" alt="" /><span class="dot ${f.online ? 'on' : ''}"></span>
    <div class="grow"><b>${esc(f.username)}</b><br/><small>${f.status === 'accepted' ? (f.online ? 'in a garden now' : 'offline') : f.status === 'incoming' ? 'wants to be your friend' : 'request sent'}</small></div>
    ${f.status === 'accepted' ? `<button class="btn sm sage" data-visit="${f.id}">Visit</button>` : f.status === 'incoming' ? `<button class="btn sm sage" data-accept="${f.id}">Accept</button>` : ''}<button class="btn sm rose" data-remove="${f.id}">✕</button></div>`;
  const p = openPanel(`<h2>👥 Friends</h2><p class="sub">Share your code so friends can add you. Visit anyone online to walk around their garden together.</p>
    <div class="code-box"><span>Your code</span><span class="code">${data.code}</span><input id="fcode" maxlength="6" placeholder="FRIEND CODE" /><button class="btn sm" id="fadd">Add</button></div>
    ${data.friends.map(row).join('') || '<p class="sub">No friends yet. Send someone your code!</p>'}`);
  name('friends');
  p.querySelector('#fadd')!.addEventListener('click', async () => { try { await api.post('/api/friends/request', { code: (p.querySelector('#fcode') as HTMLInputElement).value }); toast('Request sent!'); friendsPanel(); } catch (e) { err(e); } });
  p.querySelectorAll<HTMLElement>('[data-accept]').forEach((b) => b.addEventListener('click', async () => { try { await api.post('/api/friends/accept', { user_id: Number(b.dataset.accept) }); sfx.chime(); friendsPanel(); } catch (e) { err(e); } }));
  p.querySelectorAll<HTMLElement>('[data-remove]').forEach((b) => b.addEventListener('click', async () => { try { await api.del(`/api/friends/${b.dataset.remove}`); friendsPanel(); } catch (e) { err(e); } }));
  p.querySelectorAll<HTMLElement>('[data-visit]').forEach((b) => b.addEventListener('click', () => { closePanel(); goto('Garden', { ownerId: Number(b.dataset.visit), spawn: 'gate' }); }));
}

// ---------- garden plot dialog ----------
export function plotDialog(tx: number, ty: number, plot: Plot | null) {
  const m = me(), lv = level().level;
  let html = '';
  if (!plot) {
    const owned = m.plots.length, unlocked = plotsUnlocked(lv), price = plotPrice(owned);
    const need = Math.ceil((owned + 1 - 4) / 2) + 1;
    html = owned >= unlocked
      ? `<h2>🌱 Empty ground</h2><p class="sub">All ${unlocked} plots for level ${lv} are in use. Reach level ${need} to unlock more.</p>`
      : `<h2>🌱 Make a plot here?</h2><p class="sub">Tile ${tx + 1},${ty + 1} · plot ${owned + 1} of ${unlocked} unlocked · ${price ? `costs 🪙 ${price}` : 'free!'}</p><div class="form-actions"><button class="btn sage" id="buy">Dig plot${price ? ` (🪙 ${price})` : ''}</button></div>`;
  } else if (!plot.plant_id) {
    const seeds = m.inventory.filter((i) => i.qty > 0);
    html = `<h2>🌱 Plant a seed</h2><p class="sub">Pick something from your inventory.</p><div class="slots">${seeds.map((s) => { const pl = plantById(s.plant_id)!; return `<div class="slot" style="cursor:pointer" data-plant="${pl.id}"><img src="/assets/plants/plant_${pl.sprite}.png" alt="" /><span class="nm">${pl.name}</span><span class="qty">×${s.qty}</span></div>`; }).join('') || '<p class="sub">No seeds. Visit the shop (Q).</p>'}</div>`;
  } else {
    const pl = plantById(plot.plant_id)!, stage = ['Seed', 'Sprout', 'Growing', 'Mature'][plot.stage];
    const growing = plot.ready_at && plot.ready_at > Date.now();
    html = `<h2>${pl.name}</h2><p class="sub">${stage} · stage ${plot.stage}/${STAGES}${m.user.wither ? ` · withering ${m.user.wither}/4 - complete tasks to revive` : ''}</p>
      <div style="text-align:center"><img src="/assets/plants/plant_${pl.sprite}.png" style="height:96px;${plot.stage ? '' : 'filter:grayscale(1) opacity(.4)'}" alt="" /></div>
      ${growing ? `<p class="sub" style="text-align:center">Growing... ready in ${fmtMs(plot.ready_at! - Date.now())}</p>`
        : plot.stage >= STAGES ? '<p class="sub" style="text-align:center">Fully grown. Looking good!</p>'
        : `<div class="form-actions"><button class="btn sage" id="feed">🌾 Feed (🪙 ${STAGE_FEED_COINS[plot.stage]}) · grows in ${fmtMs(STAGE_MS[plot.stage])}</button></div>`}
      <div class="form-actions"><button class="btn rose sm" id="clear">Remove plant</button></div>`;
  }
  const p = openPanel(html);
  name('plot');
  const act = async (fn: () => Promise<unknown>, msg: string) => { try { await fn(); await refreshMe(); sfx.plant(); toast(msg, 'reward'); closePanel(); } catch (e) { err(e); } };
  p.querySelector('#buy')?.addEventListener('click', () => act(() => api.post('/api/plots/buy', { tx, ty }), 'New plot ready for planting'));
  p.querySelectorAll<HTMLElement>('[data-plant]').forEach((b) => b.addEventListener('click', () => act(() => api.post(`/api/plots/${plot!.id}/plant`, { plant_id: Number(b.dataset.plant) }), `Planted ${plantById(Number(b.dataset.plant))!.name}. Feed it to start growing.`)));
  p.querySelector('#feed')?.addEventListener('click', () => act(() => api.post(`/api/plots/${plot!.id}/feed`), 'Fed! Come back when the timer ends.'));
  p.querySelector('#clear')?.addEventListener('click', () => { if (confirm('Remove this plant? The seed is not refunded.')) act(() => api.post(`/api/plots/${plot!.id}/clear`), 'Plot cleared'); });
}
const fmtMs = (ms: number) => { const mi = Math.ceil(ms / 60000); return mi >= 60 ? `${Math.floor(mi / 60)}h ${mi % 60}m` : `${mi}m`; };

// ---------- card case (in the house) ----------
export function cardCasePanel() {
  const m = me(), slots = caseSlots(level().level), owned = m.cards;
  const p = openPanel(`<h2>🖼 Card Case</h2><p class="sub">${slots} display slots at level ${level().level} (+2 every 5 levels). Pick a card for each slot.</p>
    <div class="slots">${Array.from({ length: slots }, (_, i) => { const c = owned.find((x) => x.slot === i); return `<div class="slot" style="display:block;padding:6px">${c ? cardHtml(CARDS[c.card_id], false).replace('class="tcard', 'style="width:100%" class="tcard') : '<div style="padding-top:30px">empty</div>'}<select data-slot="${i}" style="width:100%;margin-top:4px"><option value="">— empty —</option>${owned.map((x) => `<option value="${x.card_id}" ${x.slot === i ? 'selected' : ''}>${CARDS[x.card_id].name}</option>`).join('')}</select></div>`; }).join('')}</div>`, 'wide');
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
export { store };
