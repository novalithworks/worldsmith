import { entityChip } from './worldLinks';
import type { Studio } from './kit';

/** An entry's name when it exists (not trashed), else ''. */
function liveName(st: Studio, id: string | null): string {
	const e = id ? st.s.entities.get(id) : undefined;
	return e && !e.trashedAt ? e.name : '';
}
import { Menu, Notice } from 'obsidian';
import type { ManuscriptItem } from '../../core/types';
import { autoGrow, button, cx } from '../components/dom';
import { setStatus, toggleThread, undoNotice } from './actions';
import { filterRows, inThread, sortRows, statusFor, threadsOf, type TableKey, type TableRow } from './boards';
import type { BoardCtx, BoardPane } from './cards';
import { fmt } from './kit';
import { binderModel, count, roman, chapterOf as chapterNode } from './model';
import { describeWhen, WhenModal } from './planDialogs';

/*
 * The table (WS4): one row per scene with its main fields. Click a column's name to sort
 * (again to reverse); search and filter by status (the board's plot-thread filter applies
 * too). Title and synopsis are edited in place; status, threads and date from their cells.
 * Sorting here only changes how the table is shown, never the manuscript's order.
 */

const BATCH = 150;
const COLS: ReadonlyArray<{ key: TableKey | 'synopsis'; label: string; sort: boolean }> = [
	{ key: 'order', label: '#', sort: true },
	{ key: 'title', label: 'Scene', sort: true },
	{ key: 'chapter', label: 'Chapter', sort: true },
	{ key: 'status', label: 'Status', sort: true },
	{ key: 'threads', label: 'Plot threads', sort: true },
	{ key: 'pov', label: 'Point of view', sort: true },
	{ key: 'location', label: 'Where', sort: true },
	{ key: 'date', label: 'In-story date', sort: true },
	{ key: 'words', label: 'Words', sort: true },
	{ key: 'synopsis', label: 'Synopsis', sort: false },
];

/** Sort and filters, kept while the studio is open in this window. */
const state = new Map<string, { key: TableKey; dir: 1 | -1; q: string; status: string | null; shown: number }>();

export class SceneTable implements BoardPane {
	private readonly el: HTMLElement;
	private bodyEl!: HTMLElement;
	private editing = false;
	private stale = false;

	constructor(
		private readonly ctx: BoardCtx,
		parent: HTMLElement,
	) {
		this.el = parent.createDiv({ cls: 'ws-wr-tbl' });
		this.bind();
	}

	private get s() {
		const id = this.ctx.project.id;
		let v = state.get(id);
		if (!v) state.set(id, (v = { key: 'order', dir: 1, q: '', status: null, shown: BATCH }));
		return v;
	}

