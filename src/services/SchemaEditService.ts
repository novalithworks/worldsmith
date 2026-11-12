import type {
	EntityRecord,
	EntitySchema,
	FieldDefinition,
	SectionDefinition,
	SelectOption,
	SemanticColor,
	TaskTemplate,
	World,
} from '../core/types';
import { ORPHAN_KEY, orphanFieldId, orphansOf, type OrphanedValue } from '../core/types/orphan';
import { clone } from '../core/util/clone';
import { pluralOf } from '../core/util/strings';
import { slugId } from '../core/util/ids';
import type { EntityRepository } from '../data/repositories/EntityRepository';
import type { SchemaRepository } from '../data/repositories/SchemaRepository';
import type { FieldTypeRegistry } from '../fields/FieldTypeRegistry';
import { selectOptions } from '../fields/types/logic';
import { SchemaValidationError, validateSchema } from './schema/validateSchema';
import { addTypeToSidebar } from './WorldService';

/**
 * Every structural change to entity types goes through here (Type Studio, entity-page
 * shortcuts, future import). Rules:
 *
 *  1. Field ids are immutable — renaming changes the label only.
 *  2. Every edit is validated; an invalid result throws and nothing is saved.
 *  3. Nothing is destroyed: deleting a field or failing to convert a value moves it to
 *     the entity's `values._orphaned`, which the entity page can restore or discard.
 *  4. Every edit pushes an undo entry (schema snapshot + exact prior values of every
 *     entity it touched).
 */
export interface UndoEntry {
	label: string;
	at: number;
	typeId: string;
	schemaBefore: EntitySchema | null;
	worldSidebarBefore?: World['sidebar'];
	entityValuesBefore: Map<string, Record<string, unknown>>;
}

export interface TypeChangePreview {
	total: number;
	convertible: number;
	lost: number;
	/** Up to five example values that won't convert. */
	examples: string[];
}

export type FieldPatch = Partial<Omit<FieldDefinition, 'id' | 'type'>>;
export type SectionPatch = Partial<Omit<SectionDefinition, 'id' | 'fieldIds'>>;
export type TypeMetaPatch = Partial<Pick<EntitySchema, 'singular' | 'plural' | 'icon' | 'description' | 'group'>> & {
	color?: SemanticColor | null;
};

const MAX_UNDO = 50;

export class SchemaEditService {
	private undoStack: UndoEntry[] = [];
	private listeners = new Set<() => void>();

	constructor(
		private readonly schemas: SchemaRepository,
		private readonly entities: EntityRepository,
		private readonly fieldTypes: FieldTypeRegistry,
		private readonly getWorld: () => World,
		private readonly updateWorld: (patch: Partial<World>) => void,
	) {}

	// ── undo ──────────────────────────────────────────────────────────────────

	canUndo(): boolean {
		return this.undoStack.length > 0;
	}

	lastUndoLabel(): string | null {
		return this.undoStack[this.undoStack.length - 1]?.label ?? null;
	}

	onUndoChange(cb: () => void): () => void {
		this.listeners.add(cb);
		return () => this.listeners.delete(cb);
	}

	/** Revert the most recent edit. Returns its label, or null if nothing to undo. */
	undo(): string | null {
		const entry = this.undoStack.pop();
		if (!entry) return null;
		if (entry.schemaBefore) this.schemas.put(clone(entry.schemaBefore));
		else this.schemas.remove(entry.typeId);
		if (entry.worldSidebarBefore) this.updateWorld({ sidebar: clone(entry.worldSidebarBefore) });
		for (const [id, before] of entry.entityValuesBefore) this.replaceValues(id, before);
		this.emitUndo();
		return entry.label;
	}

	private emitUndo(): void {
		for (const l of this.listeners) l();
	}

