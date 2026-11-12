import type { App } from 'obsidian';
import type { MapDoc, MapItemKind, MapPath, MapPin, MapRegion } from '../../core/types';
import { resourceUrl } from '../../fields/ui/media';
import { centroid, formatDistance, itemBox, itemLabel, itemVisible, layerOf, midpoint, niceStep, polylineLength, type MapItem, type MapItemRef } from '../../services/maps';
import type { WorldSession } from '../../services/WorldSession';
import { cx, icon } from '../components/dom';
import { panZoom, type PanZoom } from '../components/panzoom';

const SVG = 'http://www.w3.org/2000/svg';
/** The map is drawn this many units wide; positions are fractions of it. */
export const MAP_W = 2000;

export type MapMode = 'select' | 'pin' | 'region' | 'path' | 'measure' | 'scale';

export interface MapCanvasOptions {
	editable?: boolean;
	mode?: MapMode;
	selected?: MapItemRef | null;
	/** Show this one first (centred and a little closer). */
	focus?: MapItemRef | null;
	keep?: { k: number; x: number; y: number } | null;
	onView?(v: { k: number; x: number; y: number }): void;
	scrollPage?: boolean;
	onSelect?(ref: MapItemRef | null): void;
	onOpen?(ref: MapItemRef, evt: MouseEvent): void;
	onMenu?(ref: MapItemRef, evt: MouseEvent): void;
	/** Pin mode: a click on the map. `anchor` sits where the pin goes (for pickers). */
	onAddPin?(x: number, y: number, anchor: HTMLElement): void;
	onShape?(kind: 'region' | 'path', points: Array<[number, number]>): void;
	onMove?(ref: MapItemRef, patch: { x: number; y: number } | { points: Array<[number, number]> }): void;
	/** Drawing changed: how many points so far (0 = not drawing). */
	onDraft?(n: number): void;
	onMeasure?(text: string | null): void;
	/** Set-scale tool: two points were picked; `anchor` sits on the second one. */
	onScalePoints?(a: [number, number], b: [number, number], anchor: HTMLElement): void;
	/** A right-click while a tool is on: back to Select. */
	onCancelTool?(): void;
	/** The image's real shape, once it has loaded. */
	onImageShape?(aspect: number): void;
	onMissingImage?(el: HTMLElement): void;
}

export interface MapCanvas {
	pz: PanZoom;
	fit(animate?: boolean): void;
	reveal(ref: MapItemRef, animate?: boolean): void;
	setDoc(doc: MapDoc): void;
	setMode(mode: MapMode): void;
	select(ref: MapItemRef | null): void;
	finishDraft(): void;
	cancelDraft(): void;
	undoPoint(): void;
	/** Points picked so far by the ruler or Set scale. */
	picked(): number;
	destroy(): void;
}

const svgEl = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, parent?: Element): SVGElementTagNameMap[K] => {
	const n = activeDocument.createElementNS(SVG, tag);
	for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
	parent?.appendChild(n);
	return n;
};

const ptsAttr = (pts: Array<[number, number]>, W: number, H: number) => pts.map((p) => `${(p[0] * W).toFixed(1)},${(p[1] * H).toFixed(1)}`).join(' ');
const sameRef = (a: MapItemRef | null | undefined, b: MapItemRef | null | undefined) => !!a && !!b && a.kind === b.kind && a.id === b.id;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** The colour of an item: its own, its layer's, or its entry type's. */
export function itemTint(s: WorldSession, doc: MapDoc, item: MapItem, kind: MapItemKind): string {
	if (item.color) return item.color;
	const l = layerOf(doc, item);
	if (l?.color) return l.color;
	const e = item.entityId ? s.entities.get(item.entityId) : undefined;
	const t = e ? s.schemas.get(e.typeId) : undefined;
	if (t?.color) return t.color;
	return kind === 'pin' ? 'red' : kind === 'region' ? 'green' : 'orange';
}

export function pinIcon(s: WorldSession, pin: MapPin): string {
	if (pin.icon) return pin.icon;
	if (pin.mapId) return 'map';
	const e = pin.entityId ? s.entities.get(pin.entityId) : undefined;
	return (e && s.schemas.get(e.typeId)?.icon) || 'map-pin';
}

