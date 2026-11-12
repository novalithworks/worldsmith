import { Notice } from 'obsidian';
import { button, cx } from '../components/dom';
import { createItem, undoNotice } from './actions';
import { corkGroups, dropIndex, inThread, type CorkEntry } from './boards';
import { bindCards, focusedCard, refocus, sceneCard, type BoardCtx, type BoardPane } from './cards';
import { pointerDrag } from './drag';
import { binderModel } from './model';
import { deviceMemory } from './device';

/*
 * The corkboard (WS4): an index card per scene, in columns per chapter, in manuscript order.
 * Dragging a card (mouse, pen or finger) moves the scene in the manuscript, inside its
 * chapter or into another one, through WritingService.move (with Undo). Big books are drawn
 * a batch at a time as they scroll into view.
 */

/** Cards drawn per batch. */
export const CORK_BATCH = 120;

type Group = Extract<CorkEntry, { kind: 'group' }>;

export class Corkboard implements BoardPane {
	private readonly el: HTMLElement;
	private gridEl!: HTMLElement;
	private dropEl: HTMLElement;
	private observer: IntersectionObserver | null = null;
	/** What's left to draw, and how many cards are on the page. */
	private queue: CorkEntry[] = [];
	private openList: { group: Group; list: HTMLElement; next: number } | null = null;
	private drawn = 0;
	private drop: { parentId: string | null; ref: string | null; after: boolean; group: Group } | null = null;
	private groups = new Map<string, Group>();

	constructor(
		private readonly ctx: BoardCtx,
		parent: HTMLElement,
	) {
		this.el = parent.createDiv({ cls: 'ws-wr-cork', attr: { role: 'list', 'aria-label': 'Corkboard' } });
		this.dropEl = createDiv({ cls: 'ws-wr-cork__drop', attr: { 'aria-hidden': 'true' } });
		bindCards(this.el, ctx);
		ctx.component.register(() => this.observer?.disconnect());
		pointerDrag<string>(ctx.component, {
			root: this.el,
			item: '.ws-wr-ix',
			scrollers: () => [ctx.scroller],
			// Reordering is by chapter; grouped another way, cards don't drag (0.28).
			start: (el) => (this.mode() === 'chapter' ? (el.dataset.id ?? null) : null),
			over: (x, y, id, under) => this.over(x, y, id, under),
			drop: (_x, _y, id) => this.dropAt(id),
			end: () => {
				this.drop = null;
				this.dropEl.remove();
				this.el.querySelectorAll('.is-drop-into').forEach((e) => e.removeClass('is-drop-into'));
			},
		});
	}

	private mode(): 'chapter' | 'status' | 'pov' | 'thread' {
		return deviceMemory(this.ctx.st.ws.app).board(this.ctx.project.id).group ?? 'chapter';
	}

	/** Columns by status, point of view or plot thread (in reading order inside each). */
	private otherGroups(mode: 'status' | 'pov' | 'thread'): CorkEntry[] {
		const { st, project } = this.ctx;
		const scenes = st.w.scenes(project.id).filter((x) => !x.trashedAt);
		const out: Group[] = [];
		const add = (key: string, title: string, label: string, ids: string[]) => {
			if (ids.length) out.push({ kind: 'group', key, parentId: null, chapterId: null, title, label, sceneIds: ids });
		};
		if (mode === 'status') {
			for (const s of project.statuses) add(`status:${s.id}`, s.label, 'Status', scenes.filter((x) => x.status === s.id).map((x) => x.id));
			add('status:none', 'No status', 'Status', scenes.filter((x) => !project.statuses.some((s) => s.id === x.status)).map((x) => x.id));
		} else if (mode === 'pov') {
			const order = [...new Set(scenes.map((x) => x.pov).filter((x): x is string => !!x))];
			for (const id of order) add(`pov:${id}`, st.s.entities.get(id)?.name ?? 'Someone', 'Point of view', scenes.filter((x) => x.pov === id).map((x) => x.id));
			add('pov:none', 'No point of view', 'Point of view', scenes.filter((x) => !x.pov).map((x) => x.id));
		} else {
			for (const t of project.threads) add(`thread:${t.id}`, t.label, 'Plot thread', scenes.filter((x) => x.threads[0] === t.id).map((x) => x.id));
			add('thread:none', 'No plot thread', 'Plot thread', scenes.filter((x) => !x.threads.length).map((x) => x.id));
		}
		return out;
	}

