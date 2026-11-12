import { isLocked } from './edition';
import { featureOfBlock, featureOn, type FeatureId } from '../core/features';
import { MediaService } from '../services/MediaService';
import { Notice, type App, type Plugin, type WorkspaceLeaf } from 'obsidian';
import { BlockRegistry } from '../blocks/BlockRegistry';
import { BUILTIN_BLOCKS } from '../blocks/builtin';
import { EventBus } from '../core/events/EventBus';
import type { WorldsmithEvents } from '../core/events/events';
import { Registry } from '../core/registry/Registry';
import type { EntityTypeTemplate, RelationTypeTemplate } from '../core/types';
import { DisposableStore } from '../core/util/disposable';
import { Database } from '../data/Database';
import { ObsidianStorageAdapter } from '../data/storage/ObsidianStorageAdapter';
import { BUILTIN_FIELD_TYPES } from '../fields/builtin';
import { FieldTypeRegistry } from '../fields/FieldTypeRegistry';
import { BUILTIN_TYPES } from '../schemas/builtin';
import { BUILTIN_RELATION_TYPES } from '../schemas/relations';
import { LinkedNoteService } from '../services/LinkedNoteService';
import { NativeNoteService } from '../services/notes/NativeNoteService';
import { NoteMigrationService } from '../services/notes/NoteMigrationService';
import { WorldArchiveService } from '../services/transfer/worldArchive';
import { BackupManager } from '../services/backup/BackupManager';
import { WorldTrash } from '../services/WorldTrash';
import { SnapshotService } from '../services/writing/snapshots';
import { WorldService } from '../services/WorldService';
import { obsidianVault } from '../services/writing/obsidianVault';
import type { WorldsmithSettings } from '../settings/settings';
import type { Route } from '../state/route';
import { RouteRegistry } from '../ui/views/routes/RouteRegistry';
import { dashboardRoute } from '../ui/views/routes/dashboardPage';
import { databaseRoute } from '../ui/views/routes/databasePage';
import { entityRoute } from '../ui/views/routes/entityPage';
import { onboardingRoute } from '../ui/views/routes/onboardingPage';
import { searchRoute } from '../ui/views/routes/searchPage';
import { trashRoute } from '../ui/views/routes/trashPage';
import { typeStudioRoute } from '../ui/views/routes/typeStudio/typeStudioPage';
import { relationRoute } from '../ui/views/routes/relationPage';
import { tasksRoute } from '../ui/views/routes/tasksPage';
import { mediaRoute } from '../ui/views/routes/mediaPage';
import { relationshipsRoute } from '../ui/views/routes/relationshipsPage';
import { layoutStudioRoute } from '../ui/views/routes/layoutStudioPage';
import { calendarsRoute } from '../ui/views/routes/calendarsPage';
import { timelineRoute } from '../ui/views/routes/timelinePage';
import { healthRoute } from '../ui/views/routes/healthPage';
import { treesRoute } from '../ui/views/routes/treesPage';
import { graphRoute } from '../ui/views/routes/graphPage';
import { mapsRoute } from '../ui/views/routes/mapsPage';
import { writingRoute } from '../ui/writing/writingPage';
import { transferRoute } from '../ui/transfer/transferPage';
import { backupsRoute } from '../ui/backups/backupsPage';
import { featuresRoute } from '../ui/features/featuresPage';
import { helpRoute } from '../ui/guide/helpPage';
import { WorldsmithView } from '../ui/views/WorldsmithView';
import { API_VERSION, type WorldsmithAPI } from './api';
import { DEFAULT_DATA_FOLDER, LEGACY_DATA_FOLDER, VIEW_TYPE_APP } from './constants';
import { hasWorldsmithData, moveDataFolder, type MoveResult } from '../data/storage/moveFolder';
import type { OpenOptions, WorldsmithContext } from './context';

/**
 * Composition root. Builds registries → storage → services in dependency order and owns
 * their lifecycle. main.ts only creates this, wires Obsidian registrations, and disposes.
 */
