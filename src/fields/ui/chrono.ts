import { Notice, setIcon } from 'obsidian';
import {
	absoluteYear,
	activeCalendars,
	calendarFor,
	eraLabel,
	eraOf,
	isPlain,
	makeDate,
	weekdayOf,
	yearParts,
	yearSegments,
	type YearSegment,
} from '../../core/calendar/engine';
import type { Calendar, CalendarEra } from '../../core/types/calendar';
import { debounce } from '../../core/util/async';
import { formatChronoDate, isChronoDate, type ChronoDate } from '../../core/types/chrono';
import { cx, nameRegion } from '../../ui/components/dom';
import { Popover } from '../../ui/components/popover';
import type { FieldEditorContext, FieldEditorHandle, FieldTypeUI } from '../FieldType';
import { textDisplay } from './shared';

/**
 * Fictional date editor. With plain years (no calendar set up) it is [c.] [year] [era].
 * With a calendar it picks day, month or festival, year and era from that calendar, and a
 * small month grid helps choose the day.
 */
export const chronoUI: FieldTypeUI = {
	renderDisplay(el, v) {
		textDisplay(el, isChronoDate(v) ? formatChronoDate(v) : '');
	},
	createEditor(el, ctx) {
		const value: ChronoDate | null = isChronoDate(ctx.value) ? ctx.value : null;
		const cal = calendarFor(value?.calendar);
		if (isPlain(cal) && !value?.calendar && activeCalendars().every((c) => isPlain(c))) return plainEditor(el, ctx);
		return calendarEditor(el, ctx);
	},
};

function approxButton(row: HTMLElement): HTMLButtonElement {
	return row.createEl('button', {
		cls: 'ws-chrono__approx',
		text: 'c.',
		attr: { type: 'button', 'aria-label': 'Approximate date', 'aria-pressed': 'false' },
	});
}

function plainEditor(el: HTMLElement, ctx: FieldEditorContext): FieldEditorHandle {
	let value: ChronoDate | null = isChronoDate(ctx.value) ? ctx.value : null;
	const row = el.createDiv({ cls: 'ws-chrono' });
	const approx = approxButton(row);
	const year = row.createEl('input', {
		cls: 'ws-field-input ws-field-input--num ws-chrono__year',
		attr: { type: 'text', inputmode: 'numeric', 'aria-label': `${ctx.field.label} year`, placeholder: 'Year' },
	});
	const era = row.createEl('input', {
		cls: 'ws-field-input ws-chrono__era',
		attr: { type: 'text', 'aria-label': `${ctx.field.label} era`, placeholder: 'Era', spellcheck: 'false' },
	});

	const paint = () => {
		year.value = value ? String(value.year) : '';
		era.value = value?.era ?? '';
		approx.toggleClass('is-on', !!value?.approx);
		approx.setAttr('aria-pressed', String(!!value?.approx));
	};
	const read = (): ChronoDate | null => {
		const y = year.value.trim();
		if (y === '' || !/^-?\d+$/.test(y)) return y === '' ? null : value;
		const next: ChronoDate = { ...(value ?? { precision: 'year' as const }), year: Number(y) };
		const e = era.value.trim();
		if (e) next.era = e;
		else delete next.era;
		return next;
	};
	const send = debounce(() => {
		value = read();
		ctx.onChange(value);
	}, 400);
	for (const input of [year, era]) {
		input.addEventListener('input', () => send());
		input.addEventListener('blur', () => send.flush());
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				send.flush();
				input.blur();
			}
		});
	}
	approx.addEventListener('click', () => {
		if (!value) return;
		value = { ...value, approx: !value.approx };
		paint();
		ctx.onChange(value);
	});
	ctx.component.register(() => send.flush());
	paint();
	return {
		setValue(v) {
			if (document.activeElement === year || document.activeElement === era) return;
			value = isChronoDate(v) ? v : null;
			paint();
		},
		focus: () => year.focus(),
	};
}

const DATE_KEYS = ['calendar', 'era', 'year', 'month', 'day', 'festival', 'precision', 'approx'] as const;

