import type { EntityRecord, EntitySchema, FieldDefinition, World } from '../../core/types';
import { formatChronoDate, isChronoDate } from '../../core/types/chrono';
import type { FieldTypeRegistry } from '../../fields/FieldTypeRegistry';
import { selectOptions } from '../../fields/types/logic';

/**
 * Where each field lives once an entry has a native note (0.17), and how a value maps to
 * an Obsidian property and back. Pure: no Obsidian, no DOM.
 */

/** Kinds whose home is a property. */
export type PropKind = 'text' | 'number' | 'boolean' | 'select' | 'multiselect' | 'list' | 'date' | 'chrono';

const PROP_KINDS: Record<string, PropKind> = {
	text: 'text',
	url: 'text',
	color: 'text',
	icon: 'text',
	time: 'text',
	date: 'date',
	number: 'number',
	percent: 'number',
	rating: 'number',
	progress: 'number',
	boolean: 'boolean',
	select: 'select',
	multiselect: 'multiselect',
	list: 'list',
	tags: 'list',
	chrono: 'chrono',
};

/** Kinds whose home is a section of the note's body. */
const REGION_KINDS = new Set(['longtext', 'richtext']);

export type FieldHome = 'property' | 'section' | 'worldsmith';

export function fieldHome(field: FieldDefinition): FieldHome {
	if (PROP_KINDS[field.type]) return 'property';
	if (REGION_KINDS.has(field.type)) return 'section';
	return 'worldsmith';
}

export function propKind(field: FieldDefinition): PropKind | null {
	return PROP_KINDS[field.type] ?? null;
}

/** Keys Worldsmith writes itself; fields never use them. */
export const IDENTITY_KEYS = ['worldsmith-id', 'worldsmith-world', 'worldsmith-type', 'worldsmith-template', 'cssclasses'] as const;
export const CORE_KEYS = { aliases: 'aliases', tags: 'tags', status: 'Status' } as const;
const RESERVED = new Set<string>([...IDENTITY_KEYS, 'worldsmith', 'aliases', 'tags', 'status', 'tag', 'alias', 'cssclass', 'publish', 'permalink', 'position'].map((k) => k.toLowerCase()));

/**
 * The property key of each short field of a type: its `noteKey`, else its label. Keys are
 * unique per type (case-insensitively, as Obsidian treats them) and never one of the
 * reserved keys; a clash gets a number ("Age 2").
 */
export function noteKeys(schema: EntitySchema): Map<string, string> {
	const out = new Map<string, string>();
	const used = new Set<string>(RESERVED);
	for (const f of schema.fields) {
		if (fieldHome(f) !== 'property') continue;
		const base = (f.noteKey?.trim() || f.label.trim() || f.id).replace(/:\s*$/, '').replace(/[\r\n]+/g, ' ');
		let key = base;
		for (let n = 2; used.has(key.toLowerCase()); n++) key = `${base} ${n}`;
		used.add(key.toLowerCase());
		out.set(f.id, key);
	}
	return out;
}

function str(v: unknown): string | null {
	if (v === null || v === undefined) return null;
	if (typeof v === 'string') return v;
	if (typeof v === 'number' || typeof v === 'boolean') return String(v);
	if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
	return null;
}

/** A property value as Worldsmith writes it (null = an empty property). */
export function toProperty(field: FieldDefinition, value: unknown, fieldTypes: FieldTypeRegistry): unknown {
	const kind = propKind(field);
	if (!kind || value === null || value === undefined || value === '') return null;
	switch (kind) {
		case 'number': {
			const n = typeof value === 'number' ? value : Number(value);
			return Number.isFinite(n) ? n : null;
		}
		case 'boolean':
			return value === true ? true : value === false ? false : null;
		case 'select': {
			const id: unknown = Array.isArray(value) ? (value as unknown[])[0] : value;
			const opt = selectOptions(field).find((o) => o.id === id);
			return opt ? opt.label : (str(id) ?? null);
		}
		case 'multiselect': {
			if (!Array.isArray(value)) return [];
			const opts = selectOptions(field);
			return value.map((x) => opts.find((o) => o.id === x)?.label ?? str(x) ?? '').filter(Boolean);
		}
		case 'list':
			return Array.isArray(value) ? value.map((x) => str(x) ?? '').filter(Boolean) : [];
		case 'chrono':
			return isChronoDate(value) ? formatChronoDate(value, { tagCalendar: true }) : (str(value) ?? null);
		case 'date':
		case 'text':
			return str(value) ?? (fieldTypes.toText(field, value) || null);
	}
}

