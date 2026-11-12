import { TFile, type App } from 'obsidian';
import { RECORD_VERSIONS, STORAGE_VERSION } from '../../app/constants';
import type { EntityRecord } from '../../core/types';
import { uuid } from '../../core/util/ids';
import { sha256Hex, zip } from '../../core/util/zip';
import type { Database } from '../../data/Database';
import { rewriteWorldKey } from '../../data/backup/backupNotes';
import type { WorldBackup } from '../../data/backup/BackupService';
import { joinPath, listFilesDeep } from '../../data/storage/StorageAdapter';
import { ROLE_LABELS } from '../MediaRefs';
import { copyBundle, type WorldService } from '../WorldService';
import type { WorldSession } from '../WorldSession';
import {
	ARCHIVE_EXT,
	buildArchive,
	inspectArchive,
	planPlacements,
	remapPaths,
	rewriteLinks,
	unsafeVaultPath,
	type ArchiveDependency,
	type ArchiveFileKind,
	type ArchiveManifest,
	type ArchiveNote,
	type ArchiveNoteRole,
	type InspectResult,
	type Placement,
} from './archive';

/**
 * Complete world archives (0.19): export, verify and import `.worldsmith.zip` files.
 *
 * Export: everything pending is saved first and checked (`flushAllStrict`); the world folder's
 * files are read as they are on disk (a file that can't be read stops the export); notes,
 * images and attachments are read byte for byte; the archive is written to a new file and
 * then read back and verified before success is reported.
 *
 * Import: the archive is inspected (nothing written), the world gets a folder that isn't
 * listed yet (invisible to Worldsmith), vault files are created only where nothing exists,
 * every write is recorded in a journal under `<data>/imports/`, everything written is read
 * back and compared, and only then is the world listed and opened, and checked again. Any
 * failure undoes exactly what this import created (files it wrote that are still unchanged),
 * and an import cut short (Obsidian closed) is found by its journal and can be undone later.
 */

export type ExportGroup = 'native' | 'adopted' | 'extra' | 'scene' | 'media' | 'attachment';

export interface ExportItem {
	vaultPath: string;
	group: ExportGroup;
	kind: Exclude<ArchiveFileKind, 'data'>;
	role?: ArchiveNoteRole;
	usedBy: string[];
	entityIds: string[];
	sceneIds: string[];
	/** The note whose embed brought this attachment in (attachments follow their note). */
	viaNotes: string[];
	size: number;
}

export interface ExportPlan {
	worldName: string;
	items: ExportItem[];
	missing: ArchiveDependency[];
	remote: ArchiveDependency[];
	counts: { entries: number; types: number; relations: number; tasks: number; maps: number; projects: number; scenes: number };
}

export interface ExportChoices {
	adopted: boolean;
	extra: boolean;
	scenes: boolean;
}

export interface ExportReport {
	path: string;
	bytes: number;
	manifest: ArchiveManifest;
	verified: boolean;
}

export interface ImportCheck {
	label: string;
	ok: boolean;
	detail?: string;
}

export interface ImportReport {
	ok: boolean;
	worldId: string;
	worldName: string;
	asCopy: boolean;
	written: number;
	reused: number;
	moved: Array<{ from: string; to: string }>;
	checks: ImportCheck[];
	warnings: string[];
}

export interface ImportJournal {
	format: 'worldsmith/import-journal';
	v: 1;
	id: string;
	status: 'writing' | 'committed';
	startedAt: number;
	archiveName: string;
	worldId: string;
	worldName: string;
	worldDir: string;
	/** Vault files this import created, with what it wrote. */
	created: Array<{ path: string; sha256: string }>;
}

export type Progress = (stage: string, done: number, total: number) => void;

const NOTE_ROLE_ORDER: ArchiveNoteRole[] = ['native', 'adopted', 'scene', 'extra'];

function isRemote(p: string): boolean {
	return /^[a-z][a-z0-9+.-]*:\/\//i.test(p) || p.startsWith('data:');
}

function linkpathOf(link: string): string {
	return link.split('#')[0]!.split('|')[0]!.trim();
}

function bytesOf(buf: ArrayBuffer | Uint8Array): Uint8Array {
	return buf instanceof Uint8Array ? buf : new Uint8Array(buf);
}

