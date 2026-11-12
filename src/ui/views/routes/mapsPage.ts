import { Menu, Notice, setTooltip, type TFile } from 'obsidian';
import { SEMANTIC_COLORS, type EntityRecord, type MapDoc, type MapItemKind, type MapLayer, type MapPath, type MapPin, type MapRegion, type SemanticColor } from '../../../core/types';
import { uuid } from '../../../core/util/ids';
import { baseNameOf } from '../../../core/util/media';
import { formatArea, formatDistance, findItem, scaleFromPoints, ITEM_NOUN, itemLabel, itemsOf, mapProblems, parentMaps, patchItem, polygonArea, polylineLength, removeItem, type MapItem, type MapItemRef } from '../../../services/maps';
import type { WorldSession } from '../../../services/WorldSession';
import { ROUTES } from '../../../state/route';
import { entityMenu } from '../../actions';
import { avatar } from '../../components/avatar';
import { button, cx, icon } from '../../components/dom';
import { EntityPicker } from '../../components/EntityPicker';
import { own } from '../../components/lifecycle';
import { confirmModal, IconPickerModal, promptModal } from '../../components/modals';
import { actionNotice } from '../../components/notice';
import { Popover } from '../../components/popover';
import { mapThumb, pinIcon, renderMap, type MapCanvas, type MapMode } from '../../maps/render';
import { ImageBrowser } from '../../media/ImageBrowser';
import { aboutSection, canvasHud, docCard, fullView, panelSection, segmentedRow, startCard, toggleRow, visualHeader, visualHome, type DocActions, type FullView } from '../../visual/common';
import { hoverPeek, type Peek } from '../../visual/peek';
import { colorSwatches, formRow, inlineText, segmented } from './typeStudio/common';
import type { RouteContext, RouteDefinition } from './RouteRegistry';
import { mountToolBanner } from '../../media/pageBanner';

/**
 * Maps (0.11): your own map images (or a blank parchment) with pins, areas and routes on
 * top, each one linked to an entry if you like. Layers switch groups on and off, a scale
 * turns the ruler into miles or leagues, and a pin can open a closer map of its own.
 */
export const mapsRoute: RouteDefinition = {
	id: 'maps',
	needsWorld: true,
	title: (p, s) => s?.maps.get(p.id)?.name ?? 'Maps',
	icon: () => 'map',
	render(ctx) {
		new MapsPage(ctx).mount();
	},
};

const TOOLS: Array<{ id: MapMode; label: string; icon: string; key: string; tip: string }> = [
	{ id: 'select', label: 'Select', icon: 'mouse-pointer-2', key: 'V', tip: 'Select and move things (V)' },
	{ id: 'pin', label: 'Pin', icon: 'map-pin', key: 'P', tip: 'Drop a pin (P)' },
	{ id: 'region', label: 'Area', icon: 'pentagon', key: 'A', tip: 'Draw an area: a kingdom, a forest, a sea (A)' },
	{ id: 'path', label: 'Route', icon: 'route', key: 'R', tip: 'Draw a route: a road, a river, a journey (R)' },
	{ id: 'measure', label: 'Measure', icon: 'ruler', key: 'M', tip: 'Measure a distance (M)' },
	{ id: 'scale', label: 'Set scale', icon: 'move-horizontal', key: 'S', tip: 'Set the scale: click two points and say how far apart they are (S)' },
];

const UNITS = ['miles', 'km', 'leagues', 'days’ ride', 'days on foot', 'versts', 'li', 'parsecs'];

const PIN_ICONS = ['map-pin', 'castle', 'landmark', 'home', 'church', 'tent', 'mountain', 'mountain-snow', 'trees', 'tree-pine', 'waves', 'anchor', 'ship', 'sword', 'swords', 'shield', 'skull', 'crown', 'flag', 'gem', 'flame', 'sparkles', 'star', 'scroll', 'book-open', 'key', 'eye', 'moon', 'sun', 'beer', 'pickaxe', 'wheat', 'circle-dot'];

const ASPECTS: Array<{ id: string; label: string; v: number }> = [
	{ id: 'wide', label: 'Wide', v: 1.5 },
	{ id: 'pano', label: 'Panorama', v: 2 },
	{ id: 'square', label: 'Square', v: 1 },
	{ id: 'tall', label: 'Tall', v: 2 / 3 },
];

const HINTS: Record<MapMode, string> = {
	select: '',
	pin: 'Click anywhere to drop a pin.',
	region: 'Click to add corners. Click the first corner, double-click or press Enter to finish.',
	path: 'Click to add points along the way. Double-click or press Enter to finish.',
	measure: 'Click from place to place to measure. Esc clears.',
	scale: 'Click two points you know the distance between, like two towns or the ends of the map’s own scale bar.',
};

const prettyName = (file: TFile | string): string => {
	const base = baseNameOf(typeof file === 'string' ? file : file.path).replace(/[-_]+/g, ' ').trim();
	return base ? base[0]!.toUpperCase() + base.slice(1) : 'Map';
};

class MapsPage {
	private id: string | null;
	private pageEl!: HTMLElement;
	private headEl!: HTMLElement;
	private bodyEl!: HTMLElement;
	private canvas: MapCanvas | null = null;
	private hostEl: HTMLElement | null = null;
	private view: { k: number; x: number; y: number } | null = null;
	private viewOf = '';
	private mode: MapMode = 'select';
	private selected: MapItemRef | null = null;
	private focus: MapItemRef | null = null;
	/** Versions before each change, for Undo (this page only). */
	private history: MapDoc[] = [];
	private redo: MapDoc[] = [];
	/** Maps opened from a pin, so "Back" goes up again. */
	private trail: string[] = [];
	private panel: Popover | null = null;
	private layersPop: Popover | null = null;
	private queued = false;
	private saving = false;
	private headSig = '';
	private draftN = 0;
	private measureText: string | null = null;

	/** Set once the page is left: a late timer must not draw into the next page. */
	private dead = false;

	constructor(private readonly ctx: RouteContext) {
		own(ctx.component, { dispose: () => (this.dead = true) });
		const s = ctx.session!;
		this.id = s.maps.get(ctx.params.id)?.id ?? null;
		const doc = this.doc;
		if (doc && ctx.params.focus) this.focus = this.resolveFocus(doc, ctx.params.focus);
		if (this.focus) this.selected = this.focus;
	}

	private get s(): WorldSession {
		return this.ctx.session!;
	}

	private get doc(): MapDoc | undefined {
		return this.s.maps.get(this.id);
	}

	private resolveFocus(doc: MapDoc, key: string): MapItemRef | null {
		for (const kind of ['pin', 'region', 'path'] as const) {
			const byId = (itemsOf(doc, kind)).find((i) => i.id === key);
			if (byId) return { kind, id: byId.id };
		}
		for (const kind of ['pin', 'region', 'path'] as const) {
			const byEntity = (itemsOf(doc, kind)).find((i) => i.entityId === key);
			if (byEntity) return { kind, id: byEntity.id };
		}
		return null;
	}

	mount(): void {
		this.pageEl = this.ctx.el.createDiv({ cls: 'ws-page ws-vis ws-maps' });
		this.headEl = this.pageEl.createDiv();
		this.bodyEl = this.pageEl.createDiv({ cls: 'ws-vis__body' });
		this.render();
		const later = () => this.queue();
		const ev = this.s.events;
		const c = this.ctx.component;
		own(c, ev.on('entity:created', later));
		own(c, ev.on('entity:deleted', later));
		own(c, ev.on('entity:updated', ({ change }) => change.keys.some((k) => ['name', 'trashedAt', 'media', 'typeId'].includes(k)) && later()));
		own(c, ev.on('schema:updated', later));
		own(c, ev.on('doc:saved', ({ kind, id }) => {
			if (kind !== 'map' || this.saving) return;
			// Changed from elsewhere (another pane, a relinked image): our undo steps no longer apply.
			if (id === this.id) {
				this.history = [];
				this.redo = [];
			}
			later();
		}));
		own(c, ev.on('doc:deleted', ({ kind, id }) => {
			if (kind !== 'map') return;
			if (id === this.id) this.id = null;
			later();
		}));
		this.pageEl.addEventListener('keydown', (evt) => this.onKey(evt));
		own(c, { dispose: () => { this.canvas?.destroy(); this.panel?.close(); this.layersPop?.close(); this.scalePop?.close(); this.peek?.destroy(); } });
	}

	private queue(): void {
		if (this.queued) return;
		this.queued = true;
		window.setTimeout(() => {
			this.queued = false;
			if (!this.dead && this.ctx.el.isConnected) this.render();
		}, 60);
	}

