import { RECORD_VERSIONS } from '../app/constants';
import type { EntityPatch, EntityRecord, EntitySchema, FieldDefinition, ValidationIssue, World } from '../core/types';
import { clone } from '../core/util/clone';
import { uuid } from '../core/util/ids';
import type { EntityIndex } from '../data/indexes/EntityIndex';
import type { EntityRepository } from '../data/repositories/EntityRepository';
import type { FieldTypeRegistry } from '../fields/FieldTypeRegistry';
import type { SchemaService } from './SchemaService';
import type { FieldValues } from './FieldValues';

/** Collaborators owned by other services, wired by WorldSession. */
export interface EntityServiceHooks {
	values?: FieldValues;
	/** Connections touching an entry (delete warnings). */
	connections?(id: string): number;
	afterDuplicate?(source: EntityRecord, copy: EntityRecord): void;
	afterCreate?(entity: EntityRecord): void;
	/** done/total development tasks of an entry. */
	taskStats?(id: string, includeOptional: boolean): { done: number; total: number };
	/** Tasks touching an entry (delete warnings). */
	taskCount?(id: string): number;
}

/** How developed an entry is: key fields, tasks, and the combined ratio the world uses. */
export interface Progress {
	ratio: number;
	fields: { done: number; total: number };
	tasks: { done: number; total: number };
	mode: 'tasks' | 'fields' | 'blend';
}

export interface SetFieldResult {
	ok: boolean;
	/** Type mismatch that prevented saving. */
	error?: string;
	/** Saved, but outside a declared constraint (e.g. above max). */
	warning?: string;
}

export interface DeleteImpact {
	children: number;
	hasLinkedNote: boolean;
	/** Filled in by later milestones (relations, tasks). */
	relations: number;
	tasks: number;
}

export interface Completeness {
	done: number;
	total: number;
	ratio: number;
}

/**
 * Entity business rules: creation with schema defaults, validated field writes,
 * lifecycle (favorite, archive, trash, delete) and derived information.
 */
export class EntityService {
	constructor(
		private readonly repo: EntityRepository,
		private readonly index: EntityIndex,
		private readonly schemas: SchemaService,
		private readonly fieldTypes: FieldTypeRegistry,
		private readonly getWorld: () => World,
		private readonly hooks: EntityServiceHooks = {},
	) {}

	/** Value of a field, derived for relations/rollups. */
	private valueOf(entity: EntityRecord, field: FieldDefinition): unknown {
		return this.hooks.values ? this.hooks.values.get(entity, field) : entity.values[field.id];
	}

	get(id: string): EntityRecord | undefined {
		return this.repo.get(id);
	}

	schemaOf(entity: EntityRecord): EntitySchema | undefined {
		return this.schemas.get(entity.typeId);
	}

	create(typeId: string, init: { name?: string; parentId?: string | null; values?: Record<string, unknown> } = {}): EntityRecord {
		const schema = this.schemas.get(typeId);
		if (!schema) throw new Error(`[Worldsmith] unknown type ${typeId}`);
		const world = this.getWorld();
		const now = Date.now();

		const values: Record<string, unknown> = {};
		for (const field of schema.fields) {
			if (field.defaultValue !== undefined && field.defaultValue !== null) values[field.id] = clone(field.defaultValue);
		}
		Object.assign(values, init.values);

		const record: EntityRecord = {
			v: RECORD_VERSIONS.entity,
			id: uuid(),
			worldId: world.id,
			typeId,
			name: init.name?.trim() || `Untitled ${schema.singular.toLowerCase()}`,
			aliases: [],
			tags: [],
			description: '',
			status: world.defaultStatus,
			values,
			media: { icon: null, portrait: null, banner: null, symbol: null, gallery: [] },
			parentId: init.parentId ?? null,
			sortOrder: now,
			flags: {},
			linkedNote: null,
			moreNotes: [],
			createdAt: now,
			updatedAt: now,
			rev: 0,
			archivedAt: null,
			trashedAt: null,
		};
		const inserted = this.repo.insert(record);
		this.hooks.afterCreate?.(inserted);
		return inserted;
	}

	update(id: string, patch: EntityPatch): EntityRecord | null {
		if (patch.name !== undefined) {
			const name = patch.name.trim();
			patch = { ...patch, name: name || 'Untitled' };
		}
		return this.repo.update(id, patch);
	}

	/**
	 * Write a field value. Values are coerced through the field type; a value that cannot
	 * be coerced is rejected (the editor keeps showing it) rather than stored corrupted.
	 */
	setFieldValue(id: string, fieldId: string, value: unknown): SetFieldResult {
		const entity = this.repo.get(id);
		if (!entity) return { ok: false, error: 'Entity not found' };
		const field = this.schemas.get(entity.typeId)?.fields.find((f) => f.id === fieldId);
		if (!field) {
			// Unknown field (e.g. schema edited elsewhere): store as-is rather than lose input.
			this.repo.update(id, { values: { [fieldId]: value } });
			return { ok: true };
		}
		const type = this.fieldTypes.for(field);
		if (type.computed) return { ok: false, error: 'This field is computed' };

		if (type.isEmpty(value)) {
			this.repo.update(id, { values: { [fieldId]: undefined } });
			return { ok: true };
		}
		const coerced = type.coerce(value, field);
		if (!coerced.ok) return { ok: false, error: `Not a valid ${type.label.toLowerCase()}` };
		const warning = type.validate(coerced.value, field) ?? undefined;
		this.repo.update(id, { values: { [fieldId]: coerced.value } });
		return { ok: true, warning };
	}

