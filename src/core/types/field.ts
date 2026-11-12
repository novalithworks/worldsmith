import type { FieldId, FieldTypeId, SectionId, SemanticColor } from './ids';

/** A field as declared in a schema. Pure data — behaviour comes from the FieldTypeRegistry. */
export interface FieldDefinition {
	id: FieldId;
	type: FieldTypeId;
	label: string;
	description?: string;
	icon?: string;
	required?: boolean;
	/** Counts toward field-based completeness without being required. */
	recommended?: boolean;
	defaultValue?: unknown;
	placeholder?: string;
	hidden?: boolean;
	/** Progressive disclosure: shown under the section's "More fields". */
	advanced?: boolean;
	width?: FieldWidth;
	/** Display style variant offered by the field type (e.g. 'chips' vs 'list'). */
	display?: string | null;
	/** Type-specific configuration, validated by the field type. */
	config?: Record<string, unknown>;
	/** Property key in native notes (0.17). Absent = the label. Unique per type. */
	noteKey?: string;
}

export type FieldWidth = 'full' | 'half' | 'third';

export interface SectionDefinition {
	id: SectionId;
	label: string;
	icon?: string;
	description?: string;
	fieldIds: FieldId[];
	collapsed?: boolean;
	advanced?: boolean;
}

/** An option of a select / multiselect / status-like field. */
export interface SelectOption {
	id: string;
	label: string;
	color?: SemanticColor;
	icon?: string;
}

export interface ValidationIssue {
	fieldId: FieldId;
	severity: 'error' | 'warning';
	message: string;
}