	/**
	 * Run an edit: clone → mutate → validate → save, with an undo entry. `touch` lets the
	 * mutation record entity value changes (applied only if validation passes).
	 */
	private edit(
		typeId: string,
		label: string,
		mutate: (draft: EntitySchema, touch: EntityTouch) => void,
		opts: { sidebar?: boolean } = {},
	): EntitySchema {
		const current = this.require(typeId);
		const draft = clone(current);
		const touch = new EntityTouch();
		mutate(draft, touch);
		const errors = validateSchema(draft, this.fieldTypes).filter((i) => i.severity === 'error');
		if (errors.length) throw new SchemaValidationError(errors);

		const entry: UndoEntry = {
			label,
			at: Date.now(),
			typeId,
			schemaBefore: clone(current),
			entityValuesBefore: new Map(),
		};
		if (opts.sidebar) entry.worldSidebarBefore = clone(this.getWorld().sidebar);
		for (const [id, values] of touch.changes) {
			const e = this.entities.get(id);
			if (!e) continue;
			entry.entityValuesBefore.set(id, clone(e.values));
			this.replaceValues(id, values);
		}
		const saved = this.schemas.put(draft);
		this.undoStack.push(entry);
		if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
		this.emitUndo();
		return saved;
	}

	private replaceValues(id: string, next: Record<string, unknown>): void {
		const e = this.entities.get(id);
		if (!e) return;
		const patch: Record<string, unknown> = {};
		for (const k of Object.keys(e.values)) if (!(k in next)) patch[k] = undefined;
		Object.assign(patch, next);
		this.entities.update(id, { values: patch });
	}

	private require(typeId: string): EntitySchema {
		const s = this.schemas.get(typeId);
		if (!s) throw new Error(`Unknown type “${typeId}”.`);
		return s;
	}

	private entitiesOf(typeId: string): EntityRecord[] {
		// Includes trashed and archived entries: their data must migrate too.
		return this.entities.all().filter((e) => e.typeId === typeId);
	}

	countEntities(typeId: string): number {
		return this.entitiesOf(typeId).length;
	}

	// ── type settings ─────────────────────────────────────────────────────────

	updateTypeMeta(typeId: string, patch: TypeMetaPatch): EntitySchema {
		const groupChange = patch.group !== undefined && patch.group !== this.require(typeId).group;
		const saved = this.edit(
			typeId,
			'Edit type settings',
			(d) => {
				if (patch.singular !== undefined) d.singular = patch.singular.trim();
				if (patch.plural !== undefined) d.plural = patch.plural.trim();
				if (patch.icon !== undefined) d.icon = patch.icon;
				if (patch.description !== undefined) d.description = patch.description;
				if (patch.color !== undefined) d.color = patch.color;
				if (patch.group !== undefined) d.group = patch.group;
			},
			{ sidebar: groupChange },
		);
		if (groupChange) this.moveTypeInSidebar(typeId, saved.group);
		return saved;
	}

	private moveTypeInSidebar(typeId: string, groupId: string): void {
		const sidebar = clone(this.getWorld().sidebar);
		for (const g of sidebar.groups) g.items = g.items.filter((i) => !(i.kind === 'type' && i.typeId === typeId));
		const target = sidebar.groups.find((g) => g.id === groupId);
		if (target) target.items.push({ kind: 'type', typeId });
		else addTypeToSidebar(sidebar, this.require(typeId));
		this.updateWorld({ sidebar });
	}

	setDisplay(typeId: string, display: { subtitleFields?: string[]; cardFields?: string[] }): EntitySchema {
		return this.edit(typeId, 'Edit display fields', (d) => {
			if (display.subtitleFields) d.display.subtitleFields = [...new Set(display.subtitleFields)];
			if (display.cardFields) d.display.cardFields = [...new Set(display.cardFields)];
		});
	}

	setHierarchy(typeId: string, h: Partial<EntitySchema['hierarchy']>): EntitySchema {
		return this.edit(typeId, 'Edit nesting rules', (d) => {
			d.hierarchy = { ...d.hierarchy, ...h };
		});
	}

	setDefaultTasks(typeId: string, tasks: TaskTemplate[]): EntitySchema {
		return this.edit(typeId, 'Edit default checklist', (d) => {
			d.defaultTasks = clone(tasks);
		});
	}

