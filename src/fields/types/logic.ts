import type { FieldDefinition, SelectOption } from '../../core/types';
import { formatChronoDate, chronoOrdinal, isChronoDate, parseChronoText, type ChronoDate } from '../../core/types/chrono';
import type { CoerceResult, FieldTypeLogic } from '../FieldType';

/**
 * Pure logic for every built-in field type. UI halves live in fields/ui/.
 * Keep this file free of DOM and Obsidian imports.
 */

const ok = (value: unknown): CoerceResult => ({ ok: true, value });
const fail: CoerceResult = { ok: false };

const isBlank = (v: unknown) =>
	v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);

const asString = (v: unknown): string | null => {
	if (typeof v === 'string') return v;
	if (typeof v === 'number' || typeof v === 'boolean') return String(v);
	if (Array.isArray(v)) return v.map((x) => asString(x) ?? '').filter(Boolean).join(', ');
	if (isChronoDate(v)) return formatChronoDate(v);
	return null;
};

const asNumber = (v: unknown): number | null => {
	if (typeof v === 'number' && Number.isFinite(v)) return v;
	if (typeof v === 'string' && v.trim() !== '') {
		const n = Number(v.replace(/[%,\s]/g, ''));
		return Number.isFinite(n) ? n : null;
	}
	if (typeof v === 'boolean') return v ? 1 : 0;
	return null;
};

const asStringArray = (v: unknown): string[] | null => {
	if (Array.isArray(v)) return v.map((x) => asString(x)).filter((x): x is string => !!x && x.trim() !== '');
	if (typeof v === 'string') return v.split(',').map((s) => s.trim()).filter(Boolean);
	return null;
};

const textCompare = (a: unknown, b: unknown) =>
	(asString(a) ?? '').localeCompare(asString(b) ?? '', undefined, { sensitivity: 'base', numeric: true });

const numberCompare = (a: unknown, b: unknown) => (asNumber(a) ?? -Infinity) - (asNumber(b) ?? -Infinity);

export function selectOptions(field: FieldDefinition): SelectOption[] {
	const opts = field.config?.options;
	return Array.isArray(opts) ? (opts as SelectOption[]) : [];
}

function optionLabel(field: FieldDefinition, id: unknown): string {
	const opt = selectOptions(field).find((o) => o.id === id);
	return opt ? opt.label : typeof id === 'string' ? id : '';
}

function numberConfig(field: FieldDefinition) {
	const c = field.config ?? {};
	return {
		min: typeof c.min === 'number' ? c.min : null,
		max: typeof c.max === 'number' ? c.max : null,
		unit: typeof c.unit === 'string' ? c.unit : '',
	};
}

// ── text family ────────────────────────────────────────────────────────────────

const textBase = {
	category: 'text' as const,
	supportsPlaceholder: true,
	defaultValue: () => '',
	isEmpty: isBlank,
	validate: (v: unknown) => (v == null || typeof v === 'string' ? null : 'Expected text'),
	coerce: (v: unknown) => {
		const s = asString(v);
		return s === null ? fail : ok(s);
	},
	toText: (v: unknown) => asString(v) ?? '',
	compare: textCompare,
};

export const textLogic: FieldTypeLogic = { ...textBase, id: 'text', label: 'Short text', icon: 'type', defaultWidth: 'half' };
export const longTextLogic: FieldTypeLogic = { ...textBase, id: 'longtext', label: 'Long text', icon: 'align-left', defaultWidth: 'full' };
export const richTextLogic: FieldTypeLogic = { ...textBase, id: 'richtext', label: 'Rich text (Markdown)', icon: 'file-text', defaultWidth: 'full' };

export const urlLogic: FieldTypeLogic = {
	...textBase,
	id: 'url',
	label: 'URL',
	icon: 'link',
	defaultWidth: 'half',
	validate: (v) => {
		if (isBlank(v)) return null;
		if (typeof v !== 'string') return 'Expected a URL';
		return /^(https?:\/\/|obsidian:\/\/|mailto:)/i.test(v.trim()) ? null : 'URL should start with https://';
	},
};

