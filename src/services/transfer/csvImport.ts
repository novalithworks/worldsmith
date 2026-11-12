import type { EntityRecord, EntitySchema, FieldDefinition, RelationEdge } from '../../core/types';
import type { FieldTypeRegistry } from '../../fields/FieldTypeRegistry';
import { selectOptions } from '../../fields/types/logic';
import { relationConfig } from '../RelationService';
import type { WorldSession } from '../WorldSession';
import { cellText, sameCell, unguardFormula } from './cells';
import type { CsvTable } from './csv';

/**
 * Spreadsheet import (Milestone 9): rows of a CSV become entries of one type. Columns are
 * matched to fields by name; values are converted by each field's own kind (so "Yes", "42",
 * "Antagonist" or "Kael; Seris" land as a checkbox, a number, a choice or links). Planning
 * is pure — nothing is written until `runCsvImport`, which returns an undo.
 *
 * Imports never remove anything: blank cells don't clear values, existing entries are only
 * updated when asked, and undo moves new entries to the trash (they can be restored).
 */

/** Built-in targets a column can map to besides fields. */
export const BUILTIN_TARGETS = [
	{ id: '__name', label: 'Name' },
	{ id: '__aliases', label: 'Also known as' },
	{ id: '__tags', label: 'Tags' },
	{ id: '__status', label: 'Status' },
	{ id: '__description', label: 'Summary (description)' },
] as const;

export type ExistingMode = 'skip' | 'update' | 'add';

export interface CsvImportOptions {
	/** Rows whose name matches an existing entry of the type. */
	existing: ExistingMode;
	/** Unknown choice labels become new options of the field (else they're reported). */
	addChoices: boolean;
	/** Linked names that match nothing become new entries of the field's first type. */
	createLinked: boolean;
}

export const DEFAULT_IMPORT_OPTIONS: CsvImportOptions = { existing: 'skip', addChoices: true, createLinked: false };

/** Column index → target id ('__name', a field id…) or null to ignore it. */
export type CsvMapping = Array<string | null>;

export interface PlannedLink {
	field: FieldDefinition;
	/** Names in the cell, in order. */
	names: string[];
	/** Entry ids found for them (null = not found). */
	ids: Array<string | null>;
	/** Names that are new entries made by this same import (linked once they exist). */
	pending: boolean[];
}

export interface PlannedRow {
	index: number;
	name: string;
	action: 'create' | 'update' | 'skip';
	existingId: string | null;
	values: Record<string, unknown>;
	links: PlannedLink[];
	aliases: string[] | null;
	tags: string[] | null;
	status: string | null;
	description: string | null;
	problems: string[];
}

export interface CsvImportPlan {
	typeId: string;
	rows: PlannedRow[];
	/** New choice labels per field id (added when the import runs, if allowed). */
	newChoices: Record<string, string[]>;
	/** Linked names that match nothing, per field id. */
	missingLinks: Record<string, string[]>;
	counts: { create: number; update: number; skip: number; problems: number };
}

export interface CsvImportResult {
	created: string[];
	updated: string[];
	linked: number;
	createdLinked: string[];
	addedChoices: number;
	undo(): void;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_\-–—:.()]+/g, ' ').trim();
/** "A; B" or "A, B" or one per line. Semicolons win when present (names may contain commas). */
export function splitList(cell: string): string[] {
	const t = cell.trim();
	if (!t) return [];
	const sep = /[;\n]/.test(t) ? /[;\n]+/ : /,/;
	return t
		.split(sep)
		.map((x) => x.trim())
		.filter(Boolean);
}

/** Fields a column can fill: stored kinds (not computed ones like rollups). */
export function importableFields(schema: EntitySchema, fieldTypes: FieldTypeRegistry): FieldDefinition[] {
	return schema.fields.filter((f) => {
		if (f.type === 'relation' || f.type === 'parent') return true; // names → links
		const t = fieldTypes.for(f);
		return !t.computed && f.type !== 'gallery' && f.type !== 'file';
	});
}

