import { Notice, TFile, normalizePath, parseYaml, type App, type Component } from 'obsidian';
import type { EventBus } from '../../core/events/EventBus';
import type { WorldsmithEvents } from '../../core/events/events';
import type { EntityPatch, EntityRecord, EntitySchema, NativeNote, NoteConflict } from '../../core/types';
import { formatChronoDate } from '../../core/types/chrono';
import { sanitizeFileName } from '../../core/util/strings';
import type { FieldTypeRegistry } from '../../fields/FieldTypeRegistry';
import type { NativeNoteSettings } from '../../settings/settings';
import type { WorldService } from '../WorldService';
import type { WorldSession } from '../WorldSession';
import { hashText, parseNote } from './format';
import { fromProperty, listProp, noteKeys, statusFromLabel } from './properties';
import { SUMMARY_REGION, fixedKeys, propSpecs, regionSpecs, type NoteConnection, type RenderContext } from './render';
import { planReconcile, wsHashOf, type PlanInput, type PlanOutput } from './sync';

/** What the entry page and menus show about a native note. */
export interface NoteSyncState {
	status: 'none' | 'ok' | 'pending' | 'missing' | 'conflict' | 'broken';
	path?: string;
	conflicts: NoteConflict[];
	broken: string[];
	removed: string[];
	lastSync?: number;
}

interface Job {
	timer: number | null;
	resolve?: Record<string, 'note' | 'ws'>;
	waiters: Array<() => void>;
}

const QUIET_MS = 1500;
const DEBOUNCE_WS = 400;
const DEBOUNCE_NOTE = 600;
const PARALLEL = 4;

/**
 * Native notes (0.17): keeps each entry's own Markdown note and the entry in step.
 *
 *  - The note is the home of the entry's short facts (Properties) and long writing (field
 *    sections); Worldsmith keeps the last agreed values in the entry as before, so every
 *    reader (search, databases, dashboards) is unchanged.
 *  - Worldsmith writes only its own front-matter keys and the inside of its own regions,
 *    through `vault.process`, after checking the region is unchanged since it last wrote it.
 *  - Writes are debounced per entry, run one at a time per note (four notes at once at
 *    most), and are idempotent: reconciling twice changes nothing, which is the loop guard.
 *    A change event whose text is exactly what Worldsmith just wrote is skipped outright.
 */
export class NativeNoteService {
	private jobs = new Map<string, Job>();
	private running = new Set<string>();
	private queue: string[] = [];
	/** path → hash of the text Worldsmith last wrote there. */
	private expected = new Map<string, string>();
	/** Entries whose update comes from their note (don't push it straight back). */
	private applying = new Set<string>();
	/** Last reconcile result per entry, for the status menu. */
	private states = new Map<string, NoteSyncState>();
	/** path → entry id, for notes of the open world. */
	private byPath = new Map<string, string>();
	private disposers: Array<() => void> = [];
	private paused = false;
	/** Set by dispose(): a reconcile still running stops at its next step. */
	private disposed = false;

	constructor(
		private readonly app: App,
		private readonly worlds: WorldService,
		private readonly events: EventBus<WorldsmithEvents>,
		private readonly fieldTypes: FieldTypeRegistry,
		private readonly getFolder: () => string,
		private readonly getSettings: () => NativeNoteSettings,
		private readonly getDataFolder: () => string = () => '',
	) {}

	private get session(): WorldSession | null {
		return this.worlds.session;
	}

	private isOwnData(path: string): boolean {
		const root = this.getDataFolder();
		return !!root && (path === root || path.startsWith(`${root}/`));
	}

	// ── wiring ───────────────────────────────────────────────────────────────

	register(owner: Component): void {
		const { vault, metadataCache } = this.app;
		owner.registerEvent(
			vault.on('rename', (file, oldPath) => {
				if (!(file instanceof TFile) || this.isOwnData(oldPath)) return;
				if (file.extension === 'md') this.quiet();
				const id = this.byPath.get(oldPath);
				if (id) this.followRename(id, file.path);
			}),
		);
		owner.registerEvent(
			vault.on('delete', (file) => {
				if (!(file instanceof TFile)) return;
				const id = this.byPath.get(file.path);
				// The path is no longer this entry's: a new note made there later is someone else's.
				this.expected.delete(file.path);
				if (id) this.markMissing(id);
				if (this.byPath.get(file.path) === id) this.byPath.delete(file.path);
			}),
		);
		owner.registerEvent(
			metadataCache.on('changed', (file, data, cache) => {
				const id = this.byPath.get(file.path);
				if (!id) {
					this.rematch(file, cache?.frontmatter);
					return;
				}
				// Exactly what Worldsmith just wrote: skipped once (an undo back to it later is an edit).
				const exp = this.expected.get(file.path);
				if (exp !== undefined && typeof data === 'string') {
					this.expected.delete(file.path);
					if (exp === hashText(data)) return;
				}
				void this.schedule(id, DEBOUNCE_NOTE);
			}),
		);
		const on = <K extends keyof WorldsmithEvents>(k: K, fn: (p: WorldsmithEvents[K]) => void) => this.disposers.push(this.events.on(k, fn).dispose);
		on('world:loaded', () => void this.start());
		on('world:unloaded', () => this.reset());
		on('entity:updated', ({ entity, change }) => this.onEntityUpdated(entity, change.keys));
		on('entity:deleted', ({ entity }) => {
			if (entity.nativeNote) this.byPath.delete(entity.nativeNote.path);
		});
		on('entity:created', ({ entity }) => {
			// An entry restored or imported with its note.
			if (entity.nativeNote) {
				this.byPath.set(entity.nativeNote.path, entity.id);
				void this.schedule(entity.id, DEBOUNCE_WS);
			}
		});
		const edge = (e: { from: string; to: string }) => {
			this.scheduleIfNote(e.from);
			this.scheduleIfNote(e.to);
		};
		on('edge:created', ({ edge: e }) => edge(e));
		on('edge:updated', ({ edge: e, prev }) => {
			edge(e);
			edge(prev);
		});
		on('edge:deleted', ({ edge: e }) => edge(e));
		on('relationType:updated', () => this.scheduleAll());
		on('schema:updated', ({ schema }) => this.scheduleAll((e) => e.typeId === schema.id));
		on('world:updated', ({ keys }) => {
			if (keys.includes('noteTemplates') || keys.includes('statuses')) this.scheduleAll();
		});
		on('note-template:saved', ({ template, structural }) => {
			if (structural) this.scheduleAll((e) => this.templateOf(e) === template.id);
		});
		on('note-template:deleted', () => this.scheduleAll());
		if (this.session) void this.start();
	}