/** What a property's raw value means for this kind, normalised (so comparisons are fair). */
export function normalizeProperty(field: FieldDefinition, raw: unknown): unknown {
	const kind = propKind(field);
	if (raw === undefined || raw === null || raw === '') return kind === 'list' || kind === 'multiselect' ? [] : null;
	switch (kind) {
		case 'number': {
			if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
			const s = str(raw);
			const n = s === null ? NaN : Number(s.replace(/[%,\s]/g, ''));
			return Number.isFinite(n) && s!.trim() !== '' ? n : (s ?? null);
		}
		case 'boolean':
			if (typeof raw === 'boolean') return raw;
			return str(raw);
		case 'list':
		case 'multiselect': {
			const arr = Array.isArray(raw) ? raw : String(raw).split(',');
			return arr.map((x) => (str(x) ?? '').trim().replace(kind === 'list' && field.type === 'tags' ? /^#/ : /^$/, '')).filter(Boolean);
		}
		default:
			if (Array.isArray(raw)) return raw.map((x) => str(x) ?? '').filter(Boolean).join(', ');
			return str(raw);
	}
}

/** The canonical text of a property value, used to tell whether two sides agree. */
export function canon(value: unknown): string {
	if (value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)) return '';
	return JSON.stringify(value);
}

/**
 * The value to store for a property read from the note, through the field type (choices by
 * label, fictional dates through the calendar parser). `undefined` = the field is empty.
 * `ok: false` = it can't be stored (letters in a number field): nothing is changed.
 */
export function fromProperty(field: FieldDefinition, raw: unknown, fieldTypes: FieldTypeRegistry): { ok: true; value: unknown } | { ok: false; text: string } {
	const norm = normalizeProperty(field, raw);
	if (norm === null || norm === '' || (Array.isArray(norm) && !norm.length)) return { ok: true, value: undefined };
	const kind = propKind(field);
	if (kind === 'number' && typeof norm !== 'number') return { ok: false, text: String(norm) };
	if (kind === 'boolean' && typeof norm !== 'boolean') {
		if (/^(true|yes|1|y|on)$/i.test(String(norm))) return { ok: true, value: true };
		if (/^(false|no|0|n|off)$/i.test(String(norm))) return { ok: true, value: false };
		return { ok: false, text: String(norm) };
	}
	const type = fieldTypes.for(field);
	const c = type.coerce(norm, field);
	if (!c.ok) return { ok: false, text: Array.isArray(norm) ? norm.join(', ') : String(norm) };
	if (type.isEmpty(c.value)) return { ok: true, value: undefined };
	return { ok: true, value: c.value };
}

// ── core properties: aliases, tags, status ─────────────────────────────────────

export function statusLabel(world: World, id: string): string {
	return world.statuses.find((s) => s.id === id)?.label ?? id;
}

export function statusFromLabel(world: World, raw: unknown): string | null {
	const s = str(Array.isArray(raw) ? raw[0] : raw)?.trim();
	if (!s) return null;
	const hit = world.statuses.find((x) => x.id === s || x.label.toLowerCase() === s.toLowerCase());
	return hit ? hit.id : null;
}

export function listProp(raw: unknown, stripHash = false): string[] {
	if (raw === null || raw === undefined || raw === '') return [];
	const arr = Array.isArray(raw) ? raw : String(raw).split(',');
	return arr.map((x) => (str(x) ?? '').trim()).map((x) => (stripHash ? x.replace(/^#/, '') : x)).filter(Boolean);
}

/** Obsidian tags can't hold spaces; Worldsmith tags can. Spaces become dashes in the note. */
export function tagToNote(tag: string): string {
	return tag.trim().replace(/^#/, '').replace(/\s+/g, '-');
}

/** Fields shown in the note but kept by Worldsmith (connections, media, computed). */
export function worldsmithOnly(schema: EntitySchema): FieldDefinition[] {
	return schema.fields.filter((f) => fieldHome(f) === 'worldsmith');
}

export function shortFields(schema: EntitySchema): FieldDefinition[] {
	return schema.fields.filter((f) => fieldHome(f) === 'property');
}

export function longFields(schema: EntitySchema): FieldDefinition[] {
	return schema.fields.filter((f) => fieldHome(f) === 'section');
}

/** Read-only handle on an entity for the mappers. */
export type EntityLike = Pick<EntityRecord, 'id' | 'values' | 'aliases' | 'tags' | 'status' | 'description' | 'name'>;
