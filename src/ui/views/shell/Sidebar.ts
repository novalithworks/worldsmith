import { featureOfRoute, type FeatureId } from '../../../core/features';
import { Component, Menu, setIcon, type PaneType } from 'obsidian';
import type { WorldsmithContext } from '../../../app/context';
import type { SidebarConfig, SidebarItem } from '../../../core/types';
import type { WorldSession } from '../../../services/WorldSession';
import { addDays, today } from '../../../core/util/dates';
import { ROUTES, sameRoute, type Route } from '../../../state/route';
import { openCreateEntity, openNewType, openSearch } from '../../actions';
import { DashboardModal, deleteDashboard, openNewDashboard } from '../../dashboards/DashboardModal';
import { button, icon, cx, nameRegion } from '../../components/dom';
import { own } from '../../components/lifecycle';
import { openPluginSettings } from '../../obsidianInternals';
import { WorldEditModal } from '../../components/WorldEditModal';
import { DeletedWorldsModal, DeleteWorldModal } from '../../components/worldDelete';

/**
 * Application navigation: world switcher, search, create, then the world's configurable
 * groups (types + tools). Counts update live; only the counts are repainted on edits.
 */
export class Sidebar extends Component {
	readonly el: HTMLElement;
	private nav!: HTMLElement;
	private items = new Map<string, { el: HTMLElement; count?: HTMLElement; route: Route }>();
	private countsQueued = false;
	private showDashboards: boolean;

	constructor(
		parent: HTMLElement,
		private readonly ws: WorldsmithContext,
		private readonly session: WorldSession,
		private readonly navigate: (r: Route, newLeaf?: boolean | PaneType) => void,
	) {
		super();
		this.el = parent.createEl('nav', { cls: 'ws-sidebar', attr: { } });
		nameRegion(this.el, 'Worldsmith navigation' );
		this.showDashboards = ws.settings.showDashboards;
	}

	override onload(): void {
		this.render();
		const s = this.session;
		const counts = () => this.queueCounts();
		own(this, s.events.on('entity:created', counts));
		own(this, s.events.on('entity:deleted', counts));
		own(this, s.events.on('entity:updated', ({ change }) => {
			if (change.keys.some((k) => k === 'trashedAt' || k === 'archivedAt' || k === 'typeId')) counts();
		}));
		own(this, s.events.on('world:updated', ({ keys }) => {
			if (keys.some((k) => k === 'sidebar' || k === 'name' || k === 'icon' || k === 'dashboards' || k === 'features')) this.render();
		}));
		// Widgets of a dashboard missing from the list (synced ahead of it) list it too.
		for (const ev of ['layout:saved', 'layout:deleted'] as const) {
			own(this, s.events.on(ev, ({ layout }) => {
				if (layout.scope.kind === 'dashboard' && layout.scope.dashboardId !== 'home' && !s.world.dashboards.some((d) => d.id === (layout.scope as { dashboardId: string }).dashboardId)) this.render();
			}));
		}
		own(this, this.ws.events.on('settings:changed', () => {
			if (this.ws.settings.showDashboards === this.showDashboards) return;
			this.showDashboards = this.ws.settings.showDashboards;
			this.render();
		}));
		for (const ev of ['task:created', 'task:updated', 'task:deleted'] as const) own(this, s.events.on(ev, counts));
		own(this, s.events.on('schema:created', () => this.render()));
		own(this, s.events.on('schema:updated', () => this.render()));
	}

	setActive(route: Route | null): void {
		// One-shot parameters (open in Customize) don't make it a different page.
		if (route?.params?.edit) {
			const { edit: _e, ...rest } = route.params;
			void _e;
			route = { ...route, params: rest };
		}
		for (const { el, route: r } of this.items.values()) {
			const active = !!route && (sameRoute(r, route) || (r.name === 'writing' && route.name === 'writing') || (r.name === 'database' && route.name === 'entity' && this.typeOfEntityRoute(route) === r.params?.typeId));
			el.toggleClass('is-active', active);
			if (active) el.setAttr('aria-current', 'page');
			else el.removeAttribute('aria-current');
		}
	}