	dispose(): void {
		this.disposed = true;
		for (const d of this.disposers.splice(0)) d();
		this.reset();
	}

	/** Forget the closed world: timers stop, and anyone waiting on a cleared job is let go. */
	private reset(): void {
		for (const j of this.jobs.values()) {
			if (j.timer !== null) window.clearTimeout(j.timer);
			j.timer = null;
			for (const w of j.waiters.splice(0)) w();
		}
		this.jobs.clear();
		this.queue = [];
		this.byPath.clear();
		this.states.clear();
		this.lastPaths.clear();
		this.expected.clear();
		this.renameAgain.clear();
		if (this.quietTimer !== null) window.clearTimeout(this.quietTimer);
		this.quietTimer = null;
		this.quietUntil = 0;
	}

	/** The world closed, or the plugin unloaded, while a reconcile was waiting on the vault. */
	private stale(s: WorldSession): boolean {
		return this.disposed || this.session !== s;
	}

	/**
	 * Whether a note's text is this entry's note: its `worldsmith-id` is the entry's (and its
	 * `worldsmith-world`, when set, is the open world), or it has no id and is exactly what
	 * Worldsmith last saw there. Anything else is another note that happens to be at the path.
	 */
	private ownsText(entity: EntityRecord, text: string, worldId: string): boolean {
		const p = parseNote(text);
		let fm: Record<string, unknown> = {};
		if (p.frontMatter) {
			try {
				fm = (parseYaml(p.frontMatter.yaml) as Record<string, unknown>) ?? {};
			} catch {
				// Unreadable front matter: nothing is written to such a note anyway.
				return true;
			}
		}
		const verdict = this.ownsFm(entity, fm, worldId);
		if (verdict !== null) return verdict;
		const nn = entity.nativeNote;
		return !nn?.fileHash || hashText(text) === nn.fileHash;
	}

	/** true / false from the note's identity keys, null when it has no `worldsmith-id`. */
	private ownsFm(entity: EntityRecord, fm: Record<string, unknown> | undefined, worldId: string): boolean | null {
		if (!fm || typeof fm !== 'object') return null;
		const w = fm['worldsmith-world'];
		if (w !== undefined && w !== null && w !== '' && w !== worldId) return false;
		const id = fm['worldsmith-id'];
		if (id === undefined || id === null || id === '') return null;
		return id === entity.id;
	}

	private async ownsFile(entity: EntityRecord, file: TFile, worldId: string): Promise<boolean> {
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
		const verdict = this.ownsFm(entity, fm, worldId);
		if (verdict !== null) return verdict;
		return this.ownsText(entity, await this.app.vault.cachedRead(file), worldId);
	}

	/** A note of a missing entry note came back (restored from the trash, copied in): follow it. */
	private rematch(file: TFile, fm: Record<string, unknown> | undefined): void {
		const s = this.session;
		const id = fm?.['worldsmith-id'];
		if (!s || typeof id !== 'string' || this.isOwnData(file.path)) return;
		const e = s.entities.get(id);
		if (!e?.nativeNote || e.nativeNote.status !== 'missing' || this.ownsFm(e, fm, s.worldId) !== true) return;
		this.followRename(e.id, file.path);
		void this.schedule(e.id, DEBOUNCE_NOTE);
	}

	private templateOf(e: EntityRecord): string | null {
		const s = this.session;
		const schema = s?.schemas.get(e.typeId);
		if (!s || !schema || !e.nativeNote) return null;
		return s.noteTemplates.forEntity(e, schema).template.id;
	}

