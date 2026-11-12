import { Component, Menu, Notice, setIcon } from 'obsidian';
import type { WorldsmithContext } from '../../../../app/context';
import type { FieldDefinition, FieldWidth, SelectOption } from '../../../../core/types';
import { selectOptions } from '../../../../fields/types/logic';
import type { WorldSession } from '../../../../services/WorldSession';
import { button, cx, icon } from '../../../components/dom';
import { confirmModal, WorldsmithModal } from '../../../components/modals';
import { applyEdit, CATEGORY_LABELS, colorMenu, confirmDeleteField, formRow, inlineText, kindsByCategory, segmented, studioCard, undoNotice } from './common';
import { renderRelationSettings, renderRollupSettings, setupLinkField } from './linkSettings';

/** A line for the kind's own settings card. */
const CONFIG_BLURBS: Record<string, string> = {
	number: 'The range allowed and the unit shown after it.',
	rating: 'How many stars there are to give.',
};

/** Hints for kind settings that don't bring their own description. */
const CONFIG_HINTS: Record<string, string> = {
	min: 'The smallest value allowed. Empty for no limit.',
	max: 'The largest value allowed. Empty for no limit.',
	unit: 'Shown after the number, like “years” or “km”.',
	'rating.max': 'Anything from 1 to 10.',
};

/**
 * Everything about one field, applied live (each change is one undo step).
 *
 * Re-rendering policy: controls repaint themselves for simple edits, so a click on a
 * toggle right after editing a text box is never lost to a re-render. The modal fully
 * re-renders only for structural changes (kind, choices) or edits made elsewhere.
 */
export class FieldSettingsModal extends WorldsmithModal {
	private ws_scope = new Component();
	private ws_quiet = 0;
	private ws_off: (() => void) | null = null;

	constructor(
		private readonly ws_ctx: WorldsmithContext,
		private readonly ws_session: WorldSession,
		private readonly ws_typeId: string,
		private readonly ws_fieldId: string,
	) {
		super(ws_ctx.app);
		this.modalEl.addClass('ws-field-modal');
		this.contentEl.addClass('ws-fm');
	}

	private get field(): FieldDefinition | undefined {
		return this.ws_session.schemas.get(this.ws_typeId)?.fields.find((f) => f.id === this.ws_fieldId);
	}

	override onOpen(): void {
		this.ws_scope.load();
		const sub = this.ws_session.events.on('schema:updated', ({ schema }) => {
			if (schema.id !== this.ws_typeId || this.ws_quiet > 0) return;
			if (!this.field) this.close();
			else this.ws_render();
		});
		const types = ['relationType:updated', 'relationType:created', 'relationType:deleted'] as const;
		const subs = types.map((t) => this.ws_session.events.on(t, () => this.ws_quiet === 0 && this.ws_render()));
		this.ws_off = () => {
			sub.dispose();
			for (const x of subs) x.dispose();
		};
		this.ws_render();
	}

	override onClose(): void {
		this.ws_off?.();
		this.ws_scope.unload();
		this.contentEl.empty();
	}

	/** A simple edit whose control already shows the new value. */
	private quietly(fn: () => unknown): void {
		this.ws_quiet++;
		try {
			applyEdit(fn);
		} finally {
			this.ws_quiet--;
		}
	}

