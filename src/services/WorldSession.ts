import { DashboardService } from './DashboardService';
import { LayoutService } from './LayoutService';
import { ViewService } from './ViewService';
import { PresetService } from './PresetService';
import { CalendarService } from './CalendarService';
import { VisualDocs } from './VisualDocs';
import { hydrateGraph, hydrateMap, hydrateTree } from '../data/migrations/records';
import { MediaRefs } from './MediaRefs';
import type { EventBus } from '../core/events/EventBus';
import type { WorldsmithEvents } from '../core/events/events';
import type { EntityTypeTemplate, GraphDoc, MapDoc, RelationTypeTemplate, TreeDoc, World } from '../core/types';
import type { Registry } from '../core/registry/Registry';
import type { WorldStores } from '../data/Database';
import { EntityIndex } from '../data/indexes/EntityIndex';
import { EntityRepository } from '../data/repositories/EntityRepository';
import { SchemaRepository } from '../data/repositories/SchemaRepository';
import type { FieldTypeRegistry } from '../fields/FieldTypeRegistry';
import { EntityService } from './EntityService';
import { SchemaService } from './SchemaService';
import { SearchService } from './SearchService';
import { SchemaEditService } from './SchemaEditService';
import { FieldValues } from './FieldValues';
import { RelationService } from './RelationService';
import { TaskService } from './TaskService';
import { WritingService } from './writing/WritingService';
import { NoteTemplateService } from './notes/NoteTemplateService';

/**
 * Everything bound to one loaded world. Switching worlds disposes the session and
 * creates a new one, so no service ever holds state from the previous world.
 * Later milestones add TaskService, LayoutService here.
 */
export class WorldSession {
	readonly entities: EntityRepository;
	readonly schemaRepo: SchemaRepository;
	readonly index: EntityIndex;
	readonly schemas: SchemaService;
	readonly entityService: EntityService;
	readonly search: SearchService;
	/** Structural edits to types (Type Studio). */
	readonly schemaEdits: SchemaEditService;
	/** Connections between entries and their kinds. */
	readonly relations: RelationService;
	/** Values of every field, stored or derived (relations, rollups). */
	readonly values: FieldValues;
	/** Development tasks. */
	readonly tasks: TaskService;
	/** Every reference from the world to vault files (images, attachments). */
	readonly media: MediaRefs;
	/** Page layouts for types, single entries and dashboards. */
	readonly layouts: LayoutService;
	/** Extra dashboards (Home is built in). */
	readonly dashboards: DashboardService;
	/** Saved database views, per type. */
	readonly views: ViewService;
	/** Layout presets people made (0.10). */
	readonly presets: PresetService;
	/** Fictional calendars (0.10). */
	readonly calendars: CalendarService;
	/** Family trees and hierarchies (0.11). */
	readonly trees: VisualDocs<TreeDoc>;
	/** Relationship graphs (0.11). */
	readonly graphs: VisualDocs<GraphDoc>;
	/** Maps with pins, regions and routes (0.11). */
	readonly maps: VisualDocs<MapDoc>;
	/** Writing Studio: projects, parts, chapters, scenes and word counts (WS2). */
	readonly writing: WritingService;
	/** Native note templates (0.17). */
	readonly noteTemplates: NoteTemplateService;

	/** Set by the app: this device's pre-M8 layout and sort per type (seeds default views). */
	legacyView?: (typeId: string) => { kind?: import('../core/types').ViewKind; sort?: import('../core/types').ViewSort };

