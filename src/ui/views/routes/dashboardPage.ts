import { Keymap, Menu, Notice, type Component } from 'obsidian';
import type { BlockDefinition, BlockRenderContext } from '../../../blocks/BlockRegistry';
import type { BlockInstance, DashboardMeta } from '../../../core/types';
import { undoLayoutReset } from '../../layoutUndo';
import { DASHBOARD_LAYOUT, materialize } from '../../../layouts/defaults';
import { withoutMissingTypes } from '../../../layouts/dashboards';
import { LayoutEditor, renderWidgetDrawer } from '../../../layouts/editor/LayoutEditor';
import { guideOn, renderGuide } from '../../guide/guide';
import { HOME_DASHBOARD } from '../../../services/DashboardService';
import { CUSTOMIZE_DASHBOARD_EVENT } from '../../../blocks/dashboard/common';
import { ROUTES } from '../../../state/route';
import { BlockSettingsModal } from '../../components/BlockSettingsModal';
import { button, cx, emptyState, icon } from '../../components/dom';
import { own } from '../../components/lifecycle';
import { confirmModal } from '../../components/modals';
import { actionNotice } from '../../components/notice';
import { DashboardModal, deleteDashboard } from '../../dashboards/DashboardModal';
import { mountPageBanner, pageBannerKey } from '../../media/pageBanner';
import type { RouteContext, RouteDefinition } from './RouteRegistry';

export { CUSTOMIZE_DASHBOARD_EVENT };
const UNDO_LIMIT = 60;

/**
 * Home and the world's extra dashboards: a layout of dashboard widgets with the same
 * Customize mode as entry pages (drag, resize, settings, undo). Home's layout falls back to
 * Worldsmith's default; an extra dashboard without widgets shows an inviting empty page.
 */
export const dashboardRoute: RouteDefinition = {
	id: 'dashboard',
	needsWorld: true,
	title: (p, s) => {
		const d = p.id ? s?.dashboards.get(p.id) : undefined;
		return d ? d.name : (s?.world.name ?? 'Worldsmith');
	},
	icon: (p, s) => {
		const d = p.id ? s?.dashboards.get(p.id) : undefined;
		return d ? d.icon : 'home';
	},
	render(ctx) {
		new DashboardPage(ctx).mount();
	},
};

class DashboardPage {
	private readonly s: NonNullable<RouteContext['session']>;
	private readonly id: string;
	private page!: HTMLElement;
	private editor: LayoutEditor | null = null;
	private editing = false;
	private undoStack: Array<{ blocks: BlockInstance[]; existed: boolean }> = [];
	private selfSave = 0;
	private drawerHost: HTMLElement | null = null;
	private undoBtn: HTMLButtonElement | null = null;
	private resetBtn: HTMLButtonElement | null = null;
	/** This dashboard's name/icon/colour as last drawn; other dashboards' changes are ignored. */
	private drawnMeta = '';

	constructor(private readonly ctx: RouteContext) {
		this.s = ctx.session!;
		this.id = ctx.params.id || HOME_DASHBOARD;
	}

	private get isHome(): boolean {
		return this.id === HOME_DASHBOARD;
	}

	private get meta(): DashboardMeta | undefined {
		return this.isHome ? undefined : this.s.dashboards.get(this.id);
	}

	mount(): void {
		this.page = this.ctx.el.createDiv({ cls: 'ws-page ws-page--dashboard' });
		// The guide can be switched on just after Home first draws (a new world): redraw then.
		const g = this.ctx.ws.events.on('guide:changed', ({ worldId }) => {
			if (this.isHome && !this.editing && worldId === this.s.worldId && this.page.isConnected) this.draw();
		});
		this.ctx.component.register(() => g.dispose());
		if (this.ctx.params.edit === '1') {
			this.editing = true;
			const { edit: _drop, ...rest } = this.ctx.params;
			void _drop;
			this.ctx.replaceParams(rest);
		}
		this.draw();
		this.listen();
	}

	private ref() {
		return { kind: 'dashboard' as const, dashboardId: this.id };
	}

	private blocks(): BlockInstance[] {
		return this.s.layouts.dashboardLayout(this.id, () => (this.isHome ? withoutMissingTypes(this.s, materialize(DASHBOARD_LAYOUT)) : [])).blocks;
	}