/** Best guess for each column: same name as a field (or its id), or a built-in. */
export function autoMapping(schema: EntitySchema, fieldTypes: FieldTypeRegistry, headers: string[]): CsvMapping {
	const fields = importableFields(schema, fieldTypes);
	const used = new Set<string>();
	const synonyms: Record<string, string> = {
		name: '__name',
		title: '__name',
		[norm(schema.singular)]: '__name',
		aliases: '__aliases',
		alias: '__aliases',
		'also known as': '__aliases',
		aka: '__aliases',
		nicknames: '__aliases',
		tags: '__tags',
		tag: '__tags',
		status: '__status',
		description: '__description',
		summary: '__description',
		'summary description': '__description',
	};
	const exactBuiltin = new Map<string, string>(BUILTIN_TARGETS.map((b) => [b.label, b.id]));
	// A header naming a field's label wins over one that happens to equal another field's id
	// (“Family” is the Family links, not the field with id “family”).
	const byLabel = new Set(headers.map((h) => fields.find((f) => norm(f.label) === norm(h))?.id).filter(Boolean));
	return headers.map((h) => {
		const n = norm(h);
		// The exporter's own headers mean the built-ins, even if a field has the same label
		// (that field's column is exported as “Label (id)” instead).
		const builtin = exactBuiltin.get(h.trim());
		// “Label (id)”: the exporter's name for a field whose label is ambiguous.
		const byId = /\(([A-Za-z0-9_-]+)\)\s*$/.exec(h)?.[1];
		const field = builtin
			? undefined
			: (fields.find((f) => byId !== undefined && f.id === byId) ??
				fields.find((f) => norm(f.label) === n) ??
				fields.find((f) => norm(f.id) === n && !byLabel.has(f.id) && !fields.some((g) => g !== f && norm(g.label) === n)));
		let target: string | null = builtin ?? field?.id ?? null;
		if (!target && synonyms[n]) target = synonyms[n]!;
		// A type with its own "Nicknames" field keeps it as a field (found above).
		if (target && used.has(target)) target = null;
		if (target) used.add(target);
		return target;
	});
}

/** Entries of these types by lower-cased name and alias. */
function nameIndex(s: WorldSession, typeIds: string[] | null): Map<string, EntityRecord[]> {
	const out = new Map<string, EntityRecord[]>();
	for (const e of s.entities.all()) {
		if (e.trashedAt) continue;
		if (typeIds && typeIds.length && !typeIds.includes(e.typeId)) continue;
		for (const n of [e.name, ...e.aliases]) {
			const k = n.trim().toLowerCase();
			if (!k) continue;
			const l = out.get(k) ?? [];
			if (!l.includes(e)) l.push(e);
			out.set(k, l);
		}
	}
	return out;
}