	private typeOfEntityRoute(route: Route): string | undefined {
		const id = route.params?.id;
		return id ? this.session.entities.get(id)?.typeId : undefined;
	}

	private render(): void {
		const s = this.session;
		const world = s.world;
		this.el.empty();
		this.items.clear();

		// World switcher
		const top = this.el.createDiv({ cls: 'ws-sidebar__top' });
		const switcher = top.createEl('button', { cls: 'ws-world-switch', attr: { type: 'button', 'aria-haspopup': 'menu' } });
		const seal = switcher.createSpan({ cls: 'ws-world-switch__seal' });
		setIcon(seal, world.icon || 'globe-2');
		const label = switcher.createSpan({ cls: 'ws-world-switch__text' });
		label.createSpan({ cls: 'ws-world-switch__eyebrow', text: 'Worldsmith' });
		label.createSpan({ cls: 'ws-world-switch__name', text: world.name });
		icon(switcher, 'chevrons-up-down', 'ws-world-switch__caret');
		switcher.addEventListener('click', () => void this.worldMenu(switcher));

		const quick = top.createDiv({ cls: 'ws-sidebar__quick' });
		const searchBtn = quick.createEl('button', { cls: 'ws-sidebar__search', attr: { type: 'button' } });
		icon(searchBtn, 'search');
		searchBtn.createSpan({ text: 'Search' });
		searchBtn.addEventListener('click', (e) => (e.altKey ? this.navigate(ROUTES.search()) : openSearch(this.ws)));
		button(quick, { icon: 'plus', variant: 'primary', size: 'sm', tooltip: 'Create…', cls: 'ws-sidebar__create', onClick: () => openCreateEntity(this.ws) });

		this.nav = this.el.createDiv({ cls: 'ws-sidebar__nav' });
		this.item(this.nav, { key: 'route:dashboard', label: 'Home', icon: 'home', route: ROUTES.dashboard() });
		// Parts the world has switched off aren't listed (0.29).
		const on = (f: FeatureId) => this.ws.features.isOn(f);
		if (on('tasks')) this.item(this.nav, { key: 'route:tasks', label: 'Tasks', icon: 'list-checks', route: ROUTES.tasks(), withCount: true });
		if (on('writing')) this.item(this.nav, { key: 'route:writing', label: 'Writing Studio', icon: 'feather', route: ROUTES.writing() });
		if (this.showDashboards && on('dashboards')) this.dashboardsGroup();

		const hidden = new Set(world.sidebar.hidden);
		for (const group of world.sidebar.groups) {
			const visible = group.items.filter((i) => !hidden.has(itemKey(i)) && this.resolvable(i) && !(i.kind === 'route' && i.route === 'features') && !(i.kind === 'route' && (() => { const f = featureOfRoute(i.route); return !!f && !on(f); })()));
			if (!visible.length) continue;
			const collapsedKey = `${world.id}:${group.id}`;
			const g = this.nav.createDiv({ cls: 'ws-nav-group' });
			const head = g.createEl('button', { cls: 'ws-nav-group__head', attr: { type: 'button', 'aria-expanded': 'true' } });
			head.createSpan({ cls: 'ws-nav-group__label', text: group.label });
			const caret = head.createSpan({ cls: 'ws-nav-group__caret' });
			setIcon(caret, 'chevron-down');
			const body = g.createDiv({ cls: 'ws-nav-group__body' });
			const apply = () => {
				const c = !!this.ws.settings.sidebarCollapsed[collapsedKey];
				g.toggleClass('is-collapsed', c);
				head.setAttr('aria-expanded', String(!c));
			};
			head.addEventListener('click', () => {
				this.ws.settings.sidebarCollapsed[collapsedKey] = !this.ws.settings.sidebarCollapsed[collapsedKey];
				void this.ws.saveSettings();
				apply();
			});
			apply();
			for (const it of visible) this.groupItem(body, it, group.id);
		}

		// Footer
		const foot = this.el.createDiv({ cls: 'ws-sidebar__foot' });
		// Features lives here, beside Settings, for every world however its sidebar is arranged (0.29.2).
		this.item(foot, { key: 'route:features', label: 'Features', icon: 'toggle-right', route: ROUTES.features() });
		const settings = foot.createEl('button', { cls: 'ws-nav-item', attr: { type: 'button' } });
		icon(settings, 'settings', 'ws-nav-item__icon');
		settings.createSpan({ cls: 'ws-nav-item__label', text: 'Settings' });
		settings.addEventListener('click', () => openPluginSettings(this.ws.app, this.ws.plugin.manifest.id));
		this.paintCounts();
	}