export function renderMap(parent: HTMLElement, app: App, s: WorldSession, initial: MapDoc, o: MapCanvasOptions = {}): MapCanvas {
	let doc = initial;
	let mode: MapMode = o.mode ?? 'select';
	let selected: MapItemRef | null = o.selected ?? null;
	const W = MAP_W;
	let H = W / doc.aspect;

	const vp = parent.createDiv({ cls: cx('ws-canvas', 'ws-map', `ws-map--labels-${doc.labels}`, `ws-map--backdrop-${doc.backdrop}`, o.editable && 'is-editable') });
	const stage = vp.createDiv({ cls: 'ws-canvas__stage' });
	const paper = stage.createDiv({ cls: cx('ws-map__paper', !doc.image && `ws-map__paper--${doc.backdrop}`) });
	const svg = svgEl('svg', { class: 'ws-map__svg' });
	const defs = svgEl('defs', {}, svg);
	const gGrid = svgEl('g', { class: 'ws-map__grid' }, svg);
	const gRegions = svgEl('g', { class: 'ws-map__regions' }, svg);
	const gPaths = svgEl('g', { class: 'ws-map__paths' }, svg);
	const gDraft = svgEl('g', { class: 'ws-map__draft' }, svg);
	stage.appendChild(svg);
	const labelsEl = stage.createDiv({ cls: 'ws-map__labels' });
	const pinsEl = stage.createDiv({ cls: 'ws-map__pins' });
	const handlesEl = stage.createDiv({ cls: 'ws-map__handles' });
	const scaleBar = vp.createDiv({ cls: 'ws-map__scale', attr: { 'aria-hidden': 'true' } });

	const size = () => {
		H = W / doc.aspect;
		paper.style.width = `${W}px`;
		paper.style.height = `${H}px`;
		svg.setAttribute('width', String(W));
		svg.setAttribute('height', String(H));
		svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
	};
	size();

	// ── The paper: an image, or a backdrop. ──
	const url = doc.image ? resourceUrl(app, doc.image.path) : null;
	if (doc.image && url) {
		const img = paper.createEl('img', { cls: 'ws-map__img', attr: { src: url, alt: '', draggable: 'false' } });
		img.addEventListener('load', () => {
			if (!img.naturalWidth || !img.naturalHeight) return;
			const a = img.naturalWidth / img.naturalHeight;
			if (Math.abs(a - doc.aspect) / doc.aspect > 0.004) o.onImageShape?.(a);
		});
	} else if (doc.image) {
		paper.addClass('ws-map__paper--parchment');
		const miss = paper.createDiv({ cls: 'ws-map__missing' });
		icon(miss, 'image-off');
		miss.createDiv({ cls: 'ws-map__missing-title', text: 'The map’s image can’t be found' });
		miss.createDiv({ cls: 'ws-map__missing-path', text: doc.image.path });
		o.onMissingImage?.(miss);
	}
	if (doc.compass) compassRose(paper, W, H);

	// ── Drawing everything on top. ──
	const pinEls = new Map<string, HTMLElement>();
	const shapeEls = new Map<string, SVGElement>();

	const drawGrid = () => {
		gGrid.replaceChildren();
		defs.replaceChildren();
		if (!doc.grid.show) return;
		const cell = W / doc.grid.cells;
		const pat = svgEl('pattern', { id: `ws-map-grid-${doc.id}`, patternUnits: 'userSpaceOnUse' }, defs);
		if (doc.grid.kind === 'square') {
			pat.setAttribute('width', String(cell));
			pat.setAttribute('height', String(cell));
			svgEl('path', { d: `M${cell},0 L0,0 L0,${cell}`, class: 'ws-map__grid-line' }, pat);
		} else {
			const w = cell;
			const r = w / Math.sqrt(3);
			pat.setAttribute('width', w.toFixed(3));
			pat.setAttribute('height', (3 * r).toFixed(3));
			svgEl('path', { d: `M${w / 2},0 L${w},${r / 2} L${w},${(3 * r) / 2} L${w / 2},${2 * r} L0,${(3 * r) / 2} L0,${r / 2} Z M${w / 2},${2 * r} L${w / 2},${3 * r}`, class: 'ws-map__grid-line' }, pat);
		}
		const rect = svgEl('rect', { x: 0, y: 0, width: W, height: H, fill: `url(#ws-map-grid-${doc.id})` }, gGrid);
		rect.style.opacity = String(doc.grid.opacity);
	};

	const drawItems = () => {
		gRegions.replaceChildren();
		gPaths.replaceChildren();
		pinsEl.empty();
		labelsEl.empty();
		pinEls.clear();
		shapeEls.clear();
		for (const r of doc.regions) {
			if (!itemVisible(doc, r) || r.points.length < 3) continue;
			const ref: MapItemRef = { kind: 'region', id: r.id };
			const tint = itemTint(s, doc, r, 'region');
			const poly = svgEl('polygon', { class: cx('ws-map__region', `ws-tint--${tint}`, `is-${r.style}`, sameRef(ref, selected) && 'is-selected').join(' '), points: ptsAttr(r.points, W, H), 'data-item': r.id, 'data-kind': 'region' }, gRegions);
			poly.style.setProperty('--ws-fill', String(r.opacity));
			shapeEls.set(`region:${r.id}`, poly);
			bindShape(poly, ref);
			if (!r.label.trim() && !r.entityId) continue;
			const [lx, ly] = centroid(r.points);
			const label = labelsEl.createDiv({ cls: cx('ws-map__area-label', `ws-tint--${tint}`, sameRef(ref, selected) && 'is-selected'), text: itemLabel(s, r, 'region'), attr: { 'data-item': r.id } });
			label.style.left = `${lx * W}px`;
			label.style.top = `${ly * H}px`;
		}
		for (const p of doc.paths) {
			if (!itemVisible(doc, p) || p.points.length < 2) continue;
			const ref: MapItemRef = { kind: 'path', id: p.id };
			const tint = itemTint(s, doc, p, 'path');
			const g = svgEl('g', { class: cx('ws-map__route', `ws-tint--${tint}`, sameRef(ref, selected) && 'is-selected').join(' '), 'data-item': p.id, 'data-kind': 'path' }, gPaths);
			const line = svgEl('polyline', { class: cx('ws-map__path', `is-${p.style}`).join(' '), points: ptsAttr(p.points, W, H) }, g);
			line.style.strokeWidth = String(p.width);
			svgEl('polyline', { class: 'ws-map__hit', points: ptsAttr(p.points, W, H) }, g);
			shapeEls.set(`path:${p.id}`, g);
			bindShape(g, ref);
			if (p.arrow) {
				const a = p.points[p.points.length - 2]!;
				const b = p.points[p.points.length - 1]!;
				const ang = (Math.atan2((b[1] - a[1]) * H, (b[0] - a[0]) * W) * 180) / Math.PI;
				const head = labelsEl.createDiv({ cls: cx('ws-map__arrow', `ws-tint--${tint}`) });
				head.style.left = `${b[0] * W}px`;
				head.style.top = `${b[1] * H}px`;
				head.style.setProperty('--ws-angle', `${ang}deg`);
				head.style.setProperty('--ws-w', String(p.width));
			}
			const name = itemLabel(s, p, 'path');
			if (p.label.trim() || p.entityId) {
				const [lx, ly] = midpoint(p.points);
				const label = labelsEl.createDiv({ cls: cx('ws-map__route-label', `ws-tint--${tint}`, sameRef(ref, selected) && 'is-selected'), text: name, attr: { 'data-item': p.id } });
				label.style.left = `${lx * W}px`;
				label.style.top = `${ly * H}px`;
			}
		}
		for (const p of doc.pins) {
			if (!itemVisible(doc, p)) continue;
			const ref: MapItemRef = { kind: 'pin', id: p.id };
			const e = p.entityId ? s.entities.get(p.entityId) : undefined;
			const gone = !!e?.trashedAt || (!!p.entityId && !e);
			const pin = pinsEl.createDiv({
				cls: cx('ws-map-pin', `ws-tint--${itemTint(s, doc, p, 'pin')}`, `ws-map-pin--${p.size ?? doc.pinSize}`, sameRef(ref, selected) && 'is-selected', p.mapId && 'has-map', gone && 'is-gone'),
				attr: { 'data-item': p.id, 'data-kind': 'pin', tabindex: '0', role: 'button', 'aria-label': itemLabel(s, p, 'pin') },
			});
			pin.style.left = `${p.x * W}px`;
			pin.style.top = `${p.y * H}px`;
			const head = pin.createDiv({ cls: 'ws-map-pin__head' });
			const portrait = !p.icon && e?.media.portrait ? resourceUrl(app, e.media.portrait.path) : null;
			if (portrait) head.createEl('img', { cls: 'ws-map-pin__img', attr: { src: portrait, alt: '', draggable: 'false' } });
			else icon(head, pinIcon(s, p));
			if (p.mapId) icon(pin.createDiv({ cls: 'ws-map-pin__badge' }), 'layers');
			pin.createDiv({ cls: 'ws-map-pin__label', text: itemLabel(s, p, 'pin') });
			pin.setAttr('title', [itemLabel(s, p, 'pin'), e && !gone ? s.schemas.get(e.typeId)?.singular : null, gone ? 'its entry is in the trash' : null, p.note ? p.note.slice(0, 120) : null].filter(Boolean).join(' · '));
			pinEls.set(p.id, pin);
			bindPin(pin, ref);
		}
		drawHandles();
	};

	// ── Handles for the selected area or route. ──
	const drawHandles = () => {
		handlesEl.empty();
		if (!o.editable || mode !== 'select' || !selected || selected.kind === 'pin') return;
		const item = (selected.kind === 'region' ? doc.regions : doc.paths).find((i) => i.id === selected!.id);
		if (!item || !itemVisible(doc, item)) return;
		const pts = item.points;
		const closed = selected.kind === 'region';
		const ref = selected;
		pts.forEach((p, i) => {
			const h = handlesEl.createDiv({ cls: 'ws-map__handle', attr: { 'data-index': String(i), title: 'Drag to move. Double-click to remove.' } });
			h.style.left = `${p[0] * W}px`;
			h.style.top = `${p[1] * H}px`;
			dragHandle(h, (x, y) => {
				const next = pts.map((q) => [q[0], q[1]] as [number, number]);
				next[i] = [x, y];
				return next;
			}, ref);
			h.addEventListener('dblclick', (evt) => {
				evt.stopPropagation();
				if (pts.length <= (closed ? 3 : 2)) return;
				o.onMove?.(ref, { points: pts.filter((_, j) => j !== i) });
			});
		});
		// Between corners: drag to add a corner there.
		const n = closed ? pts.length : pts.length - 1;
		for (let i = 0; i < n; i++) {
			const a = pts[i]!;
			const b = pts[(i + 1) % pts.length]!;
			const h = handlesEl.createDiv({ cls: 'ws-map__handle ws-map__handle--mid', attr: { title: 'Drag to add a corner' } });
			h.style.left = `${((a[0] + b[0]) / 2) * W}px`;
			h.style.top = `${((a[1] + b[1]) / 2) * H}px`;
			dragHandle(h, (x, y) => {
				const next = pts.map((q) => [q[0], q[1]] as [number, number]);
				next.splice(i + 1, 0, [x, y]);
				return next;
			}, ref);
		}
	};

	const toMap = (evt: PointerEvent | MouseEvent): [number, number] => {
		const p = pz.toStage(evt.clientX, evt.clientY);
		return [clamp01(p.x / W), clamp01(p.y / H)];
	};

	/** Drag a corner; the shape follows live and is saved when let go. */
	const dragHandle = (h: HTMLElement, make: (x: number, y: number) => Array<[number, number]>, ref: MapItemRef) => {
		h.addEventListener('pointerdown', (evt) => {
			if (evt.button !== 0 && evt.pointerType === 'mouse') return;
			evt.stopPropagation();
			evt.preventDefault();
			try {
				h.setPointerCapture(evt.pointerId);
			} catch {
				/* fine */
			}
			let next: Array<[number, number]> | null = null;
			const el = shapeEls.get(`${ref.kind}:${ref.id}`);
			const move = (e: PointerEvent) => {
				const [x, y] = toMap(e);
				next = make(x, y);
				h.style.left = `${x * W}px`;
				h.style.top = `${y * H}px`;
				const attr = ptsAttr(next, W, H);
				if (el.instanceOf(SVGPolygonElement)) el.setAttribute('points', attr);
				else el?.querySelectorAll('polyline').forEach((l) => l.setAttribute('points', attr));
			};
			const up = () => {
				h.removeEventListener('pointermove', move);
				h.removeEventListener('pointerup', up);
				h.removeEventListener('pointercancel', up);
				if (next) o.onMove?.(ref, { points: next });
			};
			h.addEventListener('pointermove', move);
			h.addEventListener('pointerup', up);
			h.addEventListener('pointercancel', up);
		});
	};

	const bindPin = (pin: HTMLElement, ref: MapItemRef) => {
		let drag: { sx: number; sy: number; moved: boolean; id: number } | null = null;
		pin.addEventListener('pointerdown', (evt) => {
			if (mode !== 'select') return;
			if (evt.button !== 0 && evt.pointerType === 'mouse') return;
			evt.stopPropagation();
			drag = { sx: evt.clientX, sy: evt.clientY, moved: false, id: evt.pointerId };
			try {
				pin.setPointerCapture(evt.pointerId);
			} catch {
				/* fine */
			}
		});
		pin.addEventListener('pointermove', (evt) => {
			if (!drag || drag.id !== evt.pointerId || !o.editable) return;
			if (!drag.moved && Math.abs(evt.clientX - drag.sx) + Math.abs(evt.clientY - drag.sy) < 5) return;
			drag.moved = true;
			pin.addClass('is-dragging');
			const [x, y] = toMap(evt);
			pin.style.left = `${x * W}px`;
			pin.style.top = `${y * H}px`;
		});
		const end = (evt: PointerEvent) => {
			if (!drag || drag.id !== evt.pointerId) return;
			const d = drag;
			drag = null;
			pin.removeClass('is-dragging');
			if (d.moved) {
				const [x, y] = toMap(evt);
				o.onMove?.(ref, { x, y });
			} else if (evt.type === 'pointerup') {
				if (o.onSelect) select(sameRef(selected, ref) ? null : ref);
				else o.onOpen?.(ref, evt);
			}
		};
		pin.addEventListener('pointerup', end);
		pin.addEventListener('pointercancel', end);
		pin.addEventListener('dblclick', (evt) => mode === 'select' && o.onOpen?.(ref, evt));
		pin.addEventListener('keydown', (evt) => {
			if (evt.key === 'Enter') o.onOpen?.(ref, evt as unknown as MouseEvent);
			else if (evt.key === ' ') {
				evt.preventDefault();
				select(ref);
			}
		});
		pin.addEventListener('contextmenu', (evt) => {
			if (!o.onMenu) return;
			evt.preventDefault();
			o.onMenu(ref, evt);
		});
	};

	/** Areas and routes: click to select; drag a selected one to move it whole. */
	const bindShape = (el: SVGElement, ref: MapItemRef) => {
		let drag: { start: [number, number]; pts: Array<[number, number]>; moved: boolean; id: number; sx: number; sy: number } | null = null;
		el.addEventListener('pointerdown', (evt) => {
			if (mode !== 'select') return;
			if (evt.button !== 0 && evt.pointerType === 'mouse') return;
			evt.stopPropagation();
			const item = (ref.kind === 'region' ? doc.regions : doc.paths).find((i) => i.id === ref.id);
			if (!item) return;
			drag = { start: toMap(evt), pts: item.points, moved: false, id: evt.pointerId, sx: evt.clientX, sy: evt.clientY };
			try {
				el.setPointerCapture(evt.pointerId);
			} catch {
				/* fine */
			}
		});
		el.addEventListener('pointermove', (evt) => {
			if (!drag || drag.id !== evt.pointerId || !o.editable || !sameRef(selected, ref)) return;
			if (!drag.moved && Math.abs(evt.clientX - drag.sx) + Math.abs(evt.clientY - drag.sy) < 5) return;
			drag.moved = true;
			const [x, y] = toMap(evt);
			const next = shifted(drag.pts, x - drag.start[0], y - drag.start[1]);
			const attr = ptsAttr(next, W, H);
			if (el.instanceOf(SVGPolygonElement)) el.setAttribute('points', attr);
			else el.querySelectorAll('polyline').forEach((l) => l.setAttribute('points', attr));
			handlesEl.empty();
		});
		const end = (evt: PointerEvent) => {
			if (!drag || drag.id !== evt.pointerId) return;
			const d = drag;
			drag = null;
			if (d.moved) {
				const [x, y] = toMap(evt);
				o.onMove?.(ref, { points: shifted(d.pts, x - d.start[0], y - d.start[1]) });
			} else if (evt.type === 'pointerup') {
				if (o.onSelect) select(sameRef(selected, ref) ? null : ref);
				else o.onOpen?.(ref, evt);
			}
		};
		el.addEventListener('pointerup', end);
		el.addEventListener('pointercancel', end);
		el.addEventListener('dblclick', (evt) => mode === 'select' && o.onOpen?.(ref, evt));
		el.addEventListener('contextmenu', (evt) => {
			if (!o.onMenu) return;
			evt.preventDefault();
			o.onMenu(ref, evt);
		});
	};

	// ── Drawing a new area or route, and measuring. ──
	let draft: Array<[number, number]> = [];
	let hover: [number, number] | null = null;
	let measure: Array<[number, number]> = [];
	const drawDraft = () => {
		gDraft.replaceChildren();
		const pts = mode === 'measure' || mode === 'scale' ? measure : draft;
		if (!pts.length) {
			vp.querySelector(':scope .ws-map__measure-label')?.remove();
			return;
		}
		const all = hover && mode !== 'select' && !(mode === 'scale' && pts.length >= 2) ? [...pts, hover] : pts;
		if (mode === 'region' && all.length >= 3) svgEl('polygon', { class: 'ws-map__draft-fill', points: ptsAttr(all, W, H) }, gDraft);
		svgEl('polyline', { class: cx('ws-map__draft-line', mode === 'measure' && 'is-measure', mode === 'scale' && 'is-scale').join(' '), points: ptsAttr(all, W, H) }, gDraft);
		pts.forEach((p, i) => {
			const c = svgEl('circle', { class: cx('ws-map__draft-dot', i === 0 && mode === 'region' && pts.length >= 3 && 'is-closer').join(' '), cx: p[0] * W, cy: p[1] * H, r: 5 }, gDraft);
			c.style.setProperty('r', `calc(5px * var(--ws-ik, 1))`);
		});
		if (mode === 'measure') {
			const total = formatDistance(polylineLength(all, doc.aspect), doc.scale);
			o.onMeasure?.(pts.length ? total : null);
			let tag = labelsEl.querySelector<HTMLElement>('.ws-map__measure-label');
			if (!tag) tag = labelsEl.createDiv({ cls: 'ws-map__measure-label' });
			const last = all[all.length - 1]!;
			tag.setText(total);
			tag.style.left = `${last[0] * W}px`;
			tag.style.top = `${last[1] * H}px`;
		}
	};
	const finishDraft = () => {
		if (mode === 'region' && draft.length >= 3) o.onShape?.('region', draft);
		else if (mode === 'path' && draft.length >= 2) o.onShape?.('path', draft);
		else if (draft.length) return;
		draft = [];
		hover = null;
		drawDraft();
		o.onDraft?.(0);
	};
	const cancelDraft = () => {
		draft = [];
		measure = [];
		hover = null;
		labelsEl.querySelector('.ws-map__measure-label')?.remove();
		drawDraft();
		o.onDraft?.(0);
		o.onMeasure?.(null);
	};
	const near = (a: [number, number], b: [number, number], px: number) => Math.hypot((a[0] - b[0]) * W * pz.k, (a[1] - b[1]) * H * pz.k) < px;

	let lastClick = 0;
	const background = (evt: PointerEvent) => {
		const at = toMap(evt);
		if (mode === 'select') return select(null);
		if (!o.editable && mode !== 'measure') return;
		if (mode === 'scale' && !o.editable) return;
		if (mode === 'pin') {
			const anchor = stage.createDiv({ cls: 'ws-map__anchor' });
			anchor.style.left = `${at[0] * W}px`;
			anchor.style.top = `${at[1] * H}px`;
			o.onAddPin?.(at[0], at[1], anchor);
			window.setTimeout(() => anchor.remove(), 30000);
			return;
		}
		const now = performance.now();
		const quick = now - lastClick < 350;
		lastClick = now;
		if (mode === 'measure') {
			if (measure.length && near(measure[measure.length - 1]!, at, 6)) return;
			measure.push(at);
			return drawDraft();
		}
		if (mode === 'scale') {
			// Two points, then ask how far apart they are; a third click starts again.
			if (measure.length >= 2) measure = [];
			if (measure.length && near(measure[0]!, at, 6)) return;
			measure.push(at);
			drawDraft();
			if (measure.length === 2) {
				const anchor = stage.createDiv({ cls: 'ws-map__anchor' });
				anchor.style.left = `${at[0] * W}px`;
				anchor.style.top = `${at[1] * H}px`;
				// Whoever asks for the distance removes the anchor when done.
				if (o.onScalePoints) o.onScalePoints(measure[0]!, measure[1]!, anchor);
				else anchor.remove();
			}
			return;
		}
		// A second click on the same spot (a double-click) finishes the shape.
		if (draft.length && near(draft[draft.length - 1]!, at, 8)) {
			if (quick) finishDraft();
			return;
		}
		if (mode === 'region' && draft.length >= 3 && near(draft[0]!, at, 12)) return finishDraft();
		draft.push(at);
		drawDraft();
		o.onDraft?.(draft.length);
	};
	vp.addEventListener('pointermove', (evt) => {
		if (mode === 'select' || mode === 'pin') return;
		if (!draft.length && !measure.length) return;
		hover = toMap(evt);
		drawDraft();
	});
	// Right-click while drawing, measuring or dropping pins puts the tool down (0.12).
	// A long press on a touch screen also fires this; it mustn't wipe what's being drawn.
	let touched = false;
	vp.addEventListener('pointerdown', (evt) => (touched = evt.pointerType !== 'mouse'), true);
	vp.addEventListener(
		'contextmenu',
		(evt) => {
			if (mode === 'select' || !o.onCancelTool) return;
			evt.preventDefault();
			evt.stopPropagation();
			if (!touched) o.onCancelTool();
		},
		true,
	);
	vp.addEventListener('pointerleave', () => {
		if (!hover) return;
		hover = null;
		drawDraft();
	});

	// ── Pan, zoom, labels that come and go, the scale bar. ──
	const paintScale = (k: number) => {
		if (!doc.scale) {
			scaleBar.addClass('is-hidden');
			return;
		}
		scaleBar.removeClass('is-hidden');
		const perPx = doc.scale.width / (W * k);
		const step = niceStep(perPx * 110);
		const px = step / perPx;
		scaleBar.empty();
		const bar = scaleBar.createDiv({ cls: 'ws-map__scale-bar' });
		bar.style.width = `${Math.round(px)}px`;
		scaleBar.createDiv({ cls: 'ws-map__scale-text', text: `${step.toLocaleString('en', { maximumFractionDigits: 3 })} ${doc.scale.unit}` });
	};

	let fitK = 1;
	const pz = panZoom(vp, stage, {
		min: 0.03,
		max: 8,
		ignore: '.ws-map-pin, .ws-map__handle, .ws-map__region, .ws-map__route, .ws-canvas__hud, .ws-vis-spot, .ws-map-editor, .ws-map__legend',
		scrollPage: o.scrollPage,
		onChange: (p) => {
			vp.toggleClass('is-near', p.k >= fitK * 1.8);
			paintScale(p.k);
			o.onView?.({ k: p.k, x: p.x, y: p.y });
		},
		onBackgroundClick: background,
	});
	const select = (ref: MapItemRef | null) => {
		selected = ref;
		for (const el of [...pinsEl.children, ...labelsEl.children] as HTMLElement[]) el.toggleClass('is-selected', !!ref && el.dataset.item === ref.id);
		for (const [k, el] of shapeEls) el.classList.toggle('is-selected', !!ref && k === `${ref.kind}:${ref.id}`);
		drawHandles();
		o.onSelect?.(ref);
	};

	const fit = (animate?: boolean) => {
		pz.fit([0, 0, W, H], { pad: 16, max: 4, animate });
		const r = vp.getBoundingClientRect();
		fitK = Math.min(((r.width || 800) - 32) / W, ((r.height || 500) - 32) / H);
		vp.toggleClass('is-near', pz.k >= fitK * 1.8);
	};
	const reveal = (ref: MapItemRef, animate = true) => {
		const it = (ref.kind === 'pin' ? doc.pins : ref.kind === 'region' ? doc.regions : doc.paths).find((i) => i.id === ref.id);
		if (!it) return;
		const b = itemBox(it, ref.kind);
		const r = vp.getBoundingClientRect();
		const padW = Math.max(W * 0.08, (b[2] - b[0]) * W * 0.3);
		const padH = Math.max(H * 0.08, (b[3] - b[1]) * H * 0.3);
		pz.fit([b[0] * W - padW, b[1] * H - padH, b[2] * W + padW, b[3] * H + padH], { pad: 30, max: Math.max(fitK * 3, (r.width || 800) / W), animate });
	};

	drawGrid();
	drawItems();
	if (o.keep) {
		const r = vp.getBoundingClientRect();
		fitK = Math.min(((r.width || 800) - 32) / W, ((r.height || 500) - 32) / H);
		pz.set(o.keep.k, o.keep.x, o.keep.y);
	} else {
		fit();
		if (o.focus) reveal(o.focus, false);
		// The host may not have its size yet on the first frame.
		window.requestAnimationFrame(() => {
			if (!vp.isConnected) return;
			fit();
			if (o.focus) reveal(o.focus, false);
		});
	}
	const setMode = (m: MapMode) => {
		// Picking the same tool again starts it over.
		if (m !== mode || m === 'scale') cancelDraft();
		mode = m;
		for (const x of ['select', 'pin', 'region', 'path', 'measure', 'scale']) vp.toggleClass(`is-mode-${x}`, x === m);
		vp.toggleClass('is-drawing', m !== 'select');
		drawHandles();
	};
	setMode(mode);

	return {
		pz,
		fit,
		reveal,
		setDoc(next) {
			const reshape = next.aspect !== doc.aspect;
			doc = next;
			if (reshape) size();
			vp.className = vp.className.replace(/ws-map--labels-\w+/, `ws-map--labels-${doc.labels}`);
			drawGrid();
			drawItems();
			paintScale(pz.k);
		},
		setMode,
		select,
		finishDraft,
		cancelDraft,
		picked: () => measure.length,
		undoPoint() {
			if (mode === 'measure' || mode === 'scale') measure.pop();
			else draft.pop();
			drawDraft();
			o.onDraft?.(mode === 'measure' || mode === 'scale' ? 0 : draft.length);
			if (mode === 'measure' && !measure.length) o.onMeasure?.(null);
		},
		destroy() {
			pz.destroy();
		},
	};
}

