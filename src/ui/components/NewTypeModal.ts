import { setIcon, type App } from 'obsidian';
import type { EntityTypeTemplate, SemanticColor } from '../../core/types';
import { STARTER_TYPES } from '../../schemas/starters';
import { pluralOf } from '../../core/util/strings';
import { colorSwatches } from '../views/routes/typeStudio/common';
import { button, cx, icon } from './dom';
import { IconPickerModal, WorldsmithModal, labeledInput } from './modals';

export interface NewTypeValue {
	singular: string;
	plural: string;
	icon: string;
	description: string;
	color: SemanticColor | null;
	/** The starting point, or null for a blank type. */
	starter: EntityTypeTemplate | null;
}

/**
 * New entity type (Milestone 9): pick a starting point — blank, or one of the ready-made
 * types (Vehicles & ships, Spells, Houses…) — see what it comes with, then name it.
 */
export class NewTypeModal extends WorldsmithModal {
	private starter: EntityTypeTemplate | null = null;
	private iconId = 'box';
	private color: SemanticColor | null = null;
	private touched = { singular: false, plural: false, icon: false, color: false };

	constructor(
		app: App,
		private readonly onSubmit: (v: NewTypeValue) => void,
		private readonly o: { onImport?: () => void; hasRelationType?: (id: string) => boolean } = {},
	) {
		super(app);
		this.modalEl.addClass('ws-newtype-modal');
	}

	/** A starter's fields as they'll be created (links whose kind this world lacks are left out). */
	private fieldsOf(t: EntityTypeTemplate) {
		const has = this.o.hasRelationType;
		return t.fields.filter((f) => f.type !== 'relation' || !has || has(String((f.config as { relationType?: string } | undefined)?.relationType ?? '')));
	}

