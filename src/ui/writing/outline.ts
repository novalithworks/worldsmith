import { avatar } from '../components/avatar';
import { Menu, Notice, setIcon } from 'obsidian';
import type { ManuscriptItem } from '../../core/types';
import { autoGrow, cx } from '../components/dom';
import { moveStep, renameItem, setStatus, toggleThread, trashItem, undoNotice } from './actions';
import { inThread, statusFor, threadsOf } from './boards';
import type { BoardCtx, BoardPane } from './cards';
import { pointerDrag } from './drag';
import { fmt } from './kit';
import { binderModel, dropTarget, roman, type BinderModel, type DropTarget } from './model';

/*
 * The outline (WS4): parts › chapters › scenes as an indented, collapsible list with columns
 * (synopsis, plot threads, status, words). Drag a row to reorder it or put it inside another
 * part or chapter (the same rules and drop line as the Manuscript's Contents); Alt+↑/↓ and
 * the menu do the same from the keyboard or a phone. The synopsis, status and threads are
 * edited in place.
 */

const INDENT = 18;

export class Outline implements BoardPane {
	private readonly el: HTMLElement;
	private listEl!: HTMLElement;
	private lineEl!: HTMLElement;
	private model!: BinderModel;
	private target: DropTarget | null = null;
	/** A synopsis being edited: the outline waits to redraw until it's done. */
	private editing = false;
	private stale = false;

	constructor(
		private readonly ctx: BoardCtx,
		parent: HTMLElement,
	) {
		this.el = parent.createDiv({ cls: 'ws-wr-ol' });
		this.bind();
		pointerDrag<string>(ctx.component, {
			root: this.el,
			item: '.ws-wr-ol__row[data-drag="true"]',
			scrollers: () => [ctx.scroller],
			start: (row) => (this.ctx.thread ? null : (row.dataset.id ?? null)),
			over: (_x, y, id) => this.over(y, id),
			drop: (_x, _y, id) => this.dropNow(id),
			end: () => {
				this.target = null;
				this.lineEl?.removeClass('is-on');
				this.listEl?.querySelectorAll('.is-drop-into').forEach((e) => e.removeClass('is-drop-into'));
			},
		});
	}

