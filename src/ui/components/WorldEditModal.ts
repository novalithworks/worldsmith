import { setIcon } from 'obsidian';
import type { WorldsmithContext } from '../../app/context';
import type { BannerRef } from '../../core/types';
import { vaultImage } from '../../fields/ui/media';
import { button, icon } from './dom';
import { IconPickerModal, WorldsmithModal, labeledInput } from './modals';
import { imageDropTarget } from '../media/drop';
import { ImageBrowser } from '../media/ImageBrowser';
import { adjustBanner } from '../media/ImageAdjust';

export interface WorldFormValue {
	name: string;
	description: string;
	icon: string;
	banner: BannerRef | null;
}

/** World name, description, icon and banner — used for editing an existing world. */
export class WorldEditModal extends WorldsmithModal {
	private ws_value: WorldFormValue;

	constructor(
		private readonly ws: WorldsmithContext,
		initial: Partial<WorldFormValue>,
		private readonly ws_heading: string,
		private readonly ws_confirmLabel: string,
		private readonly ws_onSubmit: (v: WorldFormValue) => void,
	) {
		super(ws.app);
		this.ws_value = { name: initial.name ?? '', description: initial.description ?? '', icon: initial.icon ?? 'globe-2', banner: initial.banner ?? null };
	}

	override onOpen(): void {
		this.setTitle(this.ws_heading);
		const form = this.contentEl.createEl('form', { cls: 'ws-form' });
		renderWorldFields(this.ws, form, this.ws_value);
		const actions = form.createDiv({ cls: 'ws-modal-actions' });
		button(actions, { label: 'Cancel', variant: 'ghost', onClick: () => this.close() });
		const submit = button(actions, { label: this.ws_confirmLabel, variant: 'primary' });
		submit.type = 'submit';
		const msg = form.createDiv({ cls: 'ws-form__msg', attr: { role: 'alert' } });
		form.addEventListener('submit', (e) => {
			e.preventDefault();
			if (!this.ws_value.name.trim()) {
				msg.setText('Give the world a name first.');
				form.addClass('is-invalid');
				form.querySelector<HTMLInputElement>('input[type="text"], input:not([type])')?.focus();
				return;
			}
			this.close();
			this.ws_onSubmit({ ...this.ws_value, name: this.ws_value.name.trim(), description: this.ws_value.description.trim() });
		});
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}

/** Shared world fields (also used by onboarding). Mutates `value` in place. */
export function renderWorldFields(ws: WorldsmithContext, parent: HTMLElement, value: WorldFormValue): { focus(): void } {
	const app = ws.app;
	const bannerSlot = parent.createDiv({ cls: 'ws-world-form__banner' });
	const pick = () =>
		new ImageBrowser(ws, {
			title: 'Choose a world banner',
			current: value.banner?.path,
			onPick: ([f]) => {
				if (!f) return;
				value.banner = { ...(value.banner ?? { focalY: 0.5, height: 240 }), path: f.path };
				paintBanner();
			},
		}).open();
	const paintBanner = () => {
		bannerSlot.empty();
		const btn = bannerSlot.createEl('button', { cls: 'ws-world-form__banner-btn', attr: { type: 'button' } });
		btn.addEventListener('click', pick);
		if (value.banner) {
			const b = value.banner;
			vaultImage(btn, app, b, 'ws-world-form__banner-img');
			btn.setAttr('aria-label', 'Change banner');
			const tools = bannerSlot.createDiv({ cls: 'ws-world-form__banner-tools' });
			const adj = tools.createEl('button', { cls: 'ws-world-form__banner-tool', attr: { type: 'button', 'aria-label': 'Adjust banner' } });
			setIcon(adj, 'crop');
			adj.addEventListener('click', () =>
				adjustBanner(ws, b, (r) => {
					value.banner = r;
					paintBanner();
				}),
			);
			const rm = tools.createEl('button', { cls: 'ws-world-form__banner-tool', attr: { type: 'button', 'aria-label': 'Remove banner' } });
			setIcon(rm, 'x');
			rm.addEventListener('click', () => {
				value.banner = null;
				paintBanner();
			});
		} else {
			icon(btn, 'image-plus');
			btn.createSpan({ text: 'Add a banner image — or drop one here' });
		}
	};
	imageDropTarget(bannerSlot, ws, {
		label: 'Drop to use as the banner',
		single: true,
		onImages: ([f]) => {
			if (!f) return;
			value.banner = { ...(value.banner ?? { focalY: 0.5, height: 240 }), path: f.path };
			paintBanner();
		},
	});
	paintBanner();

	const row = parent.createDiv({ cls: 'ws-form__row' });
	const iconBtn = row.createEl('button', { cls: 'ws-icon-pick', attr: { type: 'button', 'aria-label': 'Choose world icon' } });
	const paintIcon = () => {
		iconBtn.empty();
		setIcon(iconBtn, value.icon);
	};
	paintIcon();
	iconBtn.addEventListener('click', () =>
		new IconPickerModal(app, (id) => {
			value.icon = id;
			paintIcon();
		}).open(),
	);
	const name = labeledInput(row, 'World name', value.name, 'The Ashen Crown');
	name.addEventListener('input', () => (value.name = name.value));

	const wrap = parent.createEl('label', { cls: 'ws-form__field' });
	wrap.createSpan({ cls: 'ws-form__label', text: 'Description' });
	const desc = wrap.createEl('textarea', { cls: 'ws-input ws-input--area', attr: { rows: '3', placeholder: 'A sentence or two about this world (optional)' } });
	desc.value = value.description;
	desc.addEventListener('input', () => (value.description = desc.value));
	return { focus: () => name.focus() };
}
