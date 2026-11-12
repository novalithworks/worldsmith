/**
 * A saved database view (Milestone 8): how one type's entries are shown — layout, filters,
 * sorting, grouping, columns and card fields. Stored per type in views/<typeId>.json.
 */
export type ViewKind = 'cards' | 'gallery' | 'table' | 'list' | 'board' | 'progress';

export type ViewOp = 'is' | 'is-not' | 'contains' | 'empty' | 'not-empty' | 'gt' | 'lt';

/** One filter row. `field` is a field id or a built-in: __status, __tags, __image, __created, __updated, __progress, __connections, __favorite. */
export interface ViewCondition {
	id: string;
	field: string;
	op: ViewOp;
	value: string;
}

export interface ViewSort {
	/** A field id or __name, __status, __created, __updated, __progress. */
	field: string;
	dir: 'asc' | 'desc';
}

export interface ViewColumn {
	id: string;
	/** Pixels; absent = automatic. */
	width?: number;
}

export interface DatabaseView {
	v: number;
	id: string;
	typeId: string;
	name: string;
	icon: string | null;
	kind: ViewKind;
	/** Whether every condition must hold, or any one. */
	match: 'all' | 'any';
	conditions: ViewCondition[];
	/** First wins; ties go to the next. Empty = last edited first. */
	sorts: ViewSort[];
	/** A field id, __status or __tags; null = no groups. Boards always group (by `board.field`). */
	groupBy: string | null;
	/** Group keys folded away in this view. */
	collapsed: string[];
	/** Table columns in order; null = the type's card fields. */
	columns: ViewColumn[] | null;
	card: { fields: string[] | null; image: 'portrait' | 'banner' | 'none'; size: 's' | 'm' | 'l' };
	board: { field: string };
	showArchived: boolean;
	/** Tab order. */
	order: number;
	createdAt: number;
	updatedAt: number;
	rev: number;
}

export const VIEW_KIND_IDS: readonly ViewKind[] = ['cards', 'gallery', 'table', 'list', 'board', 'progress'];
export const VIEW_OPS: readonly ViewOp[] = ['is', 'is-not', 'contains', 'empty', 'not-empty', 'gt', 'lt'];

/**
 * The layout to draw. A view saved by a newer Worldsmith may name a layout this version
 * doesn't have; it's kept as-is on disk (so the newer version gets it back) and shown as cards.
 */
export function viewKind(v: Pick<DatabaseView, 'kind'>): ViewKind {
	return VIEW_KIND_IDS.includes(v.kind) ? v.kind : 'cards';
}

/** A filter this version can't evaluate (from a newer version): kept verbatim, matches nothing. */
export function isForeignCondition(c: ViewCondition): boolean {
	return !VIEW_OPS.includes(c.op) || typeof c.value !== 'string';
}