export class WorldsmithApp implements WorldsmithContext {
	readonly app: App;
	readonly events = new EventBus<WorldsmithEvents>();
	readonly fieldTypes = new FieldTypeRegistry();
	readonly blocks = new BlockRegistry();
	readonly routes = new RouteRegistry();
	readonly templates = new Registry<EntityTypeTemplate>('EntityTypeRegistry');
	readonly relationTemplates = new Registry<RelationTypeTemplate>('RelationTypeRegistry');
	readonly db: Database;
	readonly worlds: WorldService;
	readonly linkedNotes: LinkedNoteService;
	/** Native notes (0.17): an entry's own note, kept in step with the entry. */
	readonly nativeNotes: NativeNoteService;
	readonly noteMigrations: NoteMigrationService;
	readonly media: MediaService;
	/** Complete world archives (0.19): export, verify, import `.worldsmith.zip`. */
	readonly archives: WorldArchiveService;
	/** Backups & recovery (0.20): verified backups, schedule, safe restore. */
	readonly backups: BackupManager;
	/** Deleted worlds (0.20.1): delete safely, restore, or delete for good. */
	readonly worldTrash: WorldTrash;
	/** Scene snapshots (0.25). */
	readonly snapshots: SnapshotService;
	/** Parts of Worldsmith the open world uses (0.29). */
	readonly features = {
		isOn: (id: FeatureId): boolean => !isLocked(id) && featureOn(this.worlds.session?.world.features, id),
		/** Switch a part on or off; returns an undo. Nothing is deleted. */
		set: (id: FeatureId, on: boolean): (() => void) => {
			const s = this.worlds.session;
			// Pro parts can't be switched on in the free edition (0.30).
			if (!s || (on && isLocked(id))) return () => {};
			const before = { ...(s.world.features ?? {}) };
			const next = { ...before };
			if (on) delete next[id];
			else next[id] = false;
			s.updateWorld({ features: next });
			return () => this.worlds.session === s && void s.updateWorld({ features: before });
		},
	};
	/** Look of native notes and their CSS snippet; set by the plugin (absent in tests). */
	noteStyles: import('../ui/notes/noteStyles').NoteStyles | null = null;
	readonly api: WorldsmithAPI;
	private disposables = new DisposableStore();

	constructor(
		readonly plugin: Plugin,
		readonly settings: WorldsmithSettings,
		private readonly persistSettings: (s: WorldsmithSettings) => Promise<void>,
	) {
		this.app = plugin.app;
		this.registerBuiltins();
		this.db = new Database(new ObsidianStorageAdapter(this.app.vault.adapter), settings.dataFolder, this.events);
		this.worlds = new WorldService(this.db, this.events, this.fieldTypes, this.templates, this.relationTemplates);
		this.linkedNotes = new LinkedNoteService(this.app, this.worlds, () => this.settings.notesFolder, () => this.db.root);
		this.media = new MediaService(this.app, this.worlds, () => this.settings, () => this.db.root);
		this.nativeNotes = new NativeNoteService(this.app, this.worlds, this.events, this.fieldTypes, () => this.settings.notesFolder, () => this.settings.nativeNotes, () => this.db.root);
		this.noteMigrations = new NoteMigrationService(this.app, this.db, this.worlds, this.nativeNotes);
		this.archives = new WorldArchiveService(this.app, this.db, this.worlds, () => this.plugin.manifest?.version ?? 'unknown');
		this.db.beforeFlush = () => this.worlds.session?.writing.flushProgress();
		this.backups = new BackupManager(this.app, this.db, this.worlds, this.archives, this.nativeNotes, () => this.settings.backups);
		this.worldTrash = new WorldTrash(this.db, this.worlds, this.backups, this.nativeNotes);
		this.snapshots = new SnapshotService(this.app, this.db, this.worlds);
		this.blocks.hidden = (def) => {
			const f = featureOfBlock(def.id);
			return !!f && !this.features.isOn(f);
		};
		// Backups and world files carry the open world's native notes.
		this.db.notesProvider = async (worldId) => (this.worlds.session?.worldId === worldId ? this.nativeNotes.collect() : []);
		this.api = this.createApi();
		this.disposables.add(this.events.on('world:updated', ({ world, keys }) => keys.includes('name') && this.worlds.syncManifestName(world)));
		// A type's built-in view starts from the layout and sort this device used before saved views.
		this.disposables.add(
			this.events.on('world:loaded', () => {
				const s = this.worlds.session;
				if (!s) return;
				// The Writing Studio follows note renames and counts words through the vault.
				s.writing.attach(obsidianVault(this.app, () => this.db.root));
				s.legacyView = (typeId) => {
					const db = this.settings.database;
					const kind = db.viewKind[typeId];
					const sort = db.sort[typeId];
					return { kind, sort: sort ? { field: sort.by, dir: sort.dir } : undefined };
				};
			}),
		);
	}

