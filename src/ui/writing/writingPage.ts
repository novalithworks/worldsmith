import { sceneHas } from '../../services/writing/world';
import { ArcsScreen } from './arcs';
import { startSprint } from './sprint';
import { renderGoals } from './goalsPage';
import { RevisionScreen } from './revisionPage';
import { CompileScreen } from './compilePage';
import { ResearchScreen } from './researchPage';
import { SettingsScreen } from './settingsPage';
import { Menu, type PaneType } from 'obsidian';
import type { WritingProject } from '../../core/types';
import type { WorldSession } from '../../services/WorldSession';
import { ROUTES } from '../../state/route';
import { cx, icon } from '../components/dom';
import { own } from '../components/lifecycle';
import type { Popover } from '../components/popover';
import type { RouteContext, RouteDefinition } from '../views/routes/RouteRegistry';
import { importFolder, newProject } from './actions';
import { cover, fmt, type Studio, type StudioScreen, type StudioView } from './kit';
import { ManuscriptScreen } from './manuscript';
import { kindLabel, projectStatus } from './model';
import { renderHome, renderLibrary, renderOverview, renderTrash, type LibraryState } from './screens';
import { BoardScreen } from './board';
import { BOARD_VIEWS, isBoardView } from './boards';
import { deviceMemory } from './device';
import { PlotScreen } from './plot';
import { openWritingSettings } from './settingsPanel';

/*
 * The Writing Studio page (WS2; the editor inside it is WS3). One route, `writing`, with `project`, `view` and `item`
 * params: outside a project it shows Home or the Projects shelf, inside one its Overview,
 * Manuscript or Trash. The top bar holds the project switcher, the tabs and the project's
 * word count. Every change goes through `session.writing`; the page only listens for
 * `writing:changed` / `writing:words` and redraws.
 */

const VIEWS_OUT: ReadonlyArray<{ id: StudioView; label: string; icon: string }> = [
	{ id: 'home', label: 'Home', icon: 'home' },
	{ id: 'projects', label: 'Projects', icon: 'library' },
	{ id: 'stats', label: 'Goals & stats', icon: 'target' },
];
const VIEWS_IN: ReadonlyArray<{ id: StudioView; label: string; icon: string }> = [
	{ id: 'overview', label: 'Overview', icon: 'book-open' },
	{ id: 'manuscript', label: 'Manuscript', icon: 'feather' },
	// WS4: the Story board tab opens the board used last (Corkboard at first).
	{ id: 'corkboard', label: 'Story board', icon: 'layout-grid' },
	{ id: 'plot', label: 'Plot', icon: 'spline' },
	// WS5: one character through the book.
	{ id: 'arcs', label: 'Character arcs', icon: 'trending-up' },
	{ id: 'goals', label: 'Goals', icon: 'target' },
	{ id: 'revision', label: 'Revision', icon: 'history' },
	{ id: 'research', label: 'Research', icon: 'library' },
	{ id: 'compile', label: 'Compile', icon: 'file-output' },
];

function projectOf(p: Record<string, string>, s: WorldSession | null): WritingProject | null {
	return (p.project && s?.writing.project(p.project)) || null;
}

export const writingRoute: RouteDefinition = {
	id: 'writing',
	needsWorld: true,
	title: (p, s) => projectOf(p, s)?.name ?? 'Writing Studio',
	icon: () => 'feather',
	render(ctx) {
		new WritingStudio(ctx).mount();
	},
};

/** The projects shelf's filter and sort, kept while the studio is open in this window. */
const library: LibraryState = { filter: 'all', sort: 'edited' };

class WritingStudio implements Studio {
	readonly view: StudioView;
	private readonly projectId: string | null;
	private pageEl!: HTMLElement;
	private topEl!: HTMLElement;
	private bodyEl!: HTMLElement;
	private screen: StudioScreen | null = null;
	private timer: number | null = null;
	private dead = false;
	private settingsPop: Popover | null = null;

	constructor(private readonly ctx: RouteContext) {
		const p = projectOf(ctx.params, ctx.session);
		this.projectId = p?.id ?? null;
		const asked = ctx.params.view as StudioView | undefined;
		const inside: StudioView[] = ['overview', 'manuscript', 'trash', 'plot', 'arcs', 'goals', 'revision', 'research', 'compile', ...BOARD_VIEWS.map((b) => b.id)];
		const outside: StudioView[] = ['home', 'projects', 'stats', 'settings'];
		this.view = p ? (asked && inside.includes(asked) ? asked : 'overview') : asked && outside.includes(asked) ? asked : 'home';
	}

