import { isForeignCondition, type DatabaseView, type EntityRecord, type EntitySchema, type FieldDefinition, type SemanticColor, type ViewCondition, type ViewOp, type ViewSort } from '../core/types';
import { selectOptions } from '../fields/types/logic';
import { fieldOf, groupEntries, matchesWhere, type Group } from './entryQuery';
import type { WorldSession } from './WorldSession';

/**
 * Filtering, sorting and grouping for saved database views (Milestone 8). Conditions can
 * use the type's fields or built-in properties of every entry (status, tags, portrait,
 * dates, development, connections, favourite). Pure apart from reading the session.
 */

export type BuiltinKind = 'text' | 'choice' | 'tags' | 'presence' | 'date' | 'percent' | 'number';

export const BUILTIN_PROPS: Array<{ id: string; label: string; icon: string; kind: BuiltinKind; sortable: boolean }> = [
	{ id: '__name', label: 'Name', icon: 'type', kind: 'text', sortable: true },
	{ id: '__status', label: 'Status', icon: 'circle-dot', kind: 'choice', sortable: true },
	{ id: '__tags', label: 'Tags', icon: 'tags', kind: 'tags', sortable: false },
	{ id: '__image', label: 'Portrait', icon: 'image', kind: 'presence', sortable: false },
	{ id: '__favorite', label: 'Favorite', icon: 'star', kind: 'presence', sortable: false },
	{ id: '__progress', label: 'Developed', icon: 'gauge', kind: 'percent', sortable: true },
	{ id: '__connections', label: 'Connections', icon: 'link-2', kind: 'number', sortable: true },
	{ id: '__created', label: 'Created', icon: 'calendar-plus', kind: 'date', sortable: true },
	{ id: '__updated', label: 'Last edited', icon: 'history', kind: 'date', sortable: true },
];

export const builtin = (id: string) => BUILTIN_PROPS.find((b) => b.id === id);

/** Field kinds a view can filter, sort and show (media and long text are shown, not filtered). */
const UNFILTERABLE = new Set(['image', 'gallery', 'file', 'richtext']);

export function viewFields(schema: EntitySchema): FieldDefinition[] {
	return schema.fields.filter((f) => !f.hidden);
}

export function filterableFields(schema: EntitySchema): FieldDefinition[] {
	return viewFields(schema).filter((f) => !UNFILTERABLE.has(f.type));
}

/** Label and icon of a property (field or built-in), or null when it no longer exists. */
export function propInfo(schema: EntitySchema, id: string): { label: string; icon: string; field?: FieldDefinition; kind: string } | null {
	const b = builtin(id);
	if (b) return { label: b.label, icon: b.icon, kind: b.kind };
	const f = schema.fields.find((x) => x.id === id);
	return f ? { label: f.label, icon: f.icon ?? 'circle', field: f, kind: f.type } : null;
}

/** Which conditions make sense for a property, worded for it. */
export function opsFor(schema: EntitySchema, id: string): Array<{ id: ViewOp; label: string; needsValue: boolean }> {
	const info = propInfo(schema, id);
	const kind = info?.kind ?? 'text';
	const isNumeric = ['number', 'percent', 'rating', 'progress', 'connections'].includes(kind) || id === '__progress' || id === '__connections';
	const isDate = kind === 'date' || kind === 'chrono';
	if (kind === 'presence') {
		return id === '__favorite'
			? [
					{ id: 'not-empty', label: 'is a favorite', needsValue: false },
					{ id: 'empty', label: 'is not a favorite', needsValue: false },
				]
			: [
					{ id: 'not-empty', label: 'is set', needsValue: false },
					{ id: 'empty', label: 'is missing', needsValue: false },
				];
	}
	if (kind === 'boolean') {
		return [
			{ id: 'not-empty', label: 'is ticked', needsValue: false },
			{ id: 'empty', label: 'is not ticked', needsValue: false },
		];
	}
	if (isDate) {
		return [
			{ id: 'gt', label: 'is after', needsValue: true },
			{ id: 'lt', label: 'is before', needsValue: true },
			{ id: 'not-empty', label: 'is set', needsValue: false },
			{ id: 'empty', label: 'is empty', needsValue: false },
		];
	}
	if (isNumeric) {
		return [
			{ id: 'gt', label: 'is more than', needsValue: true },
			{ id: 'lt', label: 'is less than', needsValue: true },
			{ id: 'is', label: 'is', needsValue: true },
			{ id: 'not-empty', label: 'is set', needsValue: false },
			{ id: 'empty', label: 'is empty', needsValue: false },
		];
	}
	if (kind === 'choice' || kind === 'select' || kind === 'multiselect' || kind === 'tags' || kind === 'relation' || kind === 'parent' || kind === 'list') {
		return [
			{ id: 'is', label: kind === 'multiselect' || kind === 'tags' || kind === 'list' || kind === 'relation' ? 'includes' : 'is', needsValue: true },
			{ id: 'is-not', label: kind === 'multiselect' || kind === 'tags' || kind === 'list' || kind === 'relation' ? 'doesn’t include' : 'is not', needsValue: true },
			{ id: 'not-empty', label: 'is set', needsValue: false },
			{ id: 'empty', label: 'is empty', needsValue: false },
		];
	}
	return [
		{ id: 'contains', label: 'contains', needsValue: true },
		{ id: 'is', label: 'is', needsValue: true },
		{ id: 'is-not', label: 'is not', needsValue: true },
		{ id: 'not-empty', label: 'is set', needsValue: false },
		{ id: 'empty', label: 'is empty', needsValue: false },
	];
}

