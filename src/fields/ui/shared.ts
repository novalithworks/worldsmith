import { debounce } from '../../core/util/async';
import { autoGrow, cx } from '../../ui/components/dom';
import type { FieldEditorContext, FieldEditorHandle } from '../FieldType';

/**
 * Generic text-like editor used by many field types.
 *
 *  - Debounces typing (default 400 ms) and flushes on blur / Enter.
 *  - External updates (another pane, undo) are applied only when the input is not focused,
 *    so a remote change never yanks text out from under the cursor.
 *  - Escape reverts to the last committed value.
 */
export interface TextEditorOptions {
	multiline?: boolean;
	inputType?: string;
	inputMode?: string;
	/** Convert input text into the value handed to onChange. */
	parse?: (text: string) => unknown;
	/** Convert a stored value into input text. */
	format?: (value: unknown) => string;
	debounceMs?: number;
	cls?: string;
}

export function textEditor(parent: HTMLElement, ctx: FieldEditorContext, o: TextEditorOptions = {}): FieldEditorHandle & { input: HTMLInputElement | HTMLTextAreaElement } {
	const format = o.format ?? ((v: unknown) => (v == null ? '' : String(v)));
	const parse = o.parse ?? ((t: string) => t);
	const input = o.multiline
		? parent.createEl('textarea', { cls: cx('ws-field-input', 'ws-field-input--multi', o.cls ?? ''), attr: { rows: '1' } })
		: parent.createEl('input', { cls: cx('ws-field-input', o.cls ?? ''), attr: { type: o.inputType ?? 'text' } });
	if (o.inputMode) input.setAttr('inputmode', o.inputMode);
	input.setAttr('aria-label', ctx.field.label);
	input.setAttr('spellcheck', o.multiline ? 'true' : 'false');
	if (ctx.field.placeholder) input.placeholder = ctx.field.placeholder;
	else input.placeholder = 'Empty';
	if (ctx.readOnly) input.readOnly = true;

	let committed = format(ctx.value);
	input.value = committed;
	const grow = input instanceof HTMLTextAreaElement ? autoGrow(input) : null;

	const send = debounce(() => {
		committed = input.value;
		ctx.onChange(parse(input.value));
	}, o.debounceMs ?? 400);

	input.addEventListener('input', () => send());
	input.addEventListener('blur', () => send.flush());
	(input as HTMLElement).addEventListener('keydown', (e: KeyboardEvent) => {
		if (e.key === 'Escape') {
			send.cancel();
			input.value = committed;
			grow?.();
			input.blur();
		} else if (e.key === 'Enter' && !o.multiline) {
			e.preventDefault();
			send.flush();
			input.blur();
		}
	});
	ctx.component.register(() => send.flush());

	return {
		input,
		setValue(v) {
			if (document.activeElement === input) return;
			committed = format(v);
			if (input.value !== committed) {
				input.value = committed;
				grow?.();
			}
		},
		focus() {
			input.focus();
		},
		destroy() {
			send.flush();
		},
	};
}

/** Read-only text display with an em-dash for empty. */
export function textDisplay(el: HTMLElement, text: string): void {
	if (text) el.createSpan({ cls: 'ws-field-display', text });
	else el.createSpan({ cls: 'ws-field-display is-empty', text: '—' });
}
