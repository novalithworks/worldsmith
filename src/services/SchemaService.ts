import type { EntitySchema, EntityTypeTemplate, FieldDefinition, SectionDefinition, World } from '../core/types';
import { clone } from '../core/util/clone';
import { pluralOf } from '../core/util/strings';
import { slugId } from '../core/util/ids';
import { RECORD_VERSIONS } from '../app/constants';
import type { SchemaRepository } from '../data/repositories/SchemaRepository';
import type { Registry } from '../core/registry/Registry';

/** Materialize a template into world schema data (records its origin for later updates). */
export function schemaFromTemplate(t: EntityTypeTemplate): EntitySchema {
	const now = Date.now();
	const { templateVersion, order: _order, ...rest } = clone(t);
	return {
		...rest,
		v: RECORD_VERSIONS.schema,
		origin: { templateId: t.id, templateVersion },
		archived: false,
		createdAt: now,
		updatedAt: now,
		rev: 0,
	};
}

export interface SectionView {
	section: SectionDefinition;
	fields: FieldDefinition[];
	/** Fields flagged `advanced`, shown behind "More fields". */
	advancedFields: FieldDefinition[];
}

/**
 * Business rules for entity types. Built-in templates become schemas via
 * `fromTemplate`; afterwards they are ordinary data that Type Studio can edit.
 */
export class SchemaService {
	constructor(
		private readonly repo: SchemaRepository,
		private readonly templates: Registry<EntityTypeTemplate & { id: string }>,
		private readonly getWorld: () => World,
	) {}

	get(typeId: string): EntitySchema | undefined {
		return this.repo.get(typeId);
	}

	/** Active (non-archived) types in sidebar order, then any not in the sidebar. */
	list(): EntitySchema[] {
		const order: string[] = [];
		for (const g of this.getWorld().sidebar.groups) {
			for (const item of g.items) if (item.kind === 'type') order.push(item.typeId);
		}
		const rank = new Map(order.map((id, i) => [id, i]));
		return this.repo
			.all()
			.filter((s) => !s.archived)
			.sort((a, b) => (rank.get(a.id) ?? 1e6) - (rank.get(b.id) ?? 1e6) || a.plural.localeCompare(b.plural));
	}

	field(schema: EntitySchema, fieldId: string): FieldDefinition | undefined {
		return schema.fields.find((f) => f.id === fieldId);
	}

	/** Sections with resolved field definitions; unsectioned fields go to "Other". */
	sections(schema: EntitySchema, opts: { includeHidden?: boolean } = {}): SectionView[] {
		const byId = new Map(schema.fields.map((f) => [f.id, f]));
		const used = new Set<string>();
		const out: SectionView[] = [];
		const visible = (f: FieldDefinition) => opts.includeHidden || !f.hidden;

		for (const section of schema.sections) {
			const all = section.fieldIds
				.map((id) => byId.get(id))
				.filter((f): f is FieldDefinition => !!f);
			all.forEach((f) => used.add(f.id));
			const shown = all.filter(visible);
			out.push({
				section,
				fields: shown.filter((f) => !f.advanced),
				advancedFields: shown.filter((f) => f.advanced),
			});
		}
		const rest = schema.fields.filter((f) => !used.has(f.id) && visible(f));
		if (rest.length) {
			out.push({
				section: { id: '__other', label: 'Other', icon: 'more-horizontal', fieldIds: rest.map((f) => f.id) },
				fields: rest.filter((f) => !f.advanced),
				advancedFields: rest.filter((f) => f.advanced),
			});
		}
		return out;
	}

	/** Install a template (built-in or extension) into this world. */
	installTemplate(t: EntityTypeTemplate): EntitySchema {
		return this.repo.put(schemaFromTemplate(t));
	}

	/**
	 * Create a brand-new custom type with a sensible starter structure. Type Studio
	 * (Milestone 2/9) edits it further.
	 */
	createCustomType(input: { singular: string; plural?: string; icon?: string; description?: string; group?: string; color?: EntitySchema['color'] }): EntitySchema {
		const taken = new Set(this.repo.all().map((s) => s.id));
		const id = slugId(input.singular, taken);
		const now = Date.now();
		const schema: EntitySchema = {
			v: RECORD_VERSIONS.schema,
			id,
			singular: input.singular.trim(),
			plural: (input.plural?.trim() || pluralOf(input.singular)),
			icon: input.icon || 'box',
			description: input.description ?? '',
			color: input.color ?? null,
			group: input.group ?? 'custom',
			fields: [
				{ id: 'summary', type: 'richtext', label: 'Overview', width: 'full', recommended: true },
				{ id: 'notes', type: 'longtext', label: 'Notes', width: 'full' },
			],
			sections: [{ id: 'overview', label: 'Overview', icon: 'align-left', fieldIds: ['summary', 'notes'] }],
			display: { subtitleFields: [], cardFields: [] },
			hierarchy: { allowParent: true, parentTypes: [], childTypes: [] },
			defaultTasks: [{ id: 'write-overview', title: 'Write an overview', category: 'Overview' }],
			defaultLayout: null,
			origin: null,
			archived: false,
			createdAt: now,
			updatedAt: now,
			rev: 0,
		};
		return this.repo.put(schema);
	}

	/**
	 * A new custom type from a starting point (Milestone 9): the template's fields, sections,
	 * cards and checklist under the name the user chose. Link fields whose relationship kind
	 * this world doesn't have are left out, so the type is always valid here.
	 */
	createFromTemplate(
		t: EntityTypeTemplate,
		input: { singular: string; plural?: string; icon?: string; description?: string; color?: EntitySchema['color'] },
		hasRelationType: (id: string) => boolean,
	): EntitySchema {
		const taken = new Set(this.repo.all().map((s) => s.id));
		const base = schemaFromTemplate(t);
		const drop = new Set(
			base.fields
				.filter((f) => f.type === 'relation' && !hasRelationType(String((f.config as { relationType?: string } | undefined)?.relationType ?? '')))
				.map((f) => f.id),
		);
		const known = (id: string) => !!this.repo.get(id);
		const fields = base.fields
			.filter((f) => !drop.has(f.id))
			.map((f) => (f.type === 'relation' ? { ...f, config: { ...(f.config ?? {}), targetTypes: ((f.config as { targetTypes?: string[] }).targetTypes ?? []).filter(known) } } : f));
		const singular = input.singular.trim() || base.singular;
		const schema: EntitySchema = {
			...base,
			id: slugId(singular, taken),
			singular,
			plural: input.plural?.trim() || base.plural,
			icon: input.icon || base.icon,
			description: input.description?.trim() || base.description,
			color: input.color === undefined ? base.color : input.color,
			fields,
			sections: base.sections.map((sec) => ({ ...sec, fieldIds: sec.fieldIds.filter((id) => !drop.has(id)) })),
			display: { subtitleFields: base.display.subtitleFields.filter((id) => !drop.has(id)), cardFields: base.display.cardFields.filter((id) => !drop.has(id)) },
			hierarchy: { ...base.hierarchy, parentTypes: base.hierarchy.parentTypes.filter(known), childTypes: base.hierarchy.childTypes.filter(known) },
			origin: null,
		};
		return this.repo.put(schema);
	}

	update(schema: EntitySchema): EntitySchema {
		return this.repo.put(schema);
	}

	templatesAvailable(): EntityTypeTemplate[] {
		return this.templates.all();
	}
}
