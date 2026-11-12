import type { BlockInstance, EntitySchema } from '../core/types';
import { defaultLayoutFor } from './defaults';
import { compact, normalize } from './engine/grid';

/**
 * Layout presets (Milestone 9): ready-made page layouts for any type, built from the
 * type's own fields so nothing shows an empty “choose a field” card. Every preset shows every
 * section (a Details widget over “all sections”) plus the side widgets, so switching preset
 * never hides data — it only arranges it differently.
 */

export interface LayoutPreset {
	id: string;
	label: string;
	icon: string;
	description: string;
	build(schema: EntitySchema): BlockInstance[];
}

type B = Omit<BlockInstance, 'id'>;
const blk = (type: string, x: number, y: number, w: number, config: Record<string, unknown> = {}, h = 1): B => ({ type, x, y, w, h, config });

const NUMERIC = new Set(['number', 'percent', 'rating', 'progress']);
const hasNumbers = (s: EntitySchema) => s.fields.some((f) => !f.hidden && NUMERIC.has(f.type));
const hasLinks = (s: EntitySchema) => s.fields.some((f) => !f.hidden && f.type === 'relation');
const hasCardFields = (s: EntitySchema) => s.display.cardFields.some((id) => s.fields.some((f) => f.id === id && !f.hidden));
const hasChildren = (s: EntitySchema) => s.hierarchy.allowParent;

/** Stack blocks in a column: each gets the next row. */
function column(x: number, w: number, y0: number, items: Array<[string, Record<string, unknown>?] | false>): B[] {
	const out: B[] = [];
	let y = y0;
	for (const it of items) {
		if (!it) continue;
		out.push(blk(it[0], x, y++, w, it[1] ?? {}));
	}
	return out;
}

function finish(presetId: string, blocks: B[]): BlockInstance[] {
	const withIds = blocks.map((b, i) => ({ ...b, id: `${presetId}-${b.type}-${i}`, config: { ...b.config } }));
	return compact(normalize(withIds));
}

export const LAYOUT_PRESETS: LayoutPreset[] = [
	{
		id: 'standard',
		label: 'Standard',
		icon: 'layout-dashboard',
		description: 'Worldsmith’s layout for this type: the story in a wide column, the extras at the side.',
		build: (s) => compact(normalize(defaultLayoutFor(s))),
	},
	{
		id: 'profile',
		label: 'Profile',
		icon: 'contact',
		description: 'A portrait column beside the story — made for people, creatures and anyone with a face.',
		build: (s) =>
			finish('profile', [
				blk('hero', 0, 0, 12),
				...column(0, 4, 1, [
					['image-spotlight', { source: 'portrait', aspect: 'portrait', caption: false }],
					hasNumbers(s) && ['stat-block', { fields: null, max: 10, showEmpty: false }],
					['names-tags'],
					['progress'],
					['checklist'],
					['linked-note'],
				]),
				...column(4, 8, 1, [
					['description'],
					hasCardFields(s) && ['key-facts', { fields: null }],
					['properties', { sections: null, columns: 2 }],
					['connections'],
					hasLinks(s) && ['relationship-web', { max: 14, size: 'medium', labels: true }],
					hasChildren(s) && ['children'],
					['gallery', { columns: 3 }],
					['unused-data'],
				]),
			]),
	},
	{
		id: 'encyclopedia',
		label: 'Encyclopedia',
		icon: 'book-open-text',
		description: 'Reads like an article — every section in one long column, with a picture and the essentials at the side.',
		build: (s) =>
			finish('encyclopedia', [
				blk('hero', 0, 0, 12),
				...column(0, 8, 1, [
					['description'],
					['properties', { sections: null, columns: 1 }],
					hasChildren(s) && ['children'],
					['connections'],
					['gallery', { columns: 3 }],
				]),
				...column(8, 4, 1, [
					['image-spotlight', { source: 'auto', aspect: 'landscape', caption: true }],
					hasNumbers(s) && ['stat-block', { fields: null, max: 10, showEmpty: false }],
					['names-tags'],
					['progress'],
					['checklist'],
					['linked-note'],
					['unused-data'],
				]),
			]),
	},
	{
		id: 'visual',
		label: 'Visual',
		icon: 'image',
		description: 'Pictures first: a large image beside the summary, then the whole gallery, then the details.',
		build: (s) =>
			finish('visual', [
				blk('hero', 0, 0, 12),
				blk('image-spotlight', 0, 1, 7, { source: 'auto', aspect: 'wide', caption: true }, 2),
				blk('description', 7, 1, 5),
				blk('names-tags', 7, 2, 5),
				blk('gallery', 0, 3, 12, { layout: 'grid', columns: 4 }),
				...column(0, 8, 4, [hasCardFields(s) && ['key-facts', { fields: null }], ['properties', { sections: null, columns: 2 }], ['connections'], hasChildren(s) && ['children']]),
				...column(8, 4, 4, [['progress'], ['checklist'], ['linked-note'], ['unused-data']]),
			]),
	},
	{
		id: 'one-column',
		label: 'One column',
		icon: 'rows-3',
		description: 'Everything full width, one after another — good for short entries and narrow screens.',
		build: (s) =>
			finish('one-column', [
				...column(0, 12, 0, [
					['hero'],
					['description'],
					hasCardFields(s) && ['key-facts', { fields: null }],
					['properties', { sections: null, columns: 3 }],
					['connections'],
					hasChildren(s) && ['children'],
					['gallery', { columns: 4 }],
				]),
				blk('names-tags', 0, 20, 6),
				blk('linked-note', 6, 20, 6),
				blk('progress', 0, 21, 6),
				blk('checklist', 6, 21, 6),
				blk('unused-data', 0, 22, 12),
			]),
	},
];

