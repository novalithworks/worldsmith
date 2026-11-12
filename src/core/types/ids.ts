/**
 * Identifier aliases. They are plain strings at runtime; the aliases document intent
 * and make signatures self-explanatory.
 *
 * - UUIDs (v4): worlds, entities, tasks, edges, layouts, block instances, gallery items.
 * - Slugs: schema/type ids, field ids, section ids, status ids, relation type ids.
 *   Slugs are immutable once created; renaming changes labels only.
 */
export type WorldId = string;
export type EntityId = string;
export type TypeId = string;
export type FieldId = string;
export type SectionId = string;
export type StatusId = string;
export type TaskId = string;
export type EdgeId = string;
export type RelationTypeId = string;
export type LayoutId = string;
export type BlockInstanceId = string;
export type FieldTypeId = string;
export type BlockTypeId = string;

/** Semantic color names, mapped to Obsidian's --color-* variables by CSS. */
export type SemanticColor =
	| 'red'
	| 'orange'
	| 'yellow'
	| 'green'
	| 'cyan'
	| 'blue'
	| 'purple'
	| 'pink'
	| 'gray';

export const SEMANTIC_COLORS: readonly SemanticColor[] = [
	'red',
	'orange',
	'yellow',
	'green',
	'cyan',
	'blue',
	'purple',
	'pink',
	'gray',
];