	refresh(): void {
		if (this.editing) {
			this.stale = true;
			return;
		}
		this.stale = false;
		const hadSearch = activeDocument.activeElement?.hasClass?.('ws-wr-tbl__search') ?? false;
		const wrapOld = this.el.querySelector('.ws-wr-tbl__wrap');
		const left = wrapOld?.scrollLeft ?? 0;
		this.el.empty();
		const { project } = this.ctx;
		const s = this.s;
		// A status taken off the list since: show every status again (the select can't show it).
		if (s.status !== null && !project.statuses.some((x) => x.id === s.status)) s.status = null;
		const bar = this.el.createDiv({ cls: 'ws-wr-tbl__bar' });
		const search = bar.createEl('input', { cls: 'ws-input ws-wr-input ws-wr-tbl__search', attr: { type: 'search', placeholder: 'Search scenes', 'aria-label': 'Search scenes', spellcheck: 'false' } });
		search.value = s.q;
		search.addEventListener('input', () => {
			s.q = search.value;
			s.shown = BATCH;
			this.paintBody();
		});
		const sel = bar.createEl('select', { cls: 'dropdown ws-wr-select ws-wr-tbl__status', attr: { 'aria-label': 'Show scenes with status' } });
		sel.createEl('option', { text: 'Any status', attr: { value: '' } });
		for (const x of project.statuses) sel.createEl('option', { text: x.label, attr: { value: x.id } });
		sel.value = s.status ?? '';
		sel.addEventListener('change', () => {
			s.status = sel.value || null;
			s.shown = BATCH;
			this.paintBody();
		});
		bar.createSpan({ cls: 'ws-wr-muted ws-wr-tbl__count' });
		const wrap = this.el.createDiv({ cls: 'ws-wr-tbl__wrap' });
		const table = wrap.createEl('table', { cls: 'ws-wr-tbl__table' });
		const tr = table.createEl('thead').createEl('tr');
		for (const c of COLS) {
			const th = tr.createEl('th', { cls: `ws-wr-tbl__th ws-wr-tbl__c-${c.key}`, attr: { scope: 'col' } });
			if (!c.sort) {
				th.setText(c.label);
				continue;
			}
			const on = s.key === c.key;
			th.setAttr('aria-sort', on ? (s.dir === 1 ? 'ascending' : 'descending') : 'none');
			const b = th.createEl('button', { cls: cx('ws-wr-tbl__sort', on && 'is-active'), text: c.label + (on ? (s.dir === 1 ? ' ↑' : ' ↓') : ''), attr: { type: 'button', 'data-sort': c.key } });
			b.addEventListener('click', () => {
				if (s.key === c.key) s.dir = s.dir === 1 ? -1 : 1;
				else {
					s.key = c.key as TableKey;
					s.dir = 1;
				}
				this.refresh();
			});
		}
		this.bodyEl = table.createEl('tbody');
		this.paintBody();
		wrap.scrollLeft = left;
		if (hadSearch) {
			search.focus();
			search.setSelectionRange(search.value.length, search.value.length);
		}
	}

	private rows(): TableRow[] {
		const { st, project, thread } = this.ctx;
		const m = binderModel(st.w.tree(project.id));
		const chapterOf = (id: string): string => {
			const ch = chapterNode(m, id);
			if (ch) return `${roman(m.chapterNo.get(ch.id) ?? 0)}. ${ch.title}`;
			return '';
		};
		const order = new Map(project.statuses.map((x, i) => [x.id, i]));
		return st.w
			.scenes(project.id)
			.map((scene, i) => ({
				scene,
				n: i + 1,
				chapter: chapterOf(scene.id),
				statusIndex: order.get(scene.status) ?? project.statuses.length,
				statusLabel: statusFor(project, scene.status).label,
				threads: threadsOf(project, scene)
					.map((t) => t.label)
					.join(', '),
				pov: liveName(st, scene.pov),
				location: liveName(st, scene.location),
				words: st.w.words.words(scene.notePath),
			}))
			.filter((r) => inThread(r.scene, thread));
	}

