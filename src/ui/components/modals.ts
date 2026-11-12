import { releaseTooltips, watchTooltips } from './tooltips';
import { App, FuzzySuggestModal, Modal, Notice, TFile, getIconIds, setIcon, type FuzzyMatch } from 'obsidian';
import type { EntitySchema } from '../../core/types';
import { button, icon, cx, nameRegion } from './dom';

/** Every Worldsmith modal carries the scoped root class. */
export abstract class WorldsmithModal extends Modal {
	constructor(app: App) {
		super(app);
		this.modalEl.addClass('worldsmith-modal');
		watchTooltips(this.modalEl);
	}

	override close(): void {
		releaseTooltips(this.modalEl.ownerDocument);
		super.close();
	}
}

// ── confirm ───────────────────────────────────────────────────────────────────

export interface ConfirmOptions {
	title: string;
	body?: string;
	/** Bullet points shown in a warning box (e.g. what a delete affects). */
	details?: string[];
	confirmLabel: string;
	danger?: boolean;
}

export function confirmModal(app: App, o: ConfirmOptions): Promise<boolean> {
	return new Promise((resolve) => {
		let decided = false;
		const modal = new (class extends WorldsmithModal {
			override onOpen() {
				this.setTitle(o.title);
				const c = this.contentEl.createDiv({ cls: 'ws-confirm' });
				if (o.body) c.createEl('p', { cls: 'ws-confirm__body', text: o.body });
				if (o.details?.length) {
					const box = c.createDiv({ cls: 'ws-confirm__details' });
					icon(box, 'alert-triangle', 'ws-confirm__details-icon');
					const ul = box.createEl('ul');
					for (const d of o.details) ul.createEl('li', { text: d });
				}
				const row = c.createDiv({ cls: 'ws-modal-actions' });
				const cancel = button(row, { label: 'Cancel', variant: 'ghost', onClick: () => this.close() });
				const ok = button(row, {
					label: o.confirmLabel,
					variant: o.danger ? 'danger' : 'primary',
					onClick: () => {
						decided = true;
						resolve(true);
						this.close();
					},
				});
				// Enter never deletes by accident: a delete starts on Cancel.
				window.setTimeout(() => (o.danger ? cancel : ok).focus(), 0);
			}
			override onClose() {
				if (!decided) resolve(false);
				this.contentEl.empty();
			}
		})(app);
		modal.open();
	});
}

// ── prompt ────────────────────────────────────────────────────────────────────

export function promptModal(
	app: App,
	o: { title: string; label?: string; value?: string; placeholder?: string; confirmLabel?: string },
): Promise<string | null> {
	return new Promise((resolve) => {
		let done = false;
		new (class extends WorldsmithModal {
			override onOpen() {
				this.setTitle(o.title);
				const form = this.contentEl.createEl('form', { cls: 'ws-form' });
				const input = labeledInput(form, o.label ?? '', o.value ?? '', o.placeholder);
				const row = form.createDiv({ cls: 'ws-modal-actions' });
				button(row, { label: 'Cancel', variant: 'ghost', onClick: () => this.close() });
				const submit = button(row, { label: o.confirmLabel ?? 'Save', variant: 'primary' });
				submit.type = 'submit';
				form.addEventListener('submit', (e) => {
					e.preventDefault();
					done = true;
					resolve(input.value);
					this.close();
				});
				window.setTimeout(() => {
					input.focus();
					input.select();
				}, 0);
			}
			override onClose() {
				if (!done) resolve(null);
				this.contentEl.empty();
			}
		})(app).open();
	});
}

export function labeledInput(parent: HTMLElement, label: string, value: string, placeholder?: string): HTMLInputElement {
	const wrap = parent.createEl('label', { cls: 'ws-form__field' });
	if (label) wrap.createSpan({ cls: 'ws-form__label', text: label });
	const input = wrap.createEl('input', { cls: 'ws-input', attr: { type: 'text', spellcheck: 'false' } });
	input.value = value;
	if (placeholder) input.placeholder = placeholder;
	return input;
}

// ── create entity ─────────────────────────────────────────────────────────────

/**
 * Quick create: pick a type (when not given), type a name, press Enter.
 */
export class CreateEntityModal extends WorldsmithModal {
	private selected: EntitySchema | null;

	constructor(
		app: App,
		private readonly types: EntitySchema[],
		preselected: string | null,
		private readonly onCreate: (typeId: string, name: string) => void,
		private readonly onNewType?: () => void,
	) {
		super(app);
		this.selected = types.find((t) => t.id === preselected) ?? null;
		this.modalEl.addClass('ws-create-modal');
	}

	override onOpen(): void {
		this.render();
	}

