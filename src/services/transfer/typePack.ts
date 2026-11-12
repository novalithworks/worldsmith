import type { NoteTemplate } from '../../core/types';
import { RECORD_VERSIONS } from '../../app/constants';
import type { BlockInstance, EntitySchema, FieldDefinition, RelationType } from '../../core/types';
import { slugId } from '../../core/util/ids';
import type { FieldTypeRegistry } from '../../fields/FieldTypeRegistry';
import { relationConfig } from '../RelationService';
import { validateSchema } from '../schema/validateSchema';
import { addTypeToSidebar, SAFE_ID } from '../WorldService';
import { unsafeJsonReason } from '../../core/util/safeJson';
import { defaultLayoutFor } from '../../layouts/defaults';
import { sameLayout } from '../../layouts/presets';
import type { WorldSession } from '../WorldSession';

/**
 * Type packs (Milestone 9): one or more entity types — fields, sections, cards, checklist and
 * page layout — plus the relationship kinds their link fields use, in one file another world
 * can import. Entries are never part of a pack.
 */
export const TYPE_PACK_FORMAT = 'worldsmith/types';

type PackSchema = Omit<EntitySchema, 'v' | 'origin' | 'createdAt' | 'updatedAt' | 'rev' | 'archived'>;
type PackRelation = Omit<RelationType, 'v' | 'origin' | 'createdAt' | 'updatedAt' | 'rev'>;

export interface TypePack {
	format: typeof TYPE_PACK_FORMAT;
	v: 1;
	exportedAt: number;
	/** Name of the world it came from (shown when importing). */
	from: string;
	types: Array<{ schema: PackSchema; layout: BlockInstance[] | null; note?: PackNoteTemplate }>;
	relationTypes: PackRelation[];
}

/** The type's native note template (0.17): a built-in by id, or a template of the world's own. */
export type PackNoteTemplate = { builtIn: string } | { template: Pick<NoteTemplate, 'name' | 'icon' | 'description' | 'sections' | 'appearance'> };

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function exportTypePack(s: WorldSession, typeIds: string[]): TypePack {
	const types: TypePack['types'] = [];
	const relIds = new Set<string>();
	for (const id of typeIds) {
		const schema = s.schemas.get(id);
		if (!schema) continue;
		const { v: _v, origin: _o, createdAt: _c, updatedAt: _u, rev: _r, archived: _a, ...rest } = clone(schema);
		void [_v, _o, _c, _u, _r, _a];
		// The layout pages actually use (a built-in type's standard one too: in the other
		// world the type is a custom one, whose default layout is different).
		const chosen = s.world.noteTemplates?.byType?.[schema.id];
		const nt = chosen ? s.noteTemplates.get(chosen) : undefined;
		const note: PackNoteTemplate | undefined = nt ? (nt.builtIn ? { builtIn: nt.id } : { template: { name: nt.name, icon: nt.icon, description: nt.description, sections: clone(nt.sections), appearance: clone(nt.appearance) } }) : undefined;
		types.push({ schema: rest, layout: clone(s.layouts.typeLayout(schema).blocks), ...(note ? { note } : {}) });
		for (const f of schema.fields) if (f.type === 'relation' && relationConfig(f).relationType) relIds.add(relationConfig(f).relationType!);
	}
	const relationTypes: PackRelation[] = [];
	for (const id of relIds) {
		const t = s.relations.type(id);
		if (!t) continue;
		const { v: _v, origin: _o, createdAt: _c, updatedAt: _u, rev: _r, ...rest } = clone(t);
		void [_v, _o, _c, _u, _r];
		relationTypes.push(rest);
	}
	return { format: TYPE_PACK_FORMAT, v: 1, exportedAt: Date.now(), from: s.world.name, types, relationTypes };
}

