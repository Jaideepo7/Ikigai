import assert from 'node:assert/strict';
import { build } from 'rolldown';
import { shopRotation, dayKey } from '../src/shared/rules.ts';
await build({ input: 'worker/index.ts', platform: 'node', plugins: [{ name: 'cloudflare-stub', resolveId(id) { if (id === 'cloudflare:workers') return '\0cf'; }, load(id) { if (id === '\0cf') return 'export class DurableObject {}'; } }], output: { file: 'out/shop-api-worker.mjs', format: 'esm' } });
const { default: app } = await import('../out/shop-api-worker.mjs');
const user = { id: 1, xp: 0, coins: 10000, frozen: 0, is_admin: 0, last_roll_day: dayKey(Date.now(), 0) };
let placed = [], plots = [], fences = [], owned = 1, writes = [];
const DB = {
 prepare(sql) {
  let args = [];
  return { bind(...a) { args = a; return this; },
   async first() {
    if (sql.startsWith('SELECT u.* FROM sessions')) return user;
    if (sql.startsWith('SELECT qty FROM furniture_owned')) return { qty: owned };
    if (sql.includes('COUNT(*) AS n FROM plots')) return { n: plots.length };
    if (sql.startsWith('SELECT 1 FROM plots')) return plots.some(p => p.tx === args[1] && p.ty === args[2]) ? { 1: 1 } : null;
    if (sql.startsWith('SELECT 1 FROM fences')) return null;
    if (sql.includes('daily')) return { spun: 0 };
    throw new Error(sql);
   },
   async all() {
    if (sql.includes('FROM furniture_placed')) return { results: placed };
    if (sql.includes('FROM plots')) return { results: plots };
    if (sql.includes('FROM fences')) return { results: fences };
    if (sql.includes('FROM cards') || sql.includes('FROM inventory')) return { results: [] };
    throw new Error(sql);
   },
   async run() { writes.push({ sql, args }); return { meta: { last_row_id: 20 } }; }
  };
 },
 async batch(statements) { return Promise.all(statements.map(s => s.run())); }
};
async function req(path, data) { return app.fetch(new Request('http://test'+path, { method: data ? 'POST' : 'GET', headers: { cookie: 'sid=test', 'content-type': 'application/json', 'x-tz': '0' }, ...(data ? { body: JSON.stringify(data) } : {}) }), { DB }); }
let r = await req('/api/shop'); assert.equal(r.status, 200); const info = await r.json();
assert.equal(new Set([...info.furniture, ...info.outdoor]).size, 8); assert.ok(info.resetAt > info.serverNow);
for (const id of [...info.furniture, ...info.outdoor]) assert.equal((await req('/api/shop/furniture', { furniture_id: id })).status, 200);
const unavailable = Array.from({ length: 40 }, (_, i) => i + 1).find(id => ![...info.furniture, ...info.outdoor].includes(id));
assert.equal((await req('/api/shop/furniture', { furniture_id: unavailable })).status, 400);
assert.equal((await req('/api/furniture/place', { furniture_id: 23, cx: 3, cy: 5 })).status, 200);
assert.equal(writes.findLast(w => w.sql.startsWith('INSERT INTO furniture_placed')).args[4], 'garden');
placed = [{ id: 20, furniture_id: 23, cx: 3, cy: 5, locked: 0, location: 'garden' }];
assert.equal((await req('/api/furniture/place', { furniture_id: 23, cx: 7, cy: 5 })).status, 400, 'cannot reuse one owned piece');
assert.equal((await req('/api/furniture/20/move', { cx: 7, cy: 5 })).status, 200);
assert.equal((await req('/api/furniture/999/move', { cx: 7, cy: 5 })).status, 404, 'cannot move another user piece');
assert.equal((await req('/api/plots/hoe', { tx: 3, ty: 5 })).status, 400, 'cannot hoe under furniture');
assert.equal((await req('/api/garden/fence', { tx: 4, ty: 5, kind: 'fence' })).status, 400, 'cannot fence under furniture');
owned = 2; plots = [{ tx: 7, ty: 5 }];
assert.equal((await req('/api/furniture/20/move', { cx: 7, cy: 5 })).status, 400, 'cannot cover a plot');
plots = []; fences = [{ tx: 7, ty: 5, kind: 'fence' }];
assert.equal((await req('/api/furniture/place', { furniture_id: 23, cx: 7, cy: 5 })).status, 400, 'cannot cover a fence');
user.frozen = 1; fences = [];
assert.equal((await req('/api/furniture/20/move', { cx: 7, cy: 5 })).status, 400);
assert.equal((await req('/api/furniture/place', { furniture_id: 23, cx: 7, cy: 5 })).status, 400);
console.log('PASS: actual shop stock/purchase and garden placement APIs, inventory limits, ownership, plots/fences and frozen garden validation.');
