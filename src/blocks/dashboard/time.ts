import type { FieldDefinition } from '../../core/types';
import { own } from '../../ui/components/lifecycle';
import { collectTimeline, datedTypes } from '../../services/timeline';
import { ROUTES } from '../../state/route';
import { button, emptyState } from '../../ui/components/dom';
import { renderTimelineAxis, renderTimelineList } from '../../ui/timeline/render';
import type { BlockDefinition, BlockRenderContext } from '../BlockRegistry';
import { num, watchWorld } from './common';

const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/**
 * Timeline widget (0.10). On a dashboard: the world's dated entries (optionally a few
 * types), as a list or a small timeline. On an entry: that entry and everything connected
 * to it, so a character's page shows their life among the events around them.
 */
export const timelineBlock: BlockDefinition = {
	id: 'timeline',
	name: 'Timeline',
	icon: 'gantt-chart',
	category: 'Time',
	description: 'Dated entries in order. On an entry, it shows that entry and what it’s connected to.',
	hint: 'Dated entries in order',
	surfaces: ['dashboard', 'entity'],
	frame: 'card',
	defaultSize: { w: 6, h: 2 },
	minW: 3,
	defaultConfig: { types: [], show: 'list', limit: 8 },
	configFields: (s) => {
		const out: FieldDefinition[] = [
			{ id: 'show', type: 'select', label: 'Show as', config: { options: [{ id: 'list', label: 'List' }, { id: 'axis', label: 'Timeline' }] } },
			{ id: 'limit', type: 'number', label: 'How many (list)', config: { min: 3, max: 50 } },
			{ id: 'types', type: 'multiselect', label: 'Only these types', placeholder: 'Every type with dates', width: 'full', config: { options: datedTypes(s).map((t) => ({ id: t.id, label: t.plural, icon: t.icon })) } },
		];
		return out;
	},
	render(ctx) {
		const paint = () => draw(ctx);
		paint();
		watchWorld(ctx, paint, { entities: (k) => k.some((x) => x === 'name' || x === 'trashedAt' || x === 'tags' || x.startsWith('values')), edges: ctx.surface === 'entity', world: (k) => k.includes('timeline') || k.includes('mainCalendar') });
		for (const e of ['calendar:saved', 'calendar:deleted'] as const) own(ctx.component, ctx.session.events.on(e, paint));
	},
};

function draw(ctx: BlockRenderContext): void {
	const el = ctx.el;
	el.empty();
	const s = ctx.session;
	const root = el.createDiv({ cls: 'ws-tl-widget' });
	let ids: Set<string> | undefined;
	if (ctx.surface === 'entity' && ctx.entity) {
		ids = new Set([ctx.entity.id]);
		for (const edge of s.relations.edgesTouching(ctx.entity.id)) ids.add(edge.from === ctx.entity.id ? edge.to : edge.from);
		for (const e of s.entities.values()) if (e.parentId === ctx.entity.id) ids.add(e.id);
	}
	const data = collectTimeline(s, { types: strs(ctx.config.types), entityIds: ids });
	if (!data.items.length) {
		emptyState(root, {
			compact: true,
			icon: 'gantt-chart',
			title: ctx.surface === 'entity' ? 'No dates here yet' : 'Nothing dated yet',
			body: ctx.surface === 'entity' ? 'Give this entry or its connections a date and they line up here.' : 'Entries with a date (Start, Birth date, Founded…) appear here.',
		});
		return;
	}
	const nav = (r: Parameters<BlockRenderContext['navigate']>[0], l?: boolean | 'tab') => ctx.navigate(r, l);
	if (ctx.config.show === 'axis') renderTimelineAxis(root, data, nav);
	else renderTimelineList(root, data, nav, { limit: num(ctx.config.limit, 8, 3, 50), highlight: ctx.entity?.id, compact: true });
	const foot = root.createDiv({ cls: 'ws-tl-widget__foot' });
	button(foot, { label: 'Open timeline', icon: 'arrow-up-right', variant: 'quiet', size: 'sm', onClick: (e) => ctx.navigate(ROUTES.timeline(), e.metaKey || e.ctrlKey ? 'tab' : false) });
}