	refresh(): void {
		if (this.editing) {
			this.stale = true;
			return;
		}
		this.stale = false;
		const a = activeDocument.activeElement;
		const focusId = a instanceof HTMLElement && this.el.contains(a) ? (a.closest<HTMLElement>('.ws-wr-ol__row')?.dataset.id ?? null) : null;
		this.el.empty();
		const { st, project, thread } = this.ctx;
		this.model = binderModel(st.w.tree(project.id));
		const m = this.model;
		const head = this.el.createDiv({ cls: 'ws-wr-ol__row ws-wr-ol__row--head', attr: { 'aria-hidden': 'true' } });
		for (const [cls, t] of [
			['title', ''],
			['syn', 'Synopsis'],
			['threads', 'Point of view'],
			['status', 'Status'],
			['words', 'Words'],
		] as const)
			head.createDiv({ cls: cx('ws-wr-caps', `ws-wr-ol__${cls}`), text: t });
		if (thread) this.el.createDiv({ cls: 'ws-wr-hint ws-wr-ol__filtered', text: 'Showing one plot thread. Show every scene to reorder by dragging (Alt+↑/↓ and the menu still work).' });
		const wrap = this.el.createDiv({ cls: 'ws-wr-ol__wrap' });
		this.listEl = wrap.createDiv({ cls: 'ws-wr-ol__list', attr: { role: 'tree', 'aria-label': 'Outline' } });
		this.lineEl = wrap.createDiv({ cls: 'ws-wr-dropline', attr: { 'aria-hidden': 'true' } });
		if (!m.rows.length) this.listEl.createDiv({ cls: 'ws-wr-none', text: 'Nothing here yet. Add a chapter or a scene.' });
		m.rows.forEach((n, index) => {
			const it = st.w.item(n.id);
			if (!it) return;
			if (it.kind === 'scene' && !inThread(it, thread)) return;
			const row = this.listEl.createDiv({
				cls: cx('ws-wr-ol__row', `ws-wr-ol__row--${n.kind}`),
				attr: { role: 'treeitem', 'data-id': n.id, 'data-row': String(index), 'data-drag': 'true', tabindex: n.id === focusId ? '0' : '-1', 'aria-level': String(n.depth + 1) },
			});
			const title = row.createDiv({ cls: 'ws-wr-ol__title' });
			title.style.paddingInlineStart = `${n.depth * INDENT}px`;
			if (n.kind !== 'scene') {
				row.setAttr('aria-expanded', String(!n.collapsed));
				const chev = title.createEl('button', { cls: 'ws-wr-ol__chev clickable-icon', attr: { type: 'button', 'aria-label': n.collapsed ? `Expand ${n.title}` : `Collapse ${n.title}`, tabindex: '-1' } });
				setIcon(chev, n.collapsed ? 'chevron-right' : 'chevron-down');
				chev.addEventListener('click', () => st.w.setCollapsed(n.id, !n.collapsed));
			} else {
				const grip = title.createSpan({ cls: 'ws-wr-ol__grip', attr: { 'aria-hidden': 'true' } });
				setIcon(grip, 'grip-vertical');
			}
			if (n.kind === 'chapter') title.createSpan({ cls: 'ws-wr-ol__num', text: roman(m.chapterNo.get(n.id) ?? 0) });
			title.createSpan({ cls: 'ws-wr-ol__name', text: n.title });
			const syn = row.createDiv({ cls: cx('ws-wr-ol__syn', !it.synopsis && 'is-empty'), attr: { 'data-edit': 'synopsis', 'data-nodrag': 'true', title: 'Click to edit the synopsis' } });
			syn.setText(it.synopsis || (n.kind === 'scene' ? 'Add a synopsis…' : n.kind === 'chapter' ? `${st.w.scenesIn(n.id).length} scenes` : ''));
			const th = row.createDiv({ cls: 'ws-wr-ol__threads' });
			const st0 = row.createDiv({ cls: 'ws-wr-ol__status' });
			if (n.kind === 'scene') {
				// The design's column: whose point of view; the scene's plot threads follow as dots (click to change them).
				const pov = it.pov ? st.s.entities.get(it.pov) : undefined;
				if (pov && !pov.trashedAt) {
					const chip = th.createSpan({ cls: 'ws-wr-ol__pov', attr: { title: `Point of view: ${pov.name}` } });
					avatar(chip, st.ws.app, pov, st.s.schemas.get(pov.typeId), { size: 'xs' });
					chip.createSpan({ text: pov.name });
				}
				const tb = th.createEl('button', { cls: 'ws-wr-ol__cellbtn ws-wr-ol__threadbtn', attr: { type: 'button', 'aria-label': `Plot threads of ${it.title}`, 'data-act': 'threads' } });
				const ts = threadsOf(project, it);
				if (!ts.length && !(pov && !pov.trashedAt)) tb.createSpan({ cls: 'ws-wr-muted', text: '—' });
				for (const t of ts) tb.createSpan({ cls: cx('ws-wr-dot', `ws-tint--${t.color ?? 'gray'}`), attr: { title: t.label } });
				const s = statusFor(project, it.status);
				const sb = st0.createEl('button', { cls: cx('ws-wr-ol__cellbtn ws-wr-ix__status', `ws-tint--${s.color}`, !s.known && 'is-unknown'), attr: { type: 'button', 'aria-label': `Status of ${it.title}: ${s.label}. Change`, 'data-act': 'status' } });
				sb.createSpan({ cls: 'ws-wr-dot' });
				sb.createSpan({ text: s.label });
			}
			const words = n.kind === 'scene' ? st.w.words.words(it.notePath) : n.kind === 'part' ? null : st.w.wordCount(n.id);
			row.createDiv({ cls: 'ws-wr-ol__words', text: words ? fmt(words) : n.kind === 'part' ? '' : '—' });
		});
		const first = this.listEl.querySelector<HTMLElement>('.ws-wr-ol__row[tabindex="0"]') ?? this.listEl.querySelector<HTMLElement>('.ws-wr-ol__row');
		first?.setAttr('tabindex', '0');
		if (focusId) first?.focus({ preventScroll: true });
	}

