import { Notice } from 'obsidian';
import { button, cx } from '../components/dom';
import { setStatus } from './actions';
import { inThread, kanbanColumns } from './boards';
import { bindCards, focusedCard, refocus, sceneCard, type BoardCtx, type BoardPane } from './cards';
import { pointerDrag } from './drag';
import { binderModel, count, chapterOf as chapterNode } from './model';
import { StatusesModal } from './planDialogs';

/*
 * The kanban (WS4): a column per status, in the project's own order. Dragging a card to
 * another column changes the scene's status (with Undo); Alt+←/→ does the same from the
 * keyboard, and the card's menu on a phone.
 *
 * Decision: the kanban never reorders the manuscript. Inside a column the cards are always
 * in manuscript (reading) order, so dropping a card higher or lower in its own column does
 * nothing; reordering belongs to the Corkboard, the Outline and the Manuscript, where the
 * position on screen is the position in the book. (A status column mixes scenes from every
 * chapter, so "above that card" has no single meaning in the manuscript.)
 */

/** Cards drawn per column at first (and per "Show more"), so a big book opens quickly. */
export const KANBAN_BATCH = 100;

export class Kanban implements BoardPane {
	private readonly el: HTMLElement;
	private target: string | null | undefined = undefined;
	/** How many cards each column shows (by status id; '' = No status). */
	private shown = new Map<string, number>();

	constructor(
		private readonly ctx: BoardCtx,
		parent: HTMLElement,
	) {
		this.el = parent.createDiv({ cls: 'ws-wr-kb' });
		bindCards(this.el, ctx, (e, s) => {
			if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return false;
			e.preventDefault();
			const list = ctx.project.statuses;
			const i = list.findIndex((x) => x.id === s.status);
			const next = list[i < 0 ? (e.key === 'ArrowRight' ? 0 : list.length - 1) : i + (e.key === 'ArrowRight' ? 1 : -1)];
			if (next) setStatus(ctx.st, s, next.id);
			return true;
		});
		pointerDrag<string>(ctx.component, {
			root: this.el,
			item: '.ws-wr-ix',
			scrollers: () => [this.el.querySelector<HTMLElement>('.ws-wr-kb__cols'), ctx.scroller].filter((x): x is HTMLElement => !!x),
			start: (el) => el.dataset.id ?? null,
			over: (_x, _y, _id, under) => {
				const col = under?.closest('.ws-wr-kb__col') as HTMLElement | null;
				this.el.querySelectorAll('.is-drop-into').forEach((e) => e.removeClass('is-drop-into'));
				// "No status" can't be dropped onto: it isn't a status.
				if (!col || col.dataset.status === undefined || col.dataset.status === '') {
					this.target = undefined;
					return;
				}
				col.addClass('is-drop-into');
				this.target = col.dataset.status;
			},
			drop: (_x, _y, id) => {
				const to = this.target;
				const s = ctx.st.w.item(id);
				if (!s || !to || s.status === to) return;
				try {
					setStatus(ctx.st, s, to);
				} catch (e) {
					new Notice(e instanceof Error ? e.message : String(e));
				}
			},
			end: () => {
				this.target = undefined;
				this.el.querySelectorAll('.is-drop-into').forEach((e) => e.removeClass('is-drop-into'));
			},
		});
	}

	refresh(): void {
		const focus = focusedCard(this.el);
		const cols0 = this.el.querySelector('.ws-wr-kb__cols');
		const left = cols0?.scrollLeft ?? 0;
		this.el.empty();
		const { st, project, thread } = this.ctx;
		const scenes = st.w.scenes(project.id);
		const byId = new Map(scenes.map((x) => [x.id, x]));
		const m = binderModel(st.w.tree(project.id));
		const chapterOf = (id: string): string => {
			const ch = chapterNode(m, id);
			if (ch) return `Ch ${m.chapterNo.get(ch.id) ?? ''}`;
			return '';
		};
		const cols = this.el.createDiv({ cls: 'ws-wr-kb__cols', attr: { role: 'list', 'aria-label': 'Scenes by status' } });
		for (const c of kanbanColumns(project, scenes)) {
			const ids = c.sceneIds.filter((id) => inThread(byId.get(id)!, thread));
			const col = cols.createDiv({ cls: cx('ws-wr-kb__col', c.id === null && 'is-other'), attr: { 'data-status': c.id ?? '', role: 'listitem', 'aria-label': `${c.label}: ${count(ids.length, 'scene')}` } });
			const head = col.createDiv({ cls: 'ws-wr-kb__head' });
			head.createSpan({ cls: cx('ws-wr-dot', `ws-tint--${c.color}`) });
			head.createSpan({ cls: 'ws-wr-kb__label', text: c.label });
			head.createSpan({ cls: 'ws-wr-kb__n', text: String(ids.length) });
			const list = col.createDiv({ cls: 'ws-wr-kb__cards', attr: { role: 'list' } });
			const key = c.id ?? '';
			const limit = Math.max(this.shown.get(key) ?? KANBAN_BATCH, ids.findIndex((id) => id === focus) + 1);
			for (const id of ids.slice(0, limit)) sceneCard(list, this.ctx, byId.get(id)!, { size: 'compact', where: chapterOf(id) });
			if (ids.length > limit) {
				const more = col.createEl('button', { cls: 'ws-wr-kb__more', text: `Show ${Math.min(KANBAN_BATCH, ids.length - limit)} more of ${ids.length - limit}`, attr: { type: 'button', 'data-nodrag': 'true' } });
				more.addEventListener('click', () => {
					this.shown.set(key, limit + KANBAN_BATCH);
					this.refresh();
				});
			}
			if (!ids.length) list.createDiv({ cls: 'ws-wr-kb__empty', text: c.id === null ? '' : c.done ? 'Drag a scene here when it’s done.' : 'Drag a scene here.' });
			if (c.id === null) col.createDiv({ cls: 'ws-wr-kb__note', text: 'These scenes have a status that was taken off the list. They keep it; drag them to a status to give them a new one.' });
		}
		const foot = this.el.createDiv({ cls: 'ws-wr-kb__foot' });
		foot.createSpan({ cls: 'ws-wr-muted', text: 'Cards stay in reading order; drag one to another column to change its status.' });
		button(foot, { label: 'Edit statuses…', icon: 'pencil', variant: 'ghost', size: 'sm', cls: 'ws-wr-kb__edit', onClick: () => new StatusesModal(st, project).open() });
		cols.scrollLeft = left;
		refocus(this.el, focus);
	}
}