	/** New checklist item with a unique id. */
	newTaskTemplate(typeId: string, title: string): TaskTemplate {
		const taken = this.require(typeId).defaultTasks.map((t) => t.id);
		return { id: slugId(title || 'task', taken), title };
	}

	/** Copy a type's structure (not its entries) into a new custom type. */
	duplicateType(typeId: string, singular: string, plural?: string): EntitySchema {
		const src = this.require(typeId);
		const taken = new Set(this.schemas.all().map((s) => s.id));
		const now = Date.now();
		const copy: EntitySchema = {
			...clone(src),
			id: slugId(singular, taken),
			singular: singular.trim(),
			plural: plural?.trim() || pluralOf(singular),
			origin: null,
			archived: false,
			createdAt: now,
			updatedAt: now,
			rev: 0,
		};
		const errors = validateSchema(copy, this.fieldTypes).filter((i) => i.severity === 'error');
		if (errors.length) throw new SchemaValidationError(errors);
		const sidebarBefore = clone(this.getWorld().sidebar);
		const saved = this.schemas.put(copy);
		const sidebar = clone(this.getWorld().sidebar);
		addTypeToSidebar(sidebar, saved);
		this.updateWorld({ sidebar });
		this.undoStack.push({ label: `Duplicate ${src.singular}`, at: now, typeId: saved.id, schemaBefore: null, worldSidebarBefore: sidebarBefore, entityValuesBefore: new Map() });
		this.emitUndo();
		return saved;
	}

	setArchived(typeId: string, archived: boolean): EntitySchema {
		return this.edit(typeId, archived ? 'Archive type' : 'Restore type', (d) => {
			d.archived = archived;
		});
	}

	/** Delete a type. Only allowed when it has no entries at all (including trash). */
	deleteType(typeId: string): void {
		const n = this.countEntities(typeId);
		if (n > 0) throw new Error(`This type still has ${n} entr${n === 1 ? 'y' : 'ies'} (including trash). Archive it instead, or delete the entries first.`);
		const before = clone(this.require(typeId));
		const sidebarBefore = clone(this.getWorld().sidebar);
		this.schemas.remove(typeId);
		const sidebar = clone(sidebarBefore);
		for (const g of sidebar.groups) g.items = g.items.filter((i) => !(i.kind === 'type' && i.typeId === typeId));
		this.updateWorld({ sidebar });
		this.undoStack.push({ label: `Delete ${before.singular}`, at: Date.now(), typeId, schemaBefore: before, worldSidebarBefore: sidebarBefore, entityValuesBefore: new Map() });
		this.emitUndo();
	}

	// ── fields ────────────────────────────────────────────────────────────────

	addField(typeId: string, input: { label: string; type: string; sectionId?: string | null; index?: number }): FieldDefinition {
		const logic = this.fieldTypes.get(input.type);
		if (!logic) throw new Error(`Unknown field kind “${input.type}”.`);
		let created!: FieldDefinition;
		this.edit(typeId, `Add field “${input.label}”`, (d) => {
			const id = slugId(input.label || 'field', d.fields.map((f) => f.id));
			created = { id, type: input.type, label: input.label.trim() || 'Untitled field' };
			if (logic.defaultWidth) created.width = logic.defaultWidth;
			if (input.type === 'select' || input.type === 'multiselect') created.config = { options: [] };
			if (input.type === 'rating') created.config = { max: 5 };
			d.fields.push(created);
			const section = input.sectionId ? d.sections.find((s) => s.id === input.sectionId) : undefined;
			if (section) {
				const idx = input.index ?? section.fieldIds.length;
				section.fieldIds.splice(Math.max(0, Math.min(idx, section.fieldIds.length)), 0, id);
			}
		});
		return created;
	}

