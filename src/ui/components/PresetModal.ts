import { App, setIcon } from 'obsidian';
import { button } from './dom';
import { IconPickerModal, labeledInput, WorldsmithModal } from './modals';

export interface PresetDetails {
	name: string;
	icon: string;
	description: string;
}

/** Name, icon and description of a layout preset (new or existing). */
export class PresetModal extends WorldsmithModal {
	private iconId: string;

	constructor(
		app: App,
		private readonly ws_opts: { title: string; submitLabel: string; initial?: Partial<PresetDetails>; hint?: string; onSubmit: (d: PresetDetails) => void },
	) {
		super(app);
		this.modalEl.addClass('ws-preset-modal');
		this.iconId = ws_opts.initial?.icon || 'layout-template';
	}

	override onOpen(): void {
		const o = this.ws_opts;
		this.setTitle(o.title);
		const form = this.contentEl.createEl('form', { cls: 'ws-form ws-preset-form' });
		if (o.hint) form.createEl('p', { cls: 'ws-form__hint', text: o.hint });
		const row = form.createDiv({ cls: 'ws-form__row' });
		const iconBtn = row.createEl('button', { cls: 'ws-icon-pick', attr: { type: 'button', 'aria-label': 'Choose icon' } });
		const paintIcon = () => {
			iconBtn.empty();
			setIcon(iconBtn, this.iconId);
		};
		iconBtn.addEventListener('click', () =>
			new IconPickerModal(this.app, (id) => {
				this.iconId = id;
				paintIcon();
			}).open(),
		);
		paintIcon();
		const name = labeledInput(row, 'Name', o.initial?.name ?? '', 'e.g. Hero sheet');
		const descWrap = form.createEl('label', { cls: 'ws-form__field' });
		descWrap.createSpan({ cls: 'ws-form__label', text: 'Description' });
		const desc = descWrap.createEl('textarea', { cls: 'ws-input ws-preset-form__desc', attr: { rows: '3', placeholder: 'Optional — what it’s good for' } });
		desc.value = o.initial?.description ?? '';

		const actions = form.createDiv({ cls: 'ws-modal-actions' });
		button(actions, { label: 'Cancel', variant: 'ghost', onClick: () => this.close() });
		const submit = button(actions, { label: o.submitLabel, variant: 'primary', cls: 'ws-preset-form__submit' });
		submit.type = 'submit';
		form.addEventListener('submit', (e) => {
			e.preventDefault();
			const value = name.value.trim();
			if (!value) {
				name.addClass('is-invalid');
				name.focus();
				return;
			}
			o.onSubmit({ name: value, icon: this.iconId, description: desc.value.trim() });
			this.close();
		});
		name.addEventListener('input', () => name.removeClass('is-invalid'));
		window.setTimeout(() => {
			name.focus();
			name.select();
		}, 0);
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