	private paintBody(): void {
		const s = this.s;
		const { project, st } = this.ctx;
		const all = this.rows();
		const rows = sortRows(filterRows(all, s.q, s.status), s.key, s.dir);
		this.bodyEl.empty();
		const cnt = this.el.querySelector('.ws-wr-tbl__count');
		cnt?.setText(rows.length === all.length ? count(all.length, 'scene') : `${fmt(rows.length)} of ${count(all.length, 'scene')}`);
		if (!rows.length) {
			const td = this.bodyEl.createEl('tr').createEl('td', { cls: 'ws-wr-tbl__none', attr: { colspan: String(COLS.length) } });
			td.setText(all.length ? 'No scene matches.' : 'No scenes yet.');
			return;
		}
		for (const r of rows.slice(0, s.shown)) {
			const it = r.scene;
			const tr = this.bodyEl.createEl('tr', { cls: 'ws-wr-tbl__row', attr: { 'data-id': it.id } });
			tr.createEl('td', { cls: 'ws-wr-tbl__c-order', text: String(r.n) });
			const title = tr.createEl('td', { cls: 'ws-wr-tbl__c-title' });
			title.createEl('button', { cls: 'ws-wr-tbl__cell', text: it.title, attr: { type: 'button', 'data-act': 'title', 'aria-label': `${it.title}. Rename` } });
			tr.createEl('td', { cls: 'ws-wr-tbl__c-chapter', text: r.chapter || '—' });
			const stc = tr.createEl('td', { cls: 'ws-wr-tbl__c-status' });
			const sx = statusFor(project, it.status);
			const sb = stc.createEl('button', { cls: cx('ws-wr-tbl__cell ws-wr-ix__status', `ws-tint--${sx.color}`, !sx.known && 'is-unknown'), attr: { type: 'button', 'data-act': 'status', 'aria-label': `Status of ${it.title}: ${sx.label}. Change` } });
			sb.createSpan({ cls: 'ws-wr-dot' });
			sb.createSpan({ text: sx.label });
			const thc = tr.createEl('td', { cls: 'ws-wr-tbl__c-threads' });
			const tb = thc.createEl('button', { cls: 'ws-wr-tbl__cell', attr: { type: 'button', 'data-act': 'threads', 'aria-label': `Plot threads of ${it.title}` } });
			const ts = threadsOf(project, it);
			if (!ts.length) tb.createSpan({ cls: 'ws-wr-muted', text: '—' });
			for (const t of ts) {
				const chip = tb.createSpan({ cls: cx('ws-wr-chip', `ws-tint--${t.color ?? 'gray'}`) });
				chip.createSpan({ cls: 'ws-wr-dot' });
				chip.createSpan({ text: t.label });
			}
			// WS5: names open a preview of the entry.
			for (const key of ['pov', 'location'] as const) {
				const td = tr.createEl('td', { cls: `ws-wr-tbl__c-${key}` });
				const id = it[key];
				if (id) entityChip(td, st, id);
				else td.createSpan({ cls: 'ws-wr-muted', text: '—' });
			}
			const dc = tr.createEl('td', { cls: 'ws-wr-tbl__c-date' });
			dc.createEl('button', { cls: cx('ws-wr-tbl__cell', !it.date && 'ws-wr-muted'), text: it.date ? describeWhen(it.date, it.time) : 'Set…', attr: { type: 'button', 'data-act': 'date', 'aria-label': `In-story date of ${it.title}` } });
			tr.createEl('td', { cls: 'ws-wr-tbl__c-words', text: r.words ? fmt(r.words) : '—' });
			const syn = tr.createEl('td', { cls: 'ws-wr-tbl__c-synopsis' });
			syn.createDiv({ cls: cx('ws-wr-tbl__syn', !it.synopsis && 'is-empty'), text: it.synopsis || 'Add a synopsis…', attr: { 'data-act': 'synopsis', tabindex: '0', role: 'button', 'aria-label': `Synopsis of ${it.title}. Edit` } });
		}
		if (rows.length > s.shown) {
			const td = this.bodyEl.createEl('tr').createEl('td', { cls: 'ws-wr-tbl__more', attr: { colspan: String(COLS.length) } });
			button(td, {
				label: `Show ${Math.min(BATCH, rows.length - s.shown)} more`,
				variant: 'ghost',
				size: 'sm',
				onClick: () => {
					s.shown += BATCH;
					this.paintBody();
				},
			});
		}
	}

