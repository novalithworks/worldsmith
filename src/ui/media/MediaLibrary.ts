import { masonry } from '../components/masonry';
import { Keymap, Menu, Notice, setIcon, setTooltip, type TFile } from 'obsidian';
import type { DatabaseView, EntityRecord, ImageRef, ViewCondition, ViewKind } from '../../core/types';
import { fileNameOf, folderOf } from '../../core/util/media';
import { relativeTime } from '../../core/util/strings';
import { vaultImage } from '../../fields/ui/media';
import { ROLE_LABELS, type MediaRole, type MediaUsage } from '../../services/MediaRefs';
import type { WorldSession } from '../../services/WorldSession';
import { ROUTES } from '../../state/route';
import { avatar } from '../components/avatar';
import { button, cx, emptyState, icon, nameRegion } from '../components/dom';
import { own } from '../components/lifecycle';
import { confirmModal, promptModal } from '../components/modals';
import { actionNotice } from '../components/notice';
import { Popover } from '../components/popover';
import { openPropertyPicker } from '../components/propertyPicker';
import { showMenuAt } from '../database/controls';
import type { RouteContext } from '../views/routes/RouteRegistry';
import { ImageBrowser } from './ImageBrowser';
import { Lightbox } from './Lightbox';
import { mediaCard, mediaMenu } from './mediaCard';
import { mountToolBanner } from './pageBanner';

/** Saved media views live with the database views, under this pseudo type. */
export const MEDIA_VIEWS = '__media';

type Usage = 'used' | 'unused' | 'missing';
type Field = '__usage' | '__role' | '__type' | '__folder' | '__ext';
type SortKey = 'name' | 'folder' | 'uses' | 'newest' | 'size';
type GroupKey = 'folder' | 'role' | 'type' | 'usage';

interface Item {
	path: string;
	name: string;
	folder: string;
	ext: string;
	uses: MediaUsage[];
	usage: Usage;
	file: TFile | null;
	roles: Set<string>;
	types: Set<string>;
}

const LAYOUTS: Array<{ id: ViewKind; icon: string; label: string }> = [
	{ id: 'gallery', icon: 'layout-dashboard', label: 'Wall' },
	{ id: 'cards', icon: 'layout-grid', label: 'Cards' },
	{ id: 'table', icon: 'table-2', label: 'Table' },
];
const SORTS: Array<{ id: SortKey; label: string; icon: string }> = [
	{ id: 'name', label: 'Name', icon: 'type' },
	{ id: 'folder', label: 'Folder', icon: 'folder' },
	{ id: 'uses', label: 'Most used', icon: 'link' },
	{ id: 'newest', label: 'Newest file', icon: 'clock' },
	{ id: 'size', label: 'Largest file', icon: 'hard-drive' },
];
const GROUPS: Array<{ id: GroupKey; label: string; icon: string }> = [
	{ id: 'folder', label: 'Folder', icon: 'folder' },
	{ id: 'role', label: 'Used as', icon: 'image' },
	{ id: 'type', label: 'Entry type', icon: 'shapes' },
	{ id: 'usage', label: 'In use or not', icon: 'link-2' },
];
const USAGE_LABEL: Record<Usage, string> = { used: 'In use', unused: 'Not used yet', missing: 'Missing' };
const BATCH = 60;

/** Ready-made views offered by "+ View". */
const SUGGESTIONS: Array<{ id: string; name: string; icon: string; hint: string; init: Partial<DatabaseView> }> = [
	{ id: 'blank', name: 'New view', icon: 'plus', hint: 'Start from every image', init: {} },
	{ id: 'portraits', name: 'Portraits', icon: 'user-round', hint: 'Faces on entry pages', init: { kind: 'gallery', conditions: [cond('__role', 'portrait')] } },
	{ id: 'banners', name: 'Banners', icon: 'panorama', hint: 'Page and world banners', init: { kind: 'cards', conditions: [cond('__role', 'banner'), cond('__role', 'world-banner'), cond('__role', 'page-banner')] } },
	{ id: 'maps', name: 'Maps', icon: 'map', hint: 'Images used as maps', init: { kind: 'gallery', conditions: [cond('__role', 'map')] } },
	{ id: 'galleries', name: 'Galleries', icon: 'images', hint: 'Images in galleries', init: { kind: 'gallery', conditions: [cond('__role', 'gallery')] } },
	{ id: 'unused', name: 'Not used yet', icon: 'image-plus', hint: 'Vault images no entry uses', init: { kind: 'gallery', conditions: [cond('__usage', 'unused')], sorts: [{ field: 'newest', dir: 'desc' }] } },
	{ id: 'missing', name: 'Missing', icon: 'image-off', hint: 'Moved or deleted files', init: { kind: 'table', conditions: [cond('__usage', 'missing')] } },
	{ id: 'folders', name: 'By folder', icon: 'folder-tree', hint: 'Grouped by vault folder', init: { kind: 'cards', groupBy: 'folder' } },
];

function cond(field: Field, value: string): ViewCondition {
	return { id: `${field}-${value}`, field, op: 'is', value };
}

