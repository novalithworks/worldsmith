import type { ManuscriptItem, ManuscriptKind, ProjectKind, SceneStatus, WritingProject } from '../../core/types';
import { normalizeText, plainText, splitNote } from '../../core/util/strings';
import type { MoveTarget, OutlineNode } from '../../services/writing/WritingService';
import { naturalCompare, naturalPathCompare, parentFolder, safeNoteName, sceneTitle } from '../../services/writing/vault';
import { proseOf } from '../../services/writing/wordCount';

/*
 * The Writing Studio's pure helpers (WS2): numbering, greetings, paragraph offsets for
 * Split, the import preview and the binder's drag-and-drop arithmetic. Nothing here
 * touches Obsidian or the DOM, so it is unit-tested directly (tests/writingUi.test.ts).
 */

// ── words and names ──────────────────────────────────────────────────────────

/** 1 → "I", 14 → "XIV". Numbers outside 1…3999 are written in digits. */
export function roman(n: number): string {
	if (!Number.isInteger(n) || n < 1 || n > 3999) return String(n);
	const table: Array<[number, string]> = [
		[1000, 'M'],
		[900, 'CM'],
		[500, 'D'],
		[400, 'CD'],
		[100, 'C'],
		[90, 'XC'],
		[50, 'L'],
		[40, 'XL'],
		[10, 'X'],
		[9, 'IX'],
		[5, 'V'],
		[4, 'IV'],
		[1, 'I'],
	];
	let out = '';
	let rest = n;
	for (const [v, s] of table) {
		while (rest >= v) {
			out += s;
			rest -= v;
		}
	}
	return out;
}

/** "Good morning" (5–11), "Good afternoon" (12–17), "Good evening" otherwise. */
export function greeting(d: Date): string {
	const h = d.getHours();
	if (h >= 5 && h < 12) return 'Good morning';
	if (h >= 12 && h < 18) return 'Good afternoon';
	return 'Good evening';
}

const KIND_LABEL: Record<ProjectKind, string> = { novel: 'Novel', novella: 'Novella', 'short-story': 'Short story', anthology: 'Anthology', script: 'Script' };
const KIND_PLURAL: Record<ProjectKind, string> = { novel: 'Novels', novella: 'Novellas', 'short-story': 'Short stories', anthology: 'Anthologies', script: 'Scripts' };

export const kindLabel = (k: ProjectKind): string => KIND_LABEL[k] ?? 'Project';
export const kindPlural = (k: ProjectKind): string => KIND_PLURAL[k] ?? 'Projects';
export const itemWord = (k: ManuscriptKind): string => (k === 'part' ? 'Part' : k === 'chapter' ? 'Chapter' : 'Scene');