	get ws() {
		return this.ctx.ws;
	}
	get s(): WorldSession {
		return this.ctx.session!;
	}
	get w() {
		return this.s.writing;
	}
	get component() {
		return this.ctx.component;
	}
	get project(): WritingProject | null {
		return (this.projectId && this.w.project(this.projectId)) || null;
	}

	go(o: { project?: string | null; view?: StudioView; item?: string | null }, newLeaf?: boolean | PaneType): void {
		this.ctx.navigate(ROUTES.writing({ project: o.project ?? null, view: o.view ?? null, item: o.item ?? null }), newLeaf);
	}

	mount(): void {
		this.pageEl = this.ctx.el.createDiv({ cls: 'ws-page ws-page--full ws-wr', attr: { 'data-view': this.view } });
		this.topEl = this.pageEl.createDiv({ cls: 'ws-wr-top' });
		this.bodyEl = this.pageEl.createDiv({ cls: cx('ws-wr-body', this.view === 'manuscript' && 'ws-wr-body--fixed') });
		this.ctx.setTitle(this.project?.name ?? 'Writing Studio');
		this.repaint();
		this.warm();
		const c = this.ctx.component;
		own(c, () => {
			this.dead = true;
			this.settingsPop?.close();
			if (this.timer !== null) window.clearTimeout(this.timer);
		});
		own(c, this.s.events.on('writing:changed', () => this.queue()));
		own(c, this.s.events.on('writing:words', ({ projectId }) => {
			if (!this.projectId || projectId === this.projectId) this.queue();
		}));
		// WS5: names, pictures and "missing" on scenes follow the entries they point at.
		const touches = (id: string) => !!this.projectId && this.w.scenes(this.projectId).some((sc) => sceneHas(sc, id));
		own(c, this.s.events.on('entity:updated', ({ entity, change }) => {
			if (change.keys.some((k) => k === 'name' || k === 'trashedAt' || k === 'media' || k === 'aliases') && touches(entity.id)) this.queue();
		}));
		own(c, this.s.events.on('entity:deleted', ({ entity }) => touches(entity.id) && this.queue()));
	}

	/** Count the words of what this page shows (nothing is read before the studio is opened). */
	private warm(): void {
		const ids = this.projectId ? [this.projectId] : this.w.projects().map((p) => p.id);
		const cold = ids.filter((id) => !this.w.words.isWarm(id));
		if (!cold.length) return;
		void Promise.all(cold.map((id) => this.w.words.warm(id).catch(() => undefined))).then(() => {
			if (!this.dead) this.queue();
		});
	}

	/** Redraw soon, once for a burst of changes. */
	private queue(): void {
		if (this.dead || this.timer !== null) return;
		this.timer = window.setTimeout(() => {
			this.timer = null;
			if (!this.dead) this.update();
		}, 50);
	}

	private update(): void {
		const p = this.project;
		if (this.projectId && !p) return this.go({});
		this.ctx.setTitle(p?.name ?? 'Writing Studio');
		this.renderTop();
		if (this.screen) this.screen.refresh();
		else this.renderBody();
	}

	repaint(): void {
		if (this.dead) return;
		if (this.projectId && !this.project) return this.go({});
		this.renderTop();
		// The manuscript redraws in place: its editor (and what's being typed) stays as it is.
		if (this.screen) this.screen.refresh();
		else this.renderBody();
	}

	private renderBody(): void {
		const top = this.bodyEl.scrollTop;
		this.bodyEl.empty();
		this.screen = null;
		switch (this.view) {
			case 'home':
				renderHome(this, this.bodyEl);
				break;
			case 'projects':
				renderLibrary(this, this.bodyEl, library);
				break;
			case 'overview':
				renderOverview(this, this.bodyEl);
				break;
			case 'trash':
				renderTrash(this, this.bodyEl);
				break;
			case 'plot': {
				const plot = new PlotScreen(this, this.bodyEl);
				plot.mount();
				this.screen = plot;
				break;
			}
			case 'goals':
			case 'stats': {
				const draw = () => {
					this.bodyEl.empty();
					renderGoals(this, this.bodyEl, this.project);
				};
				draw();
				this.screen = { refresh: draw };
				break;
			}
			case 'settings': {
				const sp = new SettingsScreen(this, this.bodyEl);
				sp.mount();
				this.screen = sp;
				break;
			}
			case 'research': {
				const r = new ResearchScreen(this, this.bodyEl);
				r.mount();
				this.screen = r;
				break;
			}
			case 'compile': {
				const c = new CompileScreen(this, this.bodyEl);
				c.mount();
				this.screen = c;
				break;
			}
			case 'revision': {
				const rev = new RevisionScreen(this, this.bodyEl, this.ctx.params.item ?? null, (id) => {
					const { item: _i, ...rest } = this.ctx.params;
					void _i;
					this.ctx.params = id ? { ...rest, item: id } : rest;
					this.ctx.replaceParams(this.ctx.params);
				});
				rev.mount();
				this.screen = rev;
				break;
			}
			case 'arcs': {
				const arcs = new ArcsScreen(this, this.bodyEl, this.ctx.params.item ?? null, (id) => {
					const { item: _i, ...rest } = this.ctx.params;
					void _i;
					this.ctx.params = id ? { ...rest, item: id } : rest;
					this.ctx.replaceParams(this.ctx.params);
				});
				arcs.mount();
				this.screen = arcs;
				break;
			}
			case 'corkboard':
			case 'outline':
			case 'kanban':
			case 'timeline':
			case 'table': {
				const board = new BoardScreen(this, this.bodyEl, this.view);
				board.mount();
				this.screen = board;
				break;
			}
			case 'manuscript': {
				const ms = new ManuscriptScreen(this, this.bodyEl, this.ctx.params.item ?? null, (id) => {
					const { item: _i, ...rest } = this.ctx.params;
					void _i;
					this.ctx.params = id ? { ...rest, item: id } : rest;
					this.ctx.replaceParams(this.ctx.params);
				});
				ms.mount();
				this.screen = ms;
				break;
			}
		}
		this.bodyEl.scrollTop = top;
	}

