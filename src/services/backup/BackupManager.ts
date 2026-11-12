import { Notice, type App } from 'obsidian';
import { uuid } from '../../core/util/ids';
import { listZip, readZipEntry, sha256Hex } from '../../core/util/zip';
import type { Database } from '../../data/Database';
import { joinPath } from '../../data/storage/StorageAdapter';
import type { BackupSettings } from '../../settings/settings';
import type { NativeNoteService } from '../notes/NativeNoteService';
import { ARCHIVE_EXT, type ArchiveCounts, type ArchiveManifest, type Placement } from '../transfer/archive';
import type { ImportCheck, ImportReport, Progress, WorldArchiveService } from '../transfer/worldArchive';
import type { WorldService } from '../WorldService';
import { planRetention, writeProblem, type BackupKind, type RetentionLimits } from './retention';

export { writeProblem } from './retention';

export type { BackupKind } from './retention';

/**
 * Backups & recovery (0.20). A backup is a world archive (the verified `.worldsmith.zip` of
 * 0.19) kept in `<data>/backups/<worldId>/`, listed in an `index.json` there.
 *
 * Creating: pending changes are saved and checked, the archive is built, written under a
 * `.partial` name, read back and verified (every checksum), and only then given its real name
 * and listed. Older backups are pruned only after that, never the newest verified one.
 * Automatic backups hold the world's data and all linked notes (images too if chosen) and are
 * skipped when nothing changed; manual and safety backups hold images too.
 *
 * Restoring: as a new world (the 0.19 import), or in place of the current world: a verified
 * safety backup of the current state is made first, the backup's data is staged and checked,
 * the world's folder is swapped for it in two renames recorded in a journal, notes and images
 * that are missing come back, notes that changed since keep your version (the backup's lands
 * beside it), and the world is reopened and checked. A failure puts the world back; a crash is
 * found by its journal.
 */

export interface BackupEntry {
	file: string;
	createdAt: number;
	kind: BackupKind;
	size: number;
	sha256: string;
	verified: 'ok' | 'failed' | 'unchecked';
	verifiedAt: number | null;
	problem?: string;
	worldName: string;
	counts: ArchiveCounts;
	images: boolean;
	missing: number;
	excluded: number;
	fingerprint: string;
}

interface BackupIndex {
	format: 'worldsmith/backup-index';
	v: 1;
	worldId: string;
	entries: BackupEntry[];
}

export interface RestoreJournal {
	format: 'worldsmith/restore-journal';
	v: 1;
	id: string;
	worldId: string;
	worldName: string;
	phase: 'staging' | 'swapping' | 'swapped';
	startedAt: number;
	backupFile: string;
	safetyFile: string | null;
	worldDir: string;
	stagingDir: string;
	replacedDir: string;
	created: Array<{ path: string; sha256: string }>;
}

export interface ReplacePreview {
	ok: boolean;
	problem?: string;
	manifest: ArchiveManifest | null;
	entries: { backup: number; now: number; onlyNow: string[]; onlyBackup: string[]; changed: number };
	notes: { same: number; missing: string[]; changed: string[] };
	images: { same: number; missing: string[]; changed: string[] };
}

export interface ReplaceReport {
	ok: boolean;
	safetyFile: string;
	restoredFiles: number;
	beside: Array<{ path: string; besideOf: string }>;
	keptImages: string[];
	checks: ImportCheck[];
}

export interface BackupStatus {
	running: boolean;
	lastError: string | null;
	lastErrorAt: number | null;
}

function bytesOf(buf: ArrayBuffer | Uint8Array): Uint8Array {
	return buf instanceof Uint8Array ? buf : new Uint8Array(buf);
}