export const colorLogic: FieldTypeLogic = {
	...textBase,
	supportsPlaceholder: false,
	id: 'color',
	label: 'Color',
	icon: 'palette',
	defaultWidth: 'third',
	validate: (v) => (isBlank(v) || (typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v)) ? null : 'Expected a hex color'),
};

export const iconLogic: FieldTypeLogic = { ...textBase, supportsPlaceholder: false, id: 'icon', label: 'Icon', icon: 'smile', defaultWidth: 'third', searchable: false };

export const timeLogic: FieldTypeLogic = {
	...textBase,
	supportsPlaceholder: false,
	id: 'time',
	label: 'Time',
	icon: 'clock',
	category: 'date',
	defaultWidth: 'third',
	validate: (v) => (isBlank(v) || (typeof v === 'string' && /^\d{1,2}:\d{2}$/.test(v)) ? null : 'Expected HH:MM'),
};

export const dateLogic: FieldTypeLogic = {
	...textBase,
	supportsPlaceholder: false,
	id: 'date',
	label: 'Date (real)',
	icon: 'calendar',
	category: 'date',
	defaultWidth: 'third',
	validate: (v) => (isBlank(v) || (typeof v === 'string' && /^-?\d{1,6}-\d{2}-\d{2}$/.test(v)) ? null : 'Expected YYYY-MM-DD'),
};

// ── numbers ────────────────────────────────────────────────────────────────────

export const numberLogic: FieldTypeLogic = {
	id: 'number',
	label: 'Number',
	icon: 'hash',
	category: 'number',
	defaultWidth: 'third',
	supportsPlaceholder: true,
	configFields: [
		{ id: 'min', type: 'number', label: 'Minimum', width: 'third', placeholder: 'None' },
		{ id: 'max', type: 'number', label: 'Maximum', width: 'third', placeholder: 'None' },
		{ id: 'unit', type: 'text', label: 'Unit', width: 'third', placeholder: 'e.g. years, km' },
	],
	defaultValue: () => null,
	isEmpty: (v) => v === null || v === undefined || v === '',
	validate: (v, field) => {
		if (v === null || v === undefined) return null;
		if (typeof v !== 'number' || !Number.isFinite(v)) return 'Expected a number';
		const { min, max } = numberConfig(field);
		if (min !== null && v < min) return `Must be at least ${min}`;
		if (max !== null && v > max) return `Must be at most ${max}`;
		return null;
	},
	coerce: (v) => {
		if (v === null || v === undefined || v === '') return ok(null);
		const n = asNumber(v);
		return n === null ? fail : ok(n);
	},
	toText: (v, field) => {
		const n = asNumber(v);
		if (n === null) return '';
		const { unit } = numberConfig(field);
		return `${n.toLocaleString()}${unit ? ' ' + unit : ''}`;
	},
	compare: numberCompare,
};

export const percentLogic: FieldTypeLogic = {
	...numberLogic,
	configFields: undefined,
	id: 'percent',
	label: 'Percentage',
	icon: 'percent',
	validate: (v) => (v == null || (typeof v === 'number' && v >= 0 && v <= 100) ? null : 'Expected 0–100'),
	toText: (v) => {
		const n = asNumber(v);
		return n === null ? '' : `${Math.round(n)}%`;
	},
};

export const ratingLogic: FieldTypeLogic = {
	...numberLogic,
	supportsPlaceholder: false,
	configFields: [{ id: 'max', type: 'number', label: 'Number of stars', width: 'third', config: { min: 1, max: 10 } }],
	id: 'rating',
	label: 'Rating',
	icon: 'star',
	validate: (v, field) => {
		if (v == null) return null;
		const max = typeof field.config?.max === 'number' ? field.config.max : 5;
		return typeof v === 'number' && v >= 0 && v <= max ? null : `Expected 0–${max}`;
	},
	toText: (v, field) => {
		const n = asNumber(v);
		const max = typeof field.config?.max === 'number' ? field.config.max : 5;
		return n === null ? '' : `${n}/${max}`;
	},
};