/**
 * The media library (polish round): saved views as tabs, like a type's database — each with
 * its own layout (wall, cards, table), filters (in use / not used yet / missing, used as,
 * entry type, folder, file type), sort, grouping and size. Views are stored with the world's
 * database views under a pseudo type, so they sync the same way.
 */
export class MediaLibrary {
	private viewId: string;
	private search = '';
	private items: Item[] = [];
	private missing = new Map<string, MediaUsage[]>();
	private tabsEl!: HTMLElement;
	private barEl!: HTMLElement;
	private chipsEl!: HTMLElement;
	private repairEl!: HTMLElement;
	private results!: HTMLElement;
	private countEl!: HTMLElement;
	private pop: Popover | null = null;
	private observers: IntersectionObserver[] = [];
	private folded = new Set<string>();
	private dead = false;
	private selfSave = 0;
	/** "Find missing images" opens the library showing only missing ones, without changing a view. */
	private onlyMissing: boolean;

	constructor(
		private readonly ctx: RouteContext,
		private readonly s: WorldSession,
	) {
		this.search = ctx.params.q ?? '';
		this.onlyMissing = ctx.params.show === 'missing';
		const views = s.views.forType(MEDIA_VIEWS);
		this.viewId = views.some((v) => v.id === ctx.params.view) ? (ctx.params.view as string) : views[0]!.id;
	}

	private get view(): DatabaseView {
		return this.s.views.get(this.viewId) ?? this.s.views.forType(MEDIA_VIEWS)[0]!;
	}

	private get kind(): ViewKind {
		const k = this.view.kind;
		return k === 'gallery' || k === 'table' ? k : 'cards';
	}

	mount(parent: HTMLElement): void {
		const page = parent.createDiv({ cls: 'ws-page ws-page--media' });
		const header = page.createDiv({ cls: 'ws-db-header ws-tint--purple' });
		icon(header.createDiv({ cls: 'ws-db-header__mark' }), 'images');
		const text = header.createDiv({ cls: 'ws-db-header__text' });
		text.createEl('h1', { cls: 'ws-db-header__title', text: 'Media' });
		this.countEl = text.createDiv({ cls: 'ws-db-header__count' });
		text.createDiv({ cls: 'ws-db-header__desc', text: `Every image used in ${this.s.world.name}, and where.` });
		const actions = header.createDiv({ cls: 'ws-db-header__actions' });
		mountToolBanner(this.ctx, header, 'media');
		button(actions, {
			label: 'Browse vault images',
			icon: 'folder-search',
			variant: 'ghost',
			onClick: () =>
				new ImageBrowser(this.ctx.ws, {
					title: 'Images in your vault',
					onPick: ([f]) => {
						if (f) void this.ctx.ws.app.workspace.getLeaf('tab').openFile(f);
					},
				}).open(),
		});
		this.repairEl = page.createDiv({ cls: 'ws-media-repair' });
		this.tabsEl = page.createDiv({ cls: 'ws-vtabs', attr: { role: 'tablist' } });
		nameRegion(this.tabsEl, 'Media views');
		this.barEl = page.createDiv({ cls: 'ws-toolbar ws-vbar ws-mbar', attr: { role: 'toolbar' } });
		nameRegion(this.barEl, 'Media view options');
		this.chipsEl = page.createDiv({ cls: 'ws-vchips' });
		this.results = page.createDiv({ cls: 'ws-mlib' });
		this.compute();
		this.drawChrome();
		this.refresh();
		this.listen();
	}

	// ── data ─────────────────────────────────────────────────────────────────

	/** Every image the world uses (or used: missing), plus vault images nothing uses yet. */
	private compute(): void {
		const { s } = this;
		const ws = this.ctx.ws;
		const byPath = new Map<string, MediaUsage[]>();
		for (const u of s.media.all()) {
			const l = byPath.get(u.path) ?? [];
			l.push(u);
			byPath.set(u.path, l);
		}
		this.missing = s.media.missing((p) => ws.media.exists(p));
		const items: Item[] = [];
		const make = (path: string, uses: MediaUsage[], usage: Usage): Item => {
			const roles = new Set<string>(uses.map((u) => u.role));
			const types = new Set<string>();
			for (const u of uses) {
				const e = u.entityId ? s.entities.get(u.entityId) : undefined;
				if (e) types.add(e.typeId);
			}
			const name = fileNameOf(path);
			return { path, name, folder: folderOf(path), ext: (name.split('.').pop() ?? '').toLowerCase(), uses, usage, file: ws.media.file(path), roles, types };
		};
		for (const [path, uses] of byPath) {
			const missing = this.missing.has(path);
			if (!missing && !uses.some((u) => u.image)) continue;
			items.push(make(path, uses, missing ? 'missing' : 'used'));
		}
		for (const f of ws.media.images()) if (!byPath.has(f.path)) items.push(make(f.path, [], 'unused'));
		this.items = items;
	}

	private valuesOf(field: Field): string[] {
		return this.view.conditions.filter((c) => c.field === field && typeof c.value === 'string').map((c) => c.value);
	}

