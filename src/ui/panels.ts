import { api } from '../api';
import { me, level, refreshMe, toast, on, store } from '../state';
import { goto, activeScene } from '../game';
import { detachDomain } from '../game/domainNet';
import { sfx, music, setSfx, setVolume, setTrack, TRACKS } from './audio';
import {
  DAILY_CAP, PLANTS, CARDS, plantById, plantSprite, plantStage, plantReward, growMs, previewReward, plotsUnlocked, STAGES, caseSlots, gardenTiles, MAX_LEVEL,
  GEM_PRICE_COINS, FREEZES_PER_MONTH, GROWTH_OPTIONS, spinBaseCoins, addDays, FENCE_COLORS,
  FURNITURE, furnitureById, SEASONS, SEASON_CHANGE_GEMS, effectiveSeason, type Season, type Task, type Plot, type FriendRow, type Reel, type ShopInfo, type FenceColor, type Furniture,
} from '../shared/rules';

/** Escape user-supplied text before it goes into innerHTML. */
export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const overlay = () => document.getElementById('overlay')!;
const fmtMin = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m} min`);
const fmtMs = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`; };
const stars = (d: number) => `<span class="stars">${'★'.repeat(d)}<span class="off">${'★'.repeat(3 - d)}</span></span>`;
const err = (e: unknown) => { toast((e as Error).message, 'err'); sfx.error(); };
const ico = (n: string, cls = '') => `<img class="ico ${cls}" src="/assets/ui/${n}.png" alt="" />`;
const num = (n: number | string) => `<span class="num">${n}</span>`;
const plantImg = (id: number, cls = '') => { const p = plantById(id)!; return `<img class="plant-art ${p.kind} ${cls}" src="/assets/plants/${plantSprite(p)}.png" alt="" />`; };
const furnImg = (id: number, cls = '') => `<img class="furn-art ${cls}" src="/assets/furniture/f_${id}.png" alt="" />`;

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
  const panel = back.querySelector<HTMLElement>('.panel')!;
  upgradeDateInputs(panel);
  upgradeSelects(panel);
  return panel;
}
/** Replace system select popups with menus that stay inside the game theme. */
function upgradeSelects(root: HTMLElement) {
  root.querySelectorAll<HTMLSelectElement>('select').forEach((select) => {
    select.dataset.retro = '1'; select.classList.add('native-select');
    const wrap = document.createElement('div'); wrap.className = 'retro-select';
    const trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'retro-select-trigger'; trigger.setAttribute('aria-haspopup', 'listbox');
    const menu = document.createElement('div'); menu.className = 'retro-select-menu'; menu.setAttribute('role', 'listbox'); menu.hidden = true;
    const sync = () => { const option = select.options[select.selectedIndex]; trigger.textContent = option?.textContent ?? 'Choose'; trigger.disabled = select.disabled; menu.querySelectorAll('button').forEach((b) => b.classList.toggle('on', (b as HTMLButtonElement).value === select.value)); };
    [...select.options].forEach((option) => {
      const item = document.createElement('button'); item.type = 'button'; item.value = option.value; item.textContent = option.textContent; item.disabled = option.disabled; item.setAttribute('role', 'option');
      item.addEventListener('click', () => { select.value = item.value; select.dispatchEvent(new Event('change', { bubbles: true })); menu.hidden = true; trigger.setAttribute('aria-expanded', 'false'); sync(); });
      menu.appendChild(item);
    });
    trigger.addEventListener('click', () => { root.querySelectorAll<HTMLElement>('.retro-select-menu').forEach((m) => { if (m !== menu) m.hidden = true; }); menu.hidden = !menu.hidden; trigger.setAttribute('aria-expanded', String(!menu.hidden)); });
    trigger.addEventListener('keydown', (e) => { if (e.key === 'Escape') { menu.hidden = true; trigger.setAttribute('aria-expanded', 'false'); } });
    select.addEventListener('change', sync);
    select.insertAdjacentElement('afterend', wrap); wrap.append(trigger, menu); sync();
  });
  root.addEventListener('click', (e) => { if (!(e.target as HTMLElement).closest('.retro-select')) root.querySelectorAll<HTMLElement>('.retro-select-menu').forEach((m) => m.hidden = true); });
}

/** Replace native date popups with a calendar that matches the game UI. */
function upgradeDateInputs(root: HTMLElement) {
  const MIN_YEAR = 2000, MAX_YEAR = 2100;
  const months = Array.from({ length: 12 }, (_, month) => new Date(2020, month, 1).toLocaleDateString(undefined, { month: 'long' }));
  const valueOf = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const parse = (value: string) => { const [year, month, day] = value.split('-').map(Number); return year && month && day ? new Date(year, month - 1, day) : null; };

  root.querySelectorAll<HTMLInputElement>('input[type="date"]').forEach((input) => {
    input.min = `${MIN_YEAR}-01-01`; input.max = `${MAX_YEAR}-12-31`; input.classList.add('native-date');
    const today = new Date(), selected = parse(input.value);
    let shown = selected ?? new Date(Math.min(MAX_YEAR, Math.max(MIN_YEAR, today.getFullYear())), today.getMonth(), 1);
    const wrap = document.createElement('div'); wrap.className = 'retro-date';
    wrap.innerHTML = `<button type="button" class="retro-date-trigger" aria-haspopup="dialog" aria-expanded="false"></button>
      <div class="retro-calendar" role="dialog" aria-label="Choose a date" hidden>
        <div class="retro-calendar-head"><button type="button" class="calendar-nav prev" aria-label="Previous month">◀</button><div class="calendar-jump"><select class="calendar-month" data-native="1" aria-label="Month">${months.map((month, i) => `<option value="${i}">${month}</option>`).join('')}</select><select class="calendar-year" data-native="1" aria-label="Year">${Array.from({ length: MAX_YEAR - MIN_YEAR + 1 }, (_, i) => `<option>${MIN_YEAR + i}</option>`).join('')}</select></div><button type="button" class="calendar-nav next" aria-label="Next month">▶</button></div>
        <div class="calendar-weekdays" aria-hidden="true"><span>Su</span><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span></div>
        <div class="calendar-days" role="grid"></div>
        <div class="calendar-actions"><button type="button" data-calendar-action="clear">Clear</button><button type="button" data-calendar-action="today">Today</button></div>
      </div>`;
    input.insertAdjacentElement('afterend', wrap);
    const trigger = wrap.querySelector<HTMLButtonElement>('.retro-date-trigger')!, calendar = wrap.querySelector<HTMLElement>('.retro-calendar')!;
    const monthSelect = wrap.querySelector<HTMLSelectElement>('.calendar-month')!, yearSelect = wrap.querySelector<HTMLSelectElement>('.calendar-year')!;
    const days = wrap.querySelector<HTMLElement>('.calendar-days')!, prev = wrap.querySelector<HTMLButtonElement>('.prev')!, next = wrap.querySelector<HTMLButtonElement>('.next')!;
    const syncTrigger = () => { const date = parse(input.value); trigger.textContent = date ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Choose a date'; };
    const selectDate = (value: string) => { input.value = value; input.dispatchEvent(new Event('change', { bubbles: true })); syncTrigger(); calendar.hidden = true; trigger.setAttribute('aria-expanded', 'false'); trigger.focus(); };
    const render = () => {
      const year = shown.getFullYear(), month = shown.getMonth();
      monthSelect.value = String(month); yearSelect.value = String(year);
      prev.disabled = year === MIN_YEAR && month === 0; next.disabled = year === MAX_YEAR && month === 11;
      const firstDay = new Date(year, month, 1).getDay();
      const start = new Date(year, month, 1 - firstDay);
      days.innerHTML = Array.from({ length: 42 }, (_, i) => {
        const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i), value = valueOf(date);
        const outside = date.getMonth() !== month, unavailable = date.getFullYear() < MIN_YEAR || date.getFullYear() > MAX_YEAR;
        const classes = [outside ? 'outside' : '', value === input.value ? 'selected' : '', value === valueOf(today) ? 'today' : ''].filter(Boolean).join(' ');
        return `<button type="button" role="gridcell" data-date="${value}" class="${classes}" aria-label="${date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}" aria-selected="${value === input.value}" ${unavailable ? 'disabled' : ''}>${date.getDate()}</button>`;
      }).join('');
    };
    const moveMonth = (change: number) => { shown = new Date(shown.getFullYear(), shown.getMonth() + change, 1); render(); };
    const open = () => { const date = parse(input.value); if (date) shown = new Date(date.getFullYear(), date.getMonth(), 1); render(); calendar.hidden = false; trigger.setAttribute('aria-expanded', 'true'); const focusDate = days.querySelector<HTMLButtonElement>('.selected:not(:disabled), .today:not(:disabled), button:not(.outside):not(:disabled)'); focusDate?.focus(); };

    trigger.addEventListener('click', () => calendar.hidden ? open() : (calendar.hidden = true, trigger.setAttribute('aria-expanded', 'false')));
    prev.addEventListener('click', () => moveMonth(-1)); next.addEventListener('click', () => moveMonth(1));
    monthSelect.addEventListener('change', () => { shown = new Date(Number(yearSelect.value), Number(monthSelect.value), 1); render(); });
    yearSelect.addEventListener('change', () => { shown = new Date(Number(yearSelect.value), Number(monthSelect.value), 1); render(); });
    days.addEventListener('click', (e) => { const button = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-date]'); if (button && !button.disabled) selectDate(button.dataset.date!); });
    days.addEventListener('keydown', (e) => {
      const button = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-date]'); if (!button) return;
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
      if (step === undefined) return; e.preventDefault();
      const date = parse(button.dataset.date!)!; date.setDate(date.getDate() + step);
      if (date.getFullYear() < MIN_YEAR || date.getFullYear() > MAX_YEAR) return;
      if (date.getMonth() !== shown.getMonth() || date.getFullYear() !== shown.getFullYear()) { shown = new Date(date.getFullYear(), date.getMonth(), 1); render(); }
      days.querySelector<HTMLButtonElement>(`[data-date="${valueOf(date)}"]`)?.focus();
    });
    wrap.querySelector<HTMLElement>('.calendar-actions')!.addEventListener('click', (e) => {
      const action = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-calendar-action]')?.dataset.calendarAction;
      if (action === 'clear') selectDate('');
      if (action === 'today' && today.getFullYear() >= MIN_YEAR && today.getFullYear() <= MAX_YEAR) selectDate(valueOf(today));
    });
    calendar.addEventListener('keydown', (e) => { if (e.key === 'Escape') { calendar.hidden = true; trigger.setAttribute('aria-expanded', 'false'); trigger.focus(); } });
    root.addEventListener('click', (e) => { if (!(e.target as HTMLElement).closest('.retro-date')) { calendar.hidden = true; trigger.setAttribute('aria-expanded', 'false'); } });
    syncTrigger();
  });
}
const name = (n: string) => { if (panelEl) panelEl.dataset.name = n; };
export function setHint(text: string | null) {
  let el = document.getElementById('hint');
  if (!text) { el?.remove(); return; }
  if (!el) { el = document.createElement('div'); el.id = 'hint'; overlay().appendChild(el); }
  if (el.textContent !== text) el.textContent = text;
}
/** Compact top-left badge while visiting a friend (home or garden). */
export function setVisitBadge(text: string | null) {
  let el = document.getElementById('visit-badge');
  if (!text) { el?.remove(); return; }
  if (!el) { el = document.createElement('div'); el.id = 'visit-badge'; overlay().appendChild(el); }
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
const dailyBar = () => { const d = me().daily; const pct = Math.min(100, Math.round((d.xp / DAILY_CAP.xp) * 100)); return `<div class="daily"><div class="row"><span>${ico('streak')} Daily progress ${pct < 100 ? (pct < 50 ? '- keep going!' : '- you are doing well!') : '- daily cap reached!'}</span><span>${num(d.xp)}/${num(DAILY_CAP.xp)} XP</span></div><div class="bar"><i style="width:${pct}%"></i></div></div>`; };

// ---------- navbar + HUD ----------
const NAV = [['pomodoro', 'P', 'Pomodoro'], ['tasks', 'T', 'Tasks'], ['map', 'M', 'Map'], ['inventory', 'I', 'Inventory'], ['shop', 'Q', 'Shop'], ['settings', 'Esc', 'Settings']] as const;
const openers: Record<string, () => void> = { pomodoro: () => pomodoroPanel(), tasks: () => tasksPanel(), map: mapPanel, inventory: () => inventoryPanel(), shop: () => shopPanel(), settings: settingsPanel };
let navMode: 'house' | 'garden' = 'house';
const GARDEN_NAV = new Set(['map', 'settings']);
/** In the garden only Map and Settings stay on the bar (and their hotkeys). */
export function setNavMode(mode: 'house' | 'garden') {
  navMode = mode;
  document.querySelectorAll<HTMLElement>('#navbar [data-open]').forEach((b) => { b.hidden = mode === 'garden' && !GARDEN_NAV.has(b.dataset.open!); });
}
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
    if (e.key === 'Escape') { if (panelEl?.dataset.name === 'confirm' || panelEl?.dataset.name === 'tutorial') return; if (panelEl) closePanel(); else if (!document.getElementById('palette') && !document.getElementById('fmenu')) settingsPanel(); return; }
    const k = { p: 'pomodoro', t: 'tasks', m: 'map', i: 'inventory', q: 'shop' }[e.key.toLowerCase()];
    if (k && !e.repeat) { if (navMode === 'garden' && !GARDEN_NAV.has(k)) return; if (panelEl?.dataset.name === k) closePanel(); else { sfx.click(); openers[k](); } }
  });
}
function renderHud() {
  const u = me().user, lv = level();
  const pct = lv.next ? Math.round((lv.into / lv.next) * 100) : 100;
  document.querySelector('#navbar .hud')!.innerHTML = `
    <div class="xp"><span>${ico('xp', 'sm')} Level ${num(lv.level)} · ${lv.next ? `${num(lv.into)}/${num(lv.next)} XP` : 'MAX'}</span><div class="bar"><i style="width:${pct}%"></i></div></div>
    <span class="pill" title="Day streak">${ico('streak')}${num(u.streak)}<small>day${u.streak === 1 ? '' : 's'}</small></span>`;
}