export function planCsvImport(s: WorldSession, fieldTypes: FieldTypeRegistry, schema: EntitySchema, table: CsvTable, mapping: CsvMapping, options: CsvImportOptions = DEFAULT_IMPORT_OPTIONS): CsvImportPlan {
	const fields = new Map(importableFields(schema, fieldTypes).map((f) => [f.id, f]));
	const nameCol = mapping.indexOf('__name');
	const existingByName = nameIndex(s, [schema.id]);
	const linkIndexes = new Map<string, Map<string, EntityRecord[]>>();
	const newChoices: Record<string, Set<string>> = {};
	const missingLinks: Record<string, Set<string>> = {};
	const seenNames = new Map<string, number>();
	const rows: PlannedRow[] = [];

	// First, what each row is: new, an update, or skipped.
	for (const [index, cells] of table.rows.entries()) {
		const name = nameCol >= 0 ? unguardFormula((cells[nameCol] ?? '').trim()) : '';
		const problems: string[] = [];
		const row: PlannedRow = { index, name, action: 'create', existingId: null, values: {}, links: [], aliases: null, tags: null, status: null, description: null, problems };
		rows.push(row);
		if (!name) {
			row.action = 'skip';
			problems.push('No name');
			continue;
		}
		const key = name.toLowerCase();
		const dup = seenNames.get(key);
		seenNames.set(key, index);
		const existing = existingByName.get(key)?.find((e) => e.name.trim().toLowerCase() === key) ?? null;
		if (existing) {
			row.existingId = existing.id;
			row.action = options.existing === 'update' ? 'update' : options.existing === 'add' ? 'create' : 'skip';
		}
		if (dup !== undefined && row.action !== 'skip') problems.push(`Same name as row ${dup + 2}`);
	}
	// Names this import creates, for links between rows of the same sheet.
	const createdHere = new Set(rows.filter((r) => r.action === 'create').map((r) => r.name.toLowerCase()));

	for (const row of rows) {
		if (row.action === 'skip') continue;
		const cells = table.rows[row.index]!;
		const problems = row.problems;
		const current = row.action === 'update' && row.existingId ? s.entities.get(row.existingId) : undefined;
		mapping.forEach((target, col) => {
			if (!target || target === '__name') return;
			const raw = unguardFormula((cells[col] ?? '').trim());
			if (!raw) return; // blank cells never clear anything
			switch (target) {
				case '__aliases':
					row.aliases = splitList(raw);
					return;
				case '__tags':
					row.tags = splitList(raw).map((t) => t.replace(/^#/, ''));
					return;
				case '__description':
					if (current && sameCell(current.description, raw)) return;
					row.description = raw;
					return;
				case '__status': {
					const st = s.world.statuses.find((x) => x.id === raw || x.label.toLowerCase() === raw.toLowerCase());
					if (st) row.status = st.id;
					else problems.push(`Status “${raw}” isn’t one of the world’s statuses`);
					return;
				}
			}
			const f = fields.get(target);
			if (!f) return;
			// Updating: a cell that still says what the entry already has changes nothing (so
			// dates, images and links exported earlier come back exactly as they were).
			if (current && sameCell(cellText(s, current, f), raw)) return;
			if (f.type === 'relation' || f.type === 'parent') {
				const cfg = f.type === 'relation' ? relationConfig(f) : { targetTypes: [schema.id], max: 1 };
				const ix = linkIndexes.get(f.id) ?? nameIndex(s, cfg.targetTypes.length ? cfg.targetTypes : null);
				linkIndexes.set(f.id, ix);
				const linksHere = !cfg.targetTypes.length || cfg.targetTypes.includes(schema.id);
				const known = (n: string) => !!ix.get(n.toLowerCase())?.length || (linksHere && createdHere.has(n.toLowerCase()));
				// One name with a comma in it (“Seris, the Wise”) before a list of names.
				let names = known(raw.replace(/;\s*$/, '')) ? [raw.replace(/;\s*$/, '')] : splitList(raw);
				if (cfg.max === 1 && names.length > 1) {
					problems.push(`${f.label} holds one entry; using “${names[0]}”`);
					names = names.slice(0, 1);
				}
				const pending = names.map((n) => !ix.get(n.toLowerCase())?.length && linksHere && createdHere.has(n.toLowerCase()));
				const ids = names.map((n, i) => {
					const hit = ix.get(n.toLowerCase());
					if (hit?.length) return hit[0]!.id;
					if (!pending[i]) (missingLinks[f.id] ??= new Set()).add(n);
					return null;
				});
				const missing = names.filter((_, i) => !ids[i] && !pending[i]);
				if (missing.length && !options.createLinked) problems.push(`${f.label}: no entry called ${missing.map((m) => `“${m}”`).join(', ')}`);
				row.links.push({ field: f, names, ids, pending });
				return;
			}
			const type = fieldTypes.for(f);
			let input: unknown = raw;
			if (f.type === 'list' || f.type === 'tags' || f.type === 'multiselect') input = splitList(raw);
			const res = type.coerce(input, f);
			if (!res.ok) {
				problems.push(`${f.label}: “${raw}” isn’t a valid ${type.label.toLowerCase()}`);
				return;
			}
			// Choices: labels that aren't options yet.
			if (f.type === 'select' || f.type === 'multiselect') {
				const known = new Set(selectOptions(f).map((o) => o.id));
				const vals = (Array.isArray(res.value) ? res.value : [res.value]).filter((v): v is string => typeof v === 'string');
				const unknown = vals.filter((v) => !known.has(v));
				if (unknown.length) {
					for (const u of unknown) (newChoices[f.id] ??= new Set()).add(u);
					if (!options.addChoices) {
						problems.push(`${f.label}: ${unknown.map((u) => `“${u}”`).join(', ')} ${unknown.length === 1 ? 'isn’t a choice' : 'aren’t choices'}`);
						const keep = vals.filter((v) => known.has(v));
						if (!keep.length) return;
						row.values[f.id] = f.type === 'select' ? keep[0] : keep;
						return;
					}
				}
			}
			const warn = type.validate(res.value, f);
			if (warn) problems.push(`${f.label}: ${warn}`);
			row.values[f.id] = res.value;
		});
	}

	const counts = { create: 0, update: 0, skip: 0, problems: 0 };
	for (const r of rows) {
		counts[r.action]++;
		if (r.problems.length && r.action !== 'skip') counts.problems++;
	}
	const toObj = (m: Record<string, Set<string>>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, [...v]]));
	return { typeId: schema.id, rows, newChoices: toObj(newChoices), missingLinks: toObj(missingLinks), counts };
}

