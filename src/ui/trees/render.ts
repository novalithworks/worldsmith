import type { App } from 'obsidian';
import type { EntityRecord, TreeDoc } from '../../core/types';
import type { WorldSession } from '../../services/WorldSession';
import { lifeDates, type TreeLayout, type TreeMetrics, type TreeNode } from '../../services/trees';
import { avatar } from '../components/avatar';
import { button, cx, icon } from '../components/dom';
import { panZoom, type PanZoom } from '../components/panzoom';

const SVG = 'http://www.w3.org/2000/svg';

/** Card sizes per style: [width, height]. */
const CARD: Record<TreeDoc['card'], [number, number]> = {
	portrait: [150, 156],
	compact: [196, 62],
	name: [148, 38],
};
const GEN_GAP = { down: 64, up: 64, right: 84 };
/** Generation colours, oldest at the top. */
export const GENERATION_COLORS = ['purple', 'blue', 'cyan', 'green', 'yellow', 'orange', 'red', 'pink'] as const;

export function treeMetrics(doc: Pick<TreeDoc, 'card' | 'direction'>): TreeMetrics & { w: number; h: number; genGap: number } {
	const [w, h] = CARD[doc.card];
	const across = doc.direction === 'right' ? h : w;
	return { w, h, card: across, gap: doc.direction === 'right' ? 18 : doc.card === 'name' ? 16 : 26, partnerGap: doc.card === 'name' ? 26 : 30, genGap: GEN_GAP[doc.direction] };
}

export interface TreeCanvasOptions {
	/** Open an entry. */
	open(id: string, evt: MouseEvent): void;
	/** Interactive: hover tools to add relatives, refocus, fold. */
	tools?: {
		addParent?(node: TreeNode, anchor: HTMLElement): void;
		addPartner?(node: TreeNode, anchor: HTMLElement): void;
		addChild?(node: TreeNode, anchor: HTMLElement): void;
		focus?(node: TreeNode): void;
		toggle?(node: TreeNode): void;
		menu?(node: TreeNode, evt: MouseEvent): void;
	};
	/** In a widget: page scrolling isn't captured. */
	scrollPage?: boolean;
	/** Keep the view where it was (re-render after an edit). */
	keep?: { k: number; x: number; y: number } | null;
	onView?(v: { k: number; x: number; y: number }): void;
	selected?: string | null;
	onSelect?(key: string | null): void;
}

export interface TreeCanvas {
	pz: PanZoom;
	fit(animate?: boolean): void;
	/** Centre on a node. */
	reveal(key: string): void;
	destroy(): void;
}

