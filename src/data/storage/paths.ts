import { hash32 } from '../../core/util/ids';
import { joinPath } from './StorageAdapter';

/**
 * Every on-disk location in one place. If the layout ever changes, this file and a
 * storage migration are the only things that change.
 */
export class WorldsmithPaths {
	constructor(public readonly root: string) {}

	get manifest(): string {
		return joinPath(this.root, 'manifest.json');
	}
	get quarantine(): string {
		return joinPath(this.root, 'quarantine');
	}
	get worldsDir(): string {
		return joinPath(this.root, 'worlds');
	}
	worldDir(worldId: string): string {
		return joinPath(this.worldsDir, worldId);
	}
	worldFile(worldId: string): string {
		return joinPath(this.worldDir(worldId), 'world.json');
	}
	schemasDir(worldId: string): string {
		return joinPath(this.worldDir(worldId), 'schemas');
	}
	schemaFile(worldId: string, typeId: string): string {
		return joinPath(this.schemasDir(worldId), `${typeId}.json`);
	}
	entitiesDir(worldId: string): string {
		return joinPath(this.worldDir(worldId), 'entities');
	}
	/** entities/<first two chars>/<id>.json — keeps directories small. */
	entityFile(worldId: string, entityId: string): string {
		return joinPath(this.entitiesDir(worldId), entityId.slice(0, 2).toLowerCase(), `${entityId}.json`);
	}
	relationsDir(worldId: string): string {
		return joinPath(this.worldDir(worldId), 'relations');
	}
	/** relations/<shard>.json — edges sharded by hash(from). */
	edgeFile(worldId: string, shard: string): string {
		return joinPath(this.relationsDir(worldId), `${shard}.json`);
	}
	relationTypesDir(worldId: string): string {
		return joinPath(this.worldDir(worldId), 'relation-types');
	}
	relationTypeFile(worldId: string, typeId: string): string {
		return joinPath(this.relationTypesDir(worldId), `${typeId}.json`);
	}
	tasksDir(worldId: string): string {
		return joinPath(this.worldDir(worldId), 'tasks');
	}
	/** tasks/<shard>.json — tasks sharded by hash(entityId or task id). */
	taskFile(worldId: string, shard: string): string {
		return joinPath(this.tasksDir(worldId), `${shard}.json`);
	}
	layoutsDir(worldId: string): string {
		return joinPath(this.worldDir(worldId), 'layouts');
	}
	layoutFile(worldId: string, layoutId: string): string {
		return joinPath(this.layoutsDir(worldId), `${layoutId}.json`);
	}
	viewsDir(worldId: string): string {
		return joinPath(this.worldDir(worldId), 'views');
	}
	viewFile(worldId: string, typeId: string): string {
		return joinPath(this.viewsDir(worldId), `${typeId}.json`);
	}
	/** presets/<id>.json — layout presets people made (0.10). */
	presetsDir(worldId: string): string {
		return joinPath(this.worldDir(worldId), 'presets');
	}
	presetFile(worldId: string, id: string): string {
		return joinPath(this.presetsDir(worldId), `${id}.json`);
	}
	/** trees/, graphs/, maps/<id>.json — family trees, relationship graphs, maps (0.11). */
	visualDir(worldId: string, kind: 'trees' | 'graphs' | 'maps'): string {
		return joinPath(this.worldDir(worldId), kind);
	}
	visualFile(worldId: string, kind: 'trees' | 'graphs' | 'maps', id: string): string {
		return joinPath(this.visualDir(worldId, kind), `${id}.json`);
	}
	/** calendars/<id>.json — fictional calendars (0.10). */
	calendarsDir(worldId: string): string {
		return joinPath(this.worldDir(worldId), 'calendars');
	}
	calendarFile(worldId: string, id: string): string {
		return joinPath(this.calendarsDir(worldId), `${id}.json`);
	}
	/** writing/projects/<id>.json and writing/manuscript/<projectId>.json — Writing Studio (WS2). */
	writingProjectsDir(worldId: string): string {
		return joinPath(this.worldDir(worldId), 'writing', 'projects');
	}
	writingProjectFile(worldId: string, id: string): string {
		return joinPath(this.writingProjectsDir(worldId), `${id}.json`);
	}
	manuscriptDir(worldId: string): string {
		return joinPath(this.worldDir(worldId), 'writing', 'manuscript');
	}
	/** One file per project: its parts, chapters and scenes move together. */
	manuscriptFile(worldId: string, projectId: string): string {
		return joinPath(this.manuscriptDir(worldId), `${projectId}.json`);
	}
	/** writing/templates/<id>.json — planning templates the writer saved (WS4). */
	writingTemplatesDir(worldId: string): string {
		return joinPath(this.worldDir(worldId), 'writing', 'templates');
	}
	writingTemplateFile(worldId: string, id: string): string {
		return joinPath(this.writingTemplatesDir(worldId), `${id}.json`);
	}
	/** note-templates/<id>.json — native note templates people made (0.17). */
	noteTemplatesDir(worldId: string): string {
		return joinPath(this.worldDir(worldId), 'note-templates');
	}
	noteTemplateFile(worldId: string, id: string): string {
		return joinPath(this.noteTemplatesDir(worldId), `${id}.json`);
	}
	/** Safety copies kept while a native-note migration awaits Confirm (0.17). */
	noteMigrationsDir(worldId: string): string {
		return joinPath(this.worldDir(worldId), 'note-migrations');
	}
	backupsDir(worldId: string): string {
		return joinPath(this.root, 'backups', worldId);
	}
}

/** 256 hash shards for collections of many tiny records (relations, tasks). */
export function shardOf(key: string, shards = 256): string {
	return (hash32(key) % shards).toString(16).padStart(2, '0');
}
