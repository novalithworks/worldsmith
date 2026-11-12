import { FILE_FORMATS, RECORD_VERSIONS, STORAGE_VERSION } from '../app/constants';
import type { EventBus } from '../core/events/EventBus';
import type { WorldsmithEvents } from '../core/events/events';
import type { Calendar, ManuscriptItem, WritingProject, WritingTemplate, GraphDoc, MapDoc, TreeDoc, DevTask, EntityRecord, EntitySchema, DatabaseView, LayoutDoc, LayoutPresetDoc, NoteTemplate, RelationEdge, RelationType, StorageManifest, World } from '../core/types';
import { BackupService } from './backup/BackupService';
import { MigrationRunner, type MigrationResult } from './migrations/MigrationRunner';
import { STORAGE_MIGRATIONS } from './migrations';
import { hydrateCalendar, hydrateGraph, hydrateMap, hydrateTree, hydrateEdge, hydrateEntity, hydrateLayout, hydrateLayoutPreset, hydrateView, hydrateTask, hydrateManifest, hydrateRelationType, hydrateSchema, hydrateWorld, hydrateManuscriptItem, hydrateWritingProject, hydrateWritingTemplate, hydrateNoteTemplate } from './migrations/records';
import { SaveTracker } from './SaveTracker';
import { AtomicJsonFile } from './storage/AtomicJsonFile';
import { BucketStore, type LoadReport } from './storage/BucketStore';
import { DocumentStore } from './storage/DocumentStore';
import { shardOf, WorldsmithPaths } from './storage/paths';
import type { StorageAdapter } from './storage/StorageAdapter';
import { WriteQueue } from './storage/WriteQueue';

/**
 * The storage stack for one data folder. Owns the manifest and creates per-world store
 * bundles. Knows nothing about business rules — that's the services' job.
 */
export class Database {
	paths!: WorldsmithPaths;
	files!: AtomicJsonFile;
	readonly queue = new WriteQueue(8);
	backups!: BackupService;
	/** Native notes of a world, for backups and world files (set by the app, 0.17). */
	notesProvider: ((worldId: string) => Promise<Array<{ path: string; content: string }>>) | null = null;
	readonly saveTracker: SaveTracker;
	manifest!: DocumentStore<StorageManifest>;
	private worlds = new Map<string, WorldStores>();

	constructor(
		readonly adapter: StorageAdapter,
		root: string,
		events: EventBus<WorldsmithEvents>,
	) {
		this.saveTracker = new SaveTracker(events);
		this.bindRoot(root);
	}

	get root(): string {
		return this.paths.root;
	}

	/**
	 * Point the database at another data folder. Every world must be closed and flushed
	 * first (WorldService.shutdown); the caller then re-opens with WorldService.init().
	 */
	relocate(root: string): void {
		if (this.worlds.size) throw new Error('[Worldsmith] close all worlds before relocating storage');
		this.manifest.dispose();
		this.bindRoot(root);
	}

	private bindRoot(root: string): void {
		this.paths = new WorldsmithPaths(root);
		this.files = new AtomicJsonFile(this.adapter, this.paths.quarantine);
		this.backups = new BackupService(this.adapter, this.files, this.paths, (id) => this.notesProvider?.(id) ?? Promise.resolve([]));
		this.manifest = new DocumentStore<StorageManifest>({
			name: 'manifest',
			path: this.paths.manifest,
			files: this.files,
			queue: this.queue,
			hydrate: hydrateManifest,
			onStateChange: this.saveTracker.reporter('manifest'),
		});
	}

	/**
	 * Load the manifest (creating none — onboarding decides) and run pending storage
	 * migrations, backing up every world first.
	 */
	async open(): Promise<{ manifest: StorageManifest | null; migrations: MigrationResult | null; quarantined?: string }> {
		const { value, quarantined } = await this.manifest.load();
		if (!value) return { manifest: null, migrations: null, quarantined };

		const runner = new MigrationRunner(STORAGE_MIGRATIONS);
		const migrations = await runner.run(
			{ adapter: this.adapter, files: this.files, paths: this.paths, manifest: value },
			STORAGE_VERSION,
			{
				beforeFirst: async () => {
					for (const w of value.worlds) await this.backups.create(w.id, 'before-storage-migration');
				},
				persist: (m) => this.manifest.save(m),
				log: () => {},
			},
		);
		return { manifest: value, migrations, quarantined };
	}

	async createManifest(): Promise<StorageManifest> {
		const manifest: StorageManifest = {
			format: FILE_FORMATS.manifest,
			v: RECORD_VERSIONS.manifest,
			storageVersion: STORAGE_VERSION,
			createdAt: Date.now(),
			activeWorldId: null,
			worlds: [],
		};
		await this.manifest.save(manifest);
		return manifest;
	}