export class WorldArchiveService {
	constructor(
		private readonly app: App,
		private readonly db: Database,
		private readonly worlds: WorldService,
		private readonly appVersion: () => string,
	) {}

	private get session(): WorldSession {
		const s = this.worlds.session;
		if (!s) throw new Error('No world is open.');
		return s;
	}

	private journalDir(): string {
		return joinPath(this.db.root, 'imports');
	}

	// ── what an export holds ───────────────────────────────────────────────

	/** Everything the open world needs from the vault, grouped, with what's missing. */
	async plan(): Promise<ExportPlan> {
		const s = this.session;
		const items = new Map<string, ExportItem>();
		const missing = new Map<string, ArchiveDependency>();
		const remote = new Map<string, ArchiveDependency>();
		const nameOf = (id?: string) => (id ? (s.entities.get(id)?.name ?? 'an entry') : '');
		const vault = this.app.vault;
		const note = (path: string, role: ArchiveNoteRole, label: string, entityId?: string, sceneId?: string) => {
			const f = vault.getFileByPath(path);
			if (!f) {
				const d = missing.get(path) ?? { vaultPath: path, reason: 'missing' as const, usedBy: [] };
				d.usedBy.push(label);
				missing.set(path, d);
				return;
			}
			const cur = items.get(path);
			const group = role as ExportGroup;
			if (!cur) items.set(path, { vaultPath: path, group, kind: 'note', role, usedBy: [label], entityIds: entityId ? [entityId] : [], sceneIds: sceneId ? [sceneId] : [], viaNotes: [], size: f.stat.size });
			else {
				if (NOTE_ROLE_ORDER.indexOf(role) < NOTE_ROLE_ORDER.indexOf(cur.role!)) {
					cur.role = role;
					cur.group = group;
				}
				cur.usedBy.push(label);
				if (entityId && !cur.entityIds.includes(entityId)) cur.entityIds.push(entityId);
				if (sceneId && !cur.sceneIds.includes(sceneId)) cur.sceneIds.push(sceneId);
			}
		};
		const entities = [...s.entities.values()];
		for (const e of entities) {
			if (e.nativeNote?.path) note(e.nativeNote.path, 'native', `${e.name} — native note`, e.id);
			if (e.linkedNote?.path && e.linkedNote.path !== e.nativeNote?.path) note(e.linkedNote.path, 'adopted', `${e.name} — note`, e.id);
			for (const n of e.moreNotes ?? []) note(n.path, 'extra', `${e.name} — ${n.label || 'other note'}`, e.id);
		}
		for (const item of s.stores.manuscript.all()) if (item.kind === 'scene' && item.notePath) note(item.notePath, 'scene', `Scene “${item.title}”`, undefined, item.id);

		// Images and files the world points at (trashed entries too: their data travels).
		for (const u of s.media.all(true)) {
			const label = `${u.entityId ? nameOf(u.entityId) : u.page?.startsWith('map:') ? `Map “${s.stores.maps.get(u.page.slice(4))?.name ?? 'map'}”` : 'World'} — ${ROLE_LABELS[u.role].toLowerCase()}`;
			if (isRemote(u.path)) {
				const d = remote.get(u.path) ?? { vaultPath: u.path, reason: 'remote' as const, usedBy: [] };
				d.usedBy.push(label);
				remote.set(u.path, d);
				continue;
			}
			const f = vault.getFileByPath(u.path);
			if (!f) {
				const d = missing.get(u.path) ?? { vaultPath: u.path, reason: 'missing' as const, usedBy: [] };
				d.usedBy.push(label);
				missing.set(u.path, d);
				continue;
			}
			const cur = items.get(u.path);
			// A note picked in a file field is one of the person's own notes: listed and
			// optional like other linked notes, never swept along unseen (0.20.2 privacy).
			const isNote = !u.image && f.extension === 'md';
			if (cur) {
				cur.usedBy.push(label);
				if (cur.kind !== 'note' && u.image) {
					cur.kind = 'media';
					cur.group = 'media';
				}
			} else if (isNote) items.set(u.path, { vaultPath: u.path, group: 'extra', kind: 'note', role: 'extra', usedBy: [label], entityIds: u.entityId ? [u.entityId] : [], sceneIds: [], viaNotes: [], size: f.stat.size });
			else items.set(u.path, { vaultPath: u.path, group: u.image ? 'media' : 'attachment', kind: u.image ? 'media' : 'attachment', usedBy: [label], entityIds: u.entityId ? [u.entityId] : [], sceneIds: [], viaNotes: [], size: f.stat.size });
		}

		// Files embedded in the notes (a picture in Ava.md travels with Ava.md).
		for (const it of [...items.values()].filter((i) => i.kind === 'note')) {
			const f = vault.getFileByPath(it.vaultPath);
			const cache = f ? this.app.metadataCache.getFileCache(f) : null;
			for (const em of cache?.embeds ?? []) {
				const dest = this.app.metadataCache.getFirstLinkpathDest(linkpathOf(em.link), it.vaultPath);
				if (!dest || dest.extension === 'md') continue;
				const cur = items.get(dest.path);
				if (cur) {
					if (!cur.viaNotes.includes(it.vaultPath)) cur.viaNotes.push(it.vaultPath);
				} else items.set(dest.path, { vaultPath: dest.path, group: 'attachment', kind: 'attachment', usedBy: [`Embedded in ${it.vaultPath}`], entityIds: [], sceneIds: [], viaNotes: [it.vaultPath], size: dest.stat.size });
			}
		}

		const c = s.stores;
		return {
			worldName: s.world.name,
			items: [...items.values()].sort((a, b) => a.vaultPath.localeCompare(b.vaultPath)),
			missing: [...missing.values()],
			remote: [...remote.values()],
			counts: {
				entries: entities.filter((e) => !e.trashedAt).length,
				types: s.schemas.list().length,
				relations: c.edges.size,
				tasks: c.tasks.size,
				maps: c.maps.size,
				projects: c.writingProjects.size,
				scenes: c.manuscript.all().filter((m) => m.kind === 'scene').length,
			},
		};
	}

