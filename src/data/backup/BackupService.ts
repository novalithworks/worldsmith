import { FILE_FORMATS, MAX_BACKUPS } from '../../app/constants';
import { listFilesDeep, joinPath, type StorageAdapter } from '../storage/StorageAdapter';
import type { AtomicJsonFile } from '../storage/AtomicJsonFile';
import type { WorldsmithPaths } from '../storage/paths';
import { planNoteRestore, remapNotePaths, rewriteWorldKey, safeNotePath, type BackupNote } from './backupNotes';

/**
 * World snapshots. A backup is one JSON file containing every file of a world folder
 * (parsed JSON keyed by relative path). It works before repositories load (used ahead of
 * storage migrations) and doubles as the raw project export format.
 */
export interface WorldBackup {
	format: typeof FILE_FORMATS.backup;
	v: 1;
	createdAt: number;
	worldId: string;
	reason: string;
	files: Record<string, unknown>;
	/** The world's native notes, path and full text (0.17). Older files have none. */
	notes?: BackupNote[];
}

export interface RestoreOptions {
	/** The world is a copy of this world id: its notes name the copy and never take an original's place. */
	copyOf?: string;
}

export interface BackupInfo {
	path: string;
	createdAt: number;
	name: string;
}

export class BackupService {
	constructor(
		private readonly adapter: StorageAdapter,
		private readonly files: AtomicJsonFile,
		private readonly paths: WorldsmithPaths,
		/** The world's native notes (only the open world has them to give). */
		private readonly getNotes: (worldId: string) => Promise<BackupNote[]> = async () => [],
	) {}

	async create(worldId: string, reason: string): Promise<string> {
		const bundle = await this.bundle(worldId, reason);
		const stamp = new Date(bundle.createdAt).toISOString().replace(/[:.]/g, '-');
		const target = joinPath(this.paths.backupsDir(worldId), `${stamp}.json`);
		await this.files.write(target, bundle);
		await this.prune(worldId);
		return target;
	}

	/** Every file of a world in one object (a backup, or a world export file). */
	async bundle(worldId: string, reason: string): Promise<WorldBackup> {
		const dir = this.paths.worldDir(worldId);
		const all = await listFilesDeep(this.adapter, dir);
		const bundle: WorldBackup = {
			format: FILE_FORMATS.backup,
			v: 1,
			createdAt: Date.now(),
			worldId,
			reason,
			files: {},
		};
		for (const path of all) {
			if (!path.endsWith('.json')) continue; // skip .tmp/.bak
			// Migration safety copies belong to this vault; a world file doesn't carry them.
			if (reason === 'export' && path.slice(dir.length + 1).startsWith('note-migrations/')) continue;
			const res = await this.files.read<unknown>(path);
			if (res.value !== null) bundle.files[path.slice(dir.length + 1)] = res.value;
			// An export must not quietly leave a file out (0.19): stop and say which one.
			else if (reason === 'export') throw new Error(`“${path.slice(dir.length + 1)}” couldn’t be read, so the export was stopped. Nothing was written.`);
		}
		try {
			const notes = await this.getNotes(worldId);
			if (notes.length) bundle.notes = notes;
		} catch (e) {
			console.warn('[Worldsmith] could not add native notes to the backup', e);
		}
		return bundle;
	}

