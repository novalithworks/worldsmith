import { Notice } from 'obsidian';
import { isPlain, mainCalendar } from '../../core/calendar/engine';
import { cx, icon } from '../components/dom';
import { undoNotice } from './actions';
import { timelineModel, type TimelineSlot } from './boards';
import { bindCards, focusedCard, refocus, sceneCard, type BoardCtx, type BoardPane } from './cards';
import { pointerDrag } from './drag';
import { describeWhen, WhenModal } from './planDialogs';

/*
 * The timeline (WS4): scenes in the story's own time, a column per in-story date (and time)
 * and a lane per plot thread; the small number on each card is its place in the book, so
 * reading order and story time can be compared. Dates are the world's calendars (M10).
 * Scenes without a date wait in the tray. Drop a card on a date to give it that date, or on
 * the tray to clear it; the card's menu › In-story date… sets any date from the keyboard or
 * a phone. Dates live in Worldsmith's data, never in the notes.
 */

export class Timeline implements BoardPane {
	private readonly el: HTMLElement;
	private slots: TimelineSlot[] = [];
	private target: { slot: number } | 'tray' | null = null;

	constructor(
		private readonly ctx: BoardCtx,
		parent: HTMLElement,
	) {
		this.el = parent.createDiv({ cls: 'ws-wr-tl' });
		bindCards(this.el, ctx, (e, s) => {
			// Enter on a scene with no date asks for one; otherwise the board's default (open it).
			if (e.key !== 'Enter' || s.date) return false;
			e.preventDefault();
			new WhenModal(ctx.st, s).open();
			return true;
		});
		pointerDrag<string>(ctx.component, {
			root: this.el,
			item: '.ws-wr-ix',
			scrollers: () => [this.el.querySelector<HTMLElement>('.ws-wr-tl__scroll'), ctx.scroller].filter((x): x is HTMLElement => !!x),
			start: (el) => el.dataset.id ?? null,
			over: (_x, _y, _id, under) => this.over(under),
			drop: (_x, _y, id) => this.dropNow(id),
			end: () => {
				this.target = null;
				this.el.querySelectorAll('.is-drop-into').forEach((e) => e.removeClass('is-drop-into'));
			},
		});
	}