	private onEntityUpdated(entity: EntityRecord, keys: string[]): void {
		const nn = entity.nativeNote;
		if (nn) {
			// A missing note's old path isn't the entry's any more (whatever is there now).
			if (nn.status !== 'missing') this.byPath.set(nn.path, entity.id);
			const relevant = keys.filter((k) => k !== 'nativeNote' && k !== 'linkedNote' && k !== 'moreNotes' && k !== 'flags' && k !== 'sortOrder');
			if (relevant.length && !this.applying.has(entity.id)) void this.schedule(entity.id, DEBOUNCE_WS);
			if (keys.includes('name') && this.getSettings().renameWithEntry) void this.renameWithEntry(entity);
		}
		// Notes that show this entry (links to it, its name) follow its name and its note.
		const path = entity.nativeNote?.path ?? null;
		const moved = this.lastPaths.get(entity.id) !== path;
		this.lastPaths.set(entity.id, path);
		if (keys.includes('name') || (keys.includes('nativeNote') && moved) || keys.includes('trashedAt') || keys.includes('parentId')) this.scheduleNeighbours(entity);
	}

	/** While many notes are made at once, their neighbours are re-rendered once at the end. */
	private deferred: Set<string> | null = null;

	deferNeighbours(on: boolean): void {
		if (on) {
			this.deferred ??= new Set();
			return;
		}
		const ids = this.deferred;
		this.deferred = null;
		const s = this.session;
		if (ids && s) for (const id of ids) {
			const e = s.entities.get(id);
			if (e) this.scheduleNeighbours(e);
		}
	}

	private scheduleNeighbours(entity: EntityRecord): void {
		const s = this.session;
		if (!s) return;
		if (this.deferred) {
			this.deferred.add(entity.id);
			return;
		}
		for (const e of s.relations.edgesTouching(entity.id)) {
			this.scheduleIfNote(e.from === entity.id ? e.to : e.from);
		}
		if (entity.parentId) this.scheduleIfNote(entity.parentId);
		for (const c of s.index.childrenOf(entity.id)) this.scheduleIfNote(c.id);
		// Relation fields kept in values (links in facts) point at it by id.
	}

	private scheduleIfNote(id: string): void {
		const e = this.session?.entities.get(id);
		if (e?.nativeNote) void this.schedule(id, DEBOUNCE_WS);
	}

	private scheduleAll(filter: (e: EntityRecord) => boolean = () => true): void {
		const s = this.session;
		if (!s) return;
		for (const e of s.entities.values()) if (e.nativeNote && filter(e)) void this.schedule(e.id, DEBOUNCE_WS * 2);
	}

	// ── queue ────────────────────────────────────────────────────────────────

	/** Reconcile an entry's note soon (debounced). Resolves once it ran. */
	schedule(id: string, delay = DEBOUNCE_WS, resolve?: Record<string, 'note' | 'ws'>): Promise<void> {
		if (this.disposed) return Promise.resolve();
		let job = this.jobs.get(id);
		if (!job) {
			job = { timer: null, waiters: [] };
			this.jobs.set(id, job);
		}
		if (resolve) job.resolve = { ...(job.resolve ?? {}), ...resolve };
		if (job.timer !== null) window.clearTimeout(job.timer);
		const j = job;
		job.timer = window.setTimeout(() => {
			j.timer = null;
			if (!this.queue.includes(id)) this.queue.push(id);
			this.pump();
		}, delay);
		return new Promise((r) => j.waiters.push(r));
	}

	/** Run now (no debounce) and wait for it. */
	async reconcile(id: string, resolve?: Record<string, 'note' | 'ws'>): Promise<void> {
		await this.schedule(id, 0, resolve);
	}

	/** Wait for every pending write (tests, migration, export). */
	async idle(): Promise<void> {
		for (let i = 0; i < 24000; i++) {
			// While paused, only the reconciles already running are waited for.
			const pending = this.running.size || (!this.paused && ([...this.jobs.values()].some((j) => j.timer !== null) || this.queue.length));
			if (!pending) return;
			await new Promise((r) => window.setTimeout(r, 50));
		}
	}

	get pending(): number {
		return [...this.jobs.values()].filter((j) => j.timer !== null).length + this.queue.length + this.running.size;
	}

	pause(on: boolean): void {
		this.paused = on;
		if (!on) this.pump();
	}

	/** Hold writes for a moment: Obsidian is updating links in other notes. */
	private quiet(ms = QUIET_MS): void {
		this.quietUntil = Math.max(this.quietUntil, Date.now() + ms);
	}

	private pump(): void {
		if (this.paused || this.disposed) return;
		const wait = this.renamesInFlight > 0 ? QUIET_MS : this.quietUntil - Date.now();
		if (wait > 0 && this.queue.length) {
			if (this.quietTimer === null)
				this.quietTimer = window.setTimeout(() => {
					this.quietTimer = null;
					this.pump();
				}, Math.min(wait, QUIET_MS));
			return;
		}
		while (this.running.size < PARALLEL && this.queue.length) {
			const idx = this.queue.findIndex((id) => !this.running.has(id));
			if (idx === -1) return;
			const [id] = this.queue.splice(idx, 1) as [string];
			const job = this.jobs.get(id);
			const resolve = job?.resolve;
			if (job) job.resolve = undefined;
			const waiters = job?.waiters.splice(0) ?? [];
			this.running.add(id);
			void this.run(id, resolve)
				.catch((e) => {
					console.error('[Worldsmith] native note sync failed', e);
					this.reportFailure(id, 'sync', e);
				})
				.finally(() => {
					this.running.delete(id);
					if (job && job.timer === null && !job.waiters.length && !this.queue.includes(id)) this.jobs.delete(id);
					for (const w of waiters) w();
					this.pump();
				});
		}
	}