	world(worldId: string): WorldStores {
		let w = this.worlds.get(worldId);
		if (!w) {
			w = new WorldStores(this, worldId);
			this.worlds.set(worldId, w);
		}
		return w;
	}

	closeWorld(worldId: string): void {
		const w = this.worlds.get(worldId);
		if (!w) return;
		w.dispose();
		this.worlds.delete(worldId);
	}

	async flushAll(): Promise<void> {
		await this.manifest.flush();
		await Promise.all([...this.worlds.values()].map((w) => w.flush()));
		await this.queue.idle();
	}

	/**
	 * Write everything pending and make sure it reached the disk (0.19). `flushAll` never
	 * throws (a failed save stays pending and is retried later), so this checks afterwards and
	 * throws when anything is still unsaved: an export or import must stop rather than read
	 * older files from disk while claiming they're the latest.
	 */
	/** Called before a strict save (exports, backups): the writing service hands over counted words (WS6). */
	beforeFlush: (() => void) | null = null;

	async flushAllStrict(): Promise<void> {
		this.beforeFlush?.();
		await this.flushAll();
		if (!this.hasPendingWrites()) return;
		// A change made while saving is pending again: one more pass.
		await this.flushAll();
		if (this.hasPendingWrites()) throw new Error('Some of your latest changes couldn’t be saved to disk, so nothing was exported or imported. Check that the vault isn’t full or read-only, then try again.');
	}

	hasPendingWrites(): boolean {
		return this.manifest.hasPendingWrites() || [...this.worlds.values()].some((w) => w.hasPendingWrites());
	}

	dispose(): void {
		for (const w of this.worlds.values()) w.dispose();
		this.worlds.clear();
		this.manifest.dispose();
		this.saveTracker.dispose();
	}
}

/** The stores of a single world. */
export class WorldStores {
	readonly world: DocumentStore<World>;
	readonly schemas: BucketStore<EntitySchema>;
	readonly entities: BucketStore<EntityRecord>;
	readonly relationTypes: BucketStore<RelationType>;
	/** Connections, sharded by hash(from) — many tiny records, few files. */
	readonly edges: BucketStore<RelationEdge>;
	/** Development tasks, sharded by hash(entityId) so an entry's tasks share a file. */
	readonly tasks: BucketStore<DevTask>;
	/** Page layouts: one file per type layout and per entry that has its own. */
	readonly layouts: BucketStore<LayoutDoc>;
	/** Saved database views: one file per type. */
	readonly views: BucketStore<DatabaseView>;
	/** Layout presets people made: one file each (0.10). */
	readonly presets: BucketStore<LayoutPresetDoc>;
	/** Fictional calendars: one file each (0.10). */
	readonly calendars: BucketStore<Calendar>;
	/** Family trees, relationship graphs and maps: one file each (0.11). */
	readonly trees: BucketStore<TreeDoc>;
	readonly graphs: BucketStore<GraphDoc>;
	readonly maps: BucketStore<MapDoc>;
	/** Writing Studio projects: one file each (WS2). */
	readonly writingProjects: BucketStore<WritingProject>;
	/** Parts, chapters and scenes, one file per project (WS2). */
	readonly manuscript: BucketStore<ManuscriptItem>;
	/** Planning templates the writer saved: one file each (WS4). */
	readonly writingTemplates: BucketStore<WritingTemplate>;
	/** Native note templates people made (0.17). */
	readonly noteTemplates: BucketStore<NoteTemplate>;