	// ── the top bar ─────────────────────────────────────────────────────────

	private renderTop(): void {
		const el = this.topEl;
		el.empty();
		const p = this.project;
		// The switcher: the book (cover, title in italic, kind · status in small capitals) or the studio.
		const sw = el.createEl('button', { cls: 'ws-wr-switch', attr: { type: 'button', 'aria-haspopup': 'menu', 'aria-label': p ? `Project: ${p.name}. Switch project` : 'Switch project' } });
		if (p) cover(sw, p, 'mini');
		else icon(sw, 'feather', 'ws-wr-switch__icon');
		const t = sw.createSpan({ cls: 'ws-wr-switch__text' });
		t.createSpan({ cls: 'ws-wr-switch__name', text: p?.name ?? 'Writing Studio' });
		if (p) {
			const st = projectStatus(p, this.w.scenes(p.id));
			t.createSpan({ cls: 'ws-wr-switch__kicker', text: [kindLabel(p.kind), st?.label].filter(Boolean).join(' · ') });
		}
		icon(sw, 'chevrons-up-down', 'ws-wr-switch__caret');
		sw.addEventListener('click', (e) => this.switchMenu(e, sw));

		// 0.28.2: inside a book, Home (the studio's home page) comes first, outside the scrolling tabs so it's always in view.
		if (p) {
			const home = el.createEl('button', { cls: 'ws-wr-hometab', attr: { type: 'button', 'aria-label': 'Writing Studio home' } });
			icon(home, 'home');
			home.createSpan({ text: 'Home' });
			home.addEventListener('click', (e) => this.go({ project: null, view: 'home' }, e.metaKey || e.ctrlKey ? 'tab' : false));
			el.createDiv({ cls: 'ws-wr-tabs__rule', attr: { 'aria-hidden': 'true' } });
		}
		const tabs = el.createDiv({ cls: 'ws-wr-tabs', attr: { role: 'tablist', 'aria-label': p ? 'Project' : 'Writing Studio' } });
		for (const v of p ? VIEWS_IN : VIEWS_OUT) {
			const board = v.id === 'corkboard';
			const on = board ? isBoardView(this.view) : this.view === v.id;
			const b = tabs.createEl('button', { cls: cx('ws-wr-tab', on && 'is-active'), attr: { type: 'button', role: 'tab', 'aria-selected': String(on), 'data-view': board ? 'board' : v.id } });
			b.createSpan({ text: v.label });
			b.addEventListener('click', (e) => {
				if (on) return;
				const view = board && p ? deviceMemory(this.ws.app).board(p.id).view : v.id;
				this.go({ project: p?.id ?? null, view }, e.metaKey || e.ctrlKey ? 'tab' : false);
			});
		}

		// The active tab stays in view when the row scrolls.
		window.requestAnimationFrame(() => tabs.querySelector<HTMLElement>('.ws-wr-tab.is-active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
		// Today: words against the daily goal (this book's, or all books' together on the studio pages).
		const right = el.createDiv({ cls: 'ws-wr-top__right' });
		const books = p ? [p] : this.w.projects();
		const today = books.reduce((n, b) => n + this.w.wordsToday(b.id), 0);
		const goal = books.reduce((n, b) => n + (b.dailyGoal ?? 0), 0) || null;
		const box = right.createDiv({ cls: 'ws-wr-today-top', attr: { title: goal ? `${fmt(today)} of ${fmt(goal)} words today` : `${fmt(today)} words today` } });
		ring(box, goal ? today / goal : 0);
		const txt = box.createDiv({ cls: 'ws-wr-today-top__text' });
		txt.createSpan({ cls: 'ws-wr-today-top__n', text: fmt(Math.max(0, today)) });
		txt.createSpan({ cls: 'ws-wr-today-top__label', text: goal ? `of ${fmt(goal)} today` : 'words today' });
		right.createDiv({ cls: 'ws-wr-top__rule', attr: { 'aria-hidden': 'true' } });
		const sprintBook = p ?? this.w.projects()[0] ?? null;
		const tm = right.createEl('button', { cls: 'ws-wr-top__sprint clickable-icon', attr: { type: 'button', 'aria-label': 'Start a writing sprint', 'aria-haspopup': 'menu' } });
		icon(tm, 'timer');
		tm.disabled = !sprintBook;
		tm.addEventListener('click', (e) => {
			if (!sprintBook) return;
			const m = new Menu();
			for (const min of [15, 25, 45]) m.addItem((i) => i.setTitle(`${min}-minute sprint`).setIcon('timer').onClick(() => startSprint(this.w, sprintBook.id, min)));
			m.showAtMouseEvent(e);
		});
		const fo = right.createEl('button', { cls: 'ws-wr-top__focus clickable-icon', attr: { type: 'button', 'aria-label': 'Focus mode: just the page' } });
		icon(fo, 'maximize-2');
		fo.disabled = !p;
		fo.addEventListener('click', () => {
			const scr = this.screen as { setFocusMode?: (on: boolean) => void } | null;
			if (this.view === 'manuscript' && scr?.setFocusMode) scr.setFocusMode(true);
			else if (p) this.go({ project: p.id, view: 'manuscript' });
		});
		const set = right.createEl('button', { cls: 'ws-wr-top__settings clickable-icon', attr: { type: 'button', 'aria-label': 'Writing settings', 'aria-haspopup': 'dialog' } });
		icon(set, 'sliders-horizontal');
		set.addEventListener('click', () => {
			if (this.settingsPop?.isOpen) return this.settingsPop.close();
			this.settingsPop = openWritingSettings(this.ws, set, () => this.go({ project: null, view: 'settings' }));
		});
		// Open while the bar redraws (a word count came in): it stays, on the new button.
		if (this.settingsPop?.isOpen) this.settingsPop.setAnchor(set);
	}

	private switchMenu(e: MouseEvent, anchor: HTMLElement): void {
		const m = new Menu();
		const current = this.projectId;
		for (const p of this.w.projects()) {
			m.addItem((i) =>
				i
					.setTitle(p.name)
					.setIcon(p.id === current ? 'check' : 'book')
					.onClick(() => p.id !== current && this.go({ project: p.id, view: this.view === 'manuscript' || this.view === 'plot' || this.view === 'arcs' ? this.view : isBoardView(this.view) ? deviceMemory(this.ws.app).board(p.id).view : 'overview' })),
			);
		}
		m.addSeparator();
		m.addItem((i) => i.setTitle('All projects').setIcon('library').onClick(() => this.go({ view: 'projects' })));
		m.addItem((i) => i.setTitle('Studio home').setIcon('home').onClick(() => this.go({})));
		m.addItem((i) => i.setTitle('New project…').setIcon('plus').onClick(() => newProject(this)));
		m.addItem((i) => i.setTitle('Import notes…').setIcon('file-input').onClick(() => importFolder(this, current ?? undefined)));
		const r = anchor.getBoundingClientRect();
		if (e.detail === 0) m.showAtPosition({ x: r.left, y: r.bottom + 4 });
		else m.showAtMouseEvent(e);
	}
}

/** A small progress ring toward the word goal (only drawn when there is a goal). */
function ring(parent: HTMLElement, ratio: number): void {
	const r = Math.max(0, Math.min(1, ratio));
	const NS = 'http://www.w3.org/2000/svg';
	const svg = activeDocument.createElementNS(NS, 'svg');
	svg.setAttribute('viewBox', '0 0 36 36');
	svg.setAttribute('class', 'ws-wr-ring');
	svg.setAttribute('aria-hidden', 'true');
	const C = 2 * Math.PI * 15;
	for (const [cls, dash] of [['ws-wr-ring__track', `${C} ${C}`], ['ws-wr-ring__fill', `${C * r} ${C}`]] as const) {
		const c = activeDocument.createElementNS(NS, 'circle');
		c.setAttribute('cx', '18');
		c.setAttribute('cy', '18');
		c.setAttribute('r', '15');
		c.setAttribute('class', cls);
		c.setAttribute('stroke-dasharray', dash);
		svg.appendChild(c);
	}
	parent.appendChild(svg);
}