	// ── reconcile ────────────────────────────────────────────────────────────

	/** The render context for one entry. */
	context(entity: EntityRecord, schema: EntitySchema, s: WorldSession, templateId?: string): RenderContext {
		const chosen = templateId ? s.noteTemplates.get(templateId) : undefined;
		const { template, override } = chosen ? { template: chosen, override: true } : s.noteTemplates.forEntity(entity, schema);
		return {
			world: s.world,
			schema,
			template,
			templateOverride: override,
			fieldTypes: this.fieldTypes,
			keys: noteKeys(schema),
			value: (e, f) => s.values.get(e, f),
			linkTarget: (id) => {
				const o = s.entities.get(id);
				const p = o?.nativeNote && o.nativeNote.status !== 'missing' && !o.trashedAt ? o.nativeNote.path : null;
				return p ? p.replace(/\.md$/i, '') : null;
			},
			connections: (e) =>
				s.relations.viewsOf(e.id).map(
					(v): NoteConnection => ({
						label: v.label,
						otherId: v.other.id,
						otherName: v.other.name,
						status: v.edge.status,
						secret: v.edge.secret,
						since: v.edge.start ? formatChronoDate(v.edge.start) : '',
						note: v.edge.description ?? '',
					}),
				),
			children: (e) => s.index.childrenOf(e.id).filter((c) => !c.trashedAt).map((c) => ({ id: c.id, name: c.name })),
		};
	}

	/** Everything the reconciler compares, for an entry and a note's text. */
	planInput(entity: EntityRecord, text: string, resolve?: Record<string, 'note' | 'ws'>, templateId?: string): PlanInput | null {
		const s = this.session;
		const schema = s?.schemas.get(entity.typeId);
		if (!s || !schema) return null;
		const ctx = this.context(entity, schema, s, templateId ?? entity.nativeNote?.templateId);
		return {
			text,
			fixed: fixedKeys(entity, ctx),
			props: propSpecs(entity, ctx),
			regions: regionSpecs(entity, ctx),
			base: entity.nativeNote?.base ?? {},
			detached: entity.nativeNote?.detached ?? [],
			parseYaml: (y) => (parseYaml(y) as Record<string, unknown>) ?? {},
			resolve,
			removeUnknownViews: true,
		};
	}

	/** The note text Worldsmith would write for a new note (no file is touched). */
	compose(entity: EntityRecord, templateId?: string): string {
		const input = this.planInput({ ...entity, nativeNote: entity.nativeNote ?? null }, '', undefined, templateId);
		if (!input) return '';
		return planReconcile({ ...input, base: {} }).text;
	}

	/** When each entry last told the person about a failure (one notice a minute per entry). */
	private failureShown = new Map<string, number>();

	/** A failed save or rename is shown, never only logged (0.18). Nothing is retried blindly. */
	private reportFailure(entityId: string, what: 'sync' | 'rename', e: unknown): void {
		const now = Date.now();
		if (now - (this.failureShown.get(entityId) ?? 0) < 60_000) return;
		this.failureShown.set(entityId, now);
		const name = this.session?.entities.get(entityId)?.name ?? 'an entry';
		const why = e instanceof Error ? e.message : String(e);
		new Notice(
			what === 'sync'
				? `Worldsmith couldn’t sync the note of “${name}”. Nothing was overwritten; it will try again on the next change. (${why})`
				: `Worldsmith couldn’t rename the note of “${name}”. The note keeps its old name. (${why})`,
			10000,
		);
	}

