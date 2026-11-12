import { safeUrl } from '../../core/util/urls';
import { Component, MarkdownRenderer, setIcon } from 'obsidian';
import type { FieldEditorContext, FieldTypeUI } from '../FieldType';
import { textDisplay, textEditor } from './shared';
import { IconPickerModal } from '../../ui/components/modals';
import { button, cx } from '../../ui/components/dom';

const str = (v: unknown) => (typeof v === 'string' ? v : '');

export const textUI: FieldTypeUI = {
	renderDisplay: (el, v) => textDisplay(el, str(v)),
	createEditor: (el, ctx) => textEditor(el, ctx),
};

export const longTextUI: FieldTypeUI = {
	renderDisplay: (el, v) => textDisplay(el, str(v)),
	createEditor: (el, ctx) => textEditor(el, ctx, { multiline: true, debounceMs: 600 }),
};

/**
 * Markdown field: rendered with Obsidian's renderer (links, embeds, callouts all work),
 * click or Enter to edit the source, blur to render again.
 */
export const richTextUI: FieldTypeUI = {
	renderDisplay(el, v, ctx) {
		const text = str(v);
		if (!text) return textDisplay(el, '');
		const box = el.createDiv({ cls: 'ws-markdown markdown-rendered' });
		void MarkdownRenderer.render(ctx.app, text, box, ctx.entity?.linkedNote?.path ?? '', ctx.component);
	},
	createEditor(el, ctx) {
		const wrap = el.createDiv({ cls: 'ws-rich' });
		let value = str(ctx.value);
		let editing = false;
		let renderScope: Component | null = null;
		let editor: ReturnType<typeof textEditor> | null = null;

		const showPreview = () => {
			editing = false;
			editor = null;
			wrap.empty();
			wrap.removeClass('is-editing');
			renderScope?.unload();
			renderScope = new Component();
			ctx.component.addChild(renderScope);
			const preview = wrap.createDiv({
				cls: cx('ws-rich__preview', 'ws-markdown', 'markdown-rendered', value ? '' : 'is-empty'),
				attr: { tabindex: ctx.readOnly ? '-1' : '0', role: 'button', 'aria-label': `Edit ${ctx.field.label}` },
			});
			if (value) {
				void MarkdownRenderer.render(ctx.app, value, preview, ctx.entity?.linkedNote?.path ?? '', renderScope);
			} else {
				preview.setText(ctx.field.placeholder || 'Click to write…');
			}
			if (ctx.readOnly) return;
			preview.addEventListener('click', (e) => {
				// Let links inside rendered markdown work normally.
				if ((e.target as HTMLElement).closest('a')) return;
				showEditor();
			});
			preview.addEventListener('keydown', (e) => {
				if (e.key === 'Enter') {
					e.preventDefault();
					showEditor();
				}
			});
		};

		const showEditor = () => {
			editing = true;
			wrap.empty();
			wrap.addClass('is-editing');
			const sub: FieldEditorContext = {
				...ctx,
				value,
				onChange: (v) => {
					value = str(v);
					ctx.onChange(v);
				},
			};
			editor = textEditor(wrap, sub, { multiline: true, debounceMs: 600, cls: 'ws-rich__source' });
			editor.input.addEventListener('blur', () => window.setTimeout(showPreview, 0));
			editor.focus();
		};

		showPreview();
		return {
			setValue(v) {
				const next = str(v);
				if (next === value) return;
				value = next;
				if (editing) editor?.setValue(next);
				else showPreview();
			},
			focus: showEditor,
		};
	},
};

export const urlUI: FieldTypeUI = {
	renderDisplay(el, v) {
		const url = str(v);
		if (!url) return textDisplay(el, '');
		// Only web, mail and Obsidian links become links (0.20.2 security): a value from an
		// import, a CSV or a synced note could be `javascript:`, `file:` or `data:`.
		const safe = safeUrl(url);
		if (!safe) {
			el.createSpan({ cls: 'ws-field-link is-unsafe', text: url, attr: { title: 'Not opened: only web, mail and Obsidian links can be opened.' } });
			return;
		}
		el.createEl('a', { cls: 'ws-field-link', text: url.replace(/^https?:\/\//, ''), attr: { href: safe, target: '_blank', rel: 'noopener noreferrer' } });
	},
	createEditor(el, ctx) {
		const row = el.createDiv({ cls: 'ws-field-row' });
		const ed = textEditor(row, ctx, { inputType: 'url' });
		const open = button(row, {
			icon: 'external-link',
			variant: 'quiet',
			size: 'sm',
			tooltip: 'Open link',
			onClick: () => {
				const u = safeUrl(ed.input.value);
				if (u) window.open(u, '_blank', 'noopener,noreferrer');
			},
		});
		// The button only shows for a link that may be opened.
		const sync = () => open.toggleClass('is-hidden', !safeUrl(ed.input.value));
		ed.input.addEventListener('input', sync);
		sync();
		return ed;
	},
};

export const dateUI: FieldTypeUI = {
	renderDisplay: (el, v) => textDisplay(el, str(v)),
	createEditor: (el, ctx) => textEditor(el, ctx, { inputType: 'date', debounceMs: 0 }),
};

export const timeUI: FieldTypeUI = {
	renderDisplay: (el, v) => textDisplay(el, str(v)),
	createEditor: (el, ctx) => textEditor(el, ctx, { inputType: 'time', debounceMs: 0 }),
};

export const colorUI: FieldTypeUI = {
	renderDisplay(el, v) {
		const c = str(v);
		if (!c) return textDisplay(el, '');
		const sw = el.createSpan({ cls: 'ws-swatch' });
		sw.style.setProperty('--ws-swatch', c);
		el.createSpan({ cls: 'ws-field-display', text: c });
	},
	createEditor(el, ctx) {
		const row = el.createDiv({ cls: 'ws-field-row' });
		const picker = row.createEl('input', { cls: 'ws-color-input', attr: { type: 'color', 'aria-label': `${ctx.field.label} picker` } });
		picker.value = str(ctx.value) || '#888888';
		const ed = textEditor(row, ctx, { cls: 'ws-field-input--mono' });
		ed.input.placeholder = '#rrggbb';
		picker.addEventListener('input', () => {
			ed.input.value = picker.value;
			ctx.onChange(picker.value);
		});
		return {
			setValue(v) {
				ed.setValue(v);
				if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) picker.value = v;
			},
			focus: () => ed.focus(),
		};
	},
};

export const iconUI: FieldTypeUI = {
	renderDisplay(el, v) {
		const id = str(v);
		if (!id) return textDisplay(el, '');
		const s = el.createSpan({ cls: 'ws-icon' });
		setIcon(s, id);
	},
	createEditor(el, ctx) {
		let value = str(ctx.value);
		const btn = el.createEl('button', { cls: 'ws-icon-pick ws-icon-pick--sm', attr: { type: 'button', 'aria-label': `Choose ${ctx.field.label}` } });
		const paint = () => {
			btn.empty();
			setIcon(btn, value || 'plus');
			btn.toggleClass('is-empty', !value);
		};
		paint();
		btn.addEventListener('click', () =>
			new IconPickerModal(ctx.app, (id) => {
				value = id;
				paint();
				ctx.onChange(id);
			}).open(),
		);
		return {
			setValue(v) {
				value = str(v);
				paint();
			},
			focus: () => btn.focus(),
		};
	},
};