/** The value choices for a condition (choice fields, status, tags), or null for free text. */
export function valueChoices(s: WorldSession, schema: EntitySchema, id: string): Array<{ id: string; label: string; color?: SemanticColor }> | null {
	if (id === '__status') return s.world.statuses.map((x) => ({ id: x.id, label: x.label, color: x.color }));
	if (id === '__tags') {
		const tags = new Map<string, string>();
		for (const e of s.index.ofType(schema.id, { includeArchived: true })) for (const t of e.tags) tags.set(t.toLowerCase(), t);
		return [...tags.values()].sort((a, b) => a.localeCompare(b)).map((t) => ({ id: t, label: `#${t}` }));
	}
	const f = schema.fields.find((x) => x.id === id);
	if (f && (f.type === 'select' || f.type === 'multiselect')) return selectOptions(f).map((o) => ({ id: o.label, label: o.label, color: o.color }));
	return null;
}

const lower = (v: string) => v.trim().toLowerCase();
const DAY = 86400000;

function dateTarget(raw: string, op: 'gt' | 'lt'): number | null {
	const t = raw.trim();
	if (!t) return null;
	// "30d" = within / before the last 30 days.
	const rel = /^(\d+)\s*d(ays?)?$/i.exec(t);
	if (rel) return Date.now() - Number(rel[1]) * DAY;
	const parts = t.split('-').map((x) => Number.parseInt(x, 10));
	if (!parts.length || parts.some((n) => !Number.isFinite(n))) return null;
	const [y, m = op === 'gt' ? 12 : 1, d] = parts as [number, number?, number?];
	// "After 2026-04" means after the last day of April (day 0 of the next month).
	const date = d === undefined ? (op === 'gt' ? new Date(y, m, 0) : new Date(y, m - 1, 1)) : new Date(y, m - 1, d);
	if (op === 'gt') date.setHours(23, 59, 59, 999);
	return date.getTime();
}

