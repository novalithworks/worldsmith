import { Menu } from 'obsidian';
import type { WritingProject } from '../../core/types';
import { button, cx, icon } from '../components/dom';
import { createItem, itemMenu } from './actions';
import { BOARD_VIEWS, type BoardView, type FilterArg } from './boards';
import { sceneLinks } from '../../services/writing/world';
import type { BoardCtx, BoardPane } from './cards';
import { Corkboard } from './corkboard';
import { deviceMemory, type DeviceMemory } from './device';
import { dragging } from './drag';
import { Kanban } from './kanban';
import { head, type Studio, type StudioScreen } from './kit';
import { binderModel } from './model';
import { Outline } from './outline';
import { ThreadsModal } from './planDialogs';
import { SceneTable } from './table';
import { Timeline } from './timeline';

/*
 * The Story board tab (WS4): one page with five ways to see the book (Corkboard, Outline,
 * Kanban, Timeline and Table), a plot-thread filter shared by all of them, and New scene.
 * Which board was used last, and the filter, are remembered per project on this device.
 * The boards redraw in place when the manuscript changes (never under a drag in progress).
 */

const SUB: Record<BoardView, (p: WritingProject) => string> = {
	corkboard: (p) => `Every scene in ${p.name}. Drag a card to reorder; the manuscript follows.`,
	outline: () => 'Parts, chapters and scenes. Drag a row to reorder it or move it into another chapter; click a synopsis to edit it.',
	kanban: () => 'Scenes by status. Drag a card to another column to change its status; the reading order stays as it is.',
	timeline: () => 'Scenes in story time, by plot thread. The number on each card is its place in the book.',
	table: () => 'Every scene with its details. Click a column to sort it; click a cell to change it.',
};

export class BoardScreen implements StudioScreen {
	private root!: HTMLElement;
	private filterBtn!: HTMLButtonElement;
	private whoBtn!: HTMLButtonElement;
	private passBtn!: HTMLButtonElement;
	private pane: BoardPane | null = null;
	private memory!: DeviceMemory;
	private numbers = new Map<string, number>();
	private waitTimer: number | null = null;
	private gone = false;

	constructor(
		private readonly st: Studio,
		private readonly el: HTMLElement,
		private readonly view: BoardView,
	) {}

	private get project(): WritingProject {
		return this.st.project!;
	}

	/** WS5: the entry filter (only an entry that still exists). */
	private get who(): string | null {
		const w = this.memory.board(this.project.id).who;
		return w && this.st.s.entities.get(w) && !this.st.s.entities.get(w)!.trashedAt ? w : null;
	}

	private groupLabel: HTMLElement | null = null;
	private colorLabel: HTMLElement | null = null;

	/** After a Group or Colour choice: new labels, and the cards drawn again. */
	private rebuild(): void {
		const mem = this.memory.board(this.project.id);
		this.groupLabel?.setText(`Group: ${({ chapter: 'Chapter', status: 'Status', pov: 'Point of view', thread: 'Plot thread' } as const)[mem.group ?? 'chapter']}`);
		this.colorLabel?.setText(`Colour: ${({ thread: 'Plot thread', status: 'Status', pov: 'Point of view' } as const)[mem.color ?? 'thread']}`);
		this.pane?.refresh();
	}

	/** WS6: the revision pass filter (only a pass that still exists). */
	private get pass() {
		const id = this.memory.board(this.project.id).pass;
		return id ? (this.project.passes ?? []).find((x) => x.id === id) ?? null : null;
	}

	/** All filters for the views (null when none is set). */
	private get filterValue(): FilterArg {
		const thread = this.thread;
		const who = this.who;
		const pass = this.pass;
		return thread === null && who === null && !pass ? null : { thread, who, passDone: pass ? new Set(pass.done) : null };
	}

	/** The plot-thread filter (only a thread that is still on the list). */
	private get thread(): string | null {
		const t = this.memory.board(this.project.id).thread;
		return t && this.project.threads.some((x) => x.id === t) ? t : null;
	}

