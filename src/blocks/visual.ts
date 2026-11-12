import type { FieldDefinition, TreeDoc } from '../core/types';
import { hydrateGraph, hydrateTree } from '../data/migrations/records';
import { graphData } from '../services/graph';
import { familyLinks, layoutFamily, layoutHierarchy } from '../services/trees';
import { itemFor, itemLabel, mapsOf } from '../services/maps';
import { ROUTES } from '../state/route';
import { button, cx, emptyState } from '../ui/components/dom';
import { own } from '../ui/components/lifecycle';
import { renderGraph } from '../ui/graph/render';
import { renderMap } from '../ui/maps/render';
import { renderTree, treeMetrics } from '../ui/trees/render';
import type { BlockDefinition, BlockRenderContext } from './BlockRegistry';
import { num, str, watchWorld } from './dashboard/common';

/**
 * Widgets for family trees, the relationship graph and maps (0.11). On an entry they're
 * drawn around that entry; on a dashboard they show one of your saved trees, graphs or
 * maps. Each has a button to open the full page.
 */

const HEIGHT_FIELD: FieldDefinition = {
	id: 'height',
	type: 'select',
	label: 'Height',
	config: { options: [{ id: 'small', label: 'Small' }, { id: 'medium', label: 'Medium' }, { id: 'large', label: 'Large' }] },
};
const height = (v: unknown) => (['small', 'medium', 'large'].includes(v as string) ? (v as string) : 'medium');
const mod = (e: MouseEvent) => (e.metaKey || e.ctrlKey ? 'tab' : false);

/** A canvas in a widget: cleaned up when the widget goes, or before it repaints. */
function canvasSlot(ctx: BlockRenderContext) {
	let current: { destroy(): void } | null = null;
	own(ctx.component, { dispose: () => current?.destroy() });
	return (next: { destroy(): void } | null) => {
		current?.destroy();
		current = next;
	};
}

function foot(ctx: BlockRenderContext, root: HTMLElement, label: string, run: (e: MouseEvent) => void): void {
	const f = root.createDiv({ cls: 'ws-vis-widget__foot' });
	button(f, { label, icon: 'arrow-up-right', variant: 'quiet', size: 'sm', onClick: run });
}

// ── Family tree ─────────────────────────────────────────────────────────────────

export const familyTreeBlock: BlockDefinition = {
	id: 'family-tree',
	name: 'Family tree',
	icon: 'network',
	category: 'Connections',
	description: 'On an entry: their parents, partners and children as a small tree. On a dashboard: one of your saved trees.',
	hint: 'Parents, partners and children',
	surfaces: ['entity', 'dashboard'],
	frame: 'card',
	defaultSize: { w: 8, h: 2 },
	minW: 4,
	defaultConfig: { up: 1, down: 1, card: 'compact', height: 'medium', tree: '' },
	configFields: (s) => {
		const out: FieldDefinition[] = [];
		const trees = s.trees.list();
		if (trees.length) out.push({ id: 'tree', type: 'select', label: 'On a dashboard, show', config: { options: [{ id: '', label: 'The first tree' }, ...trees.map((t) => ({ id: t.id, label: t.name }))] } });
		out.push(
			{ id: 'up', type: 'number', label: 'Generations above (on an entry)', config: { min: 0, max: 4 } },
			{ id: 'down', type: 'number', label: 'Generations below (on an entry)', config: { min: 0, max: 4 } },
			{ id: 'card', type: 'select', label: 'Cards', config: { options: [{ id: 'portrait', label: 'Portraits' }, { id: 'compact', label: 'Compact' }, { id: 'name', label: 'Names' }] } },
			HEIGHT_FIELD,
		);
		return out;
	},
	title: (ctx) => (ctx.surface === 'dashboard' ? (ctx.session.trees.get(str(ctx.config.tree))?.name ?? ctx.session.trees.list()[0]?.name ?? 'Family tree') : 'Family'),
	render(ctx) {
		const slot = canvasSlot(ctx);
		const paint = () => drawTree(ctx, slot);
		paint();
		watchWorld(ctx, paint, { entities: (k) => k.some((x) => ['name', 'trashedAt', 'media', 'parentId', 'status'].includes(x) || x.startsWith('values')), edges: true });
		own(ctx.component, ctx.session.events.on('doc:saved', ({ kind }) => kind === 'tree' && ctx.surface === 'dashboard' && paint()));
	},
};