	/**
	 * Copy a field (its kind, choices and settings) to another type. It goes into a section
	 * with the same name if the other type has one, else its last section. A taken label gets
	 * a number. Values aren't copied — entries of the other type start empty.
	 */
	copyFieldTo(fromTypeId: string, fieldId: string, toTypeId: string): FieldDefinition {
		const src = this.require(fromTypeId);
		const f = src.fields.find((x) => x.id === fieldId);
		if (!f) throw new Error(`Unknown field “${fieldId}”.`);
		if (fromTypeId === toTypeId) throw new Error('Pick another type.');
		const fromSection = src.sections.find((sec) => sec.fieldIds.includes(fieldId));
		let created!: FieldDefinition;
		this.edit(toTypeId, `Copy field “${f.label}”`, (d) => {
			const labels = new Set(d.fields.map((x) => x.label.toLowerCase()));
			let label = f.label;
			for (let n = 2; labels.has(label.toLowerCase()); n++) label = `${f.label} ${n}`;
			created = { ...clone(f), id: slugId(f.id, d.fields.map((x) => x.id)), label };
			delete created.required;
			d.fields.push(created);
			const section = (fromSection && d.sections.find((sec) => sec.label.toLowerCase() === fromSection.label.toLowerCase())) ?? d.sections[d.sections.length - 1];
			section?.fieldIds.push(created.id);
		});
		return created;
	}

	updateField(typeId: string, fieldId: string, patch: FieldPatch): EntitySchema {
		return this.edit(typeId, 'Edit field', (d) => {
			const f = d.fields.find((x) => x.id === fieldId);
			if (!f) throw new Error(`Unknown field “${fieldId}”.`);
			for (const [k, v] of Object.entries(patch) as Array<[keyof FieldPatch, unknown]>) {
				if (v === undefined || v === null || v === false || v === '') delete (f as unknown as Record<string, unknown>)[k];
				else (f as unknown as Record<string, unknown>)[k] = k === 'label' && typeof v === 'string' ? v.trim() : v;
			}
			if (patch.label !== undefined && !f.label) f.label = patch.label;
		});
	}

	/** Merge keys into a field's type-specific config (null/undefined removes a key). */
	updateFieldConfig(typeId: string, fieldId: string, config: Record<string, unknown>): EntitySchema {
		return this.edit(typeId, 'Edit field options', (d) => {
			const f = d.fields.find((x) => x.id === fieldId);
			if (!f) throw new Error(`Unknown field “${fieldId}”.`);
			const next = { ...(f.config ?? {}) };
			for (const [k, v] of Object.entries(config)) {
				if (v === undefined || v === null || v === '') delete next[k];
				else next[k] = v;
			}
			if (Object.keys(next).length) f.config = next;
			else delete f.config;
		});
	}

	/** How many existing values would survive a kind change. */
	previewTypeChange(typeId: string, fieldId: string, newType: string): TypeChangePreview {
		const schema = this.require(typeId);
		const field = schema.fields.find((f) => f.id === fieldId);
		const preview: TypeChangePreview = { total: 0, convertible: 0, lost: 0, examples: [] };
		if (!field) return preview;
		const target = this.retypedField(field, newType, this.entitiesOf(typeId));
		const logic = this.fieldTypes.get(newType);
		for (const e of this.entitiesOf(typeId)) {
			const v = e.values[fieldId];
			if (this.fieldTypes.isEmpty(field, v)) continue;
			preview.total++;
			const res = logic && !logic.computed ? logic.coerce(this.portable(field, v), target) : { ok: false as const };
			if (res.ok && !(logic?.isEmpty(res.value) ?? true)) preview.convertible++;
			else {
				preview.lost++;
				if (preview.examples.length < 5) preview.examples.push(this.fieldTypes.toText(field, v) || JSON.stringify(v));
			}
		}
		return preview;
	}