	/** Within one filter, any chosen value matches; across filters, all must. */
	private visible(): Item[] {
		const q = this.search.trim().toLowerCase();
		const usage = this.onlyMissing ? ['missing'] : this.valuesOf('__usage');
		const roles = this.valuesOf('__role');
		const types = this.valuesOf('__type');
		const folders = this.valuesOf('__folder');
		const exts = this.valuesOf('__ext');
		const out = this.items.filter((it) => {
			// Images nothing uses only show when a view asks for them.
			if (usage.length ? !usage.includes(it.usage) : it.usage === 'unused') return false;
			if (roles.length && !roles.some((r) => it.roles.has(r))) return false;
			if (types.length && !types.some((t) => it.types.has(t))) return false;
			if (folders.length && !folders.some((f) => it.folder === f || it.folder.startsWith(`${f}/`))) return false;
			if (exts.length && !exts.includes(it.ext)) return false;
			if (q) {
				const names = it.uses.map((u) => (u.entityId ? (this.s.entities.get(u.entityId)?.name ?? '') : this.s.world.name)).join(' ');
				if (!`${it.path} ${names}`.toLowerCase().includes(q)) return false;
			}
			return true;
		});
		const sort = (this.view.sorts[0]?.field ?? 'name') as SortKey;
		const dir = this.view.sorts[0]?.dir === 'desc' ? -1 : 1;
		const byName = (a: Item, b: Item) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
		const cmp: Record<SortKey, (a: Item, b: Item) => number> = {
			name: (a, b) => dir * byName(a, b),
			folder: (a, b) => dir * a.folder.localeCompare(b.folder) || byName(a, b),
			uses: (a, b) => b.uses.length - a.uses.length || byName(a, b),
			newest: (a, b) => (b.file?.stat.mtime ?? 0) - (a.file?.stat.mtime ?? 0) || byName(a, b),
			size: (a, b) => (b.file?.stat.size ?? 0) - (a.file?.stat.size ?? 0) || byName(a, b),
		};
		// Missing images first, so they're seen and fixed.
		return out.sort((a, b) => Number(b.usage === 'missing') - Number(a.usage === 'missing') || (cmp[sort] ?? cmp.name)(a, b));
	}

	// ── chrome ───────────────────────────────────────────────────────────────

	private update(patch: Partial<DatabaseView>): void {
		if (this.dead) return;
		this.selfSave++;
		try {
			const saved = this.s.views.update(this.viewId, patch);
			if (saved) this.viewId = saved.id;
		} finally {
			this.selfSave--;
		}
		this.drawChrome();
		this.refresh();
	}

	private selectView(id: string): void {
		if (this.dead) return;
		this.pop?.close();
		this.onlyMissing = false;
		this.viewId = id;
		this.folded.clear();
		this.ctx.replaceParams(this.params());
		this.drawChrome();
		this.refresh();
	}

	private params(): Record<string, string> {
		const p: Record<string, string> = {};
		if (this.viewId !== this.s.views.forType(MEDIA_VIEWS)[0]?.id) p.view = this.viewId;
		if (this.search) p.q = this.search;
		if (this.onlyMissing) p.show = 'missing';
		return p;
	}

	private drawChrome(): void {
		this.drawTabs();
		this.drawBar();
		this.drawChips();
		this.drawRepair();
	}

	private drawTabs(): void {
		const el = this.tabsEl;
		el.empty();
		for (const v of this.s.views.forType(MEDIA_VIEWS)) {
			const on = v.id === this.viewId;
			const tab = el.createEl('button', { cls: cx('ws-vtab', on && 'is-active'), attr: { type: 'button', role: 'tab', 'aria-selected': String(on), 'data-view': v.id } });
			icon(tab, v.icon ?? LAYOUTS.find((k) => k.id === v.kind)?.icon ?? 'images', 'ws-vtab__icon');
			tab.createSpan({ cls: 'ws-vtab__label', text: v.name });
			if (on) {
				const more = tab.createSpan({ cls: 'ws-vtab__more', attr: { 'aria-hidden': 'true' } });
				setIcon(more, 'chevron-down');
				more.addEventListener('click', (evt) => {
					evt.stopPropagation();
					this.tabMenu(evt, v, tab);
				});
			}
			tab.addEventListener('click', () => !on && this.selectView(v.id));
			tab.addEventListener('dblclick', () => void this.rename(v));
			tab.addEventListener('contextmenu', (evt) => {
				evt.preventDefault();
				this.tabMenu(evt, v, tab);
			});
		}
		const add = el.createEl('button', { cls: 'ws-vtab ws-vtab--add', attr: { type: 'button', 'aria-label': 'New view' } });
		icon(add, 'plus');
		add.createSpan({ text: 'View' });
		add.addEventListener('click', () =>
			openPropertyPicker(add, {
				title: 'New view',
				items: SUGGESTIONS.map((x) => ({ id: x.id, label: x.name, icon: x.icon, hint: x.hint, group: x.id === 'blank' ? undefined : 'Start from' })),
				onPick: (id) => {
					const sug = SUGGESTIONS.find((x) => x.id === id);
					if (sug) void this.newView(sug);
				},
			}),
		);
	}