	/** Save a change to this map, keeping the version before it for Undo. */
	private change(patch: Partial<MapDoc>, o: { keepRedo?: boolean } = {}): MapDoc | null {
		if (!this.id) return null;
		this.saving = true;
		const res = this.s.maps.update(this.id, patch);
		this.saving = false;
		if (!res) return null;
		this.history.push(res.before);
		if (this.history.length > 80) this.history.shift();
		if (!o.keepRedo) this.redo = [];
		this.afterChange(res.before, res.after);
		return res.after;
	}

	private afterChange(before: MapDoc, after: MapDoc): void {
		if (this.paperKey(before) !== this.paperKey(after) || !this.canvas) this.render();
		else {
			this.canvas.setDoc(after);
			if (this.selected && !findItem(after, this.selected)) this.selected = null;
			this.renderBar(after);
			this.renderEditor(after);
			if (this.headSig !== this.sigOf(after)) this.render();
			else if (before.name !== after.name) {
				this.frame?.setName(after.name);
				this.ctx.setTitle(after.name);
			}
		}
		if (this.panel) this.fillPanel(this.panel.el);
		if (this.layersPop) this.fillLayers(this.layersPop.el);
		this.layersBtn?.querySelector('.ws-btn__label')?.setText(after.layers.length ? `Layers (${after.layers.length})` : 'Layers');
	}

	/** A notice's Undo: patch the map it came from (whatever is open now), from its current state. */
	private undoOn(id: string, fix: (doc: MapDoc) => Partial<MapDoc> | null): void {
		const doc = this.s.maps.get(id);
		const patch = doc && fix(doc);
		if (!patch) return;
		if (!this.dead && id === this.id) this.change(patch);
		else this.s.maps.update(id, patch);
	}

	private undo(): void {
		const prev = this.history.pop();
		if (!prev || !this.id) return;
		const cur = this.doc;
		this.saving = true;
		const res = this.s.maps.update(this.id, prev);
		this.saving = false;
		if (cur) this.redo.push(cur);
		if (res) this.afterChange(res.before, res.after);
	}

	private redoOnce(): void {
		const next = this.redo.pop();
		if (!next) return;
		this.change(next, { keepRedo: true });
	}

	private open(id: string | null, o: { from?: string; focus?: MapItemRef | null } = {}): void {
		if (o.from) this.trail.push(o.from);
		else if (o.from === undefined) this.trail = [];
		this.id = id;
		this.view = null;
		this.selected = o.focus ?? null;
		this.focus = o.focus ?? null;
		this.history = [];
		this.redo = [];
		this.mode = 'select';
		this.ctx.replaceParams(id ? { id } : {});
		this.render();
	}

	/** The frame (home header, or the map's top bar) is rebuilt only when this changes. */
	private sigOf(doc: MapDoc | undefined): string {
		return JSON.stringify([!!doc, this.headKey(doc)]);
	}

	private headKey(doc: MapDoc | undefined): string {
		return JSON.stringify([doc?.id, doc?.icon, doc?.entityId]);
	}

	/** What the canvas has to be rebuilt for (rather than just redrawn). */
	private paperKey(doc: MapDoc): string {
		return JSON.stringify([doc.id, doc.image?.path, doc.backdrop, doc.compass, doc.aspect]);
	}

	private render(): void {
		const doc = this.doc;
		const full = !!doc;
		const sig = this.sigOf(doc);
		this.pageEl.toggleClass('ws-page--full', full);
		if (sig !== this.headSig) {
			this.headSig = sig;
			this.panel?.close();
			this.layersPop?.close();
			this.peek?.destroy();
			this.peek = null;
			this.headEl.empty();
			this.bodyEl.empty();
			this.frame = null;
			this.barEl = null;
			if (doc) this.renderFrame(doc);
			else this.renderHead();
		} else if (doc) this.frame?.setName(doc.name);
		this.ctx.setTitle(doc?.name ?? 'Maps');
		this.scalePop?.close();
		this.canvas?.destroy();
		this.canvas = null;
		this.hostEl = null;
		if (!doc || !this.frame) {
			this.bodyEl.empty();
			return this.renderGallery();
		}
		this.peek?.hide();
		this.frame.host.empty();
		this.renderEditorPage(doc, this.frame.host);
	}

	// ── The home page's header ─────────────────────────────────────────────────────

	private renderHead(): void {
		const { head, actions } = visualHeader(this.headEl, {
			icon: 'map',
			tint: 'orange',
			title: 'Maps',
			desc: 'Your world’s maps, with pins, areas and routes linked to its entries.',
		});
		button(actions, { label: 'New map', icon: 'plus', variant: 'default', cls: 'ws-map-new', onClick: (e) => this.newMenu(e) });
		mountToolBanner(this.ctx, head, 'maps');
	}

	/** What a map's ⋯ menu and right-click offer, on the home page and inside the map. */
	private actionsFor(m: MapDoc, inside: boolean): DocActions {
		const others = this.s.maps.list().filter((d) => d.id !== m.id);
		return {
			noun: 'map',
			onOpen: inside ? undefined : () => this.open(m.id),
			onRename: () => {
				if (inside) {
					const input = this.bodyEl.querySelector<HTMLInputElement>('.ws-vis-full__name');
					if (input) return void (input.focus(), input.select());
				}
				void promptModal(this.ctx.ws.app, { title: 'Rename map', label: 'Name', value: m.name, confirmLabel: 'Rename' }).then((v) => {
					const name = v?.trim();
					if (!name || name === m.name) return;
					if (this.id === m.id) this.change({ name });
					else this.s.maps.update(m.id, { name });
				});
			},
			onDuplicate: () => {
				const copy = this.s.maps.duplicate(m.id);
				if (copy && inside) this.open(copy.id);
			},
			onDelete: () => void this.remove(m.id),
			extra: inside
				? (menu) => {
						if (!others.length) return;
						menu.addSeparator();
						for (const d of others.slice(0, 12)) menu.addItem((i) => i.setTitle(`Open ${d.name}`).setIcon(d.icon || 'map').onClick(() => this.open(d.id)));
					}
				: undefined,
		};
	}

	private async remove(id = this.id): Promise<void> {
		const doc = this.s.maps.get(id);
		if (!doc) return;
		const ok = await confirmModal(this.ctx.ws.app, {
			title: `Delete “${doc.name}”?`,
			body: 'The pins, areas and routes on it go with it. Your image file and every entry stay as they are. You can undo this.',
			confirmLabel: 'Delete map',
			danger: true,
		});
		if (!ok) return;
		// Removing clears this.id (the deleted event runs first), so ask before.
		const wasOpen = doc.id === this.id;
		const gone = this.s.maps.remove(doc.id);
		if (wasOpen) this.open(null);
		if (gone)
			actionNotice(`Deleted “${gone.name}”.`, {
				label: 'Undo',
				run: () => {
					this.s.maps.restore(gone);
					if (!this.dead) this.open(gone.id);
				},
			});
	}

	// ── Making maps ─────────────────────────────────────────────────────────────

	private newMenu(evt: MouseEvent): void {
		const m = new Menu();
		m.addItem((i) => i.setTitle('From an image…').setIcon('image').onClick(() => this.pickImage()));
		m.addItem((i) => i.setTitle('A blank map').setIcon('scroll').onClick(() => this.createBlank()));
		m.showAtMouseEvent(evt);
	}

	private pickImage(onPick?: (f: TFile) => void): void {
		new ImageBrowser(this.ctx.ws, {
			title: onPick ? 'Choose the map’s image' : 'Choose a map image',
			current: this.doc?.image?.path ?? null,
			onPick: (files) => {
				const f = files[0];
				if (!f) return;
				if (onPick) onPick(f);
				else this.createFromImage(f.path);
			},
		}).open();
	}

	private createFromImage(path: string, init: Partial<MapDoc> = {}): void {
		const d = this.s.maps.create({ name: prettyName(path), image: { path }, icon: 'map', ...init });
		this.open(d.id);
	}

	private createBlank(init: Partial<MapDoc> = {}): MapDoc {
		const d = this.s.maps.create({ name: 'New map', backdrop: 'parchment', compass: true, aspect: 1.5, icon: 'scroll', ...init });
		this.open(d.id);
		return d;
	}

