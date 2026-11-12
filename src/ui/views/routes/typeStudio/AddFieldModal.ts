import type { App } from 'obsidian';
import type { EntitySchema, FieldDefinition } from '../../../../core/types';
import type { FieldTypeRegistry } from '../../../../fields/FieldTypeRegistry';
import { button, cx, icon, nameRegion } from '../../../components/dom';
import { WorldsmithModal } from '../../../components/modals';
import { CATEGORY_LABELS, formRow, KIND_HINTS, kindsByCategory, studioCard } from './common';

/**
 * Name a field and pick its kind. Kinds are grouped and described in plain language;
 * the section can be chosen here too.
 */
export class AddFieldModal extends WorldsmithModal {
	private ws_kind = 'text';
	private ws_section: string | null;

	constructor(
		app: App,
		private readonly ws_schema: EntitySchema,
		private readonly ws_fieldTypes: FieldTypeRegistry,
		sectionId: string | null,
		private readonly ws_onCreate: (input: { label: string; type: string; sectionId: string | null }) => FieldDefinition | undefined,
	) {
		super(app);
		this.ws_section = sectionId ?? ws_schema.sections[0]?.id ?? null;
		this.modalEl.addClass('ws-add-field-modal');
		this.contentEl.addClass('ws-fm');
	}

	override onOpen(): void {
		this.setTitle(`Add a field to ${this.ws_schema.plural}`);
		const form = this.contentEl.createEl('form', { cls: 'ws-form ws-fm__form' });
		const named = studioCard(form, 'Name', 'text-cursor-input', 'What the field is called on every page.', 'ws-fm__card');
		const name = formRow(named.body, 'Field name', 'You can rename it later.').createEl('input', { cls: 'ws-input', attr: { type: 'text', placeholder: 'e.g. Signature weapon', spellcheck: 'false', 'aria-label': 'Field name' } });

		const kinds = studioCard(form, 'Kind', 'shapes', 'What it holds. Double-click one to add it straight away.', 'ws-fm__card ws-fm-kinds');
		const chosen = kinds.aside.createSpan({ cls: 'ws-tset__count ws-fm__chosen' });
		const all = kindsByCategory(this.ws_fieldTypes).flatMap((g) => g.kinds);
		const showChosen = () => chosen.setText(all.find((k) => k.id === this.ws_kind)?.label ?? '');
		showChosen();
		const grid = kinds.body.createDiv({ cls: 'ws-kind-grid', attr: { role: 'radiogroup'} });
		nameRegion(grid, 'Field kind' );
		const buttons: HTMLButtonElement[] = [];
		for (const group of kindsByCategory(this.ws_fieldTypes)) {
			grid.createDiv({ cls: 'ws-kind-grid__group', text: CATEGORY_LABELS[group.category] });
			for (const k of group.kinds) {
				const b = grid.createEl('button', {
					cls: cx('ws-kind', k.id === this.ws_kind && 'is-active', k.studioNote && 'is-soon'),
					attr: { type: 'button', role: 'radio', 'aria-checked': String(k.id === this.ws_kind), 'data-kind': k.id },
				});
				icon(b, k.icon, 'ws-kind__icon');
				const t = b.createDiv({ cls: 'ws-kind__text' });
				t.createDiv({ cls: 'ws-kind__label', text: k.label });
				t.createDiv({ cls: 'ws-kind__hint', text: k.studioNote ? 'Coming in a later update' : (KIND_HINTS[k.id] ?? '') });
				b.addEventListener('click', () => {
					this.ws_kind = k.id;
					for (const x of buttons) {
						const on = x.dataset.kind === k.id;
						x.toggleClass('is-active', on);
						x.setAttr('aria-checked', String(on));
					}
					showChosen();
				});
				b.addEventListener('dblclick', () => form.requestSubmit());
				buttons.push(b);
			}
		}

		if (this.ws_schema.sections.length) {
			const where = studioCard(form, 'Where it goes', 'layout-list', `The section of the ${this.ws_schema.singular.toLowerCase()} page it’s added to.`, 'ws-fm__card');
			const sel = formRow(where.body, 'Section', 'Fields can be moved between sections later.').createEl('select', { cls: 'ws-input dropdown ws-fm__select', attr: { 'aria-label': 'Section' } });
			for (const s of this.ws_schema.sections) sel.createEl('option', { text: s.label, value: s.id });
			sel.createEl('option', { text: 'No section (Other)', value: '' });
			sel.value = this.ws_section ?? '';
			sel.addEventListener('change', () => (this.ws_section = sel.value || null));
		}

		const actions = form.createDiv({ cls: 'ws-modal-actions' });
		button(actions, { label: 'Cancel', variant: 'ghost', onClick: () => this.close() });
		const submit = button(actions, { label: 'Add field', icon: 'plus', variant: 'primary' });
		submit.type = 'submit';
		form.addEventListener('submit', (e) => {
			e.preventDefault();
			const label = name.value.trim();
			if (!label) {
				name.addClass('is-invalid');
				name.focus();
				return;
			}
			const created = this.ws_onCreate({ label, type: this.ws_kind, sectionId: this.ws_section });
			if (created) this.close();
		});
		window.setTimeout(() => name.focus(), 0);
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