	private async run(id: string, resolve?: Record<string, 'note' | 'ws'>): Promise<void> {
		const s = this.session;
		let entity = s?.entities.get(id);
		if (!s || !entity?.nativeNote) return;
		// A note that went missing is never taken over by whatever is at its path now: Relink
		// (or the note coming back with its id) puts it back.
		if (entity.nativeNote.status === 'missing') return;
		const nn = entity.nativeNote;
		const file = this.app.vault.getFileByPath(nn.path);
		if (!file) {
			this.markMissing(id);
			return;
		}
		const text = await this.app.vault.read(file);
		if (this.stale(s)) return;
		// The entry as it is now (it may have been edited while the note was read).
		entity = s.entities.get(id);
		if (!entity?.nativeNote || entity.nativeNote.status === 'missing') return;
		if (entity.nativeNote.path !== file.path) {
			void this.schedule(id, DEBOUNCE_NOTE, resolve);
			return;
		}
		if (!this.ownsText(entity, text, s.worldId)) {
			this.markMissing(id);
			return;
		}
		let input = this.planInput(entity, text, resolve);
		if (!input) return;
		let plan = planReconcile(input);
		// Take the note's edits into Worldsmith first, so generated parts show them.
		const invalid: NoteConflict[] = [];
		if (plan.pulls.length || plan.regionPulls.length) {
			const patch = this.pullPatch(entity, plan, invalid);
			if (patch) {
				this.applying.add(id);
				try {
					s.entityService.update(id, patch);
				} finally {
					this.applying.delete(id);
				}
			}
			entity = s.entities.get(id)!;
			// Plan again from the same text and the same agreed state: the pulled values now
			// match on both sides. (The first plan's base also lists parts it inserted into
			// its own copy of the text; reusing it would make them look deleted.)
			const agreed = input.base;
			input = this.planInput({ ...entity, nativeNote: { ...entity.nativeNote!, base: agreed } }, text, resolve);
			if (!input) return;
			plan = planReconcile(input);
			// Values that couldn't be stored stay undecided (never pushed over the note's).
			for (const c of invalid) {
				if (agreed[c.key] === undefined) delete plan.base[c.key];
				else plan.base[c.key] = agreed[c.key]!;
			}
		}
		let written = text;
		if (plan.changed) {
			let raced = false;
			await this.app.vault.process(file, (data) => {
				if (data === text) return plan.text;
				// The note changed since it was read: write nothing now and look again.
				raced = true;
				return data;
			});
			if (raced) {
				if (!this.stale(s)) void this.schedule(id, DEBOUNCE_NOTE, resolve);
				return;
			}
			written = plan.text;
			if (this.stale(s)) return;
			this.expected.set(file.path, hashText(written));
		}
		// A conflict already known keeps its time (an unchanged state writes nothing).
		const known = new Map((entity.nativeNote?.conflicts ?? []).map((c) => [c.key, c]));
		const stamp = <T extends { key: string; note: string; ws: string }>(c: T): NoteConflict => {
			const k = known.get(c.key);
			return { ...(c as unknown as NoteConflict), at: k && k.note === c.note && k.ws === c.ws ? k.at : Date.now() };
		};
		const conflicts: NoteConflict[] = [...plan.conflicts.map(stamp), ...invalid.map(stamp)];
		const cur = s.entities.get(id);
		if (!cur?.nativeNote) return;
		const next: NativeNote = {
			...cur.nativeNote,
			base: plan.base,
			status: conflicts.length ? 'conflict' : 'ok',
			mtime: file.stat.mtime,
			fileHash: hashText(written),
		};
		if (conflicts.length) next.conflicts = conflicts;
		else delete next.conflicts;
		// Sections someone chose to keep stay kept; ones restored are no longer detached.
		if (resolve) {
			const keep = Object.entries(resolve).filter(([k, v]) => k.startsWith('v:') && v === 'note').map(([k]) => k.slice(2));
			const restored = Object.entries(resolve).filter(([k, v]) => k.startsWith('v:') && v === 'ws').map(([k]) => k.slice(2));
			const det = new Set([...(next.detached ?? []), ...keep]);
			for (const r of restored) det.delete(r);
			if (det.size) next.detached = [...det];
			else delete next.detached;
		}
		if (JSON.stringify(next) !== JSON.stringify(cur.nativeNote)) {
			this.applying.add(id);
			try {
				s.entityService.update(id, { nativeNote: next });
			} finally {
				this.applying.delete(id);
			}
		}
		const prev = this.states.get(id);
		const state: NoteSyncState = { status: plan.broken.length ? 'broken' : conflicts.length ? 'conflict' : 'ok', path: next.path, conflicts, broken: plan.broken, removed: plan.removed, lastSync: Date.now() };
		this.states.set(id, state);
		if (!prev || prev.status !== state.status || prev.conflicts.length !== conflicts.length) this.events.emit('native-note:status', { entityId: id });
	}

	/** The entry patch for values taken from the note. Values that can't be stored become conflicts. */
	private pullPatch(entity: EntityRecord, plan: PlanOutput, invalid: NoteConflict[]): EntityPatch | null {
		const s = this.session!;
		const schema = s.schemas.get(entity.typeId);
		if (!schema) return null;
		const patch: EntityPatch = {};
		const values: Record<string, unknown> = {};
		for (const p of plan.pulls) {
			if (p.id === 'p:__aliases') patch.aliases = listProp(p.raw);
			else if (p.id === 'p:__tags') patch.tags = listProp(p.raw, true);
			else if (p.id === 'p:__status') {
				const st = statusFromLabel(s.world, p.raw);
				if (st) patch.status = st;
				else if (p.raw != null && p.raw !== '') invalid.push({ key: p.id, label: 'Status (not one of this world’s statuses)', note: String(p.raw), ws: s.world.statuses.find((x) => x.id === entity.status)?.label ?? entity.status, at: Date.now() });
			} else {
				const fid = p.id.slice(2);
				const f = schema.fields.find((x) => x.id === fid);
				if (!f) continue;
				const r = fromProperty(f, p.raw, this.fieldTypes);
				if (r.ok) values[fid] = r.value;
				else invalid.push({ key: p.id, label: `${f.label} (not a valid ${this.fieldTypes.for(f).label.toLowerCase()})`, note: r.text, ws: this.fieldTypes.toText(f, entity.values[fid]), at: Date.now() });
			}
		}
		for (const r of plan.regionPulls) {
			if (r.id === SUMMARY_REGION) patch.description = r.text;
			else if (schema.fields.some((f) => f.id === r.id)) values[r.id] = r.text || undefined;
		}
		if (Object.keys(values).length) patch.values = values;
		return Object.keys(patch).length ? patch : null;
	}