const shifted = (pts: Array<[number, number]>, dx: number, dy: number): Array<[number, number]> => {
	// Keep the whole shape on the map.
	const minX = Math.min(...pts.map((p) => p[0]));
	const maxX = Math.max(...pts.map((p) => p[0]));
	const minY = Math.min(...pts.map((p) => p[1]));
	const maxY = Math.max(...pts.map((p) => p[1]));
	const ddx = Math.min(1 - maxX, Math.max(-minX, dx));
	const ddy = Math.min(1 - maxY, Math.max(-minY, dy));
	return pts.map((p) => [p[0] + ddx, p[1] + ddy]);
};

/** A quiet compass rose in the top-right corner of the paper. */
function compassRose(paper: HTMLElement, W: number, H: number): void {
	const size = Math.min(W, H) * 0.13;
	const svg = activeDocument.createElementNS(SVG, 'svg');
	svg.setAttribute('class', 'ws-map__compass');
	svg.setAttribute('viewBox', '-50 -50 100 100');
	svg.setAttribute('aria-hidden', 'true');
	svg.style.width = `${size}px`;
	svg.style.height = `${size}px`;
	svg.style.right = `${size * 0.35}px`;
	svg.style.top = `${size * 0.35}px`;
	const add = (tag: string, attrs: Record<string, string | number>) => {
		const n = activeDocument.createElementNS(SVG, tag);
		for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
		svg.appendChild(n);
		return n;
	};
	add('circle', { r: 34, class: 'ws-map__compass-ring' });
	add('circle', { r: 28, class: 'ws-map__compass-ring is-thin' });
	for (let i = 0; i < 4; i++) {
		const a = (i * Math.PI) / 2 + Math.PI / 4;
		add('polygon', { points: `0,0 ${Math.cos(a - 0.22) * 9},${Math.sin(a - 0.22) * 9} ${Math.cos(a) * 26},${Math.sin(a) * 26} ${Math.cos(a + 0.22) * 9},${Math.sin(a + 0.22) * 9}`, class: 'ws-map__compass-minor' });
	}
	add('polygon', { points: '0,-44 7,0 0,7 -7,0', class: 'ws-map__compass-north' });
	add('polygon', { points: '0,44 7,0 0,-7 -7,0', class: 'ws-map__compass-point' });
	add('polygon', { points: '-44,0 0,-6 6,0 0,6', class: 'ws-map__compass-point' });
	add('polygon', { points: '44,0 0,-6 -6,0 0,6', class: 'ws-map__compass-point' });
	const n = add('text', { x: 0, y: -46, 'text-anchor': 'middle', class: 'ws-map__compass-n' });
	n.textContent = 'N';
	paper.appendChild(svg);
}