	constructor(
		readonly stores: WorldStores,
		readonly events: EventBus<WorldsmithEvents>,
		fieldTypes: FieldTypeRegistry,
		templates: Registry<EntityTypeTemplate>,
		readonly relationTemplates?: Registry<RelationTypeTemplate>,
	) {
		this.entities = new EntityRepository(stores.entities, events);
		this.schemaRepo = new SchemaRepository(stores.schemas, events);
		this.index = new EntityIndex(this.entities, events);
		this.schemas = new SchemaService(this.schemaRepo, templates, () => this.world);
		this.relations = new RelationService(stores.relationTypes, stores.edges, this.entities, events);
		this.values = new FieldValues(this.entities, this.index, this.schemas, fieldTypes, () => this.relations);
		this.tasks = new TaskService(stores.tasks, this.entities, this.schemaRepo, events);
		this.layouts = new LayoutService(stores.layouts, events);
		this.dashboards = new DashboardService(() => this.world, (p) => this.updateWorld(p), this.layouts);
		this.views = new ViewService(stores.views, events, (typeId) => (typeId === '__media' ? 'images' : (this.schemas.get(typeId)?.plural ?? 'entries')), (typeId) => this.legacyView?.(typeId) ?? {});
		this.presets = new PresetService(stores.presets, events);
		this.trees = new VisualDocs<TreeDoc>('tree', stores.trees, events, hydrateTree, 'Family tree');
		this.graphs = new VisualDocs<GraphDoc>('graph', stores.graphs, events, hydrateGraph, 'Connections');
		this.maps = new VisualDocs<MapDoc>('map', stores.maps, events, hydrateMap, 'Map');
		// The app connects the vault (writing.attach) once the world has opened.
		this.writing = new WritingService(stores.writingProjects, stores.manuscript, events, stores.writingTemplates);
		this.noteTemplates = new NoteTemplateService(stores.noteTemplates, events, () => this.world, (p) => this.updateWorld(p));
		this.calendars = new CalendarService(stores.calendars, events, () => this.world, (p) => this.updateWorld(p), this.entities, () => this.relations);
		this.entityService = new EntityService(this.entities, this.index, this.schemas, fieldTypes, () => this.world, {
			values: this.values,
			connections: (id) => this.relations.count(id),
			afterCreate: (e) => void this.tasks.instantiate(e),
			afterDuplicate: (src, copy) => {
				this.relations.copyConnections(src.id, copy.id);
				this.tasks.copyTasks(src.id, copy.id);
				this.layouts.copyEntityLayout(src.id, copy.id);
			},
			taskStats: (id, opt) => this.tasks.stats(id, opt),
			taskCount: (id) => this.tasks.forEntity(id).length,
		});
		this.search = new SearchService(this.entities, this.schemas, fieldTypes, events);
		this.media = new MediaRefs(this.entities, this.schemaRepo, fieldTypes, () => this.world, (p) => this.updateWorld(p), events, () => this.maps);
		this.schemaEdits = new SchemaEditService(this.schemaRepo, this.entities, fieldTypes, () => this.world, (p) => this.updateWorld(p));
	}

	get worldId(): string {
		return this.stores.worldId;
	}

	get world(): World {
		return this.stores.world.require();
	}

	/** Patch the world document; emits world:updated with changed keys. */
	updateWorld(patch: Partial<Omit<World, 'id' | 'v' | 'createdAt' | 'rev'>>): World {
		const prev = this.world;
		const next: World = { ...prev, ...patch, updatedAt: Date.now(), rev: prev.rev + 1 };
		this.stores.world.set(next);
		this.events.emit('world:updated', { world: next, keys: Object.keys(patch) });
		return next;
	}

	/** Seed relationship types this world needs (first open after upgrading, imports). */
	ensureRelationTypes(): number {
		return this.relations.ensureSeeded(this.relationTemplates?.all() ?? [], this.schemaRepo.all());
	}

	/**
	 * Install relationship kinds from the built-in templates when the world doesn't have
	 * them yet (family trees need "Parent & child" and "Marriage"). Returns the ids added.
	 */
	ensureRelationKinds(ids: string[]): string[] {
		const added: string[] = [];
		for (const id of ids) {
			if (this.relations.type(id)) continue;
			const tpl = this.relationTemplates?.get(id);
			if (!tpl) continue;
			this.relations.installTemplate(tpl);
			added.push(id);
		}
		return added;
	}

	/**
	 * Entries created before tasks existed get their type's default checklist, once per
	 * world. Returns how many tasks were added.
	 */
	ensureTasksSeeded(): number {
		if (this.world.tasksSeeded) return 0;
		let n = 0;
		for (const e of this.entities.values()) n += this.tasks.instantiate(e).length;
		this.updateWorld({ tasksSeeded: true });
		return n;
	}

	dispose(): void {
		this.writing.dispose();
		this.calendars.dispose();
		this.media.dispose();
		this.layouts.dispose();
		this.tasks.dispose();
		this.relations.dispose();
		this.index.dispose();
		this.search.dispose();
	}
}
