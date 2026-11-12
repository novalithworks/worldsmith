import { setIcon } from 'obsidian';
import { cx, icon, revealInList } from './dom';
import { Popover } from './popover';

export interface PickItem {
	id: string;
	label: string;
	icon?: string;
	/** Section heading the item sits under. */
	group?: string;
	/** Short text on the right ("Choice", "3 options"). */
	hint?: string;
}

export interface PickerOptions {
	title: string;
	items: PickItem[];
	/** The current choice (shown with a check). */
	selected?: string | null;
	/** An extra first row ("No groups"), picked as null. */
	none?: { label: string; icon?: string };
	/** Search box from this many items (default 9). */
	searchFrom?: number;
	placeholder?: string;
	onPick(id: string | null): void;
	/** Small links under the list ("Open every group"). */
	footer?: Array<{ label: string; icon?: string; run(): void }>;
}

/**
 * A compact, searchable list of properties in a popover — the replacement for long native
 * menus (Group by, Add a filter, Add a sort, board columns). Sections keep related choices
 * together; the list scrolls inside a fixed height; ↑/↓ and Enter work from the search box.
 */
const OPEN = new WeakMap<HTMLElement, Popover>();

export function openPropertyPicker(anchor: HTMLElement, o: PickerOptions): Popover {
	// Clicking the button that opened a picker again closes it.
	const existing = OPEN.get(anchor);
	if (existing?.el.isConnected) {
		existing.close();
		return existing;
	}
	const pop = new Popover(anchor, { cls: 'ws-picklist', width: 280, label: o.title });
	OPEN.set(anchor, pop);
	const head = pop.el.createDiv({ cls: 'ws-picklist__head' });
	head.createSpan({ cls: 'ws-picklist__title', text: o.title });
	const searchable = o.items.length >= (o.searchFrom ?? 9);
	let input: HTMLInputElement | null = null;
	if (searchable) {
		const wrap = pop.el.createDiv({ cls: 'ws-picklist__search' });
		icon(wrap, 'search');
		input = wrap.createEl('input', { cls: 'ws-picklist__input', attr: { type: 'search', placeholder: o.placeholder ?? 'Search…', 'aria-label': `Search ${o.title.toLowerCase()}`, spellcheck: 'false' } });
	}
	const list = pop.el.createDiv({ cls: 'ws-picklist__list', attr: { role: 'listbox' } });
	let rows: Array<{ el: HTMLElement; id: string | null }> = [];
	let active = -1;

	const pick = (id: string | null) => {
		pop.close();
		o.onPick(id);
	};
	const setActive = (i: number) => {
		rows[active]?.el.removeClass('is-active');
		active = rows.length ? (i + rows.length) % rows.length : -1;
		const r = rows[active];
		if (!r) return;
		r.el.addClass('is-active');
		revealInList(list, r.el);
	};
	const row = (parent: HTMLElement, id: string | null, label: string, ic?: string, hint?: string) => {
		const on = (o.selected ?? null) === id;
		const el = parent.createEl('button', { cls: cx('ws-picklist__item', on && 'is-selected'), attr: { type: 'button', role: 'option', 'aria-selected': String(on), tabindex: '-1' } });
		const ib = el.createSpan({ cls: 'ws-picklist__icon' });
		if (ic) setIcon(ib, ic);
		el.createSpan({ cls: 'ws-picklist__label', text: label });
		if (hint) el.createSpan({ cls: 'ws-picklist__hint', text: hint });
		const check = el.createSpan({ cls: 'ws-picklist__check' });
		if (on) setIcon(check, 'check');
		el.addEventListener('click', () => pick(id));
		el.addEventListener('pointermove', () => {
			const i = rows.findIndex((r) => r.el === el);
			if (i !== active) setActive(i);
		});
		rows.push({ el, id });
	};
	const paint = () => {
		list.empty();
		rows = [];
		active = -1;
		const q = (input?.value ?? '').trim().toLowerCase();
		if (o.none && !q) row(list, null, o.none.label, o.none.icon ?? 'x');
		const shown = o.items.filter((x) => !q || x.label.toLowerCase().includes(q));
		let group: string | undefined;
		let section: HTMLElement = list;
		for (const it of shown) {
			if (it.group !== group) {
				group = it.group;
				section = list.createDiv({ cls: 'ws-picklist__section' });
				if (group) section.createDiv({ cls: 'ws-picklist__group', text: group });
			}
			row(section, it.id, it.label, it.icon, it.hint);
		}
		if (!rows.length) list.createDiv({ cls: 'ws-picklist__empty', text: `Nothing matches “${input?.value ?? ''}”` });
		const sel = rows.findIndex((r) => r.id === (o.selected ?? null));
		setActive(q ? 0 : Math.max(0, sel));
		pop.position();
	};
	input?.addEventListener('input', paint);
	pop.el.addEventListener('keydown', (e) => {
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			setActive(active + (e.key === 'ArrowDown' ? 1 : -1));
		} else if (e.key === 'Enter') {
			const r = rows[active];
			if (r) {
				e.preventDefault();
				pick(r.id);
			}
		}
	});
	if (o.footer?.length) {
		const foot = pop.el.createDiv({ cls: 'ws-picklist__foot' });
		for (const f of o.footer) {
			const b = foot.createEl('button', { cls: 'ws-picklist__link', attr: { type: 'button' } });
			if (f.icon) icon(b, f.icon);
			b.createSpan({ text: f.label });
			b.addEventListener('click', () => {
				pop.close();
				f.run();
			});
		}
	}
	paint();
	window.setTimeout(() => (input ?? rows[active]?.el ?? pop.el).focus({ preventScroll: true }), 0);
	return pop;
}