	/** "Dashboard" with one, "Dashboards" otherwise; a "+" in the header adds one. */
	private dashboardsGroup(): void {
		const s = this.session;
		const list = s.dashboards.list();
		const collapsedKey = `${s.worldId}:__dashboards`;
		const g = this.nav.createDiv({ cls: 'ws-nav-group ws-nav-group--dashboards' });
		const headRow = g.createDiv({ cls: 'ws-nav-group__headrow' });
		const head = headRow.createEl('button', { cls: 'ws-nav-group__head', attr: { type: 'button', 'aria-expanded': 'true' } });
		head.createSpan({ cls: 'ws-nav-group__label', text: list.length === 1 ? 'Dashboard' : 'Dashboards' });
		const caret = head.createSpan({ cls: 'ws-nav-group__caret' });
		setIcon(caret, 'chevron-down');
		const add = headRow.createEl('button', { cls: 'ws-nav-group__add clickable-icon', attr: { type: 'button', 'aria-label': 'New dashboard' } });
		setIcon(add, 'plus');
		add.addEventListener('click', () => openNewDashboard(this.ws, s, (r) => this.navigate(r)));
		const body = g.createDiv({ cls: 'ws-nav-group__body' });
		const apply = () => {
			const c = !!this.ws.settings.sidebarCollapsed[collapsedKey];
			g.toggleClass('is-collapsed', c);
			head.setAttr('aria-expanded', String(!c));
		};
		head.addEventListener('click', () => {
			this.ws.settings.sidebarCollapsed[collapsedKey] = !this.ws.settings.sidebarCollapsed[collapsedKey];
			void this.ws.saveSettings();
			apply();
		});
		apply();
		if (!list.length) {
			const el = body.createEl('a', { cls: 'ws-nav-item ws-nav-item--ghost', attr: { href: '#' } });
			icon(el, 'plus', 'ws-nav-item__icon');
			el.createSpan({ cls: 'ws-nav-item__label', text: 'New dashboard' });
			el.addEventListener('click', (evt) => {
				evt.preventDefault();
				openNewDashboard(this.ws, s, (r) => this.navigate(r));
			});
			return;
		}
		list.forEach((d, i) => {
			const el = this.item(body, { key: `dash:${d.id}`, label: d.name, icon: d.icon, route: ROUTES.dashboard(d.id), tint: d.color ?? undefined });
			el.addEventListener('contextmenu', (evt) => {
				evt.preventDefault();
				const m = new Menu();
				m.addItem((it) => it.setTitle('Open in new tab').setIcon('file-plus-2').onClick(() => this.navigate(ROUTES.dashboard(d.id), 'tab')));
				m.addItem((it) => it.setTitle('Rename, icon & color…').setIcon('pencil').onClick(() => new DashboardModal(this.ws, s, { edit: d }).open()));
				m.addItem((it) =>
					it
						.setTitle('Duplicate')
						.setIcon('copy')
						.onClick(() => {
							const copy = s.dashboards.duplicate(d.id);
							if (copy) this.navigate(ROUTES.dashboard(copy.id));
						}),
				);
				m.addSeparator();
				if (i > 0) m.addItem((it) => it.setTitle('Move up').setIcon('arrow-up').onClick(() => s.dashboards.move(d.id, -1)));
				if (i < list.length - 1) m.addItem((it) => it.setTitle('Move down').setIcon('arrow-down').onClick(() => s.dashboards.move(d.id, 1)));
				m.addItem((it) => it.setTitle('New dashboard…').setIcon('plus').onClick(() => openNewDashboard(this.ws, s, (r) => this.navigate(r))));
				m.addSeparator();
				m.addItem((it) =>
					it
						.setTitle('Delete…')
						.setIcon('trash-2')
						.setWarning(true)
						.onClick(() => void deleteDashboard(this.ws, s, d)),
				);
				m.showAtMouseEvent(evt);
			});
		});
	}