/** Does an entry satisfy one condition? A condition on a removed field matches nothing. */
export function matchCondition(s: WorldSession, e: EntityRecord, c: ViewCondition): boolean {
	if (isForeignCondition(c)) return false;
	const want = lower(c.value);
	switch (c.field) {
		case '__name': {
			const names = [e.name, ...e.aliases].map(lower);
			if (c.op === 'contains') return !want || names.some((n) => n.includes(want));
			if (c.op === 'is') return !want || names.includes(want);
			if (c.op === 'is-not') return !want || !names.includes(want);
			if (c.op === 'empty') return !e.name.trim();
			return !!e.name.trim();
		}
		case '__status': {
			const st = s.world.statuses.find((x) => x.id === e.status);
			const hit = !want || lower(e.status) === want || lower(st?.label ?? '') === want;
			if (c.op === 'is') return hit;
			if (c.op === 'is-not') return !hit;
			return c.op === 'not-empty' ? !!e.status : !e.status;
		}
		case '__tags': {
			const tags = e.tags.map((t) => lower(t.replace(/^#/, '')));
			const w = want.replace(/^#/, '');
			if (c.op === 'empty') return tags.length === 0;
			if (c.op === 'not-empty') return tags.length > 0;
			if (c.op === 'is-not') return !w || !tags.includes(w);
			if (c.op === 'contains') return !w || tags.some((t) => t.includes(w));
			return !w || tags.includes(w);
		}
		case '__image':
			return c.op === 'empty' ? !e.media.portrait : c.op === 'not-empty' ? !!e.media.portrait : true;
		case '__favorite':
			return c.op === 'empty' ? !e.flags.favorite : c.op === 'not-empty' ? !!e.flags.favorite : true;
		case '__created':
		case '__updated': {
			const t = c.field === '__created' ? e.createdAt : e.updatedAt;
			if (c.op === 'gt' || c.op === 'lt') {
				const target = dateTarget(c.value, c.op);
				if (target === null) return true;
				return c.op === 'gt' ? t > target : t < target;
			}
			return c.op !== 'empty';
		}
		case '__progress':
		case '__connections': {
			const v = c.field === '__progress' ? Math.round(s.entityService.progress(e).ratio * 100) : s.relations.count(e.id);
			const n = Number.parseFloat(c.value);
			if (c.op === 'empty') return v === 0;
			if (c.op === 'not-empty') return v > 0;
			if (!Number.isFinite(n)) return true;
			return c.op === 'gt' ? v > n : c.op === 'lt' ? v < n : v === n;
		}
		default: {
			const f = fieldOf(s, e.typeId, c.field);
			if (!f) return false;
			if (f.type === 'boolean') {
				const v = s.values.get(e, f) === true;
				return c.op === 'empty' ? !v : c.op === 'not-empty' ? v : true;
			}
			return matchesWhere(s, e, { field: c.field, op: c.op, value: c.value });
		}
	}
}

/** Conditions that refer to fields the type no longer has. */
export function brokenConditions(schema: EntitySchema, view: DatabaseView): ViewCondition[] {
	return view.conditions.filter((c) => isForeignCondition(c) || (!builtin(c.field) && !schema.fields.some((f) => f.id === c.field)));
}

/** Sort keys, first wins; blanks always last; ties by name. */
export function sortByView(s: WorldSession, list: EntityRecord[], sorts: ViewSort[]): EntityRecord[] {
	const byName = (a: EntityRecord, b: EntityRecord) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
	const keys = sorts.length ? sorts : [{ field: '__updated', dir: 'desc' as const }];
	const statusRank = new Map(s.world.statuses.map((st, i) => [st.id, i]));
	const progress = keys.some((k) => k.field === '__progress') ? new Map(list.map((e) => [e.id, s.entityService.progress(e).ratio])) : null;
	const cmps = keys.map((k) => {
		const sign = k.dir === 'asc' ? 1 : -1;
		switch (k.field) {
			case '__name':
				return (a: EntityRecord, b: EntityRecord) => sign * byName(a, b);
			case '__status':
				return (a: EntityRecord, b: EntityRecord) => sign * ((statusRank.get(a.status) ?? 99) - (statusRank.get(b.status) ?? 99));
			case '__created':
				return (a: EntityRecord, b: EntityRecord) => sign * (a.createdAt - b.createdAt);
			case '__updated':
				return (a: EntityRecord, b: EntityRecord) => sign * (a.updatedAt - b.updatedAt);
			case '__progress':
				return (a: EntityRecord, b: EntityRecord) => sign * ((progress?.get(a.id) ?? 0) - (progress?.get(b.id) ?? 0));
			case '__connections':
				return (a: EntityRecord, b: EntityRecord) => sign * (s.relations.count(a.id) - s.relations.count(b.id));
			default: {
				const blank = new Map<string, boolean>();
				const isBlank = (e: EntityRecord) => {
					let v = blank.get(e.id);
					if (v === undefined) {
						const f = fieldOf(s, e.typeId, k.field);
						v = !f || s.values.isEmpty(e, f);
						blank.set(e.id, v);
					}
					return v;
				};
				return (a: EntityRecord, b: EntityRecord) => {
					const ba = isBlank(a);
					const bb = isBlank(b);
					if (ba || bb) return ba === bb ? 0 : ba ? 1 : -1; // blanks last, either direction
					const f = fieldOf(s, a.typeId, k.field)!;
					return sign * s.values.compare(a, b, f);
				};
			}
		}
	});
	return [...list].sort((a, b) => {
		for (const c of cmps) {
			const r = c(a, b);
			if (r) return r;
		}
		return byName(a, b);
	});
}

/** The entries a view shows (live entries of its type, archived when asked), in its order. */
export function runView(s: WorldSession, view: DatabaseView, search = ''): EntityRecord[] {
	const q = search.trim();
	let list = q
		? s.search.search(q, { typeId: view.typeId, limit: 100000, includeArchived: view.showArchived }).map((h) => h.entity)
		: s.index.ofType(view.typeId, { includeArchived: view.showArchived });
	if (view.conditions.length) {
		const test = (e: EntityRecord) => (view.match === 'any' ? view.conditions.some((c) => matchCondition(s, e, c)) : view.conditions.every((c) => matchCondition(s, e, c)));
		list = list.filter(test);
	}
	// A search keeps relevance order unless the view sorts explicitly.
	return q && !view.sorts.length ? list : sortByView(s, list, view.sorts);
}

const GROUP_CHOICE = ['select', 'multiselect', 'boolean'];
const GROUP_LINK = ['relation', 'parent'];
const GROUP_LIST = ['tags', 'list'];

/**
 * Properties a view can group by, each with the section it's offered under. Free-text lists
 * (Nicknames, Scars…) aren't offered — they make one group per line — but a view saved
 * grouped by one (before they were dropped) keeps working: pass `includeLists`.
 */
export function groupableProps(schema: EntitySchema, o: { includeLists?: boolean } = {}): Array<{ id: string; label: string; group: string; type: string }> {
	const fields = viewFields(schema);
	const pick = (types: string[], group: string) => fields.filter((f) => types.includes(f.type)).map((f) => ({ id: f.id, label: f.label, group, type: f.type }));
	return [
		{ id: '__status', label: 'Status', group: 'Every entry', type: '__status' },
		{ id: '__tags', label: 'Tags', group: 'Every entry', type: '__tags' },
		...pick(GROUP_CHOICE, 'Choices'),
		...pick(GROUP_LINK, 'Linked entries'),
		...(o.includeLists ? pick(GROUP_LIST, 'Lists') : []),
	];
}

/** Single-valued properties a board's columns can be dragged between. */
export function boardProps(schema: EntitySchema): Array<{ id: string; label: string }> {
	return [{ id: '__status', label: 'Status' }, ...viewFields(schema).filter((f) => f.type === 'select').map((f) => ({ id: f.id, label: f.label }))];
}

/** Group a view's entries; choice properties list every option (empty ones too, for boards). */
export function groupView(s: WorldSession, schema: EntitySchema, entries: EntityRecord[], by: string, o: { allOptions?: boolean } = {}): Group[] {
	const key = by === '__status' ? 'status' : by === '__tags' ? 'tag' : `field:${by}`;
	const groups = groupEntries(s, entries, key);
	if (!o.allOptions) return groups;
	const have = new Set(groups.map((g) => g.key));
	const all: Group[] = [];
	if (by === '__status') {
		for (const st of s.world.statuses) all.push(groups.find((g) => g.key === st.id) ?? { key: st.id, label: st.label, color: st.color, entries: [] });
	} else {
		const f = schema.fields.find((x) => x.id === by);
		if (f && (f.type === 'select' || f.type === 'multiselect')) {
			for (const opt of selectOptions(f)) all.push(groups.find((g) => g.key === opt.id) ?? { key: opt.id, label: opt.label, color: opt.color ?? null, entries: [] });
		}
	}
	for (const g of groups) if (!all.some((x) => x.key === g.key)) all.push(g);
	void have;
	return all;
}

/** Kinds whose value is derived, not stored (they don't count as "missing"). */
const DERIVED = new Set(['rollup', 'formula', 'children']);

/**
 * The key details an entry still lacks — required and recommended fields, a summary and an
 * image — in the order the type lists them. The same rules as development progress.
 */
export function missingKeyFields(s: WorldSession, schema: EntitySchema, e: EntityRecord): string[] {
	const out: string[] = [];
	if (!e.description.trim()) out.push('Summary');
	if (!e.media.portrait && !e.media.banner) out.push('Image');
	for (const f of schema.fields) {
		if ((!f.required && !f.recommended) || DERIVED.has(f.type)) continue;
		if (s.values.isEmpty(e, f)) out.push(f.label);
	}
	return out;
}