	/** The home page: the two ways to start always on top, then every map made so far. */
	private renderGallery(): void {
		this.ctx.setTitle('Maps');
		const S = this.s;
		const app = this.ctx.ws.app;
		const maps = S.maps.list();
		const { starts, grid, wrap } = visualHome(this.bodyEl, { title: 'Your maps', count: maps.length, noun: 'map', empty: 'Maps you make appear here. Right-click one later to rename, copy or delete it.' });
		wrap.addClass('ws-map-gallery');
		startCard(starts, {
			icon: 'image',
			tint: 'orange',
			title: 'A map from an image',
			body: 'Use a map you drew, made in Inkarnate or Wonderdraft, or scanned from a notebook. Any image in your vault works.',
			cta: 'Choose an image',
			attr: { 'data-start': 'image' },
			onClick: () => this.pickImage(),
		});
		startCard(starts, {
			icon: 'scroll',
			tint: 'yellow',
			title: 'A blank map',
			body: 'No image yet? Start on parchment, a night sky or open sea, and sketch kingdoms and roads as areas and routes.',
			cta: 'Start drawing',
			attr: { 'data-start': 'blank' },
			onClick: () => this.createBlank(),
		});
		if (!grid) return;
		grid.addClass('ws-map-cards');
		for (const m of maps) {
			const of = m.entityId ? S.entities.get(m.entityId) : undefined;
			const bits = [
				m.pins.length ? `${m.pins.length} ${m.pins.length === 1 ? 'pin' : 'pins'}` : null,
				m.regions.length ? `${m.regions.length} ${m.regions.length === 1 ? 'area' : 'areas'}` : null,
				m.paths.length ? `${m.paths.length} ${m.paths.length === 1 ? 'route' : 'routes'}` : null,
			].filter(Boolean);
			docCard(grid, {
				id: m.id,
				name: m.name,
				meta: [of && !of.trashedAt ? of.name : null, bits.join(' · ') || 'Nothing on it yet'].filter(Boolean).join(' · '),
				icon: m.icon || 'map',
				tint: 'orange',
				cls: 'ws-map-card',
				attr: { 'data-map': m.id },
				picture: (frame) => {
					frame.addClass('ws-map-card__frame');
					mapThumb(frame, app, S, m, `ws-map-card__thumb ${m.aspect >= 1.5 ? 'is-wide' : 'is-tall'}`);
				},
				actions: this.actionsFor(m, false),
			});
		}
	}

	// ── The map ─────────────────────────────────────────────────────────────────

	private frame: FullView | null = null;
	private layersBtn: HTMLButtonElement | null = null;
	private barEl: HTMLElement | null = null;
	private peek: Peek | null = null;

	/** The full-page frame: the bar on top, the tools down the side. Kept while the map is open. */
	private renderFrame(doc: MapDoc): void {
		const of = doc.entityId ? this.s.entities.get(doc.entityId) : undefined;
		this.frame = fullView(this.bodyEl, {
			icon: doc.icon || 'map',
			tint: 'orange',
			title: doc.name,
			home: 'Maps',
			label: (name) => `${name}, a map${of && !of.trashedAt ? ` of ${of.name}` : ''}`,
			hostCls: 'ws-map-host',
			onHome: () => this.open(null),
			onRename: (name) => this.change({ name }),
			menu: () => this.actionsFor(this.doc ?? doc, true),
		});
		const a = this.frame.actions;
		const lay = (this.layersBtn = button(a, { label: doc.layers.length ? `Layers (${doc.layers.length})` : 'Layers', icon: 'layers', variant: 'ghost', size: 'sm', cls: 'ws-map-layers-btn', onClick: () => this.toggleLayers(lay) }));
		const cust = button(a, { label: 'Customize', icon: 'sliders-horizontal', variant: 'ghost', size: 'sm', cls: 'ws-vis-customize', onClick: () => this.togglePanel(cust) });
		this.barEl = this.frame.host.parentElement!.createDiv({ cls: 'ws-map-bar' });
		// Hold Ctrl (⌘) over a pin, area or route to read its entry.
		this.peek = hoverPeek(this.frame.host, this.ctx.ws, this.s, '.ws-map-pin, .ws-map__region, .ws-map__route', (el) => {
			const d = this.doc;
			const id = el.getAttribute('data-item');
			if (!d || !id) return null;
			const kind: MapItemKind = el.hasClass('ws-map-pin') ? 'pin' : el.classList.contains('ws-map__region') ? 'region' : 'path';
			const it = findItem(d, { kind, id });
			if (!it) return null;
			const e = it.entityId ? this.s.entities.get(it.entityId) : undefined;
			return { entity: e, title: it.label || (e ? undefined : itemLabel(this.s, it, kind)), note: it.note };
		});
	}

	private renderEditorPage(doc: MapDoc, host: HTMLElement): void {
		this.hostEl = host;
		if (this.paperKey(doc) !== this.viewOf) this.view = null;
		this.viewOf = this.paperKey(doc);
		this.canvas = renderMap(host, this.ctx.ws.app, this.s, doc, {
			editable: true,
			mode: this.mode,
			selected: this.selected,
			focus: this.focus,
			keep: this.view,
			onView: (v) => (this.view = v),
			onSelect: (ref) => {
				this.selected = ref;
				this.renderEditor(this.doc!);
				this.keepAboveSheet(ref);
			},
			onOpen: (ref, evt) => this.openItem(ref, evt),
			onMenu: (ref, evt) => this.itemMenu(ref, evt),
			onAddPin: (x, y, anchor) => this.addPin(x, y, anchor),
			onShape: (kind, points) => this.addShape(kind, points),
			onMove: (ref, patch) => {
				const d = this.doc;
				if (d) this.change(patchItem(d, ref, patch));
			},
			onDraft: (n) => {
				this.draftN = n;
				this.renderHint();
			},
			onMeasure: (t) => {
				this.measureText = t;
				this.renderHint();
			},
			onScalePoints: (a, b, anchor) => this.askScale(a, b, anchor),
			onCancelTool: () => this.setMode('select'),
			onImageShape: (aspect) => {
				// The image's real shape: keep positions (they're fractions) and redraw.
				if (!this.id) return;
				// Stored shapes are limited to 1:10–10:1; an even longer strip keeps the limit, once.
				aspect = Math.min(10, Math.max(0.1, aspect));
				if (Math.abs(aspect - (this.doc?.aspect ?? 0)) / aspect < 0.004) return;
				this.saving = true;
				this.s.maps.update(this.id, { aspect });
				this.saving = false;
				this.view = null;
				this.render();
			},
			onMissingImage: (el) => {
				const acts = el.createDiv({ cls: 'ws-map__missing-actions' });
				button(acts, { label: 'Choose the image', icon: 'image', variant: 'default', size: 'sm', onClick: () => this.pickImage((f) => this.change({ image: { ...(this.doc?.image ?? {}), path: f.path } })) });
			},
		});
		this.focus = null;
		canvasHud(host, () => this.canvas?.pz ?? null, () => this.canvas?.fit(true), (hud) => {
			button(hud, { icon: 'search', variant: 'quiet', size: 'sm', tooltip: 'Find on this map', cls: 'ws-map__find', onClick: (e) => this.findMenu(e) });
		});
		this.renderBar(doc);
		this.renderEditor(doc);
		this.renderHint();
		host.setAttr('data-pins', String(doc.pins.length));
		if (!doc.pins.length && !doc.regions.length && !doc.paths.length && this.mode === 'select') {
			const hint = host.createDiv({ cls: 'ws-vis-hint ws-map-welcome' });
			icon(hint, 'sparkles');
			hint.createSpan({ text: doc.image ? 'Your map is ready. Choose Pin on the left and click a spot to mark a place, or draw an area around a kingdom.' : 'A blank map. Sketch coastlines and kingdoms with Area, roads and rivers with Route, then drop pins on the towns.' });
		}
	}