	mount(): void {
		const st = this.st;
		st.component.register(() => {
			this.gone = true;
			if (this.waitTimer !== null) window.clearTimeout(this.waitTimer);
			this.waitTimer = null;
		});
		this.memory = deviceMemory(st.ws.app);
		this.memory.setBoard(this.project.id, { view: this.view });
		const label = BOARD_VIEWS.find((b) => b.id === this.view)!.label;
		this.root = this.el.createDiv({ cls: cx('ws-wr-board', `ws-wr-board--${this.view}`), attr: { 'data-board': this.view } });
		const tools = head(this.root, { eyebrow: 'Story board', title: label, sub: SUB[this.view](this.project) });
		button(tools, { label: 'New scene', icon: 'plus', variant: 'primary', size: 'sm', cls: 'ws-wr-board__new', onClick: () => void createItem(st, this.project.id, 'scene', null) });
		const bar = this.root.createDiv({ cls: 'ws-wr-board__bar' });
		const views = bar.createDiv({ cls: 'ws-segmented ws-wr-board__views', attr: { role: 'tablist', 'aria-label': 'Story boards' } });
		for (const v of BOARD_VIEWS) {
			const on = v.id === this.view;
			const b = views.createEl('button', { cls: cx('ws-segmented__item ws-wr-board__view', on && 'is-active'), attr: { type: 'button', role: 'tab', 'aria-selected': String(on), 'data-board': v.id, 'aria-label': v.label } });
			icon(b, v.icon);
			b.createSpan({ cls: 'ws-wr-board__viewlabel', text: v.label });
			b.addEventListener('click', (e) => {
				if (!on) st.go({ project: this.project.id, view: v.id }, e.metaKey || e.ctrlKey ? 'tab' : false);
			});
		}
		bar.createDiv({ cls: 'ws-wr-spacer' });
		// 0.28 (the design): how the corkboard groups its columns, and what colours the cards.
		const mem = this.memory.board(this.project.id);
		const GROUPS = { chapter: 'Chapter', status: 'Status', pov: 'Point of view', thread: 'Plot thread' } as const;
		const COLORS = { thread: 'Plot thread', status: 'Status', pov: 'Point of view' } as const;
		if (this.view === 'corkboard') {
			const g = bar.createEl('button', { cls: 'ws-btn ws-btn--ghost ws-btn--sm ws-wr-board__group', attr: { type: 'button', 'aria-haspopup': 'menu' } });
			icon(g, 'rows-3', 'ws-btn__icon');
			this.groupLabel = g.createSpan({ cls: 'ws-btn__label', text: `Group: ${GROUPS[mem.group ?? 'chapter']}` });
			g.addEventListener('click', (e) => {
				const m = new Menu();
				for (const [k, l] of Object.entries(GROUPS))
					m.addItem((i) =>
						i
							.setTitle(l)
							.setChecked((mem.group ?? 'chapter') === k)
							.onClick(() => {
								this.memory.setBoard(this.project.id, { group: k as 'chapter' });
								this.rebuild();
							}),
					);
				m.showAtMouseEvent(e);
			});
		}
		if (this.view === 'corkboard' || this.view === 'kanban') {
			const c = bar.createEl('button', { cls: 'ws-btn ws-btn--ghost ws-btn--sm ws-wr-board__color', attr: { type: 'button', 'aria-haspopup': 'menu' } });
			icon(c, 'palette', 'ws-btn__icon');
			this.colorLabel = c.createSpan({ cls: 'ws-btn__label', text: `Colour: ${COLORS[mem.color ?? 'thread']}` });
			c.addEventListener('click', (e) => {
				const m = new Menu();
				for (const [k, l] of Object.entries(COLORS))
					m.addItem((i) =>
						i
							.setTitle(l)
							.setChecked((mem.color ?? 'thread') === k)
							.onClick(() => {
								this.memory.setBoard(this.project.id, { color: k as 'thread' });
								this.rebuild();
							}),
					);
				m.showAtMouseEvent(e);
			});
		}
		this.filterBtn = bar.createEl('button', { cls: 'ws-btn ws-btn--ghost ws-btn--sm ws-wr-board__filter', attr: { type: 'button', 'aria-haspopup': 'menu' } });
		this.filterBtn.addEventListener('click', (e) => this.filterMenu(e));
		this.whoBtn = bar.createEl('button', { cls: 'ws-btn ws-btn--ghost ws-btn--sm ws-wr-board__who', attr: { type: 'button', 'aria-haspopup': 'menu' } });
		this.whoBtn.addEventListener('click', (e) => this.whoMenu(e));
		this.passBtn = bar.createEl('button', { cls: 'ws-btn ws-btn--ghost ws-btn--sm ws-wr-board__pass', attr: { type: 'button', 'aria-haspopup': 'menu' } });
		this.passBtn.addEventListener('click', (e) => this.passMenu(e));
		const content = this.root.createDiv({ cls: 'ws-wr-board__content' });
		// eslint-disable-next-line @typescript-eslint/no-this-alias -- the board is captured for drag callbacks that run with their own `this`
		const self = this;
		const ctx: BoardCtx = {
			st,
			get project() {
				return st.project!;
			},
			get thread() {
				return self.filterValue;
			},
			component: st.component,
			scroller: this.el,
			open: (id) => st.go({ project: this.project.id, view: 'manuscript', item: id }),
			menu: (id, at) => {
				const it = st.w.item(id);
				if (!it) return;
				const m = itemMenu(st, it);
				if (at instanceof HTMLElement) {
					const r = at.getBoundingClientRect();
					m.showAtPosition({ x: r.left + 16, y: r.bottom });
				} else m.showAtMouseEvent(at);
			},
			sceneNo: (id) => this.numbers.get(id),
		};
		this.pane = this.makePane(ctx, content);
		this.refresh();
	}

