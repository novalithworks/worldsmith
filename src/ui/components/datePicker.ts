import { setIcon } from 'obsidian';
import { addDays, addMonths, fromISO, monthLabel, startOfMonth, startOfWeek, today, weekdayShort, type ISODate } from '../../core/util/dates';
import { cx, nameRegion } from './dom';
import { Popover } from './popover';

export interface DatePickerOptions {
	value: ISODate | null;
	onPick(date: ISODate | null): void;
	/** Days with something on them get a dot (e.g. other tasks). */
	marked?(date: ISODate): boolean;
	weekStart?: number;
	/** Show "No date" (clear). Default true. */
	clearable?: boolean;
}

/**
 * A real-world month calendar with quick picks. Keyboard: arrows move, Enter picks,
 * PageUp/PageDown change month.
 */
export function renderDatePicker(parent: HTMLElement, o: DatePickerOptions): { setValue(v: ISODate | null): void } {
	const ws = o.weekStart ?? 1;
	let value = o.value;
	let month = startOfMonth(value ?? today());
	let focus = value ?? today();
	const root = parent.createDiv({ cls: 'ws-dp' });

	const paint = () => {
		root.empty();
		const head = root.createDiv({ cls: 'ws-dp__head' });
		head.createSpan({ cls: 'ws-dp__month', text: monthLabel(month) });
		const nav = (dir: number, label: string, iconName: string) => {
			const b = head.createEl('button', { cls: 'ws-dp__nav', attr: { type: 'button', 'aria-label': label } });
			setIcon(b, iconName);
			b.addEventListener('click', () => {
				month = addMonths(month, dir);
				paint();
			});
		};
		nav(-1, 'Previous month', 'chevron-left');
		nav(1, 'Next month', 'chevron-right');

		const grid = root.createDiv({ cls: 'ws-dp__grid', attr: { role: 'grid'} });
		nameRegion(grid, monthLabel(month) );
		for (let i = 0; i < 7; i++) grid.createDiv({ cls: 'ws-dp__dow', text: weekdayShort(ws + i).slice(0, 2) });
		const first = startOfWeek(month, ws);
		const now = today();
		for (let i = 0; i < 42; i++) {
			const d = addDays(first, i);
			if (i >= 35 && d.slice(0, 7) !== month.slice(0, 7)) break;
			const b = grid.createEl('button', {
				cls: cx('ws-dp__day', d.slice(0, 7) !== month.slice(0, 7) && 'is-out', d === now && 'is-today', d === value && 'is-selected', !!o.marked?.(d) && 'has-mark'),
				text: String(fromISO(d).getDate()),
				attr: { type: 'button', 'data-date': d, tabindex: d === focus ? '0' : '-1', 'aria-pressed': String(d === value) },
			});
			b.addEventListener('click', () => pick(d));
		}
		const quick = root.createDiv({ cls: 'ws-dp__quick' });
		const q = (label: string, d: ISODate | null) => {
			const b = quick.createEl('button', { cls: 'ws-dp__q', text: label, attr: { type: 'button' } });
			b.addEventListener('click', () => pick(d));
		};
		q('Today', now);
		q('Tomorrow', addDays(now, 1));
		q('Next week', addDays(startOfWeek(now, ws), 7));
		if (o.clearable !== false) q('No date', null);
	};

	const pick = (d: ISODate | null) => {
		value = d;
		if (d) {
			focus = d;
			month = startOfMonth(d);
		}
		paint();
		o.onPick(d);
	};

	root.addEventListener('keydown', (e) => {
		const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
		if (e.key in moves) {
			e.preventDefault();
			focus = addDays(focus, moves[e.key] as number);
		} else if (e.key === 'PageUp' || e.key === 'PageDown') {
			e.preventDefault();
			focus = addMonths(focus, e.key === 'PageUp' ? -1 : 1);
		} else return;
		month = startOfMonth(focus);
		paint();
		(root.querySelector(`[data-date="${focus}"]`))?.focus();
	});

	paint();
	return {
		setValue(v) {
			value = v;
			if (v) month = startOfMonth(v);
			paint();
		},
	};
}

/** Open a date picker in a popover under `anchor`. */
export function openDatePopover(anchor: HTMLElement, o: DatePickerOptions): Popover {
	const pop = new Popover(anchor, { cls: 'ws-dp-pop', width: 264, label: 'Pick a date' });
	renderDatePicker(pop.el, {
		...o,
		onPick: (d) => {
			o.onPick(d);
			pop.close();
		},
	});
	pop.position();
	window.setTimeout(() => (pop.el.querySelector('.ws-dp__day.is-selected, .ws-dp__day.is-today'))?.focus({ preventScroll: true }), 0);
	return pop;
}
