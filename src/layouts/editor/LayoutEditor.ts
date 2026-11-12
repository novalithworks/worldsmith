import { Component, Menu, setIcon, setTooltip } from 'obsidian';
import type { BlockDefinition, BlockRegistry, BlockRenderContext, BlockSurface } from '../../blocks/BlockRegistry';
import type { BlockInstance } from '../../core/types';
import { uuid } from '../../core/util/ids';
import { cx, icon, nameRegion } from '../../ui/components/dom';
import { COLUMNS, compact, insert, move, normalize, resize } from '../engine/grid';
import { LayoutRenderer, type ContextFactory } from '../renderer/LayoutRenderer';
import { BLOCK_HEIGHT_MAX, BLOCK_HEIGHT_MIN } from '../../data/migrations/records';

const clampHeight = (h: number) => Math.round(Math.min(BLOCK_HEIGHT_MAX, Math.max(BLOCK_HEIGHT_MIN, h)));

export interface LayoutEditorOptions {
	registry: BlockRegistry;
	surface: BlockSurface;
	/** Context for one block (the editor adds `editing` and `setConfig`). */
	makeContext: ContextFactory;
	/** Called with the new layout after every edit. */
	onChange(blocks: BlockInstance[]): void;
	/** Opens a block's settings (gear). */
	openSettings(instance: BlockInstance, def: BlockDefinition, save: (next: BlockInstance) => void): void;
}

type Side = 'top' | 'bottom' | 'left' | 'right';

/**
 * A customizable page: renders blocks with the layout engine and, in edit mode, adds
 * per-block chrome — drag handle, settings, remove, width grip — plus keyboard-friendly
 * menu alternatives (move up/down, wider/narrower). Placement math lives in
 * layouts/engine/grid.ts; this class only translates gestures into those operations.
 */
export class LayoutEditor extends Component {
	private blocks: BlockInstance[] = [];
	private editing = false;
	private renderer: LayoutRenderer | null = null;
	private host!: HTMLElement;
	/** Set once unloaded: a late gesture or settings save must not draw into a detached host. */
	private dead = false;

	constructor(private readonly o: LayoutEditorOptions) {
		super();
	}

	override onunload(): void {
		this.dead = true;
	}

	/** Draw into `host`; `editing` starts in Customize mode (one draw, so widgets never open and close at once). */
	mount(host: HTMLElement, blocks: BlockInstance[], editing = false): void {
		this.editing = editing;
		this.host = host;
		this.blocks = normalize(blocks);
		this.draw();
	}

	get isEditing(): boolean {
		return this.editing;
	}

	get current(): BlockInstance[] {
		return this.blocks;
	}

	setEditing(on: boolean): void {
		this.editing = on;
		this.draw();
	}

	/** Replace the layout (reset, external change) without emitting onChange. */
	replace(blocks: BlockInstance[]): void {
		this.blocks = normalize(blocks);
		this.draw();
	}