	constructor(
		db: Database,
		readonly worldId: string,
	) {
		const { paths, files, queue, saveTracker, adapter } = db;
		this.world = new DocumentStore<World>({
			name: `world:${worldId}`,
			path: paths.worldFile(worldId),
			files,
			queue,
			hydrate: hydrateWorld,
			onStateChange: saveTracker.reporter(`world:${worldId}`),
		});
		this.schemas = new BucketStore<EntitySchema>({
			name: `schemas:${worldId}`,
			adapter,
			files,
			queue,
			dir: paths.schemasDir(worldId),
			format: FILE_FORMATS.schemaBucket,
			fileVersion: 1,
			bucketOf: (s) => s.id,
			pathOf: (bucket) => paths.schemaFile(worldId, bucket),
			hydrate: hydrateSchema,
			debounceMs: 500,
			onStateChange: saveTracker.reporter(`schemas:${worldId}`),
		});
		this.entities = new BucketStore<EntityRecord>({
			name: `entities:${worldId}`,
			adapter,
			files,
			queue,
			dir: paths.entitiesDir(worldId),
			format: FILE_FORMATS.entityBucket,
			fileVersion: 1,
			bucketOf: (e) => e.id,
			pathOf: (bucket) => paths.entityFile(worldId, bucket),
			hydrate: hydrateEntity,
			onStateChange: saveTracker.reporter(`entities:${worldId}`),
		});
		this.relationTypes = new BucketStore<RelationType>({
			name: `relation-types:${worldId}`,
			adapter,
			files,
			queue,
			dir: paths.relationTypesDir(worldId),
			format: FILE_FORMATS.relationTypeBucket,
			fileVersion: 1,
			bucketOf: (t) => t.id,
			pathOf: (bucket) => paths.relationTypeFile(worldId, bucket),
			hydrate: hydrateRelationType,
			debounceMs: 500,
			onStateChange: saveTracker.reporter(`relation-types:${worldId}`),
		});
		this.edges = new BucketStore<RelationEdge>({
			name: `relations:${worldId}`,
			adapter,
			files,
			queue,
			dir: paths.relationsDir(worldId),
			format: FILE_FORMATS.edgeBucket,
			fileVersion: 1,
			bucketOf: (e) => shardOf(e.from),
			pathOf: (bucket) => paths.edgeFile(worldId, bucket),
			hydrate: hydrateEdge,
			onStateChange: saveTracker.reporter(`relations:${worldId}`),
		});
		this.tasks = new BucketStore<DevTask>({
			name: `tasks:${worldId}`,
			adapter,
			files,
			queue,
			dir: paths.tasksDir(worldId),
			format: FILE_FORMATS.taskBucket,
			fileVersion: 1,
			bucketOf: (t) => shardOf(t.entityId ?? t.id),
			pathOf: (bucket) => paths.taskFile(worldId, bucket),
			hydrate: hydrateTask,
			onStateChange: saveTracker.reporter(`tasks:${worldId}`),
		});
		this.layouts = new BucketStore<LayoutDoc>({
			name: `layouts:${worldId}`,
			adapter,
			files,
			queue,
			dir: paths.layoutsDir(worldId),
			format: FILE_FORMATS.layoutBucket,
			fileVersion: 1,
			bucketOf: (l) => l.id,
			pathOf: (bucket) => paths.layoutFile(worldId, bucket),
			hydrate: hydrateLayout,
			debounceMs: 400,
			onStateChange: saveTracker.reporter(`layouts:${worldId}`),
		});
		this.views = new BucketStore<DatabaseView>({
			name: `views:${worldId}`,
			adapter,
			files,
			queue,
			dir: paths.viewsDir(worldId),
			format: FILE_FORMATS.viewBucket,
			fileVersion: 1,
			bucketOf: (v) => v.typeId,
			pathOf: (bucket) => paths.viewFile(worldId, bucket),
			hydrate: hydrateView,
			debounceMs: 500,
			onStateChange: saveTracker.reporter(`views:${worldId}`),
		});
		this.presets = new BucketStore<LayoutPresetDoc>({
			name: `presets:${worldId}`,
			adapter,
			files,
			queue,
			dir: paths.presetsDir(worldId),
			format: FILE_FORMATS.presetBucket,
			fileVersion: 1,
			bucketOf: (p) => p.id,
			pathOf: (bucket) => paths.presetFile(worldId, bucket),
			hydrate: hydrateLayoutPreset,
			debounceMs: 400,
			onStateChange: saveTracker.reporter(`presets:${worldId}`),
		});
		this.calendars = new BucketStore<Calendar>({
			name: `calendars:${worldId}`,
			adapter,
			files,
			queue,
			dir: paths.calendarsDir(worldId),
			format: FILE_FORMATS.calendarBucket,
			fileVersion: 1,
			bucketOf: (c) => c.id,
			pathOf: (bucket) => paths.calendarFile(worldId, bucket),
			hydrate: hydrateCalendar,
			debounceMs: 400,
			onStateChange: saveTracker.reporter(`calendars:${worldId}`),
		});
		const visual = <T extends { id: string }>(kind: 'trees' | 'graphs' | 'maps', format: string, hydrate: (raw: unknown) => { record: T; upgraded: boolean } | null) =>
			new BucketStore<T>({
				name: `${kind}:${worldId}`,
				adapter,
				files,
				queue,
				dir: paths.visualDir(worldId, kind),
				format,
				fileVersion: 1,
				bucketOf: (d) => d.id,
				pathOf: (bucket) => paths.visualFile(worldId, kind, bucket),
				hydrate,
				debounceMs: 400,
				onStateChange: saveTracker.reporter(`${kind}:${worldId}`),
			});
		this.trees = visual<TreeDoc>('trees', FILE_FORMATS.treeBucket, hydrateTree);
		this.graphs = visual<GraphDoc>('graphs', FILE_FORMATS.graphBucket, hydrateGraph);
		this.maps = visual<MapDoc>('maps', FILE_FORMATS.mapBucket, hydrateMap);
		this.writingProjects = new BucketStore<WritingProject>({
			name: `writing-projects:${worldId}`,
			adapter,
			files,
			queue,
			dir: paths.writingProjectsDir(worldId),
			format: FILE_FORMATS.writingProjectBucket,
			fileVersion: 1,
			bucketOf: (p) => p.id,
			pathOf: (bucket) => paths.writingProjectFile(worldId, bucket),
			hydrate: hydrateWritingProject,
			debounceMs: 400,
			onStateChange: saveTracker.reporter(`writing-projects:${worldId}`),
		});
		this.manuscript = new BucketStore<ManuscriptItem>({
			name: `manuscript:${worldId}`,
			adapter,
			files,
			queue,
			dir: paths.manuscriptDir(worldId),
			format: FILE_FORMATS.manuscriptBucket,
			fileVersion: 1,
			bucketOf: (i) => i.projectId,
			pathOf: (bucket) => paths.manuscriptFile(worldId, bucket),
			hydrate: hydrateManuscriptItem,
			debounceMs: 400,
			onStateChange: saveTracker.reporter(`manuscript:${worldId}`),
		});
		this.writingTemplates = new BucketStore<WritingTemplate>({
			name: `writing-templates:${worldId}`,
			adapter,
			files,
			queue,
			dir: paths.writingTemplatesDir(worldId),
			format: FILE_FORMATS.writingTemplateBucket,
			fileVersion: 1,
			bucketOf: (t) => t.id,
			pathOf: (bucket) => paths.writingTemplateFile(worldId, bucket),
			hydrate: hydrateWritingTemplate,
			debounceMs: 400,
			onStateChange: saveTracker.reporter(`writing-templates:${worldId}`),
		});
		this.noteTemplates = new BucketStore<NoteTemplate>({
			name: `note-templates:${worldId}`,
			adapter,
			files,
			queue,
			dir: paths.noteTemplatesDir(worldId),
			format: FILE_FORMATS.noteTemplateBucket,
			fileVersion: 1,
			bucketOf: (t) => t.id,
			pathOf: (bucket) => paths.noteTemplateFile(worldId, bucket),
			hydrate: hydrateNoteTemplate,
			debounceMs: 400,
			onStateChange: saveTracker.reporter(`note-templates:${worldId}`),
		});
	}

