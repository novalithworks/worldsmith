import type { App } from 'obsidian';
import type { GraphDoc } from '../../core/types';
import { initials } from '../../core/util/strings';
import { resourceUrl } from '../../fields/ui/media';
import { ForceSim, kindColor, nodeRadius, type GraphData, type GraphEdge, type SimNode } from '../../services/graph';
import type { WorldSession } from '../../services/WorldSession';
import { cx, icon } from '../components/dom';
import { panZoom, type PanZoom } from '../components/panzoom';

const SVG = 'http://www.w3.org/2000/svg';
let clipSeq = 0;

export type GraphLook = Pick<GraphDoc, 'labels' | 'edgeLabels' | 'colorBy' | 'sizeByLinks' | 'photos' | 'spacing' | 'background' | 'pinned'> & { pinOnDrag?: boolean };

export interface GraphCanvasOptions {
	/** Where entries were last time (keeps the picture steady between redraws). */
	known?: Map<string, [number, number]>;
	onSelect?(id: string | null): void;
	onOpen?(id: string, evt: MouseEvent): void;
	/** A dot was dragged and dropped somewhere: keep it there (with `pinOnDrag`, or if it was pinned). */
	onPin?(id: string, x: number, y: number): void;
	onMenu?(id: string, evt: MouseEvent): void;
	selected?: string | null;
	focusId?: string | null;
	scrollPage?: boolean;
	keep?: { k: number; x: number; y: number } | null;
	onView?(v: { k: number; x: number; y: number }): void;
	/** Widgets: fewer ticks, no animation. */
	still?: boolean;
}

export interface GraphCanvas {
	pz: PanZoom;
	fit(animate?: boolean): void;
	select(id: string | null): void;
	reveal(id: string): void;
	positions(): Map<string, [number, number]>;
	/** Shake things loose: unpinned dots settle again. */
	reheat(): void;
	destroy(): void;
}

const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, parent?: Element): SVGElementTagNameMap[K] => {
	const n = activeDocument.createElementNS(SVG, tag);
	for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
	parent?.appendChild(n);
	return n;
};