/** A small still picture of a map: the image (or backdrop) with its pins as dots. */
export function mapThumb(parent: HTMLElement, app: App, s: WorldSession, doc: MapDoc, cls = ''): HTMLElement {
	const box = parent.createDiv({ cls: cx('ws-map-thumb', !doc.image && `ws-map__paper--${doc.backdrop}`, cls) });
	box.style.aspectRatio = String(doc.aspect);
	const url = doc.image ? resourceUrl(app, doc.image.path) : null;
	if (url) box.createEl('img', { cls: 'ws-map-thumb__img', attr: { src: url, alt: '', loading: 'lazy', draggable: 'false' } });
	else if (doc.image) {
		box.addClass('ws-map__paper--parchment');
		icon(box.createDiv({ cls: 'ws-map-thumb__missing' }), 'image-off');
	}
	const svg = svgEl('svg', { class: 'ws-map-thumb__svg', viewBox: `0 0 100 ${(100 / doc.aspect).toFixed(2)}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
	const h = 100 / doc.aspect;
	for (const r of doc.regions) if (itemVisible(doc, r) && r.points.length >= 3) svgEl('polygon', { class: `ws-map-thumb__region ws-tint--${itemTint(s, doc, r, 'region')}`, points: ptsAttr(r.points, 100, h) }, svg);
	for (const p of doc.paths) if (itemVisible(doc, p) && p.points.length >= 2) svgEl('polyline', { class: `ws-map-thumb__path ws-tint--${itemTint(s, doc, p, 'path')}`, points: ptsAttr(p.points, 100, h) }, svg);
	box.appendChild(svg);
	for (const p of doc.pins) {
		if (!itemVisible(doc, p)) continue;
		const d = box.createDiv({ cls: `ws-map-thumb__pin ws-tint--${itemTint(s, doc, p, 'pin')}` });
		d.style.left = `${p.x * 100}%`;
		d.style.top = `${p.y * 100}%`;
	}
	return box;
}