	private ws_render(): void {
		const f = this.field;
		if (!f) return;
		const E = this.ws_session.schemaEdits;
		const kind = this.ws_ctx.fieldTypes.for(f);
		this.ws_scope.unload();
		this.ws_scope = new Component();
		this.ws_scope.load();
		const c = this.contentEl;
		const scroll = c.scrollTop;
		c.empty();
		this.setTitle('Field settings');

		// ── identity ────────────────────────────────────────────────────────
		const head = c.createDiv({ cls: 'ws-fm__head' });
		const kindMark = head.createDiv({ cls: 'ws-fm__mark' });
		setIcon(kindMark, kind.icon);
		const headText = head.createDiv({ cls: 'ws-fm__head-text' });
		inlineText(headText, f.label, {
			cls: 'ws-fm__name',
			ariaLabel: 'Field name',
			placeholder: 'Field name',
			onCommit: (v) => this.quietly(() => E.updateField(this.ws_typeId, f.id, { label: v })),
		});
		const kindBtn = headText.createEl('button', { cls: 'ws-fm__kind', attr: { type: 'button', 'aria-haspopup': 'menu' } });
		kindBtn.createSpan({ text: kind.label });
		icon(kindBtn, 'chevrons-up-down');
		kindBtn.addEventListener('click', (evt) => this.ws_kindMenu(evt));

		if (kind.studioNote) {
			const note = c.createDiv({ cls: 'ws-fm__note' });
			icon(note, 'info');
			note.createSpan({ text: kind.studioNote });
		}

		// ── about ───────────────────────────────────────────────────────────
		const about = this.ws_card(c, 'About this field', 'info', 'What it’s for, in a line or two.');
		inlineText(formRow(about, 'Description', 'Shown as a tooltip on the field label.'), f.description ?? '', {
			multiline: true,
			cls: 'ws-fm__desc',
			placeholder: 'What should go here?',
			ariaLabel: 'Description',
			onCommit: (v) => this.quietly(() => E.updateField(this.ws_typeId, f.id, { description: v.trim() })),
		});

		// ── links ───────────────────────────────────────────────────────────
		const schema = this.ws_session.schemas.get(this.ws_typeId);
		if (schema && f.type === 'relation') {
			renderRelationSettings(this.ws_card(c, 'Links', 'link-2', 'Each link is one connection, visible from both entries.', 'ws-fm-links'), this.ws_ctx, this.ws_session, schema, f, () => this.close());
		}
		if (schema && f.type === 'rollup') {
			renderRollupSettings(this.ws_card(c, 'Summary', 'sigma', 'Calculated from linked entries; updates by itself.', 'ws-fm-rollup'), this.ws_ctx, this.ws_session, schema, f);
		}

		// ── choices ─────────────────────────────────────────────────────────
		if (kind.hasOptions) this.ws_choices(c, f);

		// ── kind-specific settings ──────────────────────────────────────────
		if (kind.configFields?.length) {
			const g = this.ws_card(c, `${kind.label} settings`, kind.icon, CONFIG_BLURBS[kind.id] ?? `How a ${kind.label.toLowerCase()} is entered and shown.`, 'ws-fm-config');
			for (const cf of kind.configFields) {
				const cfKind = this.ws_ctx.fieldTypes.for(cf);
				const val = formRow(g, cf.label, cf.description || CONFIG_HINTS[`${kind.id}.${cf.id}`] || CONFIG_HINTS[cf.id]).createDiv({ cls: 'ws-prop__value ws-fm__control' });
				cfKind.ui?.createEditor(val, {
					app: this.app,
					field: cf,
					entity: null,
					component: this.ws_scope,
					value: f.config?.[cf.id],
					onChange: (v) => {
						if (cfKind.isEmpty(v)) return this.quietly(() => E.updateFieldConfig(this.ws_typeId, f.id, { [cf.id]: null }));
						const res = cfKind.coerce(v, cf);
						if (res.ok) this.quietly(() => E.updateFieldConfig(this.ws_typeId, f.id, { [cf.id]: res.value }));
					},
				});
			}
		}

		// ── layout ──────────────────────────────────────────────────────────
		const layout = this.ws_card(c, 'On the page', 'layout-template', 'How much room it takes and what it says when empty.');
		let width: FieldWidth = f.width ?? kind.defaultWidth ?? 'half';
		const widthSlot = formRow(layout, 'Width', 'Of the row it sits in.');
		const paintWidth = () => {
			widthSlot.empty();
			segmented(
				widthSlot,
				[
					{ id: 'full', label: 'Full' },
					{ id: 'half', label: 'Half' },
					{ id: 'third', label: 'Third' },
				],
				width,
				(v) => {
					width = v;
					paintWidth();
					this.quietly(() => E.updateField(this.ws_typeId, f.id, { width: v }));
				},
				'Field width',
			);
		};
		paintWidth();
		if (kind.supportsPlaceholder) {
			inlineText(formRow(layout, 'Placeholder', 'Faint text shown while it’s empty.'), f.placeholder ?? '', {
				cls: 'ws-fm__inline-input',
				placeholder: 'Shown when empty',
				ariaLabel: 'Placeholder',
				onCommit: (v) => this.quietly(() => E.updateField(this.ws_typeId, f.id, { placeholder: v.trim() })),
			});
		}

		// ── behaviour ───────────────────────────────────────────────────────
		const beh = this.ws_card(c, 'Behaviour', 'sliders-horizontal', 'Whether it’s needed, counted, tucked away or hidden.');
		const flags: Array<{ key: 'required' | 'recommended' | 'advanced' | 'hidden'; label: string; hint: string }> = [
			{ key: 'required', label: 'Required', hint: 'Flagged on the entry until it has a value.' },
			{ key: 'recommended', label: 'Counts toward development', hint: 'Included in the development percentage and “Next up”.' },
			{ key: 'advanced', label: 'Tuck under “More fields”', hint: 'Keeps the page clean; still searchable.' },
			{ key: 'hidden', label: 'Hidden', hint: 'Not shown on pages. Data is kept.' },
		];
		for (const fl of flags) {
			const slot = formRow(beh, fl.label, fl.hint);
			slot.parentElement?.addClass('ws-fm__flag');
			let on = !!f[fl.key];
			const sw = slot.createEl('button', { cls: cx('ws-switch', on && 'is-on'), attr: { type: 'button', role: 'switch', 'aria-checked': String(on), 'aria-label': fl.label } });
			sw.createSpan({ cls: 'ws-switch__knob' });
			sw.addEventListener('click', () => {
				on = !on;
				sw.toggleClass('is-on', on);
				sw.setAttr('aria-checked', String(on));
				this.quietly(() => E.updateField(this.ws_typeId, f.id, { [fl.key]: on }));
			});
		}

		// ── default value ───────────────────────────────────────────────────
		if (!kind.computed && kind.ui && kind.category !== 'media') {
			const dv = this.ws_card(c, 'Default value', 'wand-sparkles', 'Filled in automatically for new entries.');
			const slot = formRow(dv, 'New entries start with', 'Leave empty for no default.').createDiv({ cls: 'ws-fm__default ws-prop__value ws-fm__control' });
			kind.ui.createEditor(slot, {
				app: this.app,
				field: { ...f, placeholder: 'No default' },
				entity: null,
				component: this.ws_scope,
				value: f.defaultValue,
				onChange: (v) => {
					if (kind.isEmpty(v)) return this.quietly(() => E.updateField(this.ws_typeId, f.id, { defaultValue: undefined }));
					const res = kind.coerce(v, f);
					if (res.ok) this.quietly(() => E.updateField(this.ws_typeId, f.id, { defaultValue: res.value }));
				},
			});
		}

		// ── footer ──────────────────────────────────────────────────────────
		const foot = c.createDiv({ cls: 'ws-fm__foot' });
		const idChip = foot.createEl('button', { cls: 'ws-fm__id', attr: { type: 'button', 'aria-label': 'Copy field id' } });
		idChip.createSpan({ text: 'ID' });
		idChip.createEl('code', { text: f.id });
		idChip.addEventListener('click', () => {
			void navigator.clipboard?.writeText(f.id);
			new Notice('Field id copied.');
		});
		button(foot, { label: 'Delete field', icon: 'trash-2', variant: 'danger', size: 'sm', onClick: () => void this.ws_delete(f) });
		c.scrollTop = scroll;
	}

