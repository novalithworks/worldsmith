import { cx } from '../../ui/components/dom';
import { setIcon } from 'obsidian';
import type { FieldDefinition } from '../../core/types';
import type { FieldTypeUI } from '../FieldType';
import { textDisplay, textEditor } from './shared';

const parseNum = (t: string): unknown => {
	const s = t.trim();
	if (s === '') return null;
	const n = Number(s.replace(/[%,\s]/g, ''));
	return Number.isFinite(n) ? n : s; // keep raw text so the service can report it
};
const fmtNum = (v: unknown) => (typeof v === 'number' ? String(v) : v == null ? '' : String(v));
const unitOf = (f: FieldDefinition) => (typeof f.config?.unit === 'string' ? f.config.unit : '');

export const numberUI: FieldTypeUI = {
	renderDisplay(el, v, ctx) {
		textDisplay(el, typeof v === 'number' ? `${v.toLocaleString()}${unitOf(ctx.field) ? ' ' + unitOf(ctx.field) : ''}` : '');
	},
	createEditor(el, ctx) {
		const row = el.createDiv({ cls: 'ws-field-row' });
		const ed = textEditor(row, ctx, { inputMode: 'decimal', parse: parseNum, format: fmtNum, cls: 'ws-field-input--num' });
		const unit = unitOf(ctx.field);
		if (unit) row.createSpan({ cls: 'ws-field-unit', text: unit });
		return ed;
	},
};

function bar(parent: HTMLElement, pct: number): HTMLElement {
	const b = parent.createDiv({ cls: 'ws-bar' });
	const fill = b.createDiv({ cls: 'ws-bar__fill' });
	fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
	return fill;
}

export const percentUI: FieldTypeUI = {
	renderDisplay(el, v) {
		if (typeof v !== 'number') return textDisplay(el, '');
		const row = el.createDiv({ cls: 'ws-field-row' });
		bar(row, v);
		row.createSpan({ cls: 'ws-field-unit', text: `${Math.round(v)}%` });
	},
	createEditor(el, ctx) {
		const row = el.createDiv({ cls: 'ws-field-row ws-field-row--percent' });
		const fill = bar(row, typeof ctx.value === 'number' ? ctx.value : 0);
		const ed = textEditor(row, { ...ctx, onChange: (v) => { if (typeof v === 'number') fill.style.width = `${Math.max(0, Math.min(100, v))}%`; ctx.onChange(v); } }, {
			inputMode: 'numeric',
			parse: parseNum,
			format: fmtNum,
			cls: 'ws-field-input--num ws-field-input--short',
		});
		row.createSpan({ cls: 'ws-field-unit', text: '%' });
		return {
			setValue(v) {
				ed.setValue(v);
				fill.style.width = `${typeof v === 'number' ? Math.max(0, Math.min(100, v)) : 0}%`;
			},
			focus: () => ed.focus(),
		};
	},
};

export const progressUI = percentUI;

/** Star rating with full keyboard support (arrows, number keys, 0 to clear). */
export const ratingUI: FieldTypeUI = {
	renderDisplay(el, v, ctx) {
		const max = typeof ctx.field.config?.max === 'number' ? ctx.field.config.max : 5;
		const n = typeof v === 'number' ? v : 0;
		const row = el.createDiv({ cls: 'ws-rating is-readonly' });
		for (let i = 1; i <= max; i++) {
			const s = row.createSpan({ cls: cx('ws-rating__star', i <= n ? 'is-on' : '') });
			setIcon(s, 'star');
		}
	},
	createEditor(el, ctx) {
		const max = typeof ctx.field.config?.max === 'number' ? ctx.field.config.max : 5;
		let value = typeof ctx.value === 'number' ? ctx.value : 0;
		const row = el.createDiv({
			cls: 'ws-rating',
			attr: { role: 'slider', tabindex: '0', 'aria-label': ctx.field.label, 'aria-valuemin': '0', 'aria-valuemax': String(max) },
		});
		const stars: HTMLElement[] = [];
		const paint = (hover?: number) => {
			const shown = hover ?? value;
			stars.forEach((s, i) => s.toggleClass('is-on', i < shown));
			row.setAttr('aria-valuenow', String(value));
		};
		const set = (n: number) => {
			value = n === value ? 0 : n; // clicking the current value clears it
			paint();
			ctx.onChange(value || null);
		};
		for (let i = 1; i <= max; i++) {
			const s = row.createSpan({ cls: 'ws-rating__star' });
			setIcon(s, 'star');
			s.addEventListener('click', () => set(i));
			s.addEventListener('mouseenter', () => paint(i));
			stars.push(s);
		}
		row.addEventListener('mouseleave', () => paint());
		row.addEventListener('keydown', (e) => {
			if (e.key === 'ArrowRight' || e.key === 'ArrowUp') value = Math.min(max, value + 1);
			else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') value = Math.max(0, value - 1);
			else if (/^[0-9]$/.test(e.key) && Number(e.key) <= max) value = Number(e.key);
			else return;
			e.preventDefault();
			paint();
			ctx.onChange(value || null);
		});
		paint();
		return {
			setValue(v) {
				value = typeof v === 'number' ? v : 0;
				paint();
			},
			focus: () => row.focus(),
		};
	},
};