	/**
	 * Change a field's kind. Existing values are converted through the new kind's
	 * `coerce`; values that can't convert are kept as unused data on each entry.
	 * Converting text/list values to a choice field creates choices from those values.
	 */
	changeFieldType(typeId: string, fieldId: string, newType: string): { converted: number; orphaned: number } {
		const logic = this.fieldTypes.get(newType);
		if (!logic) throw new Error(`Unknown field kind “${newType}”.`);
		let converted = 0;
		let orphaned = 0;
		const list = this.entitiesOf(typeId);
		this.edit(typeId, 'Change field kind', (d, touch) => {
			const f = d.fields.find((x) => x.id === fieldId);
			if (!f) throw new Error(`Unknown field “${fieldId}”.`);
			const old = clone(f);
			const next = this.retypedField(old, newType, list);
			Object.assign(f, next);
			if (!next.config) delete f.config;
			if (!next.width) delete f.width;
			const now = Date.now();
			for (const e of list) {
				const v = e.values[fieldId];
				if (this.fieldTypes.isEmpty(old, v)) continue;
				const values = touch.valuesFor(e);
				const res = logic.computed ? ({ ok: false } as const) : logic.coerce(this.portable(old, v), f);
				if (res.ok && !logic.isEmpty(res.value)) {
					values[fieldId] = res.value;
					converted++;
				} else {
					delete values[fieldId];
					addOrphan(values, fieldId, { value: v, label: old.label, type: old.type, reason: 'type-change', at: now, text: this.fieldTypes.toText(old, v), portable: this.portable(old, v) });
					orphaned++;
				}
			}
		});
		return { converted, orphaned };
	}

	/** The field definition after a kind change (config adapted to the new kind). */
	private retypedField(old: FieldDefinition, newType: string, list: EntityRecord[]): FieldDefinition {
		const next: FieldDefinition = { ...clone(old), type: newType };
		const toChoice = newType === 'select' || newType === 'multiselect';
		const fromChoice = old.type === 'select' || old.type === 'multiselect';
		const config: Record<string, unknown> = {};
		if (toChoice) {
			const options: SelectOption[] = fromChoice ? clone(selectOptions(old)) : [];
			if (!fromChoice) {
				// Build choices from the distinct existing values.
				const seen = new Set<string>();
				for (const e of list) {
					const raw = this.portable(old, e.values[old.id]);
					for (const s of Array.isArray(raw) ? raw : [raw]) {
						if (typeof s !== 'string' && typeof s !== 'number') continue;
						const label = String(s).trim();
						if (!label || seen.has(label.toLowerCase()) || options.length >= 60) continue;
						seen.add(label.toLowerCase());
						options.push({ id: slugId(label, options.map((o) => o.id)), label });
					}
				}
			}
			config.options = options;
		}
		if (newType === 'number' && old.type === 'number') Object.assign(config, old.config);
		if (newType === 'rating') config.max = typeof old.config?.max === 'number' ? old.config.max : 5;
		if (Object.keys(config).length) next.config = config;
		else delete next.config;
		const logic = this.fieldTypes.get(newType);
		if (logic?.defaultWidth) next.width = logic.defaultWidth;
		delete next.defaultValue;
		return next;
	}

	/** Value in a form other kinds understand (choice ids → labels). */
	private portable(field: FieldDefinition, v: unknown): unknown {
		if (field.type === 'select' && typeof v === 'string') return this.fieldTypes.toText(field, v) || v;
		if (field.type === 'multiselect' && Array.isArray(v)) {
			const opts = selectOptions(field);
			return (v as unknown[]).map((id) => opts.find((o) => o.id === id)?.label ?? String(id));
		}
		return v;
	}

	/** Remove a field. Values move to each entry's unused data (restorable). */
	deleteField(typeId: string, fieldId: string): { orphaned: number } {
		let orphaned = 0;
		const list = this.entitiesOf(typeId);
		const field = this.require(typeId).fields.find((f) => f.id === fieldId);
		this.edit(typeId, `Delete field “${field?.label ?? fieldId}”`, (d, touch) => {
			const f = d.fields.find((x) => x.id === fieldId);
			if (!f) throw new Error(`Unknown field “${fieldId}”.`);
			const sectionId = d.sections.find((s) => s.fieldIds.includes(fieldId))?.id ?? null;
			d.fields = d.fields.filter((x) => x.id !== fieldId);
			for (const s of d.sections) s.fieldIds = s.fieldIds.filter((x) => x !== fieldId);
			d.display.subtitleFields = d.display.subtitleFields.filter((x) => x !== fieldId);
			d.display.cardFields = d.display.cardFields.filter((x) => x !== fieldId);
			const now = Date.now();
			for (const e of list) {
				const v = e.values[fieldId];
				if (v === undefined) continue;
				const values = touch.valuesFor(e);
				delete values[fieldId];
				if (!this.fieldTypes.isEmpty(f, v)) {
					addOrphan(values, fieldId, { value: v, label: f.label, type: f.type, reason: 'deleted', at: now, text: this.fieldTypes.toText(f, v), portable: this.portable(f, v), field: clone(f), sectionId });
					orphaned++;
				}
			}
		});
		return { orphaned };
	}

