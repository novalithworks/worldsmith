import type { StorageAdapter } from '../storage/StorageAdapter';
import type { AtomicJsonFile } from '../storage/AtomicJsonFile';
import type { WorldsmithPaths } from '../storage/paths';
import type { StorageManifest } from '../../core/types';

/**
 * Storage (folder-layout) migrations.
 *
 * Each migration moves `manifest.storageVersion` from `from` to `from + 1`. The runner
 * applies them in order, persisting the manifest after each one, so an interrupted
 * upgrade resumes where it stopped. A backup callback runs once before the first
 * migration. Migrations receive raw storage access — they run before any repository
 * is loaded.
 */
export interface MigrationContext {
	adapter: StorageAdapter;
	files: AtomicJsonFile;
	paths: WorldsmithPaths;
	manifest: StorageManifest;
	log(message: string): void;
}

export interface StorageMigration {
	id: string;
	from: number;
	description: string;
	run(ctx: MigrationContext): Promise<void>;
}

export interface MigrationResult {
	applied: string[];
	from: number;
	to: number;
}

export class MigrationRunner {
	constructor(private readonly migrations: StorageMigration[]) {
		const seen = new Set<number>();
		for (const m of migrations) {
			if (seen.has(m.from)) throw new Error(`[Worldsmith] duplicate storage migration from v${m.from}`);
			seen.add(m.from);
		}
	}

	pending(currentVersion: number, targetVersion: number): StorageMigration[] {
		const out: StorageMigration[] = [];
		for (let v = currentVersion; v < targetVersion; v++) {
			const m = this.migrations.find((x) => x.from === v);
			if (!m) throw new Error(`[Worldsmith] no storage migration from v${v} to v${v + 1}`);
			out.push(m);
		}
		return out;
	}

	async run(
		ctx: Omit<MigrationContext, 'log'>,
		targetVersion: number,
		hooks: { beforeFirst?(): Promise<void>; persist(manifest: StorageManifest): Promise<void>; log?(m: string): void },
	): Promise<MigrationResult> {
		const from = ctx.manifest.storageVersion;
		if (from > targetVersion) {
			throw new Error(
				`[Worldsmith] data was written by a newer Worldsmith (storage v${from}); this version supports v${targetVersion}. Update the plugin.`,
			);
		}
		const todo = this.pending(from, targetVersion);
		if (todo.length === 0) return { applied: [], from, to: from };

		await hooks.beforeFirst?.();
		const applied: string[] = [];
		for (const m of todo) {
			const log = (msg: string) => hooks.log?.(`[${m.id}] ${msg}`);
			log(m.description);
			await m.run({ ...ctx, log });
			ctx.manifest.storageVersion = m.from + 1;
			await hooks.persist(ctx.manifest);
			applied.push(m.id);
		}
		return { applied, from, to: ctx.manifest.storageVersion };
	}
}