// ---------- task calendar ----------
type TaskView = 'today' | 'week' | 'all';
let taskFolder: string | null = null;
let taskView: TaskView = 'today';
const localDay = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const priorityName = (p: number) => ['Low', 'Normal', 'High'][p - 1] ?? 'Normal';

function folderPopup(onSave: (folder: string) => void) {
  const p = openPanel(`<h2>📁 New Folder</h2><p class="sub">Give this task group a short name.</p><form id="folder-form" class="form"><label>Folder name</label><input id="folder-name" type="text" maxlength="30" required placeholder="School" autofocus /><div class="form-actions"><button class="btn sage" type="submit">Create folder</button><button class="btn rose" type="button" id="folder-cancel">Cancel</button></div></form>`);
  name('folder');
  p.querySelector('#folder-cancel')!.addEventListener('click', () => tasksPanel());
  p.querySelector<HTMLFormElement>('#folder-form')!.addEventListener('submit', (e) => { e.preventDefault(); const f = p.querySelector<HTMLInputElement>('#folder-name')!.value.trim().slice(0, 30); if (f) onSave(f); });
  setTimeout(() => p.querySelector<HTMLInputElement>('#folder-name')!.focus(), 0);
}

export function tasksPanel(folder: string | null = taskFolder, view: TaskView = taskView) {
  taskFolder = folder; taskView = view;
  const all = me().tasks.filter((t) => !t.completed_at);
  const today = localDay();
  const weekEnd = addDays(today, 6);
  const folders = [...new Set([...me().folders, ...all.map((t) => t.folder).filter(Boolean)])].sort();
  const inView = all.filter((t) => view === 'all' || (view === 'today' ? !t.due_date || t.due_date <= today : !!t.due_date && t.due_date >= today && t.due_date <= weekEnd));
  const tasks = folder === null ? inView : inView.filter((t) => t.folder === folder);
  const row = (t: Task) => {
    const pts = previewReward(t.difficulty, t.est_minutes).xp;
    return `<article class="task priority-${t.priority}" data-id="${t.id}">
      <div><div class="name">${esc(t.name)}</div><div class="desc">${esc(t.description) || 'No details'}${t.folder ? ` <span class="tag">📁 ${esc(t.folder)}</span>` : ''}</div></div>
      <div class="meta">${stars(t.difficulty)}<span class="priority">${priorityName(t.priority)} priority</span><span><span class="pts">${ico('xp', 'sm')} +${num(pts)} XP${t.pomodoro ? ' ×2' : ''}</span> 📅 ${t.due_date ? esc(t.due_date) : 'Today'}</span><span>⏱ ${fmtMin(t.est_minutes)}</span></div>
      <div class="acts"><button class="btn sm complete" data-act="complete">Complete</button><button class="play" data-act="start" title="Start focus timer">▶</button><select class="mv" title="Move to folder"><option value="">No folder</option>${folders.map((f) => `<option ${t.folder === f ? 'selected' : ''} value="${esc(f)}">${esc(f)}</option>`).join('')}<option value="__new">+ New folder</option></select><button class="del" data-act="delete" title="Delete task">🗑</button></div></article>`;
  };
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const calendar = view === 'week' ? `<div class="week-grid">${days.map((d, i) => `<button data-day="${d}" class="${d === today ? 'today' : ''}"><b>${['Today', 'Tomorrow'][i] ?? new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short' })}</b><span>${new Date(d + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span><i>${all.filter((t) => t.due_date === d).length} task${all.filter((t) => t.due_date === d).length === 1 ? '' : 's'}</i></button>`).join('')}</div>` : '';
  const p = openPanel(`<div class="panel-head"><div><h2>📖 My Tasks</h2><p class="sub">Plan today and view the next seven days.</p></div><div class="panel-head-actions"><button class="btn sm" id="import-syllabus">Import from syllabus</button><button class="btn sm sage" id="new-task">+ New Task</button></div></div>${dailyBar()}
    <div class="tabs task-toolbar"><div class="task-views"><button data-v="today" class="${view === 'today' ? 'on' : ''}">To-do Today</button><button data-v="week" class="${view === 'week' ? 'on' : ''}">Week</button><button data-v="all" class="${view === 'all' ? 'on' : ''}">All</button></div><div class="folders"><button data-f="" class="${folder === null ? 'on' : ''}">All folders (${inView.length})</button>${folders.map((f) => `<button data-f="${esc(f)}" class="${folder === f ? 'on' : ''}">📁 ${esc(f)} (${inView.filter((t) => t.folder === f).length})</button>`).join('')}<button id="add-folder">+ New folder</button></div></div>${calendar}
    <div class="task-list">${tasks.length ? tasks.map(row).join('') : '<div class="empty-state"><b>No tasks here.</b><span>Create a task when you are ready.</span></div>'}</div>`, 'wide');
  name('tasks');
  p.querySelector('#new-task')!.addEventListener('click', () => createTaskPanel(folder ?? ''));
  p.querySelector('#import-syllabus')!.addEventListener('click', () => importSyllabusPanel(folder ?? ''));
  p.querySelectorAll<HTMLElement>('[data-v]').forEach((b) => b.addEventListener('click', () => tasksPanel(folder, b.dataset.v as TaskView)));
  p.querySelectorAll<HTMLElement>('.folders [data-f]').forEach((b) => b.addEventListener('click', () => tasksPanel(b.dataset.f || null, view)));
  p.querySelectorAll<HTMLElement>('[data-day]').forEach((b) => b.addEventListener('click', () => createTaskPanel(folder ?? '', b.dataset.day)));
  p.querySelector('#add-folder')!.addEventListener('click', () => folderPopup((f) => createTaskPanel(f)));
  p.querySelectorAll<HTMLSelectElement>('.mv').forEach((s) => s.addEventListener('change', async () => {
    const id = Number(s.closest<HTMLElement>('.task')!.dataset.id);
    if (s.value === '__new') return folderPopup(async (f) => { try { await api.post(`/api/tasks/${id}/folder`, { folder: f }); await refreshMe(); tasksPanel(f, view); } catch (e) { err(e); } });
    try { await api.post(`/api/tasks/${id}/folder`, { folder: s.value }); await refreshMe(); tasksPanel(folder, view); } catch (e) { err(e); }
  }));
  p.querySelectorAll<HTMLElement>('[data-act]').forEach((b) => b.addEventListener('click', async () => {
    const id = Number(b.closest<HTMLElement>('.task')!.dataset.id), t = all.find((x) => x.id === id)!;
    try {
      if (b.dataset.act === 'complete') { const yes = await confirmDialog('Complete task', `Did you complete ${t.name}?`, 'Completed!', 'Go back'); if (yes) { await completeTask(id); tasksPanel(folder, view); } else tasksPanel(folder, view); }
      else if (b.dataset.act === 'delete') { await api.del(`/api/tasks/${id}`); await refreshMe(); tasksPanel(folder, view); }
      else if (b.dataset.act === 'start') { await api.post(`/api/tasks/${id}/start`); await refreshMe(); pomodoroPanel(id); }
    } catch (e) { err(e); }
  }));
}
async function completeTask(id: number) {
  const r = await api.post<{ xp: number; coins: number; capped: boolean; leveledUp: boolean; level: number; streak: number }>(`/api/tasks/${id}/complete`);
  if (pomo?.taskId === id) { pomo = null; clearInterval(pomoTimer); }
  await refreshMe();
  sfx.coin();
  toast(`+${r.xp} XP · +${r.coins} coins${r.capped ? ' (daily cap reached)' : ''} · ${r.streak} day streak`, 'reward');
  if (r.leveledUp) { sfx.levelUp(); setTimeout(() => toast(`🎉 Level ${r.level}! Your garden grew.`, 'reward'), 600); }
  if (panelEl?.dataset.name === 'tasks') tasksPanel();
}
export function createTaskPanel(folder = '', dueDate = localDay()) {
  let difficulty = 1, priority = 2, est = 20, mode: '0-30' | '30-60' | '60-180' | '180+' = '0-30';
  const folders = [...new Set([...me().folders, ...me().tasks.map((t) => t.folder).filter(Boolean)])].sort();
  if (folder && !folders.includes(folder)) folders.push(folder);
  const p = openPanel(`<h2 style="text-align:center">🌱 Create a Task</h2><p class="sub" style="text-align:center">Plant a task today, grow a better tomorrow.</p>
    <form class="form" id="task-form">
      <label>🌱 Task Name</label><input type="text" name="name" maxlength="50" required placeholder="e.g. Finish database homework" /><div class="count"><span id="c1">0</span>/50</div>
      <label>📝 Description</label><textarea name="description" maxlength="200" rows="2" placeholder="Add more details about your task..."></textarea><div class="count"><span id="c2">0</span>/200</div>
      <label>📁 Folder</label><div style="display:flex;gap:8px"><select name="folder" style="flex:1;padding:8px;border:3px solid #d9c8a5;background:#fff9ea"><option value="">none</option>${folders.map((f) => `<option value="${esc(f)}" ${f === folder ? 'selected' : ''}>${esc(f)}</option>`).join('')}</select><input type="text" name="newfolder" maxlength="30" placeholder="or type a new folder" style="flex:1" /></div>
      <div class="form-split"><label>📅 Due date<input type="date" name="due_date" value="${esc(dueDate)}" /></label><label>🚩 Priority<select name="priority"><option value="1">Low</option><option value="2" selected>Normal</option><option value="3">High</option></select></label></div>
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
  const fDue = form.elements.namedItem('due_date') as HTMLInputElement, fPriority = form.elements.namedItem('priority') as HTMLSelectElement;
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
      priority = Number(fPriority.value);
      const t = await api.post<Task>('/api/tasks', { name: fName.value, description: fDesc.value, folder: fNew.value.trim() || fFolder.value, due_date: fDue.value || null, priority, difficulty, est_minutes: est, start });
      await refreshMe(); sfx.plant();
      if (start) pomodoroPanel(t.id); else tasksPanel(t.folder || null);
    } catch (ex) { err(ex); }
  });
  preview();
}

type DraftTask = { name: string; description: string; due_date: string | null; priority: number; difficulty: number; est_minutes: number };

/** Upload a syllabus PDF → extract text → Gemini drafts tasks for one class folder. */
export function importSyllabusPanel(folderHint = '') {
  const p = openPanel(`<h2>📄 Import from syllabus</h2>
    <p class="sub">Upload one class PDF. We pull the text, ask Gemini for a task list, then you pick what to add.</p>
    <form class="form" id="syllabus-form">
      <label>📁 Class name</label>
      <input type="text" id="syl-class" maxlength="30" required placeholder="e.g. CS 225" value="${esc(folderHint)}" />
      <label>📎 Syllabus PDF</label>
      <div class="file-pick">
        <input type="file" id="syl-file" class="native-file" accept="application/pdf,.pdf" required />
        <button type="button" class="btn sm" id="syl-browse">Choose PDF</button>
        <span class="file-pick-name" id="syl-name">No file chosen</span>
      </div>
      <p class="sub" id="syl-status"></p>
      <div class="form-actions"><button class="btn sage" type="submit" id="syl-go">Scan syllabus</button><button class="btn rose" type="button" id="syl-cancel">Cancel</button></div>
    </form>
    <div id="syl-preview" hidden></div>`);
  name('import-syllabus');
  const status = p.querySelector('#syl-status')!;
  const preview = p.querySelector<HTMLElement>('#syl-preview')!;
  const fileInput = p.querySelector<HTMLInputElement>('#syl-file')!;
  const fileName = p.querySelector('#syl-name')!;
  p.querySelector('#syl-browse')!.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    fileName.textContent = f ? f.name : 'No file chosen';
    fileName.classList.toggle('on', !!f);
  });
  p.querySelector('#syl-cancel')!.addEventListener('click', () => tasksPanel(folderHint || null));
  p.querySelector('#syllabus-form')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const className = (p.querySelector('#syl-class') as HTMLInputElement).value.trim().slice(0, 30);
    const file = fileInput.files?.[0];
    if (!className) return toast('Enter a class name', 'err');
    if (!file) return toast('Choose a PDF', 'err');
    if (file.size > 8_000_000) return toast('PDF must be under 8 MB', 'err');
    const go = p.querySelector<HTMLButtonElement>('#syl-go')!;
    go.disabled = true;
    preview.hidden = true;
    preview.innerHTML = '';
    try {
      status.textContent = 'Extracting text from PDF…';
      const { extractPdfText } = await import('../pdfText');
      const text = await extractPdfText(file);
      if (text.length < 40) throw new Error('Could not read text from that PDF. Try a text-based (not scanned) syllabus.');
      status.textContent = 'Asking Gemini for tasks…';
      const out = await api.post<{ class_name: string; tasks: DraftTask[] }>('/api/tasks/import-syllabus', { text, class_name: className });
      status.textContent = `Found ${out.tasks.length} task${out.tasks.length === 1 ? '' : 's'} for ${out.class_name}.`;
      renderSyllabusPreview(preview, out.class_name, out.tasks);
      preview.hidden = false;
    } catch (ex) { err(ex); status.textContent = ''; }
    finally { go.disabled = false; }
  });
}

function renderSyllabusPreview(box: Element, className: string, tasks: DraftTask[]) {
  const pri = ['Low', 'Normal', 'High'];
  box.innerHTML = `<h3 style="margin:18px 0 8px">Review tasks</h3>
    <p class="sub">They will be saved in folder <b>${esc(className)}</b>. Uncheck anything you do not want.</p>
    <div class="syllabus-drafts">${tasks.map((t, i) => `<label class="syllabus-draft">
      <input type="checkbox" data-i="${i}" checked />
      <div><b>${esc(t.name)}</b><small>${esc(t.description) || 'No details'} · 📅 ${t.due_date ? esc(t.due_date) : 'no date'} · ⏱ ${fmtMin(t.est_minutes)} · ${pri[t.priority - 1] ?? 'Normal'} · ${'⭐'.repeat(t.difficulty)}</small></div>
    </label>`).join('')}</div>
    <div class="form-actions"><button class="btn sage" type="button" id="syl-add">Add selected tasks</button><button class="btn" type="button" id="syl-back">Back to tasks</button></div>`;
  box.querySelector('#syl-back')!.addEventListener('click', () => tasksPanel(className));
  box.querySelector('#syl-add')!.addEventListener('click', async () => {
    const selected = [...box.querySelectorAll<HTMLInputElement>('input[data-i]:checked')].map((el) => tasks[Number(el.dataset.i)]).filter(Boolean);
    if (!selected.length) return toast('Select at least one task', 'err');
    try {
      const r = await api.post<{ count: number; folder: string }>('/api/tasks/bulk', { folder: className, tasks: selected });
      await refreshMe(); sfx.plant();
      toast(`Added ${r.count} task${r.count === 1 ? '' : 's'} to ${r.folder}`, 'reward');
      tasksPanel(r.folder);
    } catch (e) { err(e); }
  });
}

// ---------- pomodoro ----------
interface Pomo { phase: 'work' | 'break'; rep: number; reps: number; work: number; brk: number; endsAt: number; paused: number | null; taskId: number | null; done: boolean }
let pomo: Pomo | null = null;
let pomoTimer: number | undefined;
/** Latest work/break/reps chosen in the panel (used for the ready clock + planned dots). */
let pomoPlan = { work: 25, brk: 5, reps: 4 };
export function isPomodoroActive() { return !!pomo && !pomo.done; }
const mmss = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const remaining = () => (pomo ? (pomo.paused !== null ? pomo.paused : pomo.endsAt - Date.now()) : 0);
/** Split estimated work minutes into sessions so total work ≈ est (e.g. 90 min → 4 × 23 with 5-min breaks). */
function planFocus(estMinutes: number, preferredWork: number, preferredBreak: number) {
  const unit = Math.max(5, preferredWork);
  const reps = Math.max(1, Math.min(16, Math.ceil(estMinutes / unit)));
  const work = Math.max(5, Math.round(estMinutes / reps));
  return { work, brk: Math.max(1, preferredBreak), reps };
}
function dotsHtml(reps: number, curRep = 0, curPhase: 'work' | 'break' | null = null, allDone = false) {
  // work · break · work · … · work (no trailing break after the last session)
  const n = Math.max(1, reps * 2 - 1);
  return Array.from({ length: n }, (_, i) => {
    const rep = Math.floor(i / 2) + 1, ph: 'work' | 'break' = i % 2 ? 'break' : 'work';
    const cur = !allDone && curRep > 0 && rep === curRep && ph === curPhase;
    const done = allDone || (curRep > 0 && (rep < curRep || (rep === curRep && ph === 'work' && curPhase === 'break')));
    return `<span class="${cur ? 'on' : done ? 'done' : ''}"><i></i>${ph}</span>`;
  }).join('');
}
function pomoTick() {
  if (!pomo || pomo.paused !== null || pomo.done) return;
  if (remaining() > 0) return renderPomo();
  if (pomo.phase === 'work') {
    api.post('/api/pomodoro/complete', { task_id: pomo.taskId, minutes: pomo.work }).then(refreshMe).catch(() => {});
    sfx.chime();
    if (pomo.rep >= pomo.reps) { pomo.done = true; toast(pomo.taskId ? 'Focus sessions done! Complete the task from your task list for 2× XP.' : 'All sessions done. Nice work!', 'reward'); }
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
  let work = u.pomo_work, brk = u.pomo_break, reps = u.pomo_reps;
  if (task) ({ work, brk, reps } = planFocus(task.est_minutes, u.pomo_work, u.pomo_break));
  if (pomo && !pomo.done && (task ? pomo.taskId !== task.id : true)) { work = pomo.work; brk = pomo.brk; reps = pomo.reps; }
  pomoPlan = { work, brk, reps };
  const totalWork = work * reps;
  const p = openPanel(`<div class="pomo">
    <div class="clock"><h2>⏱ Focus Time</h2>${task ? `<p class="sub">${esc(task.name)} · ${num(totalWork)} min work across ${num(reps)} session${reps === 1 ? '' : 's'} · finishing a session marks 2× XP when you complete the task later</p>` : '<p class="sub">Every finished session is logged to your lifetime stats.</p>'}
      <div class="face"><div class="time num" id="pt">${mmss(work * 60_000)}</div></div><div class="phase" id="pp">ready</div>
      <div class="form-actions"><button class="btn" id="p-start">▶ Start</button><button class="btn rose" id="p-reset" type="button">■ Reset</button></div>
      <div class="dots" id="pd">${dotsHtml(reps)}</div><p class="sub" style="margin-top:10px">🔒 Garden access is disabled during an active focus session.</p></div>
    <div><h2>Settings</h2>
      <div class="stepper"><span>Work Duration</span><div><button data-k="work" data-d="-5">−</button><b class="num" id="s-work">${work} min</b><button data-k="work" data-d="5">+</button></div></div>
      <div class="stepper"><span>Break Duration</span><div><button data-k="brk" data-d="-1">−</button><b class="num" id="s-brk">${brk} min</b><button data-k="brk" data-d="1">+</button></div></div>
      <div class="stepper"><span>Repetitions</span><div><button data-k="reps" data-d="-1">−</button><b class="num" id="s-reps">${reps}</b><button data-k="reps" data-d="1">+</button></div></div>
      <p class="sub">Settings apply when you press Start.${task ? ` Planned for about ${num(task.est_minutes)} min of pure work.` : ' Saved as your defaults.'}</p>
      <p class="sub">Lifetime: ${num(me().stats.pomodoros ?? 0)} sessions · ${num(me().stats.focus_minutes ?? 0)} focus minutes</p></div></div>`, 'wide');
  name('pomodoro');
  const vals = { work, brk, reps };
  const syncPlan = () => { pomoPlan = { ...vals }; if (!pomo || pomo.done) { p.querySelector('#pt')!.textContent = mmss(vals.work * 60_000); p.querySelector('#pd')!.innerHTML = dotsHtml(vals.reps); } };
  p.querySelectorAll<HTMLElement>('.stepper button').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.k as keyof typeof vals, lim = { work: [5, 120], brk: [1, 60], reps: [1, 16] }[k];
    vals[k] = Math.min(lim[1], Math.max(lim[0], vals[k] + Number(b.dataset.d)));
    p.querySelector(`#s-${k}`)!.textContent = k === 'reps' ? String(vals[k]) : `${vals[k]} min`;
    syncPlan();
  }));
  p.querySelector('#p-start')!.addEventListener('click', async () => {
    sfx.click();
    if (pomo && !pomo.done) { pomo.paused === null ? (pomo.paused = remaining()) : ((pomo.endsAt = Date.now() + pomo.paused), (pomo.paused = null)); return renderPomo(); }
    startPomo(vals.work, vals.brk, vals.reps, task?.id ?? null);
    if (!task) api.post('/api/me/settings', { pomo_work: vals.work, pomo_break: vals.brk, pomo_reps: vals.reps }).then(refreshMe).catch(() => {});
    renderPomo();
  });
  p.querySelector('#p-reset')!.addEventListener('click', () => {
    sfx.click();
    pomo = null; clearInterval(pomoTimer);
    p.querySelector('#pt')!.textContent = mmss(vals.work * 60_000);
    p.querySelector('#pp')!.textContent = 'ready';
    p.querySelector('#pd')!.innerHTML = dotsHtml(vals.reps);
    (p.querySelector('#p-start') as HTMLButtonElement).textContent = '▶ Start';
    renderMini();
  });
  renderPomo();
}
function renderPomo() {
  const p = panelEl?.dataset.name === 'pomodoro' ? panelEl : null;
  if (p) {
    const pt = p.querySelector('#pt')!, pp = p.querySelector('#pp')!, btn = p.querySelector<HTMLButtonElement>('#p-start')!, dots = p.querySelector('#pd')!;
    if (pomo) {
      pt.textContent = mmss(remaining());
      pp.textContent = pomo.done ? 'done ✓' : `${pomo.phase === 'work' ? 'work' : 'break'} · session ${pomo.rep} of ${pomo.reps}${pomo.paused !== null ? ' · paused' : ''}`;
      btn.textContent = pomo.done ? '▶ Start again' : pomo.paused !== null ? '▶ Resume' : '⏸ Pause';
      dots.innerHTML = dotsHtml(pomo.reps, pomo.rep, pomo.phase, pomo.done);
    } else {
      pp.textContent = 'ready'; btn.textContent = '▶ Start';
      pt.textContent = mmss(pomoPlan.work * 60_000);
      dots.innerHTML = dotsHtml(pomoPlan.reps);
    }
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
  const p = openPanel(`<div class="map-img"><img src="/assets/ui/map.png" alt="Map" />
      <button class="hotspot home" style="left:50%;top:24%" data-to="house" aria-label="Home"></button>
      <button class="hotspot garden" style="left:17%;top:44%" data-to="garden" aria-label="My Garden"></button>
      <button class="hotspot friends" style="left:85%;top:45%" data-to="friends" aria-label="Friends' Gardens"></button>
      <div class="hotspot locked" style="left:50%;top:62%" title="Coming soon"><span>${ico('lock', 'sm')} locked</span></div>
    </div>`, 'xwide map-panel');
  name('map');
  p.querySelectorAll<HTMLElement>('[data-to]').forEach((b) => b.addEventListener('click', () => {
    sfx.click(); closePanel();
    if (b.dataset.to === 'house') goto('House', { spawn: 'center', ownerId: me().user.id });
    else if (b.dataset.to === 'garden') goto('Garden', { ownerId: me().user.id, spawn: 'gate' });
    else friendsPanel();
  }));
}

// ---------- inventory ----------
export function inventoryPanel(tab: 'seeds' | 'cards' | 'furniture' | 'seasons' = 'seeds') {
  const m = me();
  const seeds = m.inventory.filter((i) => i.qty > 0 && plantById(i.plant_id));
  const atHome = (() => { const sc = activeScene() as { scene: { key: string }; ownerId?: number } | undefined; return sc?.scene.key === 'House' && sc.ownerId === me().user.id; })();
  const body = tab === 'seeds'
    ? `<div class="slots big">${seeds.map((s) => { const pl = plantById(s.plant_id)!; return `<div class="slot seed" title="${pl.name} seeds">${plantImg(pl.id, 'seed-art')}<span class="nm">${pl.name}</span><span class="qty num">×${s.qty}</span></div>`; }).join('')}${Array.from({ length: Math.max(0, 8 - seeds.length) }, () => `<div class="slot empty"><span class="nm">empty</span></div>`).join('')}</div><p class="sub" style="margin-top:10px">Walk onto a plot in your garden and press E to plant a seed. Buy more in the shop (Q).</p>`
    : tab === 'cards'
      ? `<div class="card-row">${m.cards.map((c) => cardHtml(CARDS[c.card_id], false, c.slot !== null ? `Case slot ${c.slot + 1}` : 'In storage')).join('') || '<div class="empty-state"><b>No cards yet.</b><span>A card shows up in the shop now and then.</span></div>'}</div><p class="sub" style="margin-top:10px">Put cards in the case by the bookcase in your home.</p>`
      : tab === 'furniture'
        ? `<div class="furniture-inventory">${m.furniture.map((o) => { const f = furnitureById(o.furniture_id); if (!f) return ''; const placed = m.placed.filter((p) => p.furniture_id === f.id).length, free = o.qty - placed; return `<article class="furniture-item" data-furniture="${f.id}">${furnImg(f.id)}<div><b>${f.name}</b><small>Owned ×${o.qty} · ${placed} in the room · ${free} in storage · ${f.w}×${f.h} tiles</small></div>${free > 0 ? `<button class="btn sm sage" data-place="${f.id}" ${atHome ? '' : 'disabled title="Go home to place furniture"'}>Place</button>` : '<span class="owned-label">All placed</span>'}</article>`; }).join('') || '<div class="empty-state"><b>No furniture yet.</b><span>Buy furniture in the shop to decorate your home.</span></div>'}</div><p class="sub" style="margin-top:10px">${atHome ? 'Click Place, then click a floor tile. Use Edit room to move pieces or put them back.' : 'Go home to place furniture.'}</p>`
        : (() => { const available = SEASONS.filter((s) => s.value === 'auto' || m.seasons.includes(s.value)); const active = effectiveSeason(m.user.season, new Date().getMonth()); return `<div class="section-copy"><h3>Garden season</h3><p>Choose an owned season. Auto follows the real US season.</p></div><div class="season-grid">${available.map((s) => `<button data-inventory-season="${s.value}" class="season-card ${m.user.season === s.value ? 'on' : ''}"><span class="season-art ${s.value}">${{ auto: '🗓️', summer: '☀️', rainy: '🌧️', fall: '🍂', winter: '❄️' }[s.value]}</span><b>${s.label}</b><small>${s.note}</small><em>${m.user.season === s.value ? 'Selected' : 'Use season'}</em></button>`).join('')}</div><p class="season-now">Your garden now shows <b>${active}</b>.</p>`; })();
  const p = openPanel(`<div class="panel-head"><div><h2>🎒 Inventory</h2><p class="sub">Seeds, cards, furniture and seasons.</p></div></div>${dailyBar()}
    <div class="tabs"><button data-t="seeds" class="${tab === 'seeds' ? 'on' : ''}">🌱 Seeds (${seeds.reduce((s, x) => s + x.qty, 0)})</button><button data-t="cards" class="${tab === 'cards' ? 'on' : ''}">🃏 Cards (${m.cards.length})</button><button data-t="furniture" class="${tab === 'furniture' ? 'on' : ''}">🪑 Furniture (${m.furniture.reduce((s, x) => s + x.qty, 0)})</button><button data-t="seasons" class="${tab === 'seasons' ? 'on' : ''}">🍂 Seasons (${m.seasons.length + 1})</button></div>${body}`, 'wide');
  name('inventory');
  p.querySelectorAll<HTMLElement>('.tabs button').forEach((b) => b.addEventListener('click', () => inventoryPanel(b.dataset.t as 'seeds' | 'cards' | 'furniture' | 'seasons')));
  p.querySelectorAll<HTMLElement>('[data-place]').forEach((b) => b.addEventListener('click', () => { const id = Number(b.dataset.place); closePanel(); sfx.click(); activeScene()?.startPlacing?.(id); }));
  p.querySelectorAll<HTMLElement>('[data-inventory-season]').forEach((b) => b.addEventListener('click', async () => {
    try { await api.post('/api/me/season', { season: b.dataset.inventorySeason }); await refreshMe(); sfx.chime(); toast('Garden season changed', 'reward'); inventoryPanel('seasons'); } catch (e) { err(e); }
  }));
}
export function cardHtml(c: { id: number; name: string; rarity: string }, locked: boolean, foot = '') {
  return `<div class="tcard ${locked ? 'locked' : ''}"><div class="head rar ${c.rarity}">${locked ? '?' : c.rarity}</div><div class="art">${locked ? ico('lock') : `<img src="/assets/cards/card_${c.id}.png" alt="" />`}</div><div class="nm">${locked ? '???' : c.name}${foot ? `<br/><small>${foot}</small>` : ''}</div></div>`;
}

// ---------- shop ----------
type ShopTab = 'shop' | 'plants' | 'cards';
const untilMidnight = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() - d.getTime(); };
const hhmm = (ms: number) => `${Math.floor(ms / 3600_000)}:${String(Math.floor((ms % 3600_000) / 60_000)).padStart(2, '0')}`;
export async function shopPanel(tab: ShopTab = 'shop') {
  let info: ShopInfo;
  try { info = await api.get<ShopInfo>('/api/shop'); } catch (e) { return err(e); }
  info.plants = info.plants.filter((id) => plantById(id));
  info.collected = info.collected.filter((id) => plantById(id));
  const m = me(), u = m.user, owned = new Set(info.ownedCards), collected = new Set(info.collected);
  const qty = (id: number) => m.inventory.find((i) => i.plant_id === id)?.qty ?? 0;
  const fqty = (id: number) => m.furniture.find((f) => f.furniture_id === id)?.qty ?? 0;
  const reset = hhmm(untilMidnight());
  const head = `<header class="shop-head"><div><h2>Welcome to the shop!</h2><p>Use your coins to get plants and furniture. Gems collect rare cards for your home.</p></div>
    <div class="shop-currency"><span data-currency="coin">${ico('coin')}<b class="num">${u.is_admin ? '∞' : u.coins.toLocaleString()}</b><small>coins</small></span><span data-currency="gem">${ico('gem')}<b class="num">${u.is_admin ? '∞' : u.gems.toLocaleString()}</b><small>gems</small></span><button class="btn sm" id="buygem" title="Buy 1 gem">+1 ${ico('gem', 'sm')} for ${num(GEM_PRICE_COINS)}</button></div></header>`;
  let body = '';
  if (tab === 'shop') {
    const plantCard = (id: number) => { const pl = plantById(id)!, n = qty(id); return `<article class="shop-item plant"><b>${pl.name}</b>${plantImg(pl.id, 'seed-art')}${n ? `<span class="owned-badge">Owned ×${n}</span>` : ''}<button class="btn sm sage" data-buy="${pl.id}">${ico('coin', 'sm')} ${num(u.is_admin ? 'FREE' : pl.price)}</button></article>`; };
    const furnCard = (id: number) => { const f = furnitureById(id)!, n = fqty(id); return `<article class="shop-item furn"><b>${f.name}</b><span class="rar common">${f.w}×${f.h} tiles</span><div class="furn-box">${furnImg(f.id)}</div>${n ? `<span class="owned-badge">Owned ×${n}</span>` : ''}<button class="btn sm sage" data-furniture-buy="${f.id}">${ico('coin', 'sm')} ${num(u.is_admin ? 'FREE' : f.price)}</button></article>`; };
    const card = info.card !== null ? CARDS[info.card] : null;
    body = `<div class="shop-main">
      <div class="shop-col">
        <section><div class="sec-head"><h3>🌱 Plants</h3><span class="reset">Reset: <b class="num">${reset}</b></span><button class="link" data-t="plants">View All →</button></div><div class="shop-grid">${info.plants.map(plantCard).join('')}</div></section>
        <section><div class="sec-head"><h3>🃏 Cards</h3><span class="reset">Reset: <b class="num">${reset}</b></span><button class="link" data-t="cards">View Collection →</button></div>
          ${card ? `<div class="card-offer">${cardHtml(card, false)}<div><b>${card.name}</b><p>A rare visitor. Cards are the most precious thing in the shop - one at most, and not every day.</p>${owned.has(card.id) ? '<span class="sold">Sold</span>' : `<button class="btn rose" data-card="${card.id}">${ico('gem', 'sm')} ${num(u.is_admin ? 'FREE' : card.price)} gems</button>`}</div></div>` : '<div class="empty-state small"><b>No card in stock today.</b><span>Cards are rare - check back tomorrow.</span></div>'}</section>
        <section><div class="sec-head"><h3>🪑 Furniture</h3><span class="reset">Reset: <b class="num">${reset}</b></span></div><div class="shop-grid">${info.furniture.map(furnCard).join('')}</div></section>
        <section><div class="sec-head"><h3>🍂 Seasons</h3><span class="reset">${num(SEASON_CHANGE_GEMS)} gem each · pick them in your inventory</span></div><div class="season-grid four">${SEASONS.filter((s) => s.value !== 'auto').map((s) => { const has = m.seasons.includes(s.value); return `<article class="season-card ${has ? 'on' : ''}"><span class="season-art ${s.value}">${{ summer: '☀️', rainy: '🌧️', fall: '🍂', winter: '❄️' }[s.value as 'summer']}</span><b>${s.label}</b><small>${s.note}</small>${has ? '<em>Owned</em>' : `<button class="btn sm sage" data-season-buy="${s.value}">${ico('gem', 'sm')} ${num(u.is_admin ? 'FREE' : SEASON_CHANGE_GEMS)}</button>`}</article>`; }).join('')}</div></section>
      </div>
      <aside class="spin-box"><h3>🎰 Daily Spin</h3><p>Spin once a day for coins and rare gems. Every spin pays at least <b>${num(spinBaseCoins(u.streak))} coins</b>.</p>
        <div class="machine v3"><img class="mach" src="/assets/ui/spin_machine.png" alt="" /><div class="reels"><div class="reel">${ico('coin', 'lg')}</div><div class="reel">🌱</div><div class="reel">${ico('gem', 'lg')}</div></div>
          <button class="spin-btn" id="spin" ${info.daily.spun && !u.is_admin ? 'disabled' : ''}>${info.daily.spun && !u.is_admin ? 'Come back tomorrow' : 'Spin'}</button><button class="lever3" id="lever" aria-label="Pull the lever" ${info.daily.spun && !u.is_admin ? 'disabled' : ''}></button></div>
        <p class="sub">${u.is_admin ? 'Admin: spin as often as you want.' : '1 spin per day'}</p></aside></div>`;
  } else if (tab === 'plants') {
    body = `<section class="collection"><div class="sec-head"><button class="btn sm" data-t="shop">← Back to Shop</button><h3>🌿 Plant Collection</h3><span class="reset">${num(collected.size)} / ${num(PLANTS.length)} collected</span></div><div class="shop-grid five">${PLANTS.map((pl) => `<div class="shop-item ${collected.has(pl.id) ? '' : 'locked'}">${plantImg(pl.id, collected.has(pl.id) ? '' : 'sil')}<b>${collected.has(pl.id) ? pl.name : '???'}</b><span class="price">${collected.has(pl.id) ? `Owned ×${qty(pl.id)}` : 'Not collected'}</span></div>`).join('')}</div></section>`;
  } else {
    body = `<section class="collection"><div class="sec-head"><button class="btn sm" data-t="shop">← Back to Shop</button><h3>🃏 Card Collection</h3><span class="reset">${num(owned.size)} / ${num(CARDS.length)} collected</span></div><div class="shop-card-grid">${CARDS.map((c) => `<article class="shop-card-item">${cardHtml(c, !owned.has(c.id))}${owned.has(c.id) ? '<span class="owned-label">Owned</span>' : `<span class="price">${ico('gem', 'sm')} ${num(c.price)} when in stock</span>`}</article>`).join('')}</div></section>`;
  }
  const p = openPanel(`<div class="shop-shell">${head}${body}</div>`, 'xwide shop-panel');
  name('shop');
  p.querySelectorAll<HTMLElement>('[data-t]').forEach((b) => b.addEventListener('click', () => shopPanel(b.dataset.t as ShopTab)));
  const act = async (fn: () => Promise<unknown>, after: () => void) => { try { await fn(); await refreshMe(); after(); } catch (e) { err(e); } };
  p.querySelectorAll<HTMLElement>('[data-buy]').forEach((b) => b.addEventListener('click', () => act(() => api.post('/api/shop/seed', { plant_id: Number(b.dataset.buy) }), () => { sfx.coin(); toast(`Bought a ${plantById(Number(b.dataset.buy))!.name} seed`); shopPanel(); })));
  p.querySelectorAll<HTMLElement>('[data-card]').forEach((b) => b.addEventListener('click', () => act(() => api.post('/api/shop/card', { card_id: Number(b.dataset.card) }), () => { sfx.chime(); toast(`${CARDS[Number(b.dataset.card)].name} added to your collection!`, 'reward'); shopPanel(); })));
  p.querySelectorAll<HTMLElement>('[data-furniture-buy]').forEach((b) => b.addEventListener('click', () => act(() => api.post('/api/shop/furniture', { furniture_id: Number(b.dataset.furnitureBuy) }), () => { sfx.coin(); toast(`${furnitureById(Number(b.dataset.furnitureBuy))!.name} added to your inventory`, 'reward'); shopPanel(); })));
  p.querySelector('#buygem')?.addEventListener('click', () => act(() => api.post('/api/shop/gems', { qty: 1 }), () => { sfx.coin(); shopPanel(tab); }));
  p.querySelectorAll<HTMLElement>('[data-season-buy]').forEach((b) => b.addEventListener('click', () => act(() => api.post('/api/shop/season', { season: b.dataset.seasonBuy }), () => { sfx.chime(); toast('Season added to your inventory', 'reward'); shopPanel(); })));
  const spin = async () => {
    const btn = p.querySelector<HTMLButtonElement>('#spin')!, lever = p.querySelector<HTMLButtonElement>('#lever')!, reels = [...p.querySelectorAll<HTMLElement>('.reel')];
    if (btn.disabled) return;
    const icon: Record<Reel, string> = { coin: ico('coin', 'lg'), sprout: '🌱', gem: ico('gem', 'lg') };
    btn.disabled = true; lever.disabled = true; lever.classList.add('pulled'); sfx.click();
    try {
      const r = await api.post<{ reels: Reel[]; coins: number; gems: number }>('/api/shop/spin');
      reels.forEach((el) => el.classList.add('spinning'));
      const spinner = setInterval(() => { reels.forEach((el) => { if (el.classList.contains('spinning')) el.innerHTML = [icon.coin, '🌱', icon.gem][Math.floor(Math.random() * 3)]; }); sfx.spin(); }, 90);
      r.reels.forEach((sym, i) => setTimeout(() => { reels[i].classList.remove('spinning'); reels[i].innerHTML = icon[sym]; }, 900 + i * 500));
      setTimeout(async () => { clearInterval(spinner); sfx.coin(); toast(`+${r.coins} coins${r.gems ? ` · +${r.gems} gems!` : ''}`, 'reward'); await refreshMe(); if (panelEl?.dataset.name === 'shop') shopPanel(); }, 2200);
    } catch (e) { err(e); btn.disabled = false; lever.disabled = false; lever.classList.remove('pulled'); }
  };
  p.querySelector('#spin')?.addEventListener('click', spin);
  p.querySelector('#lever')?.addEventListener('click', spin);
}

