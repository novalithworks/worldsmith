import { Menu, Notice, setIcon } from 'obsidian';
import {
	eraLabel,
	eraYear,
	eraYearToAbs,
	formatChrono,
	formatChronoIn,
	monthDays,
	weekdayOf,
	yearLength,
	yearSegments,
} from '../../../core/calendar/engine';
import type { Calendar, CalendarDateStyle, CalendarPattern, ChronoDate, CalendarEra, CalendarFestival, CalendarMonth, SemanticColor } from '../../../core/types';
import { SEMANTIC_COLORS } from '../../../core/types';
import { DATE_TOKENS, patternsOf, tokensIn, type DateToken } from '../../../core/calendar/pattern';
import { CALENDAR_TEMPLATES, type CalendarPatch, type CalendarTemplateId } from '../../../services/CalendarService';
import type { WorldSession } from '../../../services/WorldSession';
import { ROUTES } from '../../../state/route';
import { button, cx, icon, nameRegion } from '../../components/dom';
import { own } from '../../components/lifecycle';
import { confirmModal, promptModal } from '../../components/modals';
import { actionNotice } from '../../components/notice';
import { inlineText, toggle } from './typeStudio/common';
import type { RouteContext, RouteDefinition } from './RouteRegistry';

/**
 * Studio → Calendars (0.10): how time is counted in this world. Months and their lengths,
 * the week, days outside the months (festivals, leap days), eras, and how dates are
 * written. One calendar is the main one; others are placed on it by an offset.
 */
export const calendarsRoute: RouteDefinition = {
	id: 'calendars',
	needsWorld: true,
	title: (p, s) => {
		const c = s?.calendars.get(p.id);
		return c ? `${c.name} · Calendars` : 'Calendars';
	},
	icon: () => 'calendar-range',
	render(ctx) {
		new CalendarsPage(ctx).mount();
	},
};

const STYLES: Array<{ id: Exclude<CalendarDateStyle, 'custom'>; label: string; caption: string }> = [
	{ id: 'day-month-year', label: '12 Frostmoon 312', caption: 'Day, month, year' },
	{ id: 'month-day-year', label: 'Frostmoon 12, 312', caption: 'Month, day, year' },
	{ id: 'year-month-day', label: '312, Frostmoon 12', caption: 'Year first' },
	{ id: 'numeric', label: '12/11/312', caption: 'All numbers' },
];

/** Starting points for your own format; each is shown in the calendar's own words. */
const IDEAS: string[] = [
	'the {day-th} of {month}, {year} {era}',
	'{weekday}, {day} {month} in the year {year} {era}',
	'the {day-words} day of {month}, {year-roman} {era}',
	'{month} {day} · {year} {era}',
	'{year}.{month-number}.{day} {era}',
	'{day} {month-short} {year} of the {era-name}',
];

