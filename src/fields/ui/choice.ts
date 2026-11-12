import { Menu } from 'obsidian';
import type { SelectOption } from '../../core/types';
import { chip, icon, cx } from '../../ui/components/dom';
import type { FieldEditorContext, FieldTypeUI } from '../FieldType';
import { selectOptions } from '../types/logic';
import { textDisplay } from './shared';

const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

function optionFor(opts: SelectOption[], id: string): SelectOption {
	return opts.find((o) => o.id === id) ?? { id, label: id };
}

function optionChip(parent: HTMLElement, o: SelectOption, onRemove?: () => void): HTMLElement {
	return chip(parent, { label: o.label, color: o.color ?? 'gray', icon: o.icon, onRemove });
}

// ── select ────────────────────────────────────────────────────────────────────

export const selectUI: FieldTypeUI = {
	renderDisplay(el, v, ctx) {
		if (typeof v !== 'string' || !v) return textDisplay(el, '');
		optionChip(el, optionFor(selectOptions(ctx.field), v));
	},
	createEditor(el, ctx) {
		let value = typeof ctx.value === 'string' ? ctx.value : null;
		const trigger = el.createEl('button', {
			cls: 'ws-select-trigger',
			attr: { type: 'button', 'aria-haspopup': 'menu', 'aria-label': ctx.field.label },
		});
		const paint = () => {
			trigger.empty();
			if (value) optionChip(trigger, optionFor(selectOptions(ctx.field), value));
			else trigger.createSpan({ cls: 'ws-select-trigger__placeholder', text: ctx.field.placeholder || 'Choose…' });
			icon(trigger, 'chevrons-up-down', 'ws-select-trigger__caret');
		};
		const open = () => {
			const menu = new Menu();
			for (const o of selectOptions(ctx.field)) {
				menu.addItem((item) =>
					item
						.setTitle(o.label)
						.setIcon(o.icon ?? 'circle')
						.setChecked(o.id === value)
						.onClick(() => {
							value = o.id;
							paint();
							ctx.onChange(o.id);
						}),
				);
			}
			if (value) {
				menu.addSeparator();
				menu.addItem((item) =>
					item.setTitle('Clear').setIcon('x').onClick(() => {
						value = null;
						paint();
						ctx.onChange(null);
					}),
				);
			}
			const r = trigger.getBoundingClientRect();
			menu.showAtPosition({ x: r.left, y: r.bottom + 4 });
		};
		if (!ctx.readOnly) trigger.addEventListener('click', open);
		else trigger.disabled = true;
		paint();
		return {
			setValue(v) {
				value = typeof v === 'string' ? v : null;
				paint();
			},
			focus: () => trigger.focus(),
		};
	},
};

// ── multi-select ──────────────────────────────────────────────────────────────

export const multiSelectUI: FieldTypeUI = {
	renderDisplay(el, v, ctx) {
		const ids = strArr(v);
		if (!ids.length) return textDisplay(el, '');
		const wrap = el.createDiv({ cls: 'ws-chips' });
		for (const id of ids) optionChip(wrap, optionFor(selectOptions(ctx.field), id));
	},
	createEditor(el, ctx) {
		let value = strArr(ctx.value);
		const wrap = el.createDiv({ cls: 'ws-chips ws-chips--editable' });
		const commit = () => ctx.onChange(value.length ? [...value] : null);
		const paint = () => {
			wrap.empty();
			const opts = selectOptions(ctx.field);
			for (const id of value) {
				optionChip(wrap, optionFor(opts, id), ctx.readOnly ? undefined : () => {
					value = value.filter((x) => x !== id);
					paint();
					commit();
				});
			}
			if (ctx.readOnly) return;
			const add = wrap.createEl('button', { cls: 'ws-chip-add', attr: { type: 'button', 'aria-label': `Add ${ctx.field.label}` } });
			icon(add, 'plus');
			if (!value.length) add.createSpan({ text: ctx.field.placeholder || 'Add' });
			add.addEventListener('click', () => {
				const menu = new Menu();
				for (const o of opts) {
					const on = value.includes(o.id);
					menu.addItem((item) =>
						item
							.setTitle(o.label)
							.setIcon(o.icon ?? 'circle')
							.setChecked(on)
							.onClick(() => {
								value = on ? value.filter((x) => x !== o.id) : [...value, o.id];
								paint();
								commit();
							}),
					);
				}
				const r = add.getBoundingClientRect();
				menu.showAtPosition({ x: r.left, y: r.bottom + 4 });
			});
		};
		paint();
		return {
			setValue(v) {
				value = strArr(v);
				paint();
			},
			focus: () => (wrap.querySelector('button'))?.focus(),
		};
	},
};