	private renderBar(doc: MapDoc): void {
		const bar = this.barEl;
		if (!bar) return;
		bar.empty();
		const tools = bar.createDiv({ cls: 'ws-map-tools', attr: { role: 'toolbar', 'aria-label': 'Map tools', 'aria-orientation': 'vertical' } });
		for (const t of TOOLS) {
			const b = tools.createEl('button', { cls: cx('ws-map-tool', this.mode === t.id && 'is-on'), attr: { type: 'button', 'data-tool': t.id, 'aria-pressed': String(this.mode === t.id), 'aria-label': t.label } });
			setTooltip(b, t.tip, { placement: 'right', delay: 300 });
			icon(b, t.icon);
			b.createSpan({ cls: 'ws-map-tool__label', text: t.label });
			b.addEventListener('click', () => this.setMode(this.mode === t.id && t.id !== 'select' ? 'select' : t.id));
		}
		const hist = bar.createDiv({ cls: 'ws-map-tools ws-map-tools--history' });
		button(hist, { icon: 'undo-2', variant: 'quiet', size: 'sm', tooltip: 'Undo (Ctrl/⌘ Z)', disabled: !this.history.length, cls: 'ws-map-undo', onClick: () => this.undo() });
		button(hist, { icon: 'redo-2', variant: 'quiet', size: 'sm', tooltip: 'Redo (Ctrl/⌘ Shift Z)', disabled: !this.redo.length, cls: 'ws-map-redo', onClick: () => this.redoOnce() });

		// Up and back, and anything needing a look, sit under the title.
		const sub = this.frame?.sub;
		if (!sub) return;
		sub.empty();
		const back = this.trail[this.trail.length - 1];
		const backDoc = back ? this.s.maps.get(back) : undefined;
		if (backDoc) {
			button(sub, { label: `Back to ${backDoc.name}`, icon: 'arrow-left', variant: 'ghost', size: 'sm', cls: 'ws-map-back', onClick: () => { this.trail.pop(); const t = this.trail; this.open(backDoc.id, { from: '' }); this.trail = t; } });
		} else {
			const up = parentMaps(this.s, doc.id)[0];
			if (up) button(sub, { label: `On ${up.map.name}`, icon: 'corner-left-up', variant: 'ghost', size: 'sm', cls: 'ws-map-up', onClick: () => this.open(up.map.id, { focus: { kind: 'pin', id: up.pin.id } }) });
		}
		const problems = mapProblems(this.s, doc);
		if (problems.length) {
			button(sub, {
				label: `${problems.length} to look at`,
				icon: 'alert-triangle',
				variant: 'ghost',
				size: 'sm',
				cls: 'ws-map-problems',
				tooltip: 'Things on this map that need a look',
				onClick: (evt) => {
					const m = new Menu();
					for (const p of problems) {
						const what = itemLabel(this.s, p.item, p.kind);
						const text = p.problem === 'trashed' ? `${what}: ${p.entity?.name ?? 'its entry'} is in the trash` : p.problem === 'missing' ? `${what}: its entry no longer exists` : `${what}: the map it opens is gone`;
						m.addItem((i) => i.setTitle(text).setIcon(p.kind === 'pin' ? 'map-pin' : p.kind === 'region' ? 'pentagon' : 'route').onClick(() => this.selectItem({ kind: p.kind, id: p.item.id }, true)));
					}
					m.showAtMouseEvent(evt);
				},
			});
		}
		if (doc.scale) {
			const chip = sub.createDiv({ cls: 'ws-map-scale-chip', attr: { title: 'The map’s scale. Change it with Set scale, or in Customize.' } });
			icon(chip, 'ruler');
			chip.createSpan({ text: `${formatDistance(1, doc.scale)} across` });
		}
	}

	private renderHint(): void {
		const host = this.hostEl;
		if (!host) return;
		host.querySelector(':scope > .ws-map-modehint')?.remove();
		if (this.mode === 'select') return;
		host.querySelector(':scope > .ws-map-welcome')?.remove();
		const hint = host.createDiv({ cls: 'ws-vis-hint ws-map-modehint' });
		icon(hint, TOOLS.find((t) => t.id === this.mode)!.icon);
		const text = hint.createSpan({ text: this.mode === 'measure' && this.measureText ? this.measureText : HINTS[this.mode] });
		if (this.mode === 'measure' && this.measureText) {
			text.addClass('ws-map-modehint__value');
			if (!this.doc?.scale) hint.createSpan({ cls: 'ws-map-modehint__sub', text: 'Use Set scale to measure in miles or leagues.' });
		}
		if ((this.mode === 'region' || this.mode === 'path') && this.draftN) {
			const acts = hint.createDiv({ cls: 'ws-map-modehint__actions' });
			const can = this.mode === 'region' ? this.draftN >= 3 : this.draftN >= 2;
			button(acts, { label: 'Done', icon: 'check', variant: 'default', size: 'sm', disabled: !can, cls: 'ws-map-done', onClick: () => this.canvas?.finishDraft() });
			button(acts, { icon: 'undo-2', variant: 'quiet', size: 'sm', tooltip: 'Remove the last point (Backspace)', onClick: () => this.canvas?.undoPoint() });
			button(acts, { icon: 'x', variant: 'quiet', size: 'sm', tooltip: 'Cancel (Esc)', onClick: () => this.canvas?.cancelDraft() });
		}
		hint.createSpan({ cls: 'ws-map-modehint__esc', text: 'Right-click to put the tool down.' });
	}

	/** Set scale: two points were picked; how far apart are they? */
	private askScale(a: [number, number], b: [number, number], anchor: HTMLElement): void {
		const doc = this.doc;
		if (!doc) return;
		this.scalePop?.close();
		const pop = new Popover(anchor, {
			cls: 'ws-vis-panel ws-map-scale-pop',
			width: 300,
			label: 'Set the scale',
			onClose: () => {
				anchor.remove();
				if (this.scalePop === pop) this.scalePop = null;
			},
		});
		if (!pop.isOpen) return;
		this.scalePop = pop;
		const sec = panelSection(pop.el, 'How far apart are these?', 'move-horizontal');
		sec.createDiv({ cls: 'ws-vis-panel__hint', text: 'Type the real distance between the two points, and every route, area and the ruler use it.' });
		const box = sec.createDiv({ cls: 'ws-map-scale-input' });
		const w = box.createEl('input', { cls: 'ws-input', attr: { type: 'number', min: '0.001', step: 'any', placeholder: '100', 'aria-label': 'Distance' } });
		const u = box.createEl('input', { cls: 'ws-input', attr: { type: 'text', value: doc.scale?.unit ?? 'miles', 'aria-label': 'Unit', placeholder: 'miles', list: 'ws-map-units-pop' } });
		const dl = box.createEl('datalist', { attr: { id: 'ws-map-units-pop' } });
		for (const unit of UNITS) dl.createEl('option', { attr: { value: unit } });
		const now = sec.createDiv({ cls: 'ws-vis-panel__hint ws-map-scale-now', text: `Right now that’s ${formatDistance(polylineLength([a, b], doc.aspect), doc.scale)}.` });
		const acts = sec.createDiv({ cls: 'ws-vis-panel__line' });
		const ok = button(acts, { label: 'Set scale', icon: 'check', variant: 'primary', size: 'sm', cls: 'ws-map-scale-ok', disabled: true });
		button(acts, { label: 'Pick again', variant: 'ghost', size: 'sm', onClick: () => { pop.close(); this.canvas?.cancelDraft(); } });
		const valid = () => scaleFromPoints(a, b, doc.aspect, Number(w.value), u.value);
		const sync = () => {
			const sc = valid();
			ok.disabled = !sc;
			now.setText(sc ? `The whole map is about ${formatDistance(1, sc)} across.` : `Right now that’s ${formatDistance(polylineLength([a, b], doc.aspect), doc.scale)}.`);
		};
		const commit = () => {
			const sc = valid();
			if (!sc) return;
			const before = this.doc?.scale ?? null;
			pop.close();
			const done = this.change({ scale: sc });
			this.setMode('select');
			if (done)
				actionNotice(`Scale set: the map is about ${formatDistance(1, sc)} across.`, { label: 'Undo', run: () => this.undoOn(doc.id, () => ({ scale: before })) });
		};
		w.addEventListener('input', sync);
		u.addEventListener('input', sync);
		ok.addEventListener('click', commit);
		for (const x of [w, u]) x.addEventListener('keydown', (evt) => evt.key === 'Enter' && (evt.preventDefault(), commit()));
		window.setTimeout(() => w.focus({ preventScroll: true }), 30);
	}

	private scalePop: Popover | null = null;

	private setMode(m: MapMode): void {
		this.mode = m;
		this.draftN = 0;
		this.measureText = null;
		this.scalePop?.close();
		this.canvas?.setMode(m);
		if (m !== 'select') {
			this.selected = null;
			this.canvas?.select(null);
		}
		const doc = this.doc;
		if (doc) this.renderBar(doc);
		this.renderHint();
	}