	/** Place a field in a section (null = unsectioned) at an index. */
	moveField(typeId: string, fieldId: string, toSectionId: string | null, index?: number): EntitySchema {
		return this.edit(typeId, 'Move field', (d) => {
			if (!d.fields.some((f) => f.id === fieldId)) throw new Error(`Unknown field “${fieldId}”.`);
			for (const s of d.sections) s.fieldIds = s.fieldIds.filter((x) => x !== fieldId);
			if (toSectionId) {
				const s = d.sections.find((x) => x.id === toSectionId);
				if (!s) throw new Error(`Unknown section “${toSectionId}”.`);
				const idx = index ?? s.fieldIds.length;
				s.fieldIds.splice(Math.max(0, Math.min(idx, s.fieldIds.length)), 0, fieldId);
			} else {
				// Unsectioned fields keep their order in `fields`; move within that list.
				const at = d.fields.findIndex((f) => f.id === fieldId);
				const [f] = d.fields.splice(at, 1);
				const unsectioned = d.fields.filter((x) => !d.sections.some((s) => s.fieldIds.includes(x.id)));
				const anchor = index !== undefined ? unsectioned[index] : undefined;
				const insertAt = anchor ? d.fields.indexOf(anchor) : d.fields.length;
				if (f) d.fields.splice(insertAt, 0, f);
			}
		});
	}

	// ── choices (select / multiselect) ────────────────────────────────────────

	setOptions(typeId: string, fieldId: string, options: SelectOption[]): EntitySchema {
		return this.edit(typeId, 'Edit choices', (d) => {
			const f = d.fields.find((x) => x.id === fieldId);
			if (!f) throw new Error(`Unknown field “${fieldId}”.`);
			f.config = { ...(f.config ?? {}), options: clone(options) };
		});
	}

	newOption(typeId: string, fieldId: string, label: string): SelectOption {
		const f = this.require(typeId).fields.find((x) => x.id === fieldId);
		const taken = f ? selectOptions(f).map((o) => o.id) : [];
		return { id: slugId(label || 'choice', taken), label };
	}

	/** Entries currently using a choice. */
	optionUsage(typeId: string, fieldId: string, optionId: string): number {
		let n = 0;
		for (const e of this.entitiesOf(typeId)) {
			const v = e.values[fieldId];
			if (v === optionId || (Array.isArray(v) && v.includes(optionId))) n++;
		}
		return n;
	}

	/** Remove a choice; entries using it switch to `replaceWith` (or lose that value). */
	deleteOption(typeId: string, fieldId: string, optionId: string, replaceWith: string | null): EntitySchema {
		const list = this.entitiesOf(typeId);
		return this.edit(typeId, 'Delete choice', (d, touch) => {
			const f = d.fields.find((x) => x.id === fieldId);
			if (!f) throw new Error(`Unknown field “${fieldId}”.`);
			f.config = { ...(f.config ?? {}), options: selectOptions(f).filter((o) => o.id !== optionId) };
			for (const e of list) {
				const v = e.values[fieldId];
				if (v === optionId) {
					const values = touch.valuesFor(e);
					if (replaceWith) values[fieldId] = replaceWith;
					else delete values[fieldId];
				} else if (Array.isArray(v) && v.includes(optionId)) {
					const values = touch.valuesFor(e);
					const next = v.filter((x) => x !== optionId);
					if (replaceWith && !next.includes(replaceWith)) next.push(replaceWith);
					if (next.length) values[fieldId] = next;
					else delete values[fieldId];
				}
			}
		});
	}