/** The era new dates count in: the latest era counting up, else the first. */
function defaultEra(cal: Calendar): CalendarEra | null {
	const ups = cal.eras.filter((e) => e.direction === 'up').sort((a, b) => b.start - a.start);
	return ups[0] ?? cal.eras[0] ?? null;
}

function calendarEditor(el: HTMLElement, ctx: FieldEditorContext): FieldEditorHandle {
	let value: ChronoDate | null = isChronoDate(ctx.value) ? ctx.value : null;
	let cal = calendarFor(value?.calendar);
	const row = el.createDiv({ cls: 'ws-chrono ws-chrono--cal' });
	const approx = approxButton(row);
	const day = row.createEl('input', {
		cls: 'ws-field-input ws-field-input--num ws-chrono__day',
		attr: { type: 'text', inputmode: 'numeric', 'aria-label': `${ctx.field.label} day`, placeholder: 'Day' },
	});
	const month = row.createEl('select', { cls: 'dropdown ws-chrono__sel ws-chrono__month', attr: { 'aria-label': `${ctx.field.label} month` } });
	const year = row.createEl('input', {
		cls: 'ws-field-input ws-field-input--num ws-chrono__year',
		attr: { type: 'text', inputmode: 'numeric', 'aria-label': `${ctx.field.label} year`, placeholder: 'Year' },
	});
	const era = row.createEl('select', { cls: 'dropdown ws-chrono__sel ws-chrono__erasel', attr: { 'aria-label': `${ctx.field.label} era` } });
	const calSel = row.createEl('select', { cls: 'dropdown ws-chrono__sel ws-chrono__cal', attr: { 'aria-label': `${ctx.field.label} calendar` } });
	const pickBtn = row.createEl('button', { cls: 'ws-chrono__pick clickable-icon', attr: { type: 'button', 'aria-label': 'Pick a day', 'aria-haspopup': 'dialog' } });
	setIcon(pickBtn, 'calendar-days');
	let pop: Popover | null = null;

	/** Era text that isn't one of the calendar's eras (kept from older dates). */
	let extraEra: string | null = null;

	const options = () => {
		month.empty();
		month.createEl('option', { value: '', text: 'Month' });
		cal.months.forEach((m, i) => month.createEl('option', { value: `m:${i + 1}`, text: m.name }));
		if (cal.festivals.length) {
			const og = month.createEl('optgroup', { attr: { label: 'Outside the months' } });
			for (const f of cal.festivals) og.createEl('option', { value: `f:${f.id}`, text: f.name });
		}
		era.empty();
		for (const e of cal.eras) era.createEl('option', { value: e.id, text: eraLabel(e), attr: { title: e.name } });
		if (extraEra) era.createEl('option', { value: `x:${extraEra}`, text: extraEra });
		// "No era": plain years (and dates before the first era) keep their number as typed.
		era.createEl('option', { value: '', text: 'No era' });
		calSel.empty();
		const all = activeCalendars();
		for (const c of all) calSel.createEl('option', { value: c.id, text: c.name });
		const hasMonths = cal.months.length > 0;
		day.toggleClass('is-hidden', !hasMonths);
		month.toggleClass('is-hidden', !hasMonths && !cal.festivals.length);
		pickBtn.toggleClass('is-hidden', !hasMonths);
		era.toggleClass('is-hidden', !cal.eras.length && !extraEra);
		calSel.toggleClass('is-hidden', all.length < 2);
	};

	const paint = () => {
		const parts = value ? yearParts(value, cal) : null;
		extraEra = parts?.extraEra ?? null;
		options();
		year.value = parts ? String(parts.year) : '';
		const e = parts?.era ?? (value ? null : defaultEra(cal));
		era.value = extraEra ? `x:${extraEra}` : value ? (e?.id ?? '') : (defaultEra(cal)?.id ?? '');
		const precise = value && (value.precision === 'month' || value.precision === 'day');
		month.value = precise ? (value!.festival ? `f:${value!.festival}` : value!.month != null ? `m:${value!.month}` : '') : '';
		if (month.selectedIndex < 0) month.value = '';
		day.value = value && value.precision === 'day' && value.day != null ? String(value.day) : '';
		calSel.value = cal.id;
		approx.toggleClass('is-on', !!value?.approx);
		approx.setAttr('aria-pressed', String(!!value?.approx));
		const wd = value ? weekdayOf(value, cal) : null;
		row.setAttr('title', value ? formatChronoDate(value) + (wd && !cal.showWeekday ? ` (${wd})` : '') : '');
	};

	const segmentFor = (m: string, absYear: number): YearSegment | undefined =>
		yearSegments(cal, absYear).find((s) => (m.startsWith('f:') ? s.kind === 'festival' && s.id === m.slice(2) : s.kind === 'month' && `m:${s.index}` === m));

	const read = (): ChronoDate | null => {
		const y = year.value.trim();
		if (y === '') return null;
		if (!/^-?\d+$/.test(y)) return value;
		const n = Number(y);
		const ev = era.value;
		const eraObj = ev && !ev.startsWith('x:') ? (cal.eras.find((e) => e.id === ev) ?? null) : null;
		const m = month.value;
		const made = makeDate(cal, {
			year: n,
			era: eraObj,
			month: m.startsWith('m:') ? Number(m.slice(2)) : null,
			festival: m.startsWith('f:') ? m.slice(2) : null,
			approx: !!value?.approx,
		});
		if (m.startsWith('f:') && !segmentFor(m, made.year)) {
			const f = cal.festivals.find((x) => x.id === m.slice(2));
			new Notice(`${f?.name ?? 'That day'} doesn’t happen in that year.`);
			return value;
		}
		const dv = day.value.trim();
		const oneDay = m.startsWith('f:') && segmentFor(m, made.year)?.days === 1;
		if (m && !oneDay && /^\d+$/.test(dv)) {
			const seg = segmentFor(m, made.year);
			const max = seg?.days ?? 400;
			made.day = Math.min(Math.max(1, Number(dv)), max);
			made.precision = 'day';
		}
		if (ev.startsWith('x:')) made.era = ev.slice(2);
		const base: Record<string, unknown> = { ...(value ?? {}) };
		for (const k of DATE_KEYS) delete base[k];
		return { ...base, ...made };
	};

	const commit = () => {
		value = read();
		ctx.onChange(value);
	};
	const send = debounce(commit, 400);
	for (const input of [year, day]) {
		input.addEventListener('input', () => send());
		input.addEventListener('blur', () => send.flush());
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				send.flush();
				input.blur();
			}
		});
	}
	for (const sel of [month, era]) {
		sel.addEventListener('change', () => {
			send.cancel?.();
			if (sel === month && !month.value) day.value = '';
			commit();
			paint();
		});
	}
	calSel.addEventListener('change', () => {
		const next = activeCalendars().find((c) => c.id === calSel.value);
		if (!next) return;
		send.flush();
		cal = next;
		if (value) {
			// Keep the year as typed; month and day only when the new calendar has them.
			const keepMonth = value.month != null && value.month <= next.months.length && !value.festival;
			const made = makeDate(next, {
				year: value.year,
				month: keepMonth ? value.month : null,
				day: keepMonth && value.precision === 'day' ? value.day : null,
				approx: !!value.approx,
			});
			const e = eraOf(next, made.year);
			if (e) made.era = e.id;
			const base: Record<string, unknown> = { ...value };
			for (const k of DATE_KEYS) delete base[k];
			value = { ...base, ...made };
			ctx.onChange(value);
		}
		paint();
	});
	approx.addEventListener('click', () => {
		if (!value) return;
		value = { ...value, approx: !value.approx };
		paint();
		ctx.onChange(value);
	});
	pickBtn.addEventListener('click', () => {
		if (pop) {
			pop.close();
			return;
		}
		send.flush();
		pop = new Popover(pickBtn, { cls: 'ws-chrono-pop', width: 280, label: 'Pick a day', onClose: () => (pop = null) });
		renderMonthGrid(pop.el, cal, value, (picked) => {
			const base: Record<string, unknown> = { ...(value ?? {}) };
			for (const k of DATE_KEYS) delete base[k];
			value = { ...base, ...picked, approx: value?.approx || undefined };
			if (!value.approx) delete value.approx;
			pop?.close();
			paint();
			ctx.onChange(value);
		});
	});
	ctx.component.register(() => {
		send.flush();
		pop?.close();
	});
	paint();
	return {
		setValue(v) {
			if ([year, day, month, era, calSel].includes(document.activeElement as never)) return;
			value = isChronoDate(v) ? v : null;
			cal = calendarFor(value?.calendar);
			paint();
		},
		focus: () => year.focus(),
	};
}

