import type { FieldDefinition, SemanticColor } from '../../core/types';
import { SEMANTIC_COLORS } from '../../core/types';
import { own } from '../../ui/components/lifecycle';
import type { BlockRenderContext } from '../BlockRegistry';

/** Dispatched on a dashboard page to enter Customize (world banner button, command, menus). */
export const CUSTOMIZE_DASHBOARD_EVENT = 'worldsmith-customize-dashboard';

/**
 * Repaint when the world's data changes. Dashboard widgets aggregate over many entries, so:
 *  - bursts (typing in another pane, a bulk import) become one repaint after a short pause;
 *  - a widget that isn't on screen (a background tab) doesn't repaint at all — it catches
 *    up the moment it becomes visible again.
 */
export function watchWorld(
	ctx: BlockRenderContext,
	paint: () => void,
	o: { entities?: boolean | ((keys: string[]) => boolean); edges?: boolean; schemas?: boolean; world?: boolean | ((keys: string[]) => boolean); tasks?: boolean } = {},
): void {
	let timer: number | null = null;
	let stale = false;
	const shown = () => ctx.el.isConnected && ctx.el.getClientRects().length > 0;
	const run = () => {
		timer = null;
		if (!ctx.el.isConnected) return;
		if (!shown()) {
			stale = true;
			return;
		}
		stale = false;
		paint();
	};
	const schedule = () => {
		if (timer !== null) window.clearTimeout(timer);
		timer = window.setTimeout(() => window.requestAnimationFrame(run), 220);
	};
	ctx.component.register(() => {
		if (timer !== null) window.clearTimeout(timer);
	});
	// Hidden tabs are display:none; this fires when the tab is shown again.
	if (typeof IntersectionObserver !== 'undefined') {
		const io = new IntersectionObserver((entries) => {
			if (stale && entries.some((e) => e.isIntersecting)) {
				stale = false;
				paint();
			}
		});
		io.observe(ctx.el);
		ctx.component.register(() => io.disconnect());
	}
	const ev = ctx.session.events;
	const c = ctx.component;
	if (o.entities !== false) {
		own(c, ev.on('entity:created', schedule));
		own(c, ev.on('entity:deleted', schedule));
		own(
			c,
			ev.on('entity:updated', ({ change }) => {
				if (typeof o.entities !== 'function' || o.entities(change.keys)) schedule();
			}),
		);
	}
	if (o.edges) for (const e of ['edge:created', 'edge:updated', 'edge:deleted'] as const) own(c, ev.on(e, schedule));
	if (o.schemas !== false) for (const e of ['schema:created', 'schema:updated', 'schema:deleted'] as const) own(c, ev.on(e, schedule));
	if (o.tasks) for (const e of ['task:created', 'task:updated', 'task:deleted'] as const) own(c, ev.on(e, schedule));
	if (o.world)
		own(
			c,
			ev.on('world:updated', ({ keys }) => {
				if (typeof o.world !== 'function' || o.world(keys)) schedule();
			}),
		);
}

export const num = (v: unknown, d: number, min = -Infinity, max = Infinity): number => {
	const n = typeof v === 'number' ? v : typeof v === 'string' ? Number.parseFloat(v) : Number.NaN;
	return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : d;
};

export const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);

export function colorOf(v: unknown, d: SemanticColor = 'purple'): SemanticColor {
	return SEMANTIC_COLORS.includes(v as SemanticColor) ? (v as SemanticColor) : d;
}

export const COLOR_FIELD: FieldDefinition = {
	id: 'color',
	type: 'select',
	label: 'Color',
	config: { options: [{ id: '__type', label: 'The type’s color' }, ...SEMANTIC_COLORS.map((c) => ({ id: c, label: c[0]!.toUpperCase() + c.slice(1), color: c }))] },
};

/** A small, curated icon set for number tiles (the full picker is a modal away). */
export const TILE_ICONS = ['hash', 'users', 'user', 'map-pin', 'castle', 'shield', 'crown', 'sparkles', 'flame', 'swords', 'scroll-text', 'book-open', 'gem', 'skull', 'heart', 'target', 'trending-up', 'percent', 'calendar', 'star'];

export const ICON_FIELD: FieldDefinition = {
	id: 'icon',
	type: 'select',
	label: 'Icon',
	config: { options: [{ id: '__type', label: 'The type’s icon' }, ...TILE_ICONS.map((i) => ({ id: i, label: i.replace(/-/g, ' '), icon: i }))] },
};