	/** Add a block of `type` at the first free spot (bottom if none). */
	add(type: string): void {
		const def = this.o.registry.get(type);
		if (!def) return;
		const block: BlockInstance = { id: `${type}-${uuid().slice(0, 8)}`, type, x: 0, y: 0, w: def.defaultSize.w, h: def.defaultSize.h, config: { ...def.defaultConfig } };
		const maxY = this.blocks.reduce((m, b) => Math.max(m, b.y + b.h), 0);
		this.commit(insert(this.blocks, { ...block, y: maxY }, COLUMNS));
		window.setTimeout(() => this.host.querySelector(`[data-block-id="${block.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
	}

	private commit(next: BlockInstance[]): void {
		if (this.dead) return;
		this.blocks = compact(normalize(next));
		this.o.onChange(this.blocks);
		if (!this.dead) this.draw();
	}

	/** Patch one block (settings saves); a no-op if the block is gone. */
	patchBlock(id: string, patch: Partial<BlockInstance>): void {
		if (!this.blocks.some((b) => b.id === id)) return;
		this.updateBlock(id, patch);
	}

	private updateBlock(id: string, patch: Partial<BlockInstance>): void {
		this.commit(this.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)));
	}

	draw(): void {
		if (this.dead || !this.host) return;
		const scroller = this.host.closest('.ws-shell__page');
		const scroll = scroller?.scrollTop ?? 0;
		if (this.renderer) this.removeChild(this.renderer);
		this.host.empty();
		this.host.toggleClass('is-editing', this.editing);
		this.renderer = new LayoutRenderer(this.o.registry, (instance, def, el, component, setTitle): BlockRenderContext => ({
			...this.o.makeContext(instance, def, el, component, setTitle),
			editing: this.editing,
			setConfig: (config) => {
				// Config edits from inside a block (e.g. a stat tile) keep the page as it is.
				if (this.dead) return;
				this.blocks = this.blocks.map((b) => (b.id === instance.id ? { ...b, config } : b));
				this.o.onChange(this.blocks);
			},
		}));
		this.addChild(this.renderer);
		const surface = this.host.createDiv({ cls: 'ws-page__layout' });
		this.renderer.render(surface, this.blocks);
		if (this.editing) this.decorate(surface);
		if (scroller) scroller.scrollTop = scroll;
	}

	// ── edit chrome ───────────────────────────────────────────────────────────

	private decorate(surface: HTMLElement): void {
		surface.querySelectorAll<HTMLElement>('.ws-block[data-block-id]').forEach((el) => {
			const id = el.dataset.blockId as string;
			const b = this.blocks.find((x) => x.id === id);
			if (!b) return;
			const def = this.o.registry.get(b.type);
			el.addClass('ws-editable');
			const chrome = el.createDiv({ cls: 'ws-edit-chrome' });
			const handle = chrome.createEl('button', { cls: 'ws-edit-chrome__btn ws-edit-chrome__drag', attr: { type: 'button', 'aria-label': `Move ${def?.name ?? 'widget'}` } });
			setIcon(handle, 'grip-horizontal');
			setTooltip(handle, 'Drag to move', { delay: 400 });
			handle.addEventListener('pointerdown', (e) => this.startDrag(e, b, el, surface));
			if (def) {
				const gear = chrome.createEl('button', { cls: 'ws-edit-chrome__btn', attr: { type: 'button', 'aria-label': `${def.name} settings` } });
				setIcon(gear, 'settings-2');
				gear.addEventListener('click', () => this.o.openSettings(b, def, (next) => this.updateBlock(b.id, next)));
			}
			const more = chrome.createEl('button', { cls: 'ws-edit-chrome__btn', attr: { type: 'button', 'aria-label': 'Layout options' } });
			setIcon(more, 'more-horizontal');
			more.addEventListener('click', (e) => this.menu(e, b));
			const x = chrome.createEl('button', { cls: 'ws-edit-chrome__btn is-danger', attr: { type: 'button', 'aria-label': `Remove ${def?.name ?? 'widget'}` } });
			setIcon(x, 'x');
			x.addEventListener('click', () => this.commit(this.blocks.filter((o) => o.id !== b.id)));

			const grip = el.createDiv({ cls: 'ws-edit-resize', attr: { role: 'separator', 'aria-label': 'Drag to change width', 'aria-orientation': 'vertical' } });
			grip.addEventListener('pointerdown', (e) => this.startResize(e, b, el, surface));
			el.createDiv({ cls: 'ws-edit-width', text: `${b.w} / ${COLUMNS}` });
			// Bottom edge: drag to set a height; double-click goes back to fitting the content.
			const vgrip = el.createDiv({ cls: 'ws-edit-vresize', attr: { role: 'separator', 'aria-orientation': 'horizontal', tabindex: '0' } });
			setTooltip(vgrip, 'Drag to change height · double-click to fit content', { delay: 500, placement: 'bottom' });
			vgrip.addEventListener('pointerdown', (e) => this.startVResize(e, b, el));
			vgrip.addEventListener('dblclick', () => b.height && this.updateBlock(b.id, { height: null }));
			vgrip.addEventListener('keydown', (e) => {
				if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
				e.preventDefault();
				const cur = b.height ?? Math.round(el.getBoundingClientRect().height);
				this.updateBlock(b.id, { height: clampHeight(cur + (e.key === 'ArrowDown' ? 20 : -20)) });
				// The page was redrawn: keep the keyboard on this block's handle.
				this.host.querySelector<HTMLElement>(`.ws-block[data-block-id="${CSS.escape(b.id)}"] .ws-edit-vresize`)?.focus();
			});
			el.createDiv({ cls: 'ws-edit-height', text: b.height ? `${b.height} px` : 'Auto height' });
		});
	}

	private menu(evt: MouseEvent, b: BlockInstance): void {
		const m = new Menu();
		const ordered = [...this.blocks].sort((a, c) => a.y - c.y || a.x - c.x);
		const i = ordered.findIndex((o) => o.id === b.id);
		const prev = ordered[i - 1];
		const next = ordered[i + 1];
		m.addItem((it) => it.setTitle('Move up').setIcon('arrow-up').setDisabled(!prev).onClick(() => prev && this.place(b.id, prev.id, 'top')));
		m.addItem((it) => it.setTitle('Move down').setIcon('arrow-down').setDisabled(!next).onClick(() => next && this.place(b.id, next.id, 'bottom')));
		m.addSeparator();
		m.addItem((it) => it.setTitle('Wider').setIcon('chevrons-left-right').setDisabled(b.w >= COLUMNS).onClick(() => this.commit(resize(this.blocks, b.id, b.w + 1, b.h))));
		m.addItem((it) => it.setTitle('Narrower').setIcon('chevrons-right-left').setDisabled(b.w <= 2).onClick(() => this.commit(resize(this.blocks, b.id, b.w - 1, b.h))));
		m.addItem((it) => it.setTitle('Taller').setIcon('chevrons-up-down').onClick(() => this.updateBlock(b.id, { height: clampHeight((b.height ?? this.heightOf(b.id)) + 80) })));
		m.addItem((it) => it.setTitle('Shorter').setIcon('chevrons-down-up').onClick(() => this.updateBlock(b.id, { height: clampHeight((b.height ?? this.heightOf(b.id)) - 80) })));
		if (b.height) m.addItem((it) => it.setTitle('Fit content').setIcon('fold-vertical').onClick(() => this.updateBlock(b.id, { height: null })));
		m.addItem((it) => it.setTitle('Full width').setIcon('move-horizontal').setDisabled(b.w === COLUMNS).onClick(() => this.commit(move(resize(this.blocks.map((o) => (o.id === b.id ? { ...o, x: 0 } : o)), b.id, COLUMNS, b.h), b.id, 0, b.y))));
		m.addSeparator();
		m.addItem((it) => it.setTitle('Remove').setIcon('trash-2').setWarning(true).onClick(() => this.commit(this.blocks.filter((o) => o.id !== b.id))));
		m.showAtMouseEvent(evt);
	}

	/** Place block `id` on a side of block `targetId`. */
	place(id: string, targetId: string, side: Side): void {
		const moving = this.blocks.find((b) => b.id === id);
		const target = this.blocks.find((b) => b.id === targetId);
		if (!moving || !target || moving.id === target.id) return;
		let rest = this.blocks.filter((b) => b.id !== id);
		if ((side === 'left' || side === 'right') && target.w >= 4) {
			const half = Math.floor(target.w / 2);
			const placed: BlockInstance = { ...moving, y: target.y, w: half, x: side === 'left' ? target.x : target.x + target.w - half };
			rest = rest.map((b) => (b.id === target.id ? { ...b, w: target.w - half, x: side === 'left' ? target.x + half : target.x } : b));
			this.commit([...rest, placed]);
			return;
		}
		const y = side === 'top' || side === 'left' ? target.y : target.y + target.h;
		const placed: BlockInstance = { ...moving, x: target.x, w: target.w, y };
		// Make room: everything at or below y in the target's columns moves down.
		const shifted = rest.map((b) => (b.y >= y && b.x < target.x + target.w && target.x < b.x + b.w ? { ...b, y: b.y + moving.h } : b));
		this.commit([...shifted, placed]);
	}

	private startDrag(e: PointerEvent, b: BlockInstance, el: HTMLElement, surface: HTMLElement): void {
		e.preventDefault();
		const doc = el.ownerDocument;
		el.addClass('is-dragging');
		const ghost = ((el.closest('.worldsmith')) ?? doc.body).createDiv({ cls: 'ws-drag-ghost', text: this.o.registry.get(b.type)?.name ?? 'Widget' });
		const marker = surface.createDiv({ cls: 'ws-drop-marker' });
		let drop: { id: string; side: Side } | null = null;
		const sr = () => surface.getBoundingClientRect();
		const onMove = (ev: PointerEvent) => {
			ghost.style.left = `${ev.clientX + 12}px`;
			ghost.style.top = `${ev.clientY + 12}px`;
			ghost.setCssStyles({ display: 'block' });
			const under = doc.elementFromPoint(ev.clientX, ev.clientY)?.closest('.ws-block[data-block-id]') as HTMLElement | null;
			if (!under || under === el || !surface.contains(under)) {
				drop = null;
				marker.removeClass('is-on');
				return;
			}
			const r = under.getBoundingClientRect();
			const fx = (ev.clientX - r.left) / r.width;
			const fy = (ev.clientY - r.top) / r.height;
			const target = this.blocks.find((x) => x.id === under.dataset.blockId);
			let side: Side = fy < 0.5 ? 'top' : 'bottom';
			if (target && target.w >= 4 && (fx < 0.2 || fx > 0.8)) side = fx < 0.2 ? 'left' : 'right';
			drop = { id: under.dataset.blockId as string, side };
			const s = sr();
			marker.addClass('is-on');
			marker.className = `ws-drop-marker is-on is-${side}`;
			const vertical = side === 'left' || side === 'right';
			marker.style.left = `${(side === 'right' ? r.right - 3 : r.left) - s.left}px`;
			marker.style.top = `${(side === 'bottom' ? r.bottom - 3 : r.top) - s.top}px`;
			marker.style.width = vertical ? '4px' : `${r.width}px`;
			marker.style.height = vertical ? `${r.height}px` : '4px';
		};
		const onUp = () => {
			doc.removeEventListener('pointermove', onMove);
			doc.removeEventListener('pointerup', onUp);
			doc.removeEventListener('pointercancel', onUp);
			ghost.remove();
			marker.remove();
			el.removeClass('is-dragging');
			if (drop) this.place(b.id, drop.id, drop.side);
		};
		doc.addEventListener('pointermove', onMove);
		doc.addEventListener('pointerup', onUp);
		doc.addEventListener('pointercancel', onUp);
	}

	private heightOf(id: string): number {
		const el = this.host.querySelector<HTMLElement>(`.ws-block[data-block-id="${CSS.escape(id)}"]`);
		return Math.round(el?.getBoundingClientRect().height ?? 240);
	}

	/** Drag the bottom edge: the block's height follows the pointer in 10 px steps. */
	private startVResize(e: PointerEvent, b: BlockInstance, el: HTMLElement): void {
		e.preventDefault();
		e.stopPropagation();
		const doc = el.ownerDocument;
		const top = el.getBoundingClientRect().top;
		const startScroll = el.closest('.ws-shell__page')?.scrollTop ?? 0;
		const scroller = el.closest('.ws-shell__page');
		const badge = el.querySelector('.ws-edit-height');
		const startY = e.clientY;
		let h = b.height ?? clampHeight(Math.round(el.getBoundingClientRect().height));
		let moved = false;
		el.addClass('is-vresizing');
		const onMove = (ev: PointerEvent) => {
			// A click or tap without dragging leaves the height alone.
			if (!moved && Math.abs(ev.clientY - startY) < 4) return;
			moved = true;
			el.addClass('has-height');
			const scrolled = (scroller?.scrollTop ?? 0) - startScroll;
			h = clampHeight(Math.round((ev.clientY - top + scrolled) / 10) * 10);
			el.style.setProperty('--ws-block-h', `${h}px`);
			badge?.setText(`${h} px`);
		};
		const onUp = () => {
			doc.removeEventListener('pointermove', onMove);
			doc.removeEventListener('pointerup', onUp);
			doc.removeEventListener('pointercancel', onUp);
			el.removeClass('is-vresizing');
			if (moved && h !== b.height) this.updateBlock(b.id, { height: h });
		};
		doc.addEventListener('pointermove', onMove);
		doc.addEventListener('pointerup', onUp);
		doc.addEventListener('pointercancel', onUp);
	}

	private startResize(e: PointerEvent, b: BlockInstance, el: HTMLElement, surface: HTMLElement): void {
		e.preventDefault();
		e.stopPropagation();
		const doc = el.ownerDocument;
		const col = surface.getBoundingClientRect().width / COLUMNS;
		const left = el.getBoundingClientRect().left;
		const badge = el.querySelector('.ws-edit-width');
		const outline = el.createDiv({ cls: 'ws-resize-outline' });
		let w = b.w;
		el.addClass('is-resizing');
		const onMove = (ev: PointerEvent) => {
			w = Math.max(2, Math.min(COLUMNS - b.x, Math.round((ev.clientX - left) / col)));
			outline.style.width = `${w * col - 8}px`;
			badge?.setText(`${w} / ${COLUMNS}`);
		};
		const onUp = () => {
			doc.removeEventListener('pointermove', onMove);
			doc.removeEventListener('pointerup', onUp);
			doc.removeEventListener('pointercancel', onUp);
			el.removeClass('is-resizing');
			outline.remove();
			if (w !== b.w) this.commit(resize(this.blocks, b.id, w, b.h));
		};
		doc.addEventListener('pointermove', onMove);
		doc.addEventListener('pointerup', onUp);
		doc.addEventListener('pointercancel', onUp);
	}
}

/** The "Add a widget" panel for a surface — grouped by category, with search when long. */
export function renderWidgetDrawer(
	parent: HTMLElement,
	registry: BlockRegistry,
	surface: BlockSurface,
	present: BlockInstance[],
	onAdd: (type: string) => void,
	initialQuery = '',
): HTMLElement {
	const drawer = parent.createDiv({ cls: 'ws-widget-drawer', attr: { role: 'dialog'} });
	nameRegion(drawer, 'Add a widget' );
	drawer.createDiv({ cls: 'ws-widget-drawer__title', text: 'Add a widget' });
	drawer.createDiv({ cls: 'ws-widget-drawer__hint', text: 'Click to add, then drag it into place.' });
	const defs = registry.forSurface(surface);
	const list = drawer.createDiv({ cls: 'ws-widget-drawer__list' });
	const paint = (q: string) => {
		list.empty();
		const groups = new Map<string, BlockDefinition[]>();
		for (const def of defs) {
			if (q && !`${def.name} ${def.hint ?? ''} ${def.description}`.toLowerCase().includes(q)) continue;
			const g = def.category ?? '';
			groups.set(g, [...(groups.get(g) ?? []), def]);
		}
		if (!groups.size) list.createDiv({ cls: 'ws-widget-drawer__none', text: 'No widgets match.' });
		const ORDER = ['Basics', 'Showcase', 'Connections', 'Writing', 'Overview', 'Build your own', 'Activity', 'Discovery', 'Tasks', 'Needs attention'];
		const rank = (g: string) => (ORDER.includes(g) ? ORDER.indexOf(g) : ORDER.length);
		for (const [g, items] of [...groups].sort((a, b) => rank(a[0]) - rank(b[0]))) {
			if (g && groups.size > 1) list.createDiv({ cls: 'ws-widget-drawer__group', text: g });
			for (const def of items) {
				const count = present.filter((b) => b.type === def.id).length;
				const added = def.singleton && count > 0;
				const b = list.createEl('button', { cls: cx('ws-widget', added && 'is-added'), attr: { type: 'button', 'data-widget': def.id } });
				if (added) b.disabled = true;
				icon(b, def.icon, 'ws-widget__icon');
				const t = b.createDiv({ cls: 'ws-widget__text' });
				t.createDiv({ cls: 'ws-widget__name', text: def.name });
				t.createDiv({ cls: 'ws-widget__hint', text: added ? 'On the page' : (def.hint ?? def.description) });
				if (count && !added) b.createSpan({ cls: 'ws-widget__count', text: `×${count}` });
				b.addEventListener('click', () => onAdd(def.id));
			}
		}
	};
	if (defs.length > 10) {
		const search = drawer.createEl('input', { cls: 'ws-input ws-widget-drawer__search', attr: { type: 'search', placeholder: 'Find a widget…', 'aria-label': 'Find a widget' } });
		drawer.insertBefore(search, list);
		search.value = initialQuery;
		search.addEventListener('input', () => paint(search.value.trim().toLowerCase()));
		paint(initialQuery.trim().toLowerCase());
	} else paint('');
	return drawer;
}