/** Draw a laid-out tree into `parent` as cards joined by lines, with pan and zoom. */
export function renderTree(parent: HTMLElement, app: App, s: WorldSession, doc: TreeDoc, layout: TreeLayout, o: TreeCanvasOptions): TreeCanvas {
	const m = treeMetrics(doc);
	const vp = parent.createDiv({ cls: cx('ws-canvas', `ws-canvas--${doc.background}`, 'ws-tree', `ws-tree--${doc.direction}`, `ws-tree--${doc.card}`) });
	const stage = vp.createDiv({ cls: 'ws-canvas__stage' });
	const step = (doc.direction === 'right' ? m.w : m.h) + m.genGap;
	const pos = (n: TreeNode): { x: number; y: number } => {
		if (doc.direction === 'right') return { x: n.gen * step, y: n.b };
		return { x: n.b, y: (doc.direction === 'up' ? -n.gen : n.gen) * step };
	};
	const PAD = 60;
	const pts = layout.nodes.map(pos);
	const minX = Math.min(...pts.map((p) => p.x)) - m.w / 2 - PAD;
	const minY = Math.min(...pts.map((p) => p.y)) - m.h / 2 - PAD;
	const maxX = Math.max(...pts.map((p) => p.x)) + m.w / 2 + PAD;
	const maxY = Math.max(...pts.map((p) => p.y)) + m.h / 2 + PAD;
	const W = maxX - minX;
	const H = maxY - minY;
	stage.style.width = `${W}px`;
	stage.style.height = `${H}px`;
	const at = new Map<string, { x: number; y: number; n: TreeNode }>();
	layout.nodes.forEach((n, i) => at.set(n.key, { x: pts[i]!.x - minX, y: pts[i]!.y - minY, n }));

	// ── Lines. ──
	const svg = activeDocument.createElementNS(SVG, 'svg');
	svg.setAttribute('class', 'ws-tree__lines');
	svg.setAttribute('width', String(W));
	svg.setAttribute('height', String(H));
	svg.setAttribute('aria-hidden', 'true');
	stage.appendChild(svg);
	const path = (d: string, cls: string) => {
		const p = activeDocument.createElementNS(SVG, 'path');
		p.setAttribute('d', d);
		p.setAttribute('class', cls);
		svg.appendChild(p);
		return p;
	};
	const outward = (p: { x: number; y: number }) =>
		doc.direction === 'right' ? { x: p.x + m.w / 2, y: p.y } : doc.direction === 'up' ? { x: p.x, y: p.y - m.h / 2 } : { x: p.x, y: p.y + m.h / 2 };
	const inward = (p: { x: number; y: number }) =>
		doc.direction === 'right' ? { x: p.x - m.w / 2, y: p.y } : doc.direction === 'up' ? { x: p.x, y: p.y + m.h / 2 } : { x: p.x, y: p.y - m.h / 2 };
	const join = (a: { x: number; y: number }, b: { x: number; y: number }) => {
		if (doc.lines === 'straight') return `M${a.x},${a.y} L${b.x},${b.y}`;
		if (doc.direction === 'right') {
			const mx = (a.x + b.x) / 2;
			return doc.lines === 'square' ? `M${a.x},${a.y} H${mx} V${b.y} H${b.x}` : `M${a.x},${a.y} C${mx},${a.y} ${mx},${b.y} ${b.x},${b.y}`;
		}
		const my = (a.y + b.y) / 2;
		return doc.lines === 'square' ? `M${a.x},${a.y} V${my} H${b.x} V${b.y}` : `M${a.x},${a.y} C${a.x},${my} ${b.x},${my} ${b.x},${b.y}`;
	};
	for (const l of layout.links) {
		const to = at.get(l.to);
		const from = l.from.map((k) => at.get(k)).filter((x): x is NonNullable<typeof x> => !!x);
		if (!to || !from.length) continue;
		if (l.kind === 'partner') {
			const a = from[0]!;
			const ra = doc.direction === 'right' ? { x: a.x, y: a.y + m.h / 2 } : { x: a.x + m.w / 2, y: a.y };
			const rb = doc.direction === 'right' ? { x: to.x, y: to.y - m.h / 2 } : { x: to.x - m.w / 2, y: to.y };
			path(`M${ra.x},${ra.y} L${rb.x},${rb.y}`, 'ws-tree__partner');
			const ring = activeDocument.createElementNS(SVG, 'circle');
			ring.setAttribute('cx', String((ra.x + rb.x) / 2));
			ring.setAttribute('cy', String((ra.y + rb.y) / 2));
			ring.setAttribute('r', '4.5');
			ring.setAttribute('class', 'ws-tree__ring');
			svg.appendChild(ring);
			continue;
		}
		// From the couple's line (two parents side by side), else from the parent's edge.
		const cls = cx('ws-tree__child', to.n.repeat && 'is-repeat').join(' ');
		const end = inward(to);
		if (from.length >= 2) {
			// Drop from the ring between the parents, through the gap, then on to the child.
			const xs = from.map((f) => f.x);
			const ys = from.map((f) => f.y);
			const ring = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
			const edge = outward(ring);
			path(`M${ring.x},${ring.y} L${edge.x},${edge.y}`, cls);
			path(join(edge, end), cls);
		} else path(join(outward(from[0]!), end), cls);
	}

	// ── Cards. ──
	const cards = stage.createDiv({ cls: 'ws-tree__cards' });
	const byKey = new Map<string, HTMLElement>();
	for (const [, p] of at) {
		const n = p.n;
		const e = n.entityId ? s.entities.get(n.entityId) : undefined;
		const el = card(cards, app, s, doc, n, e, o);
		el.style.left = `${p.x - m.w / 2}px`;
		el.style.top = `${p.y - m.h / 2}px`;
		el.style.width = `${m.w}px`;
		el.style.height = `${m.h}px`;
		byKey.set(n.key, el);
	}
	const select = (key: string | null) => {
		for (const [k, el] of byKey) el.toggleClass('is-selected', k === key);
		o.onSelect?.(key);
	};
	if (o.selected && byKey.has(o.selected)) select(o.selected);

	const pz = panZoom(vp, stage, {
		min: 0.15,
		max: 2.5,
		ignore: '.ws-tree-card, .ws-canvas__hud',
		scrollPage: o.scrollPage,
		onChange: (p) => o.onView?.({ k: p.k, x: p.x, y: p.y }),
		onBackgroundClick: () => select(null),
	});
	for (const [key, el] of byKey) {
		el.addEventListener('click', (evt) => {
			if ((evt.target as HTMLElement).closest('.ws-tree-card__tools, .ws-tree-card__fold')) return;
			const n = at.get(key)!.n;
			if (n.repeat && n.entityId) {
				// Jump to where this person is drawn in full.
				const first = layout.nodes.find((x) => x.entityId === n.entityId && !x.repeat);
				if (first) {
					api.reveal(first.key);
					select(first.key);
					return;
				}
			}
			if (!o.tools) {
				if (n.entityId) o.open(n.entityId, evt);
				return;
			}
			select(key);
		});
		el.addEventListener('dblclick', (evt) => {
			const n = at.get(key)!.n;
			if (n.entityId && o.tools) o.open(n.entityId, evt);
		});
		el.addEventListener('keydown', (evt) => {
			const n = at.get(key)!.n;
			if (evt.key === 'Enter' && n.entityId) o.open(n.entityId, evt as unknown as MouseEvent);
		});
		el.addEventListener('contextmenu', (evt) => {
			const n = at.get(key)!.n;
			if (!o.tools?.menu || !n.entityId) return;
			evt.preventDefault();
			o.tools.menu(n, evt);
		});
	}

	const rootKey = layout.nodes.find((n) => n.gen === 0 && (n.role === 'root' || n.role === 'type'))?.key;
	const api: TreeCanvas = {
		pz,
		fit: (animate) => pz.fit([0, 0, W, H], { pad: 16, max: 1, animate }),
		reveal(key) {
			const p = at.get(key);
			if (p) pz.centre(p.x, p.y, Math.max(pz.k, 0.8));
		},
		destroy: () => pz.destroy(),
	};
	if (o.keep) pz.set(o.keep.k, o.keep.x, o.keep.y);
	else {
		// Big trees open around the root at a readable size; small ones fit.
		window.requestAnimationFrame(() => {
			if (!vp.isConnected) return;
			const r = vp.getBoundingClientRect();
			const fitK = Math.min((r.width - 32) / W, (r.height - 32) / H);
			if (fitK >= 0.55 || !rootKey) api.fit();
			else {
				const p = at.get(rootKey)!;
				pz.centre(p.x, p.y, 0.8);
			}
		});
	}
	return api;
}