	async list(worldId: string): Promise<BackupInfo[]> {
		const { files } = await this.adapter.list(this.paths.backupsDir(worldId));
		return files
			.filter((f) => f.endsWith('.json') && !f.endsWith('/index.json'))
			.map((path) => {
				const name = path.split('/').pop() ?? path;
				const iso = name.replace('.json', '').replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, 'T$1:$2:$3.$4Z');
				return { path, name, createdAt: Date.parse(iso) || 0 };
			})
			.sort((a, b) => b.createdAt - a.createdAt);
	}

	/**
	 * Restore a backup into its world folder. Files present in the backup are rewritten;
	 * files not in the backup are left in place (restoring never deletes data).
	 */
	async restore(backupPath: string): ReturnType<BackupService["restoreBundle"]> {
		const res = await this.files.read<WorldBackup>(backupPath);
		const bundle = res.value;
		if (!bundle || bundle.format !== FILE_FORMATS.backup) throw new Error('Not a Worldsmith backup file');
		return this.restoreBundle(bundle);
	}

	/** Write a bundle's files into its world folder (never deletes files that aren't in it). */
	async restoreBundle(bundle: WorldBackup, opts: RestoreOptions = {}): Promise<{ worldId: string; files: number; notes: { written: number; kept: number; moved: number } }> {
		if (!bundle || bundle.format !== FILE_FORMATS.backup || typeof bundle.worldId !== 'string' || !bundle.files) throw new Error('Not a Worldsmith backup file');
		// The id is a folder name: refuse anything that could point outside the worlds folder.
		if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(bundle.worldId)) throw new Error('This backup file is damaged (its world id isn’t valid).');
		const dir = this.paths.worldDir(bundle.worldId);
		// Notes first decide where they go (never over a different note), so entries can follow.
		const notes = await this.planNotes(bundle, opts);
		const moved = new Map(notes.filter((x) => x.to !== x.from).map((x) => [x.from, x.to]));
		const files = remapNotePaths(bundle.files, moved);
		let n = 0;
		for (const [rel, value] of Object.entries(files)) {
			// Only plain paths inside the world folder (a crafted file can't write elsewhere).
			if (!rel || rel.startsWith('/') || rel.includes('\\') || rel.split('/').some((p) => p === '..' || p === '.' || p === '')) continue;
			await this.files.write(joinPath(dir, rel), value);
			n++;
		}
		const res = { written: 0, kept: 0, moved: moved.size };
		for (const step of notes) {
			if (!step.write) {
				res.kept++;
				continue;
			}
			try {
				const folder = step.to.split('/').slice(0, -1).join('/');
				if (folder && !(await this.adapter.exists(folder))) await this.adapter.mkdir(folder);
				// Checked again just before writing: a note that appeared meanwhile is never replaced.
				if (await this.adapter.exists(step.to)) {
					res.kept++;
					continue;
				}
				await this.adapter.write(step.to, step.content);
				res.written++;
			} catch (e) {
				console.warn('[Worldsmith] could not restore note', step.to, e);
			}
		}
		return { worldId: bundle.worldId, files: n, notes: res };
	}

	private async planNotes(bundle: WorldBackup, opts: RestoreOptions) {
		const list = Array.isArray(bundle.notes) ? bundle.notes.filter((x) => x && safeNotePath(x.path) && typeof x.content === 'string') : [];
		if (!list.length) return [];
		const notes = opts.copyOf ? list.map((x) => ({ path: x.path, content: rewriteWorldKey(x.content, opts.copyOf!, bundle.worldId) })) : list;
		const current = new Map<string, string | null>();
		const read = async (p: string) => {
			if (current.has(p)) return;
			current.set(p, (await this.adapter.exists(p)) ? await this.adapter.read(p) : null);
		};
		for (const x of notes) {
			await read(x.path);
			for (let i = 1; i <= 3; i++) await read(`${x.path.slice(0, -3)} (${opts.copyOf ? 'copy' : 'restored'}${i > 1 ? ` ${i}` : ''}).md`);
		}
		const steps = planNoteRestore(notes, (p) => (current.has(p) ? current.get(p)! : null), opts.copyOf ? 'copy' : 'restored');
		return steps;
	}

	private async prune(worldId: string): Promise<void> {
		const list = await this.list(worldId);
		for (const old of list.slice(MAX_BACKUPS)) {
			try {
				await this.adapter.remove(old.path);
			} catch (e) {
				console.warn('[Worldsmith] could not prune backup', old.path, e);
			}
		}
	}
}
