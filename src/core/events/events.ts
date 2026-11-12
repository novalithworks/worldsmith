import type { EntityChange, EntityRecord } from '../types/entity';
import type { EntitySchema } from '../types/schema';
import type { RelationEdge, RelationType } from '../types/relation';
import type { DevTask } from '../types/task';
import type { World } from '../types/world';
import type { LayoutDoc, LayoutPresetDoc } from '../types/layout';
import type { Calendar } from '../types/calendar';
import type { NoteTemplate } from '../types/nativeNote';

export type VisualKind = 'tree' | 'graph' | 'map';
import type { DatabaseView } from '../types/view';

export type WritingChangeReason = 'project' | 'structure' | 'details' | 'trash' | 'notes';

export type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

/**
 * Every event Worldsmith emits. UI and indexes subscribe; repositories and services emit.
 * Add new events here so payloads stay typed end to end.
 */
export interface WorldsmithEvents extends Record<string, unknown> {
	'world:loaded': { world: World };
	/** The getting-started guide was switched on or off for a world (0.21). */
	'guide:changed': { worldId: string; on: boolean };
	'world:unloaded': { worldId: string };
	'world:updated': { world: World; keys: string[] };

	'entity:created': { entity: EntityRecord };
	'entity:updated': { entity: EntityRecord; change: EntityChange };
	/** Permanently removed (not trashed — trashing is an update of `trashedAt`). */
	'entity:deleted': { entity: EntityRecord };

	'schema:created': { schema: EntitySchema };
	'schema:updated': { schema: EntitySchema };
	'schema:deleted': { schema: EntitySchema };

	/** Connections. `keys` lists changed edge properties (`status`, `props.trust`, `from`…). */
	'edge:created': { edge: RelationEdge };
	'edge:updated': { edge: RelationEdge; prev: RelationEdge; keys: string[] };
	'edge:deleted': { edge: RelationEdge };

	'relationType:created': { type: RelationType };
	'relationType:updated': { type: RelationType };
	'relationType:deleted': { type: RelationType };

	'task:created': { task: DevTask };
	'task:updated': { task: DevTask; prev: DevTask; keys: string[] };
	'task:deleted': { task: DevTask };

	/** A page layout was saved or removed (type layouts and per-entry layouts). */
	'layout:saved': { layout: LayoutDoc };
	'layout:deleted': { layout: LayoutDoc };
	'view:saved': { view: DatabaseView };
	'view:deleted': { view: DatabaseView };
	/** Layout presets people made (0.10). */
	'preset:saved': { preset: LayoutPresetDoc };
	'preset:deleted': { preset: LayoutPresetDoc };
	/** Fictional calendars (0.10). */
	'calendar:saved': { calendar: Calendar };
	'calendar:deleted': { calendar: Calendar };
	/** Family trees, relationship graphs and maps (0.11). */
	'doc:saved': { kind: VisualKind; id: string };
	'doc:deleted': { kind: VisualKind; id: string };

	/**
	 * Writing Studio (WS2): a project, its structure, a scene's details or the notes behind
	 * scenes changed. `ids` are the items (or the project) touched.
	 */
	'writing:changed': { projectId: string; ids: string[]; reason: WritingChangeReason };
	/** Word counts of these scenes changed (counted from their notes). */
	'writing:words': { projectId: string; sceneIds: string[] };

	/**
	 * Native note templates (0.17). `structural` = sections changed, so notes using it are
	 * rewritten (Worldsmith's parts only); appearance-only changes touch no note.
	 */
	'note-template:saved': { template: NoteTemplate; structural: boolean };
	'note-template:deleted': { template: NoteTemplate };
	/** A native note's sync state changed (status, conflicts). */
	'native-note:status': { entityId: string };

	'save:state': { state: SaveState; error?: unknown };

	'settings:changed': { keys: string[] };
}