	refresh(): void {
		const focus = focusedCard(this.el);
		const sc = this.el.querySelector('.ws-wr-tl__scroll');
		const left = sc?.scrollLeft ?? 0;
		this.el.empty();
		const { st, project, thread } = this.ctx;
		const scenes = st.w.scenes(project.id);
		const byId = new Map(scenes.map((s) => [s.id, s]));
		const model = timelineModel(project, scenes, thread);
		this.slots = model.slots;
		if (!model.slots.length) {
			const e = this.el.createDiv({ cls: 'ws-wr-none ws-wr-tl__empty' });
			icon(e, 'calendar-clock');
			e.createDiv({ text: scenes.length ? 'No scene has an in-story date yet.' : 'No scenes yet.' });
			if (scenes.length) e.createDiv({ cls: 'ws-wr-muted', text: 'Press Enter on a scene below, or choose “In-story date…” in its menu, to give it a date. Once a scene has a date, you can drag others onto it.' });
		} else {
			const scroll = this.el.createDiv({ cls: 'ws-wr-tl__scroll' });
			const grid = scroll.createDiv({ cls: 'ws-wr-tl__grid', attr: { role: 'grid', 'aria-label': 'Scenes in story time' } });
			grid.style.setProperty('--ws-wr-tl-cols', String(model.slots.length));
			const head = grid.createDiv({ cls: 'ws-wr-tl__row ws-wr-tl__row--head', attr: { role: 'row' } });
			head.createDiv({ cls: 'ws-wr-tl__lane ws-wr-caps', text: 'Plot thread', attr: { role: 'columnheader' } });
			model.slots.forEach((s, i) => head.createDiv({ cls: 'ws-wr-tl__when', text: s.label, attr: { role: 'columnheader', 'data-slot': String(i) } }));
			const lanes = model.lanes.length ? model.lanes : [{ id: null, label: 'Scenes', color: null }];
			for (const lane of lanes) {
				const row = grid.createDiv({ cls: 'ws-wr-tl__row', attr: { role: 'row', 'data-lane': lane.id ?? '' } });
				const l = row.createDiv({ cls: 'ws-wr-tl__lane', attr: { role: 'rowheader' } });
				if (lane.color) l.createSpan({ cls: cx('ws-wr-dot', `ws-tint--${lane.color}`) });
				l.createSpan({ text: lane.label });
				const cells = model.cells.get(lane.id ?? '') ?? new Map<number, string[]>();
				model.slots.forEach((_s, i) => {
					const cell = row.createDiv({ cls: 'ws-wr-tl__cell', attr: { role: 'gridcell', 'data-slot': String(i) } });
					for (const id of cells.get(i) ?? []) {
						const sc0 = byId.get(id);
						if (sc0) sceneCard(cell, this.ctx, sc0, { size: 'mini' });
					}
				});
			}
		}
		const tray = this.el.createDiv({ cls: 'ws-wr-tl__tray', attr: { 'aria-label': 'Scenes without a date' } });
		const th = tray.createDiv({ cls: 'ws-wr-tl__trayhead' });
		th.createSpan({ cls: 'ws-wr-caps', text: `Without a date · ${model.undated.length}` });
		th.createSpan({ cls: 'ws-wr-muted', text: !model.undated.length ? 'Every scene has a date. Drop a card here to clear its date.' : model.slots.length ? 'Drag one onto a date, or press Enter on it to choose one.' : 'Press Enter on one to choose its date.' });
		const list = tray.createDiv({ cls: 'ws-wr-tl__traylist', attr: { role: 'list' } });
		for (const id of model.undated) {
			const s = byId.get(id);
			if (s) sceneCard(list, this.ctx, s, { size: 'compact' });
		}
		const cal = mainCalendar();
		const note = this.el.createDiv({ cls: 'ws-wr-hint ws-wr-tl__cal' });
		icon(note, 'calendar-days');
		note.createSpan({ text: isPlain(cal) ? 'Dates are in plain years until you set up a calendar on the Calendars page. They are kept in Worldsmith, never in your notes.' : `Dates use your world’s calendar, ${cal.name}. They are kept in Worldsmith, never in your notes.` });
		const sc1 = this.el.querySelector('.ws-wr-tl__scroll');
		if (sc1) sc1.scrollLeft = left;
		refocus(this.el, focus);
	}

	private over(under: Element | null): void {
		this.el.querySelectorAll('.is-drop-into').forEach((e) => e.removeClass('is-drop-into'));
		const slotEl = under?.closest('[data-slot]') as HTMLElement | null;
		if (slotEl && this.el.contains(slotEl)) {
			const i = Number(slotEl.dataset.slot);
			this.target = { slot: i };
			this.el.querySelectorAll(`[data-slot="${i}"]`).forEach((e) => e.addClass('is-drop-into'));
			return;
		}
		const tray = under?.closest('.ws-wr-tl__tray') as HTMLElement | null;
		if (tray && this.el.contains(tray)) {
			this.target = 'tray';
			tray.addClass('is-drop-into');
			return;
		}
		this.target = null;
	}

	private dropNow(id: string): void {
		const t = this.target;
		const { st } = this.ctx;
		const s = st.w.item(id);
		if (!t || !s) return;
		try {
			if (t === 'tray') {
				if (!s.date) return;
				const u = st.w.setWhen(id, null, null);
				undoNotice(st, `“${s.title}” has no date now.`, u);
				return;
			}
			const slot = this.slots[t.slot];
			if (!slot) return;
			if (s.date && JSON.stringify(s.date) === JSON.stringify(slot.date) && s.time === slot.time) return;
			const u = st.w.setWhen(id, { ...slot.date }, slot.time);
			undoNotice(st, `“${s.title}” now happens on ${describeWhen(slot.date, slot.time)}.`, u);
		} catch (e) {
			new Notice(e instanceof Error ? e.message : String(e));
		}
	}
}

