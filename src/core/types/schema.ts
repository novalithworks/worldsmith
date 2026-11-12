import type { FieldId, SemanticColor, TypeId } from './ids';
import type { FieldDefinition, SectionDefinition } from './field';
import type { TaskTemplate } from './task';
import type { LayoutTemplate } from './layout';

export interface SchemaDisplay {
	/** Fields joined with " • " under the entity name ("Protagonist • Human"). */
	subtitleFields: FieldId[];
	/** Fields shown on database cards. */
	cardFields: FieldId[];
}

export interface SchemaHierarchy {
	allowParent: boolean;
	/** Empty = any type may be a parent. */
	parentTypes: TypeId[];
	/** Types suggested when creating a child. Empty = any. */
	childTypes: TypeId[];
}

/**
 * An entity type. Built-in types are seeded into each world as EntitySchema data, so
 * custom and built-in types are indistinguishable at runtime.
 */
export interface EntitySchema {
	v: number;
	id: TypeId;
	singular: string;
	plural: string;
	icon: string;
	description: string;
	color?: SemanticColor | null;
	/** Default sidebar group id. */
	group: string;
	fields: FieldDefinition[];
	sections: SectionDefinition[];
	display: SchemaDisplay;
	hierarchy: SchemaHierarchy;
	defaultTasks: TaskTemplate[];
	defaultLayout: LayoutTemplate | null;
	/** Where a seeded schema came from; null for user-created types. */
	origin: { templateId: string; templateVersion: number } | null;
	archived?: boolean;
	createdAt: number;
	updatedAt: number;
	rev: number;
}

/**
 * A schema as authored in code (built-ins, extensions). Persistence metadata is added when
 * the template is installed into a world.
 */
export interface EntityTypeTemplate
	extends Omit<EntitySchema, 'v' | 'origin' | 'createdAt' | 'updatedAt' | 'rev' | 'archived'> {
	/** Bump when the template meaningfully changes (enables update offers). */
	templateVersion: number;
	/** Sort order among built-ins. */
	order?: number;
}
