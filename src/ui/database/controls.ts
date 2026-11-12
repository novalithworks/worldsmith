import { Menu, setIcon } from 'obsidian';
import { isForeignCondition, viewKind, type DatabaseView, type EntitySchema, type ViewColumn, type ViewCondition, type ViewSort } from '../../core/types';
import type { WorldSession } from '../../services/WorldSession';
import { BUILTIN_PROPS, filterableFields, opsFor, propInfo, valueChoices, viewFields } from '../../services/viewQuery';
import { button, cx, icon } from '../components/dom';
import { Popover } from '../components/popover';
import { openPropertyPicker } from '../components/propertyPicker';

/**
 * The toolbar panels of a database view: filters, sorting, and which fields show. Each
 * panel edits a copy and reports every change, so the results update as you go.
 */

let seq = 0;
const newId = () => `c${Date.now().toString(36)}${(seq++).toString(36)}`;

function select(parent: HTMLElement, options: Array<{ id: string; label: string; group?: string }>, value: string, onChange: (v: string) => void, cls = '', aria = ''): HTMLSelectElement {
	const sel = parent.createEl('select', { cls: cx('dropdown', cls), attr: aria ? { 'aria-label': aria } : {} });
	let group: HTMLOptGroupElement | null = null;
	let groupName = '';
	for (const o of options) {
		if (o.group && o.group !== groupName) {
			groupName = o.group;
			group = sel.createEl('optgroup', { attr: { label: o.group } });
		}
		(group ?? sel).createEl('option', { value: o.id, text: o.label });
	}
	sel.value = value;
	sel.addEventListener('change', () => onChange(sel.value));
	return sel;
}

/** How a panel shows a property in its pickers (icon, short hint). */
export type PropLook = (id: string) => { icon?: string; hint?: string };

/**
 * "Add a filter / sort": a button that opens a searchable property picker (a native select
 * would fire on an arrow key on some platforms, and a long menu runs off the screen).
 */
function addButton(parent: HTMLElement, label: string, title: string, options: Array<{ id: string; label: string; group?: string }>, onPick: (id: string) => void, cls: string, look?: PropLook): HTMLElement {
	const btn = button(parent, {
		icon: 'plus',
		label,
		variant: 'quiet',
		size: 'sm',
		cls: `ws-vpanel__add-btn ${cls}`,
		onClick: () =>
			openPropertyPicker(btn, {
				title,
				placeholder: 'Find a property…',
				items: options.map((o) => ({ ...o, ...(look?.(o.id) ?? {}) })),
				onPick: (id) => id && onPick(id),
			}),
	});
	return btn;
}

/** Open a menu at the pointer, or under the control when it was opened from the keyboard. */
export function showMenuAt(m: Menu, evt: MouseEvent | KeyboardEvent | null, el?: HTMLElement | null): void {
	if (evt instanceof MouseEvent && (evt.clientX || evt.clientY)) {
		m.showAtMouseEvent(evt);
		return;
	}
	const target = el ?? ((evt?.target as HTMLElement | null)?.closest?.('button, [role="button"], [role="tab"], td, th'));
	if (!target) return;
	const r = target.getBoundingClientRect();
	m.showAtPosition({ x: r.left, y: r.bottom + 4 }, target.ownerDocument);
}

/**
 * Re-render a panel without losing keyboard focus: the focused control is found again by
 * its row (data-condition / data-row / data-field) and its aria-label.
 */
function keepFocus(root: HTMLElement, paint: () => void): void {
	const active = root.ownerDocument.activeElement as HTMLElement | null;
	let sel: string | null = null;
	if (active && root.contains(active)) {
		const label = active.getAttribute('aria-label');
		const row = active.closest<HTMLElement>('[data-condition], [data-row], [data-field]');
		const rowSel = row ? (['data-condition', 'data-row', 'data-field'] as const).map((a) => (row.hasAttribute(a) ? `[${a}="${CSS.escape(row.getAttribute(a)!)}"]` : '')).join('') : '';
		const own = label ? `[aria-label="${CSS.escape(label)}"]` : active.className ? `.${CSS.escape(active.classList[0]!)}` : '';
		sel = own ? `${rowSel} ${own}`.trim() : null;
	}
	paint();
	if (sel) root.querySelector<HTMLElement>(sel)?.focus();
}