/**
 * Write a plan. Choices are added first (so values keep their option ids), then entries are
 * created or updated, then links. Returns what happened and an undo that puts everything back
 * (new entries go to the trash; updated entries get their old values; new links are removed).
 */
export function runCsvImport(s: WorldSession, plan: CsvImportPlan, options: CsvImportOptions = DEFAULT_IMPORT_OPTIONS): CsvImportResult {
	const schemaBefore = s.schemas.get(plan.typeId);
	if (!schemaBefore) throw new Error('That type no longer exists.');
	let addedChoices = 0;
	// Add new choices, and remember the option id each label became (and which were added).
	const choiceIds: Record<string, Map<string, string>> = {};
	const addedOptions: Array<{ fieldId: string; optionId: string }> = [];
	if (options.addChoices) {
		for (const [fieldId, labels] of Object.entries(plan.newChoices)) {
			const m = new Map<string, string>();
			for (const label of labels) {
				const opt = s.schemaEdits.newOption(plan.typeId, fieldId, label);
				const cur = selectOptions(s.schemas.get(plan.typeId)!.fields.find((f) => f.id === fieldId)!);
				s.schemaEdits.setOptions(plan.typeId, fieldId, [...cur, opt]);
				m.set(label, opt.id);
				addedOptions.push({ fieldId, optionId: opt.id });
				addedChoices++;
			}
			choiceIds[fieldId] = m;
		}
	}
	const remap = (fieldId: string, v: unknown): unknown => {
		const m = choiceIds[fieldId];
		if (!m) return v;
		if (Array.isArray(v)) return (v as unknown[]).map((x) => (typeof x === 'string' ? (m.get(x) ?? x) : x));
		return typeof v === 'string' ? (m.get(v) ?? v) : v;
	};

	const created: string[] = [];
	const updated: string[] = [];
	const before = new Map<string, { values: Record<string, unknown>; aliases: string[]; tags: string[]; status: string; description: string; parentId: string | null }>();
	const newEdges: RelationEdge[] = [];
	const replacedEdges: RelationEdge[] = [];
	const createdLinked: string[] = [];
	const linkedByName = new Map<string, string>();
	/** Entries this import made, by lower-cased name (first one wins). */
	const madeByName = new Map<string, string>();
	const rowEntity = new Map<PlannedRow, string>();

	// 1. Entries and their values.
	for (const row of plan.rows) {
		if (row.action === 'skip') continue;
		let e: EntityRecord | null | undefined;
		if (row.action === 'update' && row.existingId) {
			e = s.entities.get(row.existingId);
			if (!e) continue;
			// The state before the import — kept from the first row that touches the entry.
			if (!before.has(e.id)) {
				before.set(e.id, { values: JSON.parse(JSON.stringify(e.values)) as Record<string, unknown>, aliases: [...e.aliases], tags: [...e.tags], status: e.status, description: e.description, parentId: e.parentId });
				updated.push(e.id);
			}
		} else {
			e = s.entityService.create(plan.typeId, { name: row.name });
			created.push(e.id);
			if (!madeByName.has(row.name.toLowerCase())) madeByName.set(row.name.toLowerCase(), e.id);
		}
		rowEntity.set(row, e.id);
		for (const [fieldId, v] of Object.entries(row.values)) s.entityService.setFieldValue(e.id, fieldId, remap(fieldId, v));
		const cur = s.entities.get(e.id) ?? e;
		const patch: Parameters<typeof s.entityService.update>[1] = {};
		if (row.aliases) patch.aliases = [...new Set([...(row.action === 'update' ? cur.aliases : []), ...row.aliases])];
		if (row.tags) patch.tags = [...new Set([...(row.action === 'update' ? cur.tags : []), ...row.tags])];
		if (row.status) patch.status = row.status;
		if (row.description) patch.description = row.description;
		if (Object.keys(patch).length) s.entityService.update(e.id, patch);
	}

	// 2. Links, once every row's entry exists (rows may link to each other).
	for (const row of plan.rows) {
		const id = rowEntity.get(row);
		if (!id) continue;
		for (const link of row.links) {
			link.names.forEach((n, i) => {
				let target = link.ids[i] ?? (link.pending[i] ? (madeByName.get(n.toLowerCase()) ?? null) : null);
				if (!target && options.createLinked && !link.pending[i]) {
					const key = `${link.field.id}:${n.toLowerCase()}`;
					target = linkedByName.get(key) ?? null;
					const cfg = link.field.type === 'relation' ? relationConfig(link.field) : null;
					const typeId = cfg?.targetTypes[0] ?? (link.field.type === 'parent' ? plan.typeId : null);
					if (!target && typeId && s.schemas.get(typeId)) {
						const made = s.entityService.create(typeId, { name: n });
						createdLinked.push(made.id);
						linkedByName.set(key, made.id);
						target = made.id;
					}
				}
				if (!target || target === id) return;
				if (link.field.type === 'parent') {
					const e = s.entities.get(id);
					if (e && e.parentId !== target) s.entityService.update(id, { parentId: target });
					return;
				}
				const r = s.relations.link(id, link.field, target);
				if (r.edge) newEdges.push(r.edge);
				replacedEdges.push(...r.replaced);
			});
		}
	}

	return {
		created,
		updated,
		linked: newEdges.length,
		createdLinked,
		addedChoices,
		undo: () => {
			for (const edge of newEdges) s.relations.unlink(edge.id);
			if (replacedEdges.length) s.relations.restore(replacedEdges);
			for (const id of [...created, ...createdLinked]) s.entityService.trash(id);
			for (const [id, b] of before) {
				const cur = s.entities.get(id);
				if (!cur) continue;
				const values: Record<string, unknown> = {};
				for (const k of Object.keys(cur.values)) if (!(k in b.values)) values[k] = undefined;
				Object.assign(values, b.values);
				s.entityService.update(id, { values, aliases: b.aliases, tags: b.tags, status: b.status, description: b.description, parentId: b.parentId });
			}
			// Choices the import added go again — unless something else uses them by now.
			const madeHere = new Set([...created, ...createdLinked]);
			for (const { fieldId, optionId } of addedOptions) {
				const schema = s.schemas.get(plan.typeId);
				const field = schema?.fields.find((f) => f.id === fieldId);
				if (!field) continue;
				const used = s.entities.all().some((e) => {
					if (e.typeId !== plan.typeId || madeHere.has(e.id)) return false;
					const v = e.values[fieldId];
					return v === optionId || (Array.isArray(v) && v.includes(optionId));
				});
				if (used) continue;
				const opts = selectOptions(field);
				if (opts.some((o) => o.id === optionId)) s.schemaEdits.setOptions(plan.typeId, fieldId, opts.filter((o) => o.id !== optionId));
			}
		},
	};
}
