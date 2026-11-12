import type { EntityId, StatusId, TypeId, WorldId } from './ids';
import type { EntityMedia } from './media';
import type { NativeNote } from './nativeNote';

export interface EntityFlags {
	favorite?: boolean;
	pinned?: boolean;
	hidden?: boolean;
}

export interface LinkedNote {
	path: string;
}

/** Another note linked to an entry (0.10), with an optional label. */
export interface ExtraNote {
	path: string;
	label?: string;
}

/**
 * The common record every Worldsmith object derives from. Type-specific data lives in
 * `values`, keyed by FieldDefinition.id. Core properties exist on every entity because
 * blocks, search and dashboards rely on them regardless of type.
 */
export interface EntityRecord {
	v: number;
	id: EntityId;
	worldId: WorldId;
	typeId: TypeId;
	name: string;
	aliases: string[];
	tags: string[];
	description: string;
	status: StatusId;
	values: Record<string, unknown>;
	media: EntityMedia;
	parentId: EntityId | null;
	sortOrder: number;
	flags: EntityFlags;
	/** The main note (opened by the note button). */
	linkedNote: LinkedNote | null;
	/** More notes linked to the entry, in order (0.10). */
	moreNotes: ExtraNote[];
	/** The entry's native note (0.17). Absent = everything lives in Worldsmith, as before. */
	nativeNote?: NativeNote | null;
	createdAt: number;
	updatedAt: number;
	rev: number;
	archivedAt: number | null;
	trashedAt: number | null;
}

/** Keys of EntityRecord that may be patched directly (identity/bookkeeping excluded). */
export type EntityCoreKey =
	| 'name'
	| 'aliases'
	| 'tags'
	| 'description'
	| 'status'
	| 'media'
	| 'parentId'
	| 'sortOrder'
	| 'flags'
	| 'linkedNote'
	| 'moreNotes'
	| 'nativeNote'
	| 'archivedAt'
	| 'trashedAt'
	| 'typeId';

export type EntityPatch = Partial<Pick<EntityRecord, EntityCoreKey>> & {
	/** Field values to set (merged into `values`). `undefined` deletes the key. */
	values?: Record<string, unknown>;
};

/** Describes what changed in an update, for fine-grained UI patching. */
export interface EntityChange {
	id: EntityId;
	/** Changed core keys and changed field ids as `values.<fieldId>`. */
	keys: string[];
}