	/** Is this item in the export, given the choices? Attachments follow the notes they're in. */
	static included(it: ExportItem, choices: ExportChoices, plan: ExportPlan): boolean {
		const noteOn = (g: ExportGroup) => g === 'native' || (g === 'adopted' && choices.adopted) || (g === 'extra' && choices.extra) || (g === 'scene' && choices.scenes);
		if (it.kind === 'note') return noteOn(it.group);
		// Used by the world directly (an image, a file field): always.
		if (it.usedBy.some((u) => !u.startsWith('Embedded in '))) return true;
		return it.viaNotes.some((p) => {
			const n = plan.items.find((x) => x.vaultPath === p);
			return !!n && noteOn(n.group);
		});
	}

	// ── export ─────────────────────────────────────────────────────────────

	/**
	 * Build an archive of the open world in memory (pending changes saved and checked first).
	 * `includeMedia: false` leaves images and attachments out (listed as left out): automatic
	 * backups (0.20). Exports and manual backups include them.
	 */
	async build(choices: ExportChoices, o: { includeMedia: boolean; purpose?: { kind: string } }, progress: Progress = () => {}): Promise<{ bytes: Uint8Array; manifest: ArchiveManifest }> {
		const s = this.session;
		progress('Saving your latest changes', 0, 1);
		await this.db.flushAllStrict();
		const plan = await this.plan();
		const worldDir = this.db.paths.worldDir(s.worldId);

		// World data, byte for byte as on disk.
		progress('Reading the world’s data', 0, 1);
		const data = new Map<string, Uint8Array>();
		const enc = new TextEncoder();
		for (const path of (await listFilesDeep(this.db.adapter, worldDir)).sort()) {
			const rel = path.slice(worldDir.length + 1);
			if (!rel.endsWith('.json') || rel.startsWith('note-migrations/')) continue;
			// Scene snapshots go into exports and manual backups, not automatic ones (size).
			if (!o.includeMedia && rel.startsWith('writing/snapshots/')) continue;
			let text: string;
			try {
				text = await this.db.adapter.read(path);
			} catch (e) {
				throw new Error(`“${rel}” couldn’t be read, so the export was stopped (${e instanceof Error ? e.message : String(e)}).`);
			}
			try {
				JSON.parse(text);
			} catch {
				throw new Error(`“${rel}” is damaged on disk, so the export was stopped. A backup from Settings can restore it.`);
			}
			data.set(rel, enc.encode(text));
		}
		if (!data.has('world.json')) throw new Error('The world’s world.json is missing on disk, so the export was stopped.');

		// Vault files.
		const included = plan.items.filter((it) => WorldArchiveService.included(it, choices, plan) && (o.includeMedia || it.kind === 'note'));
		const excluded: ArchiveDependency[] = [...plan.remote];
		for (const it of plan.items) if (!included.includes(it)) excluded.push({ vaultPath: it.vaultPath, reason: 'not-chosen', usedBy: it.usedBy });
		const vaultFiles = new Map<string, { data: Uint8Array; kind: Exclude<ArchiveFileKind, 'data'> }>();
		let i = 0;
		for (const it of included) {
			progress('Reading notes and images', i++, included.length);
			if (unsafeVaultPath(it.vaultPath, this.db.root)) {
				excluded.push({ vaultPath: it.vaultPath, reason: 'unsupported', usedBy: it.usedBy });
				continue;
			}
			const f = this.app.vault.getFileByPath(it.vaultPath);
			if (!f) throw new Error(`“${it.vaultPath}” disappeared while exporting. Nothing was written; try again.`);
			try {
				vaultFiles.set(it.vaultPath, { data: bytesOf(await this.app.vault.readBinary(f)), kind: it.kind });
			} catch (e) {
				throw new Error(`“${it.vaultPath}” couldn’t be read, so the export was stopped (${e instanceof Error ? e.message : String(e)}).`);
			}
		}

		// Links inside included notes to other included files (so an import can re-point them).
		const notes: ArchiveNote[] = [];
		for (const it of included) {
			if (it.kind !== 'note' || !vaultFiles.has(it.vaultPath)) continue;
			const f = this.app.vault.getFileByPath(it.vaultPath);
			const cache = f ? this.app.metadataCache.getFileCache(f) : null;
			const links = new Map<string, string>();
			for (const l of [...(cache?.links ?? []), ...(cache?.embeds ?? [])]) {
				const lp = linkpathOf(l.link);
				const dest = this.app.metadataCache.getFirstLinkpathDest(lp, it.vaultPath);
				if (dest && vaultFiles.has(dest.path) && lp) links.set(lp, dest.path);
			}
			notes.push({ vaultPath: it.vaultPath, role: it.role!, entityIds: it.entityIds, sceneIds: it.sceneIds, links: [...links].map(([link, target]) => ({ link, target })) });
		}

		progress('Packing the archive', 0, 1);
		const { manifest, entries } = await buildArchive({
			app: this.appVersion(),
			world: { id: s.worldId, name: s.world.name },
			schema: { storage: STORAGE_VERSION, records: { ...RECORD_VERSIONS } },
			data,
			vault: vaultFiles,
			notes,
			excluded,
			missing: plan.missing,
			purpose: o.purpose,
		});
		const bytes = await zip(entries, { onProgress: (d, t) => progress('Packing the archive', d, t) });
		return { bytes, manifest };
	}

