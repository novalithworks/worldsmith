import type { App } from 'obsidian';

/*
 * What the Writing Studio remembers on this device only (WS3): where the cursor and the
 * scroll were in each scene, and how each project's page is split. Not synced: another
 * device has its own window sizes and its own place in the book. Stored with Obsidian's
 * per-vault local storage (`app.saveLocalStorage`, Obsidian 1.8.7+) or, on an older
 * Obsidian, the window's localStorage under a key named after the vault.
 */

export interface ScenePlace {
	/** Cursor (line and column in the note). */
	line: number;
	ch: number;
	/** The editor's scroll from the top, in pixels. */
	top: number;
	/** When it was saved (the oldest are forgotten first). */
	at: number;
}

export type SideKind = 'none' | 'inspector' | 'scene' | 'note' | 'outline' | 'research';

export interface SplitState {
	side: SideKind;
	/** The other scene shown beside (side = 'scene'). */
	scene: string | null;
	/** Width of the side pane, in pixels. */
	width: number;
	/** The inspector's tab. */
	tab: 'scene' | 'notes' | 'world';
}

export const DEFAULT_SPLIT: SplitState = { side: 'inspector', scene: null, width: 340, tab: 'scene' };
export const SIDE_MIN = 260;
export const SIDE_MAX = 900;
/** Scenes remembered at most (the least recently written in are forgotten). */
export const MAX_PLACES = 400;

/** WS4: each project's story board on this device: the board last used and the plot-thread filter. */
export interface BoardState {
	view: 'corkboard' | 'outline' | 'kanban' | 'timeline' | 'table';
	/** Show only this plot thread (null = every scene). */
	thread: string | null;
	/** WS5: show only scenes with this entry (point of view, cast or place); null = everyone. */
	who: string | null;
	/** WS6: show only scenes not done in this revision pass; null = all. */
	pass?: string | null;
	/** 0.28: how the corkboard groups its columns, and what colours a card's edge. */
	group?: 'chapter' | 'status' | 'pov' | 'thread';
	color?: 'thread' | 'status' | 'pov';
}
export const DEFAULT_BOARD: BoardState = { view: 'corkboard', thread: null, who: null };
const BOARD_VIEWS = ['corkboard', 'outline', 'kanban', 'timeline', 'table'] as const;

/** Read a stored board state, filling in anything missing. Pure. */
export function cleanBoard(raw: unknown): BoardState {
	const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
	const view = BOARD_VIEWS.includes(r.view as BoardState['view']) ? (r.view as BoardState['view']) : DEFAULT_BOARD.view;
	return { view, thread: typeof r.thread === 'string' && r.thread ? r.thread : null, who: typeof r.who === 'string' && r.who ? r.who : null, ...(typeof r.pass === 'string' && r.pass ? { pass: r.pass } : {}), ...(['status', 'pov', 'thread'].includes(r.group as string) ? { group: r.group as 'status' } : {}), ...(['status', 'pov'].includes(r.color as string) ? { color: r.color as 'status' } : {}) };
}

const BOARD_KEY = 'worldsmith-writing-board';
const PLACES_KEY = 'worldsmith-writing-places';
const SPLIT_KEY = 'worldsmith-writing-split';

/** Keep a place, dropping the oldest beyond `max`. Pure. */
export function rememberPlace(all: Record<string, ScenePlace>, id: string, place: ScenePlace, max = MAX_PLACES): Record<string, ScenePlace> {
	const next: Record<string, ScenePlace> = { ...all, [id]: place };
	const ids = Object.keys(next);
	if (ids.length <= max) return next;
	ids.sort((a, b) => next[a]!.at - next[b]!.at);
	for (const old of ids.slice(0, ids.length - max)) delete next[old];
	return next;
}

/** Read stored places, leaving out anything that isn't one. Pure. */
export function cleanPlaces(raw: unknown): Record<string, ScenePlace> {
	const out: Record<string, ScenePlace> = {};
	if (typeof raw !== 'object' || raw === null) return out;
	for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
		if (typeof v !== 'object' || v === null) continue;
		const p = v as Record<string, unknown>;
		const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.floor(x) : null);
		const line = n(p.line);
		const ch = n(p.ch);
		const top = n(p.top);
		const at = n(p.at);
		if (line === null || ch === null || top === null || at === null) continue;
		out[id] = { line, ch, top, at };
	}
	return out;
}