	// ── state for the UI ─────────────────────────────────────────────────────

	state(entity: EntityRecord): NoteSyncState {
		const nn = entity.nativeNote;
		if (!nn) return { status: 'none', conflicts: [], broken: [], removed: [] };
		const known = this.states.get(entity.id);
		const pending = this.jobs.has(entity.id);
		if (nn.status === 'missing') return { status: 'missing', path: nn.path, conflicts: [], broken: [], removed: [] };
		return {
			status: pending ? 'pending' : (known?.status ?? (nn.status === 'conflict' ? 'conflict' : 'ok')),
			path: nn.path,
			conflicts: nn.conflicts ?? [],
			broken: known?.broken ?? [],
			removed: known?.removed ?? [],
			lastSync: known?.lastSync,
		};
	}

	file(entity: EntityRecord): TFile | null {
		return entity.nativeNote ? this.app.vault.getFileByPath(entity.nativeNote.path) : null;
	}

	/** The entry a vault note belongs to (by path in the open world). */
	entryOf(path: string): EntityRecord | null {
		const id = this.byPath.get(path);
		return id ? (this.session?.entities.get(id) ?? null) : null;
	}

	// ── lifecycle of a note ──────────────────────────────────────────────────

	/** The folder and file name (without `.md`) a new note for the entry would get. */
	notePlace(entity: EntityRecord): { folder: string; base: string } {
		const schema = this.session?.schemas.get(entity.typeId);
		return { folder: normalizePath(`${this.getFolder() || 'Worldsmith'}/${sanitizeFileName(schema?.plural ?? 'Entries')}`), base: sanitizeFileName(entity.name) };
	}

	/** Where a new note for the entry goes: <notes folder>/<Type plural>/<Name>.md, free name. */
	newPath(entity: EntityRecord): string {
		const { folder, base } = this.notePlace(entity);
		let path = normalizePath(`${folder}/${base}.md`);
		for (let n = 2; this.app.vault.getAbstractFileByPath(path); n++) path = normalizePath(`${folder}/${base} ${n}.md`);
		return path;
	}

	/** Create the entry's native note. Returns its file, or null (with a notice) when it can't. */
	async create(entity: EntityRecord, opts: { templateId?: string; path?: string } = {}): Promise<TFile | null> {
		const s = this.session;
		const cur = s?.entities.get(entity.id);
		if (!s || !cur) return null;
		if (cur.nativeNote && this.app.vault.getFileByPath(cur.nativeNote.path)) {
			new Notice('This entry already has a native note.');
			return this.file(cur);
		}
		const path = opts.path ?? this.newPath(cur);
		const now = Date.now();
		const nn: NativeNote = { path, base: {}, status: 'ok', createdAt: cur.nativeNote?.createdAt ?? now, ...(opts.templateId ? { templateId: opts.templateId } : {}) };
		const input = this.planInput({ ...cur, nativeNote: nn }, '');
		if (!input) return null;
		const plan = planReconcile(input);
		try {
			await this.ensureFolder(path.split('/').slice(0, -1).join('/'));
			this.expected.set(path, hashText(plan.text));
			const file = await this.app.vault.create(path, plan.text);
			this.byPath.set(path, cur.id);
			this.attach(cur.id, { ...nn, base: plan.base, mtime: file.stat.mtime, fileHash: hashText(plan.text) });
			this.scheduleNeighbours(s.entities.get(cur.id)!);
			return file;
		} catch (e) {
			new Notice(`Couldn’t create the note: ${e instanceof Error ? e.message : String(e)}`);
			return null;
		}
	}

	/**
	 * Make an existing note the entry's native note. Worldsmith adds its keys and parts (at
	 * the top, the footer at the end) and moves none of the note's text. Values both sides
	 * have and that differ become decisions; nothing is overwritten.
	 */
	async link(entity: EntityRecord, file: TFile): Promise<{ ok: boolean; error?: string }> {
		const s = this.session;
		const cur = s?.entities.get(entity.id);
		if (!s || !cur) return { ok: false, error: 'No world is open.' };
		const other = this.byPath.get(file.path);
		if (other && other !== cur.id) return { ok: false, error: `That note is already the native note of “${s.entities.get(other)?.name ?? 'another entry'}”.` };
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
		const fw = fm?.['worldsmith-world'];
		// A copied world keeps its entries' ids: a note of another world is never shared.
		if (fw !== undefined && fw !== null && fw !== '' && fw !== s.worldId) return { ok: false, error: 'That note belongs to another Worldsmith world. Make a new note for this entry instead.' };
		const claimed = typeof fm?.['worldsmith-id'] === 'string' ? (fm['worldsmith-id']) : null;
		if (claimed && claimed !== cur.id && s.entities.get(claimed)) return { ok: false, error: `That note belongs to “${s.entities.get(claimed)!.name}”.` };
		if (cur.nativeNote && cur.nativeNote.path !== file.path && this.app.vault.getFileByPath(cur.nativeNote.path)) return { ok: false, error: 'This entry already has a native note. Unlink it first.' };
		this.byPath.set(file.path, cur.id);
		this.attach(cur.id, { path: file.path, base: {}, status: 'ok', createdAt: Date.now(), ...(cur.nativeNote?.templateId ? { templateId: cur.nativeNote.templateId } : {}) });
		await this.reconcile(cur.id);
		this.scheduleNeighbours(s.entities.get(cur.id)!);
		return { ok: true };
	}