export function renderGraph(parent: HTMLElement, app: App, s: WorldSession, look: GraphLook, data: GraphData, o: GraphCanvasOptions = {}): GraphCanvas {
	const vp = parent.createDiv({ cls: cx('ws-canvas', `ws-canvas--${look.background}`, 'ws-graph', `ws-graph--labels-${look.labels}`) });
	const stage = vp.createDiv({ cls: 'ws-canvas__stage' });
	const svg = el('svg', { class: 'ws-graph__svg', width: 1, height: 1, 'aria-hidden': 'true' });
	stage.appendChild(svg);
	const defs = el('defs', {}, svg);
	const gEdges = el('g', { class: 'ws-graph__edges' }, svg);
	const gLabels = el('g', { class: 'ws-graph__edge-labels' }, svg);
	const gNodes = el('g', { class: 'ws-graph__nodes' }, svg);

	// ── Simulation. ──
	const ids = data.nodes.map((n) => n.id);
	const pinned = look.pinned;
	const start = ForceSim.seed(ids, (id) => pinned[id] ?? o.known?.get(id), look.spacing);
	const sims: SimNode[] = data.nodes.map((n, i) => ({ id: n.id, x: start[i]![0], y: start[i]![1], vx: 0, vy: 0, r: nodeRadius(n.degree, look.sizeByLinks), fixed: !!pinned[n.id] }));
	const sim = new ForceSim(sims, data.edges, { spacing: look.spacing });
	const fresh = data.nodes.filter((n) => !pinned[n.id] && !o.known?.has(n.id)).length;
	// Settle before the first paint so the picture doesn't jump about.
	if (fresh) sim.run(o.still ? 300 : data.nodes.length > 600 ? 60 : 220);
	else sim.alpha = 0.08;

	// ── Edges. ──
	const edgeEls = new Map<string, { path: SVGPathElement; label: SVGTextElement | null; e: GraphEdge }>();
	for (const e of data.edges) {
		const tint = e.kind === '__parent' ? 'gray' : kindColor(e.kind, e.type);
		const path = el('path', { class: cx('ws-graph__edge', tint && `ws-tint--${tint}`, e.secret && 'is-secret', e.status === 'ended' && 'is-ended', e.status === 'strained' && 'is-strained', e.kind === '__parent' && 'is-parent').join(' '), 'data-edge': e.id, 'data-kind': e.kind }, gEdges);
		path.style.strokeWidth = String(1.2 + (e.strength ?? 0) * 0.45);
		let label: SVGTextElement | null = null;
		if (look.edgeLabels) {
			label = el('text', { class: 'ws-graph__edge-label', 'text-anchor': 'middle' }, gLabels);
			label.textContent = e.kind === '__parent' ? 'inside' : (e.type?.label ?? e.kind);
		}
		edgeEls.set(e.id, { path, label, e });
	}

	// ── Nodes. ──
	const nodeEls = new Map<string, SVGGElement>();
	const neighbours = new Map<string, Set<string>>();
	for (const e of data.edges) {
		(neighbours.get(e.from) ?? neighbours.set(e.from, new Set()).get(e.from)!).add(e.to);
		(neighbours.get(e.to) ?? neighbours.set(e.to, new Set()).get(e.to)!).add(e.from);
	}
	data.nodes.forEach((n, i) => {
		const r = sims[i]!.r;
		let tint: string | null = null;
		if (look.colorBy === 'type') tint = n.schema.color ?? 'gray';
		else if (look.colorBy === 'status') tint = s.world.statuses.find((x) => x.id === n.entity.status)?.color ?? 'gray';
		const g = el('g', { class: cx('ws-graph__node', tint && `ws-tint--${tint}`, n.id === o.focusId && 'is-focus', pinned[n.id] && 'is-pinned').join(' '), 'data-entity': n.id, tabindex: 0, role: 'button', 'aria-label': n.entity.name }, gNodes);
		el('circle', { class: 'ws-graph__halo', r: r + 5 }, g);
		el('circle', { class: 'ws-graph__dot', r }, g);
		const portrait = look.photos ? n.entity.media.portrait : null;
		const url = portrait ? resourceUrl(app, portrait.path) : null;
		if (url) {
			const id = `ws-gclip-${++clipSeq}`;
			const cp = el('clipPath', { id }, defs);
			el('circle', { r: r - 2 }, cp);
			el('image', { href: url, x: -(r - 2), y: -(r - 2), width: (r - 2) * 2, height: (r - 2) * 2, 'clip-path': `url(#${id})`, preserveAspectRatio: 'xMidYMid slice', class: 'ws-graph__img' }, g);
		} else if (r >= 13) {
			const t = el('text', { class: 'ws-graph__initials', 'text-anchor': 'middle', dy: '0.35em' }, g);
			t.textContent = initials(n.entity.name);
			t.style.fontSize = `${Math.round(r * 0.72)}px`;
		}
		if (pinned[n.id]) el('circle', { class: 'ws-graph__pin', r: 3.2, cx: r * 0.72, cy: -r * 0.72 }, g);
		const label = el('text', { class: 'ws-graph__label', 'text-anchor': 'middle', y: r + 15 }, g);
		label.textContent = n.entity.name.length > 28 ? `${n.entity.name.slice(0, 26)}…` : n.entity.name;
		const title = el('title', {}, g);
		title.textContent = `${n.entity.name} · ${n.schema.singular}${n.degree ? ` · ${n.degree} connection${n.degree === 1 ? '' : 's'}` : ''}`;
		nodeEls.set(n.id, g);
	});

	const paint = () => {
		for (const n of sims) nodeEls.get(n.id)!.setAttribute('transform', `translate(${n.x.toFixed(1)},${n.y.toFixed(1)})`);
		for (const { path, label, e } of edgeEls.values()) {
			const a = sim.node(e.from)!;
			const b = sim.node(e.to)!;
			const bend = e.lanes > 1 ? (e.lane - (e.lanes - 1) / 2) * 26 : 0;
			const mx = (a.x + b.x) / 2;
			const my = (a.y + b.y) / 2;
			const dx = b.x - a.x;
			const dy = b.y - a.y;
			const d = Math.hypot(dx, dy) || 1;
			const cxp = mx + (-dy / d) * bend * 2;
			const cyp = my + (dx / d) * bend * 2;
			path.setAttribute('d', bend ? `M${a.x.toFixed(1)},${a.y.toFixed(1)} Q${cxp.toFixed(1)},${cyp.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}` : `M${a.x.toFixed(1)},${a.y.toFixed(1)} L${b.x.toFixed(1)},${b.y.toFixed(1)}`);
			if (label) {
				label.setAttribute('x', (bend ? (mx + cxp) / 2 : mx).toFixed(1));
				label.setAttribute('y', ((bend ? (my + cyp) / 2 : my) - 4).toFixed(1));
			}
		}
	};
	paint();

	// Keep moving gently until it settles.
	let raf = 0;
	const loop = () => {
		raf = 0;
		if (!vp.isConnected || sim.alpha < 0.004) return;
		sim.tick();
		if (data.nodes.length < 500) sim.tick();
		paint();
		raf = window.requestAnimationFrame(loop);
	};
	if (!o.still) raf = window.requestAnimationFrame(loop);
	const reheat = (a = 0.3) => {
		sim.alpha = Math.max(sim.alpha, a);
		if (!raf && !o.still) raf = window.requestAnimationFrame(loop);
	};

	// ── Highlight, select, drag. ──
	let selected: string | null = null;
	const light = (id: string | null) => {
		vp.toggleClass('is-lighting', !!id);
		const near = id ? (neighbours.get(id) ?? new Set<string>()) : new Set<string>();
		for (const [nid, g] of nodeEls) g.classList.toggle('is-lit', !!id && (nid === id || near.has(nid)));
		for (const { path, label, e } of edgeEls.values()) {
			const on = !!id && (e.from === id || e.to === id);
			path.classList.toggle('is-lit', on);
			label?.classList.toggle('is-lit', on);
		}
	};
	const select = (id: string | null) => {
		selected = id;
		for (const [nid, g] of nodeEls) g.classList.toggle('is-selected', nid === id);
		light(id);
		o.onSelect?.(id);
	};

	let drag: { id: string; dx: number; dy: number; sx: number; sy: number; moved: boolean; pointer: number } | null = null;
	const pz = panZoom(vp, stage, {
		min: 0.08,
		max: 3,
		ignore: '.ws-graph__node, .ws-canvas__hud, .ws-vis-spot, .ws-graph__legend',
		scrollPage: o.scrollPage,
		onChange: (p) => {
			vp.toggleClass('is-far', p.k < 0.45);
			o.onView?.({ k: p.k, x: p.x, y: p.y });
		},
		onBackgroundClick: () => select(null),
	});
	for (const [id, g] of nodeEls) {
		g.addEventListener('pointerenter', () => !drag && light(id));
		g.addEventListener('pointerleave', () => !drag && light(selected));
		g.addEventListener('focus', () => light(id));
		g.addEventListener('blur', () => light(selected));
		g.addEventListener('keydown', (evt) => {
			if (evt.key === 'Enter') o.onOpen?.(id, evt as unknown as MouseEvent);
			else if (evt.key === ' ') {
				evt.preventDefault();
				select(id);
			}
		});
		g.addEventListener('dblclick', (evt) => o.onOpen?.(id, evt));
		g.addEventListener('contextmenu', (evt) => {
			if (!o.onMenu) return;
			evt.preventDefault();
			o.onMenu(id, evt);
		});
		g.addEventListener('pointerdown', (evt) => {
			if (evt.button !== 0 && evt.pointerType === 'mouse') return;
			evt.stopPropagation();
			const n = sim.node(id)!;
			const p = pz.toStage(evt.clientX, evt.clientY);
			drag = { id, dx: n.x - p.x, dy: n.y - p.y, sx: evt.clientX, sy: evt.clientY, moved: false, pointer: evt.pointerId };
			try {
				g.setPointerCapture(evt.pointerId);
			} catch {
				/* fine */
			}
		});
		g.addEventListener('pointermove', (evt) => {
			if (!drag || drag.id !== id || drag.pointer !== evt.pointerId) return;
			if (!drag.moved && Math.abs(evt.clientX - drag.sx) + Math.abs(evt.clientY - drag.sy) < 4) return;
			if (o.still) return;
			drag.moved = true;
			const n = sim.node(id)!;
			n.fixed = true;
			const p = pz.toStage(evt.clientX, evt.clientY);
			n.x = p.x + drag.dx;
			n.y = p.y + drag.dy;
			g.classList.add('is-dragging');
			reheat(0.25);
			paint();
		});
		const end = (evt: PointerEvent) => {
			if (!drag || drag.id !== id || drag.pointer !== evt.pointerId) return;
			const d = drag;
			drag = null;
			g.classList.remove('is-dragging');
			const n = sim.node(id)!;
			if (d.moved) {
				// A dot pinned already stays pinned where it was put down.
				if (look.pinOnDrag || pinned[id]) {
					g.classList.add('is-pinned');
					o.onPin?.(id, Math.round(n.x), Math.round(n.y));
				} else {
					// Like Obsidian's graph: let go and it settles back in with the rest.
					n.fixed = false;
					reheat(0.35);
				}
			} else if (evt.type === 'pointerup') {
				if (o.onSelect) select(selected === id ? null : id);
				else o.onOpen?.(id, evt);
			}
		};
		g.addEventListener('pointerup', end);
		g.addEventListener('pointercancel', end);
	}

	const box = (): [number, number, number, number] => {
		if (!sims.length) return [-100, -100, 100, 100];
		let x0 = Infinity;
		let y0 = Infinity;
		let x1 = -Infinity;
		let y1 = -Infinity;
		for (const n of sims) {
			x0 = Math.min(x0, n.x - n.r);
			y0 = Math.min(y0, n.y - n.r);
			x1 = Math.max(x1, n.x + n.r);
			y1 = Math.max(y1, n.y + n.r + 20);
		}
		return [x0, y0, x1, y1];
	};
	const api: GraphCanvas = {
		pz,
		fit: (animate) => pz.fit(box(), { pad: 50, max: 1.4, animate }),
		select: (id) => select(id),
		reveal(id) {
			const n = sim.node(id);
			if (n) pz.centre(n.x, n.y, Math.max(pz.k, 0.9));
		},
		positions: () => new Map(sims.map((n) => [n.id, [n.x, n.y] as [number, number]])),
		reheat: () => {
			for (const n of sims) if (!pinned[n.id]) n.fixed = false;
			reheat(0.9);
		},
		destroy: () => {
			window.cancelAnimationFrame(raf);
			pz.destroy();
		},
	};
	if (o.keep) pz.set(o.keep.k, o.keep.x, o.keep.y);
	else window.requestAnimationFrame(() => vp.isConnected && api.fit());
	if (o.selected && nodeEls.has(o.selected)) select(o.selected);
	return api;
}

