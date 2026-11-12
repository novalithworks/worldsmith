import type { BlockInstance, EntitySchema, LayoutTemplate } from '../core/types';

/**
 * Built-in default layouts. Resolution order for an entity page (ARCHITECTURE §8.2):
 *   entity override (M6) → type layout (M6) → schema.defaultLayout → TYPE_LAYOUTS → generic
 */
type B = Omit<BlockInstance, 'id'>;
const blk = (type: string, x: number, y: number, w: number, config: Record<string, unknown> = {}, h = 1): B => ({
	type,
	x,
	y,
	w,
	h,
	config,
});

/** Main column (8) with a side column (4). */
export const GENERIC_ENTITY_LAYOUT: LayoutTemplate = {
	blocks: [
		blk('hero', 0, 0, 12),
		blk('description', 0, 1, 8),
		blk('properties', 0, 2, 8, { sections: null, columns: 2 }),
		blk('connections', 0, 3, 8),
		blk('progress', 8, 1, 4),
		blk('checklist', 8, 2, 4),
		blk('unused-data', 8, 3, 4),
		blk('names-tags', 8, 4, 4),
		blk('linked-note', 8, 5, 4),
		blk('children', 8, 6, 4),
		blk('gallery', 8, 7, 4, { columns: 2 }),
	],
};

const TYPE_LAYOUTS: Record<string, LayoutTemplate> = {
	character: {
		blocks: [
			blk('hero', 0, 0, 12),
			blk('description', 0, 1, 8),
			blk('properties', 0, 2, 8, { sections: ['basic', 'appearance', 'personality'], columns: 2 }),
			// Everything not in the first block — including sections added later in Type Studio.
			blk('properties', 0, 3, 8, { exclude: ['basic', 'appearance', 'personality'], columns: 2, title: 'Story & growth' }),
			blk('connections', 0, 4, 8),
			blk('progress', 8, 1, 4),
			blk('checklist', 8, 2, 4),
			blk('unused-data', 8, 3, 4),
			blk('names-tags', 8, 4, 4),
			blk('linked-note', 8, 5, 4),
			blk('gallery', 8, 6, 4, { columns: 2 }),
		],
	},
	location: {
		blocks: [
			blk('hero', 0, 0, 12),
			blk('description', 0, 1, 8),
			blk('children', 0, 2, 8, { title: 'Places within' }),
			blk('properties', 0, 3, 8, { sections: null, columns: 2 }),
			blk('connections', 0, 4, 8),
			blk('progress', 8, 1, 4),
			blk('checklist', 8, 2, 4),
			blk('unused-data', 8, 3, 4),
			blk('gallery', 8, 4, 4, { columns: 2 }),
			blk('names-tags', 8, 5, 4),
			blk('linked-note', 8, 6, 4),
		],
	},
};

export function defaultLayoutFor(schema: EntitySchema | undefined): BlockInstance[] {
	const template = schema?.defaultLayout ?? (schema ? TYPE_LAYOUTS[schema.origin?.templateId ?? schema.id] : undefined) ?? GENERIC_ENTITY_LAYOUT;
	return materialize(template);
}

/**
 * Home, the world's hub (Milestone 7): banner, a row of numbers, a line from the archives,
 * the contents, what's new and what needs doing. Shown until Home is customized.
 */
export const DASHBOARD_LAYOUT: LayoutTemplate = {
	blocks: [
		blk('world-hero', 0, 0, 12),
		blk('entry-stat', 0, 1, 3, { type: '__any', measure: 'count', label: 'Entries', icon: 'book-open', color: 'purple' }),
		blk('entry-stat', 3, 1, 3, { type: 'character', measure: 'count', label: 'Characters', color: 'purple' }),
		blk('entry-stat', 6, 1, 3, { type: 'location', measure: 'count', label: 'Places', color: 'green' }),
		blk('entry-stat', 9, 1, 3, { type: '__any', measure: 'progress', label: 'Developed', icon: 'trending-up', color: 'blue' }),
		blk('contents', 0, 2, 7),
		blk('recent', 0, 3, 7),
		blk('random-quote', 0, 4, 7),
		blk('spotlight', 7, 2, 5),
		blk('quick-create', 7, 3, 5),
		blk('task-due-soon', 7, 4, 5, { limit: 5, days: 7, overdue: true }),
		blk('world-attention', 7, 5, 5),
		blk('favorites', 7, 6, 5),
	],
};

/** The Tasks home, as approved in the design mockup. */
export const TASKS_LAYOUT: LayoutTemplate = {
	blocks: [
		blk('task-stats', 0, 0, 12),
		blk('task-calendar', 0, 1, 8),
		blk('task-list', 0, 2, 8),
		blk('task-due-soon', 8, 1, 4, { limit: 5, days: 7, overdue: true }),
		blk('task-progress-types', 8, 2, 4),
		blk('task-attention', 8, 3, 4, { limit: 3 }),
	],
};

/** Give template blocks stable ids (derived from position so collapse state survives re-render). */
export function materialize(t: LayoutTemplate): BlockInstance[] {
	return t.blocks.map((b, i) => ({ ...b, id: b.id ?? `${b.type}-${i}`, config: { ...b.config } }));
}