	/** Do this archive's bytes read back as exactly this manifest? (Every checksum compared.) */
	async verifyBytes(bytes: Uint8Array | null, manifest: ArchiveManifest): Promise<{ ok: boolean; problem?: string }> {
		if (!bytes) return { ok: false, problem: 'The file couldn’t be read back.' };
		const check = await inspectArchive(bytes, this.inspectOptions());
		if (!check.ok) return { ok: false, problem: check.problems[0] };
		const same = check.manifest!.files.length === manifest.files.length && check.manifest!.files.every((f, n) => f.sha256 === manifest.files[n]!.sha256 && f.path === manifest.files[n]!.path);
		return same ? { ok: true } : { ok: false, problem: 'Its contents don’t match what was written.' };
	}

	/** Write the open world to `<folder>/<name> <date>.worldsmith.zip`, then read it back and verify it. */
	async export(folder: string, baseName: string, choices: ExportChoices, progress: Progress = () => {}): Promise<ExportReport> {
		const { bytes, manifest } = await this.build(choices, { includeMedia: true }, progress);
		progress('Saving the archive', 0, 1);
		const path = await this.writeNewBinary(folder, baseName, bytes);
		progress('Checking the saved archive', 0, 1);
		const back = this.app.vault.getFileByPath(path);
		const reread = back ? bytesOf(await this.app.vault.readBinary(back)) : null;
		const v = await this.verifyBytes(reread, manifest);
		if (!v.ok) {
			// The file is ours and broken: take it away rather than leave a bad archive around.
			if (back) await this.app.fileManager.trashFile(back).catch(() => undefined);
			throw new Error(`The archive was written but didn’t read back correctly, so it was removed. ${v.problem ?? ''}`.trim());
		}
		return { path, bytes: bytes.length, manifest, verified: true };
	}