	/** A settings card (the Type Studio look): tinted mark, title and line, then its rows. */
	private ws_card(parent: HTMLElement, title: string, glyph: string, blurb: string, cls = ''): HTMLElement {
		return studioCard(parent, title, glyph, blurb, `ws-fm__card ${cls}`).body;
	}

	// ── kind change ─────────────────────────────────────────────────────────

	private ws_kindMenu(evt: MouseEvent): void {
		const f = this.field;
		if (!f) return;
		const menu = new Menu();
		for (const group of kindsByCategory(this.ws_ctx.fieldTypes)) {
			menu.addItem((i) => i.setTitle(CATEGORY_LABELS[group.category]).setIsLabel(true));
			for (const k of group.kinds) {
				menu.addItem((i) =>
					i
						.setTitle(k.label)
						.setIcon(k.icon)
						.setChecked(k.id === f.type)
						.onClick(() => void this.ws_changeKind(k.id)),
				);
			}
		}
		menu.showAtMouseEvent(evt);
	}

	private async ws_changeKind(newType: string): Promise<void> {
		const f = this.field;
		if (!f || newType === f.type) return;
		const E = this.ws_session.schemaEdits;
		const to = this.ws_ctx.fieldTypes.for({ ...f, type: newType });
		const p = E.previewTypeChange(this.ws_typeId, f.id, newType);
		if (p.total > 0) {
			const details = [`${p.convertible} of ${p.total} existing value${p.total === 1 ? '' : 's'} convert to ${to.label.toLowerCase()}.`];
			if (p.lost) details.push(`${p.lost} can’t convert and will be kept as unused data on ${p.lost === 1 ? 'its entry' : 'their entries'} (e.g. ${p.examples.map((x) => `“${x}”`).join(', ')}). You can restore or discard them there.`);
			const ok = await confirmModal(this.app, {
				title: `Change “${f.label}” to ${to.label.toLowerCase()}?`,
				details,
				confirmLabel: 'Change kind',
			});
			if (!ok) return;
		}
		const res = applyEdit(() => E.changeFieldType(this.ws_typeId, f.id, newType));
		if (res && (newType === 'relation' || newType === 'rollup')) setupLinkField(this.ws_session, this.ws_typeId, f.id);
		if (res) undoNotice(this.ws_session, `“${f.label}” is now ${to.label.toLowerCase()}.${res.orphaned ? ` ${res.orphaned} value${res.orphaned === 1 ? '' : 's'} kept as unused data.` : ''}`);
	}