	private draw(): void {
		const ctx = this.ctx;
		const s = this.s;
		if (this.editor) {
			ctx.component.removeChild(this.editor);
			this.editor = null;
		}
		this.page.empty();
		this.drawerHost = null;
		this.undoBtn = null;
		this.resetBtn = null;
		const meta = this.meta;
		this.drawnMeta = JSON.stringify(meta ?? null);
		if (!this.isHome && !meta) {
			this.editing = false;
			emptyState(this.page, {
				icon: 'layout-dashboard',
				title: 'This dashboard no longer exists',
				body: 'It may have been deleted on this or another device.',
				actionLabel: 'Back to Home',
				actionIcon: 'home',
				onAction: () => ctx.navigate(ROUTES.dashboard()),
			});
			ctx.setTitle('Dashboard');
			return;
		}
		ctx.setTitle(meta ? meta.name : s.world.name);
		this.page.toggleClass('is-editing', this.editing);
		this.page.toggleClass('ws-page--home', this.isHome);

		const blocks = this.blocks();
		if (this.editing) this.drawEditBar();
		else if (meta) this.drawHeader(meta);
		// Home's banner carries a Customize button; without one, a small toolbar does.
		else if (!blocks.some((b) => b.type === 'world-hero')) this.drawHomeTools();

		// Getting started (0.21): on Home, for worlds that have it switched on.
		if (this.isHome && !this.editing && guideOn(ctx.ws, s.worldId)) renderGuide(this.page, ctx.ws, s, (r) => ctx.navigate(r), () => this.draw(), (fn) => ctx.component.register(fn));

		let host: HTMLElement;
		if (this.editing) {
			const body = this.page.createDiv({ cls: 'ws-tasks-body ws-dash-edit' });
			host = body.createDiv({ cls: 'ws-dash-edit__layout' });
			this.drawerHost = body.createDiv({ cls: 'ws-tasks-drawer' });
		} else host = this.page.createDiv({ cls: 'ws-dash-view' });

		if (!blocks.length && !this.editing && meta?.seeded && !s.dashboards.hasLayout(this.id)) {
			// Listed (world.json synced) but its widgets file hasn't arrived yet: wait for it
			// rather than inviting edits that would overwrite the incoming widgets.
			const empty = host.createDiv({ cls: 'ws-dash-empty' });
			emptyState(empty, {
				icon: 'refresh-cw',
				title: 'This dashboard’s widgets are on their way',
				body: 'They were added on another device and haven’t synced to this one yet. They appear here as soon as they arrive.',
				actionLabel: 'Start it empty instead',
				actionIcon: 'plus',
				onAction: () => this.enterEditing(),
			});
			return;
		}
		if (!blocks.length && !this.editing) {
			const empty = host.createDiv({ cls: 'ws-dash-empty' });
			emptyState(empty, {
				icon: meta?.icon ?? 'layout-dashboard',
				title: 'An empty dashboard',
				body: 'Add lists, numbers, charts, images and shortcuts — whatever you want to see together.',
				actionLabel: 'Add widgets',
				actionIcon: 'plus',
				onAction: () => this.enterEditing(),
			});
			return;
		}

		const makeContext = (instance: BlockInstance, def: BlockDefinition, el: HTMLElement, component: Component, setTitle: (t: string) => void): BlockRenderContext => ({
			ws: ctx.ws,
			app: ctx.ws.app,
			session: s,
			el,
			instance,
			config: { ...def.defaultConfig, ...instance.config },
			component,
			surface: 'dashboard',
			navigate: (r, nl) => ctx.navigate(r, nl),
			setTitle,
		});
		const editor = new LayoutEditor({
			registry: ctx.ws.blocks,
			surface: 'dashboard',
			makeContext,
			onChange: (next) => this.save(next),
			openSettings: (instance, def, save) =>
				new BlockSettingsModal(ctx.ws, s, instance, def, (next) => {
					if (this.editor === editor) save(next);
					else if (this.editor?.current.find((b) => b.id === instance.id)?.type === instance.type) this.editor.patchBlock(instance.id, { config: next.config, title: next.title });
				}).open(),
		});
		this.editor = editor;
		ctx.component.addChild(editor);
		editor.mount(host, blocks);
		if (this.editing) {
			editor.setEditing(true);
			this.paintDrawer();
			this.paintButtons();
		}
	}

	// ── chrome ───────────────────────────────────────────────────────────────

	private drawHomeTools(): void {
		const tools = this.page.createDiv({ cls: 'ws-dash-tools' });
		button(tools, { label: 'Customize', icon: 'layout-grid', variant: 'ghost', size: 'sm', cls: 'ws-dash-tools__customize', tooltip: 'Arrange Home’s widgets', onClick: () => this.enterEditing() });
	}