// ---------- settings ----------
export function settingsPanel() {
  const m = me(), u = m.user, s = m.stats, lv = level().level;
  const visiting = (() => { const sc = activeScene() as { ownerId?: number } | undefined; return sc?.ownerId != null && sc.ownerId !== u.id; })();
  const tog = (k: string, val: number, label: string, hint = '') => `<div class="setting"><span>${label}${hint ? `<br/><small>${hint}</small>` : ''}</span><div class="toggle ${val ? 'on' : ''}" data-k="${k}"><i></i></div></div>`;
  const stat = (k: string, label: string) => `<div><b class="num">${s[k] ?? 0}</b>${label}</div>`;
  const freezeHint = visiting
    ? 'Freeze only works on your own garden. Go home to freeze or unfreeze your farm.'
    : `Away for a while? Plants will not wither and your streak is safe. Your farm is closed while frozen. ${num(m.freezesLeft)} of ${FREEZES_PER_MONTH} freezes left this month.`;
  const p = openPanel(`<h2>⚙ Settings</h2><p class="sub">${esc(u.username)} · friend code <b>${u.friend_code}</b>${u.is_admin ? ' · admin test account' : ''}</p>
    ${u.is_admin ? `<div class="setting"><span>🧪 Admin level <b class="num" id="lvl-v">${lv}</b><br/><small>0-100. The garden is ${gardenTiles(lv)}×${gardenTiles(lv)} tiles at this level and grows one tile every 5 levels.</small></span><input type="range" id="lvl" min="0" max="${MAX_LEVEL}" value="${lv}" /></div>` : ''}
    ${tog('music', u.music, '🎵 Music')}
    <div class="setting sub-setting"><span>Track</span><div class="choice small" id="tracks">${TRACKS.map((t, i) => `<button data-track="${i}" class="${u.music_track === i ? 'on' : ''}">${t}</button>`).join('')}</div></div>
    <div class="setting sub-setting"><span>Volume <b class="num" id="vol-v">${u.music_volume}</b></span><input type="range" id="vol" min="0" max="100" value="${u.music_volume}" /></div>
    ${tog('sfx', u.sfx, '🔊 Sound effects', 'steps, planting, coins')}
    <div class="setting"><span>❄ Freeze garden<br/><small>${freezeHint}</small></span><div class="toggle ${u.frozen ? 'on' : ''} ${visiting ? 'disabled' : ''}" id="freeze" ${visiting ? 'title="Only your own garden can be frozen"' : ''}><i></i></div></div>
    <div class="setting"><span>🌱 Growth pace<br/><small>How long plants take from seed to fully grown. Patient gardeners earn more when a plant matures.</small></span><div class="choice small" id="growth">${GROWTH_OPTIONS.map((g) => `<button data-g="${g.value}" class="${u.growth === g.value ? 'on' : ''}" title="${g.desc}">${g.label}</button>`).join('')}</div></div>
    <p class="sub" style="padding-left:28px">${GROWTH_OPTIONS.find((g) => g.value === u.growth)?.desc ?? ''}</p>
    <div class="setting"><span>🎓 Tutorial</span><button class="btn sm" id="tut">Replay walkthrough</button></div>
    <h3 style="margin:16px 0 4px">📊 Lifetime stats</h3><div class="stats-grid">${stat('tasks_completed', 'tasks completed')}${stat('xp_earned', 'XP earned')}${stat('coins_earned', 'coins earned')}${stat('minutes_worked', 'minutes on tasks')}${stat('pomodoros', 'focus sessions')}${stat('focus_minutes', 'focus minutes')}${stat('best_streak', 'best streak')}${stat('plants_planted', 'plants planted')}${stat('plants_grown', 'plants matured')}${stat('plots_bought', 'plots hoed')}${stat('spins', 'daily spins')}${stat('cards_collected', 'cards collected')}</div>
    <div class="form-actions" style="margin-top:18px"><button class="btn rose" id="signout">Sign out</button></div>`);
  name('settings');
  const save = async (body: Record<string, unknown>) => { try { await api.post('/api/me/settings', body); await refreshMe(); } catch (e) { err(e); } };
  p.querySelectorAll<HTMLElement>('.toggle[data-k]').forEach((t) => t.addEventListener('click', async () => {
    const k = t.dataset.k!, val = t.classList.contains('on') ? 0 : 1;
    t.classList.toggle('on', !!val); sfx.click();
    await save({ [k]: val });
    if (k === 'music') music(!!val); if (k === 'sfx') setSfx(!!val);
  }));
  const lvl = p.querySelector<HTMLInputElement>('#lvl');
  lvl?.addEventListener('input', () => { p.querySelector('#lvl-v')!.textContent = lvl.value; });
  lvl?.addEventListener('change', async () => { try { await api.post('/api/me/admin-level', { level: Number(lvl.value) }); await refreshMe(); toast(`Level ${lvl.value} · garden ${gardenTiles(Number(lvl.value))}×${gardenTiles(Number(lvl.value))}`, 'reward'); settingsPanel(); } catch (e) { err(e); } });
  p.querySelectorAll<HTMLElement>('#tracks button').forEach((b) => b.addEventListener('click', async () => { p.querySelectorAll('#tracks button').forEach((x) => x.classList.remove('on')); b.classList.add('on'); setTrack(Number(b.dataset.track)); await save({ music_track: Number(b.dataset.track) }); }));
  const vol = p.querySelector<HTMLInputElement>('#vol')!;
  vol.addEventListener('input', () => { setVolume(Number(vol.value)); p.querySelector('#vol-v')!.textContent = vol.value; });
  vol.addEventListener('change', () => save({ music_volume: Number(vol.value) }));
  p.querySelectorAll<HTMLElement>('#growth button').forEach((b) => b.addEventListener('click', async () => { p.querySelectorAll('#growth button').forEach((x) => x.classList.remove('on')); b.classList.add('on'); await save({ growth: Number(b.dataset.g) }); toast(`Growth pace: ${b.textContent}`); settingsPanel(); }));
  p.querySelector('#freeze')!.addEventListener('click', async () => {
    if (visiting) { toast('You can only freeze your own garden', 'err'); return; }
    const on = !u.frozen;
    if (on && !(await confirmDialog('Freeze your garden?', `Your farm closes until you unfreeze it. Plants will not wither and your streak is safe. This uses 1 of your ${m.freezesLeft} remaining freezes this month.`, 'Freeze', 'Not now'))) return settingsPanel();
    try {
      await api.post('/api/me/freeze', { on }); await refreshMe(); toast(on ? 'Garden frozen ❄' : 'Garden unfrozen');
      const sc = activeScene() as any;
      if (on && sc?.scene.key === 'Garden' && sc.ownerId === me().user.id) { closePanel(); toast('Your farm is closed - back to the house'); goto('House', { spawn: 'center' }); return; }
    } catch (e) { err(e); }
    settingsPanel();
  });
  p.querySelector('#tut')!.addEventListener('click', () => tutorial());
  p.querySelector('#signout')!.addEventListener('click', async () => { await api.post('/api/auth/logout'); location.reload(); });
}