export const progressLogic: FieldTypeLogic = {
	...percentLogic,
	id: 'progress',
	label: 'Progress',
	icon: 'gauge',
};

// ── boolean ────────────────────────────────────────────────────────────────────

export const booleanLogic: FieldTypeLogic = {
	id: 'boolean',
	label: 'Checkbox',
	icon: 'check-square',
	category: 'other',
	defaultWidth: 'third',
	searchable: false,
	defaultValue: () => false,
	// A boolean is never "unfilled" in a meaningful way, except null.
	isEmpty: (v) => v === null || v === undefined,
	validate: (v) => (v == null || typeof v === 'boolean' ? null : 'Expected true/false'),
	coerce: (v) => {
		if (typeof v === 'boolean') return ok(v);
		if (typeof v === 'string') return ok(/^(true|yes|1|y|on)$/i.test(v.trim()));
		if (typeof v === 'number') return ok(v !== 0);
		return v == null ? ok(false) : fail;
	},
	toText: (v) => (v === true ? 'Yes' : v === false ? 'No' : ''),
	compare: (a, b) => Number(!!a) - Number(!!b),
};

// ── choices ────────────────────────────────────────────────────────────────────

export const selectLogic: FieldTypeLogic = {
	id: 'select',
	label: 'Select',
	icon: 'circle-dot',
	category: 'choice',
	hasOptions: true,
	supportsPlaceholder: true,
	defaultWidth: 'third',
	defaultValue: () => null,
	isEmpty: isBlank,
	validate: (v) => (v == null || typeof v === 'string' ? null : 'Expected one option'),
	coerce: (v, field) => {
		if (v == null || v === '') return ok(null);
		const s = Array.isArray(v) ? asString(v[0]) : asString(v);
		if (s === null) return fail;
		const opts = selectOptions(field);
		const match = opts.find((o) => o.id === s || o.label.toLowerCase() === s.toLowerCase());
		return ok(match ? match.id : s);
	},
	toText: (v, field) => optionLabel(field, v),
	compare: (a, b, field) => {
		const opts = selectOptions(field);
		const ia = opts.findIndex((o) => o.id === a);
		const ib = opts.findIndex((o) => o.id === b);
		return (ia === -1 ? 1e9 : ia) - (ib === -1 ? 1e9 : ib);
	},
};

export const multiSelectLogic: FieldTypeLogic = {
	id: 'multiselect',
	label: 'Multi-select',
	icon: 'list-checks',
	category: 'choice',
	hasOptions: true,
	supportsPlaceholder: true,
	defaultWidth: 'half',
	defaultValue: () => [],
	isEmpty: isBlank,
	validate: (v) => (v == null || (Array.isArray(v) && v.every((x) => typeof x === 'string')) ? null : 'Expected a list of options'),
	coerce: (v, field) => {
		const arr = asStringArray(v);
		if (arr === null) return v == null ? ok([]) : fail;
		const opts = selectOptions(field);
		return ok(arr.map((s) => opts.find((o) => o.id === s || o.label.toLowerCase() === s.toLowerCase())?.id ?? s));
	},
	toText: (v, field) => (Array.isArray(v) ? v.map((x) => optionLabel(field, x)).join(', ') : ''),
	compare: textCompare,
};