	private drawHeader(meta: DashboardMeta): void {
		const head = this.page.createDiv({ cls: 'ws-db-header ws-dash-head' });
		const mark = head.createDiv({ cls: cx('ws-db-header__mark', `ws-tint--${meta.color ?? 'gray'}`) });
		icon(mark, meta.icon);
		const text = head.createDiv({ cls: 'ws-db-header__text' });
		text.createEl('h1', { cls: 'ws-db-header__title', text: meta.name });
		text.createDiv({ cls: 'ws-db-header__desc', text: meta.description || 'Your dashboard.' });
		const actions = head.createDiv({ cls: 'ws-db-header__actions' });
		button(actions, { label: 'Customize', icon: 'layout-grid', variant: 'ghost', cls: 'ws-dash-head__customize', onClick: () => this.enterEditing() });
		button(actions, { icon: 'more-horizontal', variant: 'quiet', tooltip: 'Dashboard options', cls: 'ws-dash-head__more', onClick: (evt) => this.menu(evt) });
		mountPageBanner({ ws: this.ctx.ws, session: this.s, component: this.ctx.component, header: head, key: pageBannerKey.dashboard(meta.id), label: meta.name });
	}

	private menu(evt: MouseEvent): void {
		const meta = this.meta;
		if (!meta) return;
		const s = this.s;
		const m = new Menu();
		m.addItem((i) => i.setTitle('Rename, icon & color…').setIcon('pencil').onClick(() => new DashboardModal(this.ctx.ws, s, { edit: meta }).open()));
		m.addItem((i) =>
			i
				.setTitle('Duplicate')
				.setIcon('copy')
				.onClick(() => {
					const copy = s.dashboards.duplicate(meta.id);
					if (copy) this.ctx.navigate(ROUTES.dashboard(copy.id));
				}),
		);
		m.addItem((i) => i.setTitle('Open in new tab').setIcon('file-plus-2').onClick(() => this.ctx.navigate(ROUTES.dashboard(meta.id), 'tab')));
		m.addSeparator();
		m.addItem((i) =>
			i
				.setTitle('Delete dashboard…')
				.setIcon('trash-2')
				.setWarning(true)
				.onClick(() => void deleteDashboard(this.ctx.ws, s, meta, () => this.ctx.navigate(ROUTES.dashboard()))),
		);
		m.showAtMouseEvent(evt);
	}

	private drawEditBar(): void {
		const meta = this.meta;
		const bar = this.page.createDiv({ cls: 'ws-editbar ws-editbar--dashboard' });
		icon(bar, 'layout-grid', 'ws-editbar__icon');
		const t = bar.createDiv({ cls: 'ws-editbar__text' });
		t.createEl('b', { text: `Customizing ${meta ? meta.name : 'Home'}. ` });
		t.createSpan({ text: 'Drag to rearrange, drag the right edge to resize, or open a widget’s settings.' });
		this.undoBtn = button(bar, { label: 'Undo', icon: 'undo-2', variant: 'ghost', size: 'sm', cls: 'ws-editbar__undo', onClick: () => this.undo() });
		if (this.isHome) this.resetBtn = button(bar, { label: 'Reset', icon: 'rotate-ccw', variant: 'ghost', size: 'sm', cls: 'ws-editbar__reset', onClick: () => void this.reset() });
		button(bar, { label: 'Done', icon: 'check', variant: 'primary', size: 'sm', cls: 'ws-editbar__done', onClick: () => this.exitEditing() });
	}

	private paintButtons(): void {
		if (this.undoBtn) this.undoBtn.disabled = this.undoStack.length === 0;
		if (this.resetBtn) this.resetBtn.disabled = !this.s.layouts.get(this.ref());
	}

	private paintDrawer(): void {
		if (!this.drawerHost || !this.editor) return;
		const listScroll = this.drawerHost.querySelector('.ws-widget-drawer__list')?.scrollTop ?? 0;
		const drawerScroll = this.drawerHost.querySelector('.ws-widget-drawer')?.scrollTop ?? 0;
		const oldSearch = this.drawerHost.querySelector<HTMLInputElement>('.ws-widget-drawer__search');
		const query = oldSearch?.value ?? '';
		const hadFocus = !!oldSearch && oldSearch === this.drawerHost.ownerDocument.activeElement;
		this.drawerHost.empty();
		const drawer = renderWidgetDrawer(this.drawerHost, this.ctx.ws.blocks, 'dashboard', this.editor.current, (type) => this.editor?.add(type), query);
		drawer.scrollTop = drawerScroll;
		const list = drawer.querySelector('.ws-widget-drawer__list');
		if (list) list.scrollTop = listScroll;
		if (hadFocus) drawer.querySelector<HTMLInputElement>('.ws-widget-drawer__search')?.focus();
	}

	// ── editing ──────────────────────────────────────────────────────────────

