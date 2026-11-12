import type { App, TFile } from 'obsidian';
import type { EntityRecord } from '../../core/types';
import type { Database } from '../../data/Database';
import { joinPath } from '../../data/storage/StorageAdapter';
import type { WorldService } from '../WorldService';
import { hashText } from './format';
import {
	findAdoptions,
	isExpired,
	MIGRATION_FORMAT,
	noteUnchanged,
	planMigration,
	undoPatch,
	wrapAdoptions,
	type AdoptField,
	type EntrySnapshot,
	type MigrationFacts,
	type MigrationPlan,
	type MigrationRecord,
	type MigrationRecordEntry,
} from './migration';
import type { NativeNoteService } from './NativeNoteService';
import { longFields } from './properties';
import { SUMMARY_REGION } from './render';

export type MigrationScope = { kind: 'entry'; id: string } | { kind: 'type'; id: string } | { kind: 'world' };

export interface MigrationResult {
	record: MigrationRecord;
	failed: Array<{ name: string; error: string }>;
	conflicts: number;
	ms: number;
}

export interface UndoResult {
	restored: number;
	/** Notes edited since the migration: left exactly as they are. */
	keptNotes: string[];
	/** Entries whose values changed since: those values stay. */
	keptValues: string[];
}

/**
 * Turning existing entries into native notes (0.17): dry run, run, Confirm and Undo.
 *
 * Opt-in only. Before anything is written there is a world backup, and a record in
 * `note-migrations/` with each linked note's exact text and each entry's values before and
 * after. That record is the safety copy: Undo uses it, Confirm (or 30 days) removes it.
 * Undo never throws away an edit made since: a note that changed is left as it is.
 */
export class NoteMigrationService {
	constructor(
		private readonly app: App,
		private readonly db: Database,
		private readonly worlds: WorldService,
		private readonly notes: NativeNoteService,
	) {}

	private get session() {
		return this.worlds.session;
	}

	private entries(scope: MigrationScope): EntityRecord[] {
		const s = this.session;
		if (!s) return [];
		const all = [...s.entities.values()];
		if (scope.kind === 'entry') return all.filter((e) => e.id === scope.id);
		if (scope.kind === 'type') return all.filter((e) => e.typeId === scope.id);
		return all;
	}

	scopeLabel(scope: MigrationScope): string {
		const s = this.session;
		if (!s) return '';
		if (scope.kind === 'entry') return s.entities.get(scope.id)?.name ?? 'Entry';
		if (scope.kind === 'type') return s.schemas.get(scope.id)?.plural ?? 'Type';
		return s.world.name;
	}