/** Free-form list of strings (traits, likes, fears…). Shown as chips. */
export const listLogic: FieldTypeLogic = {
	id: 'list',
	label: 'List',
	icon: 'list',
	category: 'text',
	supportsPlaceholder: true,
	defaultWidth: 'half',
	defaultValue: () => [],
	isEmpty: isBlank,
	validate: (v) => (v == null || (Array.isArray(v) && v.every((x) => typeof x === 'string')) ? null : 'Expected a list'),
	coerce: (v) => {
		const arr = asStringArray(v);
		return arr === null ? (v == null ? ok([]) : fail) : ok(arr);
	},
	toText: (v) => (Array.isArray(v) ? v.join(', ') : ''),
	compare: textCompare,
};

export const tagsLogic: FieldTypeLogic = { ...listLogic, id: 'tags', label: 'Tags', icon: 'tags' };

// ── fictional date ─────────────────────────────────────────────────────────────

export const chronoLogic: FieldTypeLogic = {
	id: 'chrono',
	label: 'Fictional date',
	icon: 'hourglass',
	category: 'date',
	defaultWidth: 'third',
	defaultValue: () => null,
	isEmpty: (v) => v == null || (isChronoDate(v) ? false : true),
	validate: (v) => (v == null || isChronoDate(v) ? null : 'Expected a date'),
	coerce: (v) => {
		if (v == null || v === '') return ok(null);
		if (isChronoDate(v)) return ok(v);
		const n = asNumber(v);
		if (n !== null) return ok({ year: Math.trunc(n), precision: 'year' } satisfies ChronoDate);
		if (typeof v === 'string') {
			const parsed = parseChronoText(v);
			if (parsed) return ok(parsed);
			const m = v.match(/-?\d+/);
			return ok({ year: m ? Number(m[0]) : 0, precision: 'year', label: v } satisfies ChronoDate);
		}
		return fail;
	},
	toText: (v) => (isChronoDate(v) ? formatChronoDate(v, { tagCalendar: true }) : ''),
	compare: (a, b) =>
		(isChronoDate(a) ? chronoOrdinal(a) : -Infinity) - (isChronoDate(b) ? chronoOrdinal(b) : -Infinity),
};

// ── media ──────────────────────────────────────────────────────────────────────

const isImageRef = (v: unknown): v is { path: string } =>
	typeof v === 'object' && v !== null && typeof (v as { path?: unknown }).path === 'string';

export const imageLogic: FieldTypeLogic = {
	id: 'image',
	label: 'Image',
	icon: 'image',
	category: 'media',
	defaultWidth: 'third',
	searchable: false,
	media: { shape: 'ref', images: true },
	defaultValue: () => null,
	isEmpty: (v) => !isImageRef(v),
	validate: (v) => (v == null || isImageRef(v) ? null : 'Expected an image'),
	coerce: (v) => (v == null ? ok(null) : isImageRef(v) ? ok(v) : typeof v === 'string' ? ok({ path: v }) : fail),
	toText: (v) => (isImageRef(v) ? v.path.split('/').pop() ?? '' : ''),
};

export const fileLogic: FieldTypeLogic = { ...imageLogic, id: 'file', label: 'Vault file', icon: 'paperclip', defaultWidth: 'half', media: { shape: 'ref', images: false } };

export const galleryLogic: FieldTypeLogic = {
	id: 'gallery',
	label: 'Gallery',
	icon: 'images',
	category: 'media',
	defaultWidth: 'full',
	searchable: false,
	media: { shape: 'refs', images: true },
	defaultValue: () => [],
	isEmpty: (v) => !Array.isArray(v) || v.length === 0,
	validate: (v) => (v == null || (Array.isArray(v) && v.every(isImageRef)) ? null : 'Expected images'),
	coerce: (v) => {
		if (v == null) return ok([]);
		if (Array.isArray(v)) return ok(v.filter(isImageRef));
		return isImageRef(v) ? ok([v]) : fail;
	},
	toText: (v) => (Array.isArray(v) ? `${v.length} image${v.length === 1 ? '' : 's'}` : ''),
};