	/** Built-ins go through the same registries extensions use. */
	private registerBuiltins(): void {
		for (const f of BUILTIN_FIELD_TYPES) this.disposables.add(this.fieldTypes.register(f));
		for (const b of BUILTIN_BLOCKS) this.disposables.add(this.blocks.register(b));
		for (const t of BUILTIN_TYPES) this.disposables.add(this.templates.register(t));
		for (const t of BUILTIN_RELATION_TYPES) this.disposables.add(this.relationTemplates.register(t));
		for (const r of [dashboardRoute, databaseRoute, entityRoute, onboardingRoute, searchRoute, trashRoute, typeStudioRoute, relationRoute, relationshipsRoute, tasksRoute, mediaRoute, layoutStudioRoute, transferRoute, backupsRoute, helpRoute, calendarsRoute, timelineRoute, healthRoute, treesRoute, graphRoute, mapsRoute, writingRoute, featuresRoute]) {
			this.disposables.add(this.routes.register(r));
		}
	}

	private createApi(): WorldsmithAPI {
		// eslint-disable-next-line @typescript-eslint/no-this-alias -- the app is captured for callbacks that Obsidian calls with its own `this`
		const self = this;
		return {
			version: API_VERSION,
			events: this.events,
			get session() {
				return self.worlds.session;
			},
			registerFieldType: (d) => this.fieldTypes.register(d),
			registerBlock: (d) => this.blocks.register(d),
			registerEntityType: (t) => this.templates.register(t),
			registerRelationType: (t) => this.relationTemplates.register(t),
			registerRoute: (d) => this.routes.register(d),
			open: (r, o) => this.open(r, o),
		};
	}

	#started: Promise<void> | null = null;