function drawTree(ctx: BlockRenderContext, slot: ReturnType<typeof canvasSlot>): void {
	const s = ctx.session;
	ctx.el.empty();
	slot(null);
	const root = ctx.el.createDiv({ cls: cx('ws-vis-widget', `ws-vis-widget--${height(ctx.config.height)}`) });
	let doc: TreeDoc | undefined;
	if (ctx.surface === 'entity' && ctx.entity) {
		const saved = s.trees.list().find((t) => t.kind === 'family' && t.rootId === ctx.entity!.id);
		doc = hydrateTree({
			...(saved ?? {}),
			id: '__widget',
			name: 'Family',
			kind: 'family',
			rootId: ctx.entity.id,
			up: num(ctx.config.up, 1, 0, 4),
			down: num(ctx.config.down, 1, 0, 4),
			card: ['portrait', 'compact', 'name'].includes(ctx.config.card as string) ? ctx.config.card : 'compact',
			background: 'plain',
			show: { photos: true, dates: true, type: false, partners: true, siblings: true, status: false },
		})!.record;
		const L = familyLinks(s, doc);
		const id = ctx.entity.id;
		if (!L.parents(id).length && !L.children(id).length && !L.partners(id).length) {
			emptyState(root, {
				compact: true,
				icon: 'network',
				title: 'No family recorded yet',
				body: 'Add parents, partners or children on the family tree, and they show here.',
				actionLabel: 'Open the family tree',
				actionIcon: 'network',
				onAction: () => openFamily(ctx),
			});
			return;
		}
	} else {
		doc = s.trees.get(str(ctx.config.tree)) ?? s.trees.list()[0];
		if (!doc) {
			emptyState(root, { compact: true, icon: 'network', title: 'No trees yet', body: 'Make one on the Trees page and it shows here.', actionLabel: 'Trees', actionIcon: 'network', onAction: () => ctx.navigate(ROUTES.trees()) });
			return;
		}
	}
	const m = treeMetrics(doc);
	const layout = doc.kind === 'family' ? layoutFamily(s, doc, m, familyLinks(s, doc)) : layoutHierarchy(s, doc, m);
	if (!layout) {
		emptyState(root, { compact: true, icon: 'user-x', title: 'This tree has lost its starting point', body: 'Open it to choose who it starts from.' });
		return;
	}
	const host = root.createDiv({ cls: 'ws-vis-widget__canvas' });
	slot(renderTree(host, ctx.app, s, doc, layout, { open: (id, evt) => ctx.navigate(ROUTES.entity(id), mod(evt)), scrollPage: true }));
	foot(ctx, root, 'Open family tree', (e) => (ctx.surface === 'entity' ? openFamily(ctx, e) : ctx.navigate(ROUTES.trees(doc.id), mod(e))));
}

/** The entry's own family tree, made the first time it's asked for. */
function openFamily(ctx: BlockRenderContext, evt?: MouseEvent): void {
	const s = ctx.session;
	const e = ctx.entity;
	if (!e) return;
	let t = s.trees.list().find((x) => x.kind === 'family' && x.rootId === e.id);
	if (!t) {
		s.ensureRelationKinds(['parent-of', 'marriage']);
		t = s.trees.create({ name: `${e.name}’s family`, kind: 'family', rootId: e.id });
	}
	ctx.navigate(ROUTES.trees(t.id), evt ? mod(evt) : false);
}

// ── Connection map ──────────────────────────────────────────────────────────────

