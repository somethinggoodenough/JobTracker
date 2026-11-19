import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

export function localD1(t) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const name of readdirSync('drizzle').filter(name => name.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync('drizzle/' + name, 'utf8'));
  }
  const db = {
    prepare(sql) {
      let params = [];
      const exec = () => {
        const results = sqlite.prepare(sql).all(...params);
        const meta = sqlite.prepare('SELECT changes() AS changes,last_insert_rowid() AS last_row_id').get();
        return { results, meta };
      };
      return { bind(...values) { params = values; return this; }, async first() { return exec().results[0] ?? null; },
        async all() { return exec(); }, async run() { return exec(); }, exec };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map(stmt => stmt.exec());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  return { db, sqlite };
}
