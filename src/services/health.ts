import { chronoPosition } from '../core/calendar/engine';
import { orphansOf, type EntityRecord, type EntitySchema, type FieldDefinition } from '../core/types';
import { isChronoDate } from '../core/types/chrono';
import type { FieldTypeRegistry } from '../fields/FieldTypeRegistry';
import { itemLabel, mapProblems } from './maps';
import { spanFields } from './timeline';
import type { WorldSession } from './WorldSession';

/**
 * World health (0.10): things in a world that look unfinished or broken. Every check
 * returns findings; the page offers a fix for each that never deletes anything (and can be
 * undone) or a way there. Findings can be ignored; their ids are kept in
 * `world.health.ignored`.
 */

export type HealthCheckId = 'missing-fields' | 'broken-images' | 'missing-notes' | 'broken-links' | 'map-links' | 'empty-types' | 'orphans' | 'dates' | 'duplicates' | 'unused-data' | 'unused-images';

export interface HealthCheck {
	id: HealthCheckId;
	label: string;
	icon: string;
	/** What it looks for, in a sentence. */
	hint: string;
	/** How much it weighs on the score (0 = informational). */
	weight: number;
}

export const HEALTH_CHECKS: HealthCheck[] = [
	{ id: 'broken-images', label: 'Missing images', icon: 'image-off', hint: 'Pictures that were moved or deleted outside Worldsmith.', weight: 14 },
	{ id: 'missing-notes', label: 'Missing notes', icon: 'file-x', hint: 'Linked notes whose file is gone.', weight: 10 },
	{ id: 'broken-links', label: 'Broken connections', icon: 'unlink', hint: 'Connections to entries that are in the trash or no longer exist.', weight: 10 },
	{ id: 'map-links', label: 'Map pins to missing entries', icon: 'map-pin-off', hint: 'Pins, areas and routes whose entry is in the trash or gone, and pins that open a deleted map.', weight: 6 },
	{ id: 'dates', label: 'Dates that disagree', icon: 'calendar-x', hint: 'Ends before starts: a death before a birth, an era that ends before it begins.', weight: 14 },
	{ id: 'missing-fields', label: 'Missing key details', icon: 'list-todo', hint: 'Required or recommended fields left empty.', weight: 20 },
	{ id: 'duplicates', label: 'Possible duplicates', icon: 'copy', hint: 'Entries of one type with the same name.', weight: 8 },
	{ id: 'orphans', label: 'Not connected', icon: 'circle-dashed', hint: 'Entries with no connections, parent or children.', weight: 10 },
	{ id: 'empty-types', label: 'Empty types', icon: 'folder-open', hint: 'Types with no entries yet.', weight: 4 },
	{ id: 'unused-data', label: 'Unused data', icon: 'archive-restore', hint: 'Values kept from deleted or changed fields, ready to restore.', weight: 0 },
	{ id: 'unused-images', label: 'Unused images', icon: 'image-plus', hint: 'Images in the world’s folder that nothing uses yet.', weight: 0 },
];

export interface HealthFinding {
	/** Stable across runs (for ignoring): `<check>:<key>`. */
	id: string;
	check: HealthCheckId;
	title: string;
	detail?: string;
	entityId?: string;
	/** Extra ids the finding is about (duplicates, broken connections). */
	entityIds?: string[];
	typeId?: string;
	path?: string;
	edgeId?: string;
	fieldIds?: string[];
	/** Maps: the map and the pin, area or route. */
	mapId?: string;
	itemId?: string;
}

export interface HealthReport {
	findings: HealthFinding[];
	ignored: HealthFinding[];
	/** 0–100. */
	score: number;
	entries: number;
	byCheck: Map<HealthCheckId, HealthFinding[]>;
}

export interface HealthEnv {
	fieldTypes: FieldTypeRegistry;
	/** Does a vault file exist? */
	exists(path: string): boolean;
	/** Image files in the world's media folder (for "unused images"); empty to skip. */
	worldImages?(): string[];
}

const live = (e: EntityRecord) => !e.trashedAt && !e.archivedAt;

/** Fields a finished entry should have: required, then recommended. */
function keyFields(schema: EntitySchema): FieldDefinition[] {
	return schema.fields.filter((f) => (f.required || f.recommended) && !f.hidden && f.type !== 'relation' && f.type !== 'rollup' && f.type !== 'formula');
}