	private tabMenu(evt: MouseEvent | null, v: DatabaseView, tab: HTMLElement): void {
		const views = this.s.views.forType(MEDIA_VIEWS);
		const i = views.findIndex((x) => x.id === v.id);
		const m = new Menu();
		m.addItem((it) => it.setTitle('Rename…').setIcon('pencil').onClick(() => void this.rename(v)));
		m.addItem((it) =>
			it
				.setTitle('Duplicate')
				.setIcon('copy')
				.onClick(() => {
					const copy = this.s.views.duplicate(v.id);
					if (copy) this.selectView(copy.id);
				}),
		);
		m.addSeparator();
		if (i > 0) m.addItem((it) => it.setTitle('Move left').setIcon('arrow-left').onClick(() => (this.s.views.move(v.id, -1), this.drawTabs())));
		if (i < views.length - 1) m.addItem((it) => it.setTitle('Move right').setIcon('arrow-right').onClick(() => (this.s.views.move(v.id, 1), this.drawTabs())));
		m.addSeparator();
		m.addItem((it) => {
			it.setTitle('Delete view').setIcon('trash-2').setWarning(true);
			if (views.length <= 1 || !this.s.views.isStored(v.id)) it.setDisabled(true);
			it.onClick(() => void this.deleteView(v));
		});
		showMenuAt(m, evt, tab);
	}

	private async rename(v: DatabaseView): Promise<void> {
		const name = await promptModal(this.ctx.ws.app, { title: 'Rename view', value: v.name, confirmLabel: 'Rename' });
		if (!name?.trim()) return;
		this.s.views.update(v.id, { name: name.trim() });
		if (!this.dead) this.drawTabs();
	}

	private async newView(sug: (typeof SUGGESTIONS)[number]): Promise<void> {
		const name = sug.id === 'blank' ? await promptModal(this.ctx.ws.app, { title: 'New view', label: 'Name', value: '', placeholder: 'e.g. Maps, Character art', confirmLabel: 'Create view' }) : sug.name;
		if (name === null) return;
		const cur = this.view;
		const v = this.s.views.create(MEDIA_VIEWS, { name: name.trim() || 'View', kind: cur.kind, card: cur.card, ...sug.init, icon: sug.id === 'blank' ? null : sug.icon });
		this.selectView(v.id);
	}

	private async deleteView(v: DatabaseView): Promise<void> {
		const ok = await confirmModal(this.ctx.ws.app, { title: `Delete the “${v.name}” view?`, body: 'Only the view goes. Your images and entries aren’t affected.', confirmLabel: 'Delete view' });
		if (!ok) return;
		const removed = this.s.views.remove(v.id);
		if (!removed) return;
		this.selectView(this.s.views.forType(MEDIA_VIEWS)[0]!.id);
		actionNotice(`View “${v.name}” deleted.`, {
			label: 'Undo',
			run: () => {
				this.s.views.restore(removed);
				this.selectView(removed.id);
			},
		});
	}

	private drawBar(): void {
		const bar = this.barEl;
		bar.empty();
		const view = this.view;
		const searchWrap = bar.createDiv({ cls: 'ws-search-field' });
		icon(searchWrap, 'search', 'ws-search-field__icon');
		const search = searchWrap.createEl('input', { cls: 'ws-search-field__input', attr: { type: 'search', placeholder: 'Search by file or entry…', 'aria-label': 'Search media' } });
		search.value = this.search;
		let t = 0;
		search.addEventListener('input', () => {
			window.clearTimeout(t);
			t = window.setTimeout(() => {
				if (this.dead) return;
				this.search = search.value;
				this.ctx.replaceParams(this.params());
				this.refresh();
			}, 150);
		});
		const tools = bar.createDiv({ cls: 'ws-vbar__tools' });
		const nf = view.conditions.length;
		const filterBtn = button(tools, { icon: 'filter', label: nf ? `Filter · ${nf}` : 'Filter', variant: 'quiet', size: 'sm', cls: cx('ws-vbar__filter', nf > 0 && 'is-active').join(' '), onClick: () => this.toggle(filterBtn, () => this.filterPanel(filterBtn)) });
		const sortKey = (view.sorts[0]?.field ?? 'name') as SortKey;
		const sortBtn = button(tools, {
			icon: 'arrow-up-down',
			label: SORTS.find((x) => x.id === sortKey)?.label ?? 'Sort',
			variant: 'quiet',
			size: 'sm',
			cls: 'ws-vbar__sort',
			onClick: () =>
				this.toggle(sortBtn, () =>
					openPropertyPicker(sortBtn, {
						title: 'Sort by',
						selected: sortKey,
						items: SORTS.map((x) => ({ id: x.id, label: x.label, icon: x.icon })),
						onPick: (id) => id && this.update({ sorts: [{ field: id, dir: 'asc' }] }),
					}),
				),
		});
		const g = view.groupBy as GroupKey | null;
		const groupBtn = button(tools, {
			icon: 'rows-3',
			label: g ? `Group: ${GROUPS.find((x) => x.id === g)?.label ?? g}` : 'Group',
			variant: 'quiet',
			size: 'sm',
			cls: cx('ws-vbar__group', !!g && 'is-active').join(' '),
			onClick: () =>
				this.toggle(groupBtn, () =>
					openPropertyPicker(groupBtn, {
						title: 'Group by',
						selected: g,
						none: { label: 'No groups', icon: 'list' },
						items: GROUPS.map((x) => ({ id: x.id, label: x.label, icon: x.icon })),
						onPick: (id) => this.update({ groupBy: id, collapsed: [] }),
					}),
				),
		});
		// Size (wall and cards).
		if (this.kind !== 'table') {
			const size = bar.createDiv({ cls: 'ws-segmented ws-segmented--labels ws-segmented--sm ws-mbar__size', attr: { role: 'radiogroup' } });
			nameRegion(size, 'Image size');
			for (const [id, label] of [
				['s', 'S'],
				['m', 'M'],
				['l', 'L'],
			] as const) {
				const on = view.card.size === id;
				const b = size.createEl('button', { cls: cx('ws-segmented__item', on && 'is-active'), text: label, attr: { type: 'button', role: 'radio', 'aria-checked': String(on), 'aria-label': `Size ${label}` } });
				b.addEventListener('click', () => this.update({ card: { ...view.card, size: id } }));
			}
		}
		const seg = bar.createDiv({ cls: 'ws-segmented ws-vbar__kinds', attr: { role: 'radiogroup' } });
		nameRegion(seg, 'Layout');
		for (const k of LAYOUTS) {
			const on = this.kind === k.id;
			const b = seg.createEl('button', { cls: cx('ws-segmented__item', on && 'is-active'), attr: { type: 'button', role: 'radio', 'aria-checked': String(on), 'aria-label': k.label, 'data-kind': k.id } });
			setIcon(b, k.icon);
			setTooltip(b, k.label, { delay: 300 });
			b.addEventListener('click', () => !on && this.update({ kind: k.id }));
		}
		this.reanchor();
	}

