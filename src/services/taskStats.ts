import type { DevTask, EntityRecord, SemanticColor, TaskPriority, TaskStatus } from '../core/types';
import { addDays, addMonths, daysBetween, monthLabel, startOfMonth, startOfWeek, today, type ISODate } from '../core/util/dates';

/**
 * Stat tiles on the Tasks home are small rollups: a metric over tasks or entries, with
 * filters. Pure functions — the widget renders, this computes (and is unit-tested).
 */
export type StatMetric = 'tasks' | 'done-in-period' | 'percent-done' | 'entries' | 'avg-progress';
export type DueFilter = 'any' | 'overdue' | 'today' | 'this-week' | 'next-7' | 'this-month' | 'has-date' | 'no-date';
export type StatPeriod = 'this-week' | 'this-month' | 'last-30';

export interface StatTile {
	id: string;
	label: string;
	icon: string;
	color: SemanticColor;
	metric: StatMetric;
	/** Task statuses counted (metric 'tasks'). Empty = every status except done. */
	statuses: TaskStatus[];
	due: DueFilter;
	/** Entry types; empty = all (world-level tasks included). */
	types: string[];
	minPriority: TaskPriority;
	period: StatPeriod;
	/** Show the comparison with the previous period ('done-in-period'). */
	compare: boolean;
	/** Draw a progress ring (percent metrics). */
	ring: boolean;
	/** Show the small line under the number ("1 type", "+3 this week"). */
	caption: boolean;
}

export const METRICS: Array<{ id: StatMetric; label: string; hint: string }> = [
	{ id: 'tasks', label: 'Count of tasks', hint: 'Tasks matching the filters below' },
	{ id: 'done-in-period', label: 'Tasks completed', hint: 'Finished within a period' },
	{ id: 'percent-done', label: '% of tasks done', hint: 'Share of matching tasks that are done' },
	{ id: 'entries', label: 'Count of entries', hint: 'Entries of the chosen types' },
	{ id: 'avg-progress', label: 'Average development', hint: 'How developed the chosen entries are' },
];

export const DUE_FILTERS: Array<{ id: DueFilter; label: string }> = [
	{ id: 'any', label: 'Any date' },
	{ id: 'overdue', label: 'Overdue' },
	{ id: 'today', label: 'Due today' },
	{ id: 'this-week', label: 'Due this week' },
	{ id: 'next-7', label: 'Due in the next 7 days' },
	{ id: 'this-month', label: 'Due this month' },
	{ id: 'has-date', label: 'Has a due date' },
	{ id: 'no-date', label: 'No due date' },
];

export const PERIODS: Array<{ id: StatPeriod; label: string }> = [
	{ id: 'this-week', label: 'This week' },
	{ id: 'this-month', label: 'This month' },
	{ id: 'last-30', label: 'Last 30 days' },
];

export interface StatContext {
	tasks: DevTask[];
	entities: EntityRecord[];
	progress(e: EntityRecord): number;
	now?: ISODate;
	weekStart?: number;
	/** Optional tasks count only when the world says so. */
	includeOptional?: boolean;
}

export interface StatResult {
	value: number;
	display: string;
	sub: string;
	/** 0–1 for ring tiles. */
	ratio: number | null;
	/** Something needs attention (e.g. overdue > 0). */
	alert: boolean;
}

export function dueMatches(due: string | null, f: DueFilter, now: ISODate, weekStart = 1): boolean {
	switch (f) {
		case 'any':
			return true;
		case 'has-date':
			return !!due;
		case 'no-date':
			return !due;
		case 'overdue':
			return !!due && due < now;
		case 'today':
			return due === now;
		case 'this-week': {
			const a = startOfWeek(now, weekStart);
			return !!due && due >= a && due <= addDays(a, 6);
		}
		case 'next-7':
			return !!due && due >= now && due <= addDays(now, 6);
		case 'this-month':
			return !!due && due.slice(0, 7) === now.slice(0, 7);
	}
}

function periodRange(p: StatPeriod, now: ISODate, weekStart: number, back = 0): [ISODate, ISODate] {
	if (p === 'this-week') {
		const a = addDays(startOfWeek(now, weekStart), -7 * back);
		return [a, addDays(a, 6)];
	}
	if (p === 'this-month') {
		const first = startOfMonth(now);
		const start = addMonths(first, -back);
		return [start, addDays(addMonths(start, 1), -1)];
	}
	return [addDays(now, -29 - 30 * back), addDays(now, -30 * back)];
}

