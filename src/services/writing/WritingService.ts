import { DEFAULT_SCENE_STATUSES, RECORD_VERSIONS } from '../../app/constants';
import type { EventBus } from '../../core/events/EventBus';
import type { WorldsmithEvents, WritingChangeReason } from '../../core/events/events';
import type { CharacterArc, ResearchItem, ChronoDate, ManuscriptItem, ManuscriptKind, ManuscriptPatch, PlotThread, ProjectKind, SceneStatus, StoryBeat, WritingProject, WritingTemplate } from '../../core/types';
import { PROJECT_KINDS } from '../../core/types';
import type { Disposable } from '../../core/util/disposable';
import { mapLimit } from '../../core/util/async';
import { uuid } from '../../core/util/ids';
import { splitNote } from '../../core/util/strings';
import { hydrateManuscriptItem, hydrateWritingProject, hydrateWritingTemplate } from '../../data/migrations/records';
import type { BucketStore } from '../../data/storage/BucketStore';
import { ManuscriptIndex } from './ManuscriptIndex';
import { addWords, dayKey } from './progress';
import { sessionDelta } from './session';
import { beatsFrom, checkStatuses, checkThreads, editList, sceneCount, templateFrom } from './planning';
import { storyStructure } from './structures';
import { structureTemplate, type TemplateNode } from './templates';
import { baseName, sceneTitle, cleanPath, createNewNote, fileName, inFolder, naturalPathCompare, parentFolder, safeNoteName, type ManuscriptVault, type VaultChange } from './vault';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** What each kind may hold. `root` is the top level of a project. */
const CAN_HOLD: Record<'root' | ManuscriptKind, readonly ManuscriptKind[]> = {
	root: ['part', 'chapter', 'scene'],
	part: ['chapter', 'scene'],
	chapter: ['scene'],
	scene: [],
};

const KIND_WORD: Record<ManuscriptKind, string> = { part: 'Part', chapter: 'Chapter', scene: 'Scene' };

/**
 * How to take an operation back. Every change returns one; `WritingService.undo` applies
 * it. Undo never deletes: items an operation created go to Worldsmith's trash, and notes
 * it created stay in the vault.
 */
export type WritingUndo =
	| {
			kind: 'records';
			label: string;
			projectId: string;
			before: ManuscriptItem[];
			created: string[];
			/**
			 * The fields undo puts back onto the CURRENT records (never whole records, so later
			 * renames followed, edits to other fields and other changes survive the undo).
			 */
			keys: ReadonlyArray<keyof ManuscriptItem>;
			/**
			 * The same records (and every sibling around them) right after the operation. Undo
			 * only puts a field back while it still holds this value, so later, unrelated
			 * changes (a sibling moved elsewhere or trashed since) are kept.
			 */
			after: ManuscriptItem[];
	  }
	| {
			kind: 'split';
			label: string;
			projectId: string;
			sceneId: string;
			newSceneId: string;
			newPath: string;
			/** The first note's text before and after the split. */
			original: string;
			written: string;
			/** The new note's text as created. */
			tail: string;
			before: ManuscriptItem[];
			after: ManuscriptItem[];
	  }
	| {
			kind: 'merge';
			label: string;
			projectId: string;
			firstId: string;
			secondId: string;
			/** The first note's text before and after the merge. */
			original: string;
			written: string;
			before: ManuscriptItem[];
			/** The first scene's record right after the merge (only fields still as merged are put back). */
			after: ManuscriptItem;
	  };

/** What a structure change (move, trash, create, import…) touches, and its undo puts back. */
const STRUCTURE_KEYS: ReadonlyArray<keyof ManuscriptItem> = ['parentId', 'order', 'trashedAt'];

export interface RestoreResult {
	item: ManuscriptItem;
	/**
	 * Notes another scene took while these were in the trash: the restored scenes were
	 * unlinked from them (two scenes never share a note). Paths.
	 */
	unlinked: string[];
}

export interface CreateProjectInput {
	name: string;
	kind?: ProjectKind;
	/** Vault folder for the notes; defaults to the project name at the top of the vault. */
	folder?: string;
	description?: string;
	wordTarget?: number | null;
	/** Structure template id (`STRUCTURE_TEMPLATES`); blank by default. */
	template?: string;
	/** Also create an empty note for every scene of the template. Off by default. */
	createNotes?: boolean;
}

export interface ImportFolderInput {
	folder: string;
	/** Add to this project instead of making a new one. */
	projectId?: string;
	name?: string;
	kind?: ProjectKind;
	/** Each subfolder becomes a chapter holding its notes (default true); off = every note a scene at the top level. */
	chapters?: boolean;
}

export interface ImportResult {
	project: WritingProject;
	/** New chapters and scenes, in manuscript order. */
	items: ManuscriptItem[];
	/** Notes left out because a scene already uses them. */
	skipped: string[];
	undo: WritingUndo;
}

export interface CreateItemInput {
	kind: ManuscriptKind;
	title?: string;
	/** null/undefined = top level. */
	parentId?: string | null;
	/** Position among the parent's (visible) children; default at the end. */
	index?: number;
	synopsis?: string;
	/** Scenes: create a new empty note for it (default true). */
	note?: boolean;
}

export interface MoveTarget {
	parentId: string | null;
	/** Final position among the target's visible children (the moved items not counted). */
	index: number;
}

export interface OutlineNode {
	item: ManuscriptItem;
	depth: number;
	children: OutlineNode[];
}

export interface OutlineRow {
	item: ManuscriptItem;
	depth: number;
}

export type NoteState = 'ok' | 'missing' | 'none' | 'unknown';

export interface RematchReport {
	fixed: Array<{ id: string; from: string; to: string }>;
	/** More than one note could be it: the person chooses (`rematchCandidates`). */
	ambiguous: string[];
	notFound: string[];
}

/**
 * The Writing Studio's data (WS2): projects and their parts, chapters and scenes.
 *
 * Rules this class keeps:
 *  - The manuscript text lives in ordinary notes; this class never deletes, renames,
 *    overwrites or rewrites a note. Notes are created only for a new scene (or a copy or
 *    split of one) at a free path, and changed only by split and merge, through the
 *    vault's atomic `process`, after the new text is safely elsewhere.
 *  - Removing an item moves its record to Worldsmith's trash; the note stays.
 *  - Renames and moves in the vault are followed live; a note that disappeared is
 *    reported (`missingNotes`), never "fixed" by touching notes.
 *  - Every change returns a `WritingUndo`.
 */
export class WritingService {
	readonly words: ManuscriptIndex;
	private vaultRef: ManuscriptVault | null = null;
	private vaultSub: Disposable | null = null;
	/** note path → ids of scenes (live or trashed) linked to it. */
	private byPath = new Map<string, Set<string>>();
	/** Scenes being split or merged right now: a second operation on them is refused. */
	private busy = new Set<string>();

	constructor(
		private readonly projectStore: BucketStore<WritingProject>,
		private readonly itemStore: BucketStore<ManuscriptItem>,
		private readonly events: EventBus<WorldsmithEvents>,
		/** Planning templates the writer saved (WS4); absent in a few old tests. */
		private readonly templateStore: BucketStore<WritingTemplate> | null = null,
	) {
		for (const i of itemStore.values()) this.indexPath(i, null);
		this.words = new ManuscriptIndex({
			vault: () => this.vaultRef,
			scenesAt: (p) => [...(this.byPath.get(p) ?? [])].map((id) => this.itemStore.get(id)).filter((i): i is ManuscriptItem => !!i),
			scenesOf: (id) => this.scenesRaw(id),
			changed: (projectId, sceneIds) => {
				this.events.emit('writing:words', { projectId, sceneIds });
				if (sceneIds[0]) this.lastScene.set(projectId, sceneIds[0]);
				this.recordWords(projectId);
			},
		});
	}

	// ── vault ──────────────────────────────────────────────────────────────────

	/** Connect the vault (the app does this when the world opens). Follows its events. */
	attach(vault: ManuscriptVault): void {
		this.vaultSub?.dispose();
		this.vaultRef = vault;
		this.vaultSub = vault.onChange((c) => this.onVaultChange(c));
		// A studio page drawn before the vault was ready (Obsidian restoring it at startup)
		// can now tell which notes are there.
		for (const p of this.projectStore.all()) this.emit(p.id, [], 'notes');
	}

	get vault(): ManuscriptVault | null {
		return this.vaultRef;
	}

	private requireVault(): ManuscriptVault {
		if (!this.vaultRef) throw new Error('The vault isn’t ready yet.');
		return this.vaultRef;
	}

	private onVaultChange(c: VaultChange): void {
		if (c.type === 'rename') this.followRename(c.oldPath, c.path, c.folder);
		else if (c.type === 'delete' || c.type === 'create') {
			// The scene keeps pointing at the path: a note put back (or restored from
			// Obsidian's trash) is simply found again.
			const touched = this.scenesUnder(c.path, c.folder);
			for (const [projectId, ids] of groupByProject(touched)) this.emit(projectId, ids, 'notes');
		}
		this.words.handle(c);
	}

	/** Follow a note (or a folder of notes) renamed or moved in the vault. */
	private followRename(oldPath: string, path: string, folder: boolean): void {
		const moved = this.scenesUnder(oldPath, folder);
		const touched = new Map<string, string[]>();
		for (const s of moved) {
			const next = folder ? path + s.notePath!.slice(oldPath.length) : path;
			this.save({ ...s, notePath: next });
			touched.set(s.projectId, [...(touched.get(s.projectId) ?? []), s.id]);
		}
		if (folder) {
			for (const p of this.projectStore.values()) {
				if (!p.folder || !inFolder(p.folder, oldPath)) continue;
				this.saveProject({ ...p, folder: path + p.folder.slice(oldPath.length) });
				touched.set(p.id, [...(touched.get(p.id) ?? []), p.id]);
			}
		}
		for (const [projectId, ids] of touched) this.emit(projectId, ids, 'notes');
	}