export const connectionMapBlock: BlockDefinition = {
	id: 'connection-map',
	name: 'Connection map',
	icon: 'share-2',
	category: 'Connections',
	description: 'Who is connected to whom, as a web of dots and lines. On an entry it centres on that entry.',
	hint: 'A web of connections',
	surfaces: ['entity', 'dashboard'],
	frame: 'card',
	defaultSize: { w: 8, h: 2 },
	minW: 4,
	defaultConfig: { depth: 1, view: '', labels: 'always', height: 'medium' },
	configFields: (s) => {
		const out: FieldDefinition[] = [];
		const views = s.graphs.list();
		if (views.length) out.push({ id: 'view', type: 'select', label: 'Look', config: { options: [{ id: '', label: 'Whole world' }, ...views.map((v) => ({ id: v.id, label: `Like “${v.name}”` }))] } });
		out.push(
			{ id: 'depth', type: 'select', label: 'Steps out (on an entry)', config: { options: [{ id: '1', label: 'Direct connections' }, { id: '2', label: 'Two steps' }, { id: '3', label: 'Three steps' }] } },
			{ id: 'labels', type: 'select', label: 'Names', config: { options: [{ id: 'always', label: 'Always' }, { id: 'hover', label: 'On hover' }] } },
			HEIGHT_FIELD,
		);
		return out;
	},
	title: (ctx) => (ctx.surface === 'entity' ? 'Connection map' : (ctx.session.graphs.get(str(ctx.config.view))?.name ?? 'Connections')),
	render(ctx) {
		const slot = canvasSlot(ctx);
		const paint = () => drawGraph(ctx, slot);
		paint();
		watchWorld(ctx, paint, { entities: (k) => k.some((x) => ['name', 'trashedAt', 'archivedAt', 'media', 'tags', 'typeId'].includes(x)), edges: true });
	},
};

function drawGraph(ctx: BlockRenderContext, slot: ReturnType<typeof canvasSlot>): void {
	const s = ctx.session;
	ctx.el.empty();
	slot(null);
	const root = ctx.el.createDiv({ cls: cx('ws-vis-widget', `ws-vis-widget--${height(ctx.config.height)}`) });
	const base = s.graphs.get(str(ctx.config.view));
	const doc = hydrateGraph({
		...(base ?? {}),
		id: '__widget',
		name: 'Connections',
		labels: ctx.config.labels === 'hover' ? 'hover' : (base?.labels ?? 'always'),
		background: 'plain',
		...(ctx.surface === 'entity' && ctx.entity ? { focusId: ctx.entity.id, depth: num(Number(ctx.config.depth), 1, 1, 3), hideIsolated: false } : {}),
	})!.record;
	const data = graphData(s, doc);
	if (!data.edges.length) {
		emptyState(root, {
			compact: true,
			icon: 'share-2',
			title: ctx.surface === 'entity' ? 'No connections yet' : 'Nothing connected yet',
			body: ctx.surface === 'entity' ? 'Add a connection (a friend, a rival, a home) and the web grows from here.' : 'Connect entries to each other and they appear here as a web.',
			actionLabel: 'Open the graph',
			actionIcon: 'share-2',
			onAction: () => ctx.navigate(ROUTES.graph(base?.id, ctx.entity?.id)),
		});
		return;
	}
	const host = root.createDiv({ cls: 'ws-vis-widget__canvas' });
	slot(renderGraph(host, ctx.app, s, doc, data, { still: true, scrollPage: true, focusId: doc.focusId, onOpen: (id, evt) => ctx.navigate(ROUTES.entity(id), mod(evt)) }));
	if (ctx.surface === 'entity') ctx.setTitle(`Connection map · ${data.nodes.length - 1}`);
	foot(ctx, root, 'Open the graph', (e) => ctx.navigate(ROUTES.graph(ctx.surface === 'entity' ? undefined : base?.id, ctx.surface === 'entity' ? ctx.entity?.id : undefined), mod(e)));
}

// ── Map ────────────────────────────────────────────────────────────────────────

export const mapBlock: BlockDefinition = {
	id: 'map',
	name: 'Map',
	icon: 'map',
	category: 'Showcase',
	description: 'On an entry: where it is on your maps, or the map of it. On a dashboard: one of your maps.',
	hint: 'One of your maps',
	surfaces: ['entity', 'dashboard'],
	frame: 'card',
	defaultSize: { w: 8, h: 2 },
	minW: 3,
	defaultConfig: { map: '', height: 'medium' },
	configFields: (s) => {
		const maps = s.maps.list();
		const out: FieldDefinition[] = [];
		if (maps.length) out.push({ id: 'map', type: 'select', label: 'Show', config: { options: [{ id: '', label: 'The best match' }, ...maps.map((m) => ({ id: m.id, label: m.name }))] } });
		out.push(HEIGHT_FIELD);
		return out;
	},
	title: (ctx) => {
		const pick = chooseMap(ctx);
		if (ctx.surface === 'entity') return pick ? (pick.isOf ? pick.map.name : 'On the map') : 'On the map';
		return pick?.map.name ?? 'Map';
	},
	render(ctx) {
		const slot = canvasSlot(ctx);
		const paint = () => drawMap(ctx, slot);
		paint();
		watchWorld(ctx, paint, { entities: (k) => k.some((x) => ['name', 'trashedAt', 'media', 'typeId'].includes(x)) });
		own(ctx.component, ctx.session.events.on('doc:saved', ({ kind }) => kind === 'map' && paint()));
		own(ctx.component, ctx.session.events.on('doc:deleted', ({ kind }) => kind === 'map' && paint()));
	},
};