const dayOf = (ms: number) => {
	const d = new Date(ms);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Tasks passing a tile's type / priority filters (status and due handled by the metric). */
function scoped(tile: StatTile, ctx: StatContext): DevTask[] {
	return ctx.tasks.filter((t) => {
		if (tile.types.length && (!t.typeId || !tile.types.includes(t.typeId))) return false;
		if (t.priority < tile.minPriority) return false;
		if (t.optional && !ctx.includeOptional && tile.metric === 'percent-done') return false;
		return true;
	});
}

export function evalStat(tile: StatTile, ctx: StatContext): StatResult {
	const now = ctx.now ?? today();
	const ws = ctx.weekStart ?? 1;
	const tasks = scoped(tile, ctx);
	switch (tile.metric) {
		case 'tasks': {
			const statuses = tile.statuses.length ? tile.statuses : (['open', 'in-progress', 'blocked'] as TaskStatus[]);
			const hit = tasks.filter((t) => statuses.includes(t.status) && dueMatches(t.due, tile.due, now, ws));
			let sub = `of ${tasks.length} in this world`;
			if (tile.due === 'overdue' && hit.length) {
				const oldest = hit.reduce((m, t) => (t.due && t.due < m ? t.due : m), now);
				const days = daysBetween(oldest, now);
				sub = `oldest: ${days} day${days === 1 ? '' : 's'}`;
			} else if (tile.due === 'overdue') sub = 'nothing overdue';
			else if (tile.due === 'this-week' || tile.due === 'next-7') {
				const todayCount = hit.filter((t) => t.due === now).length;
				sub = todayCount ? `${todayCount} due today` : 'none due today';
			} else if (tile.due === 'today') sub = hit.length ? 'keep going' : 'nothing due today';
			return { value: hit.length, display: String(hit.length), sub, ratio: null, alert: tile.due === 'overdue' && hit.length > 0 };
		}
		case 'done-in-period': {
			const [a, b] = periodRange(tile.period, now, ws);
			const inRange = (lo: string, hi: string) => tasks.filter((t) => t.status === 'done' && t.completedAt && dayOf(t.completedAt) >= lo && dayOf(t.completedAt) <= hi).length;
			const n = inRange(a, b);
			let sub = PERIODS.find((p) => p.id === tile.period)?.label.toLowerCase() ?? '';
			if (tile.compare) {
				const [pa, pb] = periodRange(tile.period, now, ws, 1);
				const prev = inRange(pa, pb);
				const diff = n - prev;
				const prevName = tile.period === 'this-month' ? monthLabel(pa).split(' ')[0] : tile.period === 'this-week' ? 'last week' : 'the 30 days before';
				sub = `${diff >= 0 ? '+' : '−'}${Math.abs(diff)} vs ${prevName}`;
			}
			return { value: n, display: String(n), sub, ratio: null, alert: false };
		}
		case 'percent-done': {
			const pool = tasks.filter((t) => dueMatches(t.due, tile.due, now, ws));
			const done = pool.filter((t) => t.status === 'done').length;
			const ratio = pool.length ? done / pool.length : 0;
			return { value: ratio, display: `${Math.round(ratio * 100)}%`, sub: `${done} of ${pool.length} tasks`, ratio, alert: false };
		}
		case 'entries': {
			const list = ctx.entities.filter((e) => !e.trashedAt && (!tile.types.length || tile.types.includes(e.typeId)));
			return { value: list.length, display: String(list.length), sub: tile.types.length ? `${tile.types.length} type${tile.types.length === 1 ? '' : 's'}` : 'in this world', ratio: null, alert: false };
		}
		case 'avg-progress': {
			const list = ctx.entities.filter((e) => !e.trashedAt && !e.archivedAt && (!tile.types.length || tile.types.includes(e.typeId)));
			const ratio = list.length ? list.reduce((s, e) => s + ctx.progress(e), 0) / list.length : 0;
			return { value: ratio, display: `${Math.round(ratio * 100)}%`, sub: `across ${list.length} entr${list.length === 1 ? 'y' : 'ies'}`, ratio, alert: false };
		}
	}
}

/** The five tiles from the approved design. */
export function defaultTiles(): StatTile[] {
	const base = { statuses: [] as TaskStatus[], due: 'any' as DueFilter, types: [] as string[], minPriority: 0 as TaskPriority, period: 'this-month' as StatPeriod, compare: false, ring: false, caption: true };
	return [
		{ ...base, id: 'open', label: 'Open tasks', icon: 'list-checks', color: 'blue', metric: 'tasks' },
		{ ...base, id: 'week', label: 'Due this week', icon: 'calendar-days', color: 'purple', metric: 'tasks', due: 'this-week' },
		{ ...base, id: 'overdue', label: 'Overdue', icon: 'alert-circle', color: 'red', metric: 'tasks', due: 'overdue' },
		{ ...base, id: 'done', label: 'Done this month', icon: 'circle-check', color: 'green', metric: 'done-in-period', compare: true },
		{ ...base, id: 'developed', label: 'World developed', icon: 'gauge', color: 'cyan', metric: 'avg-progress', ring: true },
	];
}

/** Read a tile from block config defensively. */
export function normalizeTile(raw: unknown, i: number): StatTile {
	const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<StatTile>;
	const d = defaultTiles()[0] as StatTile;
	return {
		id: typeof r.id === 'string' ? r.id : `tile-${i}`,
		label: typeof r.label === 'string' ? r.label : 'Stat',
		icon: typeof r.icon === 'string' ? r.icon : 'hash',
		color: (typeof r.color === 'string' ? r.color : 'blue'),
		metric: METRICS.some((m) => m.id === r.metric) ? (r.metric as StatMetric) : 'tasks',
		statuses: Array.isArray(r.statuses) ? (r.statuses.filter((x) => typeof x === 'string')) : [],
		due: DUE_FILTERS.some((f) => f.id === r.due) ? (r.due as DueFilter) : 'any',
		types: Array.isArray(r.types) ? r.types.filter((x): x is string => typeof x === 'string') : [],
		minPriority: (typeof r.minPriority === 'number' ? Math.max(0, Math.min(4, r.minPriority)) : 0) as TaskPriority,
		period: PERIODS.some((p) => p.id === r.period) ? (r.period as StatPeriod) : d.period,
		compare: r.compare === true,
		ring: r.ring === true,
		caption: r.caption !== false,
	};
}