/** Read a stored split, filling in anything missing. Pure. */
export function cleanSplit(raw: unknown): SplitState {
	const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
	const side: SideKind = ['none', 'scene', 'note', 'inspector', 'outline', 'research'].includes(r.side as string) ? (r.side as SideKind) : DEFAULT_SPLIT.side;
	const width = typeof r.width === 'number' && Number.isFinite(r.width) ? Math.round(Math.min(SIDE_MAX, Math.max(SIDE_MIN, r.width))) : DEFAULT_SPLIT.width;
	return { side, scene: typeof r.scene === 'string' && r.scene ? r.scene : null, width, tab: r.tab === 'notes' || r.tab === 'world' ? r.tab : 'scene' };
}

interface LocalStore {
	loadLocalStorage?(key: string): unknown;
	saveLocalStorage?(key: string, data: unknown): void;
}

function load(app: App, key: string): unknown {
	try {
		const a = app as unknown as LocalStore;
		if (typeof a.loadLocalStorage === 'function') return a.loadLocalStorage(key);
		const raw = window.localStorage.getItem(`${key}:${app.vault.getName()}`);
		return raw ? (JSON.parse(raw) as unknown) : null;
	} catch {
		return null;
	}
}

function save(app: App, key: string, data: unknown): void {
	try {
		const a = app as unknown as LocalStore;
		if (typeof a.saveLocalStorage === 'function') a.saveLocalStorage(key, data);
		else window.localStorage.setItem(`${key}:${app.vault.getName()}`, JSON.stringify(data));
	} catch {
		/* storage full or blocked: forgetting a cursor is harmless */
	}
}

export class DeviceMemory {
	private places: Record<string, ScenePlace> | null = null;
	private splits: Record<string, unknown> | null = null;
	private boards: Record<string, unknown> | null = null;

	board(projectId: string): BoardState {
		this.boards ??= readObj(load(this.app, BOARD_KEY));
		return cleanBoard(this.boards[projectId]);
	}

	setBoard(projectId: string, b: Partial<BoardState>): void {
		this.boards ??= readObj(load(this.app, BOARD_KEY));
		this.boards = { ...this.boards, [projectId]: cleanBoard({ ...this.board(projectId), ...b }) };
		save(this.app, BOARD_KEY, this.boards);
	}

	constructor(private readonly app: App) {}

	place(sceneId: string): ScenePlace | null {
		this.places ??= cleanPlaces(load(this.app, PLACES_KEY));
		return this.places[sceneId] ?? null;
	}

	setPlace(sceneId: string, p: Omit<ScenePlace, 'at'>): void {
		this.places ??= cleanPlaces(load(this.app, PLACES_KEY));
		const cur = this.places[sceneId];
		if (cur && cur.line === p.line && cur.ch === p.ch && cur.top === Math.round(p.top)) return;
		this.places = rememberPlace(this.places, sceneId, { line: p.line, ch: p.ch, top: Math.max(0, Math.round(p.top)), at: Date.now() });
		save(this.app, PLACES_KEY, this.places);
	}

	split(projectId: string): SplitState {
		this.splits ??= readObj(load(this.app, SPLIT_KEY));
		return cleanSplit(this.splits[projectId]);
	}

	setSplit(projectId: string, s: SplitState): void {
		this.splits ??= readObj(load(this.app, SPLIT_KEY));
		this.splits = { ...this.splits, [projectId]: cleanSplit(s) };
		save(this.app, SPLIT_KEY, this.splits);
	}
}

function readObj(raw: unknown): Record<string, unknown> {
	return typeof raw === 'object' && raw !== null ? { ...(raw as Record<string, unknown>) } : {};
}

/** One per app (the studio pages of every pane share it). */
const memories = new WeakMap<App, DeviceMemory>();
export function deviceMemory(app: App): DeviceMemory {
	let m = memories.get(app);
	if (!m) {
		m = new DeviceMemory(app);
		memories.set(app, m);
	}
	return m;
}