/** One month (or festival) of a fictional calendar as a grid of days. */
export function renderMonthGrid(root: HTMLElement, cal: Calendar, value: ChronoDate | null, onPick: (d: ChronoDate) => void): void {
	let absYear = value ? absoluteYear(value, cal) : (defaultEra(cal)?.start ?? 0);
	const pickedYear = value ? absYear : null;
	let segs = yearSegments(cal, absYear);
	let at = Math.max(
		0,
		segs.findIndex((s) => (value?.festival ? s.kind === 'festival' && s.id === value.festival : s.kind === 'month' && s.index === (value?.month ?? 1))),
	);
	const wrap = root.createDiv({ cls: 'ws-dp ws-chrono-grid' });

	const yearLabel = (abs: number) => {
		const e = eraOf(cal, abs);
		if (!e) return String(abs);
		const y = e.direction === 'up' ? abs - e.start + e.firstYear : e.start - abs + e.firstYear;
		return `${y} ${eraLabel(e)}`;
	};

	const paint = () => {
		wrap.empty();
		const seg = segs[at];
		const head = wrap.createDiv({ cls: 'ws-dp__head' });
		const title = head.createSpan({ cls: 'ws-dp__month' });
		title.createSpan({ text: seg ? seg.name : '—' });
		title.createSpan({ cls: 'ws-chrono-grid__year', text: ` ${yearLabel(absYear)}` });
		const nav = (dir: number, label: string, iconName: string) => {
			const b = head.createEl('button', { cls: 'ws-dp__nav', attr: { type: 'button', 'aria-label': label } });
			setIcon(b, iconName);
			b.addEventListener('click', () => {
				at += dir;
				if (at < 0) {
					absYear--;
					segs = yearSegments(cal, absYear);
					at = segs.length - 1;
				} else if (at >= segs.length) {
					absYear++;
					segs = yearSegments(cal, absYear);
					at = 0;
				}
				paint();
			});
		};
		nav(-1, 'Previous month', 'chevron-left');
		nav(1, 'Next month', 'chevron-right');
		if (!seg) return;
		const wd = cal.weekdays.length >= 2 && cal.weekdays.length <= 10 ? cal.weekdays : [];
		const cols = wd.length || 7;
		const grid = wrap.createDiv({ cls: 'ws-dp__grid', attr: { role: 'grid' } });
		nameRegion(grid, `${seg.name} ${yearLabel(absYear)}`);
		grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
		const dateOf = (n: number): ChronoDate =>
			seg.kind === 'festival'
				? { calendar: cal.id, year: absYear, festival: seg.id, day: n, precision: 'day' }
				: { calendar: cal.id, year: absYear, month: seg.index, day: n, precision: 'day' };
		let lead = 0;
		if (wd.length) {
			for (const w of wd) grid.createDiv({ cls: 'ws-dp__dow', text: w.slice(0, 2), attr: { title: w } });
			const first = weekdayOf(dateOf(1), cal);
			lead = Math.max(0, first ? wd.indexOf(first) : 0);
			for (let i = 0; i < lead; i++) grid.createDiv({ cls: 'ws-chrono-grid__blank' });
		}
		const e = eraOf(cal, absYear);
		for (let n = 1; n <= seg.days; n++) {
			const sel =
				!!value &&
				value.precision === 'day' &&
				value.day === n &&
				(seg.kind === 'festival' ? value.festival === seg.id : !value.festival && value.month === seg.index) &&
				pickedYear === absYear;
			const b = grid.createEl('button', { cls: cx('ws-dp__day', sel && 'is-selected', seg.kind === 'festival' && 'is-festival'), text: String(n), attr: { type: 'button', 'aria-pressed': String(sel) } });
			b.addEventListener('click', () => {
				const d = dateOf(n);
				if (e) d.era = e.id;
				onPick(d);
			});
		}
		if (seg.kind === 'festival') wrap.createDiv({ cls: 'ws-chrono-grid__note', text: 'Days outside the months' });
	};
	paint();
}