	private async writeNewBinary(folder: string, base: string, bytes: Uint8Array): Promise<string> {
		const clean = base.replace(/[\\/:*?"<>|#^[\]]/g, '-').trim() || 'World';
		await this.ensureFolder(folder);
		for (let n = 1; n < 1000; n++) {
			const path = joinPath(folder, `${clean}${n > 1 ? ` ${n}` : ''}${ARCHIVE_EXT}`);
			if (this.app.vault.getAbstractFileByPath(path) || (await this.app.vault.adapter.exists(path))) continue;
			const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
			await this.app.vault.createBinary(path, buf);
			return path;
		}
		throw new Error('Couldn’t find a free name for the archive.');
	}

	private async ensureFolder(folder: string): Promise<void> {
		if (!folder) return;
		const parts = folder.split('/');
		for (let n = 1; n <= parts.length; n++) {
			const p = parts.slice(0, n).join('/');
			if (!this.app.vault.getAbstractFileByPath(p) && !(await this.app.vault.adapter.exists(p))) {
				try {
					await this.app.vault.createFolder(p);
				} catch (e) {
					if (!(await this.app.vault.adapter.exists(p))) throw e;
				}
			}
		}
	}

	// ── verify (no changes) ────────────────────────────────────────────────

	inspectOptions() {
		return { storageVersion: STORAGE_VERSION, records: { ...RECORD_VERSIONS } as Record<string, number>, dataFolder: this.db.root };
	}

	/** Check an archive without writing anything. */
	async inspect(bytes: Uint8Array): Promise<InspectResult & { exists: boolean }> {
		const r = await inspectArchive(bytes, this.inspectOptions());
		const id = r.manifest?.world?.id;
		const exists = !!id && (!!this.db.manifest.get()?.worlds.some((w) => w.id === id) || (await this.db.adapter.exists(this.db.paths.worldDir(id))));
		return { ...r, exists };
	}

	/** Which archive files would land beside an existing file (for the preview). */
	async preview(r: InspectResult, asCopy: boolean): Promise<{ placements: Placement[]; moved: Map<string, string> }> {
		const lookup = await this.lookup(r.manifest!.files.filter((f) => f.kind !== 'data').map((f) => ({ path: f.path.slice(6), kind: f.kind })));
		return planPlacements(r.manifest!.files, (p) => lookup.get(p) ?? { exists: false }, { suffix: asCopy ? 'copy' : 'imported' });
	}

	private async lookup(files: Array<{ path: string; kind: ArchiveFileKind }>): Promise<Map<string, { exists: boolean; sha256?: string | null }>> {
		const out = new Map<string, { exists: boolean; sha256?: string | null }>();
		const check = async (p: string, hash: boolean) => {
			const af = this.app.vault.getAbstractFileByPath(p);
			const exists = !!af || (await this.app.vault.adapter.exists(p));
			let sha256: string | null = null;
			if (exists && hash && af instanceof TFile) sha256 = await sha256Hex(bytesOf(await this.app.vault.readBinary(af)));
			out.set(p, { exists, sha256 });
		};
		for (const f of files) {
			await check(f.path, f.kind !== 'note');
			// Possible landing names for planPlacements' search.
			const dot = f.path.lastIndexOf('.');
			const base = f.path.slice(0, dot);
			const ext = f.path.slice(dot);
			for (const sfx of ['imported', 'copy']) for (let n = 1; n <= 5; n++) await check(`${base} (${sfx}${n > 1 ? ` ${n}` : ''})${ext}`, false);
		}
		return out;
	}

	// ── import ─────────────────────────────────────────────────────────────

	/**
	 * Import a checked archive as a new world (or as a copy when that world is already here).
	 * Never overwrites a file; undoes its own writes on failure; reports success only after the
	 * world is listed, opened and checked.
	 */
	async import(bytes: Uint8Array, o: { asCopy: boolean; archiveName: string }, progress: Progress = () => {}): Promise<ImportReport> {
		progress('Checking the archive', 0, 1);
		const r = await this.inspect(bytes);
		if (!r.ok) throw new Error(r.problems[0] ?? 'The archive can’t be imported.');
		const m = r.manifest!;
		if (r.exists && !o.asCopy) throw new Error('This world is already in your vault. Import it as a copy instead.');
		progress('Saving your latest changes', 0, 1);
		await this.db.flushAllStrict();

		const asCopy = r.exists;
		const worldId = asCopy ? uuid() : m.world.id;
		const worldDir = this.db.paths.worldDir(worldId);
		if (await this.db.adapter.exists(worldDir)) throw new Error('A folder for this world already exists. Nothing was imported.');

		// World data: copy (new id, “(copy)” name) if needed, then follow moved files.
		let bundle: WorldBackup = { format: 'worldsmith/backup', v: 1, createdAt: m.createdAt, worldId: m.world.id, reason: 'import', files: r.data };
		if (asCopy) bundle = copyBundle(bundle, worldId);
		const { placements, moved } = await this.preview(r, asCopy);
		const files = remapPaths(bundle.files, moved);
		const worldName = ((files['world.json'] as { name?: string }) ?? {}).name ?? m.world.name;

		const journal: ImportJournal = { format: 'worldsmith/import-journal', v: 1, id: uuid(), status: 'writing', startedAt: Date.now(), archiveName: o.archiveName, worldId, worldName, worldDir, created: [] };
		const journalPath = joinPath(this.journalDir(), `${journal.id}.json`);
		await this.db.files.write(journalPath, journal);
		const saveJournal = () => this.db.files.write(journalPath, journal);

		const report: ImportReport = { ok: false, worldId, worldName, asCopy, written: 0, reused: 0, moved: [...moved].map(([from, to]) => ({ from, to })), checks: [], warnings: [...r.warnings] };
		try {
			// 1. The world's folder (not listed yet, so nothing sees it).
			const dataEntries = Object.entries(files);
			let n = 0;
			for (const [rel, value] of dataEntries) {
				progress('Writing the world’s data', n++, dataEntries.length);
				await this.db.files.write(joinPath(worldDir, rel), value);
			}
			for (const [rel, value] of dataEntries) {
				const back = await this.db.files.read<unknown>(joinPath(worldDir, rel));
				if (JSON.stringify(back.value) !== JSON.stringify(value)) throw new Error(`“${rel}” didn’t read back correctly after writing.`);
			}

			// 2. Notes, images and attachments: only where nothing is.
			const contentOf = (p: Placement): Uint8Array => {
				const raw = r.contents.get(`vault/${p.from}`)!;
				if (p.kind === 'note' && asCopy) {
					const text = new TextDecoder().decode(raw);
					return new TextEncoder().encode(rewriteWorldKey(text, m.world.id, worldId));
				}
				return raw;
			};
			const toWrite = placements.filter((p) => p.action === 'write');
			n = 0;
			for (const p of toWrite) {
				progress('Writing notes and images', n++, toWrite.length);
				await this.ensureFolder(p.to.split('/').slice(0, -1).join('/'));
				if (this.app.vault.getAbstractFileByPath(p.to) || (await this.app.vault.adapter.exists(p.to))) throw new Error(`“${p.to}” appeared while importing; nothing was written over it.`);
				const data = contentOf(p);
				if (p.kind === 'note') await this.app.vault.create(p.to, new TextDecoder().decode(data));
				else await this.app.vault.createBinary(p.to, data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
				journal.created.push({ path: p.to, sha256: await sha256Hex(data) });
				if (journal.created.length % 25 === 0) await saveJournal();
			}
			await saveJournal();
			report.written = toWrite.length;
			report.reused = placements.length - toWrite.length;

			// 3. Links in imported notes that would now find the wrong file (or none).
			const where = new Map(placements.map((p) => [p.from, p.to]));
			for (const nt of m.notes) {
				const to = where.get(nt.vaultPath);
				const placed = placements.find((p) => p.from === nt.vaultPath);
				if (!to || placed?.action !== 'write') continue;
				const changes: Array<{ link: string; to: string }> = [];
				for (const l of nt.links) {
					const target = where.get(l.target);
					if (!target) continue;
					const resolved = this.app.metadataCache.getFirstLinkpathDest(l.link, to);
					if (resolved?.path === target) continue;
					changes.push({ link: l.link, to: target.endsWith('.md') ? target.slice(0, -3) : target });
				}
				if (!changes.length) continue;
				const f = this.app.vault.getFileByPath(to);
				if (!f) continue;
				const text = await this.app.vault.read(f);
				const next = rewriteLinks(text, changes);
				if (next === text) continue;
				await this.app.vault.modify(f, next);
				const j = journal.created.find((c) => c.path === to);
				if (j) j.sha256 = await sha256Hex(new TextEncoder().encode(next));
			}
			await saveJournal();

			// 4. Everything written reads back as written.
			n = 0;
			for (const c of journal.created) {
				progress('Checking what was written', n++, journal.created.length);
				const f = this.app.vault.getFileByPath(c.path);
				const got = f ? await sha256Hex(bytesOf(await this.app.vault.readBinary(f))) : null;
				if (got !== c.sha256) throw new Error(`“${c.path}” didn’t read back correctly after writing.`);
			}

			// 5. List the world, open it, and check it.
			progress('Opening the world', 0, 1);
			const manifest = this.db.manifest.get() ?? (await this.db.createManifest());
			manifest.worlds.push({ id: worldId, name: worldName, folder: `worlds/${worldId}` });
			await this.db.manifest.save(manifest);
			journal.status = 'committed';
			await saveJournal();
		} catch (e) {
			progress('Undoing the import', 0, 1);
			const left = await this.rollback(journal);
			await this.db.adapter.remove(journalPath).catch(() => undefined);
			if (left.length) {
				// Couldn't take everything back (a file changed meanwhile): keep a record.
				journal.created = journal.created.filter((c) => left.includes(c.path));
				await this.db.files.write(journalPath, journal).catch(() => undefined);
			}
			const why = e instanceof Error ? e.message : String(e);
			throw new Error(`The import was stopped and undone: ${why}${left.length ? ` (${left.length} file${left.length === 1 ? ' was' : 's were'} kept because ${left.length === 1 ? 'it' : 'they'} changed meanwhile)` : ''}. Your vault is as it was.`);
		}

		await this.worlds.switchWorld(worldId);
		report.checks = await this.verifyImported(worldId, files, m, placements);
		report.ok = report.checks.every((c) => c.ok);
		await this.db.adapter.remove(journalPath).catch(() => undefined);
		return report;
	}

	/** After an import: the world opened, and everything it points at is there. */
	/** Check a world that was just imported or restored (also used by Backups & recovery). */
	async verifyImported(worldId: string, files: Record<string, unknown>, m: ArchiveManifest, placements: Placement[]): Promise<ImportCheck[]> {
		const checks: ImportCheck[] = [];
		const s = this.worlds.session;
		checks.push({ label: 'The world opens', ok: !!s && s.worldId === worldId });
		if (!s || s.worldId !== worldId) return checks;
		const expectEntities = Object.entries(files).filter(([k]) => k.startsWith('entities/')).reduce((n, [, v]) => n + (Array.isArray((v as { records?: unknown[] })?.records) ? (v as { records: unknown[] }).records.length : 1), 0);
		checks.push({ label: 'Every entry is there', ok: s.entities.size === expectEntities, detail: `${s.entities.size} of ${expectEntities}` });
		const edges = s.stores.edges.all();
		const dangling = edges.filter((e) => !s.entities.get(e.from) || !s.entities.get(e.to));
		checks.push({ label: 'Every connection links two entries', ok: !dangling.length, detail: `${edges.length} connections${dangling.length ? `, ${dangling.length} broken` : ''}` });
		const inArchive = new Set(placements.map((p) => p.to));
		const exists = (p: string) => !!this.app.vault.getAbstractFileByPath(p);
		const notePaths = new Set<string>();
		for (const e of s.entities.values()) {
			for (const p of [e.nativeNote?.path, e.linkedNote?.path, ...(e.moreNotes ?? []).map((x) => x.path)]) if (p && inArchive.has(p)) notePaths.add(p);
		}
		const lostNotes = [...notePaths].filter((p) => !exists(p));
		checks.push({ label: 'Every included note is linked and opens', ok: !lostNotes.length, detail: `${notePaths.size} notes${lostNotes.length ? `, missing: ${lostNotes.slice(0, 3).join(', ')}` : ''}` });
		const media = s.media.all(true).filter((u) => inArchive.has(u.path));
		const lostMedia = media.filter((u) => !exists(u.path));
		checks.push({ label: 'Every included image is in place', ok: !lostMedia.length, detail: `${new Set(media.map((u) => u.path)).size} images${lostMedia.length ? `, missing: ${lostMedia.slice(0, 3).map((u) => u.path).join(', ')}` : ''}` });
		const pins = s.stores.maps.all().flatMap((mp) => mp.pins ?? []);
		const lostPins = pins.filter((p) => p.entityId && !s.entities.get(p.entityId));
		checks.push({ label: 'Map pins point at their entries', ok: !lostPins.length, detail: `${pins.length} pins${lostPins.length ? `, ${lostPins.length} broken` : ''}` });
		const scenes = s.stores.manuscript.all().filter((x) => x.kind === 'scene' && x.notePath && inArchive.has(x.notePath));
		const lostScenes = scenes.filter((x) => !exists(x.notePath!));
		checks.push({ label: 'Writing Studio scenes open', ok: !lostScenes.length, detail: `${scenes.length} scene notes${lostScenes.length ? `, missing ${lostScenes.length}` : ''}` });
		const count = (prefix: string) => Object.entries(files).filter(([k]) => k.startsWith(prefix)).reduce((n, [, v]) => n + (Array.isArray((v as { records?: unknown[] })?.records) ? (v as { records: unknown[] }).records.length : 1), 0);
		const same = [
			['layouts/', s.stores.layouts.size],
			['views/', s.stores.views.size],
			['note-templates/', s.stores.noteTemplates.size],
			['calendars/', s.stores.calendars.size],
			['tasks/', s.stores.tasks.size],
		] as const;
		const off = same.filter(([p, n]) => count(p) !== n);
		checks.push({ label: 'Layouts, views, templates, calendars and tasks are all there', ok: !off.length, detail: off.length ? `different: ${off.map(([p]) => p.slice(0, -1)).join(', ')}` : undefined });
		if (m.missing.length) checks.push({ label: `${m.missing.length} file${m.missing.length === 1 ? ' was' : 's were'} already missing in the original vault`, ok: true, detail: m.missing.slice(0, 3).map((d) => d.vaultPath).join(', ') });
		return checks;
	}

	// ── undo and recovery ──────────────────────────────────────────────────

	/** Take back what an import created: its world folder, and files it wrote that are unchanged. Returns paths kept. */
	async rollback(j: ImportJournal): Promise<string[]> {
		const kept: string[] = [];
		for (const c of [...j.created].reverse()) {
			const f = this.app.vault.getFileByPath(c.path);
			if (!f) continue;
			try {
				const now = await sha256Hex(bytesOf(await this.app.vault.readBinary(f)));
				if (now !== c.sha256) {
					kept.push(c.path);
					continue;
				}
				await this.app.fileManager.trashFile(f);
			} catch {
				kept.push(c.path);
			}
		}
		const listed = this.db.manifest.get()?.worlds.some((w) => w.id === j.worldId);
		if (!listed && (await this.db.adapter.exists(j.worldDir)) && this.db.adapter.rmdir) await this.db.adapter.rmdir(j.worldDir, true).catch(() => undefined);
		return kept;
	}

	/** Imports that were cut short (Obsidian closed mid-import). */
	async interrupted(): Promise<ImportJournal[]> {
		const dir = this.journalDir();
		if (!(await this.db.adapter.exists(dir))) return [];
		const out: ImportJournal[] = [];
		for (const p of (await this.db.adapter.list(dir)).files) {
			if (!p.endsWith('.json')) continue;
			const res = await this.db.files.read<ImportJournal>(p);
			const j = res.value;
			if (!j || j.format !== 'worldsmith/import-journal') continue;
			if (j.status === 'committed' && this.db.manifest.get()?.worlds.some((w) => w.id === j.worldId)) {
				// It finished; only its last check was cut short.
				await this.db.adapter.remove(p).catch(() => undefined);
				continue;
			}
			out.push(j);
		}
		return out;
	}

	/** Undo an interrupted import. Returns the files kept because they changed since. */
	async undoInterrupted(j: ImportJournal): Promise<string[]> {
		const kept = await this.rollback(j);
		const p = joinPath(this.journalDir(), `${j.id}.json`);
		if (kept.length) await this.db.files.write(p, { ...j, created: j.created.filter((c) => kept.includes(c.path)) });
		else await this.db.adapter.remove(p).catch(() => undefined);
		return kept;
	}
}