export function presetById(id: string): LayoutPreset | undefined {
	return LAYOUT_PRESETS.find((p) => p.id === id);
}

/** What a layout looks like, ignoring block ids and stored-only details. */
function signature(blocks: BlockInstance[]): string {
	return JSON.stringify(
		compact(normalize(blocks))
			.filter((b) => !b.hidden)
			.map((b) => [b.type, b.x, b.y, b.w, b.h, b.title ?? null, Object.entries(b.config).sort(([a], [z]) => a.localeCompare(z))])
			.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
	);
}

export function sameLayout(a: BlockInstance[], b: BlockInstance[]): boolean {
	return signature(a) === signature(b);
}

/** The preset a layout currently matches, if any. */
export function matchingPreset(schema: EntitySchema, blocks: BlockInstance[]): LayoutPreset | undefined {
	return LAYOUT_PRESETS.find((p) => sameLayout(p.build(schema), blocks));
}

const strArr = (v: unknown): string[] | null => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null);

/**
 * Another type's layout made to fit this type: widgets that name sections or fields keep
 * only the ones this type has. A widget left with nothing to show falls back to its
 * automatic choice (or, for a single-field card, is left out).
 */
export function adaptLayout(blocks: BlockInstance[], target: EntitySchema): BlockInstance[] {
	const sectionIds = new Set(target.sections.map((s) => s.id));
	const fieldIds = new Set(target.fields.map((f) => f.id));
	const out: BlockInstance[] = [];
	const hasAllSections = () => out.some((b) => b.type === 'properties' && !Array.isArray(b.config.sections));
	for (const raw of JSON.parse(JSON.stringify(blocks)) as BlockInstance[]) {
		const b = { ...raw, config: { ...raw.config } };
		const c = b.config;
		if (b.type === 'properties') {
			const secs = strArr(c.sections);
			if (secs) {
				const kept = secs.filter((id) => sectionIds.has(id));
				if (kept.length) c.sections = kept;
				else if (hasAllSections()) continue;
				else {
					c.sections = null;
					delete c.title;
					b.title = null;
				}
			}
			const ex = strArr(c.exclude);
			if (ex) {
				const kept = ex.filter((id) => sectionIds.has(id));
				// “Everything except …” with nothing left to except is every section — already shown.
				if (!kept.length && hasAllSections()) continue;
				c.exclude = kept;
			}
		}
		for (const key of ['fields'] as const) {
			const list = strArr(c[key]);
			if (list) {
				const kept = list.filter((id) => fieldIds.has(id));
				c[key] = kept.length ? kept : null;
			}
		}
		if (typeof c.field === 'string' && !fieldIds.has(c.field)) {
			if (b.type === 'single-field') continue;
			c.field = null;
		}
		out.push(b);
	}
	return compact(normalize(out));
}
