import type { BlockInstance, SemanticColor } from '../core/types';
import { uuid } from '../core/util/ids';
import type { WorldSession } from '../services/WorldSession';
import { DASHBOARD_LAYOUT, materialize } from './defaults';

type B = Omit<BlockInstance, 'id'>;
const blk = (type: string, x: number, y: number, w: number, config: Record<string, unknown> = {}, title?: string): B => ({ type, x, y, w, h: 1, config, ...(title ? { title } : {}) });

export interface DashboardTemplate {
	id: string;
	name: string;
	icon: string;
	color: SemanticColor | null;
	/** What it's for, shown on the "New dashboard" card. */
	blurb: string;
	/** Types the template is about; it's offered only when at least one exists. */
	needs?: string[];
	blocks(s: WorldSession): B[];
}

/**
 * Starting points for a new dashboard. Every template only uses types the world has: a
 * widget about a type that was removed is left out rather than shown empty.
 */
export const DASHBOARD_TEMPLATES: DashboardTemplate[] = [
	{
		id: 'blank',
		name: 'Blank',
		icon: 'layout-template',
		color: null,
		blurb: 'An empty page. Add exactly the widgets you want.',
		blocks: () => [],
	},
	{
		id: 'cast',
		name: 'Cast',
		icon: 'users',
		color: 'purple',
		blurb: 'Every character at a glance: portraits, roles and who’s connected to whom.',
		needs: ['character'],
		blocks: () => [
			blk('entry-stat', 0, 0, 3, { type: 'character', measure: 'count', label: 'Characters' }),
			blk('entry-stat', 3, 0, 3, { type: 'character', measure: 'count', label: 'Main cast', whereField: 'importance', whereOp: 'is', whereValue: 'Main', icon: 'star', color: 'yellow', compare: false }),
			blk('entry-stat', 6, 0, 3, { type: 'character', measure: 'avg', field: 'age', label: 'Average age', icon: 'calendar', color: 'cyan' }),
			blk('entry-stat', 9, 0, 3, { type: 'character', measure: 'progress', label: 'Developed', icon: 'trending-up', color: 'blue' }),
			blk('image-wall', 0, 1, 12, { types: ['character'], source: 'portraits', limit: 12 }, 'The cast'),
			blk('entry-list', 0, 2, 7, { type: 'character', style: 'table', sort: 'name', dir: 'asc', limit: 12, columns: ['storyRole', 'occupation', '__status'] }, 'Who’s who'),
			blk('entry-chart', 7, 2, 5, { type: 'character', groupBy: 'field:storyRole', style: 'donut', hideEmpty: true }),
			blk('spotlight', 7, 3, 5, { types: ['character'], prefer: 'images' }),
			blk('recent-connections', 7, 4, 5, { limit: 6 }),
		],
	},
	{
		id: 'politics',
		name: 'Politics',
		icon: 'landmark',
		color: 'red',
		blurb: 'Factions, nations and faiths: who holds power, how stable it is, who’s allied.',
		needs: ['faction', 'nation'],
		blocks: () => [
			blk('entry-stat', 0, 0, 3, { type: 'faction', measure: 'count', label: 'Factions' }),
			blk('entry-stat', 3, 0, 3, { type: 'nation', measure: 'count', label: 'Nations & realms' }),
			blk('entry-stat', 6, 0, 3, { type: 'religion', measure: 'count', label: 'Religions' }),
			blk('entry-stat', 9, 0, 3, { type: 'nation', measure: 'count', label: 'Unstable realms', whereField: 'stability', whereOp: 'is-not', whereValue: 'Stable', icon: 'flame', color: 'orange', compare: false }),
			blk('entry-list', 0, 1, 7, { type: 'faction', style: 'table', sort: 'name', dir: 'asc', limit: 12, columns: ['factionType', 'influence', 'standing'] }, 'Factions'),
			blk('entry-chart', 7, 1, 5, { type: 'faction', groupBy: 'field:influence', style: 'bars', hideEmpty: true }),
			blk('entry-list', 0, 2, 7, { type: 'nation', style: 'table', sort: 'name', dir: 'asc', limit: 12, columns: ['government', 'stability', 'population'] }, 'Nations & realms'),
			blk('entry-chart', 7, 2, 5, { type: 'nation', groupBy: 'field:government', style: 'donut', hideEmpty: true }),
			blk('recent-connections', 7, 3, 5, { limit: 6 }),
		],
	},
	{
		id: 'session',
		name: 'Session prep',
		icon: 'dices',
		color: 'green',
		blurb: 'For game nights: tonight’s focus, quick links, open threads and your notes.',
		blocks: () => [
			blk('featured-entry', 0, 0, 7, { entityId: '' }, 'Tonight’s focus'),
			blk('links', 7, 0, 5, { links: [] }, 'Quick links'),
			blk('entry-list', 0, 1, 4, { type: '__any', only: 'pinned', style: 'list', limit: 8 }, 'Pinned'),
			blk('task-due-soon', 4, 1, 4, { limit: 6, days: 7, overdue: true }),
			blk('task-notes', 8, 1, 4, {}),
			blk('entry-list', 0, 2, 12, { type: 'location', style: 'cards', limit: 6, sort: 'updated' }, 'Places in play'),
		],
	},
	{
		id: 'home',
		name: 'Copy of Home',
		icon: 'home',
		color: 'blue',
		blurb: 'Start from Home’s current widgets and change what you like.',
		blocks: (s) => s.layouts.dashboardLayout('home', () => materialize(DASHBOARD_LAYOUT)).blocks,
	},
];

/** Drop widgets about types this world doesn't have (deleted, or never added). */
export function withoutMissingTypes<T extends Pick<BlockInstance, 'config'>>(s: WorldSession, blocks: T[]): T[] {
	return blocks.filter((b) => {
		const type = b.config.type;
		if (typeof type === 'string' && type && type !== '__any' && !s.schemas.get(type)) return false;
		const types = b.config.types;
		if (Array.isArray(types) && types.length && !types.some((x) => typeof x === 'string' && s.schemas.get(x))) return false;
		return true;
	});
}

/** A template's widgets for this world: unknown types dropped, fresh ids. */
export function templateBlocks(s: WorldSession, t: DashboardTemplate): BlockInstance[] {
	return withoutMissingTypes(s, t.blocks(s)).map((b) => ({ ...b, id: `${b.type}-${uuid().slice(0, 8)}`, config: JSON.parse(JSON.stringify(b.config)) as Record<string, unknown> }));
}

export function availableTemplates(s: WorldSession): DashboardTemplate[] {
	return DASHBOARD_TEMPLATES.filter((t) => !t.needs || t.needs.some((id) => s.schemas.get(id)));
}