	private rowOf(t: EventTarget | null): HTMLElement | null {
		return t instanceof Element ? (t.closest('.ws-wr-ol__row[data-id]')) : null;
	}

	private bind(): void {
		const { st } = this.ctx;
		this.el.addEventListener('click', (e) => {
			const row = this.rowOf(e.target);
			if (!row) return;
			const it = st.w.item(row.dataset.id);
			if (!it) return;
			const t = e.target as Element;
			if (t.closest('[data-edit="synopsis"]')) return this.editSynopsis(row, it);
			const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
			if (act === 'status') return this.statusMenu(it, t.closest('[data-act]') as HTMLElement);
			if (act === 'threads') return this.threadMenu(it, t.closest('[data-act]') as HTMLElement);
			this.focusRow(row);
		});
		this.el.addEventListener('dblclick', (e) => {
			const row = this.rowOf(e.target);
			if (row && !(e.target as Element).closest('[data-edit], [data-act], .ws-wr-ol__chev')) this.ctx.open(row.dataset.id!);
		});
		this.el.addEventListener('contextmenu', (e) => {
			const row = this.rowOf(e.target);
			if (!row || (e.target as Element).closest('textarea')) return;
			e.preventDefault();
			this.ctx.menu(row.dataset.id!, e);
		});
		this.el.addEventListener('keydown', (e) => {
			const row = this.rowOf(e.target);
			if (!row || e.target !== row) return;
			const it = st.w.item(row.dataset.id);
			if (!it) return;
			const rows = [...this.listEl.querySelectorAll<HTMLElement>('.ws-wr-ol__row[data-id]')];
			const i = rows.indexOf(row);
			const go = (j: number) => {
				const r = rows[Math.max(0, Math.min(rows.length - 1, j))];
				if (r) this.focusRow(r);
			};
			if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
				e.preventDefault();
				moveStep(st, it, e.key === 'ArrowUp' ? -1 : 1);
				return;
			}
			switch (e.key) {
				case 'ArrowDown':
					e.preventDefault();
					go(i + 1);
					break;
				case 'ArrowUp':
					e.preventDefault();
					go(i - 1);
					break;
				case 'ArrowRight':
					if (it.kind !== 'scene' && it.collapsed) {
						e.preventDefault();
						st.w.setCollapsed(it.id, false);
					}
					break;
				case 'ArrowLeft':
					if (it.kind !== 'scene' && !it.collapsed) {
						e.preventDefault();
						st.w.setCollapsed(it.id, true);
					}
					break;
				case 'Enter':
					e.preventDefault();
					this.ctx.open(it.id);
					break;
				case 'F2':
					e.preventDefault();
					void renameItem(st, it);
					break;
				case 'Delete':
					e.preventDefault();
					trashItem(st, it);
					break;
				case 'ContextMenu':
					e.preventDefault();
					this.ctx.menu(it.id, row);
					break;
				default:
					if (e.key === 'F10' && e.shiftKey) {
						e.preventDefault();
						this.ctx.menu(it.id, row);
					}
			}
		});
	}

	private focusRow(row: HTMLElement): void {
		this.listEl.querySelectorAll('.ws-wr-ol__row[tabindex="0"]').forEach((r) => r.setAttr('tabindex', '-1'));
		row.setAttr('tabindex', '0');
		row.focus({ preventScroll: false });
	}

	private editSynopsis(row: HTMLElement, it: ManuscriptItem): void {
		const cell = row.querySelector<HTMLElement>('.ws-wr-ol__syn');
		if (!cell || cell.querySelector('textarea')) return;
		this.editing = true;
		cell.empty();
		cell.removeClass('is-empty');
		const ta = cell.createEl('textarea', { cls: 'ws-wr-ol__synedit', attr: { rows: '2', 'aria-label': `Synopsis of ${it.title}`, placeholder: 'What happens here?' } });
		ta.value = it.synopsis;
		autoGrow(ta);
		ta.focus();
		let done = false;
		const finish = (save: boolean) => {
			if (done) return;
			done = true;
			this.editing = false;
			const cur = this.ctx.st.w.item(it.id);
			if (save && cur && cur.synopsis !== ta.value) {
				const r = this.ctx.st.w.update(it.id, { synopsis: ta.value });
				undoNotice(this.ctx.st, `Synopsis of “${it.title}” saved.`, r.undo);
			} else this.refresh();
			if (this.stale) this.refresh();
		};
		ta.addEventListener('keydown', (e) => {
			e.stopPropagation();
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				finish(true);
				row.focus();
			} else if (e.key === 'Escape') {
				e.preventDefault();
				finish(false);
				row.focus();
			}
		});
		ta.addEventListener('blur', () => finish(true));
	}

	private statusMenu(it: ManuscriptItem, at: HTMLElement): void {
		const m = new Menu();
		for (const s of this.ctx.project.statuses) m.addItem((i) => i.setTitle(s.label).setChecked(it.status === s.id).onClick(() => setStatus(this.ctx.st, it, s.id)));
		const r = at.getBoundingClientRect();
		m.showAtPosition({ x: r.left, y: r.bottom + 2 });
	}

	private threadMenu(it: ManuscriptItem, at: HTMLElement): void {
		const m = new Menu();
		const p = this.ctx.project;
		if (!p.threads.length) m.addItem((i) => i.setTitle('No plot threads yet').setDisabled(true));
		for (const t of p.threads) m.addItem((i) => i.setTitle(t.label).setChecked(it.threads.includes(t.id)).onClick(() => toggleThread(this.ctx.st, it, t.id)));
		const r = at.getBoundingClientRect();
		m.showAtPosition({ x: r.left, y: r.bottom + 2 });
	}

	// ── dragging ────────────────────────────────────────────────────────────

	private over(y: number, id: string): void {
		const rows = [...this.listEl.querySelectorAll<HTMLElement>('.ws-wr-ol__row[data-id]')];
		let row = rows.find((r) => {
			const b = r.getBoundingClientRect();
			return y >= b.top && y < b.bottom;
		});
		let t: DropTarget | null = null;
		if (row) {
			const b = row.getBoundingClientRect();
			t = dropTarget(this.model, [id], Number(row.dataset.row), b.height ? (y - b.top) / b.height : 0.5);
		} else {
			const last = rows[rows.length - 1];
			if (last && y >= last.getBoundingClientRect().bottom) t = dropTarget(this.model, [id], this.model.rows.length, 0);
			row = undefined;
		}
		this.target = t && !t.noop ? t : null;
		this.listEl.querySelectorAll('.is-drop-into').forEach((e) => e.removeClass('is-drop-into'));
		if (!this.target) {
			this.lineEl.removeClass('is-on');
			return;
		}
		const tt = this.target;
		const byRow = new Map(rows.map((r) => [Number(r.dataset.row), r]));
		const ref = tt.lineAfter >= 0 ? byRow.get(tt.lineAfter) : rows[0];
		if (!ref) return;
		const top = tt.lineAfter >= 0 ? ref.offsetTop + ref.offsetHeight : ref.offsetTop;
		this.lineEl.style.top = `${top - 1}px`;
		this.lineEl.style.left = `${8 + tt.depth * INDENT}px`;
		this.lineEl.addClass('is-on');
		if (tt.into) this.listEl.querySelector(`[data-id="${tt.into}"]`)?.addClass('is-drop-into');
	}

	private dropNow(id: string): void {
		const t = this.target;
		if (!t) return;
		const { st } = this.ctx;
		const it = st.w.item(id);
		try {
			const u = st.w.move(id, { parentId: t.parentId, index: t.index });
			const parent = t.parentId && t.parentId !== it?.parentId ? st.w.item(t.parentId) : null;
			undoNotice(st, parent ? `Moved “${it?.title ?? ''}” into “${parent.title}”. The manuscript follows.` : `Moved “${it?.title ?? ''}”. The manuscript follows.`, u);
		} catch (e) {
			new Notice(e instanceof Error ? e.message : String(e));
		}
	}
}