	private bind(): void {
		const { st } = this.ctx;
		const act = (e: Event) => {
			const t = (e.target as Element).closest<HTMLElement>('[data-act]');
			const row = (e.target as Element).closest<HTMLElement>('.ws-wr-tbl__row');
			if (!t || !row) return;
			const it = st.w.item(row.dataset.id);
			if (!it) return;
			switch (t.dataset.act) {
				case 'title':
					return this.editText(t, it, 'title');
				case 'synopsis':
					return this.editText(t, it, 'synopsis');
				case 'status': {
					const m = new Menu();
					for (const x of this.ctx.project.statuses) m.addItem((i) => i.setTitle(x.label).setChecked(it.status === x.id).onClick(() => setStatus(st, it, x.id)));
					return this.show(m, t);
				}
				case 'threads': {
					const m = new Menu();
					if (!this.ctx.project.threads.length) m.addItem((i) => i.setTitle('No plot threads yet').setDisabled(true));
					for (const x of this.ctx.project.threads) m.addItem((i) => i.setTitle(x.label).setChecked(it.threads.includes(x.id)).onClick(() => toggleThread(st, it, x.id)));
					return this.show(m, t);
				}
				case 'date':
					return new WhenModal(st, it).open();
			}
		};
		this.el.addEventListener('click', act);
		this.el.addEventListener('keydown', (e) => {
			const t = e.target as HTMLElement;
			if ((e.key === 'Enter' || e.key === ' ') && t.dataset.act === 'synopsis') {
				e.preventDefault();
				act(e);
			}
		});
		this.el.addEventListener('contextmenu', (e) => {
			const row = (e.target as Element).closest<HTMLElement>('.ws-wr-tbl__row');
			if (!row || (e.target as Element).closest('input, textarea')) return;
			e.preventDefault();
			this.ctx.menu(row.dataset.id!, e);
		});
		this.el.addEventListener('dblclick', (e) => {
			const row = (e.target as Element).closest<HTMLElement>('.ws-wr-tbl__row');
			if (row && (e.target as Element).closest('.ws-wr-tbl__c-order, .ws-wr-tbl__c-chapter, .ws-wr-tbl__c-words')) this.ctx.open(row.dataset.id!);
		});
	}

	private show(m: Menu, at: HTMLElement): void {
		const r = at.getBoundingClientRect();
		m.showAtPosition({ x: r.left, y: r.bottom + 2 });
	}

	/** Edit a title or synopsis in its cell: Enter saves, Esc leaves it as it was. */
	private editText(cell: HTMLElement, it: ManuscriptItem, key: 'title' | 'synopsis'): void {
		const td = cell.parentElement!;
		this.editing = true;
		cell.addClass('is-hidden');
		const box = key === 'title' ? td.createEl('input', { cls: 'ws-input ws-wr-input ws-wr-tbl__edit', attr: { type: 'text', 'aria-label': `Title of ${it.title}` } }) : td.createEl('textarea', { cls: 'ws-wr-tbl__edit', attr: { rows: '2', 'aria-label': `Synopsis of ${it.title}` } });
		box.value = it[key];
		if (box instanceof HTMLTextAreaElement) autoGrow(box);
		box.focus();
		box.select();
		let done = false;
		const finish = (save: boolean) => {
			if (done) return;
			done = true;
			this.editing = false;
			const v = box.value;
			const cur = this.ctx.st.w.item(it.id);
			if (save && cur && cur[key] !== v && (key !== 'title' || v.trim())) {
				try {
					const r = this.ctx.st.w.update(it.id, { [key]: key === 'title' ? v.trim() : v });
					undoNotice(this.ctx.st, key === 'title' ? `Renamed to “${v.trim()}”. The note keeps its file name.` : `Synopsis of “${it.title}” saved.`, r.undo);
				} catch (e) {
					new Notice(e instanceof Error ? e.message : String(e));
				}
			}
			this.refresh();
		};
		box.addEventListener('keydown', (e) => {
			e.stopPropagation();
			const ke = e as KeyboardEvent;
			if (ke.key === 'Enter' && !ke.shiftKey) {
				ke.preventDefault();
				finish(true);
			} else if (ke.key === 'Escape') {
				ke.preventDefault();
				finish(false);
			}
		});
		box.addEventListener('blur', () => finish(true));
	}
}