export function runHealth(s: WorldSession, env: HealthEnv): HealthReport {
	const out: HealthFinding[] = [];
	const schemas = s.schemas.list().filter((t) => !t.archived);
	const schemaById = new Map(schemas.map((t) => [t.id, t]));
	const ents = s.entities.all().filter((e) => live(e) && schemaById.has(e.typeId));

	// Missing key details.
	for (const e of ents) {
		const schema = schemaById.get(e.typeId)!;
		const empty = keyFields(schema).filter((f) => env.fieldTypes.isEmpty(f, e.values[f.id]));
		if (empty.length) out.push({ id: `missing-fields:${e.id}`, check: 'missing-fields', title: e.name, detail: `No ${empty.slice(0, 3).map((f) => f.label.toLowerCase()).join(', ')}${empty.length > 3 ? ` and ${empty.length - 3} more` : ''}`, entityId: e.id, fieldIds: empty.map((f) => f.id) });
	}

	// Missing images (one finding per file).
	for (const [path, uses] of s.media.missing((p) => env.exists(p))) {
		const who = [...new Set(uses.map((u) => u.entityId).filter((x): x is string => !!x))];
		const names = who.map((id) => s.entities.get(id)?.name).filter(Boolean) as string[];
		out.push({ id: `broken-images:${path}`, check: 'broken-images', title: path.split('/').pop() ?? path, detail: names.length ? `Used by ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` and ${names.length - 3} more` : ''}` : 'Used by a banner', path, entityIds: who });
	}

	// Missing notes.
	for (const e of ents) {
		const paths = [e.linkedNote?.path, ...e.moreNotes.map((n) => n.path)].filter((p): p is string => !!p);
		for (const p of paths) if (!env.exists(p)) out.push({ id: `missing-notes:${e.id}:${p}`, check: 'missing-notes', title: e.name, detail: `“${p.split('/').pop()}” isn’t in the vault`, entityId: e.id, path: p });
	}

	// Broken connections.
	for (const edge of s.relations.allEdges()) {
		const a = s.entities.get(edge.from);
		const b = s.entities.get(edge.to);
		if (a && b && !a.trashedAt && !b.trashedAt) continue;
		// A connection from a trashed entry to a trashed entry isn't a live problem.
		if ((!a || a.trashedAt) && (!b || b.trashedAt)) continue;
		const okEnd = a && !a.trashedAt ? a : b!;
		const bad = okEnd === a ? b : a;
		const kind = s.relations.type(edge.type)?.label ?? 'Connection';
		out.push({
			id: `broken-links:${edge.id}`,
			check: 'broken-links',
			title: okEnd.name,
			detail: bad ? `${kind} with “${bad.name}”, which is in the trash` : `${kind} with an entry that no longer exists`,
			entityId: okEnd.id,
			entityIds: bad ? [bad.id] : [],
			edgeId: edge.id,
		});
	}

	// Maps whose pins, areas or routes point at entries that are gone (0.11).
	for (const m of s.maps.list()) {
		for (const p of mapProblems(s, m)) {
			const what = itemLabel(s, p.item, p.kind);
			const detail = p.problem === 'trashed' ? `“${what}” is linked to ${p.entity?.name ?? 'an entry'}, which is in the trash` : p.problem === 'missing' ? `“${what}” is linked to an entry that no longer exists` : `“${what}” opens a map that was deleted`;
			out.push({ id: `map-links:${m.id}:${p.item.id}:${p.problem}`, check: 'map-links', title: m.name, detail, entityIds: p.entity ? [p.entity.id] : [], mapId: m.id, itemId: p.item.id });
		}
	}

	// Empty types.
	const perType = new Map<string, number>();
	for (const e of ents) perType.set(e.typeId, (perType.get(e.typeId) ?? 0) + 1);
	for (const t of schemas) if (!perType.get(t.id)) out.push({ id: `empty-types:${t.id}`, check: 'empty-types', title: t.plural, detail: 'No entries yet', typeId: t.id });

	// Not connected.
	const hasParent = new Set(ents.filter((e) => e.parentId).map((e) => e.parentId!));
	for (const e of ents) {
		if (e.parentId || hasParent.has(e.id) || s.relations.count(e.id) > 0) continue;
		out.push({ id: `orphans:${e.id}`, check: 'orphans', title: e.name, detail: `${schemaById.get(e.typeId)!.singular} with no connections`, entityId: e.id });
	}

	// Dates that disagree.
	const timeline = s.world.timeline;
	for (const t of schemas) {
		const { start, end } = spanFields(t, timeline);
		if (!start || !end) continue;
		for (const e of ents) {
			if (e.typeId !== t.id) continue;
			const a = e.values[start.id];
			const b = e.values[end.id];
			if (!isChronoDate(a) || !isChronoDate(b)) continue;
			if (chronoPosition(b) < chronoPosition(a)) out.push({ id: `dates:${e.id}:${start.id}:${end.id}`, check: 'dates', title: e.name, detail: `${end.label} is before ${start.label.toLowerCase()}`, entityId: e.id, fieldIds: [start.id, end.id] });
		}
	}
	// Connections whose end is before their start.
	for (const edge of s.relations.allEdges()) {
		if (!edge.start || !edge.end || chronoPosition(edge.end) >= chronoPosition(edge.start)) continue;
		const a = s.entities.get(edge.from);
		const b = s.entities.get(edge.to);
		if (!a || !b || !live(a) || !live(b)) continue;
		out.push({ id: `dates:edge:${edge.id}`, check: 'dates', title: `${a.name} & ${b.name}`, detail: 'Their connection ends before it starts', entityId: a.id, entityIds: [b.id], edgeId: edge.id });
	}

	// Possible duplicates.
	const byName = new Map<string, EntityRecord[]>();
	for (const e of ents) {
		const k = `${e.typeId}\u0000${e.name.trim().toLowerCase()}`;
		if (!e.name.trim()) continue;
		const same = byName.get(k);
		if (same) same.push(e);
		else byName.set(k, [e]);
	}
	for (const list of byName.values()) {
		if (list.length < 2) continue;
		const t = schemaById.get(list[0]!.typeId)!;
		const ids = list.map((e) => e.id).sort();
		out.push({ id: `duplicates:${ids.join(',')}`, check: 'duplicates', title: list[0]!.name, detail: `${list.length} ${t.plural.toLowerCase()} share this name`, entityId: list[0]!.id, entityIds: list.map((e) => e.id) });
	}

	// Unused data.
	for (const e of ents) {
		const n = Object.keys(orphansOf(e.values)).length;
		if (n) out.push({ id: `unused-data:${e.id}`, check: 'unused-data', title: e.name, detail: `${n} value${n === 1 ? '' : 's'} from removed fields`, entityId: e.id });
	}

	// Unused images in the world's folder.
	const images = env.worldImages?.() ?? [];
	if (images.length) {
		const used = s.media.byPath(true);
		for (const p of images) if (!used.has(p)) out.push({ id: `unused-images:${p}`, check: 'unused-images', title: p.split('/').pop() ?? p, detail: p, path: p });
	}

	const ignoredIds = new Set(s.world.health.ignored);
	const findings = out.filter((f) => !ignoredIds.has(f.id));
	const ignored = out.filter((f) => ignoredIds.has(f.id));
	const byCheck = new Map<HealthCheckId, HealthFinding[]>();
	for (const f of findings) {
		const list = byCheck.get(f.check);
		if (list) list.push(f);
		else byCheck.set(f.check, [f]);
	}
	return { findings, ignored, score: healthScore(byCheck, ents.length, schemas.length), entries: ents.length, byCheck };
}

/**
 * 100 is a world with nothing to look at. Each check takes off up to its weight, by how
 * much of the world it touches (entries for per-entry checks, a few points per broken
 * file or link).
 */
export function healthScore(byCheck: Map<HealthCheckId, HealthFinding[]>, entries: number, types: number): number {
	let lost = 0;
	for (const c of HEALTH_CHECKS) {
		if (!c.weight) continue;
		const n = byCheck.get(c.id)?.length ?? 0;
		if (!n) continue;
		let share: number;
		if (c.id === 'empty-types') share = types ? n / types : 0;
		else if (c.id === 'broken-images' || c.id === 'missing-notes' || c.id === 'broken-links') share = Math.min(1, n / 5);
		else share = entries ? Math.min(1, n / entries) : 0;
		lost += c.weight * Math.max(share, 0.15);
	}
	return Math.max(0, Math.min(100, Math.round(100 - lost)));
}