	/** The native note is also the main linked note; a previous main note stays linked. */
	private attach(id: string, nn: NativeNote): void {
		const s = this.session!;
		const cur = s.entities.get(id)!;
		const more = cur.moreNotes.filter((n) => n.path !== nn.path);
		if (cur.linkedNote && cur.linkedNote.path !== nn.path) more.unshift({ path: cur.linkedNote.path });
		this.applying.add(id);
		try {
			s.entityService.update(id, { nativeNote: nn, linkedNote: { path: nn.path }, moreNotes: more });
		} finally {
			this.applying.delete(id);
		}
	}

	/**
	 * Stop treating the note as the entry's native note. The note and its text stay as they
	 * are (it remains a linked note); Worldsmith keeps the values it last agreed.
	 */
	unlink(entity: EntityRecord): NativeNote | null {
		const s = this.session;
		const cur = s?.entities.get(entity.id);
		if (!s || !cur?.nativeNote) return null;
		const before = cur.nativeNote;
		this.byPath.delete(before.path);
		this.jobs.delete(cur.id);
		this.states.delete(cur.id);
		s.entityService.update(cur.id, { nativeNote: null });
		this.events.emit('native-note:status', { entityId: cur.id });
		return before;
	}

	/** Put an unlinked native note back (Undo). */
	relink(entityId: string, nn: NativeNote): void {
		const s = this.session;
		if (!s?.entities.get(entityId)) return;
		this.byPath.set(nn.path, entityId);
		this.attach(entityId, nn);
		void this.schedule(entityId, 0);
	}

	/** Use another template for this entry (null = the type's). Presentation only. */
	setTemplate(entity: EntityRecord, templateId: string | null): string | null {
		const s = this.session;
		const cur = s?.entities.get(entity.id);
		if (!s || !cur?.nativeNote) return null;
		const prev = cur.nativeNote.templateId ?? null;
		const next: NativeNote = { ...cur.nativeNote };
		if (templateId) next.templateId = templateId;
		else delete next.templateId;
		s.entityService.update(cur.id, { nativeNote: next });
		void this.schedule(cur.id, 0);
		return prev;
	}

	async open(entity: EntityRecord, newLeaf: boolean | 'split' | 'tab' = 'tab'): Promise<void> {
		const file = this.file(entity);
		if (!file) {
			new Notice('The native note was not found. Relink it or create it again from the note menu.');
			return;
		}
		await this.app.workspace.getLeaf(newLeaf === 'split' ? 'split' : newLeaf === false ? false : 'tab').openFile(file);
	}

	private followRename(id: string, path: string): void {
		const s = this.session;
		const cur = s?.entities.get(id);
		if (!s || !cur?.nativeNote) return;
		this.byPath.delete(cur.nativeNote.path);
		this.byPath.set(path, id);
		const exp = this.expected.get(cur.nativeNote.path);
		if (exp) this.expected.set(path, exp);
		this.applying.add(id);
		try {
			s.entityService.update(id, { nativeNote: { ...cur.nativeNote, path, status: cur.nativeNote.status === 'missing' ? 'ok' : cur.nativeNote.status } });
		} finally {
			this.applying.delete(id);
		}
		// Links to it in other notes point at the new path.
		this.scheduleNeighbours(s.entities.get(id)!);
	}

	private markMissing(id: string): void {
		const s = this.session;
		const cur = s?.entities.get(id);
		if (!s || !cur?.nativeNote || cur.nativeNote.status === 'missing') return;
		if (this.byPath.get(cur.nativeNote.path) === id) this.byPath.delete(cur.nativeNote.path);
		this.applying.add(id);
		try {
			// Not unlinked: the values stay, and Relink / Create again are offered.
			s.entityService.update(id, { nativeNote: { ...cur.nativeNote, status: 'missing' } });
		} finally {
			this.applying.delete(id);
		}
		this.states.delete(id);
		this.events.emit('native-note:status', { entityId: id });
		this.scheduleNeighbours(cur);
	}

