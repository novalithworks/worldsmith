import { Menu, Notice, setIcon } from 'obsidian';
import { SEMANTIC_COLORS, type SemanticColor } from '../../../../core/types';
import type { FieldCategory, FieldTypeDefinition } from '../../../../fields/FieldType';
import type { FieldTypeRegistry } from '../../../../fields/FieldTypeRegistry';
import type { WorldSession } from '../../../../services/WorldSession';
import { chip, cx, icon, nameRegion } from '../../../components/dom';
import { confirmModal } from '../../../components/modals';
import type { WorldsmithContext } from '../../../../app/context';
import type { FieldDefinition } from '../../../../core/types';

/**
 * Small building blocks shared by every Type Studio surface.
 */

/**
 * A studio card (0.10 settings look): a tinted icon, a title and a line about what it holds,
 * an optional slot on the right of the header, then its body.
 */
export function studioCard(parent: HTMLElement, title: string, glyph: string, blurb: string, cls = ''): { card: HTMLElement; head: HTMLElement; aside: HTMLElement; body: HTMLElement } {
	const card = parent.createDiv({ cls: `ws-tset ${cls}`.trim() });
	const head = card.createDiv({ cls: 'ws-tset__head' });
	const mark = head.createDiv({ cls: 'ws-tset__mark' });
	setIcon(mark, glyph);
	const t = head.createDiv({ cls: 'ws-tset__titles' });
	t.createDiv({ cls: 'ws-tset__title', text: title });
	t.createDiv({ cls: 'ws-tset__blurb', text: blurb });
	const aside = head.createDiv({ cls: 'ws-tset__aside' });
	return { card, head, aside, body: card.createDiv({ cls: 'ws-tset__rows' }) };
}

/** Run a schema edit; errors (validation or otherwise) become a readable notice. */
export function applyEdit<T>(fn: () => T): T | undefined {
	try {
		return fn();
	} catch (e) {
		new Notice(e instanceof Error ? e.message : String(e), 6000);
		return undefined;
	}
}

/** Notice with an Undo button wired to the session's schema undo stack. */
export function undoNotice(session: WorldSession, message: string): void {
	const frag = createFragment();
	const wrap = frag.createDiv({ cls: 'ws-notice' });
	wrap.createSpan({ text: message });
	const btn = wrap.createEl('button', { cls: 'ws-notice__action', text: 'Undo' });
	const n = new Notice(frag, 9000);
	btn.addEventListener('click', () => {
		session.schemaEdits.undo();
		n.hide();
	});
}

/** Confirm, delete a field (values become unused data), and offer undo. */
export async function confirmDeleteField(ws: WorldsmithContext, s: WorldSession, typeId: string, f: FieldDefinition): Promise<boolean> {
	const details: string[] = [];
	if (f.type === 'relation') {
		const links = s.entities.all().filter((e) => e.typeId === typeId).reduce((n, e) => n + s.relations.fieldViews(e.id, f).length, 0);
		if (links) details.push(`Its ${links} link${links === 1 ? '' : 's'} ${links === 1 ? 'is' : 'are'} kept and keep${links === 1 ? 's' : ''} showing under Connections.`);
	} else {
		const withValue = s.entities.all().filter((e) => e.typeId === typeId && !ws.fieldTypes.isEmpty(f, e.values[f.id])).length;
		if (withValue) details.push(`${withValue} entr${withValue === 1 ? 'y has' : 'ies have'} a value, kept as unused data on each entry (restorable).`);
	}
	const ok = await confirmModal(ws.app, {
		title: `Delete the “${f.label}” field?`,
		body: 'The field is removed from every entry of this type.',
		details: details.length ? details : undefined,
		confirmLabel: 'Delete field',
		danger: true,
	});
	if (ok && applyEdit(() => s.schemaEdits.deleteField(typeId, f.id))) {
		undoNotice(s, `Deleted “${f.label}”.`);
		return true;
	}
	return false;
}

