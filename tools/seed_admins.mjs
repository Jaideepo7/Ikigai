// Creates 4 maxed-out admin accounts (admin1..admin4 / password "ikigai-admin") in the local or remote D1.
// Usage: node tools/seed_admins.mjs [--remote]
import { execFileSync } from 'node:child_process';
import { webcrypto as crypto } from 'node:crypto';
import fs from 'node:fs';

const remote = process.argv.includes('--remote');
const PASSWORD = 'ikigai-admin';
const enc = new TextEncoder();
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
async function hash(pw, salt) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 100_000 }, key, 256));
}
const LEVEL = 60, XP = 100 * LEVEL + (25 * LEVEL * (LEVEL - 1)) / 2; // xpForLevel(60): a 24x24 garden
let sql = '';
for (let i = 1; i <= 4; i++) {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  const h = await hash(PASSWORD, salt);
  const code = `ADMIN${i}`;
  sql += `DELETE FROM users WHERE username='admin${i}';\n`;
  sql += `INSERT INTO users (username,pass_hash,salt,friend_code,character,coins,gems,xp,streak,created_at,is_admin,tutorial_done) VALUES ('admin${i}','${h}','${salt}','${code}',${(i * 5) % 20},999999,9999,${XP},30,${Date.now()},1,1);\n`;
  const uid = `(SELECT id FROM users WHERE username='admin${i}')`;
  for (let p = 1; p <= 32; p++) sql += `INSERT OR REPLACE INTO inventory (user_id,plant_id,qty) VALUES (${uid},${p},20);\n`;
  for (let c = 0; c < 4; c++) sql += `INSERT OR REPLACE INTO cards (user_id,card_id,slot) VALUES (${uid},${c},${c});\n`;
  for (let f = 1; f <= 40; f++) sql += `INSERT OR REPLACE INTO furniture_owned (user_id,furniture_id,qty) VALUES (${uid},${f},2);\n`;
  // a few grown plots inside the starter ring so the garden is not empty (the ring + trees + home come from ensureInit)
  const plots = [[3, 3, 1], [5, 3, 29], [7, 3, 12], [3, 5, 8], [5, 5, 30], [9, 9, 17], [8, 6, 23], [6, 8, 20]];
  for (const [tx, ty, plant] of plots) sql += `INSERT OR REPLACE INTO plots (user_id,tx,ty,plant_id,stage,planted_at,ready_at) VALUES (${uid},${tx},${ty},${plant},3,${Date.now()},NULL);\n`;
}
fs.writeFileSync('tools/_admins.sql', sql);
execFileSync('npx', ['wrangler', 'd1', 'execute', 'ikigai', remote ? '--remote' : '--local', '--file=tools/_admins.sql', '-y'], { stdio: 'inherit', shell: true });
fs.unlinkSync('tools/_admins.sql');
console.log(`admin1..admin4 ready (password: ${PASSWORD}) on ${remote ? 'remote' : 'local'} D1`);
