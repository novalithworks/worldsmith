import { sceneHas } from '../../services/writing/world';
import { chronoPosition, formatChrono } from '../../core/calendar/engine';
import type { ChronoDate, ManuscriptItem, PlotThread, SceneStatus, SemanticColor, WritingProject } from '../../core/types';
import type { OutlineNode } from '../../services/writing/WritingService';
import { naturalCompare } from '../../services/writing/vault';

/*
 * The story boards' pure arithmetic (WS4): the corkboard's groups, where a dropped card goes
 * in the manuscript, the kanban's columns, the timeline's dates and lanes, and the table's
 * sorting. Nothing here touches Obsidian or the DOM (unit-tested in tests/ws4.test.ts).
 */

export type BoardView = 'corkboard' | 'outline' | 'kanban' | 'timeline' | 'table';
export const BOARD_VIEWS: ReadonlyArray<{ id: BoardView; label: string; icon: string }> = [
	{ id: 'corkboard', label: 'Corkboard', icon: 'layout-grid' },
	{ id: 'outline', label: 'Outline', icon: 'list-tree' },
	{ id: 'kanban', label: 'Kanban', icon: 'columns-3' },
	{ id: 'timeline', label: 'Timeline', icon: 'gantt-chart' },
	{ id: 'table', label: 'Table', icon: 'table' },
];
export const isBoardView = (v: string | undefined | null): v is BoardView => BOARD_VIEWS.some((b) => b.id === v);

/** A board's filter (WS5): a plot thread and/or an entry. A plain string is a thread. */
export interface SceneFilter {
	thread: string | null;
	who: string | null;
	/** WS6: show only scenes NOT done in a revision pass (the pass's done scenes). */
	passDone?: Set<string> | null;
}
export type FilterArg = string | null | SceneFilter;

export function normFilter(f: FilterArg): SceneFilter {
	return f && typeof f === 'object' ? f : { thread: f ?? null, who: null };
}

/** Does a scene show under the board's filter (null = every scene)? Threads no longer on the list don't count. */
export function inThread(scene: ManuscriptItem, f: FilterArg): boolean {
	const n = normFilter(f);
	return (n.thread === null || scene.threads.includes(n.thread)) && (n.who === null || sceneHas(scene, n.who)) && (!n.passDone || !n.passDone.has(scene.id));
}

/** A scene's plot threads that are on the project's list, in the list's order. */
export function threadsOf(project: WritingProject, scene: ManuscriptItem): PlotThread[] {
	return project.threads.filter((t) => scene.threads.includes(t.id));
}

/** A scene's status, or "No status" for one that isn't on the list (it keeps its value). */
export function statusFor(project: WritingProject, id: string): SceneStatus & { known: boolean } {
	const s = project.statuses.find((x) => x.id === id);
	if (s) return { ...s, known: true };
	const old = project.retiredStatuses.find((x) => x.id === id);
	return { id, label: 'No status', color: 'gray', done: false, known: false, ...(old ? { was: old.label } : {}) };
}

// ── corkboard ───────────────────────────────────────────────────────────────

export type CorkEntry =
	| { kind: 'part'; id: string; title: string }
	| {
			kind: 'group';
			/** Stable key: the chapter's id, or `loose:<parent>:<n>` for scenes outside chapters. */
			key: string;
			/** The parent the group's scenes are in (a chapter, a part, or null = top level). */
			parentId: string | null;
			chapterId: string | null;
			title: string;
			/** "Chapter 3", or where loose scenes are. */
			label: string;
			sceneIds: string[];
	  };

/**
 * The corkboard's groups in manuscript order: one per chapter (empty ones too, so cards can
 * be dropped into them), one per run of scenes outside a chapter, and a heading per part.
 */
export function corkGroups(tree: OutlineNode[], chapterNo: Map<string, number>): CorkEntry[] {
	const out: CorkEntry[] = [];
	const walk = (nodes: OutlineNode[], parent: OutlineNode | null) => {
		let loose: Extract<CorkEntry, { kind: 'group' }> | null = null;
		let n = 0;
		for (const node of nodes) {
			const it = node.item;
			if (it.kind === 'scene') {
				if (!loose) {
					loose = { kind: 'group', key: `loose:${parent?.item.id ?? 'root'}:${n++}`, parentId: parent?.item.id ?? null, chapterId: null, title: parent ? 'Scenes in this part' : 'Scenes outside chapters', label: parent ? parent.item.title : 'Not in a chapter', sceneIds: [] };
					out.push(loose);
				}
				loose.sceneIds.push(it.id);
				continue;
			}
			loose = null;
			if (it.kind === 'part') {
				out.push({ kind: 'part', id: it.id, title: it.title });
				walk(node.children, node);
			} else {
				out.push({
					kind: 'group',
					key: it.id,
					parentId: it.id,
					chapterId: it.id,
					title: it.title,
					label: `Chapter ${chapterNo.get(it.id) ?? ''}`.trim(),
					sceneIds: node.children.filter((c) => c.item.kind === 'scene').map((c) => c.item.id),
				});
			}
		}
	};
	walk(tree, null);
	return out;
}