	private get collections() {
		return [this.schemas, this.entities, this.relationTypes, this.edges, this.tasks, this.layouts, this.views, this.presets, this.calendars, this.trees, this.graphs, this.maps, this.writingProjects, this.manuscript, this.writingTemplates, this.noteTemplates];
	}

	async loadAll(): Promise<{
		world: World | null;
		schemas: LoadReport;
		entities: LoadReport;
		relationTypes: LoadReport;
		edges: LoadReport;
		tasks: LoadReport;
		layouts: LoadReport;
		views: LoadReport;
		presets: LoadReport;
		calendars: LoadReport;
		trees: LoadReport;
		graphs: LoadReport;
		maps: LoadReport;
		writingProjects: LoadReport;
		manuscript: LoadReport;
		writingTemplates: LoadReport;
		noteTemplates: LoadReport;
		quarantined: string[];
	}> {
		const w = await this.world.load();
		const [schemas, entities, relationTypes, edges, tasks, layouts, views, presets, calendars, trees, graphs, maps, writingProjects, manuscript, writingTemplates, noteTemplates] = (await Promise.all(this.collections.map((c) => c.loadAll()))) as [
			LoadReport,
			LoadReport,
			LoadReport,
			LoadReport,
			LoadReport,
			LoadReport,
			LoadReport,
			LoadReport,
			LoadReport,
			LoadReport,
			LoadReport,
			LoadReport,
			LoadReport,
			LoadReport,
			LoadReport,
			LoadReport,
		];
		const quarantined = [schemas, entities, relationTypes, edges, tasks, layouts, views, presets, calendars, trees, graphs, maps, writingProjects, manuscript, writingTemplates, noteTemplates].flatMap((r) => r.quarantined);
		if (w.quarantined) quarantined.push(w.quarantined);
		return { world: w.value, schemas, entities, relationTypes, edges, tasks, layouts, views, presets, calendars, trees, graphs, maps, writingProjects, manuscript, writingTemplates, noteTemplates, quarantined };
	}

	async flush(): Promise<void> {
		await Promise.all([this.world.flush(), ...this.collections.map((c) => c.flush())]);
	}

	hasPendingWrites(): boolean {
		return this.world.hasPendingWrites() || this.collections.some((c) => c.hasPendingWrites());
	}

	/** Drop every unsaved change: the world's files were just replaced (a backup restore). */
	discard(): void {
		this.world.discard();
		for (const c of this.collections) c.discard();
	}

	dispose(): void {
		this.world.dispose();
		for (const c of this.collections) c.dispose();
	}
}
