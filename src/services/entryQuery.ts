import type { EntityRecord, EntitySchema, FieldDefinition, SemanticColor } from '../core/types';
import { selectOptions } from '../fields/types/logic';
import type { WorldSession } from './WorldSession';

/**
 * The query behind the "build your own" dashboard widgets (lists, numbers, charts): which
 * entries, filtered how, in what order. Stored flat in a widget's config so the standard
 * settings dialog can edit it. Pure apart from reading the session.
 */
export type WhereOp = 'is' | 'is-not' | 'contains' | 'empty' | 'not-empty' | 'gt' | 'lt';
export type OnlyFilter = 'all' | 'favorites' | 'pinned' | 'with-image' | 'this-month';

export interface EntryQuery {
	/** null = every type. */
	type: string | null;
	statuses: string[];
	tags: string[];
	where: { field: string; op: WhereOp; value: string } | null;
	only: OnlyFilter;
	/** 'updated' | 'created' | 'name' | 'progress' | 'random' | 'field:<id>' */
	sort: string;
	dir: 'asc' | 'desc';
}

export const ANY_TYPE = '__any';
export const NO_FIELD = '__none';

export const WHERE_OPS: Array<{ id: WhereOp; label: string; needsValue: boolean }> = [
	{ id: 'is', label: 'is', needsValue: true },
	{ id: 'is-not', label: 'is not', needsValue: true },
	{ id: 'contains', label: 'contains', needsValue: true },
	{ id: 'not-empty', label: 'is filled in', needsValue: false },
	{ id: 'empty', label: 'is empty', needsValue: false },
	{ id: 'gt', label: 'is more than', needsValue: true },
	{ id: 'lt', label: 'is less than', needsValue: true },
];

const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x) : []);

/**
 * Settings that only make sense for the previous choice are cleared: a new type drops the
 * old type's field filter, field, columns and field-based order/grouping; a new filter
 * field drops its value; a new order goes back to its natural direction.
 */
export function resetDependents(key: string, config: Record<string, unknown>): Record<string, unknown> {
	const c = { ...config };
	if (key === 'type') {
		for (const k of ['whereField', 'whereOp', 'whereValue', 'field', 'columns']) delete c[k];
		if (typeof c.sort === 'string' && c.sort.startsWith('field:')) delete c.sort;
		if (typeof c.groupBy === 'string' && c.groupBy.startsWith('field:')) delete c.groupBy;
		if (c.groupBy === 'type' && c.type !== ANY_TYPE) delete c.groupBy;
	} else if (key === 'whereField') delete c.whereValue;
	else if (key === 'sort') delete c.dir;
	return c;
}