	// ── sections ──────────────────────────────────────────────────────────────

	addSection(typeId: string, label: string, index?: number): SectionDefinition {
		let created!: SectionDefinition;
		this.edit(typeId, `Add section “${label}”`, (d) => {
			created = { id: slugId(label || 'section', d.sections.map((s) => s.id)), label: label.trim() || 'New section', icon: 'folder', fieldIds: [] };
			const idx = index ?? d.sections.length;
			d.sections.splice(Math.max(0, Math.min(idx, d.sections.length)), 0, created);
		});
		return created;
	}

	updateSection(typeId: string, sectionId: string, patch: SectionPatch): EntitySchema {
		return this.edit(typeId, 'Edit section', (d) => {
			const s = d.sections.find((x) => x.id === sectionId);
			if (!s) throw new Error(`Unknown section “${sectionId}”.`);
			for (const [k, v] of Object.entries(patch) as Array<[keyof SectionPatch, unknown]>) {
				if (v === undefined || v === null || v === false || v === '') delete (s as unknown as Record<string, unknown>)[k];
				else (s as unknown as Record<string, unknown>)[k] = k === 'label' && typeof v === 'string' ? v.trim() : v;
			}
		});
	}

	/** Delete a section; its fields move to another section or become unsectioned. */
	deleteSection(typeId: string, sectionId: string, moveFieldsTo: string | null = null): EntitySchema {
		return this.edit(typeId, 'Delete section', (d) => {
			const s = d.sections.find((x) => x.id === sectionId);
			if (!s) throw new Error(`Unknown section “${sectionId}”.`);
			d.sections = d.sections.filter((x) => x.id !== sectionId);
			if (moveFieldsTo) {
				const target = d.sections.find((x) => x.id === moveFieldsTo);
				if (!target) throw new Error(`Unknown section “${moveFieldsTo}”.`);
				target.fieldIds.push(...s.fieldIds);
			}
		});
	}

	moveSection(typeId: string, sectionId: string, index: number): EntitySchema {
		return this.edit(typeId, 'Reorder sections', (d) => {
			const at = d.sections.findIndex((x) => x.id === sectionId);
			if (at < 0) throw new Error(`Unknown section “${sectionId}”.`);
			const [s] = d.sections.splice(at, 1);
			if (s) d.sections.splice(Math.max(0, Math.min(index, d.sections.length)), 0, s);
		});
	}

	// ── unused data on entries ────────────────────────────────────────────────

	/** Try to put an orphaned value back into the (current) field with the same id. */
	restoreOrphan(entityId: string, key: string): { ok: boolean; reason?: string } {
		const e = this.entities.get(entityId);
		if (!e) return { ok: false, reason: 'Entry not found.' };
		const orphan = orphansOf(e.values)[key];
		if (!orphan) return { ok: false, reason: 'Nothing to restore.' };
		const fieldId = orphanFieldId(key);
		const field = this.schemas.get(e.typeId)?.fields.find((f) => f.id === fieldId);
		if (!field) return { ok: false, reason: `There is no “${orphan.label}” field any more. Re-add it in Type Studio, or discard this value.` };
		const logic = this.fieldTypes.for(field);
		// Same kind as when orphaned → original value; otherwise the kind-neutral copy.
		const input = orphan.type === field.type ? orphan.value : (orphan.portable ?? orphan.value);
		const res = logic.coerce(input, field);
		if (!res.ok || logic.isEmpty(res.value)) return { ok: false, reason: `This value can’t be stored in a ${logic.label.toLowerCase()} field.` };
		if (!logic.isEmpty(e.values[fieldId])) return { ok: false, reason: `“${field.label}” already has a value. Clear it first to restore the old one.` };
		const values = clone(e.values);
		values[fieldId] = res.value;
		removeOrphan(values, key);
		this.replaceValues(entityId, values);
		return { ok: true };
	}

