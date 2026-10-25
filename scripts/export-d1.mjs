/** Read-only export to a PRIVATE path outside the repository. Never remotely imports. */
import { DatabaseSync, backup } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const [source, destination] = process.argv.slice(2);
if (
  !source ||
  !destination ||
  !path.isAbsolute(destination) ||
  destination.startsWith(process.cwd() + '/')
)
  throw Error('Provide source and absolute private destination outside checkout');
let db = new DatabaseSync(source, { readOnly: true });
if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok')
  throw Error('Corrupt source');
if (db.prepare("SELECT count(*) n FROM tasks WHERE status='running'").get().n)
  throw Error('Stop active work before final migration');
const dir = path.dirname(destination);
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const repository = fs.realpathSync(fileURLToPath(new URL('..', import.meta.url)));
const parent = fs.realpathSync(dir);
if (parent === repository || parent.startsWith(repository + path.sep))
  throw Error('Private exports must stay outside the checkout, including symlinks');
const fd = fs.openSync(destination, 'wx', 0o600);
fs.closeSync(fs.openSync(destination + '.sqlite', 'wx', 0o600));
await backup(db, destination + '.sqlite');
db.close();
db = new DatabaseSync(destination + '.sqlite', { readOnly: true });
fs.chmodSync(destination + '.sqlite', 0o600);
const quote = (v) =>
  v === null
    ? 'NULL'
    : typeof v === 'number'
      ? String(v)
      : typeof v === 'bigint'
        ? String(v)
        : typeof v === 'string'
          ? "'" + v.replaceAll("'", "''") + "'"
          : (() => {
              throw Error('Unsupported SQLite type');
            })();
const tables = db
  .prepare(
    "SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  )
  .all();
const statements = ['PRAGMA defer_foreign_keys=ON;'],
  manifest = {};
for (const { name, sql } of tables) statements.push(sql + ';');
for (const { name } of tables) {
  const rows = db.prepare('SELECT * FROM "' + name + '" ORDER BY rowid').all();
  manifest[name] = {
    count: rows.length,
    sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
  };
  for (const row of rows)
    statements.push(
      'INSERT INTO "' +
        name +
        '" (' +
        Object.keys(row)
          .map((k) => '"' + k + '"')
          .join(',') +
        ') VALUES (' +
        Object.values(row).map(quote).join(',') +
        ');',
    );
}
for (const row of db
  .prepare("SELECT sql FROM sqlite_master WHERE type IN ('index','trigger') AND sql IS NOT NULL")
  .all())
  statements.push(row.sql + ';');
for (const row of db.prepare('SELECT name,seq FROM sqlite_sequence').all())
  statements.push(
    'UPDATE sqlite_sequence SET seq=' + Number(row.seq) + ' WHERE name=' + quote(row.name) + ';',
  );
if (statements.some((s) => Buffer.byteLength(s) > 90000))
  throw Error('Statement too large for safe D1 import; split with reviewed migration tooling');
fs.writeFileSync(fd, statements.join('\n'));
fs.closeSync(fd);
fs.writeFileSync(destination + '.manifest.json', JSON.stringify(manifest), {
  flag: 'wx',
  mode: 0o600,
});
db.close();
console.log('Private export/backup/manifest created; source unchanged. No D1 import or cutover.');