export function queryFromConfig(c: Record<string, unknown>): EntryQuery {
	const type = typeof c.type === 'string' && c.type && c.type !== ANY_TYPE ? c.type : null;
	const whereField = typeof c.whereField === 'string' && c.whereField !== NO_FIELD ? c.whereField : '';
	const op = WHERE_OPS.some((o) => o.id === c.whereOp) ? (c.whereOp as WhereOp) : 'is';
	return {
		type,
		statuses: strs(c.statuses),
		tags: strs(c.tags).map((t) => t.replace(/^#/, '').toLowerCase()),
		where: whereField && type ? { field: whereField, op, value: typeof c.whereValue === 'string' ? c.whereValue : typeof c.whereValue === 'number' ? String(c.whereValue) : '' } : null,
		only: (['all', 'favorites', 'pinned', 'with-image', 'this-month'] as const).includes(c.only as OnlyFilter) ? (c.only as OnlyFilter) : 'all',
		sort: typeof c.sort === 'string' && c.sort ? c.sort : 'updated',
		// 'auto' (or nothing): A–Z for names and fields, newest / most developed first otherwise.
		dir: c.dir === 'asc' ? 'asc' : c.dir === 'desc' ? 'desc' : defaultDir(typeof c.sort === 'string' && c.sort ? c.sort : 'updated'),
	};
}

function defaultDir(sort: string): 'asc' | 'desc' {
	return sort === 'name' || sort.startsWith('field:') ? 'asc' : 'desc';
}

const lower = (s: string) => s.trim().toLowerCase();

export function hasImage(e: EntityRecord): boolean {
	return !!(e.media.portrait?.path || e.media.banner?.path || e.media.gallery?.length);
}

function startOfMonth(): number {
	const d = new Date();
	return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

/** The parts of a field's value as text ("Guild", or each item of a list). */
function valueParts(s: WorldSession, e: EntityRecord, field: FieldDefinition): string[] {
	const v = s.values.get(e, field);
	if (Array.isArray(v)) {
		return v
			.map((x) => {
				if (x && typeof x === 'object' && 'name' in x) return String((x as { name: unknown }).name);
				if (field.type === 'multiselect') return selectOptions(field).find((o) => o.id === x)?.label ?? String(x);
				return typeof x === 'string' || typeof x === 'number' ? String(x) : '';
			})
			.filter(Boolean);
	}
	const t = s.values.text(e, field);
	return t ? [t] : [];
}

function numberOf(s: WorldSession, e: EntityRecord, field: FieldDefinition): number | null {
	const v = s.values.get(e, field);
	if (typeof v === 'number' && Number.isFinite(v)) return v;
	if (typeof v === 'string') {
		// The first number in the text: "~240,000" → 240000, "5′10″" → 5, "1,000–2,000" → 1000.
		const m = /-?\d[\d,]*(?:\.\d+)?/.exec(v);
		const n = m ? Number.parseFloat(m[0].replace(/,/g, '')) : Number.NaN;
		return Number.isFinite(n) ? n : null;
	}
	return null;
}

export function fieldOf(s: WorldSession, typeId: string, fieldId: string): FieldDefinition | undefined {
	return s.schemas.get(typeId)?.fields.find((f) => f.id === fieldId);
}

/** A filter on a field the type no longer has (deleted or renamed in Type Studio). */
export function whereFieldMissing(s: WorldSession, q: EntryQuery): boolean {
	return !!q.where && !!q.type && !!s.schemas.get(q.type) && !fieldOf(s, q.type, q.where.field);
}

function compareTarget(s: WorldSession, e: EntityRecord, field: FieldDefinition, raw: string, op: 'gt' | 'lt'): number | null {
	const v = s.values.get(e, field);
	if (field.type === 'date') {
		const t = raw.trim();
		if (typeof v !== 'string' || !v || !t) return null;
		// A partial date is a whole period: "after 2024" means after 2024-12-31 and
		// "before 2024" before 2024-01-01, so compare against the right end of it.
		const parts = t.split('-');
		const atEnd = op === 'gt';
		const full =
			parts.length === 1 ? `${parts[0]}-${atEnd ? '12-31' : '01-01'}` : parts.length === 2 ? `${parts[0]}-${parts[1]!.padStart(2, '0')}-${atEnd ? '31' : '01'}` : t;
		return v.localeCompare(full, undefined, { numeric: true });
	}
	if (field.type === 'chrono') {
		const year = v && typeof v === 'object' && typeof (v as { year?: unknown }).year === 'number' ? (v as { year: number }).year : null;
		const target = Number.parseFloat(raw);
		return year === null || !Number.isFinite(target) ? null : year - target;
	}
	const n = numberOf(s, e, field);
	const target = Number.parseFloat(raw);
	return n === null || !Number.isFinite(target) ? null : n - target;
}

export function matchesWhere(s: WorldSession, e: EntityRecord, w: NonNullable<EntryQuery['where']>): boolean {
	const field = fieldOf(s, e.typeId, w.field);
	// A removed field matches nothing; widgets say so (whereFieldMissing) rather than
	// quietly showing everything.
	if (!field) return false;
	const parts = valueParts(s, e, field);
	const want = lower(w.value);
	switch (w.op) {
		case 'empty':
			return parts.length === 0;
		case 'not-empty':
			return parts.length > 0;
		case 'is':
			return !want || parts.some((p) => lower(p) === want);
		case 'is-not':
			// Blank values aren't "not X" — they're unknown.
			return parts.length > 0 && (!want || !parts.some((p) => lower(p) === want));
		case 'contains':
			return !want || parts.some((p) => lower(p).includes(want));
		case 'gt':
		case 'lt': {
			const d = compareTarget(s, e, field, w.value, w.op);
			if (d === null) return false;
			return w.op === 'gt' ? d > 0 : d < 0;
		}
	}
}

/** Entries matching a query (live, not trashed or archived), sorted unless `sorted: false`. */
export function runQuery(s: WorldSession, q: EntryQuery, o: { sorted?: boolean } = {}): EntityRecord[] {
	const since = q.only === 'this-month' ? startOfMonth() : 0;
	const out = s.entities.all().filter((e) => {
		if (e.trashedAt || e.archivedAt) return false;
		if (q.type && e.typeId !== q.type) return false;
		if (!s.schemas.get(e.typeId)) return false;
		if (q.statuses.length && !q.statuses.includes(e.status)) return false;
		if (q.tags.length && !q.tags.some((t) => e.tags.some((x) => x.toLowerCase() === t))) return false;
		if (q.only === 'favorites' && !e.flags.favorite) return false;
		if (q.only === 'pinned' && !e.flags.pinned) return false;
		if (q.only === 'with-image' && !hasImage(e)) return false;
		if (since && e.createdAt < since) return false;
		if (q.where && !matchesWhere(s, e, q.where)) return false;
		return true;
	});
	return o.sorted === false ? out : sortEntries(s, out, q.sort, q.dir);
}

export function sortEntries(s: WorldSession, list: EntityRecord[], sort: string, dir: 'asc' | 'desc'): EntityRecord[] {
	const sign = dir === 'asc' ? 1 : -1;
	if (sort === 'random') return shuffled(list, daySeed());
	const byName = (a: EntityRecord, b: EntityRecord) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
	let cmp: (a: EntityRecord, b: EntityRecord) => number;
	if (sort === 'name') cmp = byName;
	else if (sort === 'created') cmp = (a, b) => a.createdAt - b.createdAt;
	else if (sort === 'progress') {
		const p = new Map(list.map((e) => [e.id, s.entityService.progress(e).ratio]));
		cmp = (a, b) => (p.get(a.id) ?? 0) - (p.get(b.id) ?? 0);
	} else if (sort.startsWith('field:')) {
		const id = sort.slice(6);
		const fieldFor = (e: EntityRecord) => fieldOf(s, e.typeId, id);
		const blank = new Map(list.map((e) => [e.id, (() => { const f = fieldFor(e); return !f || s.values.isEmpty(e, f); })()]));
		// Blanks always go last, whichever direction.
		const sorted = [...list].sort((a, b) => {
			const ba = blank.get(a.id);
			const bb = blank.get(b.id);
			if (ba || bb) return ba && bb ? byName(a, b) : ba ? 1 : -1;
			const fa = fieldFor(a)!;
			const fb = fieldFor(b)!;
			const c = fa.type === fb.type ? s.values.compare(a, b, fa) : s.values.text(a, fa).localeCompare(s.values.text(b, fb), undefined, { numeric: true, sensitivity: 'base' });
			return sign * c || byName(a, b);
		});
		return sorted;
	} else cmp = (a, b) => a.updatedAt - b.updatedAt;
	return [...list].sort((a, b) => sign * cmp(a, b) || byName(a, b));
}

/** A stable shuffle: the same order all day, a new one tomorrow (or per `seed`). */
export function shuffled<T>(list: T[], seed: number): T[] {
	const out = [...list];
	let x = seed || 1;
	const rnd = () => {
		x = (x * 1103515245 + 12345) & 0x7fffffff;
		return x / 0x7fffffff;
	};
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(rnd() * (i + 1));
		[out[i], out[j]] = [out[j] as T, out[i] as T];
	}
	return out;
}

export function daySeed(offset = 0): number {
	const d = new Date();
	return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate() + offset * 7919;
}

// ── grouping (charts) ──────────────────────────────────────────────────────────

export interface Group {
	key: string;
	label: string;
	color: SemanticColor | null;
	entries: EntityRecord[];
}

/** Kinds a chart can group by: each entry falls into one group per value. */
export const GROUPABLE_KINDS = new Set(['select', 'multiselect', 'boolean', 'relation', 'parent', 'tags', 'list', 'text']);

/**
 * Group entries by 'status' | 'type' | 'tag' | 'field:<id>'. An entry with several values
 * (tags, multi-choice) counts once in each; one without counts under "Not set".
 */
export function groupEntries(s: WorldSession, entries: EntityRecord[], by: string): Group[] {
	const groups = new Map<string, Group>();
	const add = (key: string, label: string, color: SemanticColor | null, e: EntityRecord) => {
		const g = groups.get(key) ?? { key, label, color, entries: [] };
		g.entries.push(e);
		groups.set(key, g);
	};
	const NONE = '__none';
	for (const e of entries) {
		if (by === 'status') {
			const st = s.world.statuses.find((x) => x.id === e.status);
			add(e.status, st?.label ?? e.status, st?.color ?? null, e);
		} else if (by === 'type') {
			const t = s.schemas.get(e.typeId);
			add(e.typeId, t?.plural ?? e.typeId, t?.color ?? null, e);
		} else if (by === 'tag') {
			if (!e.tags.length) add(NONE, 'No tags', null, e);
			for (const t of e.tags) add(`#${t.toLowerCase()}`, `#${t}`, null, e);
		} else if (by.startsWith('field:')) {
			const field = fieldOf(s, e.typeId, by.slice(6));
			if (!field) continue;
			if (field.type === 'select' || field.type === 'multiselect') {
				const v = s.values.get(e, field);
				const ids = Array.isArray(v) ? v : v === null || v === undefined || v === '' ? [] : [v];
				if (!ids.length) add(NONE, 'Not set', null, e);
				for (const id of ids) {
					const o = selectOptions(field).find((x) => x.id === id || x.label === id);
					add(o?.id ?? String(id), o?.label ?? String(id), o?.color ?? null, e);
				}
			} else if (field.type === 'boolean') {
				const v = s.values.get(e, field) === true;
				add(v ? 'yes' : 'no', v ? 'Yes' : 'No', v ? 'green' : null, e);
			} else {
				const parts = valueParts(s, e, field);
				if (!parts.length) add(NONE, 'Not set', null, e);
				for (const p of parts) add(lower(p), p, null, e);
			}
		}
	}
	const list = [...groups.values()];
	// Choice fields keep their own option order; everything else is largest first.
	if (by.startsWith('field:')) {
		const anyEntry = entries[0];
		const field = anyEntry ? fieldOf(s, anyEntry.typeId, by.slice(6)) : undefined;
		if (field && (field.type === 'select' || field.type === 'multiselect')) {
			const order = selectOptions(field).map((o) => o.id);
			const rank = (k: string) => (k === NONE ? 1e6 : order.includes(k) ? order.indexOf(k) : 1e5);
			return list.sort((a, b) => rank(a.key) - rank(b.key));
		}
	}
	if (by === 'status') {
		const order = s.world.statuses.map((x) => x.id);
		return list.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
	}
	return list.sort((a, b) => (a.key === NONE ? 1 : 0) - (b.key === NONE ? 1 : 0) || b.entries.length - a.entries.length || a.label.localeCompare(b.label));
}

// ── measures (number widget) ───────────────────────────────────────────────────

export type Measure = 'count' | 'sum' | 'avg' | 'min' | 'max' | 'filled' | 'progress';

export const MEASURES: Array<{ id: Measure; label: string; needsField: boolean }> = [
	{ id: 'count', label: 'How many entries', needsField: false },
	{ id: 'progress', label: 'Average development', needsField: false },
	{ id: 'filled', label: '% with a field filled in', needsField: true },
	{ id: 'sum', label: 'Total of a number field', needsField: true },
	{ id: 'avg', label: 'Average of a number field', needsField: true },
	{ id: 'min', label: 'Smallest value of a number field', needsField: true },
	{ id: 'max', label: 'Largest value of a number field', needsField: true },
];

export interface MeasureResult {
	value: number | null;
	display: string;
	/** 0–1 for percentages. */
	ratio: number | null;
	/** Entries the value was computed from. */
	n: number;
}

const fmt = (n: number) => (Math.abs(n) >= 1000 ? Math.round(n).toLocaleString() : Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 1 }));