/** Every property a condition can test, grouped: the type's fields, then built-ins. */
function filterProps(schema: EntitySchema): Array<{ id: string; label: string; group: string }> {
	return [
		...filterableFields(schema).map((f) => ({ id: f.id, label: f.label, group: `${schema.singular} fields` })),
		...BUILTIN_PROPS.filter((b) => b.id !== '__name').map((b) => ({ id: b.id, label: b.label, group: 'Every entry' })),
		{ id: '__name', label: 'Name or alias', group: 'Every entry' },
	];
}

/** A short sentence for a condition: "Story role is Antagonist", "Portrait is missing". */
export function describeCondition(schema: EntitySchema, c: ViewCondition): { text: string; broken: boolean } {
	if (isForeignCondition(c)) return { text: 'A filter from a newer version of Worldsmith', broken: true };
	const info = propInfo(schema, c.field);
	if (!info) return { text: 'A removed field', broken: true };
	const op = opsFor(schema, c.field).find((o) => o.id === c.op);
	const opLabel = op?.label ?? c.op;
	const label = c.field === '__name' ? 'Name' : info.label;
	const value = op?.needsValue ? (c.value ? (c.field === '__tags' ? ` #${c.value.replace(/^#/, '')}` : ` ${c.value}`) : ' …') : '';
	return { text: `${label} ${opLabel}${value}`, broken: false };
}

// ── Filters ─────────────────────────────────────────────────────────────────────