/**
 * Text that looks like text until you edit it. Commits on Enter or blur (one undo step
 * per edit, not per keystroke); Escape reverts.
 */
export function inlineText(
	parent: HTMLElement,
	value: string,
	o: { placeholder?: string; cls?: string; ariaLabel?: string; multiline?: boolean; onCommit: (v: string) => void },
): HTMLInputElement | HTMLTextAreaElement {
	const input = o.multiline
		? parent.createEl('textarea', { cls: cx('ws-inline', 'ws-inline--multi', o.cls), attr: { rows: '2' } })
		: parent.createEl('input', { cls: cx('ws-inline', o.cls), attr: { type: 'text', spellcheck: 'false' } });
	input.value = value;
	if (o.placeholder) input.placeholder = o.placeholder;
	if (o.ariaLabel) input.setAttr('aria-label', o.ariaLabel);
	let committed = value;
	const commit = () => {
		if (input.value === committed) return;
		committed = input.value;
		o.onCommit(input.value);
	};
	input.addEventListener('blur', commit);
	(input as HTMLElement).addEventListener('keydown', (e: KeyboardEvent) => {
		if (e.key === 'Enter' && (!o.multiline || e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			input.blur();
		} else if (e.key === 'Escape') {
			input.value = committed;
			input.blur();
		}
		e.stopPropagation();
	});
	return input;
}

/** Label + optional hint on the left, control on the right (stacks when narrow). */
export function formRow(parent: HTMLElement, label: string, hint?: string): HTMLElement {
	const row = parent.createDiv({ cls: 'ws-frow' });
	const text = row.createDiv({ cls: 'ws-frow__text' });
	text.createDiv({ cls: 'ws-frow__label', text: label });
	if (hint) text.createDiv({ cls: 'ws-frow__hint', text: hint });
	return row.createDiv({ cls: 'ws-frow__control' });
}

export function segmented<T extends string>(
	parent: HTMLElement,
	options: Array<{ id: T; label: string; icon?: string }>,
	value: T,
	onChange: (v: T) => void,
	ariaLabel?: string,
): HTMLElement {
	const seg = parent.createDiv({ cls: 'ws-segmented ws-segmented--labels', attr: { role: 'radiogroup'} });
	nameRegion(seg, ariaLabel ?? '' );
	for (const o of options) {
		const b = seg.createEl('button', { cls: cx('ws-segmented__item', o.id === value && 'is-active'), attr: { type: 'button', role: 'radio', 'aria-checked': String(o.id === value) } });
		if (o.icon) icon(b, o.icon);
		b.createSpan({ text: o.label });
		b.addEventListener('click', () => {
			if (o.id !== value) onChange(o.id);
		});
	}
	return seg;
}

export function toggle(parent: HTMLElement, value: boolean, onChange: (v: boolean) => void, ariaLabel: string): HTMLButtonElement {
	const sw = parent.createEl('button', { cls: cx('ws-switch', value && 'is-on'), attr: { type: 'button', role: 'switch', 'aria-checked': String(value), 'aria-label': ariaLabel } });
	sw.createSpan({ cls: 'ws-switch__knob' });
	sw.addEventListener('click', () => onChange(!value));
	return sw;
}

export function colorSwatches(parent: HTMLElement, value: SemanticColor | null | undefined, onChange: (c: SemanticColor | null) => void, allowNone = true): HTMLElement {
	const row = parent.createDiv({ cls: 'ws-swatches', attr: { role: 'radiogroup'} });
	nameRegion(row, 'Color' );
	if (allowNone) {
		const none = row.createEl('button', { cls: cx('ws-swatch-btn', 'ws-swatch-btn--none', !value && 'is-active'), attr: { type: 'button', 'aria-label': 'No color' } });
		setIcon(none, 'ban');
		none.addEventListener('click', () => onChange(null));
	}
	for (const c of SEMANTIC_COLORS) {
		const b = row.createEl('button', { cls: cx('ws-swatch-btn', `ws-tint--${c}`, value === c && 'is-active'), attr: { type: 'button', 'aria-label': c } });
		b.addEventListener('click', () => onChange(c));
	}
	return row;
}

/** Color choice as a native Obsidian menu (for compact spots like choice rows). */
export function colorMenu(evt: MouseEvent, value: SemanticColor | undefined, onChange: (c: SemanticColor | undefined) => void): void {
	const menu = new Menu();
	for (const c of SEMANTIC_COLORS) {
		menu.addItem((i) => i.setTitle(c[0]!.toUpperCase() + c.slice(1)).setIcon('circle').setChecked(value === c).onClick(() => onChange(c)));
	}
	menu.addSeparator();
	menu.addItem((i) => i.setTitle('No color').setIcon('ban').onClick(() => onChange(undefined)));
	menu.showAtMouseEvent(evt);
}

export const CATEGORY_LABELS: Record<FieldCategory, string> = {
	text: 'Text',
	number: 'Numbers',
	choice: 'Choices',
	date: 'Dates & time',
	media: 'Media & files',
	relation: 'Links',
	computed: 'Computed',
	other: 'Other',
};

const CATEGORY_ORDER: FieldCategory[] = ['text', 'choice', 'number', 'date', 'media', 'relation', 'computed', 'other'];

/** Plain-language one-liners for the field kind picker. */
export const KIND_HINTS: Record<string, string> = {
	text: 'A single line — names, titles, short facts',
	longtext: 'A few sentences or paragraphs',
	richtext: 'Formatted writing with links and lists',
	list: 'Several short items — traits, fears, likes',
	tags: 'Hashtag-style labels',
	select: 'Pick one from your own choices',
	multiselect: 'Pick several from your own choices',
	number: 'Ages, heights, populations',
	percent: '0–100 with a bar',
	rating: 'Stars',
	progress: 'How far along something is',
	boolean: 'Yes or no',
	chrono: 'A date in your world’s own calendar',
	date: 'A real-world calendar date',
	time: 'Hours and minutes',
	image: 'One image from your vault',
	gallery: 'Several images from your vault',
	file: 'Any file from your vault',
	url: 'A web link',
	color: 'A color swatch',
	icon: 'An icon',
	relation: 'Links to other entries — shows on both',
	parent: 'The entry this one sits inside',
	children: 'Entries nested inside this one',
	rollup: 'Summarises linked entries',
	formula: 'Calculated from other fields',
};

/** Field kinds grouped by category, in a stable order. */
export function kindsByCategory(registry: FieldTypeRegistry): Array<{ category: FieldCategory; kinds: FieldTypeDefinition[] }> {
	const all = registry.all().filter((k) => !k.id.startsWith('__'));
	return CATEGORY_ORDER.map((category) => ({ category, kinds: all.filter((k) => k.category === category) })).filter((g) => g.kinds.length);
}

/** Pick entity types as removable chips; empty = any. */
export function typePicker(parent: HTMLElement, s: WorldSession, ids: string[], save: (next: string[]) => void, emptyLabel = 'Any type'): void {
	const chips = parent.createDiv({ cls: 'ws-chips ws-pick-chips' });
	for (const id of ids) {
		const t = s.schemas.get(id);
		chip(chips, { label: t?.plural ?? id, icon: t?.icon, color: t?.color ?? undefined, onRemove: () => save(ids.filter((x) => x !== id)) });
	}
	const add = chips.createEl('button', { cls: 'ws-chip-add', attr: { type: 'button' } });
	icon(add, 'plus');
	add.createSpan({ text: ids.length ? 'Add' : emptyLabel });
	add.addEventListener('click', () => {
		const menu = new Menu();
		for (const t of s.schemas.list().filter((x) => !ids.includes(x.id))) menu.addItem((it) => it.setTitle(t.plural).setIcon(t.icon).onClick(() => save([...ids, t.id])));
		const r = add.getBoundingClientRect();
		menu.showAtPosition({ x: r.left, y: r.bottom + 4 });
	});
}
