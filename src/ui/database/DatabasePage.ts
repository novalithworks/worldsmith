import { Component, Keymap, Menu, Notice, setIcon, setTooltip, type TFile } from 'obsidian';
import { viewKind, type DatabaseView, type EntityRecord, type EntitySchema, type FieldDefinition, type ViewColumn, type ViewKind } from '../../core/types';
import { debounce } from '../../core/util/async';
import { pluralize, relativeTime } from '../../core/util/strings';
import { selectOptions } from '../../fields/types/logic';
import { vaultImage } from '../../fields/ui/media';
import type { Group } from '../../services/entryQuery';
import { exportTypeCsv } from '../transfer/transferPage';
import { MigrationModal } from '../notes/migrationModal';
import { boardProps, brokenConditions, groupableProps, groupView, propInfo, runView } from '../../services/viewQuery';
import { defaultViewId } from '../../services/ViewService';
import type { WorldSession } from '../../services/WorldSession';
import { ROUTES } from '../../state/route';
import { entityMenu, openCreateEntity } from '../actions';
import { avatar } from '../components/avatar';
import { button, cx, emptyState, icon, statusPill, nameRegion } from '../components/dom';
import { cardFieldsOf, renderEntityCard, subtitleFor } from '../components/entityCard';
import { own } from '../components/lifecycle';
import { confirmModal, NotePickerModal, promptModal } from '../components/modals';
import { AdoptNotesModal } from '../notes/adoptModal';
import { mightCarryNotes, vaultFilesInDrag } from '../dnd/vaultDrag';
import { actionNotice } from '../components/notice';
import { Popover } from '../components/popover';
import { openPropertyPicker } from '../components/propertyPicker';
import type { RouteContext } from '../views/routes/RouteRegistry';
import { addViewToDashboard } from './share';
import { renderProgressView } from './progress';
import { BUILTIN_COLUMNS, columnLabel, describeCondition, naturalDir, openFieldsPanel, openFilterPanel, openSortPanel, showMenuAt } from './controls';
import { mountPageBanner, pageBannerKey } from '../media/pageBanner';

export const VIEW_KINDS: Array<{ id: ViewKind; icon: string; label: string }> = [
	{ id: 'cards', icon: 'layout-grid', label: 'Cards' },
	{ id: 'gallery', icon: 'gallery-vertical-end', label: 'Gallery' },
	{ id: 'table', icon: 'table-2', label: 'Table' },
	{ id: 'list', icon: 'list', label: 'List' },
	{ id: 'board', icon: 'square-kanban', label: 'Board' },
	{ id: 'progress', icon: 'gauge', label: 'Development' },
];

/** Entries drawn per batch (the rest as you scroll); a group shows this many before "Show all". */
const BATCH = 80;
const GROUP_PREVIEW = 60;

/**
 * One type's database (Milestone 8): saved views as tabs, each with its own layout (cards,
 * gallery, table, list, board), filters, sorting, grouping and fields. Every change saves
 * to the view straight away, so it syncs and dashboards that show the view follow it.
 */
export class DatabasePage {
	private viewId: string;
	private search: string;
	private tabsEl!: HTMLElement;
	private barEl!: HTMLElement;
	private chipsEl!: HTMLElement;
	private results!: HTMLElement;
	private countEl!: HTMLElement;
	private observers: IntersectionObserver[] = [];
	private selfSave = 0;
	private shownGroups = new Set<string>();
	private pop: Popover | null = null;
	private popKey = '';
	/** The open cell editor; live refreshes wait until it closes (they'd pull the cell away). */
	private cellPop: Popover | null = null;
	private pendingRefresh = false;
	/** How many entries the lazy list had drawn, so a refresh doesn't snap back to the first batch. */
	private lazyShown = 0;
	private dead = false;
	private onSearch: (ReturnType<typeof debounce> & { cancel(): void }) | null = null;

	constructor(
		private readonly ctx: RouteContext,
		private readonly s: WorldSession,
		private readonly schema: EntitySchema,
		private readonly page: HTMLElement,
	) {
		this.search = ctx.params.q ?? '';
		const views = s.views.forType(schema.id);
		this.viewId = views.some((v) => v.id === ctx.params.view) ? (ctx.params.view as string) : views[0]!.id;
	}

	private get view(): DatabaseView {
		return this.s.views.get(this.viewId) ?? this.s.views.forType(this.schema.id)[0]!;
	}

	/** The layout to draw (an unknown one from a newer version shows as cards). */
	private get kind(): ViewKind {
		return viewKind(this.view);
	}

	mount(): void {
		const { schema } = this;
		const header = this.page.createDiv({ cls: cx('ws-db-header', schema.color ? `ws-tint--${schema.color}` : '') });
		const mark = header.createDiv({ cls: 'ws-db-header__mark' });
		icon(mark, schema.icon);
		const text = header.createDiv({ cls: 'ws-db-header__text' });
		text.createEl('h1', { cls: 'ws-db-header__title', text: schema.plural });
		this.countEl = text.createDiv({ cls: 'ws-db-header__count' });
		if (schema.description) text.createDiv({ cls: 'ws-db-header__desc', text: schema.description });
		const hActions = header.createDiv({ cls: 'ws-db-header__actions' });
		button(hActions, {
			icon: 'shapes',
			variant: 'ghost',
			tooltip: `Edit the ${schema.singular.toLowerCase()} type in Type Studio`,
			ariaLabel: 'Edit type',
			onClick: (evt) => this.ctx.navigate(ROUTES.typeStudio(schema.id), Keymap.isModEvent(evt)),
		});
		button(hActions, {
			icon: 'file-input',
			variant: 'ghost',
			tooltip: `Add an existing note as a ${schema.singular.toLowerCase()} (or drag notes here from the file explorer)`,
			ariaLabel: 'Add existing note',
			cls: 'ws-db-adopt',
			onClick: () => new NotePickerModal(this.ctx.ws.app, (f) => this.adopt([f])).open(),
		});
		button(hActions, { label: `New ${schema.singular.toLowerCase()}`, icon: 'plus', variant: 'primary', cls: 'ws-db-new', onClick: () => openCreateEntity(this.ctx.ws, { typeId: schema.id }) });
		mountPageBanner({ ws: this.ctx.ws, session: this.s, component: this.ctx.component, header, key: pageBannerKey.type(schema.id), label: schema.plural });

		this.tabsEl = this.page.createDiv({ cls: 'ws-vtabs', attr: { role: 'tablist'} });
		nameRegion(this.tabsEl, `${schema.plural} views` );
		this.barEl = this.page.createDiv({ cls: 'ws-toolbar ws-vbar', attr: { role: 'toolbar'} });
		nameRegion(this.barEl, `${schema.plural} view options` );
		this.chipsEl = this.page.createDiv({ cls: 'ws-vchips' });
		this.results = this.page.createDiv({ cls: 'ws-db-results' });
		this.drawChrome();
		this.refresh();
		this.listen();
		this.listenForNotes();
	}

	// ── adopting notes (0.18) ────────────────────────────────────────────────

	private adopt(files: TFile[]): void {
		if (this.dead || !files.length) return;
		new AdoptNotesModal(this.ctx.ws, this.schema, files, (r) => this.ctx.navigate(r)).open();
	}

	/** Notes dragged from the file explorer onto the page become entries of this type. */
	private listenForNotes(): void {
		const app = this.ctx.ws.app;
		const page = this.page;
		page.dataset.dropLabel = `Add as ${this.schema.plural}`;
		let depth = 0;
		const wants = (evt: DragEvent) => !evt.defaultPrevented && !page.querySelector('.ws-bcard.is-dragging') && mightCarryNotes(app, evt.dataTransfer);
		const clear = () => {
			depth = 0;
			page.removeClass('is-note-drop');
		};
		const onEnter = (evt: DragEvent) => {
			if (!wants(evt)) return;
			depth++;
			page.addClass('is-note-drop');
		};
		const onOver = (evt: DragEvent) => {
			if (!wants(evt)) return;
			evt.preventDefault();
			if (evt.dataTransfer) evt.dataTransfer.dropEffect = 'link';
			page.addClass('is-note-drop');
		};
		const onLeave = () => {
			depth = Math.max(0, depth - 1);
			if (!depth) page.removeClass('is-note-drop');
		};
		const onDrop = (evt: DragEvent) => {
			const mine = page.hasClass('is-note-drop');
			clear();
			if (evt.defaultPrevented || !mine) return;
			const files = vaultFilesInDrag(app, evt.dataTransfer, (f) => f.extension === 'md', { folders: true });
			if (!files.length) return;
			evt.preventDefault();
			this.adopt(files);
		};
		page.addEventListener('dragenter', onEnter);
		page.addEventListener('dragover', onOver);
		page.addEventListener('dragleave', onLeave);
		page.addEventListener('drop', onDrop);
		const doc = page.ownerDocument;
		doc.addEventListener('dragend', clear);
		this.ctx.component.register(() => {
			page.removeEventListener('dragenter', onEnter);
			page.removeEventListener('dragover', onOver);
			page.removeEventListener('dragleave', onLeave);
			page.removeEventListener('drop', onDrop);
			doc.removeEventListener('dragend', clear);
		});
	}