/** "1 scene", "3 scenes". */
export function count(n: number, one: string, many = `${one}s`): string {
	return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/** The generated cover of a project: one of five colourways, always the same for a project. */
export const COVERS = ['ember', 'night', 'sea', 'gold', 'plum'] as const;
export function coverOf(id: string): (typeof COVERS)[number] {
	let h = 0;
	for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
	return COVERS[h % COVERS.length]!;
}

/** A project's status: the status most of its scenes are at (ties go to the earlier status). */
export function projectStatus(project: WritingProject, scenes: ManuscriptItem[]): SceneStatus | null {
	if (!scenes.length) return null;
	const n = new Map<string, number>();
	for (const s of scenes) n.set(s.status, (n.get(s.status) ?? 0) + 1);
	let best: SceneStatus | null = null;
	let bestN = 0;
	for (const st of project.statuses) {
		const c = n.get(st.id) ?? 0;
		if (c > bestN) {
			best = st;
			bestN = c;
		}
	}
	return best;
}

export function statusOf(project: WritingProject, id: string): SceneStatus {
	return project.statuses.find((s) => s.id === id) ?? { id, label: 'No status', color: 'gray', done: false };
}

/** Where a new project's notes go: next to other projects when they share a folder ("Manuscripts/…"). */
export function suggestFolder(title: string, existing: string[]): string {
	const name = safeNoteName(title.trim() || 'Untitled project');
	const parents = new Map<string, number>();
	for (const f of existing) {
		const p = parentFolder(f);
		if (p) parents.set(p, (parents.get(p) ?? 0) + 1);
	}
	let best = '';
	let bestN = 0;
	for (const [p, c] of parents) if (c > bestN) [best, bestN] = [p, c];
	return best ? `${best}/${name}` : name;
}

// ── note text ────────────────────────────────────────────────────────────────

/** The first words of a note as plain text: no front matter, comments, links or markup. */
export function excerptOf(md: string, max = 360): string {
	const text = plainText(proseOf(md));
	if (text.length <= max) return text;
	const cut = text.slice(0, max);
	const at = cut.lastIndexOf(' ');
	return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:.—–-]+$/, '')}…`;
}

export interface Paragraph {
	/** Offset of the paragraph's first character in the WHOLE note (front matter included). */
	start: number;
	end: number;
	text: string;
}

/**
 * The paragraphs of a note's body (blocks separated by blank lines), with offsets measured
 * against the full note text, front matter included, exactly as WritingService.split
 * expects them. Splitting before paragraph i (i ≥ 1) is `split(id, paragraphs[i].start)`.
 */
export function noteParagraphs(md: string): Paragraph[] {
	const front = splitNote(md).front.length;
	const out: Paragraph[] = [];
	const re = /\r?\n[ \t]*\r?\n/g;
	let pos = front;
	const push = (from: number, to: number) => {
		const raw = md.slice(from, to);
		const lead = raw.length - raw.replace(/^\s+/, '').length;
		const trimmed = raw.trim();
		if (!trimmed) return;
		out.push({ start: from + lead, end: from + lead + trimmed.length, text: trimmed });
	};
	re.lastIndex = front;
	for (let m = re.exec(md); m; m = re.exec(md)) {
		push(pos, m.index);
		pos = m.index + m[0].length;
	}
	push(pos, md.length);
	return out;
}

// ── folders and import ───────────────────────────────────────────────────────

/** Every folder that holds a note (directly or below), in natural order. */
export function foldersOf(paths: string[]): string[] {
	const set = new Set<string>();
	for (const p of paths) {
		let f = parentFolder(p);
		while (f && !set.has(f)) {
			set.add(f);
			f = parentFolder(f);
		}
	}
	return [...set].sort(naturalPathCompare);
}

export interface ImportRow {
	kind: 'chapter' | 'scene';
	title: string;
	/** The note (scenes). */
	path: string | null;
	/** Inside a chapter. */
	nested: boolean;
	/** Already used by a scene: left out. */
	skipped: boolean;
}

/**
 * What importing a folder will link, in the order WritingService.importFolder links it:
 * notes in natural file-name order; with `chapters`, each first-level subfolder becomes a
 * chapter holding the notes below it.
 */
export function importPreview(folder: string, paths: string[], chapters: boolean, used: (path: string) => boolean): { rows: ImportRow[]; scenes: number; chapters: number; skipped: number } {
	const rows: ImportRow[] = [];
	const seen = new Map<string, ImportRow[]>();
	const top: Array<ImportRow | { chapter: string }> = [];
	let skipped = 0;
	for (const path of [...paths].sort(naturalPathCompare)) {
		const isUsed = used(path);
		const row: ImportRow = { kind: 'scene', title: sceneTitle(path), path, nested: false, skipped: isUsed };
		if (isUsed) {
			skipped++;
			// Shown (struck through) where it would have gone, but it makes no chapter.
		}
		const rel = folder ? path.slice(folder.length + 1) : path;
		const sub = chapters && rel.includes('/') ? rel.slice(0, rel.indexOf('/')) : null;
		if (sub === null) {
			top.push(row);
			continue;
		}
		row.nested = true;
		let list = seen.get(sub);
		if (!list) {
			list = [];
			seen.set(sub, list);
			top.push({ chapter: sub });
		}
		list.push(row);
	}
	let nChapters = 0;
	for (const t of top) {
		if ('chapter' in t) {
			const kids = seen.get(t.chapter) ?? [];
			// A chapter is only made when one of its notes is linked.
			const live = kids.some((k) => !k.skipped);
			if (live) nChapters++;
			rows.push({ kind: 'chapter', title: t.chapter, path: null, nested: false, skipped: !live });
			rows.push(...kids);
		} else rows.push(t);
	}
	return { rows, scenes: rows.filter((r) => r.kind === 'scene' && !r.skipped).length, chapters: nChapters, skipped };
}

// ── the binder ───────────────────────────────────────────────────────────────

/** What each kind may hold (as WritingService allows). */
export const CAN_HOLD: Record<'root' | ManuscriptKind, readonly ManuscriptKind[]> = {
	root: ['part', 'chapter', 'scene'],
	part: ['chapter', 'scene'],
	chapter: ['scene'],
	scene: [],
};

export interface BinderNode {
	id: string;
	kind: ManuscriptKind;
	title: string;
	/** The parent in the tree as shown (null = top level). */
	parentId: string | null;
	depth: number;
	collapsed: boolean;
}

/** The project's tree flattened for the binder, plus each parent's children. */
export interface BinderModel {
	nodes: Map<string, BinderNode>;
	/** Children in order, keyed by parent (null = top level). */
	kids: Map<string | null, string[]>;
	/** Rows shown, top to bottom (collapsed items hide what's inside them). */
	rows: BinderNode[];
	/** Chapter numbers in manuscript order (1, 2, 3… across parts). */
	chapterNo: Map<string, number>;
	/** Scene numbers in manuscript order. */
	sceneNo: Map<string, number>;
}

export function binderModel(tree: OutlineNode[], opts: { filter?: string } = {}): BinderModel {
	const nodes = new Map<string, BinderNode>();
	const kids = new Map<string | null, string[]>();
	const chapterNo = new Map<string, number>();
	const sceneNo = new Map<string, number>();
	const order: BinderNode[] = [];
	const walk = (list: OutlineNode[], parentId: string | null) => {
		kids.set(parentId, list.map((n) => n.item.id));
		for (const n of list) {
			const node: BinderNode = { id: n.item.id, kind: n.item.kind, title: n.item.title, parentId, depth: n.depth, collapsed: n.item.collapsed };
			nodes.set(node.id, node);
			order.push(node);
			if (node.kind === 'chapter') chapterNo.set(node.id, chapterNo.size + 1);
			if (node.kind === 'scene') sceneNo.set(node.id, sceneNo.size + 1);
			walk(n.children, n.item.id);
		}
	};
	walk(tree, null);
	const q = normalizeText(opts.filter?.trim() ?? '');
	let rows: BinderNode[];
	if (q) {
		// Matches and the parts and chapters they are in; collapse is ignored while searching.
		const keep = new Set<string>();
		for (const n of order) {
			if (!normalizeText(n.title).includes(q)) continue;
			for (let cur: BinderNode | undefined = n; cur && !keep.has(cur.id); cur = cur.parentId ? nodes.get(cur.parentId) : undefined) keep.add(cur.id);
		}
		rows = order.filter((n) => keep.has(n.id));
	} else {
		rows = [];
		const hidden = new Set<string>();
		for (const n of order) {
			if (n.parentId && hidden.has(n.parentId)) {
				hidden.add(n.id);
				continue;
			}
			rows.push(n);
			if (n.collapsed) hidden.add(n.id);
		}
	}
	return { nodes, kids, rows, chapterNo, sceneNo };
}

const holds = (m: BinderModel, parentId: string | null, kind: ManuscriptKind): boolean => CAN_HOLD[parentId === null ? 'root' : (m.nodes.get(parentId)?.kind ?? 'scene')].includes(kind);

/**
 * A node and the nodes above it, nearest first. Stops at a loop (A inside B inside A, which
 * only damaged or crafted data can hold) and after 64 levels, so it always ends (0.20.2).
 */
export function chainUp(m: BinderModel, id: string | null | undefined): BinderNode[] {
	const out: BinderNode[] = [];
	const seen = new Set<string>();
	for (let cur = id ? m.nodes.get(id) : undefined; cur && !seen.has(cur.id) && out.length < 64; cur = cur.parentId ? m.nodes.get(cur.parentId) : undefined) {
		seen.add(cur.id);
		out.push(cur);
	}
	return out;
}

/** The chapter a node is in (or is), if any. */
export function chapterOf(m: BinderModel, id: string): BinderNode | null {
	return chainUp(m, id).find((n) => n.kind === 'chapter') ?? null;
}

/** Is `id` one of `ids` or inside one of them? */
export function insideAny(m: BinderModel, id: string, ids: ReadonlySet<string>): boolean {
	const seen = new Set<string>();
	for (let cur = m.nodes.get(id); cur && !seen.has(cur.id); cur = cur.parentId ? m.nodes.get(cur.parentId) : undefined) {
		if (ids.has(cur.id)) return true;
		seen.add(cur.id);
	}
	return false;
}

/** Position of `ref` among a parent's children, the moved items not counted (+1 after it). */
function indexAmong(m: BinderModel, parentId: string | null, ref: string | null, after: boolean, moving: ReadonlySet<string>): number {
	const list = (m.kids.get(parentId) ?? []).filter((id) => !moving.has(id));
	if (ref === null) return list.length;
	const i = list.indexOf(ref);
	return i < 0 ? list.length : i + (after ? 1 : 0);
}

/** The last row shown inside an item (the item's own row when it is collapsed or empty). */
function lastRowOf(m: BinderModel, id: string): number {
	const i = m.rows.findIndex((r) => r.id === id);
	if (i < 0) return -1;
	const depth = m.rows[i]!.depth;
	let j = i;
	while (j + 1 < m.rows.length && m.rows[j + 1]!.depth > depth) j++;
	return j;
}

export interface DropTarget extends MoveTarget {
	/** Draw the drop line under this row (-1 = above the first row). */
	lineAfter: number;
	/** Indent of the line (the depth items take there). */
	depth: number;
	/** A part or chapter the items go into (highlighted). */
	into: string | null;
	/** Dropping here changes nothing. */
	noop: boolean;
}

/**
 * Where items dropped on a binder row go. `zone` is where the pointer is on that row
 * (0 = top edge, 1 = bottom edge); `row` = rows.length means the empty space below the
 * list. Returns null where they can't go (onto themselves or inside themselves).
 *
 * The middle of a part or chapter that can hold the items drops them inside, at its end;
 * the lower part of an open container with children drops them first inside it. Elsewhere
 * items go before or after the row; when that parent can't hold them (a chapter dropped
 * among scenes), they go before or after the nearest enclosing item that can.
 */
export function dropTarget(m: BinderModel, moving: string[], row: number, zone: number): DropTarget | null {
	const ids = new Set(moving);
	const first = m.nodes.get(moving[0] ?? '');
	if (!first) return null;
	const kind = first.kind;
	const done = (parentId: string | null, index: number, lineAfter: number, into: string | null): DropTarget => {
		const depth = parentId === null ? 0 : (m.nodes.get(parentId)?.depth ?? -1) + 1;
		const noop = moving.length === 1 && first.parentId === parentId && currentIndex(m, first) === index;
		return { parentId, index, lineAfter, depth, into, noop };
	};
	if (row >= m.rows.length) return done(null, indexAmong(m, null, null, false, ids), m.rows.length - 1, null);
	const r = m.rows[row];
	if (!r || insideAny(m, r.id, ids)) return null;
	const container = r.kind !== 'scene';
	const canInto = container && CAN_HOLD[r.kind].includes(kind);
	const openWithKids = canInto && !r.collapsed && (m.kids.get(r.id) ?? []).some((id) => !ids.has(id)) && m.rows[row + 1]?.parentId === r.id;
	if (canInto && zone > 0.28 && zone < 0.72) {
		return done(r.id, indexAmong(m, r.id, null, false, ids), lastRowOf(m, r.id), r.id);
	}
	if (openWithKids && zone >= 0.72) return done(r.id, 0, row, r.id);
	let parentId = r.parentId;
	let ref = r.id;
	let after = zone >= 0.5;
	const seen = new Set<string>();
	while (!holds(m, parentId, kind)) {
		const p = parentId ? m.nodes.get(parentId) : undefined;
		if (!p || seen.has(p.id)) return null;
		seen.add(p.id);
		const firstKid = (m.kids.get(p.id) ?? []).find((id) => !ids.has(id));
		after = !(ref === firstKid && !after);
		ref = p.id;
		parentId = p.parentId;
	}
	const index = indexAmong(m, parentId, ref, after, ids);
	const refRow = m.rows.findIndex((x) => x.id === ref);
	return done(parentId, index, after ? lastRowOf(m, ref) : refRow - 1, null);
}

/** An item's position among its siblings. */
function currentIndex(m: BinderModel, n: BinderNode): number {
	return (m.kids.get(n.parentId) ?? []).indexOf(n.id);
}

/**
 * One step up or down for "Move up" / "Move down" (the keyboard and touch alternative to
 * dragging). Within its parent first; at the edge, into the end (or start) of the
 * neighbouring part or chapter that can hold it; then out of its parent. Null at the very
 * top or bottom.
 */
export function stepTarget(m: BinderModel, id: string, dir: -1 | 1): MoveTarget | null {
	const n = m.nodes.get(id);
	if (!n) return null;
	const sibs = m.kids.get(n.parentId) ?? [];
	const i = sibs.indexOf(id);
	const next = sibs[i + dir];
	if (next !== undefined) {
		const nb = m.nodes.get(next);
		// A neighbouring container that can hold it: step inside it rather than over it.
		if (nb && nb.kind !== 'scene' && CAN_HOLD[nb.kind].includes(n.kind) && n.kind !== nb.kind) {
			const inner = (m.kids.get(nb.id) ?? []).length;
			return { parentId: nb.id, index: dir < 0 ? inner : 0 };
		}
		return { parentId: n.parentId, index: i + dir };
	}
	if (n.parentId === null) return null;
	const parent = m.nodes.get(n.parentId);
	if (!parent) return null;
	// The neighbouring part or chapter of the same kind as its parent.
	const outer = m.kids.get(parent.parentId) ?? [];
	const pi = outer.indexOf(parent.id);
	const cand = m.nodes.get(outer[pi + dir] ?? '');
	if (cand && cand.kind === parent.kind && CAN_HOLD[cand.kind].includes(n.kind)) {
		const inner = (m.kids.get(cand.id) ?? []).length;
		return { parentId: cand.id, index: dir < 0 ? inner : 0 };
	}
	// Out of the parent, just before or after it.
	if (!holds(m, parent.parentId, n.kind)) return null;
	return { parentId: parent.parentId, index: pi + (dir < 0 ? 0 : 1) };
}

/** Places an item can be moved to with "Move to…": the top level and every part or chapter that can hold it. */
export function moveDestinations(m: BinderModel, id: string): Array<{ id: string | null; title: string; kind: ManuscriptKind | 'root'; depth: number }> {
	const n = m.nodes.get(id);
	if (!n) return [];
	const out: Array<{ id: string | null; title: string; kind: ManuscriptKind | 'root'; depth: number }> = [{ id: null, title: 'Top level of the project', kind: 'root', depth: 0 }];
	const self = new Set([id]);
	const walk = (parent: string | null) => {
		for (const k of m.kids.get(parent) ?? []) {
			const c = m.nodes.get(k);
			if (!c || c.kind === 'scene' || insideAny(m, k, self)) continue;
			if (CAN_HOLD[c.kind].includes(n.kind)) out.push({ id: c.id, title: c.title, kind: c.kind, depth: c.depth + 1 });
			walk(k);
		}
	};
	walk(null);
	return out;
}

// ── projects library ─────────────────────────────────────────────────────────

export type ProjectSort = 'edited' | 'title' | 'words' | 'created';

export function sortProjects<T extends { project: WritingProject; edited: number; words: number }>(rows: T[], by: ProjectSort): T[] {
	const out = [...rows];
	if (by === 'title') out.sort((a, b) => naturalCompare(a.project.name, b.project.name));
	else if (by === 'words') out.sort((a, b) => b.words - a.words || naturalCompare(a.project.name, b.project.name));
	else if (by === 'created') out.sort((a, b) => b.project.createdAt - a.project.createdAt);
	else out.sort((a, b) => b.edited - a.edited || naturalCompare(a.project.name, b.project.name));
	return out;
}
