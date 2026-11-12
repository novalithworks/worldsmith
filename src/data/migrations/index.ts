import type { StorageMigration } from './MigrationRunner';

/**
 * Ordered storage migrations. Storage v1 is the baseline (no migrations yet).
 *
 * Example of a future migration:
 *
 *   {
 *     id: '0002-shard-entities',
 *     from: 1,
 *     description: 'Move entities into hash shards',
 *     async run(ctx) { … }
 *   }
 */
export const STORAGE_MIGRATIONS: StorageMigration[] = [];