	private save(next: BlockInstance[]): void {
		const prev = this.s.layouts.get(this.ref());
		const before = prev?.blocks ?? this.blocks();
		this.undoStack.push({ blocks: JSON.parse(JSON.stringify(before)) as BlockInstance[], existed: !!prev });
		if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
		// A dashboard known only from its widgets file joins the list once it's edited.
		if (!this.isHome) this.s.dashboards.adopt(this.id);
		this.selfSave++;
		try {
			// Home falls back to the default when emptied; other dashboards may stay empty.
			this.s.layouts.save(this.ref(), next, this.meta?.name ?? 'Home', { keepEmpty: !this.isHome });
		} finally {
			this.selfSave--;
		}
		if (!next.length && this.isHome) {
			// An empty Home isn't kept: it falls back to the default. Show that after the
			// editor finishes this change, with Undo one click away.
			window.setTimeout(() => {
				if (!this.editing) return;
				this.editor?.replace(this.blocks());
				this.paintDrawer();
				this.paintButtons();
			}, 0);
			new Notice('An empty Home isn’t kept — it goes back to the default layout. Undo brings your widgets back.');
		}
		this.paintDrawer();
		this.paintButtons();
	}

	private undo(): void {
		const step = this.undoStack.pop();
		if (!step || !this.editing) return;
		this.selfSave++;
		try {
			if (step.existed) this.s.layouts.save(this.ref(), step.blocks, this.meta?.name ?? 'Home', { keepEmpty: !this.isHome });
			else this.s.layouts.reset(this.ref());
		} finally {
			this.selfSave--;
		}
		this.editor?.replace(step.blocks);
		this.paintDrawer();
		this.paintButtons();
	}

	private async reset(): Promise<void> {
		if (!this.s.layouts.get(this.ref())) return;
		const ok = await confirmModal(this.ctx.ws.app, {
			title: 'Reset Home?',
			body: 'Home goes back to Worldsmith’s default widgets. Your entries aren’t affected.',
			confirmLabel: 'Reset Home',
		});
		if (!ok) return;
		const removed = this.s.layouts.reset(this.ref());
		this.undoStack = [];
		this.draw();
		if (removed) actionNotice('Home is back to the default layout.', { label: 'Undo', run: () => undoLayoutReset(this.s, removed, 'Home') });
	}

	private enterEditing(): void {
		if (this.editing) return;
		this.editing = true;
		this.undoStack = [];
		this.draw();
	}

	private exitEditing(): void {
		this.editing = false;
		this.undoStack = [];
		this.draw();
	}

	private listen(): void {
		const s = this.s;
		const c = this.ctx.component;
		for (const ev of ['layout:saved', 'layout:deleted'] as const) {
			own(
				c,
				s.events.on(ev, ({ layout }) => {
					if (this.selfSave || layout.scope.kind !== 'dashboard' || layout.scope.dashboardId !== this.id) return;
					this.undoStack = [];
					this.draw();
				}),
			);
		}
		own(
			c,
			s.events.on('world:updated', ({ keys }) => {
				if (this.isHome) {
					if (keys.includes('name')) this.ctx.setTitle(s.world.name);
					return;
				}
				// Only this dashboard's own entry matters (renamed, recoloured, deleted).
				if (keys.includes('dashboards') && JSON.stringify(this.meta ?? null) !== this.drawnMeta) this.draw();
			}),
		);
		const onCustomize = () => this.enterEditing();
		this.page.addEventListener(CUSTOMIZE_DASHBOARD_EVENT, onCustomize);
		c.register(() => this.page.removeEventListener(CUSTOMIZE_DASHBOARD_EVENT, onCustomize));
		const onKey = (e: KeyboardEvent) => {
			if (!this.editing || !this.page.isConnected || !this.page.getClientRects().length) return;
			const leaf = this.page.closest('.workspace-leaf');
			if (leaf && !leaf.classList.contains('mod-active')) return;
			const t = e.target as HTMLElement;
			if (t !== t.ownerDocument.body && !(leaf ?? this.page).contains(t)) return;
			if (t.closest('input, textarea, select, [contenteditable="true"], .modal-container')) return;
			if (this.page.ownerDocument.querySelector('.modal-container, .menu')) return;
			if ((e.key === 'z' || e.key === 'Z') && Keymap.isModEvent(e) && !e.shiftKey) {
				e.preventDefault();
				this.undo();
			} else if (e.key === 'Escape') {
				e.preventDefault();
				this.exitEditing();
			}
		};
		this.page.ownerDocument.addEventListener('keydown', onKey);
		c.register(() => this.page.ownerDocument.removeEventListener('keydown', onKey));
	}
}

/** Ask the dashboard page containing `el` to enter Customize. */
export function customizeDashboard(el: HTMLElement): boolean {
	const page = el.querySelector('.ws-page--dashboard') ?? el.closest('.ws-page--dashboard');
	if (!page) return false;
	page.dispatchEvent(new CustomEvent(CUSTOMIZE_DASHBOARD_EVENT));
	return true;
}