export function openFilterPanel(
	anchor: HTMLElement,
	s: WorldSession,
	schema: EntitySchema,
	view: DatabaseView,
	onChange: (patch: Pick<DatabaseView, 'conditions' | 'match' | 'showArchived'>) => void,
	o: { addField?: string; focus?: string; look?: PropLook } = {},
): Popover {
	// Typing in a value box saves after a short pause; closing the panel saves straight away.
	let typing: number | null = null;
	const flush = () => {
		if (typing === null) return;
		window.clearTimeout(typing);
		typing = null;
		emit();
	};
	const pop = new Popover(anchor, { cls: 'ws-vpanel ws-vpanel--filter', width: 520, label: 'Filters', onClose: flush });
	let conditions = view.conditions.map((c) => ({ ...c }));
	let match = view.match;
	let archived = view.showArchived;
	const emit = () => {
		if (typing !== null) {
			window.clearTimeout(typing);
			typing = null;
		}
		onChange({ conditions: conditions.map((c) => ({ ...c })), match, showArchived: archived });
	};
	const props = filterProps(schema);
	const add = (field: string) => {
		const ops = opsFor(schema, field);
		const choices = valueChoices(s, schema, field);
		conditions.push({ id: newId(), field, op: ops[0]!.id, value: ops[0]!.needsValue && choices?.length ? choices[0]!.id : '' });
		emit();
		paint(conditions[conditions.length - 1]!.id);
	};
	const paint = (focusId?: string) => keepFocus(pop.el, () => draw(focusId));
	const draw = (focusId?: string) => {
		pop.el.empty();
		const head = pop.el.createDiv({ cls: 'ws-vpanel__head' });
		head.createSpan({ cls: 'ws-vpanel__title', text: 'Filters' });
		if (conditions.length > 1) {
			const m = head.createDiv({ cls: 'ws-vpanel__match' });
			m.createSpan({ text: 'Show entries matching' });
			select(m, [{ id: 'all', label: 'all of these' }, { id: 'any', label: 'any of these' }], match, (v) => {
				match = v === 'any' ? 'any' : 'all';
				emit();
			}, 'ws-vpanel__sel--sm', 'Match');
		}
		const rows = pop.el.createDiv({ cls: 'ws-vpanel__rows' });
		if (!conditions.length) rows.createDiv({ cls: 'ws-vpanel__empty', text: 'No filters — every entry shows. Add one to narrow the list.' });
		for (const c of conditions) {
			const row = rows.createDiv({ cls: 'ws-vfilter', attr: { 'data-condition': c.id } });
			if (isForeignCondition(c)) {
				// Kept as it is (a newer version wrote it); it can only be removed here.
				row.addClass('is-foreign');
				icon(row, 'alert-triangle', 'ws-vfilter__warn');
				row.createSpan({ cls: 'ws-vfilter__foreign', text: 'A filter from a newer version of Worldsmith — it can’t be used or changed here.' });
				const x = row.createEl('button', { cls: 'ws-vpanel__x clickable-icon', attr: { type: 'button', 'aria-label': 'Remove filter' } });
				setIcon(x, 'x');
				x.addEventListener('click', () => {
					conditions = conditions.filter((y) => y.id !== c.id);
					emit();
					paint();
				});
				continue;
			}
			const known = !!propInfo(schema, c.field);
			select(
				row,
				known ? props : [{ id: c.field, label: 'A removed field', group: '' }, ...props],
				c.field,
				(v) => {
					c.field = v;
					const ops = opsFor(schema, v);
					if (!ops.some((x) => x.id === c.op)) c.op = ops[0]!.id;
					const ch = valueChoices(s, schema, v);
					c.value = ch?.length && ops.find((x) => x.id === c.op)?.needsValue ? ch[0]!.id : '';
					emit();
					paint(c.id);
				},
				'ws-vfilter__field',
				'Property',
			);
			const ops = opsFor(schema, c.field);
			select(
				row,
				ops.map((x) => ({ id: x.id, label: x.label })),
				c.op,
				(v) => {
					c.op = v as ViewCondition['op'];
					emit();
					paint(c.id);
				},
				'ws-vfilter__op',
				'Condition',
			);
			const needs = ops.find((x) => x.id === c.op)?.needsValue ?? false;
			const valueBox = row.createDiv({ cls: 'ws-vfilter__value' });
			if (needs) {
				const choices = valueChoices(s, schema, c.field);
				if (choices) {
					select(valueBox, choices.map((x) => ({ id: x.id, label: x.label })), c.value, (v) => {
						c.value = v;
						emit();
					}, '', 'Value');
				} else {
					const info = propInfo(schema, c.field);
					const isDate = info?.kind === 'date' || info?.kind === 'chrono';
					const input = valueBox.createEl('input', {
						cls: 'ws-input',
						attr: {
							type: 'text',
							'aria-label': 'Value',
							placeholder: isDate ? (c.field === '__created' || c.field === '__updated' ? '2026-05 or 30d' : '2026-05-01') : ['number', 'percent', 'rating'].includes(info?.kind ?? '') || c.field === '__progress' || c.field === '__connections' ? 'A number' : 'Type a value',
						},
					});
					input.value = c.value;
					input.addEventListener('input', () => {
						c.value = input.value;
						if (typing !== null) window.clearTimeout(typing);
						typing = window.setTimeout(() => {
							typing = null;
							emit();
						}, 220);
					});
					input.addEventListener('keydown', (evt) => evt.key === 'Enter' && flush());
					if (focusId === c.id) window.setTimeout(() => input.focus(), 0);
				}
			}
			const x = row.createEl('button', { cls: 'ws-vpanel__x clickable-icon', attr: { type: 'button', 'aria-label': 'Remove filter' } });
			setIcon(x, 'x');
			x.addEventListener('click', () => {
				conditions = conditions.filter((y) => y.id !== c.id);
				emit();
				paint();
			});
		}
		const foot = pop.el.createDiv({ cls: 'ws-vpanel__foot' });
		addButton(foot, conditions.length ? 'Add another filter' : 'Add a filter', 'Filter by', props, add, 'ws-vpanel__add-filter', o.look);
		const arch = foot.createEl('label', { cls: 'ws-vpanel__check' });
		const cb = arch.createEl('input', { attr: { type: 'checkbox' } });
		cb.checked = archived;
		arch.createSpan({ text: 'Include archived' });
		cb.addEventListener('change', () => {
			archived = cb.checked;
			emit();
		});
		if (conditions.length) {
			button(foot, {
				label: 'Clear all',
				variant: 'quiet',
				size: 'sm',
				cls: 'ws-vpanel__clear',
				onClick: () => {
					conditions = [];
					emit();
					paint();
				},
			});
		}
		pop.position();
	};
	paint(o.focus);
	if (o.addField) add(o.addField);
	return pop;
}