	refresh(): void {
		const focus = focusedCard(this.el);
		this.observer?.disconnect();
		this.el.empty();
		const { st, project } = this.ctx;
		const tree = st.w.tree(project.id);
		const m = binderModel(tree);
		const mode = this.mode();
		const entries = mode === 'chapter' ? corkGroups(tree, m.chapterNo) : this.otherGroups(mode);
		this.el.toggleClass('is-regrouped', mode !== 'chapter');
		if (mode !== 'chapter' && entries.length) this.el.createDiv({ cls: 'ws-wr-muted ws-wr-cork__hint', text: 'Grouped by ' + ({ status: 'status', pov: 'point of view', thread: 'plot thread' } as const)[mode] + '. Cards are reordered when grouped by chapter.' });
		this.groups = new Map(entries.filter((e): e is Group => e.kind === 'group').map((g) => [g.key, g]));
		if (!entries.length) {
			const empty = this.el.createDiv({ cls: 'ws-wr-none ws-wr-cork__empty' });
			empty.createDiv({ text: 'No scenes yet.' });
			button(empty, { label: 'New scene', icon: 'plus', variant: 'primary', size: 'sm', onClick: () => void createItem(st, project.id, 'scene', null) });
			return;
		}
		this.gridEl = this.el.createDiv({ cls: 'ws-wr-cork__grid' });
		this.queue = [...entries];
		this.openList = null;
		this.drawn = 0;
		this.more(Math.max(CORK_BATCH, this.lastDrawn));
		refocus(this.el, focus);
	}

	/** Cards drawn before the last redraw (a redraw keeps at least as many, so the scroll stays put). */
	private lastDrawn = 0;

	/** Draw up to `budget` more cards. */
	private more(budget: number): void {
		const { st, thread } = this.ctx;
		let left = budget;
		this.gridEl.querySelector('.ws-wr-cork__more')?.remove();
		while (left > 0 && (this.openList || this.queue.length)) {
			if (!this.openList) {
				const e = this.queue.shift()!;
				if (e.kind === 'part') {
					const h = this.gridEl.createDiv({ cls: 'ws-wr-cork__part', attr: { 'data-id': e.id } });
					h.createSpan({ cls: 'ws-wr-caps', text: 'Part' });
					const t = h.createEl('button', { cls: 'ws-wr-cork__parttitle', text: e.title, attr: { type: 'button' } });
					t.addEventListener('click', () => this.ctx.open(e.id));
					continue;
				}
				this.openList = { group: e, list: this.column(e), next: 0 };
			}
			const o = this.openList;
			while (left > 0 && o.next < o.group.sceneIds.length) {
				const s = st.w.item(o.group.sceneIds[o.next++]);
				if (!s || !inThread(s, thread)) continue;
				sceneCard(o.list, this.ctx, s, { size: 'full' });
				left--;
				this.drawn++;
			}
			if (o.next >= o.group.sceneIds.length) {
				this.finishColumn(o.group, o.list);
				this.openList = null;
			}
		}
		this.lastDrawn = this.drawn;
		// The design's columns fill the board: as many as the largest part has chapters (they wrap past ~220px).
		let most = 0;
		let run = 0;
		for (const c of Array.from(this.gridEl.children)) {
			if (c.classList.contains('ws-wr-cork__part')) run = 0;
			else if (c.classList.contains('ws-wr-cork__col')) most = Math.max(most, ++run);
		}
		this.gridEl.style.setProperty('--ws-wr-cork-n', String(Math.max(1, most)));
		if (this.openList || this.queue.length) {
			const sentinel = this.gridEl.createDiv({ cls: 'ws-wr-cork__more', text: 'More scenes…' });
			this.observer = new IntersectionObserver(
				(es) => {
					if (!es.some((x) => x.isIntersecting)) return;
					this.observer?.disconnect();
					this.more(CORK_BATCH);
				},
				{ root: this.ctx.scroller, rootMargin: '800px 0px' },
			);
			this.observer.observe(sentinel);
		}
	}