export function measure(s: WorldSession, entries: EntityRecord[], m: Measure, fieldId: string | null): MeasureResult {
	if (m === 'count') return { value: entries.length, display: entries.length.toLocaleString(), ratio: null, n: entries.length };
	if (m === 'progress') {
		if (!entries.length) return { value: null, display: '—', ratio: null, n: 0 };
		const r = entries.reduce((a, e) => a + s.entityService.progress(e).ratio, 0) / entries.length;
		return { value: r, display: `${Math.round(r * 100)}%`, ratio: r, n: entries.length };
	}
	if (!fieldId) return { value: null, display: '—', ratio: null, n: 0 };
	if (m === 'filled') {
		if (!entries.length) return { value: null, display: '—', ratio: null, n: 0 };
		const filled = entries.filter((e) => {
			const f = fieldOf(s, e.typeId, fieldId);
			return f ? !s.values.isEmpty(e, f) : false;
		}).length;
		const r = filled / entries.length;
		return { value: r, display: `${Math.round(r * 100)}%`, ratio: r, n: entries.length };
	}
	const nums = entries
		.map((e) => {
			const f = fieldOf(s, e.typeId, fieldId);
			return f ? numberOf(s, e, f) : null;
		})
		.filter((x): x is number => x !== null);
	if (!nums.length) return { value: null, display: '—', ratio: null, n: 0 };
	const v = m === 'sum' ? nums.reduce((a, b) => a + b, 0) : m === 'avg' ? nums.reduce((a, b) => a + b, 0) / nums.length : m === 'min' ? Math.min(...nums) : Math.max(...nums);
	return { value: v, display: fmt(v), ratio: null, n: nums.length };
}