/** A pack read from a file, or the reason it can't be used. */
export function readTypePack(raw: unknown): { pack: TypePack } | { error: string } {
	const p = raw as Partial<TypePack> | null;
	if (!p || typeof p !== 'object' || p.format !== TYPE_PACK_FORMAT) return { error: 'That file isn’t a Worldsmith type file.' };
	if (typeof p.v !== 'number' || p.v > 1) return { error: 'That type file comes from a newer version of Worldsmith. Update the plugin to import it.' };
	const all = Array.isArray(p.types) ? p.types : [];
	const types = all.filter((t) => t && typeof t === 'object' && t.schema && typeof t.schema.id === 'string' && Array.isArray(t.schema.fields) && Array.isArray(t.schema.sections));
	if (!types.length) return { error: 'That file has no types in it.' };
	const rels = Array.isArray(p.relationTypes) ? p.relationTypes.filter((r) => r && typeof r === 'object' && typeof r.id === 'string') : [];
	// Ids become file names: a file with anything but plain ids is refused outright.
	if (types.length !== all.length || types.some((t) => !SAFE_ID.test(t.schema.id)) || rels.some((r) => !SAFE_ID.test(r.id))) return { error: 'That type file is damaged and can’t be imported.' };
	if (unsafeJsonReason(raw)) return { error: 'That type file is damaged and can’t be imported.' };
	return { pack: { format: TYPE_PACK_FORMAT, v: 1, exportedAt: Number(p.exportedAt) || 0, from: typeof p.from === 'string' ? p.from : 'another world', types, relationTypes: rels } };
}

export type PackChoice = 'add' | 'copy' | 'skip';

export interface PackPreview {
	id: string;
	plural: string;
	icon: string;
	color: EntitySchema['color'];
	fields: number;
	/** A type with this id already exists here. */
	exists: boolean;
	/** What happens by default: new types are added; clashes are added as a copy. */
	choice: PackChoice;
}

export function previewTypePack(s: WorldSession, pack: TypePack): { types: PackPreview[]; newRelations: string[] } {
	return {
		types: pack.types.map(({ schema }) => {
			const exists = !!s.schemas.get(schema.id);
			return { id: schema.id, plural: schema.plural, icon: schema.icon, color: schema.color, fields: schema.fields.length, exists, choice: exists ? 'copy' : 'add' };
		}),
		newRelations: pack.relationTypes.filter((r) => !s.relations.type(r.id)).map((r) => r.label),
	};
}

export interface PackImportResult {
	added: EntitySchema[];
	relationTypes: number;
	skipped: number;
	/** Remove what the import added (types still without entries, and their relationship kinds). */
	undo(): { removed: number; kept: number };
}

/**
 * Add the pack's types. A type whose id is taken is skipped or added as a copy (new id and
 * "(imported)" name); references between the pack's own types follow the new ids. Relation
 * kinds the world lacks are added; existing ones (same id) are left exactly as they are.
 */
