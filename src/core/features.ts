/**
 * World features (0.29): parts of Worldsmith a world can switch off. Off hides the part
 * everywhere (sidebar, pages, commands, blocks, widgets) and never deletes anything; on again,
 * it's all there. Kept per world (World.features; absent = on), so it travels with the world.
 */

export type FeatureId = 'writing' | 'maps' | 'calendars' | 'timeline' | 'trees' | 'graph' | 'tasks' | 'dashboards' | 'media';

export interface FeatureDef {
	id: FeatureId;
	label: string;
	icon: string;
	description: string;
	group: 'Writing' | 'Places & time' | 'People & connections' | 'Organising';
	/** Pages (route names) that belong to it. */
	routes: string[];
	/** Blocks (layout widgets) that belong to it. */
	blocks: string[];
	/** What stays when it's off, said plainly. */
	whenOff: string;
	/** A plural name ("Maps are…"). */
	plural?: boolean;
}

export const FEATURES: FeatureDef[] = [
	{ id: 'writing', label: 'Writing Studio', icon: 'feather', group: 'Writing', routes: ['writing'], blocks: [], description: 'Books, chapters and scenes written in Obsidian, linked to your world: boards, arcs, goals, revision and compile.', whenOff: 'Your projects and scene notes stay; scene notes are ordinary notes.' },
	{ id: 'maps', plural: true, label: 'Maps', icon: 'map', group: 'Places & time', routes: ['maps'], blocks: ['map'], description: 'Your own maps, with pins for places, people and events.', whenOff: 'Maps and their pins are kept.' },
	{ id: 'calendars', plural: true, label: 'Calendars', icon: 'calendar-days', group: 'Places & time', routes: ['calendars'], blocks: [], description: 'Your world’s own calendars: months, weekdays and eras.', whenOff: 'Dates keep working with the calendars you have.' },
	{ id: 'timeline', label: 'Timeline', icon: 'gantt-chart', group: 'Places & time', routes: ['timeline'], blocks: ['timeline'], description: 'Events and dated entries in order, on lanes you choose.', whenOff: 'Dates stay on every entry.' },
	{ id: 'trees', plural: true, label: 'Family trees', icon: 'git-fork', group: 'People & connections', routes: ['trees'], blocks: ['family-tree'], description: 'Family trees drawn from parents, children and spouses.', whenOff: 'Family fields and connections stay on entries.' },
	{ id: 'graph', label: 'Graph', icon: 'share-2', group: 'People & connections', routes: ['graph'], blocks: ['relationship-web', 'connection-map'], description: 'How your entries are connected, as a picture you can explore.', whenOff: 'Connections stay on every entry.' },
	{ id: 'tasks', plural: true, label: 'Tasks', icon: 'list-checks', group: 'Organising', routes: ['tasks'], blocks: ['checklist', 'task-attention', 'task-board', 'task-calendar', 'task-chart', 'task-focus', 'task-list', 'task-notes', 'task-progress-types', 'task-stats'], description: 'To-dos on entries, with due dates, and a page to plan them.', whenOff: 'Tasks are kept.' },
	{ id: 'dashboards', plural: true, label: 'Dashboards', icon: 'layout-dashboard', group: 'Organising', routes: [], blocks: [], description: 'Pages of your own, built from widgets, beside Home.', whenOff: 'Home stays; your other dashboards are kept.' },
	{ id: 'media', label: 'Media library', icon: 'images', group: 'Organising', routes: ['media'], blocks: [], description: 'Every image in the world in one place, with missing ones found.', whenOff: 'Images stay on entries and maps.' },
];

export const FEATURE_IDS = FEATURES.map((f) => f.id);

export type FeatureFlags = Partial<Record<FeatureId, boolean>>;

/** Is a feature on in this world? (Absent = on.) */
export function featureOn(flags: FeatureFlags | undefined | null, id: FeatureId): boolean {
	return flags?.[id] !== false;
}

/** The feature a page belongs to (a dashboard other than Home is a Dashboards page). */
export function featureOfRoute(name: string, params?: Record<string, string>): FeatureId | null {
	if (name === 'dashboard') return params?.id && params.id !== 'home' ? 'dashboards' : null;
	return FEATURES.find((f) => f.routes.includes(name))?.id ?? null;
}

export function featureOfBlock(type: string): FeatureId | null {
	return FEATURES.find((f) => f.blocks.includes(type))?.id ?? null;
}

/** Flags made safe (only known features, only true/false). */
export function cleanFeatures(v: unknown): FeatureFlags {
	const out: FeatureFlags = {};
	if (!v || typeof v !== 'object') return out;
	for (const id of FEATURE_IDS) {
		const x = (v as Record<string, unknown>)[id];
		if (typeof x === 'boolean') out[id] = x;
	}
	return out;
}
