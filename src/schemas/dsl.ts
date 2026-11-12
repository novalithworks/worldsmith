import type {
	EntityTypeTemplate,
	FieldDefinition,
	FieldWidth,
	LayoutTemplate,
	SectionDefinition,
	SelectOption,
	SemanticColor,
	TaskTemplate,
} from '../core/types';
import { slugId } from '../core/util/ids';

/**
 * A compact builder for authoring built-in type templates in code. It produces plain
 * data (EntityTypeTemplate) — exactly what a user would create in Type Studio — so
 * built-ins get no special treatment at runtime.
 *
 *   defineType({ id: 'creature', singular: 'Creature', … },
 *     section('identity', 'Identity', 'paw-print', [
 *       f.select('dangerLevel', 'Danger level', opts('Harmless:green', 'Deadly:red')),
 *     ]),
 *   )
 */
interface FieldOpts {
	description?: string;
	icon?: string;
	placeholder?: string;
	width?: FieldWidth;
	recommended?: boolean;
	required?: boolean;
	advanced?: boolean;
	hidden?: boolean;
	display?: string;
	config?: Record<string, unknown>;
	defaultValue?: unknown;
}

function field(type: string, id: string, label: string, o: FieldOpts = {}): FieldDefinition {
	const def: FieldDefinition = { id, type, label };
	if (o.description) def.description = o.description;
	if (o.icon) def.icon = o.icon;
	if (o.placeholder) def.placeholder = o.placeholder;
	if (o.width) def.width = o.width;
	if (o.recommended) def.recommended = true;
	if (o.required) def.required = true;
	if (o.advanced) def.advanced = true;
	if (o.hidden) def.hidden = true;
	if (o.display) def.display = o.display;
	if (o.config) def.config = o.config;
	if (o.defaultValue !== undefined) def.defaultValue = o.defaultValue;
	return def;
}

/** "Label" or "Label:color" or "Label:color:icon" → SelectOption with a slug id. */
export function opts(...specs: string[]): SelectOption[] {
	const taken: string[] = [];
	return specs.map((spec) => {
		const [label = '', color, icon] = spec.split(':');
		const id = slugId(label, taken);
		taken.push(id);
		const o: SelectOption = { id, label };
		if (color) o.color = color as SemanticColor;
		if (icon) o.icon = icon;
		return o;
	});
}

export interface RelationOpts extends FieldOpts {
	/** Relationship type id (seeded in Milestone 3). */
	via: string;
	direction?: 'forward' | 'reverse';
	targets?: string[];
	/** Max linked entities (1 = single relation). */
	max?: number | null;
}

export const f = {
	text: (id: string, label: string, o?: FieldOpts) => field('text', id, label, o),
	long: (id: string, label: string, o?: FieldOpts) => field('longtext', id, label, { width: 'full', ...o }),
	rich: (id: string, label: string, o?: FieldOpts) => field('richtext', id, label, { width: 'full', ...o }),
	number: (id: string, label: string, o?: FieldOpts) => field('number', id, label, o),
	percent: (id: string, label: string, o?: FieldOpts) => field('percent', id, label, o),
	bool: (id: string, label: string, o?: FieldOpts) => field('boolean', id, label, o),
	date: (id: string, label: string, o?: FieldOpts) => field('date', id, label, o),
	chrono: (id: string, label: string, o?: FieldOpts) => field('chrono', id, label, o),
	select: (id: string, label: string, options: SelectOption[], o?: FieldOpts) =>
		field('select', id, label, { ...o, config: { ...o?.config, options } }),
	multi: (id: string, label: string, options: SelectOption[], o?: FieldOpts) =>
		field('multiselect', id, label, { ...o, config: { ...o?.config, options } }),
	list: (id: string, label: string, o?: FieldOpts) => field('list', id, label, o),
	rating: (id: string, label: string, max = 5, o?: FieldOpts) =>
		field('rating', id, label, { ...o, config: { ...o?.config, max } }),
	progress: (id: string, label: string, o?: FieldOpts) => field('progress', id, label, o),
	url: (id: string, label: string, o?: FieldOpts) => field('url', id, label, o),
	image: (id: string, label: string, o?: FieldOpts) => field('image', id, label, o),
	gallery: (id: string, label: string, o?: FieldOpts) => field('gallery', id, label, { width: 'full', ...o }),
	file: (id: string, label: string, o?: FieldOpts) => field('file', id, label, o),
	color: (id: string, label: string, o?: FieldOpts) => field('color', id, label, o),
	rel: (id: string, label: string, r: RelationOpts) =>
		field('relation', id, label, {
			...r,
			config: {
				relationType: r.via,
				direction: r.direction ?? 'forward',
				targetTypes: r.targets ?? [],
				max: r.max ?? null,
			},
		}),
};

export interface SectionSpec {
	section: SectionDefinition;
	fields: FieldDefinition[];
}

export function section(
	id: string,
	label: string,
	icon: string,
	fields: FieldDefinition[],
	o: { advanced?: boolean; collapsed?: boolean; description?: string } = {},
): SectionSpec {
	const def: SectionDefinition = { id, label, icon, fieldIds: fields.map((x) => x.id) };
	if (o.advanced) def.advanced = true;
	if (o.collapsed) def.collapsed = true;
	if (o.description) def.description = o.description;
	return { section: def, fields };
}

/** "Title" or "Title|Category" or "Title|Category|optional" → TaskTemplate. */
export function tasks(...specs: string[]): TaskTemplate[] {
	const taken: string[] = [];
	return specs.map((spec) => {
		const [title = '', category, flag] = spec.split('|');
		const id = slugId(title, taken);
		taken.push(id);
		const t: TaskTemplate = { id, title };
		if (category) t.category = category;
		if (flag === 'optional') t.optional = true;
		return t;
	});
}

export interface TypeMeta {
	id: string;
	singular: string;
	plural: string;
	icon: string;
	description: string;
	group: string;
	color?: SemanticColor;
	order: number;
	subtitle?: string[];
	card?: string[];
	parentTypes?: string[];
	childTypes?: string[];
	allowParent?: boolean;
	tasks?: TaskTemplate[];
	layout?: LayoutTemplate | null;
	templateVersion?: number;
}

export function defineType(meta: TypeMeta, ...sections: SectionSpec[]): EntityTypeTemplate {
	const fields: FieldDefinition[] = [];
	const seen = new Set<string>();
	for (const s of sections) {
		for (const fd of s.fields) {
			if (seen.has(fd.id)) throw new Error(`[Worldsmith] duplicate field "${fd.id}" in type ${meta.id}`);
			seen.add(fd.id);
			fields.push(fd);
		}
	}
	return {
		id: meta.id,
		singular: meta.singular,
		plural: meta.plural,
		icon: meta.icon,
		description: meta.description,
		color: meta.color ?? null,
		group: meta.group,
		fields,
		sections: sections.map((s) => s.section),
		display: { subtitleFields: meta.subtitle ?? [], cardFields: meta.card ?? [] },
		hierarchy: {
			allowParent: meta.allowParent ?? true,
			parentTypes: meta.parentTypes ?? [],
			childTypes: meta.childTypes ?? [],
		},
		defaultTasks: meta.tasks ?? [],
		defaultLayout: meta.layout ?? null,
		templateVersion: meta.templateVersion ?? 1,
		order: meta.order,
	};
}