// ---------- friends (live: hub socket + slow poll fallback while open) ----------
let friendsPoll: number | undefined, friendsLast = '';
function stopFriendsPoll() { clearInterval(friendsPoll); friendsPoll = undefined; }
export function refreshFriendsIfOpen() { if (panelEl?.dataset.name === 'friends') { friendsLast = ''; friendsPanel(true); } }
export async function friendsPanel(silent = false) {
  let data: { friends: FriendRow[]; code: string };
  try { data = await api.get('/api/friends'); } catch (e) { return err(e); }
  const json = JSON.stringify(data);
  if (silent && json === friendsLast) return;
  friendsLast = json;
  const row = (f: FriendRow) => `<div class="friend" data-id="${f.id}"><img src="/assets/chars/portrait_${f.character ?? 0}.png" alt="" /><span class="dot ${f.online ? 'on' : ''}"></span>
    <div class="grow"><b>${esc(f.username)}</b><br/><small>${f.status === 'accepted' ? (f.online ? 'in a garden now' : 'offline') : f.status === 'incoming' ? 'wants to be your friend' : 'request sent'}</small></div>
    ${f.status === 'accepted' ? `<button class="btn sm sage" data-visit="${f.id}" data-name="${esc(f.username)}">Visit</button>` : f.status === 'incoming' ? `<button class="btn sm sage" data-accept="${f.id}">Accept</button>` : ''}<button class="btn sm rose" data-remove="${f.id}" title="${f.status === 'incoming' ? 'Decline' : 'Remove'}">✕</button></div>`;
  const typed = (panelEl?.dataset.name === 'friends' && (panelEl.querySelector('#fcode') as HTMLInputElement | null)?.value) || '';
  const p = openPanel(`<h2>👥 Friends</h2><p class="sub">Share your code so friends can add you. Requests and accepts arrive instantly.</p>
    <div class="code-box"><span>Your code</span><button type="button" class="code" id="copy-fcode" aria-label="Copy friend code ${esc(data.code)}" title="Copy friend code">${esc(data.code)}</button><input id="fcode" maxlength="6" placeholder="FRIEND CODE" value="${esc(typed)}" /><button class="btn sm" id="fadd">Add</button></div>
    ${data.friends.map(row).join('') || '<p class="sub">No friends yet. Send someone your code!</p>'}`);
  name('friends');
  if (!friendsPoll) friendsPoll = window.setInterval(() => friendsPanel(true), 15000);
  p.querySelector<HTMLButtonElement>('#copy-fcode')!.addEventListener('click', async (e) => {
    const button = e.currentTarget as HTMLButtonElement, code = data.code;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(code);
      else {
        const copy = document.createElement('textarea'); copy.value = code; copy.className = 'clipboard-copy'; document.body.appendChild(copy); copy.select();
        const copied = document.execCommand('copy'); copy.remove();
        if (!copied) throw new Error('Copy failed');
      }
      button.textContent = 'Copied!'; button.classList.add('copied'); sfx.click();
      setTimeout(() => { if (button.isConnected) { button.textContent = code; button.classList.remove('copied'); } }, 1200);
    } catch { toast('Could not copy the code.', 'err'); }
  });
  p.querySelector('#fadd')!.addEventListener('click', async () => { try { await api.post('/api/friends/request', { code: (p.querySelector('#fcode') as HTMLInputElement).value }); toast('Request sent!'); friendsLast = ''; friendsPanel(); } catch (e) { err(e); } });
  p.querySelectorAll<HTMLElement>('[data-accept]').forEach((b) => b.addEventListener('click', async () => { try { await api.post('/api/friends/accept', { user_id: Number(b.dataset.accept) }); sfx.chime(); friendsLast = ''; friendsPanel(); } catch (e) { err(e); } }));
  p.querySelectorAll<HTMLElement>('[data-remove]').forEach((b) => b.addEventListener('click', async () => { try { await api.del(`/api/friends/${b.dataset.remove}`); friendsLast = ''; friendsPanel(); } catch (e) { err(e); } }));
  p.querySelectorAll<HTMLElement>('[data-visit]').forEach((b) => b.addEventListener('click', () => {
    const ownerId = Number(b.dataset.visit);
    const who = b.dataset.name || 'friend';
    closePanel();
    sfx.chime();
    waitingOverlay(who, () => {
      waitingOverlay(null);
      detachDomain(ownerId);
      goto('House', { spawn: 'hallway', ownerId: me().user.id });
    });
    goto('House', { ownerId, spawn: 'hallway' });
  }));
}
/** Owner side: someone is knocking. Non-modal card in the top-right. */
export function knockPrompt(nameText: string, character: number, answer: (accept: boolean) => void) {
  document.getElementById('knock')?.remove();
  const el = document.createElement('div'); el.id = 'knock';
  el.innerHTML = `<img src="/assets/chars/portrait_${character}.png" alt="" /><div><b>${esc(nameText)}</b> is ringing your doorbell.<br/><small>Let them into your home?</small><div class="form-actions" style="justify-content:flex-start;margin-top:8px"><button class="btn sm sage" id="k-yes">Let in</button><button class="btn sm rose" id="k-no">Not now</button></div></div>`;
  overlay().appendChild(el); sfx.chime();
  let done = false;
  const finish = (v: boolean) => { if (done) return; done = true; el.remove(); answer(v); };
  el.querySelector('#k-yes')!.addEventListener('click', () => finish(true));
  el.querySelector('#k-no')!.addEventListener('click', () => finish(false));
  setTimeout(() => { if (el.isConnected) finish(false); }, 45_000);
}
/** Visitor side: waiting for the owner. Pass null to hide. */
export function waitingOverlay(owner: string | null, cancel?: () => void) {
  document.getElementById('waiting')?.remove();
  if (!owner) return;
  const el = document.createElement('div'); el.id = 'waiting';
  el.innerHTML = `<div class="panel" style="width:420px;text-align:center"><h2>🔔 Ringing doorbell...</h2><p class="sub">Waiting for <b>${esc(owner)}</b> to let you in.</p><div class="dots-anim"><i></i><i></i><i></i></div><button class="btn rose sm" id="w-cancel">Go back home</button></div>`;
  overlay().appendChild(el);
  el.querySelector('#w-cancel')!.addEventListener('click', () => { el.remove(); cancel?.(); });
}

