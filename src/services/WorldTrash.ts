import type { Database } from '../data/Database';
import { joinPath, listFilesDeep } from '../data/storage/StorageAdapter';
import type { BackupManager } from './backup/BackupManager';
import type { NativeNoteService } from './notes/NativeNoteService';
import type { WorldService } from './WorldService';

/**
 * Deleting worlds (0.20.1). Deleting never destroys anything at once: a verified backup of the
 * world is made first, then its folder moves to `<data>/trash/worlds/<id>/` (with a small
 * `deleted.json`) and it leaves the world list. From *Deleted worlds* it can be restored as it
 * was, or deleted for good. Notes and images in the vault are never touched, and the world's
 * backups stay in `<data>/backups/<id>/` unless the person chooses to delete them too.
 */

export interface DeletedWorld {
	worldId: string;
	name: string;
	deletedAt: number;
	entries: number;
	icon: string;
	/** Where its folder is now. */
	dir: string;
	/** The backup made just before deleting. */
	backupFile: string | null;
}

interface DeletedMeta {
	format: 'worldsmith/deleted-world';
	v: 1;
	worldId: string;
	name: string;
	deletedAt: number;
	entries: number;
	icon?: string;
	backupFile: string | null;
}

export class WorldTrash {
	constructor(
		private readonly db: Database,
		private readonly worlds: WorldService,
		private readonly backups: BackupManager,
		private readonly nativeNotes: NativeNoteService,
	) {}

	private get root(): string {
		return joinPath(this.db.root, 'trash', 'worlds');
	}

	/**
	 * Delete the open world: a verified backup, then its folder moves to Deleted worlds and it
	 * leaves the list. Another world opens, or the welcome screen if it was the last one.
	 */
	async deleteOpenWorld(): Promise<DeletedWorld> {
		const s = this.worlds.session;
		if (!s) throw new Error('No world is open.');
		const worldId = s.worldId;
		const name = s.world.name;
		const worldIcon = s.world.icon || 'globe-2';
		const entries = [...s.entities.values()].filter((e) => !e.trashedAt).length;

		// 1. A verified backup first (it stays in the backups folder).
		const backup = await this.backups.create('before-delete', { force: true });

		// 2. Close the world and move its folder aside.
		this.nativeNotes.pause(true);
		try {
			await this.db.flushAllStrict();
			await this.nativeNotes.idle();
			await this.worlds.shutdown();
			const from = this.db.paths.worldDir(worldId);
			let to = joinPath(this.root, worldId);
			for (let n = 2; await this.db.adapter.exists(to); n++) to = joinPath(this.root, `${worldId}-${n}`);
			await this.db.files.ensureDir(this.root);
			await this.db.adapter.rename(from, to);
			const meta: DeletedMeta = { format: 'worldsmith/deleted-world', v: 1, worldId, name, deletedAt: Date.now(), entries, icon: worldIcon, backupFile: backup?.file ?? null };
			await this.db.files.write(joinPath(to, 'deleted.json'), meta);

			// 3. Off the list; the next world (or the welcome screen) opens.
			const manifest = this.db.manifest.require();
			manifest.worlds = manifest.worlds.filter((w) => w.id !== worldId);
			manifest.activeWorldId = manifest.worlds[0]?.id ?? null;
			await this.db.manifest.save(manifest);
			return { worldId, name, deletedAt: meta.deletedAt, entries, icon: worldIcon, dir: to, backupFile: meta.backupFile };
		} finally {
			this.nativeNotes.pause(false);
			await this.worlds.init();
		}
	}

	/** Worlds in Deleted worlds, most recently deleted first. */
	async list(): Promise<DeletedWorld[]> {
		if (!(await this.db.adapter.exists(this.root))) return [];
		const out: DeletedWorld[] = [];
		for (const dir of (await this.db.adapter.list(this.root)).folders) {
			const meta = (await this.db.files.read<DeletedMeta>(joinPath(dir, 'deleted.json'))).value;
			if (meta?.format !== 'worldsmith/deleted-world') continue;
			out.push({ worldId: meta.worldId, name: meta.name, deletedAt: meta.deletedAt, entries: meta.entries, icon: meta.icon || 'globe-2', dir, backupFile: meta.backupFile });
		}
		return out.sort((a, b) => b.deletedAt - a.deletedAt);
	}

	/** Put a deleted world back in the list, as it was, and open it. */
	async restore(d: DeletedWorld): Promise<void> {
		const target = this.db.paths.worldDir(d.worldId);
		const manifest = this.db.manifest.get() ?? (await this.db.createManifest());
		if (manifest.worlds.some((w) => w.id === d.worldId) || (await this.db.adapter.exists(target))) throw new Error('A world with the same identity is already in your vault, so this one can’t be put back beside it. Restore its backup as a new world instead.');
		await this.worlds.shutdown();
		try {
			await this.db.adapter.rename(d.dir, target);
			await this.db.files.remove(joinPath(target, 'deleted.json')).catch(() => undefined);
			manifest.worlds.push({ id: d.worldId, name: d.name, folder: `worlds/${d.worldId}` });
			manifest.activeWorldId = d.worldId;
			await this.db.manifest.save(manifest);
		} finally {
			await this.worlds.init();
		}
	}

	/** How many backups a deleted world still has. */
	async backupCount(d: DeletedWorld): Promise<number> {
		const dir = this.db.paths.backupsDir(d.worldId);
		return (await listFilesDeep(this.db.adapter, dir)).filter((p) => p.endsWith('.worldsmith.zip') || (p.endsWith('.json') && !p.endsWith('/index.json'))).length;
	}

	/** Delete a world from Deleted worlds for good (and, if asked, its backups). */
	async deleteForever(d: DeletedWorld, o: { backups: boolean }): Promise<void> {
		if (!d.dir.startsWith(`${this.root}/`)) throw new Error('That isn’t a deleted world.');
		if (this.db.adapter.rmdir) await this.db.adapter.rmdir(d.dir, true);
		else for (const p of await listFilesDeep(this.db.adapter, d.dir)) await this.db.adapter.remove(p);
		if (o.backups && !this.db.manifest.get()?.worlds.some((w) => w.id === d.worldId)) {
			const dir = this.db.paths.backupsDir(d.worldId);
			if ((await this.db.adapter.exists(dir)) && this.db.adapter.rmdir) await this.db.adapter.rmdir(dir, true);
		}
	}
}