	fieldValue(entity: EntityRecord, field: FieldDefinition): unknown {
		return this.valueOf(entity, field);
	}

	toggleFavorite(id: string): void {
		const e = this.repo.get(id);
		if (e) this.repo.update(id, { flags: { ...e.flags, favorite: !e.flags.favorite } });
	}

	togglePinned(id: string): void {
		const e = this.repo.get(id);
		if (e) this.repo.update(id, { flags: { ...e.flags, pinned: !e.flags.pinned } });
	}

	setArchived(id: string, archived: boolean): void {
		this.repo.update(id, { archivedAt: archived ? Date.now() : null });
	}

	/** Soft delete — recoverable from the trash. */
	trash(id: string): void {
		this.repo.update(id, { trashedAt: Date.now() });
	}

	restore(id: string): void {
		this.repo.update(id, { trashedAt: null });
	}

	/**
	 * Permanently delete. Children are re-parented to the deleted entity's parent so a
	 * hierarchy never points at a missing record. (Milestones 3/4 also clean edges/tasks.)
	 */
	deletePermanently(id: string): void {
		const e = this.repo.get(id);
		if (!e) return;
		for (const child of this.index.childrenOf(id)) {
			this.repo.update(child.id, { parentId: e.parentId });
		}
		this.repo.remove(id);
	}

	emptyTrash(): number {
		const items = this.index.trashedEntities();
		for (const e of items) this.deletePermanently(e.id);
		return items.length;
	}

	duplicate(id: string): EntityRecord | null {
		const src = this.repo.get(id);
		if (!src) return null;
		const now = Date.now();
		const copy: EntityRecord = {
			...clone(src),
			id: uuid(),
			name: `${src.name} (copy)`,
			linkedNote: null,
			moreNotes: [],
			flags: {},
			createdAt: now,
			updatedAt: now,
			rev: 0,
			trashedAt: null,
			archivedAt: null,
		};
		// A copy never shares the original's native note.
		delete copy.nativeNote;
		const inserted = this.repo.insert(copy);
		this.hooks.afterDuplicate?.(src, inserted);
		return inserted;
	}

	deleteImpact(id: string): DeleteImpact {
		const e = this.repo.get(id);
		return {
			children: this.index.childrenOf(id).length,
			hasLinkedNote: !!e?.linkedNote || !!e?.moreNotes.length,
			relations: this.hooks.connections?.(id) ?? 0,
			tasks: this.hooks.taskCount?.(id) ?? 0,
		};
	}

	validate(entity: EntityRecord): ValidationIssue[] {
		const schema = this.schemas.get(entity.typeId);
		if (!schema) return [];
		const issues: ValidationIssue[] = [];
		for (const field of schema.fields) {
			const type = this.fieldTypes.for(field);
			if (type.computed && type.category !== 'relation') continue;
			const value = this.valueOf(entity, field);
			if (type.isEmpty(value)) {
				if (field.required) issues.push({ fieldId: field.id, severity: 'error', message: `${field.label} is required` });
				continue;
			}
			const msg = type.validate(value, field);
			if (msg) issues.push({ fieldId: field.id, severity: 'warning', message: msg });
		}
		return issues;
	}

	/**
	 * Field-based completeness over required + recommended fields. Task-based progress
	 * joins this in Milestone 4 (world.progress.mode decides how they combine).
	 */
	completeness(entity: EntityRecord): Completeness {
		const schema = this.schemas.get(entity.typeId);
		if (!schema) return { done: 0, total: 0, ratio: 0 };
		let done = 0;
		let total = 0;
		for (const field of schema.fields) {
			if (!field.required && !field.recommended) continue;
			const type = this.fieldTypes.for(field);
			// Links count (a recommended "Species" is filled once linked); other computed kinds don't.
			if (type.computed && type.category !== 'relation') continue;
			total++;
			if (!type.isEmpty(this.valueOf(entity, field))) done++;
		}
		// Every entity benefits from a description and an image.
		total += 2;
		if (entity.description.trim()) done++;
		if (entity.media.portrait || entity.media.banner) done++;
		return { done, total, ratio: total ? done / total : 0 };
	}

	/**
	 * Development progress. world.progress.mode decides what counts: key fields, tasks, or
	 * both (the mean). An entry without tasks falls back to its fields.
	 */
	progress(entity: EntityRecord): Progress {
		const world = this.getWorld();
		const f = this.completeness(entity);
		const tasks = this.hooks.taskStats?.(entity.id, world.progress.includeOptional) ?? { done: 0, total: 0 };
		const fr = f.total ? f.done / f.total : 0;
		const tr = tasks.total ? tasks.done / tasks.total : 0;
		const mode = world.progress.mode;
		let ratio: number;
		if (mode === 'fields' || !tasks.total) ratio = fr;
		else if (mode === 'tasks') ratio = tr;
		else ratio = (fr + tr) / 2;
		return { ratio, fields: { done: f.done, total: f.total }, tasks, mode };
	}

	/** "Protagonist • Human" — values of the schema's subtitle fields. */
	subtitle(entity: EntityRecord): string {
		const schema = this.schemas.get(entity.typeId);
		if (!schema) return '';
		const parts: string[] = [];
		for (const id of schema.display.subtitleFields) {
			const field = schema.fields.find((f) => f.id === id);
			if (!field) continue;
			const text = this.fieldTypes.toText(field, this.valueOf(entity, field));
			if (text) parts.push(text);
		}
		return parts.join(' • ');
	}
}