	// ── state ────────────────────────────────────────────────────────────────

	private update(patch: Partial<DatabaseView>, o: { results?: boolean } = {}): void {
		if (this.dead) return;
		this.selfSave++;
		try {
			const saved = this.s.views.update(this.viewId, patch);
			if (saved) this.viewId = saved.id;
		} finally {
			this.selfSave--;
		}
		this.drawToolbar();
		this.drawChips();
		this.drawTabs();
		if (o.results !== false) this.refresh();
	}

	private selectView(id: string): void {
		if (this.dead) return;
		this.pop?.close();
		this.viewId = id;
		this.shownGroups.clear();
		this.lazyShown = 0;
		this.ctx.replaceParams(this.params());
		this.drawChrome();
		this.refresh();
		this.results.scrollIntoView({ block: 'nearest' });
	}

	private params(): Record<string, string> {
		const p: Record<string, string> = { typeId: this.schema.id };
		const first = this.s.views.forType(this.schema.id)[0];
		if (this.viewId !== first?.id) p.view = this.viewId;
		if (this.search) p.q = this.search;
		return p;
	}

	private drawChrome(): void {
		this.drawTabs();
		this.drawToolbar();
		this.drawChips();
	}

	// ── tabs ─────────────────────────────────────────────────────────────────

	private drawTabs(): void {
		const el = this.tabsEl;
		el.empty();
		const views = this.s.views.forType(this.schema.id);
		for (const v of views) {
			const on = v.id === this.viewId;
			const tab = el.createEl('button', { cls: cx('ws-vtab', on && 'is-active'), attr: { type: 'button', role: 'tab', 'aria-selected': String(on), 'data-view': v.id } });
			icon(tab, v.icon ?? VIEW_KINDS.find((k) => k.id === viewKind(v))?.icon ?? 'layout-grid', 'ws-vtab__icon');
			tab.createSpan({ cls: 'ws-vtab__label', text: v.name });
			if (on) {
				// The options are also on the keyboard: ↓, Shift+F10 or the menu key on the tab.
				tab.setAttr('aria-haspopup', 'menu');
				tab.setAttr('title', 'View options: ↓ or right-click');
				const more = tab.createSpan({ cls: 'ws-vtab__more', attr: { 'aria-hidden': 'true' } });
				setIcon(more, 'chevron-down');
				more.addEventListener('click', (evt) => {
					evt.stopPropagation();
					this.tabMenu(evt, v, tab);
				});
				tab.addEventListener('keydown', (evt) => {
					if (evt.key === 'ArrowDown' || evt.key === 'ContextMenu' || (evt.shiftKey && evt.key === 'F10')) {
						evt.preventDefault();
						this.tabMenu(null, v, tab);
					}
				});
			}
			tab.addEventListener('click', () => !on && this.selectView(v.id));
			tab.addEventListener('dblclick', () => void this.rename(v));
			tab.addEventListener('contextmenu', (evt) => {
				evt.preventDefault();
				this.tabMenu(evt, v, tab);
			});
		}
		// Arrow keys move between tabs (the usual tablist behaviour).
		el.onkeydown = (evt) => {
			if (evt.key !== 'ArrowLeft' && evt.key !== 'ArrowRight') return;
			const tabs = [...el.querySelectorAll<HTMLElement>('.ws-vtab[role="tab"]')];
			const i = tabs.indexOf(evt.target as HTMLElement);
			if (i < 0) return;
			evt.preventDefault();
			const next = tabs[(i + (evt.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
			next?.click();
			window.setTimeout(() => this.tabsEl.querySelector<HTMLElement>('.ws-vtab.is-active')?.focus(), 0);
		};
		const add = el.createEl('button', { cls: 'ws-vtab ws-vtab--add', attr: { type: 'button', 'aria-label': 'New view' } });
		icon(add, 'plus');
		add.createSpan({ text: 'View' });
		setTooltip(add, 'Save a new view of this type', { delay: 400 });
		add.addEventListener('click', () => void this.newView());
	}

	private tabMenu(evt: MouseEvent | null, v: DatabaseView, tab: HTMLElement): void {
		const s = this.s;
		const views = s.views.forType(this.schema.id);
		const i = views.findIndex((x) => x.id === v.id);
		const m = new Menu();
		m.addItem((it) => it.setTitle('Rename…').setIcon('pencil').onClick(() => void this.rename(v)));
		m.addItem((it) =>
			it
				.setTitle('Duplicate')
				.setIcon('copy')
				.onClick(() => {
					const copy = s.views.duplicate(v.id);
					if (copy) this.selectView(copy.id);
				}),
		);
		m.addItem((it) => it.setTitle('Show on a dashboard…').setIcon('layout-dashboard').onClick(() => addViewToDashboard(this.ctx.ws, s, v, this.ctx.navigate)));
		m.addItem((it) =>
			it
				.setTitle('Export as spreadsheet (CSV)')
				.setIcon('sheet')
				.onClick(() => {
					// The view's entries in its order, with every field — so it can be imported again.
					const list = runView(s, v);
					void exportTypeCsv(this.ctx.ws, s, this.schema.id, list, `${this.schema.plural} - ${v.name}`);
				}),
		);
		m.addItem((it) => it.setTitle(`Native notes for ${this.schema.plural.toLowerCase()}…`).setIcon('file-check').onClick(() => new MigrationModal(this.ctx.ws, { kind: 'type', id: this.schema.id }).open()));
		m.addSeparator();
		if (i > 0) m.addItem((it) => it.setTitle('Move left').setIcon('arrow-left').onClick(() => (s.views.move(v.id, -1), this.drawTabs())));
		if (i < views.length - 1) m.addItem((it) => it.setTitle('Move right').setIcon('arrow-right').onClick(() => (s.views.move(v.id, 1), this.drawTabs())));
		m.addSeparator();
		m.addItem((it) => {
			it.setTitle('Delete view').setIcon('trash-2').setWarning(true);
			if (views.length <= 1 || !s.views.isStored(v.id)) it.setDisabled(true);
			it.onClick(() => void this.deleteView(v));
		});
		showMenuAt(m, evt, tab);
	}

	private async rename(v: DatabaseView): Promise<void> {
		const name = await promptModal(this.ctx.ws.app, { title: 'Rename view', value: v.name, confirmLabel: 'Rename' });
		if (!name?.trim()) return;
		this.selfSave++;
		try {
			this.s.views.update(v.id, { name: name.trim() });
		} finally {
			this.selfSave--;
		}
		if (!this.dead) this.drawTabs();
	}

	private async newView(): Promise<void> {
		const n = this.s.views.forType(this.schema.id).length + 1;
		const name = await promptModal(this.ctx.ws.app, { title: 'New view', label: 'Name', value: '', placeholder: `e.g. Main cast, Villains, View ${n}`, confirmLabel: 'Create view' });
		if (name === null) return;
		const cur = this.view;
		this.selfSave++;
		let created: DatabaseView;
		try {
			created = this.s.views.create(this.schema.id, { name: name.trim() || `View ${n}`, kind: viewKind(cur), card: cur.card, columns: cur.columns, board: cur.board });
		} finally {
			this.selfSave--;
		}
		this.selectView(created.id);
	}

	private async deleteView(v: DatabaseView): Promise<void> {
		const ok = await confirmModal(this.ctx.ws.app, {
			title: `Delete the “${v.name}” view?`,
			body: 'Only the view goes — its filters, sorting and layout. Your entries aren’t affected.',
			confirmLabel: 'Delete view',
		});
		if (!ok) return;
		this.selfSave++;
		let removed: DatabaseView | null;
		try {
			removed = this.s.views.remove(v.id);
		} finally {
			this.selfSave--;
		}
		if (!removed) return;
		this.selectView(this.s.views.forType(this.schema.id)[0]!.id);
		const back = removed;
		actionNotice(`View “${v.name}” deleted.`, {
			label: 'Undo',
			run: () => {
				this.s.views.restore(back);
				this.selectView(back.id);
			},
		});
	}

	// ── toolbar ──────────────────────────────────────────────────────────────

	private drawToolbar(): void {
		const bar = this.barEl;
		bar.empty();
		const view = this.view;
		const { schema } = this;
		const searchWrap = bar.createDiv({ cls: 'ws-search-field' });
		icon(searchWrap, 'search', 'ws-search-field__icon');
		const search = searchWrap.createEl('input', {
			cls: 'ws-search-field__input',
			attr: { type: 'search', placeholder: `Search ${schema.plural.toLowerCase()}…`, 'aria-label': `Search ${schema.plural}` },
		});
		search.value = this.search;
		this.onSearch?.cancel();
		const onSearch = debounce(() => {
			if (this.dead) return;
			this.search = search.value;
			this.lazyShown = 0;
			this.ctx.replaceParams(this.params());
			this.refresh();
		}, 150);
		this.onSearch = onSearch;
		search.addEventListener('input', () => onSearch());

		const tools = bar.createDiv({ cls: 'ws-vbar__tools' });
		const nf = view.conditions.length;
		const filterBtn = button(tools, { icon: 'filter', label: nf ? `Filter · ${nf}` : 'Filter', variant: 'quiet', size: 'sm', cls: cx('ws-vbar__filter', (nf > 0 || view.showArchived) && 'is-active').join(' '), onClick: () => this.openFilters(filterBtn) });
		const ns = view.sorts.length;
		const sortBtn = button(tools, { icon: 'arrow-up-down', label: ns ? `Sort · ${ns}` : 'Sort', variant: 'quiet', size: 'sm', cls: cx('ws-vbar__sort', ns > 0 && 'is-active').join(' '), onClick: () => this.togglePop(sortBtn, () => openSortPanel(sortBtn, schema, this.view, (sorts) => this.update({ sorts }), this.look)) });
		if (this.kind === 'board') {
			const label = propInfo(schema, view.board.field)?.label ?? 'Status';
			button(tools, { icon: 'columns-3', label: `Columns: ${label}`, variant: 'quiet', size: 'sm', cls: 'ws-vbar__group is-active', onClick: (evt) => this.boardMenu(evt.currentTarget as HTMLElement) });
		} else {
			const label = view.groupBy ? (propInfo(schema, view.groupBy)?.label ?? null) : null;
			button(tools, { icon: 'rows-3', label: label ? `Group: ${label}` : 'Group', variant: 'quiet', size: 'sm', cls: cx('ws-vbar__group', !!label && 'is-active').join(' '), onClick: (evt) => this.groupMenu(evt.currentTarget as HTMLElement) });
		}
		const fieldsBtn = button(tools, {
			icon: 'sliders-horizontal',
			label: this.kind === 'table' ? 'Columns' : 'Fields',
			variant: 'quiet',
			size: 'sm',
			cls: 'ws-vbar__fields',
			onClick: () => this.togglePop(fieldsBtn, () => openFieldsPanel(fieldsBtn, schema, this.view, this.defaults(), (patch) => this.update(patch))),
		});

		const seg = bar.createDiv({ cls: 'ws-segmented ws-vbar__kinds', attr: { role: 'radiogroup'} });
		nameRegion(seg, 'Layout' );
		for (const k of VIEW_KINDS) {
			const on = this.kind === k.id;
			const b = seg.createEl('button', { cls: cx('ws-segmented__item', on && 'is-active'), attr: { type: 'button', role: 'radio', 'aria-checked': String(on), 'aria-label': k.label, 'data-kind': k.id } });
			setIcon(b, k.icon);
			// Named on wide panes in the Modern Codex design (codex.css); an icon elsewhere.
			b.createSpan({ cls: 'ws-segmented__label', text: k.label });
			setTooltip(b, k.label, { delay: 300 });
			b.addEventListener('click', () => {
				if (this.kind === k.id) return;
				this.pop?.close();
				this.shownGroups.clear();
				this.update({ kind: k.id });
			});
		}
		this.reanchorPop();
	}

	/** The toolbar button a panel belongs to, by its stable class (the bar re-renders). */
	private popKeyOf(anchor: HTMLElement): string {
		return [...anchor.classList].find((c) => c.startsWith('ws-vbar__')) ?? '';
	}

	private togglePop(anchor: HTMLElement, open: () => Popover): void {
		const key = this.popKeyOf(anchor);
		const wasOpenHere = !!this.pop?.el.isConnected && this.popKey === key;
		this.pop?.close();
		this.pop = null;
		this.barEl.querySelectorAll('.is-open').forEach((x) => x.removeClass('is-open'));
		if (wasOpenHere) return;
		const p = open();
		this.pop = p;
		this.popKey = key;
		anchor.addClass('is-open');
		const watch = window.setInterval(() => {
			if (!p.el.isConnected) {
				window.clearInterval(watch);
				if (this.pop === p) {
					this.pop = null;
					this.barEl.querySelectorAll('.is-open').forEach((x) => x.removeClass('is-open'));
				}
			}
		}, 200);
	}

	/** After the toolbar re-renders, an open panel follows its (new) button. */
	private reanchorPop(): void {
		if (!this.pop?.el.isConnected || !this.popKey) return;
		const btn = this.barEl.querySelector<HTMLElement>(`.${this.popKey}`);
		if (!btn) {
			this.pop.close();
			this.pop = null;
			return;
		}
		btn.addClass('is-open');
		this.pop.setAnchor(btn);
	}

	private openFilters(anchor: HTMLElement, o: { addField?: string; focus?: string } = {}): void {
		this.togglePop(anchor, () => openFilterPanel(anchor, this.s, this.schema, this.view, (patch) => this.update(patch, {}), { ...o, look: this.look }));
	}

	private readonly look = (id: string) => ({ icon: this.propIcon(id), hint: this.propHint(id) });

	/** Icon for a property: the field's own, its kind's, or the built-in's. */
	private propIcon(id: string): string {
		const f = this.schema.fields.find((x) => x.id === id);
		if (f) return f.icon ?? this.ctx.ws.fieldTypes.for(f).icon ?? 'circle';
		return propInfo(this.schema, id)?.icon ?? 'circle';
	}

	/** A short hint beside a property in pickers ("4 options", "Species & peoples"). */
	private propHint(id: string): string | undefined {
		const f = this.schema.fields.find((x) => x.id === id);
		if (!f) return undefined;
		if (f.type === 'select' || f.type === 'multiselect') {
			const n = selectOptions(f).length;
			return n ? `${n} option${n === 1 ? '' : 's'}` : undefined;
		}
		if (f.type === 'relation') {
			const target = (f.config as { targetTypes?: string[] } | undefined)?.targetTypes?.[0];
			return target ? this.s.schemas.get(target)?.plural : undefined;
		}
		return undefined;
	}

	private groupMenu(anchor: HTMLElement): void {
		this.togglePop(anchor, () => {
			const view = this.view;
			return openPropertyPicker(anchor, {
				title: 'Group by',
				placeholder: 'Find a property…',
				selected: view.groupBy,
				none: { label: 'No groups', icon: 'list' },
				items: groupableProps(this.schema).map((p) => ({ id: p.id, label: p.label, group: p.group, icon: this.propIcon(p.id), hint: this.propHint(p.id) })),
				onPick: (id) => this.update({ groupBy: id, collapsed: [] }),
				footer: view.groupBy && view.collapsed.length ? [{ label: 'Open every group', icon: 'unfold-vertical', run: () => this.update({ collapsed: [] }) }] : undefined,
			});
		});
	}

	private boardMenu(anchor: HTMLElement): void {
		this.togglePop(anchor, () => {
			const view = this.view;
			return openPropertyPicker(anchor, {
				title: 'A column for each',
				selected: view.board.field,
				items: boardProps(this.schema).map((p) => ({ id: p.id, label: p.label, icon: this.propIcon(p.id), hint: this.propHint(p.id) })),
				onPick: (id) => id && this.update({ board: { ...view.board, field: id } }),
			});
		});
	}

	/** Active filters and sorts as chips under the toolbar. */
	private drawChips(): void {
		const el = this.chipsEl;
		el.empty();
		const view = this.view;
		const lostGroup = !!view.groupBy && !this.groupOk();
		el.toggleClass('is-empty', !view.conditions.length && !view.sorts.length && !view.showArchived && !lostGroup);
		if (el.hasClass('is-empty')) return;
		if (lostGroup && this.kind !== 'board') {
			const chip = el.createDiv({ cls: 'ws-vchip is-broken' });
			icon(chip, 'alert-triangle', 'ws-vchip__icon');
			chip.createSpan({ cls: 'ws-vchip__text', text: 'Grouped by a field that’s gone — showing no groups' });
			const x = chip.createEl('button', { cls: 'ws-vchip__x', attr: { type: 'button', 'aria-label': 'Stop grouping' } });
			setIcon(x, 'x');
			x.addEventListener('click', () => this.update({ groupBy: null, collapsed: [] }));
		}
		if (view.conditions.length > 1) el.createSpan({ cls: 'ws-vchips__match', text: view.match === 'any' ? 'Any of:' : 'All of:' });
		const broken = new Set(brokenConditions(this.schema, view).map((c) => c.id));
		for (const c of view.conditions) {
			const d = describeCondition(this.schema, c);
			const chip = el.createDiv({ cls: cx('ws-vchip', broken.has(c.id) && 'is-broken'), attr: { 'data-condition': c.id } });
			icon(chip, broken.has(c.id) ? 'alert-triangle' : 'filter', 'ws-vchip__icon');
			const t = chip.createEl('button', { cls: 'ws-vchip__text', attr: { type: 'button' }, text: d.text });
			t.addEventListener('click', () => this.openFilters(this.barEl.querySelector('.ws-vbar__filter') as HTMLElement, { focus: c.id }));
			const x = chip.createEl('button', { cls: 'ws-vchip__x', attr: { type: 'button', 'aria-label': `Remove filter: ${d.text}` } });
			setIcon(x, 'x');
			x.addEventListener('click', () => this.update({ conditions: view.conditions.filter((y) => y.id !== c.id) }));
		}
		if (view.showArchived) {
			const chip = el.createDiv({ cls: 'ws-vchip' });
			icon(chip, 'archive', 'ws-vchip__icon');
			chip.createSpan({ cls: 'ws-vchip__text', text: 'Including archived' });
			const x = chip.createEl('button', { cls: 'ws-vchip__x', attr: { type: 'button', 'aria-label': 'Hide archived' } });
			setIcon(x, 'x');
			x.addEventListener('click', () => this.update({ showArchived: false }));
		}
		if (view.conditions.length) {
			const add = el.createEl('button', { cls: 'ws-vchips__add', attr: { type: 'button' } });
			icon(add, 'plus');
			add.createSpan({ text: 'Filter' });
			add.addEventListener('click', () => this.openFilters(this.barEl.querySelector('.ws-vbar__filter') as HTMLElement));
		}
		if (view.sorts.length) {
			const sortEl = el.createDiv({ cls: 'ws-vchips__sort' });
			icon(sortEl, 'arrow-up-down', 'ws-vchip__icon');
			const words = view.sorts.map((x, i) => `${i ? 'then ' : ''}${propInfo(this.schema, x.field)?.label ?? 'a removed field'} ${x.dir === naturalDir(x.field) ? '' : x.dir === 'asc' ? '↑' : '↓'}`.trim());
			const b = sortEl.createEl('button', { cls: 'ws-vchip__text', attr: { type: 'button' }, text: `Sorted by ${words.join(', ')}` });
			b.addEventListener('click', () => (this.barEl.querySelector('.ws-vbar__sort'))?.click());
		}
	}

	/** Whether the view's group-by still names something that can group (a field may be gone). */
	private groupOk(): boolean {
		const g = this.view.groupBy;
		return !!g && groupableProps(this.schema, { includeLists: true }).some((p) => p.id === g);
	}

	private defaults(): { columns: ViewColumn[]; card: string[] } {
		const card = cardFieldsOf(this.schema, this.ctx.ws.fieldTypes).map((f) => f.id);
		return { columns: [{ id: '__status' }, ...card.map((id) => ({ id })), { id: '__progress' }, { id: '__updated' }], card };
	}

	// ── results ──────────────────────────────────────────────────────────────

	private refresh(): void {
		if (this.dead) return;
		this.closeCellEdit();
		this.pendingRefresh = false;
		const view = this.view;
		const { s, schema } = this;
		const scroller = this.page.closest('.ws-shell__page');
		const scroll = scroller?.scrollTop ?? 0;
		const list = runView(s, view, this.search);
		const total = s.index.countOfType(schema.id);
		this.countEl.setText(list.length === total ? pluralize(total, 'entry', 'entries') : `${list.length.toLocaleString()} of ${pluralize(total, 'entry', 'entries')}`);
		for (const o of this.observers.splice(0)) o.disconnect();
		this.results.empty();
		this.results.className = cx('ws-db-results', `ws-db-results--${this.kind}`, `ws-vsize--${view.card.size}`).join(' ');

		if (!list.length && this.kind !== 'board') {
			if (total === 0 && !this.search) {
				// Two ways to start (0.21): a new entry, or a note you already have.
				const empty = emptyState(this.results, {
					icon: schema.icon,
					title: `No ${schema.plural.toLowerCase()} yet`,
					body: `${schema.description ? `${schema.description} ` : ''}Create one, or turn a note you already have into one: drag notes here from the file explorer, or choose Add existing note. Your notes stay as they are.`,
					actionLabel: `Create ${schema.singular.toLowerCase()}`,
					onAction: () => openCreateEntity(this.ctx.ws, { typeId: schema.id }),
				});
				const actions = empty.querySelector('.ws-btn')?.parentElement;
				if (actions) button(actions, { label: 'Add existing note', icon: 'file-input', variant: 'ghost', size: 'sm', cls: 'ws-db-empty-adopt', onClick: () => new NotePickerModal(this.ctx.ws.app, (f) => this.adopt([f])).open() });
			} else {
				const filtered = view.conditions.length > 0;
				emptyState(this.results, {
					icon: 'search-x',
					title: this.search ? `Nothing matches “${this.search}”` : 'No entries match this view’s filters',
					body: filtered ? 'Change or remove a filter to see more.' : 'Try a different search.',
					actionLabel: filtered ? 'Clear filters' : undefined,
					actionIcon: 'filter-x',
					onAction: filtered ? () => this.update({ conditions: [] }) : undefined,
					compact: true,
				});
			}
			return;
		}
		if (this.kind === 'board') this.renderBoard(list);
		else if (this.kind === 'progress') this.renderProgress(list);
		else if (this.groupOk() && !this.search) this.renderGroups(list);
		else this.renderFlat(this.results, list, true);
		if (scroller) scroller.scrollTop = scroll;
	}

	private cardFields(): FieldDefinition[] {
		const ids = this.view.card.fields;
		if (!ids) return cardFieldsOf(this.schema, this.ctx.ws.fieldTypes);
		return ids.map((id) => this.schema.fields.find((f) => f.id === id)).filter((f): f is FieldDefinition => !!f);
	}

	private columns(): Array<{ id: string; label: string; width?: number; field?: FieldDefinition }> {
		const cols = this.view.columns ?? this.defaults().columns;
		return cols
			.map((c) => {
				const label = columnLabel(this.schema, c.id);
				const field = this.schema.fields.find((f) => f.id === c.id);
				return label ? { id: c.id, label, width: c.width, field } : null;
			})
			.filter((c): c is NonNullable<typeof c> => !!c);
	}

	/** One container of items; `lazy` draws them in batches as you scroll. */
	private renderFlat(parent: HTMLElement, list: EntityRecord[], lazy: boolean, groupKey?: string): void {
		const kind = this.kind;
		const container = kind === 'table' ? this.tableShell(parent) : parent.createDiv({ cls: `ws-${kind === 'list' ? 'list' : kind === 'gallery' ? 'vgallery' : 'cards'}` });
		let shown = 0;
		const limit = lazy ? BATCH : groupKey && !this.shownGroups.has(groupKey) ? GROUP_PREVIEW : list.length;
		if (lazy) this.lazyShown = Math.max(this.lazyShown, BATCH);
		const more = () => {
			const next = list.slice(shown, shown + (lazy ? (shown ? BATCH : this.lazyShown) : limit));
			for (const e of next) this.renderItem(container, e);
			shown += next.length;
			if (lazy) this.lazyShown = Math.max(this.lazyShown, shown);
			if (shown >= list.length) return;
			if (lazy) {
				const sentinel = parent.createDiv({ cls: 'ws-db-sentinel', text: 'Loading more…' });
				const io = new IntersectionObserver((entries) => {
					if (entries.some((x) => x.isIntersecting)) {
						io.disconnect();
						sentinel.remove();
						more();
					}
				}, { rootMargin: '0px 0px 800px 0px' }); // start drawing before the end is reached
				io.observe(sentinel);
				this.observers.push(io);
			} else if (groupKey) {
				const btn = parent.createEl('button', { cls: 'ws-vgroup__more', attr: { type: 'button' }, text: `Show all ${list.length.toLocaleString()}` });
				btn.addEventListener('click', () => {
					this.shownGroups.add(groupKey);
					this.refresh();
				});
			}
		};
		more();
	}

	private renderGroups(list: EntityRecord[]): void {
		const view = this.view;
		const groups = groupView(this.s, this.schema, list, view.groupBy!);
		const collapsed = new Set(view.collapsed);
		if (this.kind === 'table') {
			// One table, so columns line up across groups; group headings are full-width rows.
			const tbody = this.tableShell(this.results);
			const span = this.columns().length + 1;
			for (const g of groups) {
				const open = !collapsed.has(g.key);
				const tr = tbody.createEl('tr', { cls: cx('ws-vgroup-row', !open && 'is-collapsed') });
				this.groupHead(tr.createEl('td', { attr: { colspan: String(span) } }), g, open);
				if (!open) continue;
				const rows = this.shownGroups.has(g.key) ? g.entries : g.entries.slice(0, GROUP_PREVIEW);
				for (const e of rows) this.row(tbody, e);
				if (rows.length < g.entries.length) {
					const td = tbody.createEl('tr', { cls: 'ws-vgroup-more' }).createEl('td', { attr: { colspan: String(span) } });
					const btn = td.createEl('button', { cls: 'ws-vgroup__more', attr: { type: 'button' }, text: `Show all ${g.entries.length.toLocaleString()}` });
					btn.addEventListener('click', () => {
						this.shownGroups.add(g.key);
						this.refresh();
					});
				}
			}
			return;
		}
		for (const g of groups) {
			const open = !collapsed.has(g.key);
			const sec = this.results.createDiv({ cls: cx('ws-vgroup', !open && 'is-collapsed'), attr: { 'data-group': g.key } });
			this.groupHead(sec.createDiv({ cls: 'ws-vgroup__headwrap' }), g, open);
			if (open) this.renderFlat(sec, g.entries, false, g.key);
		}
	}

	private groupHead(parent: HTMLElement, g: Group, open: boolean): void {
		const head = parent.createEl('button', { cls: 'ws-vgroup__head', attr: { type: 'button', 'aria-expanded': String(open) } });
		const caret = head.createSpan({ cls: 'ws-vgroup__caret' });
		setIcon(caret, 'chevron-down');
		if (g.color) head.createSpan({ cls: cx('ws-vgroup__dot', `ws-tint--${g.color}`) });
		head.createSpan({ cls: cx('ws-vgroup__label', g.key === '__none' && 'is-none'), text: g.label });
		head.createSpan({ cls: 'ws-vgroup__count', text: g.entries.length.toLocaleString() });
		head.addEventListener('click', () => {
			const cur = new Set(this.view.collapsed);
			if (cur.has(g.key)) cur.delete(g.key);
			else cur.add(g.key);
			this.update({ collapsed: [...cur] });
		});
	}

	private renderItem(container: HTMLElement, e: EntityRecord): void {
		const kind = this.kind;
		if (kind === 'cards') this.card(container, e);
		else if (kind === 'gallery') this.tile(container, e);
		else if (kind === 'table') this.row(container, e);
		else this.listRow(container, e);
	}

	private wire(el: HTMLElement, e: EntityRecord): void {
		el.tabIndex = 0;
		el.setAttr('role', 'link');
		el.setAttr('data-entity', e.id);
		const open = (evt: MouseEvent | KeyboardEvent) => this.ctx.navigate(ROUTES.entity(e.id), Keymap.isModEvent(evt) ? 'tab' : false);
		el.addEventListener('click', (evt) => {
			if ((evt.target as HTMLElement).closest('button, a, .ws-cell--edit')) return;
			open(evt);
		});
		el.addEventListener('keydown', (evt) => {
			if (evt.key === 'Enter' && evt.target === el) open(evt);
		});
		el.addEventListener('contextmenu', (evt) => {
			evt.preventDefault();
			const fresh = this.s.entities.get(e.id);
			if (fresh) entityMenu(this.ctx.ws, fresh).showAtMouseEvent(evt);
		});
	}

	private card(container: HTMLElement, e: EntityRecord): void {
		const view = this.view;
		const card = renderEntityCard(container, {
			app: this.ctx.ws.app,
			session: this.s,
			fieldTypes: this.ctx.ws.fieldTypes,
			schema: this.schema,
			entity: e,
			cardImage: view.card.image,
			fields: view.card.fields ? this.cardFields() : undefined,
		});
		this.wire(card, e);
	}

	/** Gallery: the image is the tile; name and a few facts underneath. */
	private tile(container: HTMLElement, e: EntityRecord): void {
		const { s, schema } = this;
		const view = this.view;
		const t = container.createDiv({ cls: cx('ws-vtile', schema.color && `ws-tint--${schema.color}`) });
		const media = t.createDiv({ cls: 'ws-vtile__media' });
		const ref = view.card.image === 'banner' ? (e.media.banner ?? e.media.portrait) : view.card.image === 'portrait' ? (e.media.portrait ?? e.media.banner ?? e.media.gallery[0]) : null;
		if (ref) vaultImage(media, this.ctx.ws.app, ref, 'ws-vtile__img');
		else {
			media.addClass('is-empty');
			icon(media, e.media.icon || schema.icon, 'ws-vtile__glyph');
		}
		if (e.flags.favorite) {
			const star = t.createSpan({ cls: 'ws-vtile__fav', attr: { 'aria-label': 'Favorite' } });
			setIcon(star, 'star');
		}
		const body = t.createDiv({ cls: 'ws-vtile__body' });
		body.createDiv({ cls: 'ws-vtile__name', text: e.name });
		const sub = subtitleFor(e, schema, this.ctx.ws.fieldTypes, s.values);
		if (sub) body.createDiv({ cls: 'ws-vtile__sub', text: sub });
		// Facts already in the subtitle aren't repeated underneath.
		const facts = (view.card.fields ? this.cardFields() : []).filter((f) => !schema.display.subtitleFields.includes(f.id));
		for (const f of facts.slice(0, 4)) {
			const v = s.values.text(e, f);
			if (!v) continue;
			const row = body.createDiv({ cls: 'ws-vtile__fact' });
			row.createSpan({ cls: 'ws-vtile__fact-label', text: f.label });
			row.createSpan({ cls: 'ws-vtile__fact-value', text: v });
		}
		this.wire(t, e);
	}

	private tableShell(parent: HTMLElement): HTMLElement {
		const view = this.view;
		const wrap = parent.createDiv({ cls: 'ws-table-wrap ws-vtable-wrap' });
		const table = wrap.createEl('table', { cls: 'ws-table ws-vtable' });
		const cols = [{ id: '__name', label: 'Name', width: view.columns?.find((c) => c.id === '__name')?.width }, ...this.columns()];
		// Once any column has been resized, every column has a width ("fixed" table) so
		// widening one never squeezes the others; the table scrolls sideways instead.
		const fixed = cols.some((c) => c.width);
		const colgroup = table.createEl('colgroup');
		for (const c of cols) {
			const col = colgroup.createEl('col', { attr: { 'data-col': c.id } });
			if (fixed) col.style.width = `${c.width ?? (c.id === '__name' ? 220 : 150)}px`;
		}
		if (fixed) this.fixTable(table);
		const head = table.createEl('thead').createEl('tr');
		for (const c of cols) {
			const th = head.createEl('th', { attr: { scope: 'col', 'data-col': c.id } });
			const b = th.createEl('button', { cls: 'ws-table__sort', attr: { type: 'button' } });
			b.createSpan({ text: c.label });
			const first = view.sorts[0];
			if (first?.field === c.id) {
				th.setAttr('aria-sort', first.dir === 'asc' ? 'ascending' : 'descending');
				icon(b, first.dir === 'asc' ? 'arrow-up' : 'arrow-down', 'ws-table__sort-icon');
			}
			const sortable = c.id !== '__tags';
			b.addEventListener('click', () => {
				if (!sortable) return;
				const cur = this.view.sorts[0];
				const dir = cur?.field === c.id ? (cur.dir === 'asc' ? 'desc' : 'asc') : naturalDir(c.id);
				this.update({ sorts: [{ field: c.id, dir }, ...this.view.sorts.filter((x) => x.field !== c.id)].slice(0, 3) });
			});
			th.addEventListener('contextmenu', (evt) => {
				evt.preventDefault();
				this.columnMenu(evt, c.id, th);
			});
			// Drag the right edge to resize; the widths are saved with the view.
			const grip = th.createDiv({ cls: 'ws-vtable__grip', attr: { role: 'separator', 'aria-label': `Resize ${c.label}`, 'aria-orientation': 'vertical' } });
			grip.addEventListener('pointerdown', (evt) => this.startResize(evt, table, c.id));
			grip.addEventListener('click', (evt) => evt.stopPropagation());
		}
		return table.createEl('tbody');
	}

	/** Fixed layout: the table is exactly as wide as its columns (at least the pane). */
	private fixTable(table: HTMLElement): void {
		table.addClass('is-fixed');
		const sum = [...table.querySelectorAll<HTMLElement>('col')].reduce((a, c) => a + (Number.parseFloat(c.style.width) || 0), 0);
		table.style.width = `${Math.round(sum)}px`;
	}

	private startResize(evt: PointerEvent, table: HTMLElement, id: string): void {
		evt.preventDefault();
		evt.stopPropagation();
		const grip = evt.currentTarget as HTMLElement;
		const th = grip.closest('th') as HTMLElement;
		const cols = [...table.querySelectorAll<HTMLElement>('col')];
		const col = cols.find((c) => c.dataset.col === id);
		if (!col) return;
		// First resize: freeze every column at its current width.
		if (!table.hasClass('is-fixed')) {
			const ths = [...table.querySelectorAll<HTMLElement>('thead th')];
			ths.forEach((h, i) => cols[i] && (cols[i].style.width = `${Math.round(h.getBoundingClientRect().width)}px`));
			this.fixTable(table);
		}
		const startX = evt.clientX;
		const startW = Number.parseFloat(col.style.width) || th.getBoundingClientRect().width;
		grip.setPointerCapture?.(evt.pointerId);
		th.addClass('is-resizing');
		const move = (e: PointerEvent) => {
			col.style.width = `${Math.max(60, Math.min(900, Math.round(startW + e.clientX - startX)))}px`;
			this.fixTable(table);
		};
		const up = () => {
			grip.removeEventListener('pointermove', move);
			grip.removeEventListener('pointerup', up);
			grip.removeEventListener('pointercancel', up);
			th.removeClass('is-resizing');
			const widths = new Map(cols.map((c) => [c.dataset.col as string, Math.round(Number.parseFloat(c.style.width) || 0)]));
			const shown = this.view.columns ?? this.defaults().columns;
			const next = [{ id: '__name', width: widths.get('__name') }, ...shown.filter((c) => c.id !== '__name').map((c) => ({ id: c.id, width: widths.get(c.id) ?? c.width }))].map((c) => (c.width ? c : { id: c.id }));
			this.update({ columns: next }, { results: false });
		};
		grip.addEventListener('pointermove', move);
		grip.addEventListener('pointerup', up);
		grip.addEventListener('pointercancel', up);
	}

	private columnMenu(evt: MouseEvent, id: string, th: HTMLElement): void {
		const view = this.view;
		// The name column (which may carry a width) stays first; moves are among the others.
		const all = view.columns ?? this.defaults().columns;
		const nameCol = all.filter((c) => c.id === '__name');
		const cols = all.filter((c) => c.id !== '__name');
		const keepName = (next: ViewColumn[]) => [...nameCol, ...next];
		const at = cols.findIndex((c) => c.id === id);
		const m = new Menu();
		if (id !== '__tags') {
			m.addItem((it) => it.setTitle('Sort ascending').setIcon('arrow-up').onClick(() => this.update({ sorts: [{ field: id, dir: 'asc' }] })));
			m.addItem((it) => it.setTitle('Sort descending').setIcon('arrow-down').onClick(() => this.update({ sorts: [{ field: id, dir: 'desc' }] })));
		}
		if (id !== '__name') {
			m.addItem((it) => it.setTitle('Filter by this…').setIcon('filter').onClick(() => this.openFilters(this.barEl.querySelector('.ws-vbar__filter') as HTMLElement, { addField: id })));
			if (groupableProps(this.schema).some((p) => p.id === id)) m.addItem((it) => it.setTitle('Group by this').setIcon('rows-3').onClick(() => this.update({ groupBy: id, collapsed: [] })));
			m.addSeparator();
			if (at > 0) m.addItem((it) => it.setTitle('Move left').setIcon('arrow-left').onClick(() => this.update({ columns: keepName(swap(cols, at, at - 1)) })));
			if (at >= 0 && at < cols.length - 1) m.addItem((it) => it.setTitle('Move right').setIcon('arrow-right').onClick(() => this.update({ columns: keepName(swap(cols, at, at + 1)) })));
			m.addItem((it) => it.setTitle('Hide column').setIcon('eye-off').onClick(() => this.update({ columns: keepName(cols.filter((c) => c.id !== id)) })));
		}
		if (all.some((c) => c.width)) m.addItem((it) => it.setTitle('Reset column widths').setIcon('move-horizontal').onClick(() => this.update({ columns: cols.map(({ width: _w, ...c }) => c) })));
		showMenuAt(m, evt, th);
	}

	private row(tbody: HTMLElement, e: EntityRecord): void {
		const { s, schema } = this;
		const tr = tbody.createEl('tr', { cls: 'ws-table__row' });
		this.wire(tr, e);
		const nameCell = tr.createEl('td').createDiv({ cls: 'ws-table__name' });
		avatar(nameCell, this.ctx.ws.app, e, schema, { size: 'xs' });
		nameCell.createSpan({ text: e.name });
		for (const c of this.columns()) {
			const td = tr.createEl('td', { attr: { 'data-col': c.id } });
			switch (c.id) {
				case '__status': {
					statusPill(td, s.world.statuses.find((x) => x.id === e.status));
					this.editable(td, `Status of ${e.name}`, (evt) => this.statusMenu(evt, e, td));
					break;
				}
				case '__tags':
					if (e.tags.length) td.setText(e.tags.map((t) => `#${t}`).join(' '));
					else td.createSpan({ cls: 'ws-field-display is-empty', text: '—' });
					break;
				case '__progress': {
					const r = s.entityService.progress(e).ratio;
					td.addClass('ws-table__num');
					const barEl = td.createDiv({ cls: 'ws-bar ws-bar--thin ws-bar--inline' });
					barEl.createDiv({ cls: 'ws-bar__fill' }).style.width = `${Math.round(r * 100)}%`;
					td.createSpan({ text: `${Math.round(r * 100)}%` });
					break;
				}
				case '__connections':
					td.addClass('ws-table__num');
					td.setText(String(s.relations.count(e.id)));
					break;
				case '__created':
				case '__updated':
					td.addClass('ws-table__muted');
					td.setText(relativeTime(c.id === '__created' ? e.createdAt : e.updatedAt));
					break;
				default: {
					const f = c.field;
					if (!f) break;
					const type = this.ctx.ws.fieldTypes.for(f);
					const v = s.values.get(e, f);
					if (type.ui && !type.isEmpty(v)) type.ui.renderDisplay(td, v, { app: this.ctx.ws.app, field: f, entity: e, component: this.ctx.component, host: this.host() });
					else td.createSpan({ cls: 'ws-field-display is-empty', text: '—' });
					// Edit in place (except derived kinds, which are shown, not stored).
					if (type.ui && !type.computed) this.editable(td, `${f.label} of ${e.name}`, () => this.editCell(td, e, f));
				}
			}
		}
	}

	private host() {
		return { ws: this.ctx.ws, session: this.s, navigate: this.ctx.navigate };
	}

	/** A table cell you can edit: click it, or focus it and press Enter / F2. */
	private editable(td: HTMLElement, label: string, open: (evt: MouseEvent | KeyboardEvent) => void): void {
		td.addClass('ws-cell--edit');
		td.tabIndex = 0;
		td.setAttr('aria-label', `Edit ${label}`);
		td.addEventListener('click', (evt) => {
			if ((evt.target as HTMLElement).closest('a')) return;
			evt.stopPropagation();
			open(evt);
		});
		td.addEventListener('keydown', (evt) => {
			if (evt.key !== 'Enter' && evt.key !== 'F2') return;
			evt.preventDefault();
			evt.stopPropagation();
			open(evt);
		});
	}

	private statusMenu(evt: MouseEvent | KeyboardEvent, e: EntityRecord, td: HTMLElement): void {
		const m = new Menu();
		for (const st of this.s.world.statuses) m.addItem((it) => it.setTitle(st.label).setChecked(e.status === st.id).onClick(() => this.s.entityService.update(e.id, { status: st.id })));
		showMenuAt(m, evt, td);
	}

	/**
	 * A field's own editor in a small panel over the cell; changes save as you type. While it's
	 * open, live refreshes wait (the table would otherwise redraw under it); closing it catches up.
	 */
	private editCell(td: HTMLElement, e: EntityRecord, f: FieldDefinition): void {
		this.pop?.close();
		this.closeCellEdit();
		const type = this.ctx.ws.fieldTypes.for(f);
		if (!type.ui) return;
		// The editor's own lifecycle (flush on close, child renderers) lives and dies with the panel.
		const comp = new Component();
		this.ctx.component.addChild(comp);
		let handle: { destroy?(): void } | null = null;
		const pop = new Popover(td, {
			cls: 'ws-cell-pop',
			width: Math.max(260, Math.min(420, td.getBoundingClientRect().width + 40)),
			label: `${f.label} — ${e.name}`,
			onClose: () => {
				handle?.destroy?.();
				this.ctx.component.removeChild(comp); // unloads: pending text is saved here
				if (this.cellPop === pop) this.cellPop = null;
				if (td.isConnected && td.ownerDocument.activeElement === td.ownerDocument.body) td.focus();
				if (this.pendingRefresh && !this.dead) window.setTimeout(() => this.refresh(), 0);
			},
		});
		this.cellPop = pop;
		pop.el.createDiv({ cls: 'ws-cell-pop__label', text: `${f.label} · ${e.name}` });
		const host = pop.el.createDiv({ cls: 'ws-cell-pop__editor ws-prop__value' });
		const msg = pop.el.createDiv({ cls: 'ws-cell-pop__msg', attr: { role: 'status' } });
		const fresh = this.s.entities.get(e.id) ?? e;
		const h = type.ui.createEditor(host, {
			app: this.ctx.ws.app,
			field: f,
			entity: fresh,
			component: comp,
			host: this.host(),
			value: this.s.values.get(fresh, f),
			onChange: (v) => {
				const res = this.s.entityService.setFieldValue(e.id, f.id, v);
				pop.el.toggleClass('is-invalid', !res.ok);
				msg.setText(res.error ?? res.warning ?? '');
				pop.position();
			},
		});
		handle = h;
		window.setTimeout(() => h.focus(), 30);
		pop.position();
	}

	private closeCellEdit(): void {
		this.cellPop?.close();
		this.cellPop = null;
	}

	private listRow(container: HTMLElement, e: EntityRecord): void {
		const { s, schema } = this;
		const row = container.createDiv({ cls: 'ws-list-row' });
		this.wire(row, e);
		avatar(row, this.ctx.ws.app, e, schema, { size: 'sm' });
		const t = row.createDiv({ cls: 'ws-list-row__text' });
		t.createDiv({ cls: 'ws-list-row__name', text: e.name });
		const fields = this.view.card.fields ? this.cardFields() : null;
		const sub = fields
			? fields
					.map((f) => s.values.text(e, f))
					.filter(Boolean)
					.join(' • ')
			: s.entityService.subtitle(e) || e.description.split('\n')[0] || '';
		if (sub) t.createDiv({ cls: 'ws-list-row__sub', text: sub });
		statusPill(row, s.world.statuses.find((x) => x.id === e.status));
		row.createDiv({ cls: 'ws-list-row__time', text: relativeTime(e.updatedAt) });
	}

	// ── progress ─────────────────────────────────────────────────────────────

	private renderProgress(list: EntityRecord[]): void {
		const view = this.view;
		const grouped = this.groupOk() && !this.search;
		const facts = view.card.fields ? this.cardFields() : null;
		renderProgressView(this.results, {
			s: this.s,
			schema: this.schema,
			host: this.host(),
			entries: list,
			groups: grouped ? groupView(this.s, this.schema, list, view.groupBy!) : null,
			collapsed: new Set(view.collapsed),
			autoOrder: !view.sorts.length && !this.search,
			facts: (e) =>
				facts
					? facts
							.map((f) => this.s.values.text(e, f))
							.filter(Boolean)
							.join(' • ')
					: this.s.entityService.subtitle(e),
			wire: (el, e) => this.wire(el, e),
			toggleGroup: (key) => {
				const cur = new Set(this.view.collapsed);
				if (cur.has(key)) cur.delete(key);
				else cur.add(key);
				this.update({ collapsed: [...cur] });
			},
			openEntity: (e, evt) => this.ctx.navigate(ROUTES.entity(e.id), Keymap.isModEvent(evt) ? 'tab' : false),
		});
	}

	// ── board ────────────────────────────────────────────────────────────────

	private renderBoard(list: EntityRecord[]): void {
		const { s, schema } = this;
		const view = this.view;
		const field = view.board.field;
		const fieldDef = schema.fields.find((f) => f.id === field);
		if (field !== '__status' && fieldDef?.type !== 'select') {
			emptyState(this.results, { icon: 'square-kanban', title: 'Choose what the columns are', body: 'A board needs Status or a single-choice field. Pick one with “Columns”.', compact: true });
			return;
		}
		const groups = groupView(s, schema, list, field, { allOptions: true });
		if (field !== '__status' && !groups.some((g) => g.key === '__none')) groups.push({ key: '__none', label: 'Not set', color: null, entries: [] });
		const board = this.results.createDiv({ cls: 'ws-board' });
		let dragging: string | null = null;
		for (const g of groups) {
			const col = board.createDiv({ cls: cx('ws-board__col', g.color && `ws-tint--${g.color}`), attr: { 'data-group': g.key } });
			const head = col.createDiv({ cls: 'ws-board__head' });
			head.createSpan({ cls: 'ws-board__dot' });
			head.createSpan({ cls: 'ws-board__label', text: g.label });
			head.createSpan({ cls: 'ws-board__count', text: String(g.entries.length) });
			const add = head.createEl('button', { cls: 'ws-board__add clickable-icon', attr: { type: 'button', 'aria-label': `New ${schema.singular.toLowerCase()} in ${g.label}` } });
			setIcon(add, 'plus');
			add.addEventListener('click', () => void this.createIn(field, g.key));
			const body = col.createDiv({ cls: 'ws-board__body' });
			const shown = this.shownGroups.has(g.key) ? g.entries : g.entries.slice(0, GROUP_PREVIEW);
			for (const e of shown) {
				const card = this.boardCard(body, e);
				card.draggable = true;
				card.addEventListener('dragstart', (evt) => {
					dragging = e.id;
					evt.dataTransfer?.setData('text/plain', e.id);
					if (evt.dataTransfer) evt.dataTransfer.effectAllowed = 'move';
					card.addClass('is-dragging');
				});
				card.addEventListener('dragend', () => {
					dragging = null;
					card.removeClass('is-dragging');
					board.querySelectorAll('.is-drop').forEach((x) => x.removeClass('is-drop'));
				});
			}
			if (shown.length < g.entries.length) {
				const more = body.createEl('button', { cls: 'ws-vgroup__more', attr: { type: 'button' }, text: `Show all ${g.entries.length}` });
				more.addEventListener('click', () => {
					this.shownGroups.add(g.key);
					this.refresh();
				});
			}
			if (!g.entries.length) body.createDiv({ cls: 'ws-board__empty', text: 'Drop here' });
			col.addEventListener('dragover', (evt) => {
				if (!dragging) return;
				evt.preventDefault();
				if (evt.dataTransfer) evt.dataTransfer.dropEffect = 'move';
				col.addClass('is-drop');
			});
			col.addEventListener('dragleave', (evt) => {
				if (!col.contains(evt.relatedTarget as Node)) col.removeClass('is-drop');
			});
			col.addEventListener('drop', (evt) => {
				evt.preventDefault();
				col.removeClass('is-drop');
				const id = evt.dataTransfer?.getData('text/plain') || dragging;
				if (id) this.moveTo(id, field, g.key);
			});
		}
	}

	private boardCard(parent: HTMLElement, e: EntityRecord): HTMLElement {
		const { s, schema } = this;
		const view = this.view;
		const card = parent.createDiv({ cls: 'ws-bcard' });
		if (view.card.image === 'banner' && e.media.banner) vaultImage(card.createDiv({ cls: 'ws-bcard__banner' }), this.ctx.ws.app, e.media.banner, 'ws-bcard__img');
		const top = card.createDiv({ cls: 'ws-bcard__top' });
		if (view.card.image !== 'none') avatar(top, this.ctx.ws.app, e, schema, { size: 'sm' });
		const t = top.createDiv({ cls: 'ws-bcard__text' });
		t.createDiv({ cls: 'ws-bcard__name', text: e.name });
		const sub = subtitleFor(e, schema, this.ctx.ws.fieldTypes, s.values);
		if (sub) t.createDiv({ cls: 'ws-bcard__sub', text: sub });
		const facts = (view.card.fields ? this.cardFields() : []).filter((f) => !schema.display.subtitleFields.includes(f.id)).slice(0, 4);
		for (const f of facts) {
			const v = s.values.text(e, f);
			if (!v) continue;
			const row = card.createDiv({ cls: 'ws-bcard__fact' });
			row.createSpan({ cls: 'ws-bcard__fact-label', text: f.label });
			row.createSpan({ cls: 'ws-bcard__fact-value', text: v });
		}
		const more = card.createEl('button', { cls: 'ws-bcard__more clickable-icon', attr: { type: 'button', 'aria-label': `Move ${e.name}` } });
		setIcon(more, 'more-horizontal');
		more.addEventListener('click', (evt) => this.moveMenu(evt, e, more));
		this.wire(card, e);
		return card;
	}

	/** The keyboard / touch alternative to dragging between columns. */
	private moveMenu(evt: MouseEvent, e: EntityRecord, anchor: HTMLElement): void {
		evt.stopPropagation();
		const view = this.view;
		const groups = groupView(this.s, this.schema, [], view.board.field, { allOptions: true });
		const m = new Menu();
		m.addItem((it) => it.setTitle('Move to').setIsLabel(true));
		for (const g of groups) m.addItem((it) => it.setTitle(g.label).onClick(() => this.moveTo(e.id, view.board.field, g.key)));
		if (view.board.field !== '__status') m.addItem((it) => it.setTitle('Not set').onClick(() => this.moveTo(e.id, view.board.field, '__none')));
		m.addSeparator();
		m.addItem((it) => it.setTitle('Open').setIcon('arrow-up-right').onClick(() => this.ctx.navigate(ROUTES.entity(e.id))));
		showMenuAt(m, evt, anchor);
	}

	private moveTo(entityId: string, field: string, key: string): void {
		const e = this.s.entities.get(entityId);
		if (!e) return;
		if (field === '__status') {
			if (e.status !== key) this.s.entityService.update(entityId, { status: key });
			return;
		}
		const value = key === '__none' ? null : key;
		const f = this.schema.fields.find((x) => x.id === field);
		if (!f) return;
		const r = this.s.entityService.setFieldValue(entityId, field, value);
		if (r && typeof r === 'object' && 'ok' in r && !(r as { ok: boolean }).ok) new Notice(`Couldn’t move ${e.name}.`);
	}

	private async createIn(field: string, key: string): Promise<void> {
		const name = await promptModal(this.ctx.ws.app, { title: `New ${this.schema.singular.toLowerCase()}`, label: 'Name', confirmLabel: 'Create' });
		if (!name?.trim()) return;
		const e = this.s.entityService.create(this.schema.id, { name: name.trim() });
		this.moveTo(e.id, field, key);
	}

	// ── live updates ─────────────────────────────────────────────────────────

	private listen(): void {
		const { s, schema } = this;
		const c = this.ctx.component;
		const live = debounce(() => {
			// Not under an open cell editor: catch up when it closes.
			if (this.cellPop) this.pendingRefresh = true;
			else this.refresh();
		}, 120);
		const mine = (e: EntityRecord) => e.typeId === schema.id;
		own(c, s.events.on('entity:created', ({ entity }) => mine(entity) && live()));
		own(c, s.events.on('entity:deleted', ({ entity }) => mine(entity) && live()));
		own(c, s.events.on('entity:updated', ({ entity }) => mine(entity) && live()));
		// Connection counts, linked names and rollups change when this type's connections do —
		// only worth redrawing when the view shows or uses them.
		const touches = (from: string, to: string) => [from, to].some((id) => s.entities.get(id)?.typeId === schema.id);
		for (const ev of ['edge:created', 'edge:updated', 'edge:deleted'] as const) own(c, s.events.on(ev, ({ edge }) => this.usesLinks() && touches(edge.from, edge.to) && live()));
		// Development counts checklist tasks; the progress layout also shows the next ones.
		const ofType = (t: { typeId: string | null }) => t.typeId === schema.id;
		own(c, s.events.on('task:created', ({ task }) => ofType(task) && live()));
		own(c, s.events.on('task:deleted', ({ task }) => ofType(task) && live()));
		own(
			c,
			s.events.on('task:updated', ({ task, prev, keys }) => {
				if (!ofType(task) && !ofType(prev)) return;
				const counts = keys.some((k) => k === 'status' || k === 'optional' || k === 'entityId' || k === 'typeId');
				if (counts || this.kind === 'progress') live();
			}),
		);
		// A view changed or deleted elsewhere (another pane, a dashboard).
		for (const ev of ['view:saved', 'view:deleted'] as const) {
			own(
				c,
				s.events.on(ev, ({ view }) => {
					if (this.selfSave || view.typeId !== schema.id || this.dead) return;
					if (!s.views.get(this.viewId)) this.viewId = s.views.forType(schema.id)[0]!.id;
					// An open panel holds a copy of the old view; close it rather than overwrite.
					if (view.id === this.viewId) this.pop?.close();
					this.drawChrome();
					this.refresh();
				}),
			);
		}
		own(c, s.events.on('world:updated', ({ keys }) => keys.includes('statuses') && live()));
		c.register(() => {
			this.dead = true;
			live.cancel();
			this.onSearch?.cancel();
			this.pop?.close();
			this.closeCellEdit();
			for (const o of this.observers.splice(0)) o.disconnect();
		});
	}

	/** Whether what this view shows, filters, sorts or groups by depends on connections. */
	private usesLinks(): boolean {
		const view = this.view;
		const kind = this.kind;
		if (kind === 'progress') return true;
		const ids = new Set<string>([...view.conditions.map((x) => x.field), ...view.sorts.map((x) => x.field)]);
		if (view.groupBy) ids.add(view.groupBy);
		if (kind === 'table') for (const col of this.columns()) ids.add(col.id);
		else for (const f of this.cardFields()) ids.add(f.id);
		if (ids.has('__connections') || ids.has('__progress')) return true;
		return this.schema.fields.some((f) => ids.has(f.id) && (f.type === 'relation' || this.ctx.ws.fieldTypes.for(f).computed));
	}
}

function swap<T>(list: T[], a: number, b: number): T[] {
	const out = [...list];
	[out[a], out[b]] = [out[b] as T, out[a] as T];
	return out;
}

export { BUILTIN_COLUMNS, defaultViewId };