/** The built-in style written as a pattern, so “Your own” starts from what's in use. */
function patternFrom(cal: Calendar): string {
	const wd = cal.showWeekday && cal.weekdays.length ? '{weekday}, ' : '';
	const era = cal.eras.length ? ' {era}' : '';
	switch (cal.style) {
		case 'month-day-year':
			return `${wd}{month} {day}, {year}${era}`;
		case 'year-month-day':
			return `${wd}{year}${era}, {month} {day}`;
		case 'numeric':
			return `{day}/{month-number}/{year}${era}`;
		default:
			return `${wd}{day} {month} {year}${era}`;
	}
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

class CalendarsPage {
	private id: string | null;
	private listEl!: HTMLElement;
	private mainEl!: HTMLElement;
	private queued = false;
	private pressing = false;
	private afterPress = false;
	/** The year shown in "Year at a glance" (absolute). */
	private glanceYear: number | null = null;

	constructor(private readonly ctx: RouteContext) {
		const s = ctx.session!;
		this.id = s.calendars.get(ctx.params.id)?.id ?? s.calendars.mainId();
	}

	private get s(): WorldSession {
		return this.ctx.session!;
	}

	mount(): void {
		const page = this.ctx.el.createDiv({ cls: 'ws-page ws-page--studio ws-cals' });
		const head = page.createDiv({ cls: 'ws-studio-head' });
		const mark = head.createDiv({ cls: 'ws-db-header__mark ws-tint--purple' });
		icon(mark, 'calendar-range');
		const ht = head.createDiv({ cls: 'ws-db-header__text' });
		ht.createEl('h1', { cls: 'ws-db-header__title', text: 'Calendars' });
		ht.createDiv({ cls: 'ws-db-header__desc', text: 'How time is counted in your world: months, weeks, festivals and eras.' });
		const actions = head.createDiv({ cls: 'ws-db-header__actions' });
		button(actions, { label: 'Timeline', icon: 'gantt-chart', variant: 'ghost', onClick: () => this.ctx.navigate(ROUTES.timeline()) });
		button(actions, { label: 'New calendar', icon: 'plus', variant: 'primary', onClick: (e) => this.newMenu(e) });

		const body = page.createDiv({ cls: 'ws-studio' });
		this.listEl = body.createDiv({ cls: 'ws-studio__list', attr: { role: 'navigation' } });
		nameRegion(this.listEl, 'Calendars');
		this.mainEl = body.createDiv({ cls: 'ws-studio__main' });
		this.mainEl.addEventListener('pointerdown', () => (this.pressing = true), true);
		const release = () => {
			if (!this.pressing) return;
			this.pressing = false;
			if (!this.afterPress) return;
			this.afterPress = false;
			this.queued = false;
			// After the click that follows this press.
			window.setTimeout(() => this.queue(), 0);
		};
		this.ctx.el.ownerDocument.addEventListener('pointerup', release, true);
		this.ctx.el.ownerDocument.addEventListener('pointercancel', release, true);
		own(this.ctx.component, {
			dispose: () => {
				this.ctx.el.ownerDocument.removeEventListener('pointerup', release, true);
				this.ctx.el.ownerDocument.removeEventListener('pointercancel', release, true);
			},
		});
		this.render(true);
		for (const ev of ['calendar:saved', 'calendar:deleted'] as const) own(this.ctx.component, this.s.events.on(ev, () => this.queue()));
		own(this.ctx.component, this.s.events.on('world:updated', ({ keys }) => keys.includes('mainCalendar') && this.queue()));
	}

	private queue(): void {
		if (this.queued) return;
		this.queued = true;
		// Not mid-click: a save on blur would otherwise swap the button out before its click lands.
		if (this.pressing) {
			this.afterPress = true;
			return;
		}
		window.requestAnimationFrame(() => {
			this.queued = false;
			if (!this.ctx.el.isConnected) return;
			if (!this.s.calendars.get(this.id)) this.id = this.s.calendars.mainId();
			this.render(false);
		});
	}

	/** Redraw, keeping the focused input (by its data-k) and the scroll position. */
	private render(resetScroll: boolean): void {
		const active = document.activeElement as HTMLElement | null;
		const k = active && this.mainEl?.contains(active) ? active.getAttribute('data-k') : null;
		const caret = active instanceof HTMLInputElement ? { start: active.selectionStart, end: active.selectionEnd } : null;
		const scroller = this.mainEl.closest('.ws-shell__page');
		const scroll = scroller?.scrollTop ?? 0;
		const h = this.mainEl.offsetHeight;
		if (h) this.mainEl.style.minHeight = `${h}px`;
		this.renderList();
		this.renderMain();
		this.mainEl.setCssStyles({ minHeight: '' });
		if (scroller) scroller.scrollTop = resetScroll ? 0 : scroll;
		if (k) {
			const next = this.mainEl.querySelector<HTMLElement>(`[data-k="${CSS.escape(k)}"]`);
			next?.focus();
			// Format boxes keep the cursor where it was; other boxes select their text to retype.
			if (next instanceof HTMLInputElement && k.startsWith('pattern-') && caret?.start != null) next.setSelectionRange(caret.start, caret.end ?? caret.start);
			else if (next instanceof HTMLInputElement) next.select();
		}
	}

	private select(id: string): void {
		this.id = id;
		this.glanceYear = null;
		this.ctx.replaceParams({ id });
		this.ctx.setTitle(`${this.s.calendars.get(id)?.name ?? ''} · Calendars`);
		this.render(true);
	}

	private newMenu(evt: MouseEvent): void {
		const m = new Menu();
		for (const t of CALENDAR_TEMPLATES) m.addItem((i) => i.setTitle(t.name).setIcon(t.icon).onClick(() => void this.create(t.id)));
		m.showAtMouseEvent(evt);
	}

	private async create(template: CalendarTemplateId): Promise<void> {
		const first = !this.s.calendars.list().length;
		const tpl = CALENDAR_TEMPLATES.find((t) => t.id === template)!;
		const name = first
			? 'Reckoning'
			: await promptModal(this.ctx.ws.app, { title: 'New calendar', label: 'Name', value: tpl.name, placeholder: 'e.g. Elven reckoning', confirmLabel: 'Create' });
		if (!name?.trim()) return;
		const c = this.s.calendars.create({ name: name.trim(), template });
		this.select(c.id);
		if (first) new Notice(`“${c.name}” is now your world’s calendar. Rename anything to make it yours.`);
	}

	// ── list ──────────────────────────────────────────────────────────────────

	private renderList(): void {
		const el = this.listEl;
		el.empty();
		const list = this.s.calendars.list();
		const main = this.s.calendars.mainId();
		if (list.length) {
			const sel = el.createEl('select', { cls: 'ws-input dropdown ws-studio__select', attr: { 'aria-label': 'Calendar' } });
			for (const c of list) sel.createEl('option', { text: c.id === main ? `${c.name} (main)` : c.name, value: c.id });
			if (this.id) sel.value = this.id;
			sel.addEventListener('change', () => this.select(sel.value));
		}
		const items = el.createDiv({ cls: 'ws-rlist__items' });
		const g = items.createDiv({ cls: 'ws-rlist__cat' });
		const h = g.createDiv({ cls: 'ws-rlist__cat-head is-static' });
		h.createSpan({ cls: 'ws-rlist__cat-label', text: 'Your calendars' });
		h.createSpan({ cls: 'ws-rlist__cat-n', text: String(list.length) });
		if (!list.length) g.createDiv({ cls: 'ws-rlist__empty', text: 'None yet. Dates are plain numbered years until you set one up.' });
		for (const c of list) {
			const on = c.id === this.id;
			const item = g.createEl('button', { cls: cx('ws-rlist__item', on && 'is-active', 'ws-tint--purple'), attr: { type: 'button', 'aria-current': on ? 'true' : 'false', 'data-cal': c.id } });
			const glyph = item.createSpan({ cls: 'ws-rlist__glyph' });
			setIcon(glyph, c.months.length ? 'calendar-days' : 'hourglass');
			const tx = item.createSpan({ cls: 'ws-rlist__text' });
			tx.createSpan({ cls: 'ws-rlist__name', text: c.name });
			tx.createSpan({ cls: 'ws-rlist__reads', text: c.months.length ? `${plural(c.months.length, 'month')} · ${yearLength(c, 1)} days` : plural(c.eras.length, 'era') });
			if (c.id === main) item.createSpan({ cls: 'ws-rlist__badge', text: 'Main' });
			item.addEventListener('click', () => this.select(c.id));
		}
	}

	// ── main ──────────────────────────────────────────────────────────────────

	/** A section card in the studio look: a tinted mark, title, a line about it, a slot on the right. */
	private card(parent: HTMLElement, o: { title: string; hint?: string; icon: string; wide?: boolean; anchor: string }): { body: HTMLElement; aside: HTMLElement } {
		const c = parent.createEl('section', { cls: cx('ws-rcard ws-cal-card', o.wide && 'ws-rcard--wide'), attr: { 'data-anchor': o.anchor } });
		const h = c.createDiv({ cls: 'ws-cal-card__head' });
		const mark = h.createDiv({ cls: 'ws-cal-card__mark' });
		setIcon(mark, o.icon);
		const t = h.createDiv({ cls: 'ws-cal-card__titles' });
		t.createDiv({ cls: 'ws-cal-card__title', text: o.title });
		if (o.hint) t.createDiv({ cls: 'ws-cal-card__hint', text: o.hint });
		const aside = h.createDiv({ cls: 'ws-cal-card__aside' });
		return { body: c.createDiv({ cls: 'ws-rcard__body ws-cal-card__body' }), aside };
	}

	private renderMain(): void {
		const el = this.mainEl;
		el.empty();
		const C = this.s.calendars;
		const cal = C.get(this.id);
		if (!cal) {
			this.renderStart(el);
			return;
		}
		const isMain = C.mainId() === cal.id;
		const update = (patch: CalendarPatch) => {
			try {
				C.update(cal.id, patch);
			} catch (e) {
				new Notice(e instanceof Error ? e.message : String(e));
			}
		};
		/** A change that removes something gets an Undo. */
		const removing = (message: string, patch: CalendarPatch) => {
			let r: ReturnType<typeof C.update> = null;
			try {
				r = C.update(cal.id, patch);
			} catch (e) {
				new Notice(e instanceof Error ? e.message : String(e));
			}
			if (r) actionNotice(message, { label: 'Undo', run: () => C.restore(r.before) });
		};

		// ── Hero.
		const hero = el.createDiv({ cls: 'ws-rhero ws-tint--purple ws-cal-hero' });
		const m = hero.createDiv({ cls: 'ws-rhero__mark ws-cal-hero__mark' });
		setIcon(m, cal.months.length ? 'calendar-days' : 'hourglass');
		const ht = hero.createDiv({ cls: 'ws-rhero__text' });
		inlineText(ht, cal.name, { cls: 'ws-rhero__name', ariaLabel: 'Calendar name', onCommit: (v) => v.trim() && update({ name: v.trim() }) });
		const meta = ht.createDiv({ cls: 'ws-rhero__meta' });
		if (isMain) meta.createSpan({ cls: 'ws-rlist__badge', text: 'Main calendar' });
		meta.createSpan({ text: cal.months.length ? `${plural(cal.months.length, 'month')} · ${yearLength(cal, 1)} days a year` : 'Years and eras' });
		meta.createSpan({ cls: 'ws-rhero__dot', text: '·' });
		const used = C.usage(cal.id);
		meta.createSpan({ text: `${plural(used, 'date')} written in it` });
		inlineText(ht, cal.description, { cls: 'ws-rhero__desc', multiline: true, ariaLabel: 'Description', placeholder: 'Who counts time this way, and since when…', onCommit: (v) => update({ description: v.trim() }) });
		const ha = hero.createDiv({ cls: 'ws-cal-hero__actions' });
		if (!isMain) button(ha, { label: 'Make main', icon: 'star', variant: 'ghost', size: 'sm', onClick: () => C.setMain(cal.id) });
		button(ha, {
			icon: 'more-horizontal',
			variant: 'quiet',
			size: 'sm',
			tooltip: 'More',
			cls: 'ws-cal-hero__more',
			onClick: (evt) => {
				const menu = new Menu();
				menu.addItem((i) =>
					i.setTitle('Duplicate').setIcon('copy').onClick(() => {
						const copy = C.duplicate(cal.id);
						if (copy) this.select(copy.id);
					}),
				);
				menu.addSeparator();
				menu.addItem((i) => i.setTitle('Delete calendar…').setIcon('trash-2').setWarning(true).onClick(() => void this.remove(cal, used)));
				menu.showAtMouseEvent(evt);
			},
		});

		this.renderShowcase(el, cal);

		// Jump to a part of a long page.
		const sections: Array<[string, string, string]> = [
			['glance', 'Year at a glance', 'calendar-range'],
			['months', 'Months', 'calendar'],
			['week', 'Week', 'repeat'],
			['festivals', 'Special days', 'sparkles'],
			['eras', 'Eras', 'milestone'],
			['writing', 'How dates are written', 'pen-line'],
		];
		if (!isMain) sections.push(['offset', 'Lining up', 'arrow-left-right']);
		const jump = el.createDiv({ cls: 'ws-cal-jump', attr: { role: 'navigation', 'aria-label': 'Parts of this calendar' } });
		for (const [id, label, ic] of sections) {
			const b = jump.createEl('button', { cls: 'ws-cal-jump__item', attr: { type: 'button', 'data-jump': id } });
			icon(b, ic);
			b.createSpan({ text: label });
			b.addEventListener('click', () => el.querySelector(`[data-anchor="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
		}

		const grid = el.createDiv({ cls: 'ws-rgrid ws-cal-grid' });
		const days = yearLength(cal, this.glanceYear ?? 0);
		const g = this.card(grid, { title: 'Year at a glance', hint: 'Every month and the days outside them.', icon: 'calendar-range', wide: true, anchor: 'glance' });
		this.renderGlance(g.body, g.aside, cal);
		const mo = this.card(grid, { title: 'Months', hint: cal.months.length ? `${monthDays(cal)} days in the months, ${days} in the whole year.` : 'No months: dates are years only.', icon: 'calendar', wide: true, anchor: 'months' });
		if (cal.months.length) mo.aside.createSpan({ cls: 'ws-cal-count', text: plural(cal.months.length, 'month') });
		this.renderMonths(mo.body, cal, update, removing);
		const wk = this.card(grid, { title: 'Week', hint: 'The names of the days, in order.', icon: 'repeat', anchor: 'week' });
		if (cal.weekdays.length) wk.aside.createSpan({ cls: 'ws-cal-count', text: plural(cal.weekdays.length, 'day') });
		this.renderWeek(wk.body, cal, update, removing);
		const fe = this.card(grid, { title: 'Days outside the months', hint: 'Festivals, holy days and leap days.', icon: 'sparkles', anchor: 'festivals' });
		if (cal.festivals.length) fe.aside.createSpan({ cls: 'ws-cal-count', text: plural(cal.festivals.length, 'festival') });
		this.renderFestivals(fe.body, cal, update, removing);
		const er = this.card(grid, { title: 'Eras', hint: 'Ways of counting the years, like “Third Age” or “Before the Fall”.', icon: 'milestone', wide: true, anchor: 'eras' });
		if (cal.eras.length) er.aside.createSpan({ cls: 'ws-cal-count', text: plural(cal.eras.length, 'era') });
		this.renderEras(er.body, cal, update, removing);
		this.renderStyle(this.card(grid, { title: 'How dates are written', hint: 'Pick a style, or write dates your own way.', icon: 'pen-line', wide: true, anchor: 'writing' }).body, cal, update);
		if (!isMain) this.renderOffset(this.card(grid, { title: 'Lining up with the main calendar', hint: 'So dates from both calendars sit together on the timeline.', icon: 'arrow-left-right', wide: true, anchor: 'offset' }).body, cal, update);
	}

	private renderStart(el: HTMLElement): void {
		const intro = el.createDiv({ cls: 'ws-rhero ws-tint--purple ws-cal-start' });
		const m = intro.createDiv({ cls: 'ws-rhero__mark' });
		setIcon(m, 'calendar-range');
		const t = intro.createDiv({ cls: 'ws-rhero__text' });
		t.createDiv({ cls: 'ws-cal-start__title', text: 'Give your world its own calendar' });
		t.createDiv({ cls: 'ws-rhero__desc', text: 'Right now dates are plain numbered years. Pick a starting point below; you can rename every month, day and era afterwards. Dates you already wrote stay as they are.' });
		const cards = el.createDiv({ cls: 'ws-cal-templates' });
		for (const tpl of CALENDAR_TEMPLATES) {
			const b = cards.createEl('button', { cls: 'ws-cal-template', attr: { type: 'button', 'data-template': tpl.id } });
			const g = b.createDiv({ cls: 'ws-cal-template__icon' });
			setIcon(g, tpl.icon);
			b.createDiv({ cls: 'ws-cal-template__name', text: tpl.name });
			b.createDiv({ cls: 'ws-cal-template__blurb', text: tpl.blurb });
			const sample = tpl.build();
			const strip = b.createDiv({ cls: 'ws-cal-template__strip', attr: { 'aria-hidden': 'true' } });
			const total = sample.months.reduce((n, x) => n + x.days, 0) + sample.festivals.reduce((n, f) => n + f.days, 0);
			if (!total) strip.createDiv({ cls: 'ws-cal-template__seg is-era' });
			for (const mo of sample.months) strip.createDiv({ cls: 'ws-cal-template__seg', attr: { style: `flex:${mo.days}` } });
			for (const f of sample.festivals) strip.createDiv({ cls: 'ws-cal-template__seg is-fest', attr: { style: `flex:${Math.max(3, f.days)}` } });
			b.addEventListener('click', () => void this.create(tpl.id));
		}
	}

	private async remove(cal: Calendar, used: number): Promise<void> {
		const ok = await confirmModal(this.ctx.ws.app, {
			title: `Delete “${cal.name}”?`,
			body: used
				? `${plural(used, 'date')} written in this calendar ${used === 1 ? 'is' : 'are'} kept exactly as stored and shown in the main calendar instead. You can undo this.`
				: 'No dates use it. You can undo this.',
			confirmLabel: 'Delete calendar',
			danger: true,
		});
		if (!ok) return;
		const r = this.s.calendars.remove(cal.id);
		if (r) actionNotice(`Deleted “${cal.name}”.`, { label: 'Undo', run: () => this.s.calendars.restore(r.calendar, r.wasMain) });
	}

	// ── sections ──────────────────────────────────────────────────────────────

	private num(parent: HTMLElement, value: number, o: { k: string; label: string; min?: number; max?: number; cls?: string; onCommit: (n: number) => void }): HTMLInputElement {
		const input = parent.createEl('input', { cls: cx('ws-field-input ws-field-input--num ws-cal-num', o.cls), attr: { type: 'text', inputmode: 'numeric', 'aria-label': o.label, 'data-k': o.k } });
		input.value = String(value);
		let committed = input.value;
		const commit = () => {
			const t = input.value.trim();
			if (t === committed) return;
			if (!/^-?\d+$/.test(t)) {
				input.value = committed;
				return;
			}
			const n = Math.min(o.max ?? Infinity, Math.max(o.min ?? -Infinity, Number(t)));
			input.value = String(n);
			committed = input.value;
			o.onCommit(n);
		};
		input.addEventListener('blur', commit);
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				input.blur();
			} else if (e.key === 'Escape') {
				input.value = committed;
				input.blur();
			}
		});
		return input;
	}

	private text(parent: HTMLElement, value: string, o: { k: string; label: string; placeholder?: string; cls?: string; onCommit: (v: string) => void }): HTMLInputElement {
		const input = inlineText(parent, value, { cls: cx('ws-input-like ws-cal-text', o.cls).join(' '), ariaLabel: o.label, placeholder: o.placeholder, onCommit: o.onCommit }) as HTMLInputElement;
		input.setAttr('data-k', o.k);
		return input;
	}

	private moveButtons<T>(row: HTMLElement, list: T[], i: number, save: (next: T[]) => void): void {
		const mv = (dir: number) => {
			const next = [...list];
			const [x] = next.splice(i, 1);
			next.splice(i + dir, 0, x!);
			save(next);
		};
		button(row, { icon: 'chevron-up', variant: 'quiet', size: 'sm', tooltip: 'Move up', disabled: i === 0, cls: 'ws-cal-row__mv', onClick: () => mv(-1) });
		button(row, { icon: 'chevron-down', variant: 'quiet', size: 'sm', tooltip: 'Move down', disabled: i === list.length - 1, cls: 'ws-cal-row__mv', onClick: () => mv(1) });
	}

	private renderMonths(b: HTMLElement, cal: Calendar, update: (p: CalendarPatch) => void, removing: (msg: string, p: CalendarPatch) => void): void {
		const ms = cal.months;
		const save = (next: CalendarMonth[]) => update({ months: next });
		if (ms.length) {
			// The year as a ribbon: each month as long as its days, festivals where they fall.
			const strip = b.createDiv({ cls: 'ws-cal-strip', attr: { 'aria-hidden': 'true' } });
			const fests = (after: number) => cal.festivals.filter((f) => f.after === after);
			const festSeg = (f: CalendarFestival) => {
				const seg = strip.createDiv({ cls: 'ws-cal-strip__seg is-fest', attr: { title: `${f.name}: ${plural(f.days, 'day')}${f.every > 1 ? `, every ${f.every} years` : ''}` } });
				seg.style.flexGrow = String(Math.max(2, f.days));
			};
			fests(0).forEach(festSeg);
			ms.forEach((mo, i) => {
				const seg = strip.createDiv({ cls: cx('ws-cal-strip__seg', i % 2 === 1 && 'is-alt'), attr: { title: `${mo.name}: ${plural(mo.days, 'day')}` } });
				seg.style.flexGrow = String(mo.days);
				seg.createSpan({ cls: 'ws-cal-strip__label', text: mo.short || mo.name.slice(0, 3) });
				fests(i + 1).forEach(festSeg);
			});
			const head = b.createDiv({ cls: 'ws-cal-rows__head ws-cal-rows--months' });
			for (const t of ['', 'Name', 'Short', 'Days', '']) head.createSpan({ text: t });
		}
		const rows = b.createDiv({ cls: 'ws-cal-rows' });
		ms.forEach((mo, i) => {
			const r = rows.createDiv({ cls: 'ws-cal-row ws-cal-rows--months', attr: { 'data-month': mo.id } });
			r.createSpan({ cls: 'ws-cal-row__n', text: String(i + 1) });
			this.text(r, mo.name, { k: `m-name-${mo.id}`, label: `Month ${i + 1} name`, onCommit: (v) => save(ms.map((x) => (x.id === mo.id ? { ...x, name: v.trim() || x.name } : x))) });
			this.text(r, mo.short ?? '', { k: `m-short-${mo.id}`, label: `Month ${i + 1} short name`, placeholder: mo.name.slice(0, 3), cls: 'ws-cal-text--short', onCommit: (v) => save(ms.map((x) => (x.id === mo.id ? { ...x, short: v.trim() } : x))) });
			this.num(r, mo.days, { k: `m-days-${mo.id}`, label: `Month ${i + 1} days`, min: 1, max: 400, onCommit: (n) => save(ms.map((x) => (x.id === mo.id ? { ...x, days: n } : x))) });
			const tools = r.createDiv({ cls: 'ws-cal-row__tools' });
			// Dates follow their month when it moves; Undo moves them back.
			this.moveButtons(tools, ms, i, (next) =>
				removing(`Moved “${mo.name}”.`, {
					months: next,
					// A festival stays after the month it followed (the start and end of the year stay put).
					festivals: cal.festivals.map((f) => (f.after > 0 && f.after < ms.length && ms[f.after - 1] ? { ...f, after: next.findIndex((x) => x.id === ms[f.after - 1]!.id) + 1 } : f)),
				}),
			);
			const used = this.s.calendars.monthUsage(cal.id, i + 1);
			button(tools, {
				icon: 'x',
				variant: 'quiet',
				size: 'sm',
				tooltip: used ? `Used by ${plural(used, 'date')}, so it can’t be removed` : 'Remove month',
				disabled: used > 0,
				onClick: () =>
					removing(`Removed “${mo.name}”.`, {
						months: ms.filter((x) => x.id !== mo.id),
						// Festivals keep their place after the same month.
						festivals: cal.festivals.map((f) => (f.after > i ? { ...f, after: f.after - 1 } : f)),
					}),
			});
		});
		const add = b.createDiv({ cls: 'ws-cal-add' });
		button(add, { label: 'Add month', icon: 'plus', variant: 'ghost', size: 'sm', onClick: () => save([...ms, this.s.calendars.newMonth(`Month ${ms.length + 1}`, ms[ms.length - 1]?.days ?? 30)]) });
	}

	private renderWeek(b: HTMLElement, cal: Calendar, update: (p: CalendarPatch) => void, removing: (msg: string, p: CalendarPatch) => void): void {
		const wd = cal.weekdays;
		const chips = b.createDiv({ cls: 'ws-weekdays' });
		wd.forEach((w, i) => {
			const c = chips.createDiv({ cls: 'ws-weekdays__day' });
			c.createSpan({ cls: 'ws-weekdays__n', text: String(i + 1) });
			this.text(c, w, { k: `w-${i}`, label: `Weekday ${i + 1}`, onCommit: (v) => v.trim() && update({ weekdays: wd.map((x, j) => (j === i ? v.trim() : x)) }) });
			button(c, { icon: 'x', variant: 'quiet', size: 'sm', tooltip: 'Remove day', onClick: () => removing(`Removed “${w}”.`, { weekdays: wd.filter((_, j) => j !== i), weekdayOffset: 0 }) });
		});
		const add = b.createDiv({ cls: 'ws-cal-add' });
		button(add, { label: wd.length ? 'Add day' : 'Add a week', icon: 'plus', variant: 'ghost', size: 'sm', onClick: () => update({ weekdays: [...wd, `Day ${wd.length + 1}`] }) });
		if (wd.length && cal.months.length) {
			const r = b.createDiv({ cls: 'ws-cal-line' });
			r.createSpan({ cls: 'ws-cal-line__label', text: 'Year 0 begins on a' });
			const sel = r.createEl('select', { cls: 'dropdown ws-cal-sel', attr: { 'aria-label': 'First weekday', 'data-k': 'w-offset' } });
			wd.forEach((w, i) => sel.createEl('option', { text: w, value: String(i) }));
			sel.value = String(cal.weekdayOffset);
			sel.addEventListener('change', () => update({ weekdayOffset: Number(sel.value) }));
			const t = b.createDiv({ cls: 'ws-cal-line' });
			t.createSpan({ cls: 'ws-cal-line__label', text: 'Show the weekday in dates' });
			if (cal.style === 'custom') t.createSpan({ cls: 'ws-cal-line__note', text: 'Your own format decides: add “Weekday” to it.' });
			else toggle(t, cal.showWeekday, (v) => update({ showWeekday: v }), 'Show the weekday in dates');
		}
	}

	private renderFestivals(b: HTMLElement, cal: Calendar, update: (p: CalendarPatch) => void, removing: (msg: string, p: CalendarPatch) => void): void {
		const fs = cal.festivals;
		const save = (next: CalendarFestival[]) => update({ festivals: next });
		if (!cal.months.length) {
			b.createDiv({ cls: 'ws-rcard__empty', text: 'Add months first: these days sit between them.' });
			return;
		}
		const rows = b.createDiv({ cls: 'ws-cal-rows' });
		for (const f of fs) {
			const r = rows.createDiv({ cls: 'ws-cal-fest', attr: { 'data-fest': f.id } });
			const top = r.createDiv({ cls: 'ws-cal-fest__top' });
			const fm = top.createSpan({ cls: 'ws-cal-fest__mark' });
			setIcon(fm, f.every > 1 ? 'refresh-cw' : 'sparkles');
			this.text(top, f.name, { k: `f-name-${f.id}`, label: 'Name', onCommit: (v) => save(fs.map((x) => (x.id === f.id ? { ...x, name: v.trim() || x.name } : x))) });
			button(top, { icon: 'x', variant: 'quiet', size: 'sm', tooltip: 'Remove', onClick: () => removing(`Removed “${f.name}”.`, { festivals: fs.filter((x) => x.id !== f.id) }) });
			const line = r.createDiv({ cls: 'ws-cal-fest__line' });
			this.num(line, f.days, { k: `f-days-${f.id}`, label: `${f.name} length in days`, min: 1, max: 60, onCommit: (n) => save(fs.map((x) => (x.id === f.id ? { ...x, days: n } : x))) });
			line.createSpan({ text: f.days === 1 ? 'day' : 'days' });
			const sel = line.createEl('select', { cls: 'dropdown ws-cal-sel', attr: { 'aria-label': `${f.name} position`, 'data-k': `f-after-${f.id}` } });
			sel.createEl('option', { value: '0', text: `before ${cal.months[0]?.name ?? 'the first month'}` });
			cal.months.forEach((mo, i) => sel.createEl('option', { value: String(i + 1), text: `after ${mo.name}` }));
			sel.value = String(f.after);
			sel.addEventListener('change', () => save(fs.map((x) => (x.id === f.id ? { ...x, after: Number(sel.value) } : x))));
			const where = f.after === 0 ? `before ${cal.months[0]?.name ?? 'the first month'}` : `after ${cal.months[f.after - 1]?.name ?? 'the last month'}`;
			r.createDiv({ cls: 'ws-cal-fest__says', text: `${plural(f.days, 'day')} ${where}, ${f.every === 1 ? 'every year' : `every ${f.every} years (a leap ${f.days === 1 ? 'day' : 'time'})`}.` });
			const every = r.createDiv({ cls: 'ws-cal-fest__line' });
			every.createSpan({ text: 'every' });
			this.num(every, f.every, { k: `f-every-${f.id}`, label: `${f.name} repeats every`, min: 1, max: 1000, onCommit: (n) => save(fs.map((x) => (x.id === f.id ? { ...x, every: n } : x))) });
			every.createSpan({ text: f.every === 1 ? 'year' : 'years' });
			if (f.every > 1) {
				every.createSpan({ text: 'starting in year' });
				this.num(every, f.from ?? 0, { k: `f-from-${f.id}`, label: `${f.name} first year`, onCommit: (n) => save(fs.map((x) => (x.id === f.id ? { ...x, from: n } : x))) });
			}
		}
		const add = b.createDiv({ cls: 'ws-cal-add' });
		button(add, { label: 'Add days', icon: 'plus', variant: 'ghost', size: 'sm', onClick: () => save([...fs, this.s.calendars.newFestival(cal.months.length)]) });
	}

	private renderEras(b: HTMLElement, cal: Calendar, update: (p: CalendarPatch) => void, removing: (msg: string, p: CalendarPatch) => void): void {
		const es = [...cal.eras].sort((a, b2) => a.start - b2.start);
		const save = (next: CalendarEra[]) => update({ eras: next });
		const patch = (id: string, p: Partial<CalendarEra>) => save(cal.eras.map((x) => (x.id === id ? { ...x, ...p } : x)));
		if (es.length) {
			// A ribbon of the eras in order.
			const ribbon = b.createDiv({ cls: 'ws-cal-ribbon', attr: { 'aria-hidden': 'true' } });
			for (const e of es) {
				const seg = ribbon.createDiv({ cls: cx('ws-cal-ribbon__era', `ws-tint--${e.color ?? 'gray'}`, e.direction === 'down' && 'is-down') });
				seg.createSpan({ cls: 'ws-cal-ribbon__name', text: e.name });
				seg.createSpan({ cls: 'ws-cal-ribbon__abbr', text: e.abbr || '' });
			}
		}
		const rows = b.createDiv({ cls: 'ws-cal-rows' });
		for (const e of es) {
			const r = rows.createDiv({ cls: cx('ws-cal-era', `ws-tint--${e.color ?? 'gray'}`), attr: { 'data-era': e.id } });
			const dot = r.createEl('button', { cls: 'ws-cal-era__dot', attr: { type: 'button', 'aria-label': 'Color' } });
			dot.addEventListener('click', (evt) => {
				const menu = new Menu();
				for (const c of SEMANTIC_COLORS) menu.addItem((i) => i.setTitle(c[0]!.toUpperCase() + c.slice(1)).setChecked(e.color === c).onClick(() => patch(e.id, { color: c })));
				menu.showAtMouseEvent(evt);
			});
			const main = r.createDiv({ cls: 'ws-cal-era__main' });
			const top = main.createDiv({ cls: 'ws-cal-era__top' });
			this.text(top, e.name, { k: `e-name-${e.id}`, label: 'Era name', onCommit: (v) => patch(e.id, { name: v.trim() || e.name }) });
			this.text(top, e.abbr, { k: `e-abbr-${e.id}`, label: 'Short form', placeholder: 'Short', cls: 'ws-cal-text--short', onCommit: (v) => patch(e.id, { abbr: v.trim() }) });
			const line = main.createDiv({ cls: 'ws-cal-fest__line' });
			const dir = line.createEl('select', { cls: 'dropdown ws-cal-sel', attr: { 'aria-label': 'Counting', 'data-k': `e-dir-${e.id}` } });
			dir.createEl('option', { value: 'up', text: 'Counts up from' });
			dir.createEl('option', { value: 'down', text: 'Counts back from' });
			dir.value = e.direction;
			dir.addEventListener('change', () => patch(e.id, { direction: dir.value === 'down' ? 'down' : 'up' }));
			line.createSpan({ text: 'year' });
			this.num(line, e.start, { k: `e-start-${e.id}`, label: `${e.name} starts in year`, onCommit: (n) => patch(e.id, { start: n }) });
			line.createSpan({ text: ', called' });
			const fy = line.createEl('select', { cls: 'dropdown ws-cal-sel', attr: { 'aria-label': 'First year is called', 'data-k': `e-first-${e.id}` } });
			fy.createEl('option', { value: '1', text: `1 ${eraLabel(e)}` });
			fy.createEl('option', { value: '0', text: `0 ${eraLabel(e)}` });
			fy.value = String(e.firstYear);
			fy.addEventListener('change', () => patch(e.id, { firstYear: fy.value === '0' ? 0 : 1 }));
			const ex = main.createDiv({ cls: 'ws-cal-era__example' });
			const y0 = e.direction === 'up' ? e.start : e.start;
			const y1 = e.direction === 'up' ? e.start + 99 : e.start - 99;
			ex.setText(`Year ${y0} on the shared line is ${eraYear(e, y0)} ${eraLabel(e)}; year ${y1} is ${eraYear(e, y1)} ${eraLabel(e)}.`);
			const tools = r.createDiv({ cls: 'ws-cal-row__tools' });
			button(tools, { icon: 'x', variant: 'quiet', size: 'sm', tooltip: 'Remove era', onClick: () => removing(`Removed “${e.name}”.`, { eras: cal.eras.filter((x) => x.id !== e.id) }) });
		}
		if (!es.length) b.createDiv({ cls: 'ws-rcard__empty', text: 'No eras: years are plain numbers, and years before 0 read “BE”.' });
		const add = b.createDiv({ cls: 'ws-cal-add' });
		button(add, {
			label: 'Add era',
			icon: 'plus',
			variant: 'ghost',
			size: 'sm',
			onClick: () => {
				const last = es[es.length - 1];
				save([...cal.eras, this.s.calendars.newEra(last ? last.start + 1000 : 0)]);
			},
		});
	}

	private renderStyle(b: HTMLElement, cal: Calendar, update: (p: CalendarPatch) => void): void {
		const custom = cal.style === 'custom';
		const cards = b.createDiv({ cls: 'ws-cal-stylecards', attr: { role: 'radiogroup', 'aria-label': 'Date style' } });
		const choice = (id: CalendarDateStyle, label: string, caption: string, ic?: string) => {
			const on = cal.style === id;
			const c = cards.createEl('button', { cls: cx('ws-cal-stylecard', on && 'is-on', id === 'custom' && 'is-own'), attr: { type: 'button', role: 'radio', 'aria-checked': String(on), 'data-style': id } });
			const top = c.createDiv({ cls: 'ws-cal-stylecard__caption' });
			if (ic) icon(top, ic);
			top.createSpan({ text: caption });
			if (on) icon(top, 'check', 'ws-cal-stylecard__check');
			c.createDiv({ cls: 'ws-cal-stylecard__sample', text: label });
			c.addEventListener('click', () => {
				if (on) return;
				if (id === 'custom') update({ style: 'custom', pattern: cal.pattern?.day.trim() ? cal.pattern : { day: patternFrom(cal), month: '', year: '' } });
				else update({ style: id });
			});
		};
		for (const st of STYLES) choice(st.id, this.sample(cal, st.id), st.caption);
		choice('custom', custom ? formatChrono(this.exampleDate(cal)) : 'Write it your way', 'Your own', 'pen-line');

		if (custom && cal.pattern) this.renderBuilder(b, cal, cal.pattern, update);

		const ex = b.createDiv({ cls: 'ws-cal-examples' });
		ex.createDiv({ cls: 'ws-cal-examples__head', text: 'How it reads' });
		const line = (label: string, text: string) => {
			const r = ex.createDiv({ cls: 'ws-cal-examples__row' });
			r.createSpan({ cls: 'ws-cal-examples__label', text: label });
			r.createSpan({ cls: 'ws-cal-examples__value', text });
		};
		const d = this.exampleDate(cal);
		if (d.precision === 'day') {
			line('A day', formatChrono(d));
			line('A month', formatChrono({ ...d, precision: 'month', day: null }));
			const f = cal.festivals.find((x) => x.days > 1) ?? cal.festivals[0];
			if (f) line('A festival', formatChrono({ calendar: cal.id, year: d.year, era: d.era, festival: f.id, day: f.days > 1 ? 2 : null, precision: f.days > 1 ? 'day' : 'month' }));
		}
		line('A year', formatChrono({ ...d, precision: 'year', month: null, day: null }));
		line('Roughly', formatChrono({ ...d, precision: 'year', month: null, day: null, approx: true }));
		line('Short (tables)', formatChrono(d, { short: true }));
	}

	/** Your own format: the pattern, words to drop in, ideas, and the month/year versions. */
	private renderBuilder(b: HTMLElement, cal: Calendar, pattern: CalendarPattern, update: (p: CalendarPatch) => void): void {
		const box = b.createDiv({ cls: 'ws-cal-builder' });
		// Whatever is in the three boxes right now, typed or saved.
		const boxes: Partial<Record<keyof CalendarPattern, HTMLInputElement>> = {};
		const save = (patch: Partial<CalendarPattern>) =>
			update({ pattern: { ...pattern, day: boxes.day?.value ?? pattern.day, month: boxes.month?.value ?? pattern.month, year: boxes.year?.value ?? pattern.year, ...patch } });
		const lab = box.createDiv({ cls: 'ws-cal-builder__label' });
		lab.createSpan({ text: 'Your format' });
		lab.createSpan({ cls: 'ws-cal-builder__hint', text: 'Type anything; the parts in {braces} are filled in.' });
		const input = box.createEl('input', { cls: 'ws-cal-builder__input', attr: { type: 'text', 'aria-label': 'Your date format', 'data-k': 'pattern-day', spellcheck: 'false', placeholder: 'the {day-th} of {month}, {year} {era}' } });
		input.value = pattern.day;
		boxes.day = input;
		let last = { start: input.value.length, end: input.value.length };
		const remember = () => (last = { start: input.selectionStart ?? input.value.length, end: input.selectionEnd ?? input.value.length });
		input.addEventListener('keyup', remember);
		input.addEventListener('click', remember);
		input.addEventListener('select', remember);
		const live = box.createDiv({ cls: 'ws-cal-builder__live' });
		const d = this.exampleDate(cal);
		const preview = (text: string) => {
			const t = text.trim();
			live.empty();
			icon(live, 'eye');
			live.createSpan({ cls: 'ws-cal-builder__live-text', text: t ? this.preview(cal, t, d) : 'Write a format to see it here' });
		};
		preview(input.value);
		input.addEventListener('input', () => preview(input.value));
		const commit = () => {
			if (input.value !== pattern.day) save({ day: input.value });
		};
		input.addEventListener('blur', commit);
		input.addEventListener('focus', remember);
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				input.blur();
			}
		});

		// Pieces to drop in at the cursor.
		const chips = box.createDiv({ cls: 'ws-cal-tokens', attr: { 'aria-label': 'Add a part' } });
		const sample = this.tokenSamples(cal, d);
		for (const t of DATE_TOKENS) {
			if ((t.id === 'weekday' && !cal.weekdays.length) || ((t.id === 'era' || t.id === 'era-name') && !cal.eras.length)) continue;
			if (!cal.months.length && (t.id.startsWith('day') || t.id.startsWith('month') || t.id === 'weekday')) continue;
			const c = chips.createEl('button', { cls: 'ws-cal-token', attr: { type: 'button', 'data-token': t.id, title: t.hint } });
			c.createSpan({ cls: 'ws-cal-token__name', text: t.label });
			if (sample[t.id]) c.createSpan({ cls: 'ws-cal-token__eg', text: sample[t.id]! });
			// Keep the cursor where it was in the box.
			c.addEventListener('mousedown', (e) => e.preventDefault());
			c.addEventListener('click', () => {
				const v = input.value;
				// The cursor right now if the box has focus, else where it last was.
				if (input.ownerDocument.activeElement === input) last = { start: input.selectionStart ?? v.length, end: input.selectionEnd ?? v.length };
				const before = v.slice(0, last.start);
				const pad = before && !/\s$/.test(before) ? ' ' : '';
				const ins = `${pad}{${t.id}}`;
				input.value = before + ins + v.slice(last.end);
				const at = before.length + ins.length;
				last = { start: at, end: at };
				input.focus();
				input.setSelectionRange(at, at);
				preview(input.value);
				save({ day: input.value });
			});
		}

		// Warnings that matter.
		const toks = new Set(tokensIn(input.value));
		const warn = (text: string) => {
			const w = box.createDiv({ cls: 'ws-cal-builder__warn' });
			icon(w, 'alert-triangle');
			w.createSpan({ text });
		};
		if (!toks.has('year') && !toks.has('year-roman')) warn('There’s no year in it, so dates in different years will read the same.');
		else if (cal.months.length && !['day', 'day-th', 'day-words'].some((x) => toks.has(x as DateToken))) warn('There’s no day in it, so days in the same month will read the same.');
		else if (cal.eras.length > 1 && !toks.has('era') && !toks.has('era-name')) warn('There’s no era in it, so “312” could be in any era.');

		// Ideas, shown in this calendar's words.
		if (cal.months.length) {
			const ideas = box.createDiv({ cls: 'ws-cal-ideas' });
			ideas.createDiv({ cls: 'ws-cal-builder__label', text: 'Ideas to start from' });
			const row = ideas.createDiv({ cls: 'ws-cal-ideas__row' });
			for (const idea of IDEAS) {
				if (idea.includes('{weekday}') && !cal.weekdays.length) continue;
				const btn = row.createEl('button', { cls: cx('ws-cal-idea', idea === pattern.day && 'is-on'), attr: { type: 'button', title: idea } });
				btn.setText(this.preview(cal, idea, d));
				btn.addEventListener('mousedown', (e) => e.preventDefault());
				btn.addEventListener('click', () => save({ day: idea }));
			}
		}

		// The shorter versions: worked out, or written by hand.
		const auto = patternsOf({ day: input.value, month: '', year: '' });
		const fine = box.createEl('details', { cls: 'ws-cal-fine' });
		if (pattern.month.trim() || pattern.year.trim()) fine.open = true;
		const sum = fine.createEl('summary');
		icon(sum, 'sliders-horizontal');
		sum.createSpan({ text: 'Month-only and year-only dates' });
		fine.createDiv({ cls: 'ws-cal-builder__hint', text: 'Worked out from your format. Write your own to change them.' });
		const shorter = (key: 'month' | 'year', label: string, eg: ChronoDate) => {
			const r = fine.createDiv({ cls: 'ws-cal-fine__row' });
			r.createSpan({ cls: 'ws-cal-fine__label', text: label });
			const inp = r.createEl('input', { cls: 'ws-cal-builder__input is-small', attr: { type: 'text', 'aria-label': label, 'data-k': `pattern-${key}`, spellcheck: 'false', placeholder: auto[key] } });
			inp.value = pattern[key];
			boxes[key] = inp;
			const out = r.createSpan({ cls: 'ws-cal-fine__eg' });
			const show = () => out.setText(this.preview(cal, input.value, eg, { [key]: inp.value })); 
			show();
			inp.addEventListener('input', show);
			inp.addEventListener('blur', () => inp.value !== pattern[key] && save({ [key]: inp.value }));
			inp.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), inp.blur()));
		};
		if (cal.months.length) shorter('month', 'A month', { ...d, precision: 'month', day: null });
		shorter('year', 'A year', { ...d, precision: 'year', month: null, day: null });
	}

	private sample(cal: Calendar, style: CalendarDateStyle): string {
		if (!cal.months.length) return STYLES.find((x) => x.id === style)?.label ?? '';
		const mo = Math.min(3, cal.months.length);
		const d = Math.min(14, cal.months[mo - 1]!.days);
		const m = cal.months[mo - 1]!.name;
		switch (style) {
			case 'month-day-year':
				return `${m} ${d}, 312`;
			case 'year-month-day':
				return `312, ${m} ${d}`;
			case 'numeric':
				return `${d}/${mo}/312`;
			default:
				return `${d} ${m} 312`;
		}
	}

	/** A date written with a pattern that isn't saved yet. */
	private preview(cal: Calendar, day: string, d: ChronoDate, more: Partial<CalendarPattern> = {}): string {
		const draft: Calendar = { ...cal, id: `${cal.id}\u0000preview`, style: 'custom', pattern: { day, month: more.month ?? cal.pattern?.month ?? '', year: more.year ?? cal.pattern?.year ?? '' } };
		return formatChronoIn(draft, { ...d, calendar: draft.id }) || '—';
	}

	/** What each part looks like on the example day (shown on the chips). */
	private tokenSamples(cal: Calendar, d: ChronoDate): Partial<Record<DateToken, string>> {
		const out: Partial<Record<DateToken, string>> = {};
		for (const t of DATE_TOKENS) out[t.id] = this.preview(cal, `{${t.id}}`, d);
		for (const k of Object.keys(out) as DateToken[]) if (out[k] === '—') delete out[k];
		return out;
	}

	private renderOffset(b: HTMLElement, cal: Calendar, update: (p: CalendarPatch) => void): void {
		const main = this.s.calendars.main();
		const r = b.createDiv({ cls: 'ws-cal-line' });
		r.createSpan({ cls: 'ws-cal-line__label', text: `Year 0 here is year` });
		this.num(r, cal.offset, { k: 'offset', label: 'Offset in years', onCommit: (n) => update({ offset: n }) });
		r.createSpan({ cls: 'ws-cal-line__label', text: `of ${main?.name ?? 'the main calendar'}.` });
	}

	/** A day to show off the calendar with: the 14th of the third month, 312 of the latest era. */
	private exampleDate(cal: Calendar): ChronoDate {
		const era = [...cal.eras].filter((e) => e.direction === 'up').sort((a, z) => z.start - a.start)[0];
		const year = era ? eraYearToAbs(era, 312) : 312;
		if (!cal.months.length) return { calendar: cal.id, year, precision: 'year', ...(era ? { era: era.id } : {}) };
		const mi = Math.min(3, cal.months.length);
		return { calendar: cal.id, year, month: mi, day: Math.min(14, cal.months[mi - 1]!.days), precision: 'day', ...(era ? { era: era.id } : {}) };
	}

	/** The calendar at a glance: a date in its words, and what it's made of. */
	private renderShowcase(el: HTMLElement, cal: Calendar): void {
		const band = el.createDiv({ cls: 'ws-cal-showcase' });
		const words = band.createDiv({ cls: 'ws-cal-showcase__words' });
		words.createDiv({ cls: 'ws-cal-showcase__label', text: 'In your world’s words' });
		const d = this.exampleDate(cal);
		words.createDiv({ cls: 'ws-cal-showcase__date', text: formatChrono(d) });
		if (d.precision === 'day') {
			const sub = words.createDiv({ cls: 'ws-cal-showcase__sub' });
			sub.createSpan({ text: formatChrono({ ...d, precision: 'month', day: null }) });
			sub.createSpan({ cls: 'ws-cal-showcase__dot', text: '·' });
			sub.createSpan({ text: formatChrono({ ...d, precision: 'year', month: null, day: null }) });
		}
		const stats = band.createDiv({ cls: 'ws-cal-showcase__stats' });
		const stat = (n: number | string, label: string, ic: string) => {
			const st = stats.createDiv({ cls: 'ws-cal-stat' });
			icon(st, ic);
			st.createDiv({ cls: 'ws-cal-stat__n', text: String(n) });
			st.createDiv({ cls: 'ws-cal-stat__label', text: label });
		};
		const y = this.glanceYear ?? 0;
		stat(cal.months.length, cal.months.length === 1 ? 'month' : 'months', 'calendar');
		stat(cal.months.length ? yearLength(cal, y) : '—', 'days a year', 'sun');
		stat(cal.weekdays.length || '—', 'days a week', 'repeat');
		stat(cal.festivals.length, cal.festivals.length === 1 ? 'special day' : 'special days', 'sparkles');
		stat(cal.eras.length, cal.eras.length === 1 ? 'era' : 'eras', 'milestone');
		stat(this.s.calendars.usage(cal.id), 'dates written', 'feather');
	}

	private renderGlance(b: HTMLElement, aside: HTMLElement, cal: Calendar): void {
		if (!cal.months.length) {
			b.createDiv({ cls: 'ws-rcard__empty', text: 'This calendar counts years only. Add months to see a year laid out.' });
			return;
		}
		const era = [...cal.eras].filter((e) => e.direction === 'up').sort((a, z) => z.start - a.start)[0];
		const home = era ? era.start : 0;
		if (this.glanceYear == null) this.glanceYear = home;
		const y = this.glanceYear;
		const bar = aside.createDiv({ cls: 'ws-cal-glance__bar' });
		if (y !== home) button(bar, { label: 'Back', icon: 'undo-2', variant: 'quiet', size: 'sm', tooltip: `Back to ${formatChrono({ calendar: cal.id, year: home, precision: 'year' })}`, onClick: () => ((this.glanceYear = home), this.render(false)) });
		button(bar, { icon: 'chevron-left', variant: 'quiet', size: 'sm', tooltip: 'Previous year', onClick: () => this.shiftGlance(-1) });
		bar.createSpan({ cls: 'ws-cal-glance__year', text: formatChrono({ calendar: cal.id, year: y, precision: 'year' }) });
		button(bar, { icon: 'chevron-right', variant: 'quiet', size: 'sm', tooltip: 'Next year', onClick: () => this.shiftGlance(1) });
		bar.createSpan({ cls: 'ws-cal-glance__len', text: `${yearLength(cal, y)} days` });
		const wrap = b.createDiv({ cls: 'ws-cal-glance' });
		const wd = cal.weekdays.length >= 2 && cal.weekdays.length <= 10 ? cal.weekdays : [];
		const cols = wd.length || 7;
		for (const seg of yearSegments(cal, y)) {
			const fest = seg.kind === 'festival';
			const tile = wrap.createDiv({ cls: cx('ws-cal-glance__tile', fest && 'is-festival') });
			const h = tile.createDiv({ cls: 'ws-cal-glance__name' });
			const badge = h.createSpan({ cls: 'ws-cal-glance__badge' });
			if (fest) setIcon(badge, 'sparkles');
			else badge.setText(String(seg.index));
			h.createSpan({ cls: 'ws-cal-glance__title', text: seg.name });
			h.createSpan({ cls: 'ws-cal-glance__days', text: plural(seg.days, 'day') });
			const n = fest ? Math.min(cols, seg.days) : cols;
			if (wd.length && !fest) {
				const heads = tile.createDiv({ cls: 'ws-cal-glance__wd', attr: { 'aria-hidden': 'true' } });
				heads.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
				for (const w of wd) heads.createSpan({ text: w.slice(0, 1), attr: { title: w } });
			}
			const g = tile.createDiv({ cls: 'ws-cal-glance__grid' });
			g.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
			const first = seg.kind === 'month' ? { calendar: cal.id, year: y, month: seg.index, day: 1, precision: 'day' as const } : { calendar: cal.id, year: y, festival: seg.id, day: 1, precision: 'day' as const };
			let lead = 0;
			if (wd.length && seg.kind === 'month') {
				const w = weekdayOf(first, cal);
				lead = w ? Math.max(0, wd.indexOf(w)) : 0;
			}
			for (let i = 0; i < lead; i++) g.createSpan({ cls: 'ws-cal-glance__cell is-blank' });
			for (let d = 1; d <= seg.days; d++) g.createSpan({ cls: 'ws-cal-glance__cell', text: String(d) });
		}
	}

	private shiftGlance(dir: number): void {
		this.glanceYear = (this.glanceYear ?? 0) + dir;
		this.render(false);
	}
}
