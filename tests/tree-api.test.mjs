// Exercise the actual worker routes without a Cloudflare account or database.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { build } from 'rolldown';

await mkdir('out', { recursive: true });
await build({
  input: 'worker/index.ts', platform: 'node',
  plugins: [{
    name: 'durable-object-test-stub',
    resolveId(id) { if (id === 'cloudflare:workers') return '\0cloudflare-workers'; },
    load(id) { if (id === '\0cloudflare-workers') return 'export class DurableObject {}'; },
  }],
  output: { file: 'out/tree-api-worker.mjs', format: 'esm' },
});
const { default: app } = await import('../out/tree-api-worker.mjs');
for (const is_admin of [0, 1]) {
  const user = { id: 1, is_admin, last_roll_day: new Date().toISOString().slice(0, 10) };
  const DB = {
    prepare(sql) {
      assert.ok(sql.startsWith('SELECT u.* FROM sessions'), 'retired IDs must be rejected before inventory/plot writes');
      return { bind() { return this; }, async first() { return user; } };
    },
  };
  for (let plant_id = 21; plant_id <= 32; plant_id++) {
    for (const endpoint of ['/api/shop/seed', '/api/plots/1/plant']) {
      const response = await app.fetch(new Request(`http://test${endpoint}`, {
        method: 'POST', headers: { cookie: 'sid=test', 'content-type': 'application/json' },
        body: JSON.stringify({ plant_id }),
      }), { DB });
      assert.equal(response.status, 400, `${endpoint}, tree ${plant_id}, admin ${is_admin}`);
      assert.equal((await response.json()).error, 'No such plant');
    }
  }
}
console.log('PASS: all 12 retired trees rejected by purchase and planting routes for normal and admin accounts.');