/**
 * Where a card dropped next to `ref` goes among its parent's visible children (the moved
 * card not counted): before `ref`, or after it. `ref` null = after `last` (the group's last
 * scene), or at the end when the group is empty.
 */
export function dropIndex(children: string[], moving: string, ref: string | null, after: boolean, last: string | null = null): number {
	const list = children.filter((id) => id !== moving);
	const at = ref ?? last;
	if (at === null) return list.length;
	const i = list.indexOf(at);
	if (i < 0) return list.length;
	return i + (after || ref === null ? 1 : 0);
}

// ── kanban ──────────────────────────────────────────────────────────────────

export interface KanbanColumn {
	/** The status id; null for scenes whose status isn't on the list. */
	id: string | null;
	label: string;
	color: SemanticColor;
	done: boolean;
	/** In manuscript order. */
	sceneIds: string[];
}

/**
 * One column per status, in the list's order; scenes in manuscript order inside each (the
 * kanban never changes the manuscript's order). A "No status" column holds scenes whose
 * status was taken off the list, only while there are any.
 */
export function kanbanColumns(project: WritingProject, scenes: ManuscriptItem[]): KanbanColumn[] {
	const cols: KanbanColumn[] = project.statuses.map((s) => ({ id: s.id, label: s.label, color: s.color, done: s.done, sceneIds: [] }));
	const other: KanbanColumn = { id: null, label: 'No status', color: 'gray', done: false, sceneIds: [] };
	const by = new Map(cols.map((c) => [c.id, c]));
	for (const s of scenes) (by.get(s.status) ?? other).sceneIds.push(s.id);
	return other.sceneIds.length ? [...cols, other] : cols;
}

// ── timeline ────────────────────────────────────────────────────────────────