	private onKey(evt: KeyboardEvent): void {
		const t = evt.target as HTMLElement;
		if (t.closest('input, textarea, select, [contenteditable="true"]')) return;
		if (!this.doc || !this.hostEl) return;
		const mod = evt.ctrlKey || evt.metaKey;
		if (mod && evt.key.toLowerCase() === 'z') {
			evt.preventDefault();
			if (evt.shiftKey) this.redoOnce();
			else this.undo();
			return;
		}
		if (mod || evt.altKey) return;
		const tool = TOOLS.find((x) => x.key.toLowerCase() === evt.key.toLowerCase());
		if (tool) {
			evt.preventDefault();
			return this.setMode(tool.id);
		}
		if (this.mode === 'scale' && (evt.key === 'Escape' || evt.key === 'Backspace') && this.canvas?.picked()) {
			// Set scale: take back the last point, or both.
			evt.preventDefault();
			this.scalePop?.close();
			if (evt.key === 'Escape') this.canvas.cancelDraft();
			else this.canvas.undoPoint();
			return;
		}
		if (evt.key === 'Escape') {
			if (this.mode !== 'select' && !this.draftN && !this.measureText) return this.setMode('select');
			this.canvas?.cancelDraft();
			if (this.selected) this.canvas?.select(null);
		} else if (evt.key === 'Enter' && this.draftN) {
			evt.preventDefault();
			this.canvas?.finishDraft();
		} else if (evt.key === 'Backspace' && (this.draftN || this.measureText)) {
			evt.preventDefault();
			this.canvas?.undoPoint();
		} else if ((evt.key === 'Delete' || evt.key === 'Backspace') && this.selected) {
			evt.preventDefault();
			this.deleteItem(this.selected);
		}
	}

	// ── Adding things ──────────────────────────────────────────────────────────────

	private blankItem() {
		return { id: uuid(), entityId: null, label: '', note: '', layerId: null, color: null };
	}

	private placeTypes(): string[] {
		return ['location', 'nation', 'event', 'faction'].filter((t) => this.s.schemas.get(t));
	}

	private addPin(x: number, y: number, anchor: HTMLElement): void {
		const doc = this.doc;
		if (!doc) return;
		const pin: MapPin = { ...this.blankItem(), x, y, icon: null, size: null, mapId: null };
		this.change({ pins: [...doc.pins, pin] });
		this.setMode('select');
		this.selectItem({ kind: 'pin', id: pin.id });
		this.linkPicker(anchor, { kind: 'pin', id: pin.id }, 'What’s here? Search or create…');
	}

	private addShape(kind: 'region' | 'path', points: Array<[number, number]>): void {
		const doc = this.doc;
		if (!doc) return;
		const base = this.blankItem();
		if (kind === 'region') {
			const r: MapRegion = { ...base, points, opacity: 0.25, style: 'solid' };
			this.change({ regions: [...doc.regions, r] });
			this.setMode('select');
			this.selectItem({ kind, id: r.id });
		} else {
			const p: MapPath = { ...base, points, style: 'dashed', width: 3, arrow: false };
			this.change({ paths: [...doc.paths, p] });
			this.setMode('select');
			this.selectItem({ kind, id: p.id });
		}
		window.setTimeout(() => this.hostEl?.querySelector<HTMLElement>('.ws-map-editor__name')?.focus({ preventScroll: true }), 30);
	}

	/** On a phone the details cover the lower half: slide the map so the pin stays in sight. */
	private keepAboveSheet(ref: MapItemRef | null): void {
		const host = this.hostEl;
		const pz = this.canvas?.pz;
		if (!ref || !host || !pz || host.closest('.worldsmith')?.getAttribute('data-ws-size') !== 'narrow') return;
		const el = host.querySelector<HTMLElement>(`[data-item="${CSS.escape(ref.id)}"]`);
		if (!el) return;
		const hr = host.getBoundingClientRect();
		const r = el.getBoundingClientRect();
		const y = (r.top + r.bottom) / 2 - hr.top;
		const target = hr.height * 0.25;
		if (y > hr.height * 0.38) pz.set(pz.k, pz.x, pz.y - (y - target));
	}

	private selectItem(ref: MapItemRef, reveal = false): void {
		this.selected = ref;
		this.canvas?.select(ref);
		if (reveal) this.canvas?.reveal(ref);
		const doc = this.doc;
		if (doc) this.renderEditor(doc);
	}

	private linkPicker(anchor: HTMLElement, ref: MapItemRef, placeholder: string): void {
		const doc = this.doc;
		const it = doc ? findItem(doc, ref) : undefined;
		const types = this.placeTypes();
		new EntityPicker(anchor, {
			session: this.s,
			app: this.ctx.ws.app,
			createTypes: types.length ? types.slice(0, 2) : undefined,
			exclude: it?.entityId ? new Set([it.entityId]) : undefined,
			placeholder,
			onPick: (e) => {
				const d = this.doc;
				if (d) this.change(patchItem(d, ref, { entityId: e.id }));
			},
		});
	}

	// ── The selected thing ─────────────────────────────────────────────────────────