	/** The toolbar button a panel belongs to, by its stable class (the bar is redrawn on every change). */
	private popKey = '';

	private toggle(anchor: HTMLElement, open: () => Popover): void {
		const key = [...anchor.classList].find((c) => c.startsWith('ws-vbar__')) ?? '';
		const was = !!this.pop?.el.isConnected && this.popKey === key;
		this.pop?.close();
		this.pop = null;
		this.barEl.querySelectorAll('.is-open').forEach((x) => x.removeClass('is-open'));
		if (was) return;
		this.pop = open();
		this.popKey = key;
		anchor.addClass('is-open');
	}

	/** After the toolbar is redrawn, an open panel follows its (new) button. */
	private reanchor(): void {
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

	/** Filters as chips: pick any number in each section. */
	private filterPanel(anchor: HTMLElement): Popover {
		const pop = new Popover(anchor, { cls: 'ws-vpanel ws-mfilter', width: 460, label: 'Filters' });
		const count = (pred: (it: Item) => boolean) => this.items.filter(pred).length;
		const folders = [...new Set(this.items.filter((i) => i.usage !== 'unused').map((i) => i.folder))].sort();
		const exts = [...new Set(this.items.map((i) => i.ext))].filter(Boolean).sort();
		const types = this.s.schemas.list().filter((t) => this.items.some((i) => i.types.has(t.id)));
		const sections: Array<{ field: Field; title: string; options: Array<{ id: string; label: string; icon?: string; n: number }> }> = [
			{ field: '__usage', title: 'Show', options: (['used', 'unused', 'missing'] as Usage[]).map((u) => ({ id: u, label: USAGE_LABEL[u], icon: u === 'used' ? 'link' : u === 'unused' ? 'image-plus' : 'image-off', n: count((i) => i.usage === u) })) },
			{ field: '__role', title: 'Used as', options: (Object.keys(ROLE_LABELS) as MediaRole[]).map((r) => ({ id: r, label: ROLE_LABELS[r], n: count((i) => i.roles.has(r)) })).filter((o) => o.n) },
			{ field: '__type', title: 'On entries of type', options: types.map((t) => ({ id: t.id, label: t.plural, icon: t.icon, n: count((i) => i.types.has(t.id)) })) },
			{ field: '__folder', title: 'Folder', options: folders.slice(0, 24).map((f) => ({ id: f, label: f || 'Vault root', icon: 'folder', n: count((i) => i.folder === f) })) },
			{ field: '__ext', title: 'File type', options: exts.map((x) => ({ id: x, label: x.toUpperCase(), n: count((i) => i.ext === x) })) },
		];
		const paint = () => {
			pop.el.empty();
			const head = pop.el.createDiv({ cls: 'ws-vpanel__head' });
			head.createSpan({ cls: 'ws-vpanel__title', text: 'Filters' });
			if (this.view.conditions.length) button(head, { label: 'Clear all', variant: 'quiet', size: 'sm', cls: 'ws-vpanel__clear', onClick: () => (this.update({ conditions: [] }), paint()) });
			for (const sec of sections) {
				if (!sec.options.length) continue;
				const box = pop.el.createDiv({ cls: 'ws-mfilter__sec' });
				box.createDiv({ cls: 'ws-mfilter__title', text: sec.title });
				const chips = box.createDiv({ cls: 'ws-mfilter__chips' });
				const chosen = this.valuesOf(sec.field);
				for (const o of sec.options) {
					const on = chosen.includes(o.id);
					const c = chips.createEl('button', { cls: cx('ws-mchip', on && 'is-on'), attr: { type: 'button', 'aria-pressed': String(on) } });
					if (o.icon) icon(c, o.icon);
					c.createSpan({ text: o.label });
					c.createSpan({ cls: 'ws-mchip__n', text: String(o.n) });
					c.addEventListener('click', () => {
						const rest = this.view.conditions.filter((x) => !(x.field === sec.field && x.value === o.id));
						this.update({ conditions: on ? rest : [...rest, cond(sec.field, o.id)] });
						paint();
					});
				}
			}
			const note = pop.el.createDiv({ cls: 'ws-mfilter__note' });
			note.setText('Within a section, any choice matches. “Not used yet” lists vault images no entry uses.');
			pop.position();
		};
		paint();
		return pop;
	}

	private labelFor(c: ViewCondition): string {
		switch (c.field) {
			case '__usage':
				return USAGE_LABEL[c.value as Usage] ?? c.value;
			case '__role':
				return ROLE_LABELS[c.value as MediaRole] ?? c.value;
			case '__type':
				return this.s.schemas.get(c.value)?.plural ?? c.value;
			case '__folder':
				return `In ${c.value || 'vault root'}`;
			case '__ext':
				return c.value.toUpperCase();
			default:
				return c.value;
		}
	}

	private drawChips(): void {
		const el = this.chipsEl;
		el.empty();
		const conds = this.view.conditions;
		el.toggleClass('is-empty', !conds.length && !this.onlyMissing);
		if (this.onlyMissing) {
			const chip = el.createDiv({ cls: 'ws-vchip is-broken' });
			icon(chip, 'image-off', 'ws-vchip__icon');
			chip.createSpan({ cls: 'ws-vchip__text', text: 'Only missing images' });
			const x = chip.createEl('button', { cls: 'ws-vchip__x', attr: { type: 'button', 'aria-label': 'Show every image' } });
			setIcon(x, 'x');
			x.addEventListener('click', () => {
				this.onlyMissing = false;
				this.ctx.replaceParams(this.params());
				this.drawChips();
				this.refresh();
			});
		}
		for (const c of conds) {
			const chip = el.createDiv({ cls: 'ws-vchip' });
			icon(chip, 'filter', 'ws-vchip__icon');
			chip.createSpan({ cls: 'ws-vchip__text', text: this.labelFor(c) });
			const x = chip.createEl('button', { cls: 'ws-vchip__x', attr: { type: 'button', 'aria-label': `Remove filter: ${this.labelFor(c)}` } });
			setIcon(x, 'x');
			x.addEventListener('click', () => this.update({ conditions: conds.filter((y) => y.id !== c.id) }));
		}
	}

	private drawRepair(): void {
		const el = this.repairEl;
		el.empty();
		const { s } = this;
		if (!this.missing.size) return;
		const all = this.ctx.ws.media.images().map((f) => f.path);
		const unique = [...this.missing.keys()].map((p) => ({ path: p, cands: s.media.candidates(p, all) })).filter((x) => x.cands.length === 1);
		const box = el.createDiv({ cls: 'ws-media-repair__box' });
		icon(box, 'image-off', 'ws-media-repair__icon');
		const t = box.createDiv({ cls: 'ws-media-repair__text' });
		t.createEl('b', { text: `${this.missing.size} image${this.missing.size === 1 ? ' is' : 's are'} missing. ` });
		t.createSpan({ text: unique.length ? `${unique.length === this.missing.size ? 'All of them were' : `${unique.length} of them were`} found elsewhere in your vault under the same name.` : 'They were moved or deleted while Worldsmith wasn’t open. Relink each one below.' });
		const a = box.createDiv({ cls: 'ws-media-repair__actions' });
		if (unique.length)
			button(a, {
				label: `Relink ${unique.length}`,
				icon: 'link',
				variant: 'primary',
				size: 'sm',
				onClick: () => {
					let n = 0;
					for (const x of unique) n += s.media.relink(x.path, x.cands[0] as string);
					new Notice(`Relinked ${n} reference${n === 1 ? '' : 's'}.`);
				},
			});
		if (!this.onlyMissing)
			button(a, {
				label: 'Show missing',
				variant: 'ghost',
				size: 'sm',
				onClick: () => {
					this.onlyMissing = true;
					this.ctx.replaceParams(this.params());
					this.drawChips();
					this.drawRepair();
					this.refresh();
				},
			});
	}

	// ── results ──────────────────────────────────────────────────────────────

	private refresh(): void {
		if (this.dead) return;
		for (const o of this.observers.splice(0)) o.disconnect();
		const list = this.visible();
		const used = this.items.filter((i) => i.usage !== 'unused');
		const refs = used.reduce((n, i) => n + i.uses.filter((u) => u.image).length, 0);
		this.countEl.setText(`${used.length} image${used.length === 1 ? '' : 's'} · used ${refs} time${refs === 1 ? '' : 's'}${this.missing.size ? ` · ${this.missing.size} missing` : ''}`);
		const r = this.results;
		r.empty();
		r.className = cx('ws-mlib', `ws-mlib--${this.kind}`, `ws-mlib--${this.view.card.size}`).join(' ');
		if (!list.length) {
			const usage = this.onlyMissing ? ['missing'] : this.valuesOf('__usage');
			emptyState(r, {
				icon: usage.includes('missing') ? 'check-circle-2' : 'search-x',
				title: !this.items.length ? 'No images yet' : usage.length === 1 && usage[0] === 'missing' ? 'Nothing missing' : 'No images match this view',
				body: !this.items.length ? 'Add a portrait, a banner or a gallery to any entry — they’ll all be listed here.' : undefined,
				compact: !!this.items.length,
			});
			return;
		}
		const g = this.view.groupBy as GroupKey | null;
		if (!g || this.search) {
			this.drawList(r, list, true);
			return;
		}
		const groups = new Map<string, { label: string; icon: string; items: Item[] }>();
		const add = (key: string, label: string, ic: string, it: Item) => {
			const cur = groups.get(key) ?? { label, icon: ic, items: [] };
			cur.items.push(it);
			groups.set(key, cur);
		};
		for (const it of list) {
			if (g === 'folder') add(it.folder, it.folder || 'Vault root', 'folder', it);
			else if (g === 'usage') add(it.usage, USAGE_LABEL[it.usage], it.usage === 'missing' ? 'image-off' : 'link', it);
			else if (g === 'role') {
				if (!it.roles.size) add('~none', 'Not used', 'image-plus', it);
				for (const role of it.roles) add(role, ROLE_LABELS[role as MediaRole] ?? role, 'image', it);
			} else {
				if (!it.types.size) add('~none', it.usage === 'unused' ? 'Not used' : 'World', 'globe-2', it);
				for (const t of it.types) {
					const sc = this.s.schemas.get(t);
					add(t, sc?.plural ?? t, sc?.icon ?? 'shapes', it);
				}
			}
		}
		for (const [key, gr] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
			const folded = this.folded.has(key);
			const sec = r.createDiv({ cls: cx('ws-vgroup', folded && 'is-collapsed') });
			const head = sec.createDiv({ cls: 'ws-vgroup__headwrap' }).createEl('button', { cls: 'ws-vgroup__head', attr: { type: 'button', 'aria-expanded': String(!folded) } });
			const caret = head.createSpan({ cls: 'ws-vgroup__caret' });
			setIcon(caret, 'chevron-down');
			icon(head, gr.icon, 'ws-mlib__gicon');
			head.createSpan({ cls: 'ws-vgroup__label', text: gr.label });
			head.createSpan({ cls: 'ws-vgroup__count', text: String(gr.items.length) });
			head.addEventListener('click', () => {
				if (folded) this.folded.delete(key);
				else this.folded.add(key);
				this.refresh();
			});
			if (!folded) this.drawList(sec, gr.items, false);
		}
	}

	/** One container of items; long lists draw in batches as you scroll. */
	private drawList(parent: HTMLElement, list: Item[], lazy: boolean): void {
		const kind = this.kind;
		let container: HTMLElement;
		if (kind === 'table') {
			const wrap = parent.createDiv({ cls: 'ws-table-wrap' });
			const table = wrap.createEl('table', { cls: 'ws-table ws-mtable' });
			const head = table.createEl('thead').createEl('tr');
			for (const h of ['Image', 'Used by', 'Folder', 'Size', 'Modified', '']) head.createEl('th', { text: h, attr: { scope: 'col' } });
			container = table.createEl('tbody');
		} else {
			container = parent.createDiv({ cls: kind === 'gallery' ? 'ws-mwall' : 'ws-media-grid' });
			if (kind === 'gallery') masonry(container);
		}
		const refs: ImageRef[] = list.map((i) => ({ path: i.path }));
		const open = (i: number) => new Lightbox(this.ctx.ws, { items: () => refs, index: i }).open();
		let shown = 0;
		const more = () => {
			const next = list.slice(shown, shown + (lazy ? BATCH : list.length));
			const base = shown;
			next.forEach((it, j) => this.drawItem(container, it, () => open(base + j)));
			shown += next.length;
			if (!lazy || shown >= list.length) return;
			const sentinel = parent.createDiv({ cls: 'ws-db-sentinel', text: 'Loading more…' });
			const io = new IntersectionObserver(
				(es) => {
					if (!es.some((x) => x.isIntersecting)) return;
					io.disconnect();
					sentinel.remove();
					more();
				},
				{ rootMargin: '0px 0px 800px 0px' },
			);
			io.observe(sentinel);
			this.observers.push(io);
		};
		more();
	}

	private drawItem(parent: HTMLElement, it: Item, view: () => void): void {
		if (this.kind === 'cards') mediaCard(parent, this.ctx, this.s, it.path, it.uses, it.usage === 'missing', view);
		else if (this.kind === 'gallery') this.tile(parent, it, view);
		else this.row(parent, it, view);
	}

	private tile(parent: HTMLElement, it: Item, view: () => void): void {
		const t = parent.createEl('button', { cls: cx('ws-mtile', `is-${it.usage}`), attr: { type: 'button', 'data-path': it.path } });
		if (it.usage === 'missing') {
			const miss = t.createDiv({ cls: 'ws-mtile__missing' });
			icon(miss, 'image-off');
		} else vaultImage(t, this.ctx.ws.app, { path: it.path }, 'ws-mtile__img');
		const cap = t.createDiv({ cls: 'ws-mtile__cap' });
		cap.createSpan({ cls: 'ws-mtile__name', text: it.name });
		cap.createSpan({ cls: 'ws-mtile__meta', text: it.usage === 'unused' ? 'Not used yet' : it.usage === 'missing' ? 'Missing' : `${it.uses.length} use${it.uses.length === 1 ? '' : 's'}` });
		t.addEventListener('click', view);
		t.addEventListener('contextmenu', (ev) => {
			ev.preventDefault();
			mediaMenu(ev, this.ctx, this.s, it.path, it.uses, it.usage === 'missing');
		});
	}

	private row(tbody: HTMLElement, it: Item, view: () => void): void {
		const tr = tbody.createEl('tr', { cls: cx('ws-table__row', `is-${it.usage}`) });
		const nameCell = tr.createEl('td').createDiv({ cls: 'ws-mtable__name' });
		const th = nameCell.createEl('button', { cls: 'ws-mtable__thumb', attr: { type: 'button', 'aria-label': `View ${it.name}` } });
		if (it.usage === 'missing') icon(th, 'image-off');
		else vaultImage(th, this.ctx.ws.app, { path: it.path }, 'ws-mtable__img');
		th.addEventListener('click', view);
		const nm = nameCell.createDiv({ cls: 'ws-mtable__text' });
		nm.createDiv({ cls: 'ws-mtable__file', text: it.name });
		nm.createDiv({ cls: 'ws-mtable__sub', text: it.usage === 'missing' ? 'Missing from the vault' : it.ext.toUpperCase() });
		const who = tr.createEl('td').createDiv({ cls: 'ws-mtable__uses' });
		const seen = new Set<string>();
		for (const u of it.uses) {
			if (!u.entityId || seen.has(u.entityId)) continue;
			seen.add(u.entityId);
			if (seen.size > 3) break;
			const e: EntityRecord | undefined = this.s.entities.get(u.entityId);
			if (!e) continue;
			const chip = who.createEl('button', { cls: 'ws-media-use', attr: { type: 'button' } });
			avatar(chip, this.ctx.ws.app, e, this.s.schemas.get(e.typeId), { size: 'xs' });
			chip.createSpan({ cls: 'ws-media-use__name', text: e.name });
			chip.addEventListener('click', (ev) => this.ctx.navigate(ROUTES.entity(e.id), Keymap.isModEvent(ev)));
		}
		if (!it.uses.length) who.createSpan({ cls: 'ws-field-display is-empty', text: 'Not used yet' });
		else if (it.uses.some((u) => u.role === 'world-banner')) who.createSpan({ cls: 'ws-mtable__world', text: 'World banner' });
		else if (it.uses.some((u) => u.role === 'page-banner')) who.createSpan({ cls: 'ws-mtable__world', text: 'Page banner' });
		else if (it.uses.some((u) => u.role === 'map')) who.createSpan({ cls: 'ws-mtable__world', text: 'Map' });
		tr.createEl('td', { cls: 'ws-table__muted', text: it.folder || 'Vault root' });
		tr.createEl('td', { cls: 'ws-table__muted ws-table__num', text: it.file ? formatSize(it.file.stat.size) : '—' });
		tr.createEl('td', { cls: 'ws-table__muted', text: it.file ? relativeTime(it.file.stat.mtime) : '—' });
		const actions = tr.createEl('td');
		const more = actions.createEl('button', { cls: 'clickable-icon ws-mtable__more', attr: { type: 'button', 'aria-label': 'Image options' } });
		setIcon(more, 'more-horizontal');
		more.addEventListener('click', (ev) => mediaMenu(ev, this.ctx, this.s, it.path, it.uses, it.usage === 'missing'));
	}

	// ── live ─────────────────────────────────────────────────────────────────

	private listen(): void {
		const { s } = this;
		const c = this.ctx.component;
		let queued = false;
		const later = () => {
			if (queued) return;
			queued = true;
			window.setTimeout(() => {
				queued = false;
				if (this.dead) return;
				this.compute();
				this.drawRepair();
				this.refresh();
			}, 80);
		};
		own(c, s.events.on('entity:updated', ({ change }) => change.keys.some((k) => k === 'media' || k.startsWith('values') || k === 'name' || k === 'trashedAt') && later()));
		own(c, s.events.on('entity:created', later));
		own(c, s.events.on('entity:deleted', later));
		own(c, s.events.on('world:updated', ({ keys }) => keys.includes('banner') && later()));
		for (const ev of ['view:saved', 'view:deleted'] as const) {
			own(
				c,
				s.events.on(ev, ({ view }) => {
					if (this.selfSave || view.typeId !== MEDIA_VIEWS || this.dead) return;
					if (!s.views.get(this.viewId)) this.viewId = s.views.forType(MEDIA_VIEWS)[0]!.id;
					this.drawChrome();
					this.refresh();
				}),
			);
		}
		for (const ev of ['create', 'delete', 'rename'] as const) c.registerEvent(this.ctx.ws.app.vault.on(ev as 'create', later));
		c.register(() => {
			this.dead = true;
			this.pop?.close();
			for (const o of this.observers.splice(0)) o.disconnect();
		});
	}
}

function formatSize(bytes: number): string {
	if (!bytes) return '—';
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