function chooseMap(ctx: BlockRenderContext) {
	const s = ctx.session;
	const chosen = s.maps.get(str(ctx.config.map));
	if (ctx.surface === 'entity' && ctx.entity) {
		const all = mapsOf(s, ctx.entity.id);
		if (chosen) return { map: chosen, isOf: chosen.entityId === ctx.entity.id, others: all.filter((x) => x.map.id !== chosen.id).map((x) => x.map) };
		const best = all[0];
		return best ? { map: best.map, isOf: best.isOf, others: all.slice(1).map((x) => x.map) } : null;
	}
	const m = chosen ?? s.maps.list()[0];
	return m ? { map: m, isOf: false, others: [] } : null;
}

function drawMap(ctx: BlockRenderContext, slot: ReturnType<typeof canvasSlot>): void {
	const s = ctx.session;
	ctx.el.empty();
	slot(null);
	const root = ctx.el.createDiv({ cls: cx('ws-vis-widget', `ws-vis-widget--${height(ctx.config.height)}`) });
	const pick = chooseMap(ctx);
	if (!pick) {
		emptyState(root, {
			compact: true,
			icon: 'map',
			title: ctx.surface === 'entity' ? 'Not on a map yet' : 'No maps yet',
			body: ctx.surface === 'entity' ? 'Drop a pin for it on one of your maps, or link a map of it.' : 'Add a map image (or start a blank one) on the Maps page.',
			actionLabel: 'Open maps',
			actionIcon: 'map',
			onAction: () => ctx.navigate(ROUTES.maps()),
		});
		return;
	}
	ctx.setTitle(ctx.surface === 'entity' ? (pick.isOf ? pick.map.name : `On ${pick.map.name}`) : pick.map.name);
	const focus = ctx.surface === 'entity' && ctx.entity && !pick.isOf ? itemFor(pick.map, ctx.entity.id) : null;
	const host = root.createDiv({ cls: 'ws-vis-widget__canvas' });
	slot(
		renderMap(host, ctx.app, s, pick.map, {
			focus,
			selected: focus,
			scrollPage: true,
			onOpen: (ref, evt) => {
				const it = (ref.kind === 'pin' ? pick.map.pins : ref.kind === 'region' ? pick.map.regions : pick.map.paths).find((i) => i.id === ref.id);
				const e = it?.entityId ? s.entities.get(it.entityId) : undefined;
				if (e && !e.trashedAt && e.id !== ctx.entity?.id) ctx.navigate(ROUTES.entity(e.id), mod(evt));
				else ctx.navigate(ROUTES.maps(pick.map.id, ref.id), mod(evt));
			},
		}),
	);
	const f = root.createDiv({ cls: 'ws-vis-widget__foot' });
	if (pick.others.length) {
		const also = f.createDiv({ cls: 'ws-vis-widget__also' });
		also.createSpan({ text: 'Also on ' });
		pick.others.slice(0, 3).forEach((m, i) => {
			if (i) also.createSpan({ text: ', ' });
			const a = also.createEl('a', { cls: 'ws-vis-widget__link', text: m.name, attr: { href: '#' } });
			a.addEventListener('click', (e) => {
				e.preventDefault();
				ctx.navigate(ROUTES.maps(m.id, ctx.entity?.id), mod(e));
			});
		});
	}
	const label = focus ? itemLabel(s, (focus.kind === 'pin' ? pick.map.pins : focus.kind === 'region' ? pick.map.regions : pick.map.paths).find((i) => i.id === focus.id)!, focus.kind) : null;
	button(f, { label: label ? `Open map at ${label}` : 'Open map', icon: 'arrow-up-right', variant: 'quiet', size: 'sm', onClick: (e) => ctx.navigate(ROUTES.maps(pick.map.id, focus?.id), mod(e)) });
}
