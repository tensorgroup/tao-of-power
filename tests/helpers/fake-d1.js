// A small stand-in for a Cloudflare D1 binding, on node:sqlite in memory.
// Covers what worker/sync.js uses: prepare().bind().first()/all()/run(), batch().
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

export function fakeD1(schemaPath) {
  const db = new DatabaseSync(':memory:');
  if (schemaPath) db.exec(readFileSync(schemaPath, 'utf8'));
  const stmt = (sql, args = []) => ({
    sql, args,
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
  });
  return {
    raw: db,
    prepare: (sql) => stmt(sql),
    batch: async (list) => {
      db.exec('BEGIN');
      try {
        const out = list.map((s) => ({ meta: { changes: Number(db.prepare(s.sql).run(...s.args).changes) } }));
        db.exec('COMMIT');
        return out;
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}