	private renderEditor(doc: MapDoc): void {
		const host = this.hostEl;
		if (!host) return;
		const keep = host.querySelector<HTMLElement>(':scope > .ws-map-editor')?.scrollTop ?? 0;
		host.querySelector(':scope > .ws-map-editor')?.remove();
		const ref = this.selected;
		const it = ref ? findItem(doc, ref) : undefined;
		if (!ref || !it) return;
		const S = this.s;
		const kind = ref.kind;
		const e = it.entityId ? S.entities.get(it.entityId) : undefined;
		const ed = host.createDiv({ cls: cx('ws-map-editor', `ws-map-editor--${kind}`), attr: { 'data-item': it.id, role: 'dialog', 'aria-label': `${ITEM_NOUN[kind]} details` } });
		const top = ed.createDiv({ cls: 'ws-map-editor__top' });
		const mark = top.createDiv({ cls: 'ws-map-editor__mark' });
		icon(mark, kind === 'pin' ? pinIcon(S, it as MapPin) : kind === 'region' ? 'pentagon' : 'route');
		const name = top.createEl('input', { cls: 'ws-input ws-map-editor__name', attr: { type: 'text', value: it.label, placeholder: e && !e.trashedAt ? e.name : `Name this ${ITEM_NOUN[kind].toLowerCase()}`, 'aria-label': 'Label' } });
		name.addEventListener('change', () => {
			const d = this.doc;
			if (d && name.value.trim() !== it.label) this.change(patchItem(d, ref, { label: name.value.trim() }));
		});
		name.addEventListener('keydown', (evt) => evt.key === 'Enter' && name.blur());
		button(top, { icon: 'x', variant: 'quiet', size: 'sm', tooltip: 'Close', cls: 'ws-map-editor__close', onClick: () => this.canvas?.select(null) });

		// The linked entry.
		const link = ed.createDiv({ cls: 'ws-map-editor__link' });
		if (e) {
			const chip = link.createEl('button', { cls: cx('ws-map-editor__entity', !!e.trashedAt && 'is-gone'), attr: { type: 'button', 'data-entity': e.id, title: e.trashedAt ? `${e.name} is in the trash` : `Open ${e.name}` } });
			avatar(chip, this.ctx.ws.app, e, S.schemas.get(e.typeId), { size: 'xs' });
			chip.createSpan({ text: e.trashedAt ? `${e.name} (in the trash)` : e.name });
			chip.addEventListener('click', (evt) => this.ctx.navigate(ROUTES.entity(e.id), evt.metaKey || evt.ctrlKey ? 'tab' : false));
			button(link, { icon: 'replace', variant: 'quiet', size: 'sm', tooltip: 'Link a different entry', onClick: (evt) => this.linkPicker(evt.currentTarget as HTMLElement, ref, 'Link which entry?') });
			button(link, { icon: 'unlink', variant: 'quiet', size: 'sm', tooltip: 'Unlink (the entry stays)', cls: 'ws-map-editor__unlink', onClick: () => this.change(patchItem(this.doc!, ref, { entityId: null })) });
		} else if (it.entityId) {
			link.createSpan({ cls: 'ws-map-editor__gone', text: 'Its entry no longer exists.' });
			button(link, { label: 'Link another', icon: 'link', variant: 'ghost', size: 'sm', onClick: (evt) => this.linkPicker(evt.currentTarget as HTMLElement, ref, 'Link which entry?') });
		} else {
			button(link, { label: 'Link an entry', icon: 'link', variant: 'ghost', size: 'sm', cls: 'ws-map-editor__link-btn', onClick: (evt) => this.linkPicker(evt.currentTarget as HTMLElement, ref, 'Link which entry? Search or create…') });
		}

		// Measurements.
		if (kind === 'path') {
			const len = polylineLength((it as MapPath).points, doc.aspect);
			ed.createDiv({ cls: 'ws-map-editor__stat', text: `About ${formatDistance(len, doc.scale)} long` });
		} else if (kind === 'region') {
			const a = formatArea(polygonArea((it as MapRegion).points, doc.aspect), doc.scale);
			if (a) ed.createDiv({ cls: 'ws-map-editor__stat', text: `About ${a}` });
		}

		const body = ed.createDiv({ cls: 'ws-map-editor__body' });
		const set = (patch: Partial<MapPin & MapRegion & MapPath>) => {
			const d = this.doc;
			if (d) this.change(patchItem(d, ref, patch));
		};
		const colour = formRow(body, 'Color');
		colorSwatches(colour, it.color, (c) => set({ color: c }));
		if (kind === 'pin') {
			const p = it as MapPin;
			const ic = formRow(body, 'Icon');
			const icons = ic.createDiv({ cls: 'ws-map-icons' });
			const auto = icons.createEl('button', { cls: cx('ws-map-icon', !p.icon && 'is-on'), attr: { type: 'button', title: 'From its entry', 'aria-pressed': String(!p.icon) } });
			auto.createSpan({ text: 'Auto' });
			auto.addEventListener('click', () => set({ icon: null }));
			for (const name of PIN_ICONS.slice(0, 15)) {
				const b = icons.createEl('button', { cls: cx('ws-map-icon', p.icon === name && 'is-on'), attr: { type: 'button', title: name.replace(/-/g, ' '), 'aria-pressed': String(p.icon === name), 'data-icon': name } });
				icon(b, name);
				b.addEventListener('click', () => set({ icon: name }));
			}
			const more = icons.createEl('button', { cls: 'ws-map-icon', attr: { type: 'button', title: 'More icons' } });
			icon(more, 'more-horizontal');
			// Every icon, searchable, rather than a long list that runs off the screen.
			more.addEventListener('click', () => new IconPickerModal(this.ctx.ws.app, (name) => set({ icon: name })).open());
			const sz = formRow(body, 'Size');
			segmented(sz, [
				{ id: 'auto', label: 'Map’s' },
				{ id: 's', label: 'Small' },
				{ id: 'm', label: 'Medium' },
				{ id: 'l', label: 'Large' },
			], p.size ?? 'auto', (v) => set({ size: v === 'auto' ? null : v }), 'Size');
			const sub = formRow(body, 'Opens a map', 'A closer map: a city inside a kingdom');
			const target = p.mapId ? this.s.maps.get(p.mapId) : undefined;
			button(sub, {
				label: target ? target.name : p.mapId ? 'Missing map' : 'None',
				icon: 'layers',
				variant: 'ghost',
				size: 'sm',
				cls: 'ws-map-editor__submap',
				onClick: (evt) => {
					const m = new Menu();
					m.addItem((i) => i.setTitle('None').setChecked(!p.mapId).onClick(() => set({ mapId: null })));
					m.addSeparator();
					for (const d of this.s.maps.list()) if (d.id !== doc.id) m.addItem((i) => i.setTitle(d.name).setIcon(d.icon || 'map').setChecked(p.mapId === d.id).onClick(() => set({ mapId: d.id })));
					m.addSeparator();
					m.addItem((i) =>
						i.setTitle('A new map from an image…').setIcon('image-plus').onClick(() =>
							this.pickImage((f) => {
								const child = this.s.maps.create({ name: itemLabel(this.s, p, 'pin'), image: { path: f.path }, entityId: p.entityId, icon: 'map' });
								set({ mapId: child.id });
								new Notice(`Made “${child.name}”. Double-click the pin to open it.`);
							}),
						),
					);
					m.showAtMouseEvent(evt);
				},
			});
		} else {
			const sh = it as MapRegion | MapPath;
			const ln = formRow(body, kind === 'region' ? 'Border' : 'Line');
			segmented(ln, [
				{ id: 'solid', label: 'Solid' },
				{ id: 'dashed', label: 'Dashed' },
				{ id: 'dotted', label: 'Dotted' },
			], sh.style, (style) => set({ style }), 'Line');
			if (kind === 'region') {
				const op = formRow(body, 'Fill');
				const r = it as MapRegion;
				const steps = [
					{ id: '0', label: 'None', v: 0 },
					{ id: '1', label: 'Light', v: 0.15 },
					{ id: '2', label: 'Medium', v: 0.3 },
					{ id: '3', label: 'Strong', v: 0.5 },
				];
				const cur = steps.reduce((a, b) => (Math.abs(b.v - r.opacity) < Math.abs(a.v - r.opacity) ? b : a));
				segmented(op, steps.map(({ id, label }) => ({ id, label })), cur.id, (id) => set({ opacity: steps.find((x) => x.id === id)!.v }), 'Fill');
			} else {
				const p = it as MapPath;
				const w = formRow(body, 'Width');
				segmented(w, [
					{ id: '2', label: 'Thin' },
					{ id: '3', label: 'Normal' },
					{ id: '5', label: 'Bold' },
					{ id: '8', label: 'Heavy' },
				], String([2, 3, 5, 8].reduce((a, b) => (Math.abs(b - p.width) < Math.abs(a - p.width) ? b : a))), (v) => set({ width: Number(v) }), 'Width');
				toggleRow(body, 'Arrow at the end', p.arrow, (arrow) => set({ arrow }), 'For journeys and campaigns');
			}
		}
		const layer = formRow(body, 'Layer');
		const L = doc.layers.find((l) => l.id === it.layerId);
		button(layer, {
			label: L ? L.name : 'No layer',
			icon: 'layers',
			variant: 'ghost',
			size: 'sm',
			cls: 'ws-map-editor__layer',
			onClick: (evt) => {
				const m = new Menu();
				m.addItem((i) => i.setTitle('No layer').setChecked(!it.layerId).onClick(() => set({ layerId: null })));
				for (const l of doc.layers) m.addItem((i) => i.setTitle(l.name).setChecked(it.layerId === l.id).onClick(() => set({ layerId: l.id })));
				m.addSeparator();
				m.addItem((i) =>
					i.setTitle('New layer…').setIcon('plus').onClick(() => {
						const d = this.doc!;
						const nl: MapLayer = { id: uuid(), name: this.layerName(d), visible: true, color: null };
						this.change({ ...patchItem(d, ref, { layerId: nl.id }), layers: [...d.layers, nl] });
					}),
				);
				m.showAtMouseEvent(evt);
			},
		});
		const note = body.createDiv({ cls: 'ws-map-editor__note' });
		inlineText(note, it.note, { ariaLabel: 'Note', placeholder: 'A note: what happened here, who rules it, how long the road takes…', multiline: true, cls: 'ws-map-editor__note-text', onCommit: (v) => v !== it.note && set({ note: v }) });

		const acts = ed.createDiv({ cls: 'ws-map-editor__actions' });
		if (kind === 'pin' && (it as MapPin).mapId && this.s.maps.has((it as MapPin).mapId!)) button(acts, { label: 'Open map', icon: 'layers', variant: 'default', size: 'sm', cls: 'ws-map-editor__open-map', onClick: (evt) => this.openItem(ref, evt) });
		else if (e && !e.trashedAt) button(acts, { label: 'Open', icon: 'arrow-up-right', variant: 'default', size: 'sm', onClick: (evt) => this.ctx.navigate(ROUTES.entity(e.id), evt.metaKey || evt.ctrlKey ? 'tab' : false) });
		button(acts, { icon: 'scan-search', variant: 'quiet', size: 'sm', tooltip: 'Zoom to it', onClick: () => this.canvas?.reveal(ref) });
		button(acts, { label: 'Delete', icon: 'trash-2', variant: 'quiet', size: 'sm', cls: 'ws-map-editor__delete', onClick: () => this.deleteItem(ref) });
		ed.scrollTop = keep;
	}

	private layerName(d: MapDoc): string {
		const taken = new Set(d.layers.map((l) => l.name.toLowerCase()));
		for (const n of ['Cities', 'Roads', 'Kingdoms', 'Battles', 'Secrets', 'Journeys']) if (!taken.has(n.toLowerCase())) return n;
		let i = d.layers.length + 1;
		while (taken.has(`layer ${i}`)) i++;
		return `Layer ${i}`;
	}

	private deleteItem(ref: MapItemRef): void {
		const doc = this.doc;
		const it = doc ? findItem(doc, ref) : undefined;
		if (!doc || !it) return;
		const label = itemLabel(this.s, it, ref.kind);
		const key = ref.kind === 'pin' ? 'pins' : ref.kind === 'region' ? 'regions' : 'paths';
		const at = (doc[key] as MapItem[]).findIndex((x) => x.id === it.id);
		this.selected = null;
		this.change(removeItem(doc, ref));
		this.canvas?.select(null);
		actionNotice(`Removed “${label}” from the map.`, {
			label: 'Undo',
			run: () =>
				this.undoOn(doc.id, (now) => {
					const xs = now[key] as MapItem[];
					if (xs.some((x) => x.id === it.id)) return null;
					const next = [...xs];
					next.splice(Math.min(at, next.length), 0, it);
					return { [key]: next };
				}),
		});
	}

