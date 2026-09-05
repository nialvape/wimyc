import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';

export type Db = Database.Database;

const MIGRATIONS = ['001_init.sql'];

/**
 * Abre la base y corre las migraciones. `path` puede ser `:memory:` en tests.
 */
export function openDatabase(path: string): Db {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
  for (const file of MIGRATIONS) {
    db.exec(readFileSync(join(migrationsDir, file), 'utf8'));
  }

  return db;
}
