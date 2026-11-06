// 用 Node 自带的 SQLite 假装成 Cloudflare D1，让后端逻辑能在本机测试。
import { DatabaseSync } from 'node:sqlite';

class Statement {
  constructor(db, sql, args = []) {
    this.db = db;
    this.sql = sql;
    this.args = args;
  }

  bind(...args) {
    return new Statement(this.db, this.sql, args);
  }

  async first(column) {
    const row = this.db.prepare(this.sql).get(...this.args) ?? null;
    if (row && column) return row[column];
    return row ? { ...row } : null;
  }

  async all() {
    const results = this.db.prepare(this.sql).all(...this.args).map(row => ({ ...row }));
    return { results, success: true, meta: {} };
  }

  async run() {
    const info = this.db.prepare(this.sql).run(...this.args);
    return { success: true, meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
  }
}

export function createD1(schemaSql) {
  const db = new DatabaseSync(':memory:');
  db.exec(schemaSql);
  return {
    raw: db,
    prepare: sql => new Statement(db, sql),
    async batch(statements) {
      const out = [];
      db.exec('BEGIN');
      try {
        for (const statement of statements) out.push(await statement.run());
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      return out;
    },
  };
}