export function importTypePack(s: WorldSession, fieldTypes: FieldTypeRegistry, pack: TypePack, choices: Record<string, PackChoice> = {}): PackImportResult {
	for (const t of pack.types) if (!SAFE_ID.test(t.schema.id)) throw new Error('That type file is damaged and can’t be imported.');
	for (const r of pack.relationTypes) if (!SAFE_ID.test(r.id)) throw new Error('That type file is damaged and can’t be imported.');
	const taken = new Set(s.schemas.list().map((x) => x.id));
	for (const sc of s.schemaRepo.all()) taken.add(sc.id);
	const idMap = new Map<string, string>();
	const todo: Array<{ schema: PackSchema; layout: BlockInstance[] | null; note?: PackNoteTemplate }> = [];
	let skipped = 0;
	for (const t of pack.types) {
		const exists = taken.has(t.schema.id);
		const choice = choices[t.schema.id] ?? (exists ? 'copy' : 'add');
		if (choice === 'skip') {
			skipped++;
			continue;
		}
		const id = exists ? slugId(`${t.schema.singular} imported`, [...taken]) : t.schema.id;
		taken.add(id);
		idMap.set(t.schema.id, id);
		todo.push(t);
	}
	const mapId = (id: string) => idMap.get(id) ?? id;
	const known = (id: string) => taken.has(id) || !!s.schemas.get(id);
	const now = Date.now();

	// Build and check every type first: nothing is written unless all of them are valid.
	const ready: Array<{ schema: EntitySchema; layout: BlockInstance[] | null; note?: PackNoteTemplate }> = [];
	for (const { schema: src, layout, note } of todo) {
		const id = mapId(src.id);
		const renamed = id !== src.id;
		const fields: FieldDefinition[] = clone(src.fields).map((f) => {
			if (f.type !== 'relation') return f;
			const cfg = relationConfig(f);
			return { ...f, config: { ...(f.config ?? {}), targetTypes: cfg.targetTypes.map(mapId).filter(known) } };
		});
		const schema: EntitySchema = {
			...clone(src),
			id,
			singular: renamed ? `${src.singular} (imported)` : src.singular,
			plural: renamed ? `${src.plural} (imported)` : src.plural,
			fields,
			display: { subtitleFields: src.display?.subtitleFields ?? [], cardFields: src.display?.cardFields ?? [] },
			hierarchy: {
				allowParent: !!src.hierarchy?.allowParent,
				parentTypes: (src.hierarchy?.parentTypes ?? []).map(mapId).filter(known),
				childTypes: (src.hierarchy?.childTypes ?? []).map(mapId).filter(known),
			},
			defaultTasks: Array.isArray(src.defaultTasks) ? src.defaultTasks : [],
			defaultLayout: src.defaultLayout ?? null,
			group: typeof src.group === 'string' ? src.group : 'custom',
			v: RECORD_VERSIONS.schema,
			origin: null,
			archived: false,
			createdAt: now,
			updatedAt: now,
			rev: 0,
		};
		const errors = validateSchema(schema, fieldTypes).filter((i) => i.severity === 'error');
		if (errors.length) throw new Error(`“${src.plural}” can’t be imported: ${errors.map((e) => e.message).join('; ')}`);
		ready.push({ schema, layout: Array.isArray(layout) ? layout : null, note });
	}

	// Relationship kinds the world doesn't have yet (only those the imported types use).
	const used = new Set<string>();
	for (const { schema } of ready) for (const f of schema.fields) if (f.type === 'relation' && relationConfig(f).relationType) used.add(relationConfig(f).relationType!);
	const installed: string[] = [];
	for (const r of pack.relationTypes) {
		if (!used.has(r.id) || s.relations.type(r.id)) continue;
		s.relations.installTemplate({ ...clone(r), templateVersion: 1 });
		installed.push(r.id);
	}
	const added: EntitySchema[] = [];
	const layouts: string[] = [];
	const noteTemplates: string[] = [];
	for (const { schema, layout, note } of ready) {
		const saved = s.schemas.update(schema);
		added.push(saved);
		if (layout?.length && !sameLayout(layout, defaultLayoutFor(saved))) {
			s.layouts.save({ kind: 'type', typeId: saved.id }, layout);
			layouts.push(saved.id);
		}
		// Its note template comes along: a built-in is assigned, the world's own is added.
		if (note && 'builtIn' in note && typeof note.builtIn === 'string' && s.noteTemplates.get(note.builtIn)?.builtIn) s.noteTemplates.assign(saved.id, note.builtIn);
		else if (note && 'template' in note && note.template && Array.isArray(note.template.sections)) {
			const t = s.noteTemplates.create({ name: typeof note.template.name === 'string' ? note.template.name : `${saved.singular} note`, icon: note.template.icon, description: note.template.description, sections: note.template.sections, appearance: note.template.appearance });
			if (t.sections.length) {
				s.noteTemplates.assign(saved.id, t.id);
				noteTemplates.push(t.id);
			} else s.noteTemplates.remove(t.id);
		}
	}
	if (added.length) {
		const sidebar = clone(s.world.sidebar);
		for (const sc of added) addTypeToSidebar(sidebar, sc);
		s.updateWorld({ sidebar });
	}
	return {
		added,
		relationTypes: installed.length,
		skipped,
		undo: () => {
			let removed = 0;
			let kept = 0;
			for (const sc of added) {
				// A type that has entries by now stays (archive it instead).
				if (!s.schemas.get(sc.id) || s.schemaEdits.countEntities(sc.id) > 0) {
					kept++;
					continue;
				}
				s.schemaEdits.deleteType(sc.id);
				if (layouts.includes(sc.id)) s.layouts.reset({ kind: 'type', typeId: sc.id });
				s.noteTemplates.assign(sc.id, null);
				removed++;
			}
			for (const id of noteTemplates) if (!Object.values(s.world.noteTemplates?.byType ?? {}).includes(id)) s.noteTemplates.remove(id);
			for (const id of installed) {
				try {
					s.relations.deleteType(id, s.schemaRepo.all());
				} catch {
					// In use by now — keep it.
				}
			}
			return { removed, kept };
		},
	};
}