	/** D4: renaming an entry renames its note (links everywhere follow, through Obsidian). */
	private renaming = new Set<string>();
	/** While Obsidian updates links after a rename, notes aren't written (its link fixes use positions it read before). */
	private quietUntil = 0;
	private renamesInFlight = 0;
	private quietTimer: number | null = null;
	/** The note path each entry had last time, so neighbours follow only real changes. */
	private lastPaths = new Map<string, string | null>();
	private renameAgain = new Set<string>();
	private async renameWithEntry(entity: EntityRecord): Promise<void> {
		if (this.renaming.has(entity.id)) {
			// Renamed again while the last rename runs: follow the newest name afterwards.
			this.renameAgain.add(entity.id);
			return;
		}
		const file = this.file(entity);
		if (!file) return;
		const want = sanitizeFileName(entity.name);
		if (file.basename === want || file.basename.replace(/ \d+$/, '') === want) return;
		const dir = file.parent?.path && file.parent.path !== '/' ? file.parent.path + '/' : '';
		let path = normalizePath(`${dir}${want}.md`);
		for (let n = 2; this.app.vault.getAbstractFileByPath(path); n++) path = normalizePath(`${dir}${want} ${n}.md`);
		this.renaming.add(entity.id);
		this.renamesInFlight++;
		try {
			await this.app.fileManager.renameFile(file, path);
		} catch (e) {
			console.warn('[Worldsmith] could not rename the native note', e);
			this.reportFailure(entity.id, 'rename', e);
		} finally {
			this.renamesInFlight--;
			this.quiet();
			this.renaming.delete(entity.id);
			if (this.renameAgain.delete(entity.id)) {
				const cur = this.session?.entities.get(entity.id);
				if (cur) void this.renameWithEntry(cur);
			}
		}
	}

	/**
	 * After the world opens: find notes that moved while Worldsmith was off (by their
	 * `worldsmith-id`), then reconcile every note whose file or entry changed since the last
	 * time. Unchanged notes are skipped without being read.
	 */
	async start(): Promise<{ checked: number; queued: number; rematched: number; missing: number; ms: number }> {
		const t0 = performance.now();
		const s = this.session;
		const res = { checked: 0, queued: 0, rematched: 0, missing: 0, ms: 0 };
		if (!s) return res;
		this.byPath.clear();
		const withNotes: EntityRecord[] = [];
		for (const e of s.entities.values()) if (e.nativeNote) withNotes.push(e);
		if (!withNotes.length) return res;
		let index: Map<string, string> | null = null;
		const scan = () => {
			if (index) return index;
			index = new Map();
			for (const f of this.app.vault.getMarkdownFiles()) {
				const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
				const id = fm?.['worldsmith-id'];
				if (typeof id === 'string' && (fm?.['worldsmith-world'] === undefined || fm['worldsmith-world'] === s.worldId)) index.set(id, f.path);
			}
			return index;
		};
		for (const e of withNotes) {
			const nn = e.nativeNote!;
			res.checked++;
			let file = this.app.vault.getFileByPath(nn.path);
			// Only this entry's own note counts (a different note made at its old path doesn't).
			if (file && !(await this.ownsFile(e, file, s.worldId))) file = null;
			if (this.stale(s)) return res;
			if (!file) {
				const moved = scan().get(e.id);
				if (moved) {
					this.followRename(e.id, moved);
					res.rematched++;
					file = this.app.vault.getFileByPath(moved);
				} else {
					this.markMissing(e.id);
					res.missing++;
					continue;
				}
			}
			this.byPath.set(file!.path, e.id);
			this.lastPaths.set(e.id, file!.path);
			if (nn.status === 'missing' && file) this.followRename(e.id, file.path);
			const fresh = s.entities.get(e.id)!;
			if (fresh.nativeNote?.mtime === file!.stat.mtime && fresh.nativeNote?.fileHash && fresh.nativeNote.status !== 'conflict' && this.upToDate(fresh)) continue;
			res.queued++;
			void this.schedule(e.id, 50);
		}
		res.ms = Math.round(performance.now() - t0);
		return res;
	}

	/** Whether Worldsmith's side would write nothing new (in memory: no file is read). */
	private upToDate(e: EntityRecord): boolean {
		const input = this.planInput(e, '');
		const nn = e.nativeNote;
		if (!input || !nn) return false;
		for (const p of input.props) {
			if (nn.base[p.id] !== p.wsCanon) return false;
			// A field renamed since: its property key moves.
			if (!p.id.startsWith('p:__') && nn.base[`k:${p.id}`] !== p.key) return false;
		}
		for (const r of input.regions) {
			const b = nn.base[`${r.kind === 'field' ? 'f' : 'v'}:${r.id}`];
			if (b === undefined) {
				if (r.optional && !r.ws.trim()) continue;
				return false;
			}
			if (b !== wsHashOf(r) && !nn.detached?.includes(r.id)) return false;
			if (r.heading !== undefined && nn.base[`h:${r.id}`] !== r.heading) return false;
		}
		return true;
	}

	/** Note texts of the open world's native notes (backups). */
	async collect(): Promise<Array<{ path: string; content: string }>> {
		const s = this.session;
		if (!s) return [];
		const out: Array<{ path: string; content: string }> = [];
		for (const e of s.entities.values()) {
			const f = e.nativeNote ? this.app.vault.getFileByPath(e.nativeNote.path) : null;
			if (f) out.push({ path: f.path, content: await this.app.vault.read(f) });
		}
		return out;
	}

	/** Whether a note has a region whose markers are broken (it is then never written). */
	brokenRegions(text: string): string[] {
		return parseNote(text).broken;
	}

	private async ensureFolder(path: string): Promise<void> {
		if (!path) return;
		const parts = path.split('/');
		let cur = '';
		for (const p of parts) {
			cur = cur ? `${cur}/${p}` : p;
			if (!this.app.vault.getAbstractFileByPath(cur)) {
				try {
					await this.app.vault.createFolder(cur);
				} catch {
					/* created concurrently */
				}
			}
		}
	}
}