	/** The fields a linked note's own `## Label` section could become. */
	private adoptFields(e: EntityRecord, path: string, text: string): AdoptField[] {
		const input = this.notes.planInput({ ...e, nativeNote: { path, base: {}, status: 'ok', createdAt: 0 } }, text);
		if (!input) return [];
		return input.regions
			.filter((r) => r.kind === 'field' && r.id !== SUMMARY_REGION)
			.map((r) => ({
				id: r.id,
				label: r.label,
				heading: r.build('x').split('\n')[0] ?? '',
				ws: r.ws,
			}))
			.filter((f) => /^#{1,6} /.test(f.heading));
	}

	/**
	 * Who each vault note says it belongs to (`worldsmith-id`, or the older `worldsmith`).
	 * A note whose `worldsmith-world` names another world is that world's, whatever its id
	 * (a copied world keeps its entries' ids): it is listed in `otherWorld`, never claimed.
	 */
	private claims(): { claims: Map<string, string>; otherWorld: Set<string> } {
		const claims = new Map<string, string>();
		const otherWorld = new Set<string>();
		const world = this.session?.worldId;
		for (const f of this.app.vault.getMarkdownFiles()) {
			const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
			const w = fm?.['worldsmith-world'];
			if (w !== undefined && w !== null && w !== '' && w !== world) {
				otherWorld.add(f.path);
				continue;
			}
			const id = fm?.['worldsmith-id'] ?? fm?.['worldsmith'];
			if (typeof id === 'string' && id) claims.set(f.path, id);
		}
		return { claims, otherWorld };
	}

	/** The dry run: what would happen, writing nothing. */
	async plan(scope: MigrationScope): Promise<MigrationPlan> {
		const s = this.session;
		if (!s) return planMigration([], () => false);
		const { claims, otherWorld } = this.claims();
		const byEntry = new Map<string, string[]>();
		for (const [path, id] of claims) {
			if (this.notes.entryOf(path)) continue;
			const l = byEntry.get(id) ?? [];
			l.push(path);
			byEntry.set(id, l);
		}
		const facts: MigrationFacts[] = [];
		for (const e of this.entries(scope)) {
			const schema = s.schemas.get(e.typeId);
			if (!schema) continue;
			const lp = e.linkedNote?.path ?? null;
			const lf = lp ? this.app.vault.getFileByPath(lp) : null;
			const nativeOf = lf ? this.notes.entryOf(lf.path) : null;
			const place = this.notes.notePlace(e);
			const longFilled = longFields(schema)
				.filter((f) => typeof e.values[f.id] === 'string' && (e.values[f.id] as string).trim())
				.map((f) => f.label);
			const fact: MigrationFacts = {
				id: e.id,
				name: e.name,
				typeId: e.typeId,
				typeName: schema.singular,
				archived: !!e.archivedAt,
				trashed: !!e.trashedAt,
				hasNative: !!e.nativeNote,
				linked: lp
					? {
							path: lp,
							exists: !!lf,
							// The entry's own linked note may carry an id of no entry here (an old or
							// hand-written key): only a claim by another entry of this world counts.
							claimedBy: lf ? ((id) => (id && s.entities.get(id) ? id : null))(claims.get(lf.path) ?? null) : null,
							otherWorld: lf ? otherWorld.has(lf.path) : false,
							nativeOf: nativeOf && nativeOf.id !== e.id ? nativeOf.id : null,
						}
					: null,
				claimedNotes: (byEntry.get(e.id) ?? []).filter((p) => p !== lp),
				folder: place.folder,
				baseName: place.base,
				longFilled,
			};
			facts.push(fact);
		}
		const plan = planMigration(facts, (p) => !!this.app.vault.getAbstractFileByPath(p));
		// Sections of linked notes that already are a field's section.
		for (const row of plan.rows) {
			if (row.action !== 'link' || !row.path) continue;
			const f = this.app.vault.getFileByPath(row.path);
			const e = s.entities.get(row.id);
			if (!f || !e) continue;
			const text = await this.app.vault.cachedRead(f);
			row.adopt = findAdoptions(text, this.adoptFields(e, f.path, text)).map((a) => a.label);
		}
		plan.counts.adopt = plan.rows.reduce((n, r) => n + r.adopt.length, 0);
		return plan;
	}

	private snapshot(e: EntityRecord): EntrySnapshot {
		const c = JSON.parse(JSON.stringify(e)) as EntityRecord;
		return {
			values: c.values,
			description: c.description,
			aliases: c.aliases,
			tags: c.tags,
			status: c.status ?? null,
			linkedNote: c.linkedNote ? { path: c.linkedNote.path } : null,
			moreNotes: c.moreNotes,
		};
	}

	private recordPath(worldId: string, id: string): string {
		return joinPath(this.db.paths.noteMigrationsDir(worldId), `${id}.json`);
	}

	private async save(worldId: string, rec: MigrationRecord): Promise<void> {
		await this.db.files.write(this.recordPath(worldId, rec.id), rec);
	}

	/** Run a dry-run plan: backup, safety record, then each note, one by one. */
	async run(scope: MigrationScope, plan: MigrationPlan, progress?: (done: number, total: number) => void): Promise<MigrationResult> {
		const s = this.session;
		if (!s) throw new Error('No world is open.');
		const t0 = performance.now();
		const worldId = s.worldId;
		await this.db.flushAll();
		const backupPath = await this.db.backups.create(worldId, 'before-native-notes');
		const rec: MigrationRecord = {
			format: MIGRATION_FORMAT,
			v: 1,
			id: `m${Date.now().toString(36)}`,
			createdAt: Date.now(),
			scope: { ...scope, label: this.scopeLabel(scope) },
			backupPath,
			entries: [],
		};
		const todo = plan.rows.filter((r) => r.action !== 'skip' && r.path);
		const failed: MigrationResult['failed'] = [];
		const done: Array<{
			entry: Omit<MigrationRecordEntry, 'after' | 'noteAfterHash'>;
		}> = [];
		await this.save(worldId, rec);
		let n = 0;
		this.notes.deferNeighbours(true);
		try {
			for (const row of todo) {
				const e = s.entities.get(row.id);
				if (!e || e.nativeNote) continue;
				const before = this.snapshot(e);
				try {
					if (row.action === 'create') {
						const path = this.app.vault.getAbstractFileByPath(row.path!) ? undefined : row.path;
						const file = await this.notes.create(e, { path });
						if (!file) throw new Error('The note could not be created.');
						done.push({
							entry: {
								id: e.id,
								name: e.name,
								action: 'create',
								path: file.path,
								noteBefore: null,
								before,
							},
						});
					} else {
						const file = this.app.vault.getFileByPath(row.path!);
						if (!file) throw new Error('The note is gone.');
						const noteBefore = await this.app.vault.read(file);
						const adoptions = findAdoptions(noteBefore, this.adoptFields(e, file.path, noteBefore));
						if (adoptions.length) await this.app.vault.process(file, (cur) => (cur === noteBefore ? wrapAdoptions(cur, adoptions) : cur));
						const r = await this.notes.link(e, file);
						if (!r.ok) {
							if (adoptions.length) await this.app.vault.process(file, (cur) => (cur === wrapAdoptions(noteBefore, adoptions) ? noteBefore : cur));
							throw new Error(r.error ?? 'The note could not be linked.');
						}
						done.push({
							entry: {
								id: e.id,
								name: e.name,
								action: 'link',
								path: file.path,
								noteBefore,
								before,
							},
						});
					}
				} catch (err) {
					failed.push({
						name: e.name,
						error: err instanceof Error ? err.message : String(err),
					});
				}
				progress?.(++n, todo.length);
				// Keep the safety record current while a long run goes on.
				if (n % 200 === 0) {
					rec.entries = done.map((d) => ({
						...d.entry,
						after: d.entry.before,
						noteAfterHash: null,
					}));
					await this.save(worldId, rec);
				}
			}
		} finally {
			this.notes.deferNeighbours(false);
		}
		await this.notes.idle();
		await new Promise((r) => window.setTimeout(r, 300));
		await this.notes.idle();
		let conflicts = 0;
		rec.entries = [];
		for (const d of done) {
			const e = s.entities.get(d.entry.id);
			const f = this.app.vault.getFileByPath(d.entry.path);
			const text = f ? await this.app.vault.read(f) : null;
			if (e?.nativeNote?.conflicts?.length) conflicts++;
			rec.entries.push({
				...d.entry,
				after: e ? this.snapshot(e) : d.entry.before,
				noteAfterHash: text === null ? null : hashText(text),
			});
		}
		await this.save(worldId, rec);
		return {
			record: rec,
			failed,
			conflicts,
			ms: Math.round(performance.now() - t0),
		};
	}

	/** Migrations awaiting Confirm, newest first. */
	async pending(): Promise<MigrationRecord[]> {
		const s = this.session;
		if (!s) return [];
		const dir = this.db.paths.noteMigrationsDir(s.worldId);
		if (!(await this.db.adapter.exists(dir))) return [];
		const { files } = await this.db.adapter.list(dir);
		const out: MigrationRecord[] = [];
		for (const f of files) {
			if (!f.endsWith('.json')) continue;
			const r = await this.db.files.read<MigrationRecord>(f);
			if (r.value?.format === MIGRATION_FORMAT) out.push(r.value);
		}
		return out.sort((a, b) => b.createdAt - a.createdAt);
	}

	/** Confirm: the safety copies are removed (the world backup stays with the others). */
	async confirm(rec: MigrationRecord): Promise<void> {
		const s = this.session;
		if (!s) return;
		const p = this.recordPath(s.worldId, rec.id);
		if (await this.db.adapter.exists(p)) await this.db.adapter.remove(p);
	}

	/** Safety copies older than 30 days are confirmed on their own. */
	async expire(now = Date.now()): Promise<number> {
		let n = 0;
		for (const r of await this.pending()) {
			if (isExpired(r, now)) {
				await this.confirm(r);
				n++;
			}
		}
		return n;
	}

	/** Undo: notes and entries back as they were, except for anything changed since. */
	async undo(rec: MigrationRecord): Promise<UndoResult> {
		const s = this.session;
		if (!s) throw new Error('No world is open.');
		await this.notes.idle();
		const res: UndoResult = { restored: 0, keptNotes: [], keptValues: [] };
		this.notes.deferNeighbours(true);
		try {
			for (const entry of [...rec.entries].reverse()) {
				const cur = s.entities.get(entry.id);
				const file = this.app.vault.getFileByPath(entry.path);
				const text = file ? await this.app.vault.read(file) : null;
				const unchanged = noteUnchanged(text, entry);
				if (cur?.nativeNote?.path === entry.path) this.notes.unlink(cur);
				let noteKept = false;
				if (file && unchanged) {
					if (entry.action === 'create') await this.app.fileManager.trashFile(file);
					else if (entry.noteBefore !== null) {
						const before = entry.noteBefore;
						await this.app.vault.process(file, (c) => (hashText(c) === entry.noteAfterHash ? before : c));
					}
				} else if (file) {
					noteKept = true;
					res.keptNotes.push(entry.path);
				}
				if (!cur) continue;
				const now = s.entities.get(entry.id) ?? cur;
				const { patch, kept } = undoPatch(this.snapshot(now), entry);
				if (kept.length) res.keptValues.push(entry.name);
				const more = [...entry.before.moreNotes];
				const linkedNote = entry.before.linkedNote;
				// A note edited since stays linked to its entry (it is kept, not thrown away).
				if (noteKept && linkedNote?.path !== entry.path && !more.some((m) => m.path === entry.path)) more.push({ path: entry.path });
				s.entityService.update(entry.id, {
					...(patch as Partial<EntityRecord>),
					linkedNote,
					moreNotes: more,
					nativeNote: null,
				});
				res.restored++;
			}
		} finally {
			this.notes.deferNeighbours(false);
		}
		const p = this.recordPath(s.worldId, rec.id);
		if (await this.db.adapter.exists(p)) await this.db.adapter.remove(p);
		await this.notes.idle();
		return res;
	}
}

export function scopeOf(kind: 'entry' | 'type' | 'world', id?: string): MigrationScope {
	return kind === 'world' ? { kind } : { kind, id: id! };
}