// ── free list / tags ──────────────────────────────────────────────────────────

/**
 * Chip list with an inline input: Enter or comma adds, Backspace on an empty input
 * removes the last chip, pasting "a, b, c" adds three.
 */
function listEditor(el: HTMLElement, ctx: FieldEditorContext, tagStyle: boolean) {
	let value = strArr(ctx.value);
	const wrap = el.createDiv({ cls: ['ws-chips', 'ws-chips--editable', 'ws-list-editor'] });
	const commit = () => ctx.onChange(value.length ? [...value] : null);
	let input: HTMLInputElement;

	const addItems = (raw: string) => {
		const items = raw.split(',').map((s) => s.trim()).filter(Boolean);
		let changed = false;
		for (const it of items) {
			const item = tagStyle ? it.replace(/^#/, '').replace(/\s+/g, '-') : it;
			if (!value.includes(item)) {
				value.push(item);
				changed = true;
			}
		}
		if (changed) {
			paint(true);
			commit();
		}
	};

	const paint = (refocus = false) => {
		wrap.empty();
		value.forEach((item, idx) => {
			chip(wrap, {
				label: tagStyle ? `#${item}` : item,
				onRemove: ctx.readOnly
					? undefined
					: () => {
							value.splice(idx, 1);
							paint();
							commit();
						},
			});
		});
		if (ctx.readOnly) {
			if (!value.length) textDisplay(wrap, '');
			return;
		}
		input = wrap.createEl('input', {
			cls: 'ws-list-editor__input',
			attr: { type: 'text', 'aria-label': `Add to ${ctx.field.label}`, spellcheck: 'false' },
		});
		input.placeholder = value.length ? 'Add…' : ctx.field.placeholder || 'Type and press Enter';
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' || e.key === ',') {
				e.preventDefault();
				if (input.value.trim()) addItems(input.value);
			} else if (e.key === 'Backspace' && input.value === '' && value.length) {
				value.pop();
				paint(true);
				commit();
			}
		});
		input.addEventListener('blur', () => {
			if (input.value.trim()) addItems(input.value);
		});
		input.addEventListener('paste', (e) => {
			const text = e.clipboardData?.getData('text') ?? '';
			if (text.includes(',')) {
				e.preventDefault();
				addItems(text);
			}
		});
		if (refocus) window.setTimeout(() => input.focus(), 0);
	};
	paint();
	wrap.addEventListener('click', (e) => {
		if (e.target === wrap) input?.focus();
	});
	return {
		setValue(v: unknown) {
			if (input && document.activeElement === input) return;
			value = strArr(v);
			paint();
		},
		focus: () => input?.focus(),
	};
}

export const listUI: FieldTypeUI = {
	renderDisplay(el, v) {
		const items = strArr(v);
		if (!items.length) return textDisplay(el, '');
		const wrap = el.createDiv({ cls: 'ws-chips' });
		for (const i of items) chip(wrap, { label: i });
	},
	createEditor: (el, ctx) => listEditor(el, ctx, false),
};

export const tagsUI: FieldTypeUI = {
	renderDisplay(el, v) {
		const items = strArr(v);
		if (!items.length) return textDisplay(el, '');
		const wrap = el.createDiv({ cls: 'ws-chips' });
		for (const i of items) chip(wrap, { label: `#${i}` });
	},
	createEditor: (el, ctx) => listEditor(el, ctx, true),
};

export { listEditor };

// ── boolean ───────────────────────────────────────────────────────────────────

export const booleanUI: FieldTypeUI = {
	renderDisplay(el, v) {
		const s = el.createSpan({ cls: cx('ws-bool', v === true ? 'is-on' : '') });
		icon(s, v === true ? 'check' : 'minus');
	},
	createEditor(el, ctx) {
		let value = ctx.value === true;
		const sw = el.createEl('button', {
			cls: 'ws-switch',
			attr: { type: 'button', role: 'switch', 'aria-label': ctx.field.label },
		});
		sw.createSpan({ cls: 'ws-switch__knob' });
		const paint = () => {
			sw.toggleClass('is-on', value);
			sw.setAttr('aria-checked', String(value));
		};
		if (!ctx.readOnly) {
			sw.addEventListener('click', () => {
				value = !value;
				paint();
				ctx.onChange(value);
			});
		}
		paint();
		return {
			setValue(v) {
				value = v === true;
				paint();
			},
			focus: () => sw.focus(),
		};
	},
};
