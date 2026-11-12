import type { SceneStatus, StatusDefinition } from '../core/types';

export const PLUGIN_ID = 'worldsmith';
export const VIEW_TYPE_APP = 'worldsmith-app';
/**
 * Visible folder name so Obsidian Sync includes it (Sync skips dot-folders).
 * 0.1.x used `.worldsmith`; startup moves that folder here automatically.
 */
export const DEFAULT_DATA_FOLDER = '_worldsmith';
export const LEGACY_DATA_FOLDER = '.worldsmith';
/** Bump when settings need a one-time upgrade in mergeSettings. */
export const SETTINGS_VERSION = 3;

/** Folder-layout version. Bump together with a storage migration. */
export const STORAGE_VERSION = 1;

/** Record shape versions. Bump together with a record migration step. */
export const RECORD_VERSIONS = {
	manifest: 1,
	world: 1,
	schema: 1,
	entity: 1,
	task: 1,
	edge: 1,
	relationType: 1,
	layout: 1,
	view: 1,
	preset: 1,
	calendar: 1,
	tree: 1,
	graph: 1,
	map: 1,
	writingProject: 1,
	manuscriptItem: 1,
	writingTemplate: 1,
	noteTemplate: 1,
} as const;

export const FILE_FORMATS = {
	manifest: 'worldsmith/manifest',
	world: 'worldsmith/world',
	schemaBucket: 'worldsmith/schema-bucket',
	entityBucket: 'worldsmith/entity-bucket',
	edgeBucket: 'worldsmith/edge-bucket',
	taskBucket: 'worldsmith/task-bucket',
	relationTypeBucket: 'worldsmith/relation-type-bucket',
	layoutBucket: 'worldsmith/layout-bucket',
	viewBucket: 'worldsmith/view-bucket',
	presetBucket: 'worldsmith/preset-bucket',
	calendarBucket: 'worldsmith/calendar-bucket',
	treeBucket: 'worldsmith/tree-bucket',
	graphBucket: 'worldsmith/graph-bucket',
	mapBucket: 'worldsmith/map-bucket',
	writingProjectBucket: 'worldsmith/writing-project-bucket',
	manuscriptBucket: 'worldsmith/manuscript-bucket',
	writingTemplateBucket: 'worldsmith/writing-template-bucket',
	noteTemplateBucket: 'worldsmith/note-template-bucket',
	/** A single note template exported to a file (0.17). */
	noteTemplateFile: 'worldsmith/note-template',
	backup: 'worldsmith/backup',
} as const;

export const DEFAULT_STATUSES: StatusDefinition[] = [
	{ id: 'idea', label: 'Idea', color: 'gray', category: 'idea', icon: 'lightbulb' },
	{ id: 'draft', label: 'Draft', color: 'yellow', category: 'active', icon: 'pencil-line' },
	{ id: 'dev', label: 'In development', color: 'blue', category: 'active', icon: 'hammer' },
	{ id: 'done', label: 'Complete', color: 'green', category: 'done', icon: 'check-circle-2' },
	{ id: 'archived', label: 'Archived', color: 'gray', category: 'archived', icon: 'archive' },
];

/** Scene statuses a new writing project starts with (each project can change its own). */
export const DEFAULT_SCENE_STATUSES: SceneStatus[] = [
	{ id: 'idea', label: 'Idea', color: 'gray', done: false },
	{ id: 'outlined', label: 'Outlined', color: 'purple', done: false },
	{ id: 'firstDraft', label: 'First draft', color: 'yellow', done: false },
	{ id: 'revised', label: 'Revised', color: 'blue', done: false },
	{ id: 'finalDraft', label: 'Final draft', color: 'cyan', done: false },
	{ id: 'complete', label: 'Complete', color: 'green', done: true },
];

/** Sidebar groups seeded into new worlds. Type items are filled from schema.group. */
export const DEFAULT_SIDEBAR_GROUPS: Array<{ id: string; label: string }> = [
	{ id: 'world', label: 'World' },
	{ id: 'society', label: 'Society' },
	{ id: 'lore', label: 'Lore' },
	{ id: 'custom', label: 'Custom' },
	{ id: 'tools', label: 'Tools' },
	{ id: 'studio', label: 'Studio' },
];

export const MAX_BACKUPS = 10;