function card(parent: HTMLElement, app: App, s: WorldSession, doc: TreeDoc, n: TreeNode, e: EntityRecord | undefined, o: TreeCanvasOptions): HTMLElement {
	const schema = e ? s.schemas.get(e.typeId) : n.role === 'type' && doc.typeId ? s.schemas.get(doc.typeId) : undefined;
	let tint: string | null = null;
	if (doc.colorBy === 'type') tint = schema?.color ?? 'gray';
	else if (doc.colorBy === 'status' && e) tint = s.world.statuses.find((x) => x.id === e.status)?.color ?? 'gray';
	else if (doc.colorBy === 'generation') {
		const i = n.gen - (doc.kind === 'family' ? -doc.up : 0);
		tint = GENERATION_COLORS[((i % GENERATION_COLORS.length) + GENERATION_COLORS.length) % GENERATION_COLORS.length]!;
	}
	const el = parent.createDiv({
		cls: cx('ws-tree-card', `ws-tree-card--${doc.card}`, tint && `ws-tint--${tint}`, tint && 'is-tinted', `is-${n.role}`, n.repeat && 'is-repeat', !e && n.role !== 'type' && 'is-missing'),
		attr: { tabindex: '0', role: 'button', 'data-key': n.key, ...(n.entityId ? { 'data-entity': n.entityId } : {}) },
	});
	if (n.role === 'type' && schema) {
		const mark = el.createDiv({ cls: 'ws-tree-card__mark' });
		icon(mark, schema.icon);
		const t = el.createDiv({ cls: 'ws-tree-card__text' });
		t.createDiv({ cls: 'ws-tree-card__name', text: schema.plural });
		t.createDiv({ cls: 'ws-tree-card__meta', text: `${n.children ?? 0} at the top` });
		el.setAttr('aria-label', schema.plural);
		return el;
	}
	if (!e) {
		el.createDiv({ cls: 'ws-tree-card__name', text: 'Missing entry' });
		return el;
	}
	el.setAttr('aria-label', e.name);
	if (doc.card !== 'name' && doc.show.photos) avatar(el, app, e, schema, { shape: 'circle', size: doc.card === 'portrait' ? 'md' : 'sm', cls: 'ws-tree-card__photo' });
	else if (doc.card === 'name') el.createSpan({ cls: 'ws-tree-card__dot' });
	const t = el.createDiv({ cls: 'ws-tree-card__text' });
	t.createDiv({ cls: 'ws-tree-card__name', text: e.name });
	if (doc.card !== 'name') {
		const dates = doc.show.dates ? lifeDates(s, e) : '';
		if (dates) t.createDiv({ cls: 'ws-tree-card__dates', text: dates });
		if (n.repeat) t.createDiv({ cls: 'ws-tree-card__meta', text: 'Also shown above' });
		else if (doc.show.type && schema) {
			const ty = t.createDiv({ cls: 'ws-tree-card__meta' });
			icon(ty, schema.icon);
			ty.createSpan({ text: schema.singular });
		}
		if (doc.show.status && doc.card === 'portrait') {
			const st = s.world.statuses.find((x) => x.id === e.status);
			if (st) t.createDiv({ cls: cx('ws-tree-card__status', `ws-tint--${st.color}`), text: st.label });
		}
	}
	if (n.role === 'root') el.createDiv({ cls: 'ws-tree-card__crown', attr: { 'aria-hidden': 'true' } });
	// Hierarchy: fold and unfold.
	if (doc.kind === 'hierarchy' && n.children && o.tools?.toggle) {
		const f = el.createEl('button', { cls: cx('ws-tree-card__fold', n.folded && 'is-folded'), attr: { type: 'button', 'aria-label': n.folded ? `Show ${n.children} inside` : 'Fold away', 'aria-expanded': String(!n.folded) } });
		f.setText(n.folded ? `+${n.children}` : '−');
		f.addEventListener('click', (evt) => {
			evt.stopPropagation();
			o.tools?.toggle?.(n);
		});
	}
	// Hover tools.
	if (o.tools && !n.repeat) {
		const tools = el.createDiv({ cls: 'ws-tree-card__tools' });
		const T = o.tools;
		if (doc.kind === 'family') {
			if (T.addParent) button(tools, { icon: 'arrow-up-from-line', variant: 'quiet', size: 'sm', tooltip: 'Add a parent', cls: 'ws-tree-card__add-parent', onClick: (evt) => T.addParent!(n, evt.currentTarget as HTMLElement) });
			if (T.addPartner) button(tools, { icon: 'heart', variant: 'quiet', size: 'sm', tooltip: 'Add a partner', cls: 'ws-tree-card__add-partner', onClick: (evt) => T.addPartner!(n, evt.currentTarget as HTMLElement) });
			if (T.addChild) button(tools, { icon: 'arrow-down-to-line', variant: 'quiet', size: 'sm', tooltip: 'Add a child', cls: 'ws-tree-card__add-child', onClick: (evt) => T.addChild!(n, evt.currentTarget as HTMLElement) });
			if (T.focus && n.role !== 'root') button(tools, { icon: 'crosshair', variant: 'quiet', size: 'sm', tooltip: 'Centre the tree here', cls: 'ws-tree-card__focus', onClick: () => T.focus!(n) });
		} else if (T.addChild) button(tools, { icon: 'plus', variant: 'quiet', size: 'sm', tooltip: 'Add something inside', cls: 'ws-tree-card__add-child', onClick: (evt) => T.addChild!(n, evt.currentTarget as HTMLElement) });
		button(tools, { icon: 'arrow-up-right', variant: 'quiet', size: 'sm', tooltip: 'Open', cls: 'ws-tree-card__open', onClick: (evt) => o.open(e.id, evt) });
		if (T.menu) button(tools, { icon: 'more-horizontal', variant: 'quiet', size: 'sm', tooltip: 'More', cls: 'ws-tree-card__more', onClick: (evt) => T.menu!(n, evt) });
	}
	return el;
}