function abuf(b: Uint8Array): ArrayBuffer {
	return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

const stamp = (t: number) => new Date(t).toISOString().replace(/[:.]/g, '-');

export class BackupManager {
	private lock: Promise<unknown> = Promise.resolve();
	private busy = false;
	private timer: number | null = null;
	private lastAttempt = 0;
	/** A failing streak was already shown in a notice. */
	private told = false;
	readonly status: BackupStatus = { running: false, lastError: null, lastErrorAt: null };
	private listeners = new Set<() => void>();

	constructor(
		private readonly app: App,
		private readonly db: Database,
		private readonly worlds: WorldService,
		private readonly archives: WorldArchiveService,
		private readonly nativeNotes: NativeNoteService,
		private readonly settings: () => BackupSettings,
	) {}

	onChange(fn: () => void): () => void {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}
	private changed(): void {
		for (const fn of this.listeners) fn();
	}

	private get fs() {
		return this.app.vault.adapter as unknown as {
			exists(p: string): Promise<boolean>;
			readBinary(p: string): Promise<ArrayBuffer>;
			writeBinary(p: string, d: ArrayBuffer): Promise<void>;
			remove(p: string): Promise<void>;
			rename(a: string, b: string): Promise<void>;
			mkdir(p: string): Promise<void>;
			rmdir(p: string, recursive: boolean): Promise<void>;
			list(p: string): Promise<{ files: string[]; folders: string[] }>;
			stat?(p: string): Promise<{ size: number; mtime: number } | null>;
		};
	}

	dir(worldId: string): string {
		return this.db.paths.backupsDir(worldId);
	}
	private indexPath(worldId: string): string {
		return joinPath(this.dir(worldId), 'index.json');
	}
	private restoresDir(): string {
		return joinPath(this.db.root, 'restores');
	}

	/** One operation at a time (backups, restores): a second waits for the first. */
	private exclusive<T>(fn: () => Promise<T>): Promise<T> {
		const run = this.lock.then(async () => {
			this.busy = true;
			this.status.running = true;
			this.changed();
			try {
				return await fn();
			} finally {
				this.busy = false;
				this.status.running = false;
				this.changed();
			}
		});
		this.lock = run.catch(() => undefined);
		return run;
	}

	get isBusy(): boolean {
		return this.busy;
	}

	// ── the list ───────────────────────────────────────────────────────────

	/** The world's backups, newest first. The index is rebuilt from the files if it's missing or out of step. */
	async list(worldId: string): Promise<BackupEntry[]> {
		const dir = this.dir(worldId);
		const res = await this.db.files.read<BackupIndex>(this.indexPath(worldId));
		let entries = res.value?.format === 'worldsmith/backup-index' && Array.isArray(res.value.entries) ? res.value.entries : [];
		const onDisk = (await this.fs.exists(dir)) ? (await this.fs.list(dir)).files.map((p) => p.split('/').pop()!).filter((n) => n.endsWith(ARCHIVE_EXT)) : [];
		const known = new Set(entries.map((e) => e.file));
		let dirty = entries.some((e) => !onDisk.includes(e.file));
		entries = entries.filter((e) => onDisk.includes(e.file));
		for (const name of onDisk) {
			if (known.has(name)) continue;
			const e = await this.entryFromFile(joinPath(dir, name), name).catch(() => null);
			if (e) {
				entries.push(e);
				dirty = true;
			}
		}
		entries.sort((a, b) => b.createdAt - a.createdAt);
		if (dirty) await this.saveIndex(worldId, entries);
		return entries;
	}

	private async entryFromFile(path: string, name: string): Promise<BackupEntry> {
		const bytes = bytesOf(await this.fs.readBinary(path));
		const toc = listZip(bytes).find((e) => e.path === 'manifest.json');
		if (!toc) throw new Error('no manifest');
		const m = JSON.parse(new TextDecoder().decode(await readZipEntry(bytes, toc))) as ArchiveManifest;
		return this.entryOf(name, m, bytes.length, await sha256Hex(bytes), 'unchecked');
	}

	private entryOf(file: string, m: ArchiveManifest, size: number, sha: string, verified: BackupEntry['verified']): BackupEntry {
		const kind = (m.purpose?.kind ?? 'manual') as BackupKind;
		return {
			file,
			createdAt: m.createdAt,
			kind,
			size,
			sha256: sha,
			verified,
			verifiedAt: verified === 'ok' ? Date.now() : null,
			worldName: m.world.name,
			counts: m.counts,
			images: !m.excluded.some((d) => d.reason === 'not-chosen' && !/\.md$/i.test(d.vaultPath)),
			missing: m.missing.length,
			excluded: m.excluded.length,
			fingerprint: m.fingerprint ?? '',
		};
	}

	private indexWrites: Promise<unknown> = Promise.resolve();

	/** Index writes go one at a time (the page may list while a backup is being made). */
	private saveIndex(worldId: string, entries: BackupEntry[]): Promise<void> {
		const run = this.indexWrites.then(() => this.db.files.write(this.indexPath(worldId), { format: 'worldsmith/backup-index', v: 1, worldId, entries } satisfies BackupIndex));
		this.indexWrites = run.catch(() => undefined);
		return run;
	}

	/** Disk space all of a world's backups take. */
	totalSize(entries: BackupEntry[]): number {
		return entries.reduce((n, e) => n + e.size, 0);
	}

	// ── creating ───────────────────────────────────────────────────────────

	/** Make a backup of the open world. Automatic ones are skipped (null) when nothing changed. */
	create(kind: BackupKind, o: { force?: boolean; progress?: Progress } = {}): Promise<BackupEntry | null> {
		return this.exclusive(() => this.createNow(kind, o));
	}

	private async createNow(kind: BackupKind, o: { force?: boolean; progress?: Progress } = {}): Promise<BackupEntry | null> {
		const s = this.worlds.session;
		if (!s) throw new Error('No world is open.');
		const worldId = s.worldId;
		const set = this.settings();
		const includeMedia = kind !== 'auto' || set.autoImages;
		let built: { bytes: Uint8Array; manifest: ArchiveManifest };
		try {
			built = await this.archives.build({ adopted: true, extra: true, scenes: true }, { includeMedia, purpose: { kind } }, o.progress);
		} catch (e) {
			throw this.fail(e, 'The backup couldn’t be made');
		}
		const list = await this.list(worldId);
		if (kind === 'auto' && !o.force) {
			const last = list.find((e) => e.kind === 'auto' || e.kind === 'manual');
			if (last && last.fingerprint && last.fingerprint === built.manifest.fingerprint && last.verified !== 'failed') return null;
		}
		const dir = this.dir(worldId);
		const name = `${stamp(built.manifest.createdAt)}-${kind}${ARCHIVE_EXT}`;
		const final = joinPath(dir, name);
		const partial = `${final}.partial`;
		o.progress?.('Saving the backup', 0, 1);
		try {
			await this.db.files.ensureDir(dir);
			await this.fs.writeBinary(partial, abuf(built.bytes));
			o.progress?.('Checking the backup', 0, 1);
			const back = bytesOf(await this.fs.readBinary(partial));
			const v = await this.archives.verifyBytes(back, built.manifest);
			if (!v.ok) throw new Error(`it didn’t read back correctly (${v.problem})`);
			if (await this.fs.exists(final)) throw new Error('a backup with the same time already exists');
			await this.fs.rename(partial, final);
		} catch (e) {
			await this.fs.remove(partial).catch(() => undefined);
			throw this.fail(e, 'The backup couldn’t be saved');
		}
		const entry = this.entryOf(name, built.manifest, built.bytes.length, await sha256Hex(built.bytes), 'ok');
		const entries = [entry, ...list];
		await this.saveIndex(worldId, entries);
		await this.prune(worldId, entries, entry.file);
		this.status.lastError = null;
		this.status.lastErrorAt = null;
		this.changed();
		return entry;
	}

	private fail(e: unknown, what: string): Error {
		const why = writeProblem(e);
		this.status.lastError = `${what}: ${why}`;
		this.status.lastErrorAt = Date.now();
		this.changed();
		return new Error(`${what}. ${why} Your older backups were kept.`);
	}

	limits(): RetentionLimits {
		const s = this.settings();
		return { auto: s.keepAuto, manual: s.keepManual, safety: 5 };
	}

	/** Delete backups beyond the limits, never the one just made or the newest verified one. */
	private async prune(worldId: string, entries: BackupEntry[], justMade: string): Promise<void> {
		const drop = planRetention(entries, this.limits(), justMade);
		if (!drop.length) return;
		const kept: BackupEntry[] = [];
		for (const e of entries) {
			if (!drop.includes(e.file)) {
				kept.push(e);
				continue;
			}
			try {
				await this.fs.remove(joinPath(this.dir(worldId), e.file));
			} catch {
				kept.push(e);
			}
		}
		await this.saveIndex(worldId, kept);
	}

	// ── checking, deleting, copying ────────────────────────────────────────

	async read(worldId: string, e: BackupEntry): Promise<Uint8Array> {
		return bytesOf(await this.fs.readBinary(joinPath(this.dir(worldId), e.file)));
	}

	/** Read a backup again and check every file in it. */
	verify(worldId: string, e: BackupEntry): Promise<BackupEntry> {
		return this.exclusive(async () => {
			let verified: BackupEntry['verified'] = 'ok';
			let problem: string | undefined;
			try {
				const bytes = await this.read(worldId, e);
				const r = await this.archives.inspect(bytes);
				if (!r.ok) {
					verified = 'failed';
					problem = r.problems[0];
				} else if ((await sha256Hex(bytes)) !== e.sha256) {
					verified = 'failed';
					problem = 'The file changed since it was made.';
				}
			} catch (err) {
				verified = 'failed';
				problem = `It couldn’t be read (${err instanceof Error ? err.message : String(err)}).`;
			}
			const list = await this.list(worldId);
			const next = list.map((x) => (x.file === e.file ? { ...x, verified, verifiedAt: Date.now(), problem } : x));
			await this.saveIndex(worldId, next);
			this.changed();
			return next.find((x) => x.file === e.file)!;
		});
	}

	/** Delete one backup file (never the world). */
	remove(worldId: string, e: BackupEntry): Promise<void> {
		return this.exclusive(async () => {
			if (!e.file.endsWith(ARCHIVE_EXT) || e.file.includes('/')) throw new Error('Not a backup file.');
			const p = joinPath(this.dir(worldId), e.file);
			if (await this.fs.exists(p)) await this.fs.remove(p);
			await this.saveIndex(worldId, (await this.list(worldId)).filter((x) => x.file !== e.file));
			this.changed();
		});
	}

	/** Copy a backup into a vault folder (it's a world archive: importable anywhere). */
	async exportCopy(worldId: string, e: BackupEntry, folder: string): Promise<string> {
		const bytes = await this.read(worldId, e);
		const base = `${e.worldName} backup ${new Date(e.createdAt).toISOString().slice(0, 10)}`.replace(/[\\/:*?"<>|#^[\]]/g, '-');
		const vault = this.app.vault;
		const parts = folder.split('/').filter(Boolean);
		for (let n = 1; n <= parts.length; n++) {
			const p = parts.slice(0, n).join('/');
			if (!vault.getAbstractFileByPath(p) && !(await vault.adapter.exists(p))) await vault.createFolder(p).catch(() => undefined);
		}
		for (let n = 1; n < 1000; n++) {
			const path = joinPath(folder, `${base}${n > 1 ? ` ${n}` : ''}${ARCHIVE_EXT}`);
			if (vault.getAbstractFileByPath(path) || (await vault.adapter.exists(path))) continue;
			await vault.createBinary(path, abuf(bytes));
			const back = vault.getFileByPath(path);
			const sha = back ? await sha256Hex(bytesOf(await vault.readBinary(back))) : null;
			if (sha !== e.sha256) throw new Error('The copy didn’t read back correctly.');
			return path;
		}
		throw new Error('Couldn’t find a free name for the copy.');
	}

	// ── restoring ──────────────────────────────────────────────────────────

	/** Restore as a new world beside the current ones (a copy when this world is here). */
	restoreAsNew(worldId: string, e: BackupEntry, progress?: Progress): Promise<ImportReport> {
		return this.exclusive(async () => {
			const bytes = await this.read(worldId, e);
			return this.archives.import(bytes, { asCopy: true, archiveName: e.file }, progress);
		});
	}

	/** What replacing the current world with this backup would change. Writes nothing. */
	async previewReplace(worldId: string, e: BackupEntry): Promise<ReplacePreview> {
		const out: ReplacePreview = { ok: false, manifest: null, entries: { backup: 0, now: 0, onlyNow: [], onlyBackup: [], changed: 0 }, notes: { same: 0, missing: [], changed: [] }, images: { same: 0, missing: [], changed: [] } };
		const s = this.worlds.session;
		if (!s || s.worldId !== worldId) return { ...out, problem: 'Open the world this backup belongs to first.' };
		const r = await this.archives.inspect(await this.read(worldId, e));
		if (!r.ok || !r.manifest) return { ...out, problem: r.problems[0] ?? 'The backup can’t be read.' };
		if (r.manifest.world.id !== worldId) return { ...out, problem: 'This backup belongs to another world. Restore it as a new world instead.' };
		out.manifest = r.manifest;
		const backupEntities = new Map<string, { name: string; rev: number }>();
		for (const [k, v] of Object.entries(r.data)) {
			if (!k.startsWith('entities/')) continue;
			const recs = Array.isArray((v as { records?: unknown[] })?.records) ? (v as { records: Array<{ id: string; name: string; rev: number }> }).records : [v as { id: string; name: string; rev: number }];
			for (const x of recs) if (x?.id) backupEntities.set(x.id, { name: x.name, rev: x.rev });
		}
		out.entries.backup = backupEntities.size;
		out.entries.now = s.entities.size;
		for (const cur of s.entities.values()) {
			const b = backupEntities.get(cur.id);
			if (!b) out.entries.onlyNow.push(cur.name);
			else if (b.rev !== cur.rev) out.entries.changed++;
		}
		for (const [id, b] of backupEntities) if (!s.entities.get(id)) out.entries.onlyBackup.push(b.name);
		for (const f of r.manifest.files) {
			if (f.kind === 'data') continue;
			const p = f.path.slice(6);
			const tf = this.app.vault.getFileByPath(p);
			const bucket = f.kind === 'note' ? out.notes : out.images;
			if (!tf) bucket.missing.push(p);
			else if ((await sha256Hex(bytesOf(await this.app.vault.readBinary(tf)))) === f.sha256) bucket.same++;
			else bucket.changed.push(p);
		}
		out.ok = true;
		return out;
	}

	/**
	 * Replace the open world with a backup of it. Makes a verified safety backup first, stages
	 * and checks the data, swaps the world folder (journalled), brings back missing notes and
	 * images without overwriting any, reopens and checks. Any failure puts the world back.
	 */
	replace(worldId: string, e: BackupEntry, progress: Progress = () => {}): Promise<ReplaceReport> {
		return this.exclusive(async () => {
			const s = this.worlds.session;
			if (!s || s.worldId !== worldId) throw new Error('Open the world this backup belongs to first.');
			progress('Checking the backup', 0, 1);
			const r = await this.archives.inspect(await this.read(worldId, e));
			if (!r.ok || !r.manifest) throw new Error(`The backup can’t be restored: ${r.problems[0] ?? 'it can’t be read'}. Nothing was changed.`);
			if (r.manifest.world.id !== worldId) throw new Error('This backup belongs to another world. Restore it as a new world instead.');

			progress('Making a safety backup of the world as it is now', 0, 1);
			const safety = await this.createNow('before-restore', { force: true });
			if (!safety) throw new Error('The safety backup couldn’t be made, so nothing was changed.');

			const id = uuid();
			const worldDir = this.db.paths.worldDir(worldId);
			const j: RestoreJournal = {
				format: 'worldsmith/restore-journal',
				v: 1,
				id,
				worldId,
				worldName: s.world.name,
				phase: 'staging',
				startedAt: Date.now(),
				backupFile: e.file,
				safetyFile: safety.file,
				worldDir,
				stagingDir: joinPath(this.restoresDir(), `staging-${id}`),
				replacedDir: joinPath(this.restoresDir(), `before-${id}`),
				created: [],
			};
			const jPath = joinPath(this.restoresDir(), `${id}.json`);
			const save = () => this.db.files.write(jPath, j);
			await save();

			// 1. Stage the backup's data and read it back.
			try {
				const entries = Object.entries(r.data);
				let n = 0;
				for (const [rel, value] of entries) {
					progress('Preparing the restored data', n++, entries.length);
					await this.db.files.write(joinPath(j.stagingDir, rel), value);
				}
				for (const [rel, value] of entries) {
					const back = await this.db.files.read<unknown>(joinPath(j.stagingDir, rel));
					if (JSON.stringify(back.value) !== JSON.stringify(value)) throw new Error(`“${rel}” didn’t read back correctly`);
				}
			} catch (err) {
				await this.fs.rmdir(j.stagingDir, true).catch(() => undefined);
				await this.fs.remove(jPath).catch(() => undefined);
				throw new Error(`The restore was stopped before anything changed: ${writeProblem(err)} The safety backup was kept.`);
			}

			// 2. Swap the world's folder (notes held so nothing writes the old state back).
			this.nativeNotes.pause(true);
			const report: ReplaceReport = { ok: false, safetyFile: safety.file, restoredFiles: 0, beside: [], keptImages: [], checks: [] };
			try {
				await this.nativeNotes.idle();
				await this.db.flushAllStrict();
				progress('Swapping in the restored data', 0, 1);
				j.phase = 'swapping';
				await save();
				await this.fs.rename(worldDir, j.replacedDir);
				j.phase = 'swapped';
				await save();
				await this.fs.rename(j.stagingDir, worldDir);

				// 3. Notes and images: bring back what's missing; never overwrite.
				const day = new Date(e.createdAt).toISOString().slice(0, 10);
				const toWrite = r.manifest.files.filter((f) => f.kind !== 'data');
				let n = 0;
				for (const f of toWrite) {
					progress('Bringing back notes and images', n++, toWrite.length);
					const p = f.path.slice(6);
					const data = r.contents.get(f.path)!;
					const tf = this.app.vault.getFileByPath(p);
					if (tf) {
						const now = await sha256Hex(bytesOf(await this.app.vault.readBinary(tf)));
						if (now === f.sha256) continue;
						if (f.kind !== 'note') {
							report.keptImages.push(p);
							continue;
						}
						// A note edited since: yours stays, the backup's version goes beside it.
						const dot = p.lastIndexOf('.');
						let target = '';
						for (let i = 1; i < 100 && !target; i++) {
							const cand = `${p.slice(0, dot)} (from backup ${day}${i > 1 ? ` ${i}` : ''})${p.slice(dot)}`;
							if (!this.app.vault.getAbstractFileByPath(cand) && !(await this.app.vault.adapter.exists(cand))) target = cand;
						}
						await this.app.vault.create(target, new TextDecoder().decode(data));
						j.created.push({ path: target, sha256: f.sha256 });
						report.beside.push({ path: target, besideOf: p });
					} else {
						const folder = p.split('/').slice(0, -1).join('/');
						if (folder && !this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder).catch(() => undefined);
						if (f.kind === 'note') await this.app.vault.create(p, new TextDecoder().decode(data));
						else await this.app.vault.createBinary(p, abuf(data));
						j.created.push({ path: p, sha256: f.sha256 });
						report.restoredFiles++;
					}
					if (j.created.length % 20 === 0) await save();
				}
				await save();

				// 4. Reopen and check.
				progress('Opening the restored world', 0, 1);
				await this.worlds.reload({ discard: true });
				const placements: Placement[] = r.manifest.files.filter((f) => f.kind !== 'data').map((f) => ({ from: f.path.slice(6), to: f.path.slice(6), kind: f.kind as Placement['kind'], action: 'write', sha256: f.sha256 }));
				report.checks = await this.archives.verifyImported(worldId, r.data, r.manifest, placements);
				report.ok = report.checks.every((c) => c.ok);
				if (!report.checks[0]?.ok) throw new Error('the restored world didn’t open');
			} catch (err) {
				progress('Putting the world back as it was', 0, 1);
				await this.revert(j).catch(() => undefined);
				await this.worlds.reload({ discard: true }).catch(() => undefined);
				this.nativeNotes.pause(false);
				throw new Error(`The restore was stopped and the world was put back as it was: ${writeProblem(err)} A safety backup of it is in the list.`);
			}
			this.nativeNotes.pause(false);
			// Done: the old folder is in the safety backup; tidy up.
			await this.fs.rmdir(j.replacedDir, true).catch(() => undefined);
			await this.fs.remove(jPath).catch(() => undefined);
			this.changed();
			return report;
		});
	}

	/** Undo a restore's swap: the world's own folder back in place, files it added removed if unchanged. */
	private async revert(j: RestoreJournal): Promise<string[]> {
		const kept: string[] = [];
		for (const c of [...j.created].reverse()) {
			const f = this.app.vault.getFileByPath(c.path);
			if (!f) continue;
			const now = await sha256Hex(bytesOf(await this.app.vault.readBinary(f))).catch(() => '');
			if (now === c.sha256) await this.app.fileManager.trashFile(f).catch(() => kept.push(c.path));
			else kept.push(c.path);
		}
		if (j.phase !== 'staging' && (await this.fs.exists(j.replacedDir))) {
			if (await this.fs.exists(j.worldDir)) {
				const aside = joinPath(this.restoresDir(), `restored-${j.id}`);
				await this.fs.rename(j.worldDir, aside);
				await this.fs.rename(j.replacedDir, j.worldDir);
				await this.fs.rmdir(aside, true).catch(() => undefined);
			} else await this.fs.rename(j.replacedDir, j.worldDir);
		}
		if (await this.fs.exists(j.stagingDir)) await this.fs.rmdir(j.stagingDir, true).catch(() => undefined);
		await this.fs.remove(joinPath(this.restoresDir(), `${j.id}.json`)).catch(() => undefined);
		return kept;
	}

	/**
	 * Restore an older JSON backup (before 0.20) over the open world, as before, but with a
	 * verified safety backup of the current state first. Native notes changed since keep your
	 * version (the backup's is saved beside as “(restored)”).
	 */
	restoreLegacy(path: string, progress: Progress = () => {}): Promise<{ safetyFile: string; notesMoved: number }> {
		return this.exclusive(async () => {
			progress('Making a safety backup of the world as it is now', 0, 1);
			const safety = await this.createNow('before-restore', { force: true });
			if (!safety) throw new Error('The safety backup couldn’t be made, so nothing was changed.');
			progress('Restoring', 0, 1);
			this.nativeNotes.pause(true);
			try {
				await this.nativeNotes.idle();
				await this.db.flushAllStrict();
				const res = await this.db.backups.restore(path);
				await this.worlds.reload({ discard: true });
				return { safetyFile: safety.file, notesMoved: res.notes.moved };
			} finally {
				this.nativeNotes.pause(false);
			}
		});
	}

	/** An older JSON backup as a new world beside this one. */
	restoreLegacyAsNew(path: string): Promise<string> {
		return this.exclusive(async () => {
			const res = await this.db.files.read<import('../../data/backup/BackupService').WorldBackup>(path);
			if (!res.value) throw new Error('That backup can’t be read.');
			return this.worlds.importBundle(res.value, { asCopy: true });
		});
	}

	// ── after a crash ──────────────────────────────────────────────────────

	/** Restores that didn't finish (Obsidian closed mid-restore). None while one is running. */
	async interruptedRestores(): Promise<RestoreJournal[]> {
		if (this.busy) return [];
		const dir = this.restoresDir();
		if (!(await this.fs.exists(dir))) return [];
		const out: RestoreJournal[] = [];
		for (const p of (await this.fs.list(dir)).files) {
			if (!p.endsWith('.json')) continue;
			const j = (await this.db.files.read<RestoreJournal>(p)).value;
			if (j?.format === 'worldsmith/restore-journal') out.push(j);
		}
		return out;
	}

	/**
	 * Before any world opens: a restore cut short mid-swap may have left the world without its
	 * folder. Putting the original folder back is always safe (nothing is lost), so that one
	 * case is fixed right away; every other case waits for the person on the Backups page.
	 */
	async recoverEarly(): Promise<string[]> {
		const notes: string[] = [];
		for (const j of await this.interruptedRestores().catch(() => [] as RestoreJournal[])) {
			if (j.phase === 'staging') {
				// Nothing was changed yet: remove the half-made copy.
				if (await this.fs.exists(j.stagingDir)) await this.fs.rmdir(j.stagingDir, true).catch(() => undefined);
				await this.fs.remove(joinPath(this.restoresDir(), `${j.id}.json`)).catch(() => undefined);
				notes.push(`A restore of “${j.worldName}” was interrupted before it changed anything; it was cleaned up.`);
			} else if (!(await this.fs.exists(j.worldDir)) && (await this.fs.exists(j.replacedDir))) {
				await this.fs.rename(j.replacedDir, j.worldDir);
				j.phase = 'staging';
				await this.db.files.write(joinPath(this.restoresDir(), `${j.id}.json`), j);
				notes.push(`A restore of “${j.worldName}” was interrupted; the world was put back as it was. See Backups & recovery.`);
			}
		}
		return notes;
	}

	/** Put the world back as it was before an interrupted restore. Returns files kept (changed since). */
	async undoInterruptedRestore(j: RestoreJournal): Promise<string[]> {
		return this.exclusive(async () => {
			this.nativeNotes.pause(true);
			try {
				const kept = await this.revert(j);
				if (this.worlds.session?.worldId === j.worldId) await this.worlds.reload({ discard: true });
				return kept;
			} finally {
				this.nativeNotes.pause(false);
			}
		});
	}

	/** Keep the result of an interrupted restore as it is (the safety backup stays in the list). */
	async keepInterruptedRestore(j: RestoreJournal): Promise<void> {
		return this.exclusive(async () => {
			if (await this.fs.exists(j.stagingDir)) await this.fs.rmdir(j.stagingDir, true).catch(() => undefined);
			if (await this.fs.exists(j.replacedDir)) await this.fs.rmdir(j.replacedDir, true).catch(() => undefined);
			await this.fs.remove(joinPath(this.restoresDir(), `${j.id}.json`)).catch(() => undefined);
		});
	}

	/** Damaged files Worldsmith set aside when it couldn't read them. */
	async quarantined(): Promise<string[]> {
		const dir = this.db.paths.quarantine;
		if (!(await this.fs.exists(dir))) return [];
		return (await this.fs.list(dir)).files.sort().reverse();
	}

	// ── schedule ───────────────────────────────────────────────────────────

	/** Check every minute whether an automatic backup is due. */
	start(register: (id: number) => void): void {
		if (this.timer !== null) return;
		this.timer = window.setInterval(() => void this.tick(), 60_000);
		register(this.timer);
	}

	stop(): void {
		if (this.timer !== null) window.clearInterval(this.timer);
		this.timer = null;
	}

	/** Make an automatic backup if one is due (and something changed). Public for tests. */
	async tick(now = Date.now()): Promise<'off' | 'busy' | 'not-due' | 'skipped' | 'made' | 'failed'> {
		const set = this.settings();
		const s = this.worlds.session;
		if (!set.auto || !s) return 'off';
		if (this.busy) return 'busy';
		const every = set.intervalMinutes * 60_000;
		if (now - this.lastAttempt < every) return 'not-due';
		const last = (await this.list(s.worldId)).find((e) => e.kind === 'auto' || e.kind === 'manual');
		if (last && now - last.createdAt < every) return 'not-due';
		this.lastAttempt = now;
		try {
			const made = await this.create('auto');
			this.told = false;
			return made ? 'made' : 'skipped';
		} catch (e) {
			// Shown once per failing streak; the Backups page keeps showing it until a backup works.
			if (!this.told) new Notice(`Worldsmith: the automatic backup failed. ${e instanceof Error ? e.message : String(e)}`, 12000);
			this.told = true;
			return 'failed';
		}
	}
}