/** A small still picture of a graph for its card on the home page (0.12). */
const thumbCache = new Map<string, SimNode[]>();

export function graphThumb(parent: HTMLElement, s: WorldSession, look: GraphLook, data: GraphData): HTMLElement {
	const box = parent.createDiv({ cls: cx('ws-graph-thumb', `ws-canvas--${look.background}`) });
	if (!data.nodes.length) {
		icon(box.createDiv({ cls: 'ws-graph-thumb__none' }), 'share-2');
		return box;
	}
	// The best-connected few, settled quickly; enough to recognise the shape.
	const nodes = [...data.nodes].sort((a, b) => b.degree - a.degree).slice(0, 90);
	const keep = new Set(nodes.map((n) => n.id));
	const edges = data.edges.filter((e) => keep.has(e.from) && keep.has(e.to));
	// Settling takes a moment, so the home page keeps each shape until the view changes.
	const key = JSON.stringify([nodes.map((n) => [n.id, n.degree]), edges.map((e) => [e.from, e.to]), look.pinned, look.spacing, look.sizeByLinks]);
	let sims = thumbCache.get(key);
	if (!sims) {
		const start = ForceSim.seed(nodes.map((n) => n.id), (id) => look.pinned[id], look.spacing);
		sims = nodes.map((n, i) => ({ id: n.id, x: start[i]![0], y: start[i]![1], vx: 0, vy: 0, r: nodeRadius(n.degree, look.sizeByLinks), fixed: !!look.pinned[n.id] }));
		new ForceSim(sims, edges, { spacing: look.spacing }).run(160);
		thumbCache.set(key, sims);
		if (thumbCache.size > 40) thumbCache.delete(thumbCache.keys().next().value!);
	}
	let x0 = Infinity;
	let y0 = Infinity;
	let x1 = -Infinity;
	let y1 = -Infinity;
	for (const n of sims) {
		x0 = Math.min(x0, n.x - n.r);
		y0 = Math.min(y0, n.y - n.r);
		x1 = Math.max(x1, n.x + n.r);
		y1 = Math.max(y1, n.y + n.r);
	}
	const pad = 24;
	const svg = el('svg', { class: 'ws-graph-thumb__svg', viewBox: `${x0 - pad} ${y0 - pad} ${x1 - x0 + pad * 2} ${y1 - y0 + pad * 2}`, preserveAspectRatio: 'xMidYMid meet', 'aria-hidden': 'true' });
	const at = new Map(sims.map((n) => [n.id, n]));
	for (const e of edges) {
		const a = at.get(e.from)!;
		const b = at.get(e.to)!;
		el('line', { class: cx('ws-graph-thumb__edge', e.kind !== '__parent' && `ws-tint--${kindColor(e.kind, e.type)}`).join(' '), x1: a.x, y1: a.y, x2: b.x, y2: b.y }, svg);
	}
	for (const n of nodes) {
		const p = at.get(n.id)!;
		const tint = look.colorBy === 'type' ? (n.schema.color ?? 'gray') : look.colorBy === 'status' ? (s.world.statuses.find((x) => x.id === n.entity.status)?.color ?? 'gray') : 'gray';
		el('circle', { class: `ws-graph-thumb__dot ws-tint--${tint}`, cx: p.x, cy: p.y, r: p.r }, svg);
	}
	box.appendChild(svg);
	return box;
}