/** "HH:MM" → minutes since midnight (null for none). */
export function minutesOf(time: string | null | undefined): number | null {
	const m = time ? /^(\d{2}):(\d{2})$/.exec(time) : null;
	return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Read what a person typed as a time: "9", "9:30", "21.05", "9pm", "9:30 am". Null if it isn't one; "" clears. */
export function parseTime(text: string): string | null | undefined {
	const t = text.trim().toLowerCase();
	if (!t) return null;
	const m = /^(\d{1,2})(?:[:.h](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/.exec(t);
	if (!m) return undefined;
	let h = Number(m[1]);
	const min = Number(m[2] ?? '0');
	const ap = m[3]?.[0];
	if (ap) {
		if (h < 1 || h > 12) return undefined;
		h = (h % 12) + (ap === 'p' ? 12 : 0);
	}
	if (h > 23 || min > 59) return undefined;
	return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

export interface TimelineSlot {
	key: string;
	date: ChronoDate;
	time: string | null;
	label: string;
}

export interface TimelineModel {
	/** Distinct in-story moments, earliest first. */
	slots: TimelineSlot[];
	/** One lane per plot thread (filtered), then "No thread" when a dated scene has none. */
	lanes: Array<{ id: string | null; label: string; color: SemanticColor | null }>;
	/** laneId ('' for no thread) → slot index → scene ids (manuscript order). */
	cells: Map<string, Map<number, string[]>>;
	/** Scenes without a date, in manuscript order. */
	undated: string[];
}

const slotKey = (d: ChronoDate, time: string | null) => `${chronoPosition(d).toFixed(6)}|${d.precision}|${d.label ?? ''}|${time ?? ''}`;

/**
 * Scenes along the story's own time: a column per distinct date (and time), a lane per plot
 * thread. A scene in two threads shows in both lanes. Undated scenes go to the tray.
 */
export function timelineModel(project: WritingProject, scenes: ManuscriptItem[], thread: FilterArg = null): TimelineModel {
	const dated: ManuscriptItem[] = [];
	const undated: string[] = [];
	for (const s of scenes) {
		if (!inThread(s, thread)) continue;
		if (s.date) dated.push(s);
		else undated.push(s.id);
	}
	const slots = new Map<string, TimelineSlot & { pos: number; min: number; prec: number }>();
	const PREC = { era: 0, year: 1, month: 2, day: 3 } as const;
	for (const s of dated) {
		const k = slotKey(s.date!, s.time);
		if (!slots.has(k)) {
			const label = formatChrono(s.date!) + (s.time ? `, ${s.time}` : '');
			slots.set(k, { key: k, date: s.date!, time: s.time, label, pos: chronoPosition(s.date!), min: minutesOf(s.time) ?? -1, prec: PREC[s.date!.precision] ?? 3 });
		}
	}
	const ordered = [...slots.values()].sort((a, b) => a.pos - b.pos || a.prec - b.prec || a.min - b.min || naturalCompare(a.label, b.label));
	const index = new Map(ordered.map((s, i) => [s.key, i]));
	const laneThread = normFilter(thread).thread;
	const lanes: TimelineModel['lanes'] = project.threads.filter((t) => laneThread === null || t.id === laneThread).map((t) => ({ id: t.id, label: t.label, color: t.color }));
	const cells = new Map<string, Map<number, string[]>>();
	const put = (lane: string, slot: number, id: string) => {
		const row = cells.get(lane) ?? new Map<number, string[]>();
		row.set(slot, [...(row.get(slot) ?? []), id]);
		cells.set(lane, row);
	};
	const live = new Set(lanes.map((l) => l.id));
	let loose = false;
	for (const s of dated) {
		const i = index.get(slotKey(s.date!, s.time))!;
		const mine = s.threads.filter((t) => live.has(t));
		if (!mine.length) {
			loose = true;
			put('', i, s.id);
		} else for (const t of mine) put(t, i, s.id);
	}
	if (loose) lanes.push({ id: null, label: 'No thread', color: null });
	return { slots: ordered.map(({ key, date, time, label }) => ({ key, date, time, label })), lanes, cells, undated };
}

// ── table ───────────────────────────────────────────────────────────────────

export type TableKey = 'order' | 'title' | 'chapter' | 'status' | 'threads' | 'pov' | 'location' | 'date' | 'words';

export interface TableRow {
	scene: ManuscriptItem;
	/** Reading order, from 1. */
	n: number;
	chapter: string;
	statusIndex: number;
	statusLabel: string;
	threads: string;
	/** WS5: names of the point-of-view entry and the place ('' when none). */
	pov: string;
	location: string;
	words: number | null;
}

export function sortRows(rows: TableRow[], key: TableKey, dir: 1 | -1): TableRow[] {
	const by: Record<TableKey, (a: TableRow, b: TableRow) => number> = {
		order: (a, b) => a.n - b.n,
		title: (a, b) => naturalCompare(a.scene.title, b.scene.title),
		chapter: (a, b) => naturalCompare(a.chapter, b.chapter),
		status: (a, b) => a.statusIndex - b.statusIndex,
		threads: (a, b) => naturalCompare(a.threads, b.threads),
		// Scenes without one go last, whichever way it is sorted.
		pov: (a, b) => (!a.pov || !b.pov ? (a.pov ? 0 : 1) - (b.pov ? 0 : 1) : naturalCompare(a.pov, b.pov)),
		location: (a, b) => (!a.location || !b.location ? (a.location ? 0 : 1) - (b.location ? 0 : 1) : naturalCompare(a.location, b.location)),
		date: (a, b) => {
			// Undated scenes last, whichever way it is sorted.
			if (!a.scene.date || !b.scene.date) return (a.scene.date ? 0 : 1) - (b.scene.date ? 0 : 1);
			return chronoPosition(a.scene.date) - chronoPosition(b.scene.date) || (minutesOf(a.scene.time) ?? -1) - (minutesOf(b.scene.time) ?? -1);
		},
		words: (a, b) => (a.words ?? -1) - (b.words ?? -1),
	};
	const cmp = by[key];
	return [...rows].sort((a, b) => {
		if (key === 'date' && (!a.scene.date || !b.scene.date) && a.scene.date !== b.scene.date) return cmp(a, b);
		if ((key === 'pov' || key === 'location') && !a[key] !== !b[key]) return cmp(a, b);
		return dir * cmp(a, b) || a.n - b.n;
	});
}

/** Rows that match a search (title, synopsis, chapter) and a status (null = any). */
export function filterRows(rows: TableRow[], q: string, status: string | null): TableRow[] {
	const needle = q.trim().toLowerCase();
	return rows.filter((r) => (status === null || r.scene.status === status) && (!needle || `${r.scene.title}\n${r.scene.synopsis}\n${r.chapter}\n${r.pov}\n${r.location}`.toLowerCase().includes(needle)));
}