	private openItem(ref: MapItemRef, evt: MouseEvent): void {
		const doc = this.doc;
		const it = doc ? findItem(doc, ref) : undefined;
		if (!doc || !it) return;
		const linkedMap = ref.kind === 'pin' && 'mapId' in it ? it.mapId : null;
		if (linkedMap && this.s.maps.has(linkedMap)) return this.open(linkedMap, { from: doc.id });
		const e = it.entityId ? this.s.entities.get(it.entityId) : undefined;
		if (e && !e.trashedAt) this.ctx.navigate(ROUTES.entity(e.id), evt.metaKey || evt.ctrlKey ? 'tab' : false);
		else this.selectItem(ref);
	}

	private itemMenu(ref: MapItemRef, evt: MouseEvent): void {
		const doc = this.doc;
		const it = doc ? findItem(doc, ref) : undefined;
		if (!doc || !it) return;
		const e = it.entityId ? this.s.entities.get(it.entityId) : undefined;
		const menu = e && !e.trashedAt ? entityMenu(this.ctx.ws, e) : new Menu();
		if (e) menu.addSeparator();
		menu.addItem((i) => i.setTitle('Zoom to it').setIcon('scan-search').onClick(() => this.canvas?.reveal(ref)));
		if (ref.kind !== 'pin') {
			const key = ref.kind === 'region' ? 'regions' : 'paths';
			const list = doc[key] as MapItem[];
			menu.addItem((i) => i.setTitle('Bring to front').setIcon('bring-to-front').onClick(() => this.change({ [key]: [...list.filter((x) => x.id !== ref.id), it] })));
			menu.addItem((i) => i.setTitle('Send to back').setIcon('send-to-back').onClick(() => this.change({ [key]: [it, ...list.filter((x) => x.id !== ref.id)] })));
		}
		menu.addItem((i) =>
			i.setTitle('Duplicate').setIcon('copy').onClick(() => {
				const d = this.doc!;
				const copy = { ...JSON.parse(JSON.stringify(it)), id: uuid() } as MapItem;
				if (ref.kind === 'pin') {
					const p = copy as MapPin;
					p.x = Math.min(1, p.x + 0.02);
					p.y = Math.min(1, p.y + 0.02);
				} else (copy as MapRegion).points = (copy as MapRegion).points.map((q) => [Math.min(1, q[0] + 0.02), Math.min(1, q[1] + 0.02)]);
				const key = ref.kind === 'pin' ? 'pins' : ref.kind === 'region' ? 'regions' : 'paths';
				this.change({ [key]: [...(d[key] as MapItem[]), copy] });
				this.selectItem({ kind: ref.kind, id: copy.id });
			}),
		);
		menu.addItem((i) => i.setTitle('Delete').setIcon('trash-2').setWarning(true).onClick(() => this.deleteItem(ref)));
		menu.showAtMouseEvent(evt);
	}

	private findMenu(evt: MouseEvent): void {
		const doc = this.doc;
		if (!doc) return;
		const m = new Menu();
		const rows: Array<{ kind: MapItemKind; item: MapItem; label: string }> = [];
		for (const kind of ['pin', 'region', 'path'] as const) for (const item of itemsOf(doc, kind)) rows.push({ kind, item, label: itemLabel(this.s, item, kind) });
		rows.sort((a, b) => a.label.localeCompare(b.label));
		if (!rows.length) m.addItem((i) => i.setTitle('Nothing on this map yet').setDisabled(true));
		for (const r of rows.slice(0, 60)) {
			const hidden = r.item.layerId && doc.layers.find((l) => l.id === r.item.layerId)?.visible === false;
			m.addItem((i) =>
				i
					.setTitle(hidden ? `${r.label} (hidden layer)` : r.label)
					.setIcon(r.kind === 'pin' ? pinIcon(this.s, r.item as MapPin) : r.kind === 'region' ? 'pentagon' : 'route')
					.onClick(() => {
						if (hidden) this.change({ layers: doc.layers.map((l) => (l.id === r.item.layerId ? { ...l, visible: true } : l)) });
						this.setMode('select');
						this.selectItem({ kind: r.kind, id: r.item.id }, true);
					}),
			);
		}
		m.showAtMouseEvent(evt);
	}

	// ── Layers ────────────────────────────────────────────────────────────────────

	private toggleLayers(anchor: HTMLElement): void {
		if (this.layersPop) {
			this.layersPop.close();
			return;
		}
		this.layersPop = new Popover(anchor, { cls: 'ws-vis-panel ws-map-layers', width: 320, label: 'Layers', onClose: () => (this.layersPop = null) });
		this.fillLayers(this.layersPop.el);
	}

	private fillLayers(el: HTMLElement): void {
		const doc = this.doc;
		el.querySelectorAll(':scope > :not(.ws-sr-only)').forEach((x) => x.remove());
		if (!doc) return;
		const sec = panelSection(el, 'Layers', 'layers');
		sec.createDiv({ cls: 'ws-vis-panel__hint', text: 'Group pins, areas and routes, and switch each group on or off.' });
		const count = (id: string | null) => [...doc.pins, ...doc.regions, ...doc.paths].filter((i) => (i.layerId ?? null) === id || (id === null && i.layerId && !doc.layers.some((l) => l.id === i.layerId))).length;
		const list = sec.createDiv({ cls: 'ws-map-layer-list' });
		const none = list.createDiv({ cls: 'ws-map-layer is-base' });
		icon(none.createDiv({ cls: 'ws-map-layer__eye' }), 'eye');
		none.createDiv({ cls: 'ws-map-layer__name', text: 'No layer' });
		none.createDiv({ cls: 'ws-map-layer__n', text: String(count(null)) });
		for (const l of doc.layers) {
			const row = list.createDiv({ cls: cx('ws-map-layer', !l.visible && 'is-off', l.color && `ws-tint--${l.color}`), attr: { 'data-layer': l.id } });
			const eye = row.createEl('button', { cls: 'ws-map-layer__eye', attr: { type: 'button', 'aria-label': l.visible ? `Hide ${l.name}` : `Show ${l.name}`, 'aria-pressed': String(l.visible) } });
			icon(eye, l.visible ? 'eye' : 'eye-off');
			eye.addEventListener('click', () => this.change({ layers: doc.layers.map((x) => (x.id === l.id ? { ...x, visible: !x.visible } : x)) }));
			const name = row.createDiv({ cls: 'ws-map-layer__name' });
			inlineText(name, l.name, { ariaLabel: 'Layer name', onCommit: (v) => v.trim() && v.trim() !== l.name && this.change({ layers: doc.layers.map((x) => (x.id === l.id ? { ...x, name: v.trim() } : x)) }) });
			row.createDiv({ cls: 'ws-map-layer__n', text: String(count(l.id)) });
			const dot = row.createEl('button', { cls: 'ws-map-layer__color', attr: { type: 'button', 'aria-label': 'Layer color' } });
			dot.addEventListener('click', (evt) => {
				const m = new Menu();
				m.addItem((i) => i.setTitle('No color').setChecked(!l.color).onClick(() => this.change({ layers: doc.layers.map((x) => (x.id === l.id ? { ...x, color: null } : x)) })));
				for (const c of SEMANTIC_COLORS) m.addItem((i) => i.setTitle(c[0]!.toUpperCase() + c.slice(1)).setIcon('circle').setChecked(l.color === c).onClick(() => this.change({ layers: doc.layers.map((x) => (x.id === l.id ? { ...x, color: c } : x)) })));
				m.showAtMouseEvent(evt);
			});
			button(row, {
				icon: 'trash-2',
				variant: 'quiet',
				size: 'sm',
				tooltip: 'Delete layer (what’s on it stays, with no layer)',
				cls: 'ws-map-layer__delete',
				onClick: () => {
					const strip = <T extends MapItem>(xs: T[]) => xs.map((i) => (i.layerId === l.id ? { ...i, layerId: null } : i));
					const on = new Set([...doc.pins, ...doc.regions, ...doc.paths].filter((i) => i.layerId === l.id).map((i) => i.id));
					const at = doc.layers.findIndex((x) => x.id === l.id);
					this.change({ layers: doc.layers.filter((x) => x.id !== l.id), pins: strip(doc.pins), regions: strip(doc.regions), paths: strip(doc.paths) });
					actionNotice(`Deleted the “${l.name}” layer. Everything on it is still on the map.`, {
						label: 'Undo',
						run: () =>
							this.undoOn(doc.id, (now) => {
								if (now.layers.some((x) => x.id === l.id)) return null;
								const back = <T extends MapItem>(xs: T[]) => xs.map((i) => (on.has(i.id) && !i.layerId ? { ...i, layerId: l.id } : i));
								const layers = [...now.layers];
								layers.splice(Math.min(at, layers.length), 0, l);
								return { layers, pins: back(now.pins), regions: back(now.regions), paths: back(now.paths) };
							}),
					});
				},
			});
		}
		const r = sec.createDiv({ cls: 'ws-vis-panel__line' });
		button(r, { label: 'New layer', icon: 'plus', variant: 'ghost', size: 'sm', cls: 'ws-map-layer-add', onClick: () => this.change({ layers: [...doc.layers, { id: uuid(), name: this.layerName(doc), visible: true, color: null }] }) });
		if (this.selected) {
			const it = findItem(doc, this.selected);
			if (it && doc.layers.length) {
				const hint = sec.createDiv({ cls: 'ws-vis-panel__hint' });
				hint.setText(`Tip: choose a layer for “${itemLabel(this.s, it, this.selected.kind)}” in its details.`);
			}
		}
	}