	private resolvable(i: SidebarItem): boolean {
		if (i.kind === 'type') {
			const s = this.session.schemas.get(i.typeId);
			return !!s && !s.archived;
		}
		return this.ws.routes.has(i.route);
	}

	private groupItem(parent: HTMLElement, it: SidebarItem, groupId: string): void {
		if (it.kind === 'type') {
			const schema = this.session.schemas.get(it.typeId);
			if (!schema) return;
			const el = this.item(parent, {
				key: itemKey(it),
				label: schema.plural,
				icon: schema.icon,
				route: ROUTES.database(schema.id),
				tint: schema.color ?? undefined,
				withCount: true,
			});
			el.addEventListener('contextmenu', (evt) => {
				evt.preventDefault();
				const menu = new Menu();
				menu.addItem((i) => i.setTitle(`New ${schema.singular.toLowerCase()}`).setIcon('plus').onClick(() => openCreateEntity(this.ws, { typeId: schema.id })));
				menu.addItem((i) => i.setTitle('Open in new tab').setIcon('file-plus-2').onClick(() => this.navigate(ROUTES.database(schema.id), 'tab')));
				menu.addSeparator();
				menu.addItem((i) => i.setTitle('Move up').setIcon('arrow-up').onClick(() => this.moveItem(groupId, it, -1)));
				menu.addItem((i) => i.setTitle('Move down').setIcon('arrow-down').onClick(() => this.moveItem(groupId, it, 1)));
				menu.addItem((i) => i.setTitle('Hide from sidebar').setIcon('eye-off').onClick(() => this.hide(it)));
				menu.showAtMouseEvent(evt);
			});
		} else {
			const def = this.ws.routes.get(it.route);
			this.item(parent, {
				key: itemKey(it),
				label: it.label ?? def?.title({}, this.session) ?? it.route,
				icon: it.icon ?? def?.icon({}, this.session) ?? 'circle',
				route: { name: it.route },
			});
		}
	}

	private item(parent: HTMLElement, o: { key: string; label: string; icon: string; route: Route; tint?: string; withCount?: boolean }): HTMLElement {
		const el = parent.createEl('a', { cls: cx('ws-nav-item', o.tint ? `ws-tint--${o.tint}` : ''), attr: { href: '#' } });
		icon(el, o.icon, 'ws-nav-item__icon');
		el.createSpan({ cls: 'ws-nav-item__label', text: o.label });
		const count = o.withCount ? el.createSpan({ cls: 'ws-nav-item__count' }) : undefined;
		el.addEventListener('click', (evt) => {
			evt.preventDefault();
			this.navigate(o.route, evt.metaKey || evt.ctrlKey ? 'tab' : false);
		});
		el.addEventListener('auxclick', (evt) => {
			if (evt.button === 1) {
				evt.preventDefault();
				this.navigate(o.route, 'tab');
			}
		});
		this.items.set(o.key, { el, count, route: o.route });
		return el;
	}

	private queueCounts(): void {
		if (this.countsQueued) return;
		this.countsQueued = true;
		window.requestAnimationFrame(() => {
			this.countsQueued = false;
			this.paintCounts();
		});
	}

	private paintCounts(): void {
		const tasks = this.items.get('route:tasks');
		if (tasks?.count) {
			// Open tasks due within the next 7 days, overdue included.
			const now = today();
			const end = addDays(now, 6);
			const n = this.session.tasks.visible().filter((t) => t.status !== 'done' && t.due && t.due <= end).length;
			tasks.count.setText(n ? String(n) : '');
			tasks.count.toggleClass('is-badge', n > 0);
			tasks.el.setAttr('aria-label', n ? `Tasks, ${n} due soon` : 'Tasks');
		}
		for (const [key, it] of this.items) {
			if (!it.count || !key.startsWith('type:')) continue;
			const n = this.session.index.countOfType(key.slice(5));
			it.count.setText(n ? n.toLocaleString() : '');
		}
	}

