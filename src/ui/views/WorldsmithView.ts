import { featureOfRoute } from '../../core/features';
import { renderFeatureOff } from '../features/featuresPage';
import { releaseTooltips, setTooltipsEnabled, watchTooltips } from '../components/tooltips';
import { Component, ItemView, setIcon, type PaneType, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import { VIEW_TYPE_APP } from '../../app/constants';
import type { WorldsmithContext } from '../../app/context';
import { isRoute, ROUTES, sameRoute, type Route } from '../../state/route';
import { button, emptyState, nameRegion } from '../components/dom';
import { observeWidth, own } from '../components/lifecycle';
import { openPluginSettings, refreshLeafHeader } from '../obsidianInternals';
import type { RouteContext } from './routes/RouteRegistry';
import { SaveIndicator } from './shell/SaveIndicator';
import { Sidebar } from './shell/Sidebar';
import { applyLook, clearLook } from '../look';
import { clampSidebar } from '../../settings/settings';

/**
 * The single host view. It owns the app shell (sidebar + top bar + page) and an internal
 * route. The route is the view state, so Obsidian restores panes after restart, "open in
 * new tab" is just a new leaf with a route, and route changes join Obsidian's
 * back/forward history (result.history = true).
 */
export class WorldsmithView extends ItemView {
	route: Route = ROUTES.dashboard();
	#root: HTMLElement | null = null;
	#shell: Component | null = null;
	#page: Component | null = null;
	#sidebar: Sidebar | null = null;
	#pageEl: HTMLElement | null = null;
	#titleEl: HTMLElement | null = null;
	#titleIconEl: HTMLElement | null = null;
	#trailEl: HTMLElement | null = null;
	#pageTitle = '';
	#sidebarOpen = false;

	readonly ws: WorldsmithContext;

	constructor(leaf: WorkspaceLeaf, ws: WorldsmithContext) {
		super(leaf);
		this.ws = ws;
		this.navigation = true;
		this.icon = 'globe-2';
	}

	getViewType(): string {
		return VIEW_TYPE_APP;
	}

	/*
	 * Obsidian may call getDisplayText/getIcon from the base constructor, before `ws` and
	 * `route` are assigned — so both must work with nothing initialised.
	 */
	getDisplayText(): string {
		try {
			if (this.#pageTitle) return this.#pageTitle;
			const route = this.route;
			const def = route && this.ws?.routes.get(route.name);
			return def ? def.title(route.params ?? {}, this.ws.worlds.session) : 'Worldsmith';
		} catch {
			return 'Worldsmith';
		}
	}

	override getIcon(): string {
		try {
			const route = this.route;
			const def = route && this.ws?.routes.get(route.name);
			return def ? def.icon(route.params ?? {}, this.ws.worlds.session) : 'globe-2';
		} catch {
			return 'globe-2';
		}
	}

	override getState(): Record<string, unknown> {
		return { route: this.route };
	}

	override async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const next = (state as { route?: unknown } | null)?.route;
		if (isRoute(next) && !sameRoute(next, this.route)) {
			this.route = next;
			result.history = true;
			if (this.#root) this.ws_safe(() => this.ws_renderPage());
		}
		await super.setState(state, result);
	}

	protected override async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass('worldsmith-view');
		const root = this.contentEl.createDiv({ cls: 'worldsmith' });
		this.#root = root;
		watchTooltips(root);
		this.ws_safe(() => {
			this.ws_applyAppearance();
			observeWidth(this, root, (w) => {
				const size = w < 640 ? 'narrow' : w < 980 ? 'medium' : 'wide';
				if (root.dataset.wsSize === size) return;
				root.dataset.wsSize = size;
				// A drawer left open on a phone-width pane should not reappear when the pane narrows again.
				if (size !== 'narrow') this.ws_closeDrawer();
			});
			this.register(this.ws.worlds.onState(() => this.ws_safe(() => this.ws_buildShell())));
			own(this, this.ws.events.on('settings:changed', () => this.ws_applyAppearance()));
			this.ws_buildShell();
		});
		// Storage normally starts when the workspace is ready; make sure it has.
		void this.ws.ensureStarted();
	}

	/**
	 * Error boundary: anything that throws while building the UI is shown in the pane
	 * (with details for a bug report) instead of leaving it blank.
	 */
	private ws_safe(fn: () => void): void {
		try {
			fn();
		} catch (e) {
			console.error('[Worldsmith] failed to render', e);
			const root = this.#root;
			if (!root) return;
			root.empty();
			const box = root.createDiv({ cls: 'ws-page ws-fatal' });
			emptyState(box, {
				icon: 'alert-octagon',
				title: 'Worldsmith hit an error while drawing this page',
				body: e instanceof Error ? e.message : String(e),
				actionLabel: 'Try again',
				actionIcon: 'refresh-cw',
				onAction: () => this.ws_safe(() => this.ws_buildShell()),
			});
			const pre = box.createEl('pre', { cls: 'ws-fatal__details' });
			pre.setText(e instanceof Error && e.stack ? e.stack : String(e));
		}
	}

	protected override async onClose(): Promise<void> {
		releaseTooltips(this.contentEl.ownerDocument);
		const doc = this.contentEl.ownerDocument;
		if (doc !== document && !doc.querySelector('.worldsmith-view')) clearLook(doc);
		this.#page?.unload();
		this.#shell?.unload();
		this.#page = this.#shell = null;
	}

	/** Navigate within this pane (with history), or open elsewhere. */
	navigate(route: Route, newLeaf: boolean | PaneType = false): void {
		if (newLeaf) {
			void this.ws.open(route, { newLeaf });
			return;
		}
		if (sameRoute(route, this.route)) return;
		void this.leaf.setViewState({ type: VIEW_TYPE_APP, state: { route }, active: true });
	}

	private ws_applyAppearance(): void {
		if (!this.#root) return;
		const a = this.ws.settings.appearance;
		setTooltipsEnabled(a.tooltips);
		// A pane in a pop-out window has its own page to mark.
		if (this.#root.ownerDocument !== document) applyLook(this.#root.ownerDocument, a);
		this.#root.dataset.wsDensity = a.density;
		this.#root.dataset.wsMotion = a.animations ? 'on' : 'off';
		this.#root.toggleClass('is-full-width', a.fullWidth);
		const props: Record<string, string> = { '--ws-max-width': `${a.maxWidth}px` };
		if (a.fontMode === 'custom') {
			if (a.displayFont) props['--ws-font-display-custom'] = `'${a.displayFont.replace(/'/g, '')}'`;
			if (a.bodyFont) props['--ws-font-body-custom'] = `'${a.bodyFont.replace(/'/g, '')}'`;
		}
		this.#root.style.removeProperty('--ws-font-display-custom');
		this.#root.style.removeProperty('--ws-font-body-custom');
		this.#root.setCssProps(props);
	}

	// ── shell ─────────────────────────────────────────────────────────────────

	private ws_buildShell(): void {
		this.#page?.unload();
		this.#page = null;
		this.#shell?.unload();
		const root = this.#root;
		if (!root) return;
		const shell = new Component();
		this.#shell = shell;
		this.addChild(shell);
		// Load explicitly: children must initialise even if Obsidian hasn't loaded the
		// view yet when onOpen runs. (Component.load is idempotent.)
		shell.load();
		root.empty();
		this.#sidebar = null;
		const state = this.ws.worlds.state;

		if (state.kind === 'loading') {
			this.ws_renderSkeleton(root);
			return;
		}
		if (state.kind === 'error') {
			const box = root.createDiv({ cls: 'ws-page ws-fatal' });
			emptyState(box, {
				icon: 'alert-octagon',
				title: 'Worldsmith couldn’t open this world',
				body: state.message,
				actionLabel: 'Try again',
				actionIcon: 'refresh-cw',
				onAction: () => void this.ws.worlds.init(),
			});
			const more = box.createDiv({ cls: 'ws-fatal__more' });
			button(more, { label: 'Open settings & backups', icon: 'settings', variant: 'quiet', onClick: () => openPluginSettings(this.app, this.ws.plugin.manifest.id) });
			return;
		}

		const frame = root.createDiv({ cls: 'ws-shell' });
		frame.toggleClass('is-sidebar-hidden', this.ws.settings.sidebarHidden);
		frame.style.setProperty('--ws-side-w', `${this.ws.settings.sidebarWidth}px`);
		if (state.kind === 'ready') {
			const sideWrap = frame.createDiv({ cls: 'ws-shell__side' });
			this.ws_bindSideResize(frame, sideWrap);
			this.#sidebar = new Sidebar(sideWrap, this.ws, state.session, (r, nl) => {
				this.ws_closeDrawer();
				this.navigate(r, nl);
			});
			shell.addChild(this.#sidebar);
			const scrim = frame.createDiv({ cls: 'ws-shell__scrim' });
			scrim.addEventListener('click', () => this.ws_closeDrawer());
		}
		const main = frame.createDiv({ cls: 'ws-shell__main' });
		if (state.kind === 'ready') {
			const top = main.createDiv({ cls: 'ws-topbar' });
			button(top, {
				icon: 'panel-left',
				variant: 'quiet',
				size: 'sm',
				tooltip: 'Toggle sidebar',
				cls: 'ws-topbar__menu',
				onClick: () => this.ws_toggleDrawer(frame),
			});
			// Where you are: World › Characters › Auron Vale (each step but the last is a link).
			const title = top.createEl('nav', { cls: 'ws-topbar__title ws-trail', attr: { 'aria-label': 'You are here' } });
			this.#titleIconEl = title.createSpan({ cls: 'ws-icon ws-topbar__icon' });
			this.#trailEl = title.createSpan({ cls: 'ws-trail__steps' });
			this.#titleEl = title.createSpan({ cls: 'ws-topbar__text ws-trail__here', attr: { 'aria-current': 'page' } });
			top.createDiv({ cls: 'ws-topbar__spacer' });
			shell.addChild(new SaveIndicator(top, this.ws));
		}
		this.#pageEl = main.createDiv({ cls: 'ws-shell__page' });
		this.ws_renderPage();
	}

	/** Drag the sidebar's right edge to resize it (double-click puts it back). Saved for next time. */
	private ws_bindSideResize(frame: HTMLElement, side: HTMLElement): void {
		const grip = side.createDiv({ cls: 'ws-shell__resize', attr: { role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Resize the sidebar', tabindex: '0' } });
		const set = (w: number, save: boolean) => {
			const width = clampSidebar(w);
			frame.style.setProperty('--ws-side-w', `${width}px`);
			grip.setAttr('aria-valuenow', String(width));
			if (save && width !== this.ws.settings.sidebarWidth) {
				this.ws.settings.sidebarWidth = width;
				void this.ws.saveSettings();
			}
		};
		grip.addEventListener('pointerdown', (evt) => {
			if (evt.button !== 0) return;
			evt.preventDefault();
			const start = evt.clientX;
			const w0 = side.getBoundingClientRect().width;
			let last = start;
			try {
				grip.setPointerCapture(evt.pointerId);
			} catch {
				/* the pointer is already gone */
			}
			frame.addClass('is-resizing-side');
			const move = (ev: PointerEvent) => {
				last = ev.clientX;
				set(w0 + last - start, false);
			};
			// Released, cancelled (a touch taken over by scrolling) or lost: the drag always ends here.
			const end = (ev: PointerEvent) => {
				grip.removeEventListener('pointermove', move);
				grip.removeEventListener('pointerup', end);
				grip.removeEventListener('pointercancel', end);
				grip.removeEventListener('lostpointercapture', end);
				frame.removeClass('is-resizing-side');
				set(w0 + (ev.type === 'pointerup' ? ev.clientX : last) - start, true);
			};
			grip.addEventListener('pointermove', move);
			grip.addEventListener('pointerup', end);
			grip.addEventListener('pointercancel', end);
			grip.addEventListener('lostpointercapture', end);
		});
		grip.addEventListener('dblclick', () => set(252, true));
		grip.addEventListener('keydown', (evt) => {
			const step = evt.shiftKey ? 40 : 10;
			if (evt.key === 'ArrowLeft') set(this.ws.settings.sidebarWidth - step, true);
			else if (evt.key === 'ArrowRight') set(this.ws.settings.sidebarWidth + step, true);
			else return;
			evt.preventDefault();
		});
	}

	/** The steps before the page's own name in the top bar. */
	private ws_paintTrail(route: Route): void {
		const el = this.#trailEl;
		if (!el) return;
		el.empty();
		const s = this.ws.worlds.session;
		if (!s) return;
		const steps: { label: string; route: Route; anc?: boolean }[] = [];
		const isHome = route.name === 'dashboard' && (!route.params?.id || route.params.id === 'home');
		if (!isHome) steps.push({ label: this.ws.worlds.state.kind === 'ready' ? s.world.name : 'Home', route: ROUTES.dashboard() });
		if (route.name === 'entity') {
			const e = s.entities.get(route.params?.id ?? '');
			const schema = e ? s.schemas.get(e.typeId) : undefined;
			if (e && schema) {
				steps.push({ label: schema.plural, route: ROUTES.database(schema.id) });
				const chain: { label: string; route: Route; anc?: boolean }[] = [];
				const seen = new Set<string>([e.id]);
				let p = e.parentId ? s.entities.get(e.parentId) : undefined;
				while (p && !seen.has(p.id) && chain.length < 4) {
					chain.unshift({ label: p.name, route: ROUTES.entity(p.id), anc: true });
					seen.add(p.id);
					p = p.parentId ? s.entities.get(p.parentId) : undefined;
				}
				// Deeper than four: the top of the chain is shortened to "…" (a link to the next step up).
				if (p && !seen.has(p.id)) chain.unshift({ label: '…', route: ROUTES.entity(p.id), anc: true });
				steps.push(...chain);
			}
		}
		for (const st of steps) {
			const a = el.createEl('a', { cls: st.anc ? 'ws-trail__step ws-trail__step--anc' : 'ws-trail__step', text: st.label, attr: { href: '#' } });
			a.addEventListener('click', (evt) => {
				evt.preventDefault();
				this.navigate(st.route, evt.metaKey || evt.ctrlKey);
			});
			el.createSpan({ cls: 'ws-trail__sep', text: '/', attr: { 'aria-hidden': 'true' } });
		}
	}

	/** Narrow panes: overlay drawer. Wider panes: hide/show the docked sidebar. */
	private ws_toggleDrawer(frame: HTMLElement): void {
		if (this.#root?.dataset.wsSize === 'narrow') {
			this.#sidebarOpen = !this.#sidebarOpen;
			frame.toggleClass('is-drawer-open', this.#sidebarOpen);
		} else {
			const hidden = !frame.hasClass('is-sidebar-hidden');
			frame.toggleClass('is-sidebar-hidden', hidden);
			this.ws.settings.sidebarHidden = hidden;
			void this.ws.saveSettings();
		}
	}

	private ws_closeDrawer(): void {
		if (!this.#sidebarOpen) return;
		this.#sidebarOpen = false;
		this.#root?.querySelector('.ws-shell')?.removeClass('is-drawer-open');
	}

	private ws_renderSkeleton(root: HTMLElement): void {
		const sk = root.createDiv({ cls: 'ws-skeleton', attr: { 'aria-busy': 'true'} });
		nameRegion(sk, 'Loading your world' );
		const side = sk.createDiv({ cls: 'ws-skeleton__side' });
		for (let i = 0; i < 9; i++) side.createDiv({ cls: 'ws-skeleton__line' });
		const main = sk.createDiv({ cls: 'ws-skeleton__main' });
		main.createDiv({ cls: 'ws-skeleton__hero' });
		const row = main.createDiv({ cls: 'ws-skeleton__row' });
		row.createDiv({ cls: 'ws-skeleton__card' });
		row.createDiv({ cls: 'ws-skeleton__card' });
	}

	// ── page ──────────────────────────────────────────────────────────────────

	private ws_renderPage(): void {
		if (!this.#pageEl) return;
		this.#page?.unload();
		this.#page = new Component();
		this.#shell?.addChild(this.#page);
		this.#pageEl.empty();
		this.#pageEl.scrollTop = 0;
		this.#pageTitle = '';

		const state = this.ws.worlds.state;
		let route = this.route;
		// With no world yet, only pages that work without one (welcome, Help) can show (0.21).
		if (state.kind === 'onboarding' && route.name !== 'onboarding' && this.ws.routes.get(route.name)?.needsWorld !== false) route = ROUTES.onboarding();
		if (state.kind !== 'ready' && state.kind !== 'onboarding') return;

		const def = this.ws.routes.get(route.name) ?? this.ws.routes.get('dashboard');
		if (!def) return;
		const session = this.ws.worlds.session;
		if (def.needsWorld && !session) return;

		const ctx: RouteContext = {
			ws: this.ws,
			session,
			el: this.#pageEl,
			params: { ...(route.params ?? {}) },
			component: this.#page,
			navigate: (r, nl) => this.navigate(r, nl),
			replaceParams: (params) => {
				this.route = { ...this.route, params };
				this.app.workspace.requestSaveLayout();
			},
			setTitle: (t) => {
				this.#pageTitle = t;
				if (this.#titleEl) this.#titleEl.setText(t);
				refreshLeafHeader(this.leaf);
			},
		};
		if (this.#titleEl) this.#titleEl.setText(def.title(ctx.params, session));
		this.ws_paintTrail(route);
		// Keep the trail current: an entry moved or renamed, a parent renamed, the world renamed.
		if (session) {
			let queued = false;
			const repaint = () => {
				if (queued) return;
				queued = true;
				window.requestAnimationFrame(() => {
					queued = false;
					this.ws_paintTrail(route);
				});
			};
			own(this.#page, session.events.on('entity:updated', repaint));
			own(this.#page, session.events.on('world:updated', ({ keys }) => keys.includes('name') && repaint()));
		}
		if (this.#titleIconEl) setIcon(this.#titleIconEl, def.icon(ctx.params, session));
		this.#sidebar?.setActive(route);
		// A part the world has switched off (0.29): say so, with a way to turn it back on.
		if (session) {
			own(this.#page, session.events.on('world:updated', ({ keys }) => keys.includes('features') && this.ws_renderPage()));
			const f = featureOfRoute(route.name, route.params);
			if (f && !this.ws.features.isOn(f)) {
				renderFeatureOff(ctx, f);
				refreshLeafHeader(this.leaf);
				return;
			}
		}
		try {
			def.render(ctx);
			// Mark the page container for full-screen and Layout Studio pages (instead of CSS :has).
			const mark = () => {
				const pe = this.#pageEl;
				pe.toggleClass('has-full-page', !!pe.querySelector(':scope > .ws-page--full'));
				pe.toggleClass('has-layout-studio', !!pe.querySelector(':scope > .ws-page--layout-studio'));
			};
			mark();
			window.requestAnimationFrame(mark);
		} catch (e) {
			console.error('[Worldsmith] page failed to render', e);
			emptyState(this.#pageEl, { icon: 'alert-triangle', title: 'This page couldn’t be displayed', body: String(e) });
		}
		refreshLeafHeader(this.leaf);
	}
}