	/**
	 * Bring back a deleted field from one of its orphaned values: re-create the field
	 * (same id, settings and section as before when known) and restore every entry's
	 * orphaned value for it. One undo step.
	 */
	recreateField(entityId: string, key: string): { field: FieldDefinition; restored: number } {
		const e = this.entities.get(entityId);
		if (!e) throw new Error('Entry not found.');
		const orphan = orphansOf(e.values)[key];
		if (!orphan) throw new Error('Nothing to restore.');
		const fieldId = orphanFieldId(key);
		const typeId = e.typeId;
		if (this.require(typeId).fields.some((f) => f.id === fieldId)) throw new Error(`“${orphan.label}” already exists.`);
		let created!: FieldDefinition;
		let restored = 0;
		this.edit(typeId, `Restore field “${orphan.label}”`, (d, touch) => {
			const kind = this.fieldTypes.get(orphan.field?.type ?? orphan.type) ? (orphan.field?.type ?? orphan.type) : 'text';
			created = orphan.field && orphan.field.id === fieldId ? clone(orphan.field) : { id: fieldId, type: kind, label: orphan.label };
			created.type = kind;
			d.fields.push(created);
			const home = (orphan.sectionId && d.sections.find((s) => s.id === orphan.sectionId)) || (orphan.sectionId === null ? undefined : d.sections[0]);
			home?.fieldIds.push(fieldId);
			const logic = this.fieldTypes.for(created);
			for (const other of this.entitiesOf(typeId)) {
				const bag = orphansOf(other.values);
				// Newest orphan of this field wins; older copies stay as unused data.
				const keys = Object.keys(bag)
					.filter((k) => orphanFieldId(k) === fieldId)
					.sort((a, b) => (bag[b]?.at ?? 0) - (bag[a]?.at ?? 0));
				for (const k of keys) {
					const o = bag[k] as OrphanedValue;
					const res = logic.coerce(o.type === created.type ? o.value : (o.portable ?? o.value), created);
					if (!res.ok || logic.isEmpty(res.value)) continue;
					const values = touch.valuesFor(other);
					if (!logic.isEmpty(values[fieldId])) break;
					values[fieldId] = res.value;
					removeOrphan(values, k);
					restored++;
					break;
				}
			}
		});
		return { field: created, restored };
	}

	/** Remove an orphaned value. Returns it so the caller can offer an undo (`putOrphan`). */
	discardOrphan(entityId: string, key: string): OrphanedValue | null {
		const e = this.entities.get(entityId);
		if (!e) return null;
		const o = orphansOf(e.values)[key] ?? null;
		const values = clone(e.values);
		removeOrphan(values, key);
		this.replaceValues(entityId, values);
		return o;
	}

	/** Put a discarded orphan back (undo of `discardOrphan`). */
	putOrphan(entityId: string, key: string, orphan: OrphanedValue): void {
		const e = this.entities.get(entityId);
		if (!e) return;
		const values = clone(e.values);
		values[ORPHAN_KEY] = { ...orphansOf(values), [key]: clone(orphan) };
		this.replaceValues(entityId, values);
	}
}

/** Collects entity value rewrites made during an edit, applied only after validation. */
class EntityTouch {
	readonly changes = new Map<string, Record<string, unknown>>();
	valuesFor(e: EntityRecord): Record<string, unknown> {
		let v = this.changes.get(e.id);
		if (!v) {
			v = clone(e.values);
			this.changes.set(e.id, v);
		}
		return v;
	}
}

function addOrphan(values: Record<string, unknown>, fieldId: string, o: OrphanedValue): void {
	const bag = { ...orphansOf(values) };
	// Don't overwrite an older orphan of the same field: keep it under a suffixed key.
	let key = fieldId;
	let n = 2;
	while (bag[key]) key = `${fieldId}~${n++}`;
	bag[key] = o;
	values[ORPHAN_KEY] = bag;
}

function removeOrphan(values: Record<string, unknown>, key: string): void {
	const bag = { ...orphansOf(values) };
	delete bag[key];
	if (Object.keys(bag).length) values[ORPHAN_KEY] = bag;
	else delete values[ORPHAN_KEY];
}