	private makePane(ctx: BoardCtx, el: HTMLElement): BoardPane {
		switch (this.view) {
			case 'outline':
				return new Outline(ctx, el);
			case 'kanban':
				return new Kanban(ctx, el);
			case 'timeline':
				return new Timeline(ctx, el);
			case 'table':
				return new SceneTable(ctx, el);
			default:
				return new Corkboard(ctx, el);
		}
	}

	refresh(): void {
		// Gone (the page closed, or the project with it): nothing to draw.
		if (this.gone || !this.st.project) return;
		// Never under a drag: once it's over.
		if (dragging) {
			if (this.waitTimer !== null) return;
			const again = () => {
				this.waitTimer = null;
				if (this.gone) return;
				if (dragging) return void (this.waitTimer = window.setTimeout(again, 120));
				this.refresh();
			};
			this.waitTimer = window.setTimeout(again, 120);
			return;
		}
		const p = this.project;
		this.numbers = binderModel(this.st.w.tree(p.id)).sceneNo;
		const t = p.threads.find((x) => x.id === this.thread);
		this.filterBtn.empty();
		icon(this.filterBtn, 'filter', 'ws-btn__icon');
		if (t) this.filterBtn.createSpan({ cls: cx('ws-wr-dot', `ws-tint--${t.color ?? 'gray'}`) });
		this.filterBtn.createSpan({ cls: 'ws-btn__label', text: t ? t.label : 'All plot threads' });
		this.filterBtn.toggleClass('is-active', !!t);
		this.filterBtn.setAttr('aria-label', t ? `Showing the plot thread ${t.label}. Change` : 'Show one plot thread');
		// WS5: who or where.
		const w = this.who ? this.st.s.entities.get(this.who) : null;
		this.whoBtn.empty();
		icon(this.whoBtn, w ? 'user' : 'users', 'ws-btn__icon');
		this.whoBtn.createSpan({ cls: 'ws-btn__label', text: w ? w.name : 'Everyone' });
		this.whoBtn.toggleClass('is-active', !!w);
		this.whoBtn.setAttr('aria-label', w ? `Showing scenes with ${w.name}. Change` : 'Show the scenes of one character or place');
		// WS6: revision pass (shown only when the project has passes).
		const pass = this.pass;
		this.passBtn.empty();
		this.passBtn.toggleClass('is-hidden', !(this.project.passes ?? []).length);
		icon(this.passBtn, 'list-checks', 'ws-btn__icon');
		this.passBtn.createSpan({ cls: 'ws-btn__label', text: pass ? `To do: ${pass.name}` : 'All passes' });
		this.passBtn.toggleClass('is-active', !!pass);
		this.passBtn.setAttr('aria-label', pass ? `Showing scenes not done in ${pass.name}. Change` : 'Show the scenes still to do in a revision pass');
		this.pane?.refresh();
	}

