import type { EdgeId, EntityId, RelationTypeId, SemanticColor, TypeId } from './ids';
import type { ChronoDate } from './chrono';
import type { FieldDefinition } from './field';

/**
 * A kind of connection between entries ("Mentorship", "Membership"…). Stored per world
 * and seeded from templates, exactly like entity types.
 *
 * Labels are headings for the *other* side, as seen from each end:
 *   edge Auron → Kael of type Mentorship
 *   on Auron's page:  forwardLabel  "Students"  → Kael
 *   on Kael's page:   reverseLabel  "Mentors"   → Auron
 * Symmetric types (friendship, alliance…) read the same from both ends and use
 * `forwardLabel` on both.
 */
export interface RelationType {
	v: number;
	id: RelationTypeId;
	/** Name of the relationship itself, e.g. "Mentorship". */
	label: string;
	forwardLabel: string;
	reverseLabel: string;
	symmetric: boolean;
	category: string;
	description?: string;
	icon?: string;
	color?: SemanticColor | null;
	/** Hints for pickers; empty = any type. Never enforced on existing data. */
	sourceTypes: TypeId[];
	targetTypes: TypeId[];
	/** Custom properties of each connection of this kind (trust, oath…). */
	fields: FieldDefinition[];
	origin: { templateId: string; templateVersion: number } | null;
	createdAt: number;
	updatedAt: number;
	rev: number;
}

/** What extensions and built-ins register; seeded into worlds as RelationType data. */
export type RelationTypeTemplate = Omit<RelationType, 'v' | 'origin' | 'createdAt' | 'updatedAt' | 'rev'> & {
	templateVersion?: number;
};

export type EdgeStatus = 'active' | 'ended' | 'strained' | 'unknown';

/**
 * One directed connection. Relation fields on both ends read the same edge, so a
 * connection can never be "half there".
 */
export interface RelationEdge {
	v: number;
	id: EdgeId;
	type: RelationTypeId;
	from: EntityId;
	to: EntityId;
	status: EdgeStatus | null;
	/** 1–5, null = unset. */
	strength: number | null;
	secret: boolean;
	start: ChronoDate | null;
	end: ChronoDate | null;
	/** One-line summary shown on chips and in Connections. */
	description: string;
	/** Long-form Markdown notes on the relationship record. */
	notes: string;
	/** Values for the relation type's custom fields. Never pruned. */
	props: Record<string, unknown>;
	order: number;
	createdAt: number;
	updatedAt: number;
	rev: number;
}

/** Fields of an edge the UI may patch. */
export type EdgePatch = Partial<Pick<RelationEdge, 'status' | 'strength' | 'secret' | 'start' | 'end' | 'description' | 'notes' | 'order'>> & {
	props?: Record<string, unknown>;
};

/** Config of a `relation` field. */
export interface RelationFieldConfig {
	relationType: RelationTypeId | null;
	/** forward: this entry is the edge's `from`; reverse: it's the `to`. Ignored for symmetric types. */
	direction: 'forward' | 'reverse';
	/** Types the field links to; empty = any. */
	targetTypes: TypeId[];
	/** 1 = single link; null = unlimited. */
	max: number | null;
}

export type RollupAggregate = 'count' | 'list' | 'unique' | 'sum' | 'avg' | 'min' | 'max' | 'earliest' | 'latest' | 'filled';

/** Config of a `rollup` field. */
export interface RollupFieldConfig {
	/** Relation field on the same type to roll up over. */
	relationField: string | null;
	/** Field on the linked entries; '__name' for their names; null for count. */
	targetField: string | null;
	aggregate: RollupAggregate;
}

/** A linked entry as relation fields present it. */
export interface LinkedEntry {
	edgeId: EdgeId;
	id: EntityId;
	name: string;
}