	override onOpen(): void {
		this.setTitle('New entity type');
		const c = this.contentEl;
		c.addClass('ws-newtype');
		const grid = c.createDiv({ cls: 'ws-newtype__grid' });

		// Starting points.
		const pick = grid.createDiv({ cls: 'ws-newtype__pick', attr: { role: 'listbox' } });
		pick.createDiv({ cls: 'ws-newtype__h', text: 'Start from' });
		const list = pick.createDiv({ cls: 'ws-newtype__list' });
		const options: Array<EntityTypeTemplate | null> = [null, ...STARTER_TYPES];
		const items: HTMLElement[] = [];
		options.forEach((t, i) => {
			const it = list.createEl('button', { cls: cx('ws-newtype__item', t?.color && `ws-tint--${t.color}`, !t && 'is-blank'), attr: { type: 'button', role: 'option', 'data-starter': t?.id ?? 'blank' } });
			const g = it.createSpan({ cls: 'ws-newtype__glyph' });
			setIcon(g, t?.icon ?? 'plus');
			const tx = it.createSpan({ cls: 'ws-newtype__text' });
			tx.createSpan({ cls: 'ws-newtype__name', text: t ? t.plural : 'Blank type' });
			tx.createSpan({ cls: 'ws-newtype__desc', text: t ? `${this.fieldsOf(t).length} fields · ${t.sections.length} sections` : 'An overview and notes — add the rest' });
			it.addEventListener('click', () => choose(i));
			items.push(it);
		});
		if (this.o.onImport) {
			const imp = pick.createEl('button', { cls: 'ws-newtype__import', attr: { type: 'button' } });
			icon(imp, 'file-input');
			imp.createSpan({ text: 'Import a type file…' });
			imp.addEventListener('click', () => {
				this.close();
				this.o.onImport?.();
			});
		}

		// Name and look.
		const form = grid.createEl('form', { cls: 'ws-form ws-newtype__form' });
		const row = form.createDiv({ cls: 'ws-form__row' });
		const iconBtn = row.createEl('button', { cls: 'ws-icon-pick', attr: { type: 'button', 'aria-label': 'Choose icon' } });
		const paintIcon = () => {
			iconBtn.empty();
			setIcon(iconBtn, this.iconId);
			iconBtn.className = cx('ws-icon-pick', this.color && `ws-tint--${this.color}`).join(' ');
		};
		iconBtn.addEventListener('click', () =>
			new IconPickerModal(this.app, (id) => {
				this.iconId = id;
				this.touched.icon = true;
				paintIcon();
			}).open(),
		);
		const singular = labeledInput(row, 'Singular name', '', 'Bloodline');
		const plural = labeledInput(form, 'Plural name', '', 'Bloodlines');
		singular.addEventListener('input', () => {
			this.touched.singular = true;
			singular.removeClass('is-invalid');
			if (!this.touched.plural) plural.placeholder = singular.value.trim() ? pluralOf(singular.value) : (this.starter?.plural ?? 'Bloodlines');
		});
		plural.addEventListener('input', () => (this.touched.plural = !!plural.value));
		const description = labeledInput(form, 'Description', '', 'Optional');
		const colorWrap = form.createDiv({ cls: 'ws-form__field' });
		colorWrap.createSpan({ cls: 'ws-form__label', text: 'Color' });
		const swatchHost = colorWrap.createDiv();
		const paintSwatches = () => {
			swatchHost.empty();
			colorSwatches(swatchHost, this.color, (col) => {
				this.color = col;
				this.touched.color = true;
				paintSwatches();
				paintIcon();
			});
		};
		const preview = form.createDiv({ cls: 'ws-newtype__preview' });
		const paintPreview = () => {
			preview.empty();
			const t = this.starter;
			preview.createDiv({ cls: 'ws-newtype__h', text: t ? 'Comes with' : 'Starts with' });
			const secs = t ? t.sections.map((s) => ({ label: s.label, icon: s.icon ?? 'folder', fields: s.fieldIds.map((id) => this.fieldsOf(t).find((f) => f.id === id)?.label).filter(Boolean) as string[] })) : [{ label: 'Overview', icon: 'align-left', fields: ['Overview', 'Notes'] }];
			for (const sec of secs) {
				const r = preview.createDiv({ cls: 'ws-newtype__sec' });
				icon(r, sec.icon);
				const tx = r.createDiv();
				tx.createDiv({ cls: 'ws-newtype__sec-name', text: sec.label });
				tx.createDiv({ cls: 'ws-newtype__sec-fields', text: sec.fields.join(' · ') });
			}
			const n = t?.defaultTasks.length ?? 1;
			const tasks = preview.createDiv({ cls: 'ws-newtype__sec' });
			icon(tasks, 'list-checks');
			tasks.createDiv({ cls: 'ws-newtype__sec-name', text: `A checklist of ${n} task${n === 1 ? '' : 's'}` });
			preview.createDiv({ cls: 'ws-fm__hint', text: 'Everything can be changed in Type Studio afterwards.' });
		};
		const choose = (i: number) => {
			this.starter = options[i] ?? null;
			items.forEach((el, j) => {
				el.toggleClass('is-active', j === i);
				el.setAttr('aria-selected', String(j === i));
			});
			const t = this.starter;
			// Suggest the starter's names and look, without overwriting what was typed.
			if (!this.touched.singular) singular.placeholder = t?.singular ?? 'Bloodline';
			if (!this.touched.plural) plural.placeholder = t?.plural ?? 'Bloodlines';
			if (!this.touched.icon) this.iconId = t?.icon ?? 'box';
			if (!this.touched.color) this.color = t?.color ?? null;
			description.placeholder = t?.description ?? 'Optional';
			paintIcon();
			paintSwatches();
			paintPreview();
		};
		const actions = form.createDiv({ cls: 'ws-modal-actions' });
		button(actions, { label: 'Cancel', variant: 'ghost', onClick: () => this.close() });
		const submit = button(actions, { label: 'Create type', variant: 'primary', cls: 'ws-newtype__create' });
		submit.type = 'submit';
		form.addEventListener('submit', (e) => {
			e.preventDefault();
			const t = this.starter;
			const s = singular.value.trim() || t?.singular || '';
			if (!s) {
				singular.focus();
				singular.addClass('is-invalid');
				return;
			}
			this.close();
			this.onSubmit({
				singular: s,
				plural: plural.value.trim() || (singular.value.trim() ? pluralOf(s) : (t?.plural ?? pluralOf(s))),
				icon: this.iconId,
				description: description.value.trim(),
				color: this.color,
				starter: t,
			});
		});
		// Keyboard: ↑/↓ move through starting points.
		list.addEventListener('keydown', (e) => {
			if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
			e.preventDefault();
			const cur = items.findIndex((x) => x.hasClass('is-active'));
			const next = Math.max(0, Math.min(items.length - 1, cur + (e.key === 'ArrowDown' ? 1 : -1)));
			choose(next);
			items[next]?.focus();
		});
		choose(0);
		window.setTimeout(() => singular.focus(), 0);
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
