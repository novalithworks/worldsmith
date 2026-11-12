import type { MediaService } from '../services/MediaService';
import type { App, PaneType, Plugin } from 'obsidian';
import type { EventBus } from '../core/events/EventBus';
import type { WorldsmithEvents } from '../core/events/events';
import type { Registry } from '../core/registry/Registry';
import type { EntityTypeTemplate } from '../core/types';
import type { Database } from '../data/Database';
import type { FieldTypeRegistry } from '../fields/FieldTypeRegistry';
import type { BlockRegistry } from '../blocks/BlockRegistry';
import type { LinkedNoteService } from '../services/LinkedNoteService';
import type { NativeNoteService } from '../services/notes/NativeNoteService';
import type { NoteMigrationService } from '../services/notes/NoteMigrationService';
import type { WorldService } from '../services/WorldService';
import type { WorldsmithSettings } from '../settings/settings';
import type { Route } from '../state/route';
import type { RouteRegistry } from '../ui/views/routes/RouteRegistry';

export interface OpenOptions {
	/** true / 'tab' = new tab, 'split' = split pane, 'window' = popout, false = reuse a Worldsmith pane. */
	newLeaf?: boolean | PaneType;
}

/**
 * What blocks, pages and actions may use. Implemented by WorldsmithApp. Depending on this
 * interface (not the concrete class) keeps UI modules decoupled from app wiring.
 */
export interface WorldsmithContext {
	readonly app: App;
	readonly plugin: Plugin;
	readonly events: EventBus<WorldsmithEvents>;
	readonly fieldTypes: FieldTypeRegistry;
	readonly blocks: BlockRegistry;
	readonly routes: RouteRegistry;
	readonly templates: Registry<EntityTypeTemplate>;
	readonly worlds: WorldService;
	readonly db: Database;
	readonly linkedNotes: LinkedNoteService;
	readonly nativeNotes: NativeNoteService;
	readonly noteMigrations: NoteMigrationService;
	/** Look of native notes and their CSS snippet (null when the plugin UI isn't loaded). */
	readonly noteStyles: import('../ui/notes/noteStyles').NoteStyles | null;
	readonly media: MediaService;
	readonly archives: import('../services/transfer/worldArchive').WorldArchiveService;
	readonly backups: import('../services/backup/BackupManager').BackupManager;
	readonly worldTrash: import('../services/WorldTrash').WorldTrash;
	readonly snapshots: import('../services/writing/snapshots').SnapshotService;
	readonly features: { isOn(id: import('../core/features').FeatureId): boolean; set(id: import('../core/features').FeatureId, on: boolean): () => void };
	readonly settings: WorldsmithSettings;
	saveSettings(): Promise<void>;
	open(route: Route, opts?: OpenOptions): Promise<void>;
	ensureStarted(): Promise<void>;
}