	private async worldMenu(anchor: HTMLElement): Promise<void> {
		const deleted = (await this.ws.worldTrash.list().catch(() => [])).length;
		const menu = new Menu();
		const manifest = this.ws.worlds.manifest();
		for (const w of manifest?.worlds ?? []) {
			menu.addItem((i) =>
				i
					.setTitle(w.name)
					.setIcon('globe-2')
					.setChecked(w.id === this.session.worldId)
					.onClick(() => {
						if (w.id !== this.session.worldId) void this.ws.worlds.switchWorld(w.id).then(() => this.navigate(ROUTES.dashboard()));
					}),
			);
		}
		menu.addSeparator();
		menu.addItem((i) =>
			i
				.setTitle('Rename & edit this world…')
				.setIcon('pencil')
				.onClick(() => {
					const w = this.session.world;
					new WorldEditModal(this.ws, w, 'Edit world', 'Save', (v) => {
						this.session.updateWorld(v);
						this.ws.worlds.syncManifestName(this.session.world);
					}).open();
				}),
		);
		menu.addItem((i) => i.setTitle('New world…').setIcon('plus').onClick(() => this.navigate(ROUTES.onboarding())));
		if (deleted) menu.addItem((i) => i.setTitle(`Deleted worlds (${deleted})…`).setIcon('archive').onClick(() => new DeletedWorldsModal(this.ws, () => this.navigate(ROUTES.dashboard())).open()));
		menu.addItem((i) => i.setTitle('New entity type…').setIcon('shapes').onClick(() => openNewType(this.ws)));
		if (this.session.world.sidebar.hidden.length) {
			menu.addItem((i) =>
				i.setTitle('Show hidden sidebar items').setIcon('eye').onClick(() => {
					this.session.updateWorld({ sidebar: { ...clone(this.session.world.sidebar), hidden: [] } });
				}),
			);
		}
		menu.addItem((i) => i.setTitle('Features…').setIcon('toggle-right').onClick(() => this.navigate({ name: 'features', params: {} })));
		menu.addItem((i) => i.setTitle('Help & getting started').setIcon('circle-help').onClick(() => this.navigate({ name: 'help', params: {} })));
		menu.addSeparator();
		menu.addItem((i) =>
			i
				.setTitle('Delete this world…')
				.setIcon('trash-2')
				.setWarning(true)
				.onClick(() => new DeleteWorldModal(this.ws, () => this.navigate(this.ws.worlds.session ? ROUTES.dashboard() : ROUTES.onboarding())).open()),
		);
		const r = anchor.getBoundingClientRect();
		menu.showAtPosition({ x: r.left, y: r.bottom + 4 });
	}

	private hide(it: SidebarItem): void {
		const sidebar = clone(this.session.world.sidebar);
		sidebar.hidden = [...new Set([...sidebar.hidden, itemKey(it)])];
		this.session.updateWorld({ sidebar });
	}

	private moveItem(groupId: string, it: SidebarItem, delta: number): void {
		const sidebar = clone(this.session.world.sidebar);
		const g = sidebar.groups.find((x) => x.id === groupId);
		if (!g) return;
		const idx = g.items.findIndex((x) => itemKey(x) === itemKey(it));
		const to = idx + delta;
		if (idx < 0 || to < 0 || to >= g.items.length) return;
		const [moved] = g.items.splice(idx, 1);
		if (moved) g.items.splice(to, 0, moved);
		this.session.updateWorld({ sidebar });
	}
}

function itemKey(i: SidebarItem): string {
	return i.kind === 'type' ? `type:${i.typeId}` : `route:${i.route}`;
}

function clone(c: SidebarConfig): SidebarConfig {
	return JSON.parse(JSON.stringify(c)) as SidebarConfig;
}