// ── Sorting ────────────────────────────────────────────────────────────────────

export function sortProps(schema: EntitySchema): Array<{ id: string; label: string; group: string }> {
	return [
		...BUILTIN_PROPS.filter((b) => b.sortable).map((b) => ({ id: b.id, label: b.label, group: 'Every entry' })),
		...viewFields(schema)
			.filter((f) => !['image', 'gallery', 'file', 'richtext', 'longtext'].includes(f.type))
			.map((f) => ({ id: f.id, label: f.label, group: `${schema.singular} fields` })),
	];
}

export function naturalDir(id: string): 'asc' | 'desc' {
	return id === '__updated' || id === '__created' || id === '__progress' || id === '__connections' ? 'desc' : 'asc';
}

export function openSortPanel(anchor: HTMLElement, schema: EntitySchema, view: DatabaseView, onChange: (sorts: ViewSort[]) => void, look?: PropLook): Popover {
	const pop = new Popover(anchor, { cls: 'ws-vpanel ws-vpanel--sort', width: 400, label: 'Sort' });
	let sorts = view.sorts.map((x) => ({ ...x }));
	const props = sortProps(schema);
	const emit = () => onChange(sorts.map((x) => ({ ...x })));
	const paint = () => keepFocus(pop.el, draw);
	const draw = () => {
		pop.el.empty();
		pop.el.createDiv({ cls: 'ws-vpanel__head' }).createSpan({ cls: 'ws-vpanel__title', text: 'Sort' });
		const rows = pop.el.createDiv({ cls: 'ws-vpanel__rows' });
		if (!sorts.length) rows.createDiv({ cls: 'ws-vpanel__empty', text: 'Last edited first. Add a sort to choose another order — the next one breaks ties.' });
		sorts.forEach((x, i) => {
			const row = rows.createDiv({ cls: 'ws-vsort', attr: { 'data-row': String(i) } });
			row.createSpan({ cls: 'ws-vsort__n', text: i === 0 ? 'Sort by' : 'then by' });
			const known = props.some((p) => p.id === x.field);
			select(row, known ? props : [{ id: x.field, label: 'A removed field', group: '' }, ...props], x.field, (v) => {
				x.field = v;
				x.dir = naturalDir(v);
				emit();
				paint();
			}, 'ws-vsort__field', 'Sort by');
			const info = propInfo(schema, x.field);
			const kind = info?.kind ?? '';
			const words = ['date', 'chrono'].includes(kind) || ['__created', '__updated'].includes(x.field) ? ['Oldest first', 'Newest first'] : ['number', 'percent', 'rating'].includes(kind) || ['__progress', '__connections'].includes(x.field) ? ['Lowest first', 'Highest first'] : x.field === '__status' || kind === 'select' ? ['In order', 'Reversed'] : ['A → Z', 'Z → A'];
			select(row, [{ id: 'asc', label: words[0]! }, { id: 'desc', label: words[1]! }], x.dir, (v) => {
				x.dir = v === 'desc' ? 'desc' : 'asc';
				emit();
			}, 'ws-vsort__dir', 'Direction');
			const tools = row.createDiv({ cls: 'ws-vsort__tools' });
			if (i > 0) {
				const up = tools.createEl('button', { cls: 'clickable-icon', attr: { type: 'button', 'aria-label': 'Move up' } });
				setIcon(up, 'arrow-up');
				up.addEventListener('click', () => {
					[sorts[i - 1], sorts[i]] = [sorts[i]!, sorts[i - 1]!];
					emit();
					paint();
				});
			}
			const del = tools.createEl('button', { cls: 'ws-vpanel__x clickable-icon', attr: { type: 'button', 'aria-label': 'Remove sort' } });
			setIcon(del, 'x');
			del.addEventListener('click', () => {
				sorts = sorts.filter((_, j) => j !== i);
				emit();
				paint();
			});
		});
		const foot = pop.el.createDiv({ cls: 'ws-vpanel__foot' });
		const unused = props.filter((p) => !sorts.some((x) => x.field === p.id));
		if (unused.length)
			addButton(foot, sorts.length ? 'Then sort by…' : 'Add a sort', sorts.length ? 'Then sort by' : 'Sort by', unused, (v) => {
				sorts.push({ field: v, dir: naturalDir(v) });
				emit();
				paint();
			}, 'ws-vpanel__add-sort', look);
		if (sorts.length) button(foot, { label: 'Clear', variant: 'quiet', size: 'sm', cls: 'ws-vpanel__clear', onClick: () => ((sorts = []), emit(), paint()) });
		pop.position();
	};
	paint();
	return pop;
}