/** A small still picture of a tree for its card on the Trees page (0.12): boxes and lines. */
export function treeThumb(parent: HTMLElement, doc: TreeDoc, layout: TreeLayout | null): HTMLElement {
	const box = parent.createDiv({ cls: cx('ws-tree-thumb', `ws-canvas--${doc.background}`) });
	if (!layout || !layout.nodes.length) {
		icon(box.createDiv({ cls: 'ws-tree-thumb__none' }), doc.kind === 'family' ? 'user-x' : 'list-tree');
		return box;
	}
	const m = treeMetrics(doc);
	const step = (doc.direction === 'right' ? m.w : m.h) + m.genGap;
	const nodes = layout.nodes.slice(0, 160);
	const at = new Map<string, { x: number; y: number }>();
	for (const n of nodes) at.set(n.key, doc.direction === 'right' ? { x: n.gen * step, y: n.b } : { x: n.b, y: (doc.direction === 'up' ? -n.gen : n.gen) * step });
	const xs = [...at.values()].map((p) => p.x);
	const ys = [...at.values()].map((p) => p.y);
	const pad = 30;
	const x0 = Math.min(...xs) - m.w / 2 - pad;
	const y0 = Math.min(...ys) - m.h / 2 - pad;
	const w = Math.max(...xs) + m.w / 2 + pad - x0;
	const h = Math.max(...ys) + m.h / 2 + pad - y0;
	const svg = activeDocument.createElementNS(SVG, 'svg');
	svg.setAttribute('class', 'ws-tree-thumb__svg');
	svg.setAttribute('viewBox', `${x0} ${y0} ${w} ${h}`);
	svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
	svg.setAttribute('aria-hidden', 'true');
	const add = (tag: string, attrs: Record<string, string | number>) => {
		const n = activeDocument.createElementNS(SVG, tag);
		for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
		svg.appendChild(n);
		return n;
	};
	for (const l of layout.links) {
		const to = at.get(l.to);
		const from = l.from.map((k) => at.get(k)).filter((p): p is { x: number; y: number } => !!p);
		if (!to || !from.length) continue;
		const fx = from.reduce((a, p) => a + p.x, 0) / from.length;
		const fy = from.reduce((a, p) => a + p.y, 0) / from.length;
		add('line', { x1: fx, y1: fy, x2: to.x, y2: to.y, class: cx('ws-tree-thumb__line', l.kind === 'partner' && 'is-partner').join(' ') });
	}
	const span = Math.max(1, layout.maxG - layout.minG);
	for (const n of nodes) {
		const p = at.get(n.key)!;
		const tint = GENERATION_COLORS[Math.max(0, Math.min(GENERATION_COLORS.length - 1, Math.round(((n.gen - layout.minG) / span) * 3)))];
		add('rect', { x: p.x - m.w / 2, y: p.y - m.h / 2, width: m.w, height: m.h, rx: 10, class: cx('ws-tree-thumb__card', `ws-tint--${tint}`, n.role === 'root' && 'is-root').join(' ') });
	}
	box.appendChild(svg);
	return box;
}