// ── relations & computed ─────────────────────────────────────────────────────
//
// Their values are never stored on the entity. FieldValues (services/) derives them:
// relation-family kinds yield LinkedEntry[] ({ id, name, edgeId }); rollups yield a
// number, a list of strings or a ChronoDate.

interface Linked {
	id: string;
	name: string;
}
const asLinked = (v: unknown): Linked[] =>
	Array.isArray(v) ? v.filter((x): x is Linked => typeof x === 'object' && x !== null && typeof (x as Linked).name === 'string') : [];

const relationBase = {
	category: 'relation' as const,
	defaultWidth: 'half' as const,
	computed: true,
	searchable: false,
	defaultValue: () => [],
	isEmpty: (v: unknown) => asLinked(v).length === 0,
	validate: () => null,
	// Stored values can't become connections automatically; a kind change keeps them as
	// unused data instead.
	coerce: (): CoerceResult => ({ ok: false }),
	toText: (v: unknown) =>
		asLinked(v)
			.map((l) => l.name)
			.join(', '),
	compare: (a: unknown, b: unknown) => (asLinked(a)[0]?.name ?? '\uffff').localeCompare(asLinked(b)[0]?.name ?? '\uffff'),
};

export const relationLogic: FieldTypeLogic = {
	...relationBase,
	id: 'relation',
	label: 'Relation',
	icon: 'link-2',
	description: 'Links to other entries. Shows up on both of them.',
};
export const parentLogic: FieldTypeLogic = {
	...relationBase,
	id: 'parent',
	label: 'Parent entry',
	icon: 'corner-left-up',
	description: 'The entry this one is nested inside.',
};
export const childrenLogic: FieldTypeLogic = {
	...relationBase,
	id: 'children',
	label: 'Nested entries',
	icon: 'git-fork',
	defaultWidth: 'full',
	description: 'Entries nested inside this one.',
};

const rollupText = (v: unknown): string => {
	if (v == null) return '';
	if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, '');
	if (Array.isArray(v)) return v.map(String).join(', ');
	if (isChronoDate(v)) return formatChronoDate(v);
	return typeof v === 'string' ? v : '';
};

export const rollupLogic: FieldTypeLogic = {
	id: 'rollup',
	label: 'Rollup',
	icon: 'sigma',
	category: 'computed',
	description: 'Counts or summarises a field of linked entries.',
	defaultWidth: 'half',
	computed: true,
	searchable: false,
	defaultValue: () => null,
	isEmpty: (v) => v == null || (Array.isArray(v) && v.length === 0),
	validate: () => null,
	coerce: () => ({ ok: false }),
	toText: rollupText,
	compare: (a, b) => {
		if (typeof a === 'number' && typeof b === 'number') return a - b;
		if (isChronoDate(a) && isChronoDate(b)) return chronoOrdinal(a) - chronoOrdinal(b);
		return rollupText(a).localeCompare(rollupText(b));
	},
};

export const formulaLogic: FieldTypeLogic = {
	id: 'formula',
	label: 'Formula',
	icon: 'function-square',
	category: 'computed',
	studioNote: 'Formulas are planned for a later update. The field is kept until then.',
	defaultWidth: 'half',
	computed: true,
	searchable: false,
	defaultValue: () => null,
	isEmpty: () => true,
	validate: () => null,
	coerce: () => ({ ok: false }),
	toText: () => '',
};

export const ALL_FIELD_LOGIC: FieldTypeLogic[] = [
	textLogic,
	longTextLogic,
	richTextLogic,
	numberLogic,
	percentLogic,
	booleanLogic,
	dateLogic,
	chronoLogic,
	timeLogic,
	selectLogic,
	multiSelectLogic,
	listLogic,
	tagsLogic,
	ratingLogic,
	progressLogic,
	urlLogic,
	fileLogic,
	imageLogic,
	galleryLogic,
	colorLogic,
	iconLogic,
	relationLogic,
	parentLogic,
	childrenLogic,
	rollupLogic,
	formulaLogic,
];