	private scenesUnder(path: string, folder: boolean): ManuscriptItem[] {
		const out: ManuscriptItem[] = [];
		// A single note is one lookup (Obsidian sends an event per file, e.g. on startup).
		const entries: Iterable<[string, Set<string>]> = folder ? this.byPath : this.byPath.has(path) ? [[path, this.byPath.get(path)!]] : [];
		for (const [p, ids] of entries) {
			if (p !== path && !(folder && inFolder(p, path))) continue;
			for (const id of ids) {
				const s = this.itemStore.get(id);
				if (s) out.push(s);
			}
		}
		return out;
	}

	// ── projects ───────────────────────────────────────────────────────────────

	/** Projects in list order; archived ones only when asked. */
	projects(opts: { archived?: boolean | 'all' } = {}): WritingProject[] {
		const want = opts.archived ?? false;
		return this.projectStore
			.all()
			.filter((p) => want === 'all' || (want ? p.archivedAt !== null : p.archivedAt === null))
			.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt)
			.map(clone);
	}

	project(id: string | null | undefined): WritingProject | undefined {
		const p = id ? this.projectStore.get(id) : undefined;
		return p ? clone(p) : undefined;
	}

	/** A new project, optionally from a structure template. Notes only when asked. */
	/**
	 * The project and its items are saved first; if a note then can't be made (say the
	 * folder name is taken by a file), the project is still returned, with `notesError`,
	 * so a second try never makes a second project.
	 */
	async createProject(input: CreateProjectInput): Promise<{ project: WritingProject; items: ManuscriptItem[]; notes: string[]; notesError?: string }> {
		const name = input.name.trim() || 'Untitled project';
		const project = this.newProject({ name, kind: input.kind, folder: input.folder?.trim() ? cleanPath(input.folder) : safeNoteName(name), description: input.description, wordTarget: input.wordTarget });
		const items: ManuscriptItem[] = [];
		// A node a parent can't hold (say a part inside a chapter, from a hand-edited template) is skipped, with what's inside it.
		const add = (nodes: TemplateNode[], parentId: string | null, parentKind: 'root' | ManuscriptKind = 'root') =>
			nodes
				.filter((n) => CAN_HOLD[parentKind].includes(n.kind))
				.forEach((n, i) => {
					const it = this.newItem(project, { kind: n.kind, title: n.title, synopsis: n.synopsis, parentId, order: i });
					items.push(it);
					if (n.children?.length) add(n.children, it.id, n.kind);
				});
		// One of the writer's own templates (WS4): its outline, statuses, threads and beats.
		const own = input.template?.startsWith('own:') ? this.template(input.template.slice(4)) : undefined;
		if (own) {
			if (own.statuses.length) {
				project.statuses = clone(own.statuses);
				project.defaultStatus = own.defaultStatus && own.statuses.some((x) => x.id === own.defaultStatus) ? own.defaultStatus : own.statuses[0]!.id;
			}
			project.threads = clone(own.threads);
			if (own.beats.length) {
				project.beats = beatsFrom(own.beats, `own:${own.id}`);
				project.structure = `own:${own.id}`;
			}
			add(own.outline, null);
		} else add(structureTemplate(input.template).build(), null);
		this.saveProject(project);
		for (const it of items) this.save(it);
		const notes: string[] = [];
		let notesError: string | undefined;
		if (input.createNotes) {
			try {
				for (const it of items) {
					if (it.kind !== 'scene') continue;
					const made = await this.createNote(it.id);
					if (made) notes.push(made);
				}
			} catch (e) {
				notesError = e instanceof Error ? e.message : String(e);
			}
		}
		this.emit(project.id, [project.id], 'project');
		return { project: clone(this.projectStore.get(project.id)!), items: this.scenesAndAll(project.id), notes, ...(notesError ? { notesError } : {}) };
	}

	private newProject(init: { name: string; kind?: ProjectKind; folder: string; description?: string; wordTarget?: number | null }): WritingProject {
		const now = Date.now();
		const last = Math.max(-1, ...this.projectStore.all().map((p) => p.order));
		return hydrateWritingProject({
			v: RECORD_VERSIONS.writingProject,
			id: uuid(),
			name: init.name,
			kind: init.kind && PROJECT_KINDS.includes(init.kind) ? init.kind : 'novel',
			folder: init.folder,
			description: init.description ?? '',
			statuses: DEFAULT_SCENE_STATUSES.map((s) => ({ ...s })),
			defaultStatus: DEFAULT_SCENE_STATUSES[0]!.id,
			threads: [],
			retiredStatuses: [],
			retiredThreads: [],
			beats: [],
			structure: null,
			wordTarget: init.wordTarget ?? null,
			archivedAt: null,
			order: last + 1,
			createdAt: now,
			updatedAt: now,
			rev: 0,
		})!.record;
	}

	/** Change a project's settings (name, kind, folder, statuses, threads, goal…). Returns the version before. */
	updateProject(id: string, patch: Partial<Omit<WritingProject, 'id' | 'v' | 'createdAt' | 'updatedAt' | 'rev'>>): { before: WritingProject; after: WritingProject } {
		const prev = this.requireProject(id);
		const next = { ...clone(prev), ...clone(patch), id };
		if (patch.folder !== undefined) next.folder = cleanPath(patch.folder);
		const after = this.saveProject(next);
		this.emit(id, [id], 'project');
		return { before: clone(prev), after: clone(after) };
	}

	/**
	 * WS5: a character's arc in a project (where they start, where they end). Empty text removes
	 * it. The undo restores just that character's arc onto the current project.
	 */
	setArc(projectId: string, entityId: string, patch: Partial<CharacterArc>): () => void {
		const prev = this.requireProject(projectId);
		const before = prev.arcs?.[entityId] ? { ...prev.arcs[entityId] } : null;
		const merged: CharacterArc = { ...(before ?? { start: '', end: '' }), ...patch };
		for (const k of ['start', 'end', 'wants', 'needs', 'flaw', 'internal', 'external', 'arc'] as const) if (typeof merged[k] === 'string') merged[k] = (merged[k]).trimEnd();
		const has = merged.start || merged.end || ['wants', 'needs', 'flaw', 'internal', 'external', 'arc'].some((k) => merged[k as 'wants']) || (merged.points && Object.keys(merged.points).length) || (merged.turning && Object.keys(merged.turning).length);
		const arcs = { ...(prev.arcs ?? {}) };
		if (has) arcs[entityId] = merged;
		else delete arcs[entityId];
		this.updateProject(projectId, { arcs });
		return () => {
			const cur = this.project(projectId);
			if (!cur) return;
			const back = { ...(cur.arcs ?? {}) };
			if (before) back[entityId] = before;
			else delete back[entityId];
			this.updateProject(projectId, { arcs: back });
		};
	}

	renameProject(id: string, name: string): { before: WritingProject; after: WritingProject } {
		return this.updateProject(id, { name: name.trim() || this.requireProject(id).name });
	}

	/** Hide a project from the studio. Nothing else changes (notes, scenes, counts). */
	archiveProject(id: string): WritingProject {
		return this.updateProject(id, { archivedAt: Date.now() }).after;
	}

	unarchiveProject(id: string): WritingProject {
		return this.updateProject(id, { archivedAt: null }).after;
	}

	/**
	 * Undo of updateProject: puts back only the fields that change made (and nobody changed
	 * since), so a later rename or archive survives undoing an earlier edit. Without `after`
	 * the whole record is put back.
	 */
	restoreProject(before: WritingProject, after?: WritingProject): void {
		const cur = this.projectStore.get(before.id);
		if (!cur) return;
		if (!after) {
			this.saveProject({ ...clone(before), rev: Math.max(before.rev, cur.rev) });
		} else {
			const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
			const next: Record<string, unknown> = { ...clone(cur) };
			let changed = false;
			for (const k of Object.keys(before) as Array<keyof WritingProject>) {
				if (k === 'rev' || k === 'updatedAt' || k === 'v' || k === 'id' || k === 'createdAt') continue;
				if (same(before[k], after[k]) || !same(cur[k], after[k])) continue;
				next[k] = clone(before[k]);
				changed = true;
			}
			if (!changed) return;
			this.saveProject(next as unknown as WritingProject);
		}
		this.emit(before.id, [before.id], 'project');
	}

	/** Reorder the project list. */
	moveProject(id: string, index: number): void {
		const list = this.projects({ archived: 'all' }).filter((p) => p.id !== id);
		const p = this.requireProject(id);
		list.splice(clampIndex(index, list.length), 0, p);
		list.forEach((x, i) => x.order !== i && this.saveProject({ ...this.projectStore.get(x.id)!, order: i }));
		this.emit(id, [id], 'project');
	}

	private requireProject(id: string): WritingProject {
		const p = this.projectStore.get(id);
		if (!p) throw new Error('That project no longer exists.');
		return p;
	}

	// ── story planning (WS4) ───────────────────────────────────────────────────

	/**
	 * A new status list (names, colours, order, done, default). A status taken off the list
	 * goes to the project's retired statuses: its scenes keep it (shown as "No status") and
	 * it can be brought back. Scenes are never changed here.
	 */
	setStatuses(projectId: string, next: SceneStatus[], defaultStatus?: string): { before: WritingProject; after: WritingProject } {
		const p = this.requireProject(projectId);
		const why = checkStatuses(next);
		if (why) throw new Error(why);
		const { list, retired } = editList(p.statuses, clone(next), p.retiredStatuses);
		const def = defaultStatus && list.some((x) => x.id === defaultStatus) ? defaultStatus : list.some((x) => x.id === p.defaultStatus) ? p.defaultStatus : list[0]!.id;
		return this.updateProject(projectId, { statuses: list, retiredStatuses: retired, defaultStatus: def });
	}

	/** Give every scene with one status another (e.g. before or after removing it). Undoable. */
	reassignStatus(projectId: string, from: string, to: string): { count: number; undo: WritingUndo } {
		this.requireProject(projectId);
		const scenes = this.scenesRaw(projectId).filter((s) => s.status === from);
		const before = scenes.map(clone);
		const after = scenes.map((s) => clone(this.save({ ...s, status: to })));
		if (scenes.length) this.emit(projectId, scenes.map((s) => s.id), 'details');
		return { count: scenes.length, undo: { kind: 'records', label: 'Change status', projectId, before, created: [], keys: ['status'], after } };
	}

	/**
	 * The Statuses dialog's save, as one step: everything is checked first (the list, and
	 * that each move goes to a status on the new list), then scenes with a removed status move
	 * where asked and the list changes. Moves from a status that stays on the list, or to one
	 * that isn't on it, are refused before anything changes. Undo with `undoStatuses`.
	 */
	editStatuses(
		projectId: string,
		next: SceneStatus[],
		defaultStatus: string | undefined,
		moves: Array<{ from: string; to: string }>,
	): { before: WritingProject; after: WritingProject; moved: number; undo: WritingUndo } {
		this.requireProject(projectId);
		const why = checkStatuses(next);
		if (why) throw new Error(why);
		const ids = new Set(next.map((s) => s.id));
		for (const m of moves) {
			if (ids.has(m.from)) throw new Error('A status still on the list can’t have its scenes moved here.');
			if (!ids.has(m.to)) throw new Error('Scenes can only move to a status on the new list.');
		}
		const from = new Map(moves.map((m) => [m.from, m.to]));
		const scenes = this.scenesRaw(projectId).filter((s) => from.has(s.status));
		const before = scenes.map(clone);
		const after = scenes.map((s) => clone(this.save({ ...s, status: from.get(s.status)! })));
		if (scenes.length) this.emit(projectId, scenes.map((s) => s.id), 'details');
		const r = this.setStatuses(projectId, next, defaultStatus);
		return { ...r, moved: scenes.length, undo: { kind: 'records', label: 'Change statuses', projectId, before, created: [], keys: ['status'], after } };
	}

	/** Undo of `editStatuses`: the list (fields not changed since) and the scenes (statuses not changed since). */
	async undoStatuses(r: { before: WritingProject; after: WritingProject; undo: WritingUndo }): Promise<void> {
		this.restoreProject(r.before, r.after);
		await this.undo(r.undo);
	}

	/** A new plot-thread list. Threads taken off it are kept (retired); scenes keep their threads. */
	setThreads(projectId: string, next: PlotThread[]): { before: WritingProject; after: WritingProject } {
		const p = this.requireProject(projectId);
		const why = checkThreads(next);
		if (why) throw new Error(why);
		const { list, retired } = editList(p.threads, clone(next), p.retiredThreads);
		return this.updateProject(projectId, { threads: list, retiredThreads: retired });
	}

	/** Put a scene in a plot thread, or take it out. */
	toggleThread(sceneId: string, threadId: string, on?: boolean): WritingUndo {
		const s = this.requireItem(sceneId);
		const has = s.threads.includes(threadId);
		const want = on ?? !has;
		if (want === has) return { kind: 'records', label: 'Plot thread', projectId: s.projectId, before: [], created: [], keys: ['threads'], after: [] };
		return this.update(sceneId, { threads: want ? [...s.threads, threadId] : s.threads.filter((t) => t !== threadId) }).undo;
	}

	/** The in-story date and time of a scene (null clears them). Never written into the note. */
	setWhen(sceneId: string, date: ChronoDate | null, time: string | null = null): WritingUndo {
		return this.update(sceneId, { date, time: date ? time : null }).undo;
	}

	/**
	 * Show a structure on the Plot tab. Its beats are added the first time; beats of the
	 * structure shown before are kept (hidden) and come back when it is chosen again.
	 */
	useStructure(projectId: string, structure: string | null): { before: WritingProject; after: WritingProject } {
		const p = this.requireProject(projectId);
		let beats = p.beats;
		if (structure && structure !== 'custom' && !beats.some((b) => b.source === structure)) {
			const specs = structure.startsWith('own:') ? this.template(structure.slice(4))?.beats : storyStructure(structure)?.beats;
			if (!specs) throw new Error('That structure isn’t available.');
			beats = [...beats, ...beatsFrom(specs, structure)];
		}
		return this.updateProject(projectId, { beats, structure });
	}

	/** Change the beats (add, edit, remove, link scenes). Returns the project before and after, for Undo. */
	editBeats(projectId: string, fn: (beats: StoryBeat[]) => StoryBeat[]): { before: WritingProject; after: WritingProject } {
		const p = this.requireProject(projectId);
		const next = fn(clone(p.beats)).map((b) => ({ ...b, sceneIds: [...new Set(b.sceneIds)] }));
		return this.updateProject(projectId, { beats: next });
	}

	/**
	 * A planning skeleton: one new, empty chapter (no note) for each beat shown, at the end of
	 * the project. Nothing existing is moved or changed; Undo moves the new chapters to the trash.
	 */
	planChapters(projectId: string): { items: ManuscriptItem[]; undo: WritingUndo } {
		const p = this.requireProject(projectId);
		const beats = p.beats.filter((b) => b.source === p.structure);
		if (!beats.length) throw new Error('Choose a structure with beats first.');
		const before = this.siblings(projectId, null).map(clone);
		const items = beats.map((b) => this.newItem(p, { kind: 'chapter', title: b.label, synopsis: b.description, parentId: null, order: Number.MAX_SAFE_INTEGER }));
		for (const it of items) this.save(it);
		this.place(items.map((i) => i.id), projectId, null, Number.MAX_SAFE_INTEGER);
		this.emit(projectId, items.map((i) => i.id), 'structure');
		return { items: items.map((i) => clone(this.itemStore.get(i.id)!)), undo: { kind: 'records', label: 'Planned chapters', projectId, before, created: items.map((i) => i.id), keys: STRUCTURE_KEYS, after: this.afterOf(projectId, before, [null]) } };
	}

	// ── templates of your own (WS4) ────────────────────────────────────────────

	/** The writer's own templates (not deleted), by name. */
	templates(): WritingTemplate[] {
		return (this.templateStore?.all() ?? [])
			.filter((t) => t.trashedAt === null)
			.sort((a, b) => a.name.localeCompare(b.name))
			.map(clone);
	}

	template(id: string): WritingTemplate | undefined {
		const t = this.templateStore?.get(id);
		return t && t.trashedAt === null ? clone(t) : undefined;
	}

	/** Save a project's structure (titles, synopses, beats, statuses, threads; never note text) as a template. */
	saveTemplate(projectId: string, name: string, description = ''): WritingTemplate {
		const store = this.templateStore;
		if (!store) throw new Error('Templates can’t be saved here.');
		const p = this.requireProject(projectId);
		const now = Date.now();
		const parts = templateFrom(p, this.tree(projectId));
		const n = sceneCount(parts.outline);
		const rec = hydrateWritingTemplate({
			v: RECORD_VERSIONS.writingTemplate,
			id: uuid(),
			name: name.trim() || `${p.name} template`,
			description: description.trim() || `Made from “${p.name}”: ${n === 1 ? '1 scene' : `${n} scenes`}${parts.beats.length ? `, ${parts.beats.length} beats` : ''}.`,
			...parts,
			trashedAt: null,
			createdAt: now,
			updatedAt: now,
			rev: 0,
		})!.record;
		store.put(rec);
		this.emit(projectId, [], 'project');
		return clone(rec);
	}

	/** Delete a template of your own (kept for Undo: `restoreTemplate`). Projects made from it don't change. */
	removeTemplate(id: string): void {
		const t = this.templateStore?.get(id);
		if (!t) return;
		this.templateStore!.put({ ...t, trashedAt: Date.now(), updatedAt: Date.now(), rev: t.rev + 1 });
		for (const p of this.projectStore.values()) this.emit(p.id, [], 'project');
	}

	restoreTemplate(id: string): void {
		const t = this.templateStore?.get(id);
		if (!t || t.trashedAt === null) return;
		this.templateStore!.put({ ...t, trashedAt: null, updatedAt: Date.now(), rev: t.rev + 1 });
		for (const p of this.projectStore.values()) this.emit(p.id, [], 'project');
	}

	// ── reading the structure ──────────────────────────────────────────────────

	item(id: string | null | undefined): ManuscriptItem | undefined {
		const i = id ? this.itemStore.get(id) : undefined;
		return i ? clone(i) : undefined;
	}

	/** Visible children of a parent (null = top level), in order. */
	children(projectId: string, parentId: string | null): ManuscriptItem[] {
		return this.siblings(projectId, parentId)
			.filter((i) => i.trashedAt === null)
			.map(clone);
	}

	/** The project as a tree (trashed items and what's inside them left out). */
	tree(projectId: string): OutlineNode[] {
		const kids = this.childMap(projectId);
		const walk = (parentId: string | null, depth: number): OutlineNode[] =>
			(kids.get(parentId) ?? []).filter((i) => i.trashedAt === null).map((item) => ({ item: clone(item), depth, children: walk(item.id, depth + 1) }));
		return walk(null, 0);
	}

	/** Every visible item in manuscript order with its depth (for the binder). `expandedOnly` skips what's inside collapsed items. */
	outline(projectId: string, opts: { expandedOnly?: boolean } = {}): OutlineRow[] {
		const out: OutlineRow[] = [];
		const walk = (nodes: OutlineNode[]) => {
			for (const n of nodes) {
				out.push({ item: n.item, depth: n.depth });
				if (!(opts.expandedOnly && n.item.collapsed)) walk(n.children);
			}
		};
		walk(this.tree(projectId));
		return out;
	}

	/** The project's scenes in manuscript order (the reading order of the book). */
	scenes(projectId: string): ManuscriptItem[] {
		return this.scenesRaw(projectId).map(clone);
	}

	private scenesRaw(projectId: string): ManuscriptItem[] {
		const kids = this.childMap(projectId);
		const out: ManuscriptItem[] = [];
		const walk = (parentId: string | null) => {
			for (const i of kids.get(parentId) ?? []) {
				if (i.trashedAt !== null) continue;
				if (i.kind === 'scene') out.push(i);
				walk(i.id);
			}
		};
		walk(null);
		return out;
	}

	private scenesAndAll(projectId: string): ManuscriptItem[] {
		return this.outline(projectId).map((r) => r.item);
	}

	/** Scenes inside an item (itself if it is a scene), in order. */
	scenesIn(id: string): ManuscriptItem[] {
		const it = this.itemStore.get(id);
		if (!it) return [];
		if (it.kind === 'scene') return [clone(it)];
		const inside = new Set(this.descendants(it).map((d) => d.id));
		return this.scenesRaw(it.projectId)
			.filter((s) => inside.has(s.id))
			.map(clone);
	}

	/** Words of a scene, chapter, part or (with a project id) the whole project, from the cache. */
	wordCount(id: string): number {
		if (this.projectStore.has(id)) return this.words.projectWords(id);
		return this.words.total(this.scenesIn(id));
	}

	/** Is this item visible (not trashed, nor inside something trashed)? */
	isLive(id: string): boolean {
		let cur = this.itemStore.get(id);
		const seen = new Set<string>();
		if (!cur) return false;
		while (cur) {
			if (cur.trashedAt !== null || seen.has(cur.id)) return false;
			seen.add(cur.id);
			// A parent that vanished (a hand-edited file) counts as the top level, as in `tree`.
			const parent: ManuscriptItem | undefined = cur.parentId !== null ? this.itemStore.get(cur.parentId) : undefined;
			if (!parent || parent.projectId !== cur.projectId) return this.projectStore.has(cur.projectId);
			cur = parent;
		}
		return false;
	}

	/** Items in Worldsmith's trash (the top of each trashed branch), newest first. */
	trashed(projectId?: string): ManuscriptItem[] {
		return this.itemStore
			.all()
			.filter((i) => i.trashedAt !== null && (!projectId || i.projectId === projectId))
			.sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0))
			.map(clone);
	}

	/** The scene (not trashed) linked to a note, if any. */
	sceneByPath(path: string): ManuscriptItem | undefined {
		for (const id of this.byPath.get(path) ?? []) if (this.isLive(id)) return this.item(id);
		return undefined;
	}

	// ── notes ──────────────────────────────────────────────────────────────────

	noteState(id: string): NoteState {
		const s = this.itemStore.get(id);
		if (!s || s.kind !== 'scene' || !s.notePath) return 'none';
		if (!this.vaultRef) return 'unknown';
		return this.vaultRef.file(s.notePath) ? 'ok' : 'missing';
	}

	/** Scenes (not trashed) whose note isn't where it was, e.g. renamed while Obsidian was closed. */
	missingNotes(projectId?: string): ManuscriptItem[] {
		const vault = this.vaultRef;
		if (!vault) return [];
		const out: ManuscriptItem[] = [];
		for (const p of projectId ? [projectId] : this.projectStore.all().map((x) => x.id)) {
			for (const s of this.scenesRaw(p)) if (s.notePath && !vault.file(s.notePath)) out.push(clone(s));
		}
		return out;
	}

	/**
	 * Notes that could be a missing scene's note: the same file name in the project's
	 * folder (then anywhere in the vault), not used by another scene. Best match first.
	 */
	rematchCandidates(sceneId: string): string[] {
		const vault = this.requireVault();
		const s = this.itemStore.get(sceneId);
		if (!s?.notePath) return [];
		const want = fileName(s.notePath).toLowerCase();
		const free = (p: string) => p !== s.notePath && !this.usedByOther(p, s.id);
		const folder = this.projectStore.get(s.projectId)?.folder ?? '';
		const near = (scope: string) =>
			vault
				.markdownFiles(scope)
				.map((f) => f.path)
				.filter((p) => fileName(p).toLowerCase() === want && free(p))
				.sort(naturalPathCompare);
		const inProject = folder ? near(folder) : [];
		return inProject.length ? inProject : near('');
	}

	/** Re-match every missing note that has exactly one candidate. Touches no note. */
	rematchAll(projectId?: string): RematchReport {
		const report: RematchReport = { fixed: [], ambiguous: [], notFound: [] };
		for (const s of this.missingNotes(projectId)) {
			const c = this.rematchCandidates(s.id);
			// Only a single match inside the project's own folder is linked automatically; a
			// same-named note elsewhere in the vault is offered, never chosen.
			const folder = this.projectStore.get(s.projectId)?.folder ?? '';
			if (c.length === 1 && folder && inFolder(c[0]!, folder)) {
				this.relink(s.id, c[0]!);
				report.fixed.push({ id: s.id, from: s.notePath!, to: c[0]! });
			} else (c.length ? report.ambiguous : report.notFound).push(s.id);
		}
		return report;
	}

	/** Point a scene at another existing note (the person chose it). */
	relink(sceneId: string, path: string): WritingUndo {
		const vault = this.requireVault();
		const s = this.requireItem(sceneId);
		if (s.kind !== 'scene') throw new Error('Only scenes have notes.');
		const clean = cleanPath(path);
		if (!vault.file(clean) || !/\.md$/i.test(clean)) throw new Error('That note doesn’t exist.');
		if (this.usedByOther(clean, s.id)) throw new Error('Another scene already uses that note.');
		const before = [clone(s)];
		const after = this.save({ ...s, notePath: clean });
		this.emit(s.projectId, [s.id], 'notes');
		void this.words.refresh(clean);
		return { kind: 'records', label: 'Link note', projectId: s.projectId, before, created: [], keys: ['notePath'], after: [clone(after)] };
	}

	/** Make a new empty note for a scene that has none (e.g. from a template). Returns its path. */
	async createNote(sceneId: string): Promise<string | null> {
		const s = this.requireItem(sceneId);
		if (s.kind !== 'scene') throw new Error('Only scenes have notes.');
		if (s.notePath && this.vaultRef?.file(s.notePath)) return null;
		const project = this.requireProject(s.projectId);
		const file = await createNewNote(this.requireVault(), project.folder, s.title, '');
		this.save({ ...this.itemStore.get(s.id)!, notePath: file.path });
		this.emit(s.projectId, [s.id], 'notes');
		void this.words.refresh(file.path);
		return file.path;
	}

	private usedByOther(path: string, exceptId: string): boolean {
		for (const id of this.byPath.get(path) ?? []) if (id !== exceptId && this.isLive(id)) return true;
		return false;
	}

	// ── import ─────────────────────────────────────────────────────────────────

	/**
	 * Link a folder of existing notes as scenes, in their natural file-name order
	 * ("Scene 2" before "Scene 10"). With `chapters`, each subfolder becomes a chapter
	 * holding its notes. Nothing in the vault is moved, renamed or changed.
	 */
	importFolder(input: ImportFolderInput): ImportResult {
		const vault = this.requireVault();
		const folder = cleanPath(input.folder);
		if (folder && !vault.isFolder(folder)) throw new Error(`There is no folder “${folder}”.`);
		const existing = input.projectId ? this.requireProject(input.projectId) : null;
		const project = existing ?? this.newProject({ name: input.name?.trim() || baseName(folder) || 'Imported project', kind: input.kind, folder });
		const files = vault
			.markdownFiles(folder)
			.map((f) => f.path)
			.sort(naturalPathCompare);
		const skipped: string[] = [];
		const created: ManuscriptItem[] = [];
		let rootOrder = existing ? this.siblings(project.id, null).length : 0;
		const chapterOf = new Map<string, { item: ManuscriptItem; next: number }>();
		// Importing into a project again: a subfolder that already has its chapter there fills it.
		if (existing && input.chapters !== false) {
			for (const ch of this.children(project.id, null)) {
				if (ch.kind === 'chapter' && !chapterOf.has(ch.title)) chapterOf.set(ch.title, { item: ch, next: this.siblings(project.id, ch.id).length });
			}
		}
		const newIds = new Set<string>();
		for (const path of files) {
			if (this.usedByOther(path, '')) {
				skipped.push(path);
				continue;
			}
			const rel = folder ? path.slice(folder.length + 1) : path;
			const sub = rel.includes('/') && input.chapters !== false ? rel.slice(0, rel.indexOf('/')) : null;
			let parentId: string | null = null;
			let order: number;
			if (sub !== null) {
				let ch = chapterOf.get(sub);
				if (!ch) {
					ch = { item: this.newItem(project, { kind: 'chapter', title: sub, parentId: null, order: rootOrder++ }), next: 0 };
					chapterOf.set(sub, ch);
					created.push(ch.item);
					newIds.add(ch.item.id);
				}
				parentId = ch.item.id;
				order = ch.next++;
			} else order = rootOrder++;
			created.push(this.newItem(project, { kind: 'scene', title: sceneTitle(path), parentId, order, notePath: path }));
		}
		if (!existing) this.saveProject(project);
		for (const it of created) this.save(it);
		this.emit(project.id, [project.id, ...created.map((i) => i.id)], existing ? 'structure' : 'project');
		// Count the newly linked notes (only these; the rest of the vault is never read).
		void mapLimit(created.filter((i) => i.notePath).map((i) => i.notePath!), 4, (path) => this.words.refresh(path));
		return {
			project: clone(this.projectStore.get(project.id)!),
			items: created.map(clone),
			skipped,
			// Undo trashes the top of every new branch (new chapters, and scenes added to existing ones).
			undo: { kind: 'records', label: 'Import notes', projectId: project.id, before: [], created: created.filter((i) => i.parentId === null || !newIds.has(i.parentId)).map((i) => i.id), keys: STRUCTURE_KEYS, after: [] },
		};
	}

	/** Link existing notes as scenes at a position (e.g. dropped from the file explorer). */
	linkNotes(projectId: string, paths: string[], at: Partial<MoveTarget> = {}): { items: ManuscriptItem[]; skipped: string[]; undo: WritingUndo } {
		const vault = this.requireVault();
		const project = this.requireProject(projectId);
		const parentId = at.parentId ?? null;
		this.checkParent(project.id, parentId, 'scene');
		const skipped: string[] = [];
		const items: ManuscriptItem[] = [];
		for (const raw of paths) {
			const path = cleanPath(raw);
			if (!vault.file(path) || !/\.md$/i.test(path) || this.usedByOther(path, '') || items.some((i) => i.notePath === path)) {
				skipped.push(path);
				continue;
			}
			items.push(this.newItem(project, { kind: 'scene', title: sceneTitle(path), parentId, order: 0, notePath: path }));
		}
		const before = this.siblings(projectId, parentId).map(clone);
		for (const it of items) this.save(it);
		if (items.length) this.place(items.map((i) => i.id), projectId, parentId, at.index ?? Number.MAX_SAFE_INTEGER);
		this.emit(projectId, items.map((i) => i.id), 'structure');
		void mapLimit(items.map((i) => i.notePath!), 4, (path) => this.words.refresh(path));
		return { items: items.map((i) => clone(this.itemStore.get(i.id)!)), skipped, undo: { kind: 'records', label: 'Add notes', projectId, before, created: items.map((i) => i.id), keys: STRUCTURE_KEYS, after: this.afterOf(projectId, before, [parentId]) } };
	}

	// ── creating, renaming, details ────────────────────────────────────────────

	/** A new part, chapter or scene. A scene gets a new empty note in the project folder unless `note: false`. */
	async create(projectId: string, input: CreateItemInput): Promise<{ item: ManuscriptItem; undo: WritingUndo }> {
		const project = this.requireProject(projectId);
		const parentId = input.parentId ?? null;
		this.checkParent(projectId, parentId, input.kind);
		const title = input.title?.trim() || this.nextTitle(projectId, input.kind);
		let notePath: string | null = null;
		// The note first: if it can't be made, nothing is added.
		if (input.kind === 'scene' && input.note !== false) notePath = (await createNewNote(this.requireVault(), project.folder, title, '')).path;
		const before = this.siblings(projectId, parentId).map(clone);
		const item = this.newItem(project, { kind: input.kind, title, synopsis: input.synopsis, parentId, order: Number.MAX_SAFE_INTEGER, notePath });
		this.save(item);
		this.place([item.id], projectId, parentId, input.index ?? Number.MAX_SAFE_INTEGER);
		this.emit(projectId, [item.id], 'structure');
		if (notePath) void this.words.refresh(notePath);
		return { item: clone(this.itemStore.get(item.id)!), undo: { kind: 'records', label: `New ${input.kind}`, projectId, before, created: [item.id], keys: STRUCTURE_KEYS, after: this.afterOf(projectId, before, [parentId]) } };
	}

	/** "Scene 4" (one more than the scenes there are). */
	private nextTitle(projectId: string, kind: ManuscriptKind): string {
		const n = this.itemStore.all().filter((i) => i.projectId === projectId && i.kind === kind && this.isLive(i.id)).length;
		return `${KIND_WORD[kind]} ${n + 1}`;
	}

	/** Rename an item. Only the record changes; the note keeps its file name. */
	rename(id: string, title: string): WritingUndo {
		return this.update(id, { title }).undo;
	}

	/** Change an item's details (status, synopsis, POV, cast, place, date, threads, goal, colour, purpose…). */
	update(id: string, patch: ManuscriptPatch): { before: ManuscriptItem; after: ManuscriptItem; undo: WritingUndo } {
		const prev = this.requireItem(id);
		const next: ManuscriptItem = { ...clone(prev) };
		for (const [k, v] of Object.entries(patch) as Array<[keyof ManuscriptPatch, unknown]>) if (v !== undefined) (next as unknown as Record<string, unknown>)[k] = clone(v);
		if (patch.title !== undefined && !patch.title.trim()) next.title = prev.title;
		const after = this.save(next);
		this.emit(prev.projectId, [id], patch.title !== undefined || patch.collapsed !== undefined ? 'structure' : 'details');
		const keys = (Object.keys(patch) as Array<keyof ManuscriptPatch>).filter((k) => patch[k] !== undefined);
		return { before: clone(prev), after: clone(after), undo: { kind: 'records', label: 'Edit', projectId: prev.projectId, before: [clone(prev)], created: [], keys, after: [clone(after)] } };
	}

	/** Binder state: show or hide what's inside a part or chapter. */
	setCollapsed(id: string, collapsed: boolean): void {
		const it = this.requireItem(id);
		if (it.collapsed === collapsed) return;
		this.save({ ...it, collapsed });
		this.emit(it.projectId, [id], 'structure');
	}

	/** Collapse or expand every part and chapter of a project. */
	setAllCollapsed(projectId: string, collapsed: boolean): void {
		const ids: string[] = [];
		for (const it of this.itemStore.values()) {
			if (it.projectId !== projectId || it.kind === 'scene' || it.collapsed === collapsed) continue;
			this.save({ ...it, collapsed });
			ids.push(it.id);
		}
		if (ids.length) this.emit(projectId, ids, 'structure');
	}

	// ── duplicate ──────────────────────────────────────────────────────────────

	/**
	 * Copy an item (with everything inside it) right after itself. Each scene's note is
	 * copied to a new note at a free path; nothing existing is touched. If a copy can't be
	 * made, no items are added (copies already written stay in the vault and are named in
	 * the error).
	 */
	async duplicate(id: string): Promise<{ items: ManuscriptItem[]; notes: string[]; undo: WritingUndo }> {
		const vault = this.requireVault();
		const src = this.requireItem(id);
		const project = this.requireProject(src.projectId);
		// What's in the trash inside it (and everything inside that) is not copied.
		const branch = [src, ...this.descendants(src, { live: true })];
		const map = new Map<string, string>(branch.map((b) => [b.id, uuid()]));
		const notes: string[] = [];
		const copies: ManuscriptItem[] = [];
		for (const b of branch) {
			let notePath: string | null = null;
			if (b.kind === 'scene' && b.notePath) {
				try {
					if (!vault.file(b.notePath)) throw new Error(`The note of “${b.title}” wasn’t found.`);
					const text = await vault.read(b.notePath);
					notePath = (await createNewNote(vault, parentFolder(b.notePath) || project.folder, b === src ? `${baseName(b.notePath)} copy` : baseName(b.notePath), text)).path;
					notes.push(notePath);
				} catch (e) {
					const msg = e instanceof Error ? e.message : String(e);
					throw new Error(notes.length ? `${msg} The copies made so far were kept: ${notes.join(', ')}` : msg);
				}
			}
			const now = Date.now();
			copies.push({
				...clone(b),
				id: map.get(b.id)!,
				parentId: b === src ? b.parentId : (map.get(b.parentId ?? '') ?? b.parentId),
				title: b === src ? `${b.title} copy` : b.title,
				notePath,
				createdAt: now,
				updatedAt: now,
				rev: 0,
			});
		}
		const before = this.siblings(src.projectId, src.parentId).map(clone);
		for (const c of copies) this.save(c);
		const at = this.siblings(src.projectId, src.parentId)
			.filter((i) => i.trashedAt === null && i.id !== copies[0]!.id)
			.findIndex((i) => i.id === src.id);
		this.place([copies[0]!.id], src.projectId, src.parentId, at + 1);
		this.emit(src.projectId, copies.map((c) => c.id), 'structure');
		void mapLimit(notes, 4, (path) => this.words.refresh(path));
		return { items: copies.map((c) => clone(this.itemStore.get(c.id)!)), notes, undo: { kind: 'records', label: 'Duplicate', projectId: src.projectId, before, created: [copies[0]!.id], keys: STRUCTURE_KEYS, after: this.afterOf(src.projectId, before, [src.parentId]) } };
	}

	// ── move and reorder ───────────────────────────────────────────────────────

	/**
	 * Move items (keeping their relative order) into a parent at a position: drag-reorder
	 * within a chapter, or to another chapter or part. Refuses moves the structure can't
	 * hold (a part inside a chapter, an item inside itself).
	 */
	move(ids: string | string[], to: MoveTarget): WritingUndo {
		const list = (Array.isArray(ids) ? ids : [ids]).map((i) => this.requireItem(i));
		if (!list.length) throw new Error('Nothing to move.');
		const projectId = list[0]!.projectId;
		if (list.some((i) => i.projectId !== projectId)) throw new Error('Items can only be moved within their project.');
		for (const it of list) this.checkParent(projectId, to.parentId, it.kind);
		// Not into itself or anything inside it.
		// (The visited set stops a parent loop in hand-edited data.)
		const seen = new Set<string>();
		for (let cur = to.parentId ? this.itemStore.get(to.parentId) : undefined; cur && !seen.has(cur.id); cur = cur.parentId ? this.itemStore.get(cur.parentId) : undefined) {
			seen.add(cur.id);
			if (list.some((i) => i.id === cur.id)) throw new Error('An item can’t go inside itself.');
		}
		// Keep manuscript order among the moved items.
		const pos = new Map(this.outlineAll(projectId).map((it, i) => [it.id, i]));
		list.sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0));
		const parents = new Set([to.parentId, ...list.map((i) => i.parentId)]);
		const before = [...parents].flatMap((p) => this.siblings(projectId, p)).map(clone);
		for (const it of list) if (it.parentId !== to.parentId) this.save({ ...it, parentId: to.parentId });
		this.place(
			list.map((i) => i.id),
			projectId,
			to.parentId,
			to.index,
		);
		for (const p of parents) if (p !== to.parentId) this.renumber(projectId, p);
		this.emit(projectId, list.map((i) => i.id), 'structure');
		return { kind: 'records', label: 'Move', projectId, before, created: [], keys: STRUCTURE_KEYS, after: this.afterOf(projectId, before, parents) };
	}

	/** Every item (trashed too) in tree order: for sorting moved items. */
	private outlineAll(projectId: string): ManuscriptItem[] {
		const kids = this.childMap(projectId);
		const out: ManuscriptItem[] = [];
		const walk = (p: string | null) => {
			for (const i of kids.get(p) ?? []) {
				out.push(i);
				walk(i.id);
			}
		};
		walk(null);
		return out;
	}

	private checkParent(projectId: string, parentId: string | null, kind: ManuscriptKind): void {
		if (parentId === null) return;
		const parent = this.itemStore.get(parentId);
		if (!parent || parent.projectId !== projectId || !this.isLive(parentId)) throw new Error('That place in the manuscript no longer exists.');
		if (!CAN_HOLD[parent.kind].includes(kind)) throw new Error(`A ${parent.kind} can’t hold a ${kind}.`);
	}

	// ── trash ──────────────────────────────────────────────────────────────────

	/** Move an item (and what's inside it) to Worldsmith's trash. Its notes stay in the vault. */
	trash(id: string): WritingUndo {
		const it = this.requireItem(id);
		const before = [clone(it)];
		const after = this.save({ ...it, trashedAt: Date.now() });
		this.emit(it.projectId, [id], 'trash');
		return { kind: 'records', label: `Move ${it.kind} to trash`, projectId: it.projectId, before, created: [], keys: STRUCTURE_KEYS, after: [clone(after)] };
	}

	/**
	 * Bring an item back from the trash, where it was. If its chapter or part is gone
	 * (or still in the trash) it comes back at the end of the project.
	 */
	restore(id: string): RestoreResult {
		const it = this.requireItem(id);
		const parentOk = it.parentId === null || (this.isLive(it.parentId) && CAN_HOLD[this.itemStore.get(it.parentId)!.kind].includes(it.kind));
		// A merged scene put back is an ordinary scene again (it can be merged again).
		const { mergedInto: _m, ...rest } = it as ManuscriptItem & { mergedInto?: string };
		void _m;
		const next: ManuscriptItem = { ...rest, trashedAt: null, parentId: parentOk ? it.parentId : null };
		if (!parentOk) next.order = Number.MAX_SAFE_INTEGER;
		this.save(next);
		this.renumber(it.projectId, next.parentId);
		const unlinked = this.unlinkTaken([id]);
		this.emit(it.projectId, [id], 'trash');
		return { item: clone(this.itemStore.get(id)!), unlinked };
	}

	/**
	 * Scenes back from the trash (these items and what's inside them) whose note another
	 * live scene now uses are unlinked from it, so two scenes never share one note. The
	 * note itself is not touched. Returns the notes given up.
	 */
	private unlinkTaken(ids: string[]): string[] {
		const out: string[] = [];
		for (const id of ids) {
			const it = this.itemStore.get(id);
			if (!it || !this.isLive(id)) continue;
			for (const s of [it, ...this.descendants(it, { live: true })]) {
				const cur = this.itemStore.get(s.id)!;
				if (cur.kind !== 'scene' || !cur.notePath || !this.usedByOther(cur.notePath, cur.id)) continue;
				out.push(cur.notePath);
				this.save({ ...cur, notePath: null });
			}
		}
		return out;
	}

	/**
	 * Remove a trashed item's record for good (with what's inside it). Only Worldsmith's
	 * record goes: the notes stay in the vault, untouched.
	 */
	purge(id: string): ManuscriptItem[] {
		const it = this.requireItem(id);
		if (it.trashedAt === null) throw new Error('Only items in the trash can be removed for good.');
		const gone = [it, ...this.descendants(it)];
		for (const g of gone) {
			this.itemStore.delete(g.id);
			this.indexPath(null, g);
			if (g.notePath && !this.byPath.has(g.notePath)) this.words.forget(g.notePath);
		}
		this.emit(it.projectId, gone.map((g) => g.id), 'trash');
		return gone.map(clone);
	}

	// ── split and merge ────────────────────────────────────────────────────────

	/**
	 * Split a scene at a character offset in its note. The text after the offset goes into
	 * a NEW note (and a new scene right after this one); only once that note exists is the
	 * original trimmed, atomically, through `process`. If the note changed meanwhile or
	 * anything fails, the original is left exactly as it was.
	 */
	async split(sceneId: string, offset: number, opts: { title?: string; expectedText?: string } = {}): Promise<{ scene: ManuscriptItem; created: ManuscriptItem; undo: WritingUndo }> {
		const vault = this.requireVault();
		const s = this.requireItem(sceneId);
		if (s.kind !== 'scene') throw new Error('Only scenes can be split.');
		if (!s.notePath || !vault.file(s.notePath)) throw new Error('This scene’s note wasn’t found.');
		const release = this.claim([s.id]);
		try {
			return await this.splitNow(s, s.notePath, offset, opts);
		} finally {
			release();
		}
	}

	private async splitNow(s: ManuscriptItem, path: string, offset: number, opts: { title?: string; expectedText?: string }): Promise<{ scene: ManuscriptItem; created: ManuscriptItem; undo: WritingUndo }> {
		const vault = this.requireVault();
		const original = await vault.read(path);
		// The offset was measured against this text (what the Split dialog showed, say).
		if (opts.expectedText !== undefined && opts.expectedText !== original) throw new Error('The scene changed since you chose where to split it. Nothing was changed; try again.');
		const front = splitNote(original).front.length;
		if (!Number.isInteger(offset) || offset <= front || offset >= original.length) throw new Error('Put the cursor inside the text, where the new scene should start.');
		// Never between the two halves of one character (an emoji, say).
		if (isHighSurrogate(original.charCodeAt(offset - 1)) && isLowSurrogate(original.charCodeAt(offset))) throw new Error('That point is in the middle of a character. Choose another place to split.');
		const head = original.slice(0, offset).replace(/\s+$/, '');
		// Text that starts with "---" would read as front matter at the top of a new note.
		const rest = original.slice(offset).replace(/^\s+/, '');
		const tail = splitNote(rest).front ? `\n${rest}` : rest;
		if (head.length <= front || !head.slice(front).trim()) throw new Error('There is no text before the cursor to keep in this scene.');
		if (!tail) throw new Error('There is no text after the cursor to move into a new scene.');
		const written = `${head}\n`;
		const title = opts.title?.trim() || `${s.title} (continued)`;
		// 1. The second half goes to a new note first.
		const file = await createNewNote(vault, parentFolder(path), title, tail);
		// 2. Only then is the original trimmed, if it is still exactly what was read.
		try {
			await vault.process(path, (cur) => {
				if (cur !== original) throw new Error('The scene changed while it was being split. Nothing was changed in it; try again.');
				return written;
			});
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			throw new Error(`${msg} (A copy of the second half was saved in “${file.path}”.)`);
		}
		const before = this.siblings(s.projectId, s.parentId).map(clone);
		const project = this.requireProject(s.projectId);
		const created = this.newItem(project, { kind: 'scene', title, parentId: s.parentId, order: Number.MAX_SAFE_INTEGER, notePath: file.path });
		Object.assign(created, { status: s.status, pov: s.pov, cast: [...s.cast], location: s.location, date: clone(s.date), time: s.time, threads: [...s.threads], color: s.color });
		this.save(created);
		const at = this.siblings(s.projectId, s.parentId)
			.filter((i) => i.trashedAt === null && i.id !== created.id)
			.findIndex((i) => i.id === s.id);
		this.place([created.id], s.projectId, s.parentId, at + 1);
		this.emit(s.projectId, [s.id, created.id], 'structure');
		void this.words.refresh(path);
		void this.words.refresh(file.path);
		const after = this.afterOf(s.projectId, before, [s.parentId]);
		return {
			scene: clone(this.itemStore.get(s.id)!),
			created: clone(this.itemStore.get(created.id)!),
			undo: { kind: 'split', label: 'Split scene', projectId: s.projectId, sceneId: s.id, newSceneId: created.id, newPath: file.path, original, written, tail, before, after },
		};
	}

	/**
	 * Merge a scene into the one right before it in the manuscript. The second scene's
	 * text (without its front matter) is appended to the first note through `process`;
	 * the second note is left untouched and only its record goes to the trash, so nothing
	 * can be lost. Cast and threads are combined.
	 */
	async merge(firstId: string, secondId: string): Promise<{ scene: ManuscriptItem; undo: WritingUndo }> {
		const release = this.claim([firstId, secondId]);
		try {
			return await this.mergeNow(firstId, secondId);
		} finally {
			release();
		}
	}

	/** Mark scenes as being split or merged; refuses when one already is. */
	private claim(ids: string[]): () => void {
		if (ids.some((id) => this.busy.has(id))) throw new Error('That scene is being split or merged already. Try again in a moment.');
		for (const id of ids) this.busy.add(id);
		return () => {
			for (const id of ids) this.busy.delete(id);
		};
	}

	private async mergeNow(firstId: string, secondId: string): Promise<{ scene: ManuscriptItem; undo: WritingUndo }> {
		const vault = this.requireVault();
		const a = this.requireItem(firstId);
		const b = this.requireItem(secondId);
		if (a.kind !== 'scene' || b.kind !== 'scene') throw new Error('Only scenes can be merged.');
		if (a.projectId !== b.projectId || !this.isLive(a.id) || !this.isLive(b.id)) throw new Error('Both scenes must be in the same project.');
		const order = this.scenesRaw(a.projectId);
		const ia = order.findIndex((x) => x.id === a.id);
		if (order[ia + 1]?.id !== b.id) throw new Error('Only a scene and the one right after it can be merged.');
		if (!a.notePath || !vault.file(a.notePath)) throw new Error(`The note of “${a.title}” wasn’t found.`);
		if (!b.notePath || !vault.file(b.notePath)) throw new Error(`The note of “${b.title}” wasn’t found.`);
		if (a.notePath === b.notePath) throw new Error('Both scenes use the same note.');
		const addition = splitNote(await vault.read(b.notePath)).body.replace(/^\s+/, '').replace(/\s+$/, '');
		const read = await vault.read(a.notePath);
		let original = '';
		let written = '';
		await vault.process(a.notePath, (cur) => {
			// Checked again at the moment of writing: nothing else merged or edited meanwhile.
			const bNow = this.itemStore.get(b.id);
			if (!bNow || !this.isLive(b.id) || bNow.mergedInto) throw new Error('That scene was merged or moved to the trash meanwhile. Nothing was changed.');
			if (cur !== read) throw new Error('The scene changed while it was being merged. Nothing was changed in it; try again.');
			original = cur;
			if (!addition) written = cur;
			// A note with only front matter (or nothing) gets the text right after it.
			else if (!splitNote(cur).body.trim()) written = `${cur}${cur && !cur.endsWith('\n') ? '\n' : ''}${addition}\n`;
			else written = `${cur.replace(/\s+$/, '')}\n\n${addition}\n`;
			// Text starting with "---" at the top of an empty note would read as front matter.
			if (!splitNote(cur).front && splitNote(written).front) written = `\n${written}`;
			return written;
		});
		const before = [clone(a), clone(b)];
		const after = this.save({ ...a, cast: [...new Set([...a.cast, ...b.cast])], threads: [...new Set([...a.threads, ...b.threads])], synopsis: a.synopsis || b.synopsis });
		this.save({ ...b, trashedAt: Date.now(), mergedInto: a.id } as ManuscriptItem);
		this.emit(a.projectId, [a.id, b.id], 'structure');
		void this.words.refresh(a.notePath);
		return { scene: clone(this.itemStore.get(a.id)!), undo: { kind: 'merge', label: 'Merge scenes', projectId: a.projectId, firstId: a.id, secondId: b.id, original, written, before, after: clone(after) } };
	}

	// ── undo ───────────────────────────────────────────────────────────────────

	/**
	 * Take an operation back. Text changes are reverted only when the note is still exactly
	 * as the operation left it; otherwise this refuses (so later writing is never lost).
	 */
	async undo(u: WritingUndo): Promise<{ unlinked: string[] }> {
		// Items in the trash before the undo: if it brings one back, its note may be taken.
		const deadBefore = u.before.filter((r) => !this.isLive(r.id)).map((r) => r.id);
		if (u.kind === 'split') {
			const vault = this.requireVault();
			const s = this.requireItem(u.sceneId);
			if (!s.notePath) throw new Error('This scene has no note.');
			const tailNow = vault.file(u.newPath) ? await vault.read(u.newPath) : null;
			if (tailNow !== u.tail) throw new Error('The new scene was edited after the split, so it can’t be undone automatically.');
			await vault.process(s.notePath, (cur) => {
				if (cur !== u.written) throw new Error('The scene was edited after the split, so it can’t be undone automatically.');
				return u.original;
			});
			const created = this.itemStore.get(u.newSceneId);
			if (created) this.save({ ...created, trashedAt: Date.now() });
			this.putBack(u.projectId, u.before, u.after, STRUCTURE_KEYS);
			void this.words.refresh(s.notePath);
		} else if (u.kind === 'merge') {
			const vault = this.requireVault();
			const a = this.requireItem(u.firstId);
			if (!a.notePath) throw new Error('This scene has no note.');
			await vault.process(a.notePath, (cur) => {
				if (cur !== u.written) throw new Error('The scene was edited after the merge, so it can’t be undone automatically.');
				return u.original;
			});
			// The first scene: only what the merge set and nobody changed since.
			const aBefore = u.before.find((r) => r.id === u.firstId);
			const aNow = this.itemStore.get(u.firstId);
			if (aBefore && aNow) {
				const keys = (['cast', 'threads', 'synopsis'] as const).filter((k) => JSON.stringify(aNow[k]) === JSON.stringify(u.after[k]));
				this.putBack(u.projectId, [aBefore], [u.after], keys);
			}
			// The second scene comes back from the trash, where it was.
			const bBefore = u.before.find((r) => r.id === u.secondId);
			const bNow = this.itemStore.get(u.secondId);
			// (Unless it was put back by hand meanwhile: then it stays where it is now.)
			if (bBefore && bNow && bNow.trashedAt !== null) {
				const { mergedInto: _m, ...rest } = bNow;
				void _m;
				this.save({ ...rest, trashedAt: bBefore.trashedAt, parentId: bBefore.parentId, order: bBefore.order });
				this.renumber(u.projectId, bBefore.parentId);
			}
			void this.words.refresh(a.notePath);
		} else {
			// A note put back must not be one another scene uses now (two scenes never share one).
			if (u.keys.includes('notePath')) {
				for (const r of u.before) {
					const cur = this.itemStore.get(r.id);
					const a = u.after.find((x) => x.id === r.id);
					if (!cur || !a || !r.notePath || cur.notePath !== a.notePath || cur.notePath === r.notePath) continue;
					if (this.usedByOther(r.notePath, r.id)) throw new Error(`“${r.notePath}” is used by another scene now, so the old link can’t be put back. Nothing was changed.`);
				}
			}
			for (const id of u.created) {
				const c = this.itemStore.get(id);
				if (c && c.trashedAt === null) this.save({ ...c, trashedAt: Date.now() });
			}
			this.putBack(u.projectId, u.before, u.after, u.keys);
		}
		const unlinked = this.unlinkTaken(deadBefore);
		this.emit(u.projectId, [], 'structure');
		return { unlinked };
	}

	/**
	 * Put the given fields of `before` back onto the CURRENT records, but only fields the
	 * operation changed and nobody changed since (they still hold their `after` value).
	 * Then the order inside each parent the operation touched: when that parent wasn't
	 * reordered since, its items go back to their old order (newer items keep their place
	 * next to their neighbours); otherwise only items that came back into it are put back
	 * after their old neighbour, and the rest stays as it is now.
	 */
	private putBack(projectId: string, before: ManuscriptItem[], after: ManuscriptItem[], keys: ReadonlyArray<keyof ManuscriptItem>): void {
		const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
		const afterById = new Map(after.map((a) => [a.id, a]));
		const returning = new Set<string>();
		const parents = new Set<string | null>();
		for (const r of before) {
			const cur = this.itemStore.get(r.id);
			const a = afterById.get(r.id);
			if (!cur || !a) continue;
			parents.add(r.parentId);
			parents.add(a.parentId);
			parents.add(cur.parentId);
			const next: Record<string, unknown> = { ...clone(cur) };
			let changed = false;
			for (const k of keys) {
				if (k === 'order') continue;
				// Not changed by the operation, or changed again since: left as it is now.
				if (same(r[k], a[k]) || !same(cur[k], a[k])) continue;
				next[k] = clone(r[k]);
				changed = true;
				if (k === 'parentId') returning.add(r.id);
			}
			if (changed) this.save(next as unknown as ManuscriptItem);
		}
		if (!keys.includes('order') && !keys.includes('parentId')) return;
		const insertAfterNeighbour = (seq: string[], id: string, ref: string[]) => {
			let at = 0;
			for (let j = ref.indexOf(id) - 1; j >= 0; j--) {
				const k = seq.indexOf(ref[j]!);
				if (k >= 0) {
					at = k + 1;
					break;
				}
			}
			seq.splice(at, 0, id);
		};
		for (const p of parents) {
			const cur = this.siblings(projectId, p).map((i) => i.id);
			const beforeSeq = before.filter((r) => r.parentId === p).sort(byOrder).map((r) => r.id);
			const afterSeq = after.filter((r) => r.parentId === p).sort(byOrder).map((r) => r.id);
			const curSet = new Set(cur);
			const afterSet = new Set(afterSeq);
			const untouched = same(
				cur.filter((id) => afterSet.has(id)),
				afterSeq.filter((id) => curSet.has(id)),
			);
			let seq: string[];
			if (untouched && keys.includes('order')) {
				seq = beforeSeq.filter((id) => curSet.has(id));
				for (const id of cur) if (!seq.includes(id)) insertAfterNeighbour(seq, id, cur);
			} else {
				seq = cur.filter((id) => !returning.has(id));
				for (const id of beforeSeq) if (returning.has(id) && curSet.has(id)) insertAfterNeighbour(seq, id, beforeSeq);
			}
			seq.forEach((id, i) => {
				const it = this.itemStore.get(id)!;
				if (it.order !== i) this.save({ ...it, order: i });
			});
		}
	}

	/** Every child of the parents the operation touched, right after it (for its undo). */
	private afterOf(projectId: string, before: ManuscriptItem[], extra: Iterable<string | null> = []): ManuscriptItem[] {
		const parents = new Set<string | null>(extra);
		for (const r of before) {
			parents.add(r.parentId);
			const cur = this.itemStore.get(r.id);
			if (cur) parents.add(cur.parentId);
		}
		return [...parents].flatMap((p) => this.siblings(projectId, p)).map(clone);
	}

	// ── internals ──────────────────────────────────────────────────────────────

	private requireItem(id: string): ManuscriptItem {
		const it = this.itemStore.get(id);
		if (!it || !this.projectStore.has(it.projectId)) throw new Error('That part of the manuscript no longer exists.');
		return it;
	}

	private newItem(project: WritingProject, init: { kind: ManuscriptKind; title: string; synopsis?: string; parentId: string | null; order: number; notePath?: string | null }): ManuscriptItem {
		const now = Date.now();
		return hydrateManuscriptItem({
			v: RECORD_VERSIONS.manuscriptItem,
			id: uuid(),
			projectId: project.id,
			kind: init.kind,
			parentId: init.parentId,
			order: init.order,
			title: init.title,
			synopsis: init.synopsis ?? '',
			notePath: init.notePath ?? null,
			status: init.kind === 'scene' ? project.defaultStatus : '',
			createdAt: now,
			updatedAt: now,
			rev: 0,
		})!.record;
	}

	/** All children of a parent (trashed too), in order. */
	private siblings(projectId: string, parentId: string | null): ManuscriptItem[] {
		return this.itemStore
			.all()
			.filter((i) => i.projectId === projectId && i.parentId === parentId)
			.sort(byOrder);
	}

	private childMap(projectId: string): Map<string | null, ManuscriptItem[]> {
		const map = new Map<string | null, ManuscriptItem[]>();
		const ids = new Set<string>();
		for (const i of this.itemStore.values()) if (i.projectId === projectId) ids.add(i.id);
		for (const i of this.itemStore.values()) {
			if (i.projectId !== projectId) continue;
			// An item whose parent vanished (a hand-edited file) shows at the top level.
			const p = i.parentId !== null && ids.has(i.parentId) && i.parentId !== i.id ? i.parentId : null;
			const list = map.get(p) ?? [];
			list.push(i);
			map.set(p, list);
		}
		for (const list of map.values()) list.sort(byOrder);
		return map;
	}

	/** Everything inside an item; with `live`, what's in the trash (and inside it) is left out. */
	private descendants(it: ManuscriptItem, opts: { live?: boolean } = {}): ManuscriptItem[] {
		const kids = this.childMap(it.projectId);
		const out: ManuscriptItem[] = [];
		const seen = new Set<string>([it.id]);
		const walk = (p: string) => {
			for (const c of kids.get(p) ?? []) {
				if (seen.has(c.id) || (opts.live && c.trashedAt !== null)) continue;
				seen.add(c.id);
				out.push(c);
				walk(c.id);
			}
		};
		walk(it.id);
		return out;
	}

	/**
	 * Put `ids` (already children of `parentId`) at a visible position, keeping trashed
	 * siblings next to the item they followed, then number the siblings 0, 1, 2, …
	 */
	private place(ids: string[], projectId: string, parentId: string | null, index: number): void {
		const moving = new Set(ids);
		const rest = this.siblings(projectId, parentId).filter((i) => !moving.has(i.id));
		const visible = rest.filter((i) => i.trashedAt === null);
		const at = clampIndex(index, visible.length);
		const anchor = visible[at];
		const pos = anchor ? rest.indexOf(anchor) : rest.length;
		const ordered = [...rest.slice(0, pos), ...ids.map((id) => this.itemStore.get(id)!), ...rest.slice(pos)];
		ordered.forEach((it, i) => it.order !== i && this.save({ ...it, order: i }));
	}

	private renumber(projectId: string, parentId: string | null): void {
		this.siblings(projectId, parentId).forEach((it, i) => it.order !== i && this.save({ ...it, order: i }));
	}

	private save(next: ManuscriptItem): ManuscriptItem {
		const prev = this.itemStore.get(next.id) ?? null;
		const rec = hydrateManuscriptItem({ ...next, updatedAt: Date.now(), rev: (prev?.rev ?? next.rev ?? 0) + (prev ? 1 : 0) })!.record;
		this.itemStore.put(rec);
		this.indexPath(rec, prev);
		return rec;
	}

	private saveProject(next: WritingProject): WritingProject {
		const prev = this.projectStore.get(next.id);
		const rec = hydrateWritingProject({ ...next, updatedAt: Date.now(), rev: (prev?.rev ?? next.rev ?? 0) + (prev ? 1 : 0) })!.record;
		this.projectStore.put(rec);
		return rec;
	}

	private indexPath(next: ManuscriptItem | null, prev: ManuscriptItem | null): void {
		if (prev?.notePath && prev.notePath !== next?.notePath) {
			const set = this.byPath.get(prev.notePath);
			set?.delete(prev.id);
			if (set && !set.size) this.byPath.delete(prev.notePath);
		}
		if (next?.notePath) {
			const set = this.byPath.get(next.notePath) ?? new Set<string>();
			set.add(next.id);
			this.byPath.set(next.notePath, set);
		}
	}

	private emit(projectId: string, ids: string[], reason: WritingChangeReason): void {
		this.events.emit('writing:changed', { projectId, ids, reason });
	}

	dispose(): void {
		this.flushProgress();
		if (this.progressTimer !== null) window.clearTimeout(this.progressTimer);
		this.progressTimer = null;
		this.vaultSub?.dispose();
		this.vaultSub = null;
		this.vaultRef = null;
		this.words.dispose();
	}

	// ── WS6: progress ─────────────────────────────────────────────────────────

	/** The session's words written per project when last recorded. */
	private recorded = new Map<string, number>();
	/** Words not saved into the project's day yet. */
	private pendingWords = new Map<string, number>();
	private progressTimer: ReturnType<typeof setTimeout> | null = null;
	/** The scene written in most recently, per project (for sessions). */
	private lastScene = new Map<string, string>();

	/**
	 * A note of the project was counted again: add what was written since the last count to
	 * today. Uses the session's counting (a note's first count is its starting point; text a
	 * split or merge moved isn't writing), so words aren't counted twice and a restart starts
	 * fresh. Saved a few seconds later, in one go.
	 */
	private recordWords(projectId: string): void {
		const notes = new Map<string, number | null>();
		for (const sc of this.scenesRaw(projectId)) if (sc.notePath && !sc.trashedAt && !notes.has(sc.notePath)) notes.set(sc.notePath, this.words.words(sc.notePath));
		const d = sessionDelta(projectId, notes);
		if (d === null) return;
		const last = this.recorded.get(projectId) ?? 0;
		this.recorded.set(projectId, d);
		const inc = d - last;
		if (!inc) return;
		this.pendingWords.set(projectId, (this.pendingWords.get(projectId) ?? 0) + inc);
		if (this.progressTimer === null) this.progressTimer = window.setTimeout(() => this.flushProgress(), 3000);
	}

	/** Save pending words into each project's today. */
	flushProgress(): void {
		this.progressTimer = null;
		const today = dayKey();
		for (const [id, n] of this.pendingWords) {
			const p = this.projectStore.get(id);
			if (!p || !n) continue;
			// A session goes on while writing continues; a pause of 15 minutes starts a new one.
			const now = Date.now();
			const sessions = [...(p.sessions ?? [])];
			const lastS = sessions[sessions.length - 1];
			const sceneId = this.lastScene.get(id) ?? null;
			if (lastS && now - lastS.end < 15 * 60_000) sessions[sessions.length - 1] = { ...lastS, end: now, words: lastS.words + n, sceneId: sceneId ?? lastS.sceneId };
			else sessions.push({ start: now, end: now, words: n, sceneId });
			this.saveProject({ ...p, days: addWords(p.days ?? {}, today, n), sessions: sessions.slice(-200) });
			this.events.emit('writing:words', { projectId: id, sceneIds: [] });
		}
		this.pendingWords.clear();
	}

	/** A project's daily goal and deadline (null clears either). */
	setGoals(projectId: string, o: { dailyGoal?: number | null; deadline?: string | null }): { before: WritingProject; after: WritingProject } {
		return this.updateProject(projectId, o);
	}

	/** Log a finished sprint (the last 100 are kept). */
	logSprint(projectId: string, rec: { start: number; minutes: number; words: number }): void {
		const p = this.projectStore.get(projectId);
		if (!p) return;
		this.updateProject(projectId, { sprints: [...(p.sprints ?? []), rec].slice(-100) });
	}

	// ── WS6: revision passes ─────────────────────────────────────────────────

	/** Add a revision pass. */
	addPass(projectId: string, name: string): { before: WritingProject; after: WritingProject; id: string } {
		const p = this.requireProject(projectId);
		const label = name.trim();
		if (!label) throw new Error('A pass needs a name.');
		const id = uuid();
		const r = this.updateProject(projectId, { passes: [...(p.passes ?? []), { id, name: label, createdAt: Date.now(), done: [] }] });
		return { ...r, id };
	}

	renamePass(projectId: string, passId: string, name: string): { before: WritingProject; after: WritingProject } {
		const p = this.requireProject(projectId);
		const label = name.trim();
		if (!label) throw new Error('A pass needs a name.');
		return this.updateProject(projectId, { passes: (p.passes ?? []).map((x) => (x.id === passId ? { ...x, name: label } : x)) });
	}

	removePass(projectId: string, passId: string): { before: WritingProject; after: WritingProject } {
		const p = this.requireProject(projectId);
		return this.updateProject(projectId, { passes: (p.passes ?? []).filter((x) => x.id !== passId) });
	}

	/** Mark a scene done (or not) in a pass. */
	setPassDone(projectId: string, passId: string, sceneId: string, done: boolean): { before: WritingProject; after: WritingProject } {
		const p = this.requireProject(projectId);
		return this.updateProject(projectId, {
			passes: (p.passes ?? []).map((x) => (x.id !== passId ? x : { ...x, done: done ? [...new Set([...x.done, sceneId])] : x.done.filter((d) => d !== sceneId) })),
		});
	}

	/** A pass's checklist, replaced as a whole (undo via restoreProject). */
	setPassChecklist(projectId: string, passId: string, checklist: Array<{ id: string; text: string; done: boolean }>): { before: WritingProject; after: WritingProject } {
		const p = this.requireProject(projectId);
		return this.updateProject(projectId, { passes: (p.passes ?? []).map((x) => (x.id === passId ? { ...x, checklist } : x)) });
	}

	/** Mark a passage of a scene with a note. */
	addMark(projectId: string, mark: { sceneId: string; quote: string; note: string }): { before: WritingProject; after: WritingProject; id: string } {
		const p = this.requireProject(projectId);
		const id = uuid();
		const r = this.updateProject(projectId, { marks: [...(p.marks ?? []), { id, sceneId: mark.sceneId, quote: mark.quote.trim(), note: mark.note.trim(), createdAt: Date.now() }].slice(-500) });
		return { ...r, id };
	}

	/** Remove a marked passage (dealt with). */
	removeMark(projectId: string, markId: string): { before: WritingProject; after: WritingProject } {
		const p = this.requireProject(projectId);
		return this.updateProject(projectId, { marks: (p.marks ?? []).filter((m) => m.id !== markId) });
	}

	// ── 0.28: research ───────────────────────────────────────────────────────

	addResearch(projectId: string, item: Omit<ResearchItem, 'id' | 'createdAt' | 'scenes'> & { scenes?: string[] }): { before: WritingProject; after: WritingProject; id: string } {
		const p = this.requireProject(projectId);
		const id = uuid();
		const r = this.updateProject(projectId, { research: [...(p.research ?? []), { ...item, id, scenes: item.scenes ?? [], createdAt: Date.now() }] });
		return { ...r, id };
	}

	updateResearch(projectId: string, id: string, patch: Partial<Omit<ResearchItem, 'id' | 'createdAt'>>): { before: WritingProject; after: WritingProject } {
		const p = this.requireProject(projectId);
		return this.updateProject(projectId, { research: (p.research ?? []).map((x) => (x.id === id ? { ...x, ...patch } : x)) });
	}

	removeResearch(projectId: string, id: string): { before: WritingProject; after: WritingProject } {
		const p = this.requireProject(projectId);
		return this.updateProject(projectId, { research: (p.research ?? []).filter((x) => x.id !== id) });
	}

	/** Words written today in a project (saved plus not yet saved). */
	wordsToday(projectId: string): number {
		return (this.projectStore.get(projectId)?.days?.[dayKey()] ?? 0) + (this.pendingWords.get(projectId) ?? 0);
	}
}

function byOrder(a: ManuscriptItem, b: ManuscriptItem): number {
	return a.order - b.order || a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1);
}

const isHighSurrogate = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLowSurrogate = (c: number) => c >= 0xdc00 && c <= 0xdfff;

function clampIndex(index: number, length: number): number {
	return Number.isFinite(index) ? Math.max(0, Math.min(length, Math.trunc(index))) : length;
}

function groupByProject(items: ManuscriptItem[]): Map<string, string[]> {
	const m = new Map<string, string[]>();
	for (const i of items) m.set(i.projectId, [...(m.get(i.projectId) ?? []), i.id]);
	return m;
}
