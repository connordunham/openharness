/**
 * Schema migration runner for @openharness/parts.
 *
 * Forward-only migrations applied at database open time.
 * Version is tracked via SQLite's PRAGMA user_version.
 */

import type Database from 'better-sqlite3';
import { CURRENT_SCHEMA_VERSION, SCHEMA_V1_DDL } from './schema.js';

export interface Migration {
  version: number;
  description: string;
  up: (db: Database.Database) => void;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'Initial schema: master parts tables and revision log',
    up: (db: Database.Database) => {
      db.exec(SCHEMA_V1_DDL);
    },
  },
];

/**
 * Run pending migrations on a SQLite database up to targetVersion.
 *
 * Throws if the database user_version is higher than CURRENT_SCHEMA_VERSION.
 * If already at or above targetVersion, this is a no-op.
 */
export function runMigrations(
  db: Database.Database,
  targetVersion: number = CURRENT_SCHEMA_VERSION,
): void {
  // Enforce foreign keys
  db.pragma('foreign_keys = ON');

  const currentVersion = (db.pragma('user_version', { simple: true }) as number) ?? 0;

  if (currentVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Database schema version ${currentVersion} is newer than supported version ${CURRENT_SCHEMA_VERSION}`,
    );
  }

  if (currentVersion >= targetVersion) {
    return;
  }

  for (const migration of MIGRATIONS) {
    if (migration.version > currentVersion && migration.version <= targetVersion) {
      db.transaction(() => {
        migration.up(db);
        db.pragma(`user_version = ${migration.version}`);
      })();
    }
  }
}