	// ── Customize ─────────────────────────────────────────────────────────────────

	private togglePanel(anchor: HTMLElement): void {
		if (this.panel) {
			this.panel.close();
			return;
		}
		this.panel = new Popover(anchor, { cls: 'ws-vis-panel', width: 360, label: 'Customize the map', onClose: () => (this.panel = null) });
		this.fillPanel(this.panel.el);
	}

	private fillPanel(el: HTMLElement): void {
		const doc = this.doc;
		const keepScroll = el.scrollTop;
		el.querySelectorAll(':scope > :not(.ws-sr-only)').forEach((x) => x.remove());
		if (!doc) return;
		aboutSection(el, doc.description, 'What this map is for, when it was drawn, who drew it…', (description) => this.change({ description }));
		const pic = panelSection(el, 'Picture', 'image');
		const line = pic.createDiv({ cls: 'ws-vis-panel__line' });
		button(line, { label: doc.image ? 'Change image' : 'Use an image', icon: 'image', variant: 'ghost', size: 'sm', onClick: () => this.pickImage((f) => this.change({ image: { path: f.path } })) });
		if (doc.image) {
			button(line, {
				label: 'Remove image',
				icon: 'image-off',
				variant: 'quiet',
				size: 'sm',
				onClick: () => {
					const image = doc.image;
					this.change({ image: null });
					actionNotice('The map is blank now. Your image file is still in the vault.', { label: 'Undo', run: () => this.undoOn(doc.id, (now) => (now.image ? null : { image })) });
				},
			});
		}
		if (!doc.image) {
			segmentedRow(pic, 'Backdrop', [
				{ id: 'parchment', label: 'Parchment' },
				{ id: 'sea', label: 'Sea' },
				{ id: 'night', label: 'Night' },
				{ id: 'plain', label: 'Plain' },
			], doc.backdrop, (backdrop) => this.change({ backdrop }));
			const cur = ASPECTS.reduce((a, b) => (Math.abs(b.v - doc.aspect) < Math.abs(a.v - doc.aspect) ? b : a));
			segmentedRow(pic, 'Shape', ASPECTS.map(({ id, label }) => ({ id, label })), cur.id, (id) => this.change({ aspect: ASPECTS.find((x) => x.id === id)!.v }));
		}
		toggleRow(pic, 'Compass rose', doc.compass, (compass) => this.change({ compass }));

		const look = panelSection(el, 'Pins and names', 'map-pin');
		segmentedRow(look, 'Names', [
			{ id: 'always', label: 'Always' },
			{ id: 'zoom', label: 'Up close' },
			{ id: 'hover', label: 'On hover' },
		], doc.labels, (labels) => this.change({ labels }));
		segmentedRow(look, 'Pin size', [
			{ id: 's', label: 'Small' },
			{ id: 'm', label: 'Medium' },
			{ id: 'l', label: 'Large' },
		], doc.pinSize, (pinSize) => this.change({ pinSize }));

		const grid = panelSection(el, 'Grid', 'grid-3x3');
		toggleRow(grid, 'Show a grid', doc.grid.show, (show) => this.change({ grid: { ...doc.grid, show } }), 'For travel times and battle maps');
		if (doc.grid.show) {
			segmentedRow(grid, 'Cells', [
				{ id: 'square', label: 'Squares' },
				{ id: 'hex', label: 'Hexes' },
			], doc.grid.kind, (kind) => this.change({ grid: { ...doc.grid, kind } }));
			const sizes = [10, 20, 40, 80];
			segmentedRow(grid, 'Across', sizes.map((n) => ({ id: String(n), label: String(n) })), String(sizes.reduce((a, b) => (Math.abs(b - doc.grid.cells) < Math.abs(a - doc.grid.cells) ? b : a))), (v) => this.change({ grid: { ...doc.grid, cells: Number(v) } }));
			const ops = [
				{ id: 'faint', label: 'Faint', v: 0.12 },
				{ id: 'light', label: 'Light', v: 0.25 },
				{ id: 'strong', label: 'Strong', v: 0.5 },
			];
			const cur = ops.reduce((a, b) => (Math.abs(b.v - doc.grid.opacity) < Math.abs(a.v - doc.grid.opacity) ? b : a));
			segmentedRow(grid, 'Lines', ops.map(({ id, label }) => ({ id, label })), cur.id, (id) => this.change({ grid: { ...doc.grid, opacity: ops.find((x) => x.id === id)!.v } }));
			if (doc.scale) grid.createDiv({ cls: 'ws-vis-panel__hint', text: `Each cell is about ${formatDistance(1 / doc.grid.cells, doc.scale)} across.` });
		}

		const dist = panelSection(el, 'Distances', 'ruler');
		const pickTwo = dist.createDiv({ cls: 'ws-vis-panel__line' });
		button(pickTwo, { label: 'Set scale from two points', icon: 'move-horizontal', variant: 'ghost', size: 'sm', cls: 'ws-map-scale-tool', onClick: () => { this.panel?.close(); this.setMode('scale'); } });
		toggleRow(dist, 'Use a scale', !!doc.scale, (v) => this.change({ scale: v ? (doc.scale ?? { width: 1000, unit: 'miles' }) : null }), 'So routes and the ruler read in miles, leagues or days');
		if (doc.scale) {
			const row = formRow(dist, 'Map width', 'How far it is from the left edge to the right edge');
			const box = row.createDiv({ cls: 'ws-map-scale-input' });
			const w = box.createEl('input', { cls: 'ws-input', attr: { type: 'number', min: '0.001', step: 'any', value: String(doc.scale.width), 'aria-label': 'Width of the map' } });
			const u = box.createEl('input', { cls: 'ws-input', attr: { type: 'text', value: doc.scale.unit, 'aria-label': 'Unit', placeholder: 'miles', list: 'ws-map-units' } });
			const dl = box.createEl('datalist', { attr: { id: 'ws-map-units' } });
			for (const unit of UNITS) dl.createEl('option', { attr: { value: unit } });
			const commit = () => {
				const width = Number(w.value);
				const unit = u.value.trim() || 'miles';
				if (!(width > 0)) return;
				if (width !== doc.scale!.width || unit !== doc.scale!.unit) this.change({ scale: { ...doc.scale!, width, unit } });
			};
			w.addEventListener('change', commit);
			u.addEventListener('change', commit);
		}

		const of = panelSection(el, 'This map shows', 'crosshair');
		of.createDiv({ cls: 'ws-vis-panel__hint', text: 'Link the place it’s a map of, and the map appears on that entry’s page.' });
		const ol = of.createDiv({ cls: 'ws-vis-panel__line' });
		const e = doc.entityId ? this.s.entities.get(doc.entityId) : undefined;
		const pick = (anchor: HTMLElement) =>
			new EntityPicker(anchor, {
				session: this.s,
				app: this.ctx.ws.app,
				createTypes: [],
				placeholder: 'A map of where?',
				onPick: (x: EntityRecord) => this.change({ entityId: x.id }),
			});
		if (e) {
			const chip = ol.createDiv({ cls: 'ws-vis-kind' });
			avatar(chip, this.ctx.ws.app, e, this.s.schemas.get(e.typeId), { size: 'xs' });
			chip.createSpan({ text: e.name });
			button(ol, { icon: 'replace', variant: 'quiet', size: 'sm', tooltip: 'Change', onClick: (evt) => pick(evt.currentTarget as HTMLElement) });
			button(ol, { icon: 'x', variant: 'quiet', size: 'sm', tooltip: 'Unlink', onClick: () => this.change({ entityId: null }) });
		} else button(ol, { label: 'Choose a place', icon: 'link', variant: 'ghost', size: 'sm', onClick: (evt) => pick(evt.currentTarget as HTMLElement) });
		el.scrollTop = keepScroll;
	}
}