// ── Fields (columns / card fields) ─────────────────────────────────────────────

/** Built-in columns a table can show besides the type's fields. */
export const BUILTIN_COLUMNS: Array<{ id: string; label: string }> = [
	{ id: '__status', label: 'Status' },
	{ id: '__tags', label: 'Tags' },
	{ id: '__progress', label: 'Developed' },
	{ id: '__connections', label: 'Connections' },
	{ id: '__created', label: 'Created' },
	{ id: '__updated', label: 'Last edited' },
];

export function columnLabel(schema: EntitySchema, id: string): string | null {
	const b = BUILTIN_COLUMNS.find((x) => x.id === id);
	if (b) return b.label;
	return schema.fields.find((f) => f.id === id)?.label ?? null;
}

export function openFieldsPanel(
	anchor: HTMLElement,
	schema: EntitySchema,
	view: DatabaseView,
	defaults: { columns: ViewColumn[]; card: string[] },
	onChange: (patch: Partial<Pick<DatabaseView, 'columns' | 'card'>>) => void,
): Popover {
	const kind = viewKind(view);
	const table = kind === 'table';
	const pop = new Popover(anchor, { cls: 'ws-vpanel ws-vpanel--fields', width: 340, label: table ? 'Columns' : 'Card fields' });
	// The name column (it may carry a width) stays first and isn't listed.
	const nameCol = view.columns?.find((c) => c.id === '__name') ?? null;
	let columns = (view.columns ?? defaults.columns).filter((c) => c.id !== '__name').map((c) => ({ ...c }));
	const withName = (cols: ViewColumn[]) => (nameCol ? [nameCol, ...cols] : cols);
	let cardFields = [...(view.card.fields ?? defaults.card)];
	let card = { ...view.card };
	// Whether the cards follow the type's own card fields (null) rather than a saved list.
	let followsType = view.card.fields === null;
	const cardPatch = () => ({ ...card, fields: followsType ? null : cardFields });
	const all = [...BUILTIN_COLUMNS, ...viewFields(schema).map((f) => ({ id: f.id, label: f.label }))];
	const paint = () => keepFocus(pop.el, draw);
	const draw = () => {
		pop.el.empty();
		const head = pop.el.createDiv({ cls: 'ws-vpanel__head' });
		head.createSpan({ cls: 'ws-vpanel__title', text: table ? 'Columns' : kind === 'list' || kind === 'progress' ? 'Shown under each name' : 'Shown on each card' });
		button(head, {
			label: 'Reset',
			variant: 'quiet',
			size: 'sm',
			cls: 'ws-vpanel__reset',
			onClick: () => {
				if (table) {
					columns = defaults.columns.map((c) => ({ ...c }));
					onChange({ columns: null });
				} else {
					cardFields = [...defaults.card];
					followsType = true;
					card = { ...card, fields: null };
					onChange({ card: cardPatch() });
				}
				paint();
			},
		});
		if (!table && (kind === 'cards' || kind === 'gallery' || kind === 'board')) {
			const opts = pop.el.createDiv({ cls: 'ws-vpanel__opts' });
			const seg = (label: string, choices: Array<[string, string]>, value: string, set: (v: string) => void) => {
				const r = opts.createDiv({ cls: 'ws-vpanel__opt' });
				r.createSpan({ cls: 'ws-vpanel__opt-label', text: label });
				const g = r.createDiv({ cls: 'ws-segmented ws-segmented--labels ws-segmented--sm' });
				for (const [id, text] of choices) {
					const b = g.createEl('button', { cls: cx('ws-segmented__item', value === id && 'is-active'), attr: { type: 'button', 'aria-label': `${label}: ${text}`, 'aria-pressed': String(value === id) } });
					b.setText(text);
					b.addEventListener('click', () => {
						set(id);
						paint();
					});
				}
			};
			seg('Image', [['portrait', 'Portrait'], ['banner', 'Banner'], ['none', 'None']], card.image, (v) => {
				card = { ...card, image: v as DatabaseView['card']['image'] };
				onChange({ card: cardPatch() });
			});
			if (kind !== 'board')
				seg('Size', [['s', 'S'], ['m', 'M'], ['l', 'L']], card.size, (v) => {
					card = { ...card, size: v as DatabaseView['card']['size'] };
					onChange({ card: cardPatch() });
				});
		}
		const shown = table ? columns.map((c) => c.id) : cardFields;
		const list = pop.el.createDiv({ cls: 'ws-vfields' });
		const rows = [...shown.map((id) => ({ id, label: columnLabel(schema, id) })).filter((x): x is { id: string; label: string } => !!x.label), ...all.filter((x) => !shown.includes(x.id))];
		if (table) {
			const name = list.createDiv({ cls: 'ws-vfield is-locked' });
			icon(name, 'lock', 'ws-vfield__icon');
			name.createSpan({ cls: 'ws-vfield__label', text: 'Name' });
			name.createSpan({ cls: 'ws-vfield__hint', text: 'always first' });
		}
		let hiddenTitle = false;
		for (const r of rows) {
			const on = shown.includes(r.id);
			if (!on && !hiddenTitle) {
				hiddenTitle = true;
				list.createDiv({ cls: 'ws-vfields__title', text: 'Hidden' });
			}
			const idx = shown.indexOf(r.id);
			const row = list.createDiv({ cls: cx('ws-vfield', on && 'is-on'), attr: { 'data-field': r.id } });
			const cb = row.createEl('input', { attr: { type: 'checkbox', 'aria-label': `Show ${r.label}` } });
			cb.checked = on;
			row.createSpan({ cls: 'ws-vfield__label', text: r.label });
			const apply = (next: string[]) => {
				if (table) {
					columns = next.map((id) => columns.find((c) => c.id === id) ?? { id });
					onChange({ columns: withName(columns) });
				} else {
					cardFields = next;
					followsType = false;
					card = { ...card, fields: next };
					onChange({ card: cardPatch() });
				}
				paint();
			};
			cb.addEventListener('change', () => apply(cb.checked ? [...shown, r.id] : shown.filter((x) => x !== r.id)));
			if (on) {
				const tools = row.createDiv({ cls: 'ws-vfield__tools' });
				for (const [dir, ic, label] of [
					[-1, 'arrow-up', 'Move up'],
					[1, 'arrow-down', 'Move down'],
				] as const) {
					const to = idx + dir;
					const btn = tools.createEl('button', { cls: 'clickable-icon', attr: { type: 'button', 'aria-label': label } });
					setIcon(btn, ic);
					btn.disabled = to < 0 || to >= shown.length;
					btn.addEventListener('click', () => {
						const next = [...shown];
						[next[idx], next[to]] = [next[to]!, next[idx]!];
						apply(next);
					});
				}
			}
		}
		pop.position();
	};
	paint();
	return pop;
}