	private passMenu(e: MouseEvent): void {
		const p = this.project;
		const cur = this.pass?.id ?? null;
		const total = this.st.w.scenes(p.id).length;
		const m = new Menu();
		const set = (pass: string | null) => {
			this.memory.setBoard(p.id, { pass });
			this.refresh();
		};
		m.addItem((i) => i.setTitle('All scenes').setChecked(cur === null).onClick(() => set(null)));
		m.addSeparator();
		for (const x of p.passes ?? []) m.addItem((i) => i.setTitle(`To do in “${x.name}” (${Math.max(0, total - x.done.length)})`).setChecked(cur === x.id).onClick(() => set(x.id)));
		if (e.detail === 0) {
			const r = this.passBtn.getBoundingClientRect();
			m.showAtPosition({ x: r.left, y: r.bottom + 4 });
		} else m.showAtMouseEvent(e);
	}

	/** The entries that appear in this project's scenes, to filter by. */
	private whoMenu(e: MouseEvent): void {
		const p = this.project;
		const cur = this.who;
		const counts = new Map<string, number>();
		for (const s of this.st.w.scenes(p.id)) for (const id of sceneLinks(s).keys()) counts.set(id, (counts.get(id) ?? 0) + 1);
		const people = [...counts.keys()].map((id) => this.st.s.entities.get(id)).filter((x): x is NonNullable<typeof x> => !!x && !x.trashedAt).sort((a, b) => a.name.localeCompare(b.name));
		const m = new Menu();
		const set = (who: string | null) => {
			this.memory.setBoard(p.id, { who });
			this.refresh();
		};
		m.addItem((i) => i.setTitle('Everyone and everywhere').setChecked(cur === null).onClick(() => set(null)));
		if (people.length) m.addSeparator();
		else m.addItem((i) => i.setTitle('No scene has anyone yet: add them in a scene’s inspector').setDisabled(true));
		for (const x of people) m.addItem((i) => i.setTitle(`${x.name} (${counts.get(x.id)})`).setChecked(cur === x.id).onClick(() => set(x.id)));
		if (e.detail === 0) {
			const r = this.whoBtn.getBoundingClientRect();
			m.showAtPosition({ x: r.left, y: r.bottom + 4 });
		} else m.showAtMouseEvent(e);
	}

	private filterMenu(e: MouseEvent): void {
		const p = this.project;
		const cur = this.thread;
		const m = new Menu();
		const set = (thread: string | null) => {
			this.memory.setBoard(p.id, { thread });
			this.refresh();
		};
		m.addItem((i) => i.setTitle('All plot threads').setChecked(cur === null).onClick(() => set(null)));
		if (p.threads.length) m.addSeparator();
		for (const t of p.threads) m.addItem((i) => i.setTitle(t.label).setChecked(cur === t.id).onClick(() => set(t.id)));
		m.addSeparator();
		m.addItem((i) => i.setTitle(p.threads.length ? 'Edit plot threads…' : 'New plot thread…').setIcon('pencil').onClick(() => new ThreadsModal(this.st, p, { addOne: !p.threads.length }).open()));
		if (e.detail === 0) {
			const r = this.filterBtn.getBoundingClientRect();
			m.showAtPosition({ x: r.left, y: r.bottom + 4 });
		} else m.showAtMouseEvent(e);
	}
}