	private column(g: Group): HTMLElement {
		const col = this.gridEl.createDiv({ cls: cx('ws-wr-cork__col', !g.chapterId && 'is-loose'), attr: { 'data-key': g.key, 'data-parent': g.parentId ?? '' } });
		const head = col.createDiv({ cls: 'ws-wr-cork__head' });
		head.createDiv({ cls: 'ws-wr-caps ws-wr-cork__label', text: g.label });
		const t = head.createEl(g.chapterId ? 'button' : 'div', { cls: 'ws-wr-cork__title', text: g.title });
		if (g.chapterId) {
			t.setAttr('type', 'button');
			t.addEventListener('click', () => this.ctx.open(g.chapterId!));
		}
		return col.createDiv({ cls: 'ws-wr-cork__cards' });
	}

	private finishColumn(g: Group, list: HTMLElement): void {
		const col = list.parentElement!;
		const { st, project } = this.ctx;
		const add = col.createEl('button', { cls: 'ws-wr-cork__add', attr: { type: 'button', 'data-nodrag': 'true' } });
		add.createSpan({ text: '+ Add scene' });
		add.addEventListener('click', () => {
			const near = g.chapterId ? st.w.item(g.chapterId) : st.w.item(g.sceneIds[g.sceneIds.length - 1]);
			void createItem(st, project.id, 'scene', near ?? null);
		});
		if (!list.childElementCount) list.createDiv({ cls: 'ws-wr-cork__hint', text: this.ctx.thread ? 'No scenes match the filter here.' : 'Drop a scene here.' });
	}

	private over(_x: number, y: number, id: string, under: Element | null): void {
		const col = under?.closest('.ws-wr-cork__col') as HTMLElement | null;
		this.el.querySelectorAll('.is-drop-into').forEach((e) => e.removeClass('is-drop-into'));
		if (!col || !this.el.contains(col)) {
			this.drop = null;
			this.dropEl.remove();
			return;
		}
		const g = this.groups.get(col.dataset.key ?? '');
		if (!g) return;
		const list = col.querySelector<HTMLElement>('.ws-wr-cork__cards')!;
		const cards = [...list.querySelectorAll<HTMLElement>('.ws-wr-ix')].filter((c) => c.dataset.id !== id);
		let ref: HTMLElement | null = null;
		for (const c of cards) {
			const r = c.getBoundingClientRect();
			if (y < r.top + r.height / 2) {
				ref = c;
				break;
			}
		}
		col.addClass('is-drop-into');
		if (ref) {
			list.insertBefore(this.dropEl, ref);
			this.drop = { parentId: g.parentId, ref: ref.dataset.id!, after: false, group: g };
		} else {
			const last = cards[cards.length - 1];
			if (last) last.after(this.dropEl);
			else list.prepend(this.dropEl);
			this.drop = { parentId: g.parentId, ref: last?.dataset.id ?? null, after: true, group: g };
		}
	}

	private dropAt(id: string): void {
		const d = this.drop;
		if (!d) return;
		const { st, project } = this.ctx;
		const s = st.w.item(id);
		if (!s) return;
		const children = st.w.children(project.id, d.parentId).map((c) => c.id);
		// Below the last card of a run of loose scenes: right after the run's last scene.
		const last = [...d.group.sceneIds].reverse().find((x) => x !== id) ?? null;
		if (!d.ref && !d.group.chapterId && !last) return;
		const index = d.ref ? dropIndex(children, id, d.ref, d.after) : dropIndex(children, id, null, true, last);
		const now = children.indexOf(id);
		if (s.parentId === d.parentId && now === index) return;
		try {
			const u = st.w.move(id, { parentId: d.parentId, index });
			const into = d.parentId && d.parentId !== s.parentId ? st.w.item(d.parentId) : null;
			undoNotice(st, into ? `Moved “${s.title}” into “${into.title}”. The manuscript follows.` : `Moved “${s.title}”. The manuscript follows.`, u);
		} catch (e) {
			new Notice(e instanceof Error ? e.message : String(e));
		}
	}
}