	// ── choices ─────────────────────────────────────────────────────────────

	private ws_choices(parent: HTMLElement, f: FieldDefinition): void {
		const E = this.ws_session.schemaEdits;
		const options = selectOptions(f);
		const card = studioCard(parent, 'Choices', 'list', 'Drag to reorder. Click a dot to change its color.', 'ws-fm__card ws-fm-choices');
		card.aside.createSpan({ cls: 'ws-tset__count', text: `${options.length} choice${options.length === 1 ? '' : 's'}` });
		const g = card.body;
		const list = g.createDiv({ cls: 'ws-choices' });
		const save = (next: SelectOption[]) => applyEdit(() => E.setOptions(this.ws_typeId, f.id, next));
		let dragFrom = -1;
		options.forEach((o, idx) => {
			const row = list.createDiv({ cls: 'ws-choice', attr: { draggable: 'true' } });
			const handle = row.createSpan({ cls: 'ws-drag-handle', attr: { 'aria-hidden': 'true' } });
			setIcon(handle, 'grip-vertical');
			const dot = row.createEl('button', { cls: cx('ws-choice__dot', `ws-tint--${o.color ?? 'gray'}`), attr: { type: 'button', 'aria-label': `Color of ${o.label}` } });
			dot.addEventListener('click', (evt) =>
				colorMenu(evt, o.color, (c) => {
					const next = options.map((x) => (x.id === o.id ? { ...x, color: c } : x));
					if (!c) delete next[idx]!.color;
					save(next);
				}),
			);
			inlineText(row, o.label, {
				cls: 'ws-choice__label',
				ariaLabel: 'Choice name',
				onCommit: (v) => {
					if (!v.trim()) return;
					save(options.map((x) => (x.id === o.id ? { ...x, label: v.trim() } : x)));
				},
			});
			const used = E.optionUsage(this.ws_typeId, f.id, o.id);
			row.createSpan({ cls: 'ws-choice__usage', text: used ? `${used} use${used === 1 ? '' : 's'}` : '' });
			const up = row.createEl('button', { cls: 'ws-mini-btn', attr: { type: 'button', 'aria-label': `Move ${o.label} up` } });
			setIcon(up, 'chevron-up');
			up.disabled = idx === 0;
			up.addEventListener('click', () => {
				const next = [...options];
				next.splice(idx - 1, 0, ...next.splice(idx, 1));
				save(next);
			});
			const del = row.createEl('button', { cls: 'ws-mini-btn', attr: { type: 'button', 'aria-label': `Delete ${o.label}` } });
			setIcon(del, 'x');
			del.addEventListener('click', (evt) => {
				if (!used) return void applyEdit(() => E.deleteOption(this.ws_typeId, f.id, o.id, null));
				const menu = new Menu();
				menu.addItem((i) => i.setTitle(`${used} entr${used === 1 ? 'y uses' : 'ies use'} “${o.label}”. Replace with…`).setIsLabel(true));
				for (const other of options.filter((x) => x.id !== o.id)) {
					menu.addItem((i) => i.setTitle(other.label).setIcon('circle').onClick(() => applyEdit(() => E.deleteOption(this.ws_typeId, f.id, o.id, other.id))));
				}
				menu.addSeparator();
				menu.addItem((i) =>
					i.setTitle('Clear the value').setIcon('eraser').setWarning(true).onClick(() => {
						if (applyEdit(() => E.deleteOption(this.ws_typeId, f.id, o.id, null))) undoNotice(this.ws_session, `Deleted “${o.label}”.`);
					}),
				);
				menu.showAtMouseEvent(evt);
			});
			row.addEventListener('dragstart', (e) => {
				dragFrom = idx;
				e.dataTransfer?.setData('text/plain', o.id);
				row.addClass('is-dragging');
			});
			row.addEventListener('dragend', () => row.removeClass('is-dragging'));
			row.addEventListener('dragover', (e) => {
				e.preventDefault();
				row.addClass('is-drop-target');
			});
			row.addEventListener('dragleave', () => row.removeClass('is-drop-target'));
			row.addEventListener('drop', (e) => {
				e.preventDefault();
				row.removeClass('is-drop-target');
				if (dragFrom < 0 || dragFrom === idx) return;
				const next = [...options];
				const [moved] = next.splice(dragFrom, 1);
				if (moved) next.splice(idx, 0, moved);
				save(next);
			});
		});
		if (!options.length) list.createDiv({ cls: 'ws-choices__empty', text: 'No choices yet — add the first one below.' });
		const add = g.createDiv({ cls: 'ws-choice ws-choice--add' });
		const plus = add.createSpan({ cls: 'ws-choice__plus' });
		setIcon(plus, 'plus');
		const input = add.createEl('input', { cls: 'ws-inline ws-choice__label', attr: { type: 'text', placeholder: 'Add a choice and press Enter', 'aria-label': 'New choice' } });
		input.addEventListener('keydown', (e) => {
			if (e.key !== 'Escape') e.stopPropagation();
			if (e.key !== 'Enter') return;
			e.preventDefault();
			const label = input.value.trim();
			if (!label) return;
			if (options.some((o) => o.label.toLowerCase() === label.toLowerCase())) {
				new Notice('That choice already exists.');
				return;
			}
			const opt = E.newOption(this.ws_typeId, f.id, label);
			if (save([...options, opt])) {
				window.setTimeout(() => (this.contentEl.querySelector('.ws-choice--add input'))?.focus(), 0);
			}
		});
	}

	// ── delete ──────────────────────────────────────────────────────────────

	private async ws_delete(f: FieldDefinition): Promise<void> {
		if (await confirmDeleteField(this.ws_ctx, this.ws_session, this.ws_typeId, f)) this.close();
	}
}