// ---------- garden HUD + edit palette ----------
export type EditTool = 'fence' | 'gate' | 'hoe' | 'erase' | 'move';
export function gardenHud(n: number, h: { onEdit: () => void; onSnapshot: () => void }) {
  const m = me(), lv = level().level, owned = m.plots.length, unlocked = m.user.is_admin ? n * n : plotsUnlocked(lv);
  let el = document.getElementById('garden-hud');
  if (!el) { el = document.createElement('div'); el.id = 'garden-hud'; overlay().appendChild(el); }
  el.innerHTML = `<b>🌿 Level ${num(lv)} garden</b> <small>${num(n)}×${num(n)} tiles</small><br/>Plots ${num(owned)}/${num(unlocked)}${owned < unlocked ? ' · hoe a tile with E' : ` · level ${num(lv + 1)} unlocks more`}${m.user.wither ? `<br/><span style="color:#b55">withering ${m.user.wither}/4 - finish a task today</span>` : ''}
    <div class="form-actions" style="justify-content:flex-start;margin-top:6px"><button class="btn sm" id="g-edit">🔨 Edit garden</button><button class="btn sm" id="g-snap">📷 Snapshot</button></div>`;
  el.querySelector('#g-edit')!.addEventListener('click', () => { sfx.click(); h.onEdit(); });
  el.querySelector('#g-snap')!.addEventListener('click', () => { sfx.click(); h.onSnapshot(); });
}
export function hideGardenHud() { document.getElementById('garden-hud')?.remove(); }
export function editPalette(o: { tool: EditTool; color: FenceColor; onTool: (t: EditTool) => void; onColor: (c: FenceColor) => void; onDone: () => void }) {
  document.getElementById('palette')?.remove();
  const el = document.createElement('div'); el.id = 'palette';
  const tools: [EditTool, string, string][] = [['fence', '🪵', 'Fence'], ['gate', '🚪', 'Gate'], ['hoe', '⛏', 'Hoe'], ['erase', '🌱', 'Erase / grassify'], ['move', '✋', 'Move']];
  el.innerHTML = `<b>Build mode</b><div class="tools">${tools.map(([k, i, l]) => `<button data-tool="${k}" class="${k === o.tool ? 'on' : ''}" title="${l}">${i}<span>${l}</span></button>`).join('')}</div>
    <div class="colors" title="Fence colour">${FENCE_COLORS.map((c) => `<button data-color="${c}" class="sw ${c} ${c === o.color ? 'on' : ''}" title="${c.replace('_', ' ')}"></button>`).join('')}</div>
    <p>Click a tile. Fence / gate again to remove it. Move: pick up a plot, then click its new tile.</p><button class="btn sm sage" id="pal-done">Done</button>`;
  overlay().appendChild(el);
  el.querySelectorAll<HTMLElement>('[data-tool]').forEach((b) => b.addEventListener('click', () => { el.querySelectorAll('[data-tool]').forEach((x) => x.classList.remove('on')); b.classList.add('on'); sfx.click(); o.onTool(b.dataset.tool as EditTool); }));
  el.querySelectorAll<HTMLElement>('[data-color]').forEach((b) => b.addEventListener('click', () => { el.querySelectorAll('[data-color]').forEach((x) => x.classList.remove('on')); b.classList.add('on'); o.onColor(b.dataset.color as FenceColor); }));
  el.querySelector('#pal-done')!.addEventListener('click', o.onDone);
}
export function hideEditPalette() { document.getElementById('palette')?.remove(); }
/** House HUD: the Edit room toggle. */
export function houseHud(h: { onEdit: () => void }, editing = false) {
  let el = document.getElementById('house-hud');
  if (!el) { el = document.createElement('div'); el.id = 'house-hud'; overlay().appendChild(el); }
  el.innerHTML = `<button class="btn sm ${editing ? 'sage' : ''}" id="h-edit">${editing ? '✓ Done editing' : '🪑 Edit room'}</button>${editing ? '<small>Click a piece to move it or put it away</small>' : ''}`;
  el.querySelector('#h-edit')!.addEventListener('click', () => { sfx.click(); h.onEdit(); });
}
export function hideHouseHud() { document.getElementById('house-hud')?.remove(); }
export function furnitureMenu(title: string, locked: boolean, x: number, y: number, h: { move: () => void; remove: () => void }) {
  document.getElementById('fmenu')?.remove();
  const el = document.createElement('div'); el.id = 'fmenu';
  const canvas = document.querySelector('#game canvas')!.getBoundingClientRect(), s = canvas.width / 1440;
  el.style.left = `${Math.min(window.innerWidth - 220, canvas.left + x * s)}px`; el.style.top = `${Math.min(window.innerHeight - 160, canvas.top + y * s)}px`;
  el.innerHTML = `<b>${esc(title)}</b><button id="fm-move">✋ Move</button><button id="fm-remove" ${locked ? 'disabled title="This piece stays in your home"' : ''}>📦 Put in inventory</button><button id="fm-cancel">Cancel</button>`;
  overlay().appendChild(el);
  el.querySelector('#fm-move')!.addEventListener('click', () => { el.remove(); h.move(); });
  el.querySelector('#fm-remove')!.addEventListener('click', () => { el.remove(); h.remove(); });
  el.querySelector('#fm-cancel')!.addEventListener('click', () => el.remove());
}