// ── settings helpers ───────────────────────────────────────────────────────────

export function typeChoices(s: WorldSession, withAny = true): Array<{ id: string; label: string }> {
	const types = s.schemas
		.list()
		.filter((t) => !t.archived)
		.map((t) => ({ id: t.id, label: t.plural }));
	return withAny ? [{ id: ANY_TYPE, label: 'Every type' }, ...types] : types;
}

/** Fields of a type worth filtering, grouping or showing (no hidden or media fields). */
export function usableFields(schema: EntitySchema | undefined, kinds?: Set<string>): FieldDefinition[] {
	return (schema?.fields ?? []).filter((f) => !f.hidden && (!kinds || kinds.has(f.type)) && !['image', 'gallery', 'file', 'richtext'].includes(f.type));
}

export function allTags(s: WorldSession): string[] {
	const set = new Map<string, string>();
	for (const e of s.entities.all()) if (!e.trashedAt) for (const t of e.tags) set.set(t.toLowerCase(), t);
	return [...set.values()].sort((a, b) => a.localeCompare(b));
}

/**
 * The shared "which entries" settings of a builder widget. Field-dependent rows (filter
 * by a field, sort by a field) appear once a single type is chosen.
 */
export function queryFields(s: WorldSession, config: Record<string, unknown>, opts: { sort?: boolean; only?: boolean } = {}): FieldDefinition[] {
	const q = queryFromConfig(config);
	const schema = q.type ? s.schemas.get(q.type) : undefined;
	const out: FieldDefinition[] = [
		{ id: 'type', type: 'select', label: 'Entries of type', config: { options: typeChoices(s) } },
		{ id: 'statuses', type: 'multiselect', label: 'Status', placeholder: 'Any status', config: { options: s.world.statuses.map((x) => ({ id: x.id, label: x.label, color: x.color })) } },
	];
	const tags = allTags(s);
	if (tags.length) out.push({ id: 'tags', type: 'multiselect', label: 'With any of these tags', placeholder: 'Any tags', width: 'full', config: { options: tags.map((t) => ({ id: t, label: `#${t}` })) } });
	if (opts.only !== false) {
		out.push({
			id: 'only',
			type: 'select',
			label: 'Only',
			config: {
				options: [
					{ id: 'all', label: 'All of them' },
					{ id: 'favorites', label: 'Favorites' },
					{ id: 'pinned', label: 'Pinned' },
					{ id: 'with-image', label: 'With an image' },
					{ id: 'this-month', label: 'Created this month' },
				],
			},
		});
	}
	if (schema) {
		const fields = usableFields(schema);
		out.push({
			id: 'whereField',
			type: 'select',
			label: 'Where',
			description: 'Narrow it down by one of the type’s fields.',
			config: { options: [{ id: NO_FIELD, label: 'Any value of any field' }, ...fields.map((f) => ({ id: f.id, label: f.label }))] },
		});
		if (q.where) {
			out.push({ id: 'whereOp', type: 'select', label: 'Condition', config: { options: WHERE_OPS.map((o) => ({ id: o.id, label: o.label })) } });
			if (WHERE_OPS.find((o) => o.id === q.where?.op)?.needsValue) {
				const field = fields.find((f) => f.id === q.where?.field);
				const choices = field && (field.type === 'select' || field.type === 'multiselect') ? selectOptions(field) : null;
				out.push(
					choices
						? { id: 'whereValue', type: 'select', label: 'Value', config: { options: choices.map((o) => ({ id: o.label, label: o.label, color: o.color })) } }
						: { id: 'whereValue', type: 'text', label: 'Value', placeholder: 'Type a value' },
				);
			}
		}
	}
	if (opts.sort !== false) {
		const fieldSorts = schema ? usableFields(schema, new Set(['text', 'number', 'select', 'date', 'chrono', 'boolean', 'rating', 'percent'])).map((f) => ({ id: `field:${f.id}`, label: f.label })) : [];
		out.push(
			{
				id: 'sort',
				type: 'select',
				label: 'Order by',
				config: {
					options: [
						{ id: 'updated', label: 'Last edited' },
						{ id: 'created', label: 'Date created' },
						{ id: 'name', label: 'Name' },
						{ id: 'progress', label: 'Development' },
						{ id: 'random', label: 'Shuffle daily' },
						...fieldSorts,
					],
				},
			},
			{
				id: 'dir',
				type: 'select',
				label: 'Direction',
				config: {
					options: [
						{ id: 'auto', label: 'Natural (A–Z, newest first)' },
						{ id: 'asc', label: 'A–Z / lowest / oldest first' },
						{ id: 'desc', label: 'Z–A / highest / newest first' },
					],
				},
			},
		);
	}
	return out;
}

/** Short human summary of a query ("Characters · Main · Alive"), for empty states and tooltips. */
export function describeQuery(s: WorldSession, q: EntryQuery): string {
	const parts: string[] = [q.type ? (s.schemas.get(q.type)?.plural ?? 'A removed type') : 'All entries'];
	if (q.statuses.length) parts.push(q.statuses.map((id) => s.world.statuses.find((x) => x.id === id)?.label ?? id).join(' or '));
	if (q.tags.length) parts.push(q.tags.map((t) => `#${t}`).join(' or '));
	if (q.where && q.type) {
		const f = fieldOf(s, q.type, q.where.field);
		const op = WHERE_OPS.find((o) => o.id === q.where?.op);
		if (f && op) parts.push(`${f.label} ${op.label}${op.needsValue && q.where.value ? ` ${q.where.value}` : ''}`);
	}
	const only = { favorites: 'favorites', pinned: 'pinned', 'with-image': 'with an image', 'this-month': 'created this month', all: '' }[q.only];
	if (only) parts.push(only);
	return parts.join(' · ');
}