	private render(): void {
		const c = this.contentEl;
		c.empty();
		if (!this.selected) {
			this.setTitle('Create…');
			const grid = c.createDiv({ cls: 'ws-type-grid', attr: { role: 'listbox'} });
			nameRegion(grid, 'Entity types' );
			for (const t of this.types) {
				const item = grid.createEl('button', {
					cls: cx('ws-type-grid__item', t.color ? `ws-tint--${t.color}` : ''),
					attr: { type: 'button', role: 'option' },
				});
				icon(item, t.icon, 'ws-type-grid__icon');
				item.createSpan({ cls: 'ws-type-grid__label', text: t.singular });
				item.addEventListener('click', () => {
					this.selected = t;
					this.render();
				});
			}
			if (this.onNewType) {
				const item = grid.createEl('button', { cls: 'ws-type-grid__item ws-type-grid__item--new', attr: { type: 'button' } });
				icon(item, 'plus', 'ws-type-grid__icon');
				item.createSpan({ cls: 'ws-type-grid__label', text: 'New type…' });
				item.addEventListener('click', () => {
					this.close();
					this.onNewType?.();
				});
			}
			window.setTimeout(() => (grid.querySelector('button'))?.focus(), 0);
			return;
		}

		const t = this.selected;
		this.setTitle(`New ${t.singular.toLowerCase()}`);
		const form = c.createEl('form', { cls: 'ws-form' });
		const head = form.createDiv({ cls: cx('ws-create-modal__type', t.color ? `ws-tint--${t.color}` : '') });
		icon(head, t.icon);
		head.createSpan({ text: t.singular });
		if (this.types.length > 1) {
			const change = head.createEl('button', { cls: 'ws-link-btn', text: 'Change', attr: { type: 'button' } });
			change.addEventListener('click', () => {
				this.selected = null;
				this.render();
			});
		}
		const input = labeledInput(form, 'Name', '', `Name your ${t.singular.toLowerCase()}`);
		const row = form.createDiv({ cls: 'ws-modal-actions' });
		button(row, { label: 'Cancel', variant: 'ghost', onClick: () => this.close() });
		const submit = button(row, { label: `Create ${t.singular.toLowerCase()}`, variant: 'primary' });
		submit.type = 'submit';
		form.addEventListener('submit', (e) => {
			e.preventDefault();
			this.close();
			this.onCreate(t.id, input.value);
		});
		window.setTimeout(() => input.focus(), 0);
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}

// ── new type ──────────────────────────────────────────────────────────────────

// ── pickers ───────────────────────────────────────────────────────────────────

export class NotePickerModal extends FuzzySuggestModal<TFile> {
	constructor(
		app: App,
		private readonly onPick: (file: TFile) => void,
	) {
		super(app);
		this.modalEl.addClass('worldsmith-modal');
		this.setPlaceholder('Link an existing note…');
	}
	getItems(): TFile[] {
		return this.app.vault.getMarkdownFiles().sort((a, b) => b.stat.mtime - a.stat.mtime);
	}
	getItemText(f: TFile): string {
		return f.path;
	}
	onChooseItem(f: TFile): void {
		this.onPick(f);
	}
}

/** Pick any Lucide icon bundled with Obsidian. */
export class IconPickerModal extends FuzzySuggestModal<string> {
	constructor(
		app: App,
		private readonly onPick: (id: string) => void,
	) {
		super(app);
		this.modalEl.addClass('worldsmith-modal', 'ws-icon-picker');
		this.setPlaceholder('Search icons…');
		this.limit = 120;
	}
	getItems(): string[] {
		return getIconIds().map((id) => id.replace(/^lucide-/, ''));
	}
	getItemText(id: string): string {
		return id.replace(/-/g, ' ');
	}
	override renderSuggestion(item: FuzzyMatch<string>, el: HTMLElement): void {
		el.addClass('ws-icon-picker__item');
		const i = el.createSpan({ cls: 'ws-icon-picker__glyph' });
		setIcon(i, item.item);
		el.createSpan({ text: item.item.replace(/-/g, ' ') });
	}
	onChooseItem(id: string): void {
		this.onPick(id);
	}
}

// ── diagnostics ───────────────────────────────────────────────────────────────

/** Shows a read-only text report with a Copy button. */
export class ReportModal extends WorldsmithModal {
	constructor(
		app: App,
		private readonly ws_title: string,
		private readonly ws_intro: string,
		private readonly ws_text: string,
	) {
		super(app);
		this.modalEl.addClass('ws-report-modal');
	}

	override onOpen(): void {
		this.setTitle(this.ws_title);
		this.contentEl.createEl('p', { cls: 'ws-confirm__body', text: this.ws_intro });
		const area = this.contentEl.createEl('textarea', { cls: 'ws-input ws-report', attr: { readonly: 'true', rows: '14', spellcheck: 'false' } });
		area.value = this.ws_text;
		const actions = this.contentEl.createDiv({ cls: 'ws-modal-actions' });
		button(actions, { label: 'Close', variant: 'ghost', onClick: () => this.close() });
		button(actions, {
			label: 'Copy report',
			icon: 'copy',
			variant: 'primary',
			onClick: () => {
				void navigator.clipboard.writeText(this.ws_text).then(
					() => new Notice('Report copied.'),
					() => {
						area.select();
						new Notice('Select the text and copy it manually.');
					},
				);
			},
		});
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