// ---------- garden plot dialog ----------
export function plotDialog(tx: number, ty: number, plot: Plot | null) {
  const m = me(), lv = level().level;
  let html = '';
  if (!plot) {
    const owned = m.plots.length, unlocked = m.user.is_admin ? gardenTiles(lv) ** 2 : plotsUnlocked(lv);
    html = owned >= unlocked
      ? `<h2>🌱 Empty ground</h2><p class="sub">All ${unlocked} plots for level ${lv} are in use. Level up to unlock more, or grassify a plot you no longer need.</p>`
      : `<h2>⛏ Hoe a plot here?</h2><p class="sub">Tile ${tx + 1},${ty + 1} · plot ${owned + 1} of ${unlocked} unlocked · free</p><div class="form-actions"><button class="btn sage" id="hoe">Hoe the ground</button></div>`;
  } else if (!plot.plant_id) {
    const seeds = m.user.is_admin ? PLANTS.map((p) => ({ plant_id: p.id, qty: Infinity })) : m.inventory.filter((i) => i.qty > 0 && plantById(i.plant_id));
    html = `<h2>🌱 Plant a seed</h2><p class="sub">Pick something from your inventory. Flowers take ${GROWTH_OPTIONS.find((g) => g.value === m.user.growth)?.minutes} min to mature.</p><div class="slots big">${seeds.map((s) => { const pl = plantById(s.plant_id)!; return `<button class="slot seed" data-plant="${pl.id}">${plantImg(pl.id, 'seed-art')}<span class="nm">${pl.name}</span><span class="qty num">×${m.user.is_admin ? '∞' : s.qty}</span></button>`; }).join('') || '<p class="sub">No seeds. Visit the shop from your house (Q).</p>'}</div>
      <div class="form-actions"><button class="btn rose sm" id="grass">🌿 Grassify (remove plot)</button></div>`;
  } else {
    const pl = plantById(plot.plant_id)!, now = Date.now(), stage = plantStage(plot, now), names = ['Seed', 'Twig', 'Young', 'Fully grown'], r = plantReward(pl, m.user.growth);
    const left = plot.ready_at && stage < STAGES ? plot.ready_at - now : 0;
    html = `<h2>${pl.name}</h2><p class="sub">${names[stage]} · ${pl.kind} · ${pl.rarity}${m.user.wither ? ` · withering ${m.user.wither}/4 - complete tasks to revive` : ''}</p>
      <div style="text-align:center">${stage === 0 ? '<img src="/assets/scenes/soil.png" style="height:64px" alt="" />' : stage === 1 ? '<img src="/assets/plants/twig.png" style="height:48px" alt="" />' : plantImg(pl.id, stage === 2 ? 'young' : 'grown')}</div>
      <p class="sub" style="text-align:center">${stage < STAGES ? `Fully grown in ${num(fmtMs(left))} · +${num(r.xp)} XP and +${num(r.coins)} coins when it grows (total ${fmtMs(growMs(pl, m.user.growth))})` : 'Fully grown. Looking good!'}</p>
      <div class="form-actions"><button class="btn rose sm" id="grass">🌿 Grassify (removes the plant)</button></div><p class="sub" style="text-align:center">Use Edit garden → Move to move it without losing the timer.</p>`;
  }
  const p = openPanel(html);
  name('plot');
  const act = async (fn: () => Promise<unknown>, msg: string) => { try { await fn(); await refreshMe(); sfx.plant(); toast(msg, 'reward'); closePanel(); } catch (e) { err(e); } };
  p.querySelector('#hoe')?.addEventListener('click', () => act(() => api.post('/api/plots/hoe', { tx, ty }), 'New plot ready for planting'));
  p.querySelectorAll<HTMLElement>('[data-plant]').forEach((b) => b.addEventListener('click', () => act(() => api.post(`/api/plots/${plot!.id}/plant`, { plant_id: Number(b.dataset.plant) }), `Planted ${plantById(Number(b.dataset.plant))!.name}. It sprouts in a few seconds.`)));
  p.querySelector('#grass')?.addEventListener('click', async () => { if (!plot!.plant_id || (await confirmDialog('Grassify this plot?', `The ${plantById(plot!.plant_id)!.name} growing here will be lost.`, 'Grassify', 'Keep'))) act(() => api.post(`/api/plots/${plot!.id}/remove`), 'Back to grass'); });
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
    <div class="card-row" style="margin:14px 0"><div class="stat-box"><div><small>Tasks done</small><b class="num">${d.tasks_done}</b></div></div><div class="stat-box">${ico('xp')}<div><small>XP today</small><b class="num">${d.xp}</b></div></div><div class="stat-box">${ico('streak')}<div><small>Streak</small><b class="num">${m.user.streak}</b></div></div></div>
    ${done.length ? `<div class="task-list">${done.map((t) => `<div class="task done"><div class="check">✓</div><div><div class="name">${esc(t.name)}</div></div><div class="meta"><span class="pts">+${t.xp_awarded} XP</span></div><div></div></div>`).join('')}</div>` : '<p class="sub" style="text-align:center">No tasks finished yet today. Tomorrow is a new leaf.</p>'}
    <p class="sub" style="text-align:center;margin-top:12px">${m.user.streak ? `Keep the streak alive tomorrow: one task keeps your garden green.` : 'Finish one task tomorrow to start a streak.'}</p>
    <div class="form-actions"><button class="btn sage" id="wake">☀ Wake up</button></div>`);
  name('sleep');
  p.querySelector('#wake')!.addEventListener('click', closePanel);
}

// ---------- tutorial ----------
const STEPS: [string, string][] = [
  ['Welcome to Ikigai 🌱', 'Your garden only grows when you do. Finish real tasks to earn XP and coins, then spend them on your garden and home.'],
  ['Move around', 'WASD or the arrow keys walk. Hold Shift to run. Press F to wave at friends.'],
  ['Your task book 📖', 'Press T (or E at your desk) to add tasks with a difficulty, due date and time estimate. Completing them pays XP + coins. Organize them in folders.'],
  ['Focus timer ⏱', 'Press P for the Pomodoro timer, or ▶ on a task. Long tasks are split into work sessions with breaks so the total work time matches your estimate. You can complete a task early while the timer runs; finishing at least one focus session pays double XP. The garden is closed while you focus.'],
  ['The garden 🌿', 'Walk out the bottom door. Stand on a tile and press E to hoe a plot, plant a seed, or grassify it. Plants sprout in seconds and mature on a real timer - hover a plant to see it. Edit garden lets you place fences and gates and move things around.'],
  ['Streaks and withering 🍂', 'Finish at least one task a day to keep your streak. Miss two days and your plants start to grey. Freeze the garden in Settings when you are away (2 per month).'],
  ['Shop and cards 🏪', 'Press Q at home for the daily plants, furniture and the spin. Cards are rare: at most one appears in the shop, and it costs gems.'],
  ['Your home 🪑', 'Buy furniture, then place it from the Inventory. Edit room moves pieces or puts them back. The bed, desk and bookcase are where you sleep, plan and show cards.'],
  ['Friends 👥', 'Walk through the gateway on the right to add friends by code. Visit rings their doorbell — wait for them to let you into their home. Once inside you can see each other, walk to their garden freely, and the left gateway takes you back to yours.'],
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
export type { Furniture };