	/** Load storage and the active world. Idempotent; safe to call from anywhere. */
	ensureStarted(): Promise<void> {
		if (!this.#started) {
			this.#started = (async () => {
				this.linkedNotes.register(this.plugin);
				this.media.register(this.plugin);
				this.nativeNotes.register(this.plugin);
				await this.migrateLegacyFolder();
				// A restore cut short mid-swap is put back before any world opens (0.20).
				for (const msg of await this.backups.recoverEarly().catch(() => [] as string[])) new Notice(`Worldsmith: ${msg}`, 15000);
				await this.worlds.init();
				for (const w of this.worlds.warnings.splice(0)) new Notice(`Worldsmith: ${w}`, 12000);
				this.backups.start((id) => this.plugin.registerInterval(id));
				// WS6: a scene edited outside the studio gets its day's snapshot at the first save seen.
				this.plugin.registerEvent(
					this.app.vault.on('modify', (f) => {
						const sc = this.worlds.session?.writing.sceneByPath(f.path);
						if (sc) void this.snapshots.autoDaily(sc);
					}),
				);
			})().catch((e) => {
				console.error('[Worldsmith] failed to start', e);
				new Notice(`Worldsmith couldn’t start: ${e instanceof Error ? e.message : String(e)}`);
			});
		}
		return this.#started;
	}

	/**
	 * 0.1.x stored data in `.worldsmith` (invisible to Obsidian Sync). If the configured
	 * folder is the new default, holds no data yet, and the legacy folder does, move it.
	 */
	private async migrateLegacyFolder(): Promise<void> {
		const target = this.settings.dataFolder;
		if (target !== DEFAULT_DATA_FOLDER) return;
		const adapter = this.db.adapter;
		if (await hasWorldsmithData(adapter, target)) return;
		if (!(await hasWorldsmithData(adapter, LEGACY_DATA_FOLDER))) return;
		try {
			const res = await moveDataFolder(adapter, LEGACY_DATA_FOLDER, target);
			new Notice(
				res.method === 'rename'
					? `Worldsmith moved your worlds to “${target}/” so Obsidian Sync can include them.`
					: `Worldsmith copied your worlds to “${target}/” so Obsidian Sync can include them. The old “${LEGACY_DATA_FOLDER}/” folder was kept as a backup; you can delete it once you’ve checked everything.`,
				12000,
			);
		} catch (e) {
			// Never strand data: keep using the legacy folder if the move fails.
			console.error('[Worldsmith] could not move legacy data folder', e);
			this.settings.dataFolder = LEGACY_DATA_FOLDER;
			this.db.relocate(LEGACY_DATA_FOLDER);
			await this.persistSettings(this.settings);
			new Notice(`Worldsmith couldn’t move your data to “${target}/” (${e instanceof Error ? e.message : String(e)}). It keeps using “${LEGACY_DATA_FOLDER}/”; you can retry from settings.`, 15000);
		}
	}

	/**
	 * Switch to another data folder at runtime. With `move`, the current folder's contents
	 * are moved there first (rename, or verified copy that keeps the original).
	 */
	async changeDataFolder(folder: string, opts: { move: boolean }): Promise<MoveResult | null> {
		const from = this.db.root;
		if (folder === from) return null;
		await this.worlds.shutdown();
		let result: MoveResult | null = null;
		try {
			if (opts.move && (await this.db.adapter.exists(from))) result = await moveDataFolder(this.db.adapter, from, folder);
			this.db.relocate(folder);
			this.settings.dataFolder = folder;
			await this.saveSettings();
		} finally {
			await this.worlds.init();
		}
		return result;
	}

	/** @deprecated use ensureStarted */
	start(): Promise<void> {
		return this.ensureStarted();
	}

	createView(leaf: WorkspaceLeaf): WorldsmithView {
		return new WorldsmithView(leaf, this);
	}

	async open(route: Route, opts: OpenOptions = {}): Promise<void> {
		void this.ensureStarted();
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf;
		if (opts.newLeaf) {
			leaf = workspace.getLeaf(opts.newLeaf === true ? 'tab' : opts.newLeaf);
		} else {
			const active = workspace.getActiveViewOfType(WorldsmithView)?.leaf;
			leaf = active ?? workspace.getLeavesOfType(VIEW_TYPE_APP)[0] ?? workspace.getLeaf('tab');
		}
		await leaf.setViewState({ type: VIEW_TYPE_APP, state: { route }, active: true });
		await workspace.revealLeaf(leaf);
	}

	async saveSettings(): Promise<void> {
		await this.persistSettings(this.settings);
		this.events.emit('settings:changed', { keys: [] });
	}

	/**
	 * Restore a backup of the open world. Native notes are held first (and the reconciles
	 * already running finish), so no background sync writes the old state back over the
	 * restored files; the old session's unsaved changes are dropped, not flushed.
	 */
	async restoreBackup(path: string): ReturnType<Database['backups']['restore']> {
		this.nativeNotes.pause(true);
		try {
			await this.nativeNotes.idle();
			await this.flush();
			const res = await this.db.backups.restore(path);
			await this.worlds.reload({ discard: true });
			return res;
		} finally {
			this.nativeNotes.pause(false);
		}
	}

	/** Flush everything to disk. Safe to call repeatedly. */
	flush(): Promise<void> {
		this.worlds.session?.writing.flushProgress();
		return this.db.flushAll();
	}

	dispose(): void {
		// Fire-and-forget final flush: onunload is synchronous in Obsidian. The workspace
		// `quit` hook (main.ts) awaits a flush on app exit; the debounce max-wait bounds the
		// window otherwise.
		// Words counted in the last seconds go into today first (WS6), then everything is saved.
		this.worlds.session?.writing.flushProgress();
		void this.db.flushAll().finally(() => this.db.dispose());
		this.backups.stop();
		this.nativeNotes.dispose();
		this.worlds.dispose();
		this.disposables.dispose();
		this.events.clear();
	}
}
