import { setIcon } from 'obsidian';
import type { WorldsmithContext } from '../../app/context';
import type { DashboardMeta, SemanticColor } from '../../core/types';
import { availableTemplates, templateBlocks, type DashboardTemplate } from '../../layouts/dashboards';
import type { WorldSession } from '../../services/WorldSession';
import { ROUTES } from '../../state/route';
import { button, cx, icon, nameRegion } from '../components/dom';
import { confirmModal, IconPickerModal, labeledInput, WorldsmithModal } from '../components/modals';
import { actionNotice } from '../components/notice';
import { colorSwatches } from '../views/routes/typeStudio/common';

/**
 * Create a dashboard (name, icon, colour, and a template to start from), or edit an
 * existing one's name, icon, colour and description.
 */
export class DashboardModal extends WorldsmithModal {
	private iconId: string;
	private color: SemanticColor | null;
	private template: DashboardTemplate | null;
	private touched = { name: false, icon: false, color: false };

	constructor(
		private readonly ws_ctx: WorldsmithContext,
		private readonly ws_session: WorldSession,
		private readonly ws_opts: { edit?: DashboardMeta; template?: string; onCreated?: (d: DashboardMeta) => void } = {},
	) {
		super(ws_ctx.app);
		this.modalEl.addClass('ws-dash-modal');
		const e = ws_opts.edit;
		const templates = availableTemplates(ws_session);
		this.template = e ? null : (templates.find((t) => t.id === ws_opts.template) ?? templates[0] ?? null);
		this.iconId = e?.icon ?? (this.template && this.template.id !== 'blank' ? this.template.icon : 'layout-dashboard');
		this.color = e ? e.color : (this.template?.color ?? null);
	}

	override onOpen(): void {
		const edit = this.ws_opts.edit;
		this.setTitle(edit ? 'Dashboard settings' : 'New dashboard');
		const form = this.contentEl.createEl('form', { cls: 'ws-form ws-dash-form' });
		if (!edit) form.createEl('p', { cls: 'ws-form__hint', text: 'A page of widgets for one part of your world. It appears under Dashboards in the sidebar.' });

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
		const name = labeledInput(row, 'Name', edit?.name ?? '', this.template && this.template.id !== 'blank' ? this.template.name : 'e.g. Politics');
		name.addEventListener('input', () => (this.touched.name = !!name.value));
		const description = labeledInput(form, 'Description', edit?.description ?? '', 'Optional — shown under the name');

		const colorRow = form.createDiv({ cls: 'ws-form__field' });
		colorRow.createSpan({ cls: 'ws-form__label', text: 'Color' });
		const swatchHost = colorRow.createDiv();
		const paintColor = () => {
			swatchHost.empty();
			colorSwatches(swatchHost, this.color, (c) => {
				this.color = c;
				this.touched.color = true;
				paintColor();
				paintIcon();
			});
		};
		paintColor();
		paintIcon();

		if (!edit) {
			const tplField = form.createDiv({ cls: 'ws-form__field' });
			tplField.createSpan({ cls: 'ws-form__label', text: 'Start from' });
			const grid = tplField.createDiv({ cls: 'ws-dash-tpls', attr: { role: 'radiogroup'} });
			nameRegion(grid, 'Start from' );
			const paintTemplates = () => {
				grid.empty();
				for (const t of availableTemplates(this.ws_session)) {
					const on = this.template?.id === t.id;
					const card = grid.createEl('button', { cls: cx('ws-dash-tpl', on && 'is-active', t.color && `ws-tint--${t.color}`), attr: { type: 'button', role: 'radio', 'aria-checked': String(on), 'data-template': t.id } });
					const head = card.createDiv({ cls: 'ws-dash-tpl__head' });
					icon(head, t.icon, 'ws-dash-tpl__icon');
					head.createSpan({ cls: 'ws-dash-tpl__name', text: t.name });
					const mini = card.createDiv({ cls: 'ws-dash-tpl__mini', attr: { 'aria-hidden': 'true' } });
					const blocks = t.id === 'blank' ? [] : templateBlocks(this.ws_session, t);
					if (!blocks.length) mini.addClass('is-blank');
					for (const b of blocks.slice(0, 14)) {
						const cell = mini.createDiv({ cls: cx('ws-dash-tpl__cell', `is-${b.type}`) });
						cell.style.gridColumn = `${b.x + 1} / span ${b.w}`;
						cell.style.gridRow = `${b.y + 1}`;
					}
					card.createDiv({ cls: 'ws-dash-tpl__blurb', text: t.blurb });
					card.addEventListener('click', () => {
						this.template = t;
						if (!this.touched.icon) this.iconId = t.id === 'blank' ? 'layout-dashboard' : t.icon;
						if (!this.touched.color) this.color = t.color;
						name.placeholder = t.id === 'blank' ? 'e.g. Politics' : t.name;
						paintTemplates();
						paintColor();
						paintIcon();
					});
				}
			};
			paintTemplates();
		}

		const actions = form.createDiv({ cls: 'ws-modal-actions' });
		button(actions, { label: 'Cancel', variant: 'ghost', onClick: () => this.close() });
		const submit = button(actions, { label: edit ? 'Save' : 'Create dashboard', variant: 'primary', cls: 'ws-dash-form__submit' });
		submit.type = 'submit';
		form.addEventListener('submit', (e) => {
			e.preventDefault();
			const s = this.ws_session;
			const value = name.value.trim() || (this.template && this.template.id !== 'blank' ? this.template.name : '');
			if (!value) {
				name.focus();
				name.addClass('is-invalid');
				return;
			}
			if (edit) {
				s.dashboards.update(edit.id, { name: value, icon: this.iconId, color: this.color, description: description.value });
				this.close();
				return;
			}
			const t = this.template;
			const d = s.dashboards.create({ name: value, icon: this.iconId, color: this.color, description: description.value || (t && t.id !== 'blank' && t.id !== 'home' ? t.blurb : ''), blocks: t ? templateBlocks(s, t) : [] });
			this.close();
			this.ws_opts.onCreated?.(d);
		});
		window.setTimeout(() => name.focus(), 0);
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}

/** Create a dashboard, then open it (in Customize when it starts empty). */
export function openNewDashboard(ws: WorldsmithContext, s: WorldSession, navigate: (r: ReturnType<typeof ROUTES.dashboard>) => void, template?: string): void {
	new DashboardModal(ws, s, {
		template,
		onCreated: (d) => {
			const r = ROUTES.dashboard(d.id);
			const empty = !s.layouts.get({ kind: 'dashboard', dashboardId: d.id });
			navigate(empty ? { ...r, params: { ...r.params, edit: '1' } } : r);
		},
	}).open();
}

export async function deleteDashboard(ws: WorldsmithContext, s: WorldSession, meta: DashboardMeta, after?: () => void): Promise<void> {
	const ok = await confirmModal(ws.app, {
		title: `Delete “${meta.name}”?`,
		body: 'The dashboard and its widgets are removed. Your entries, notes and tasks aren’t affected.',
		confirmLabel: 'Delete dashboard',
		danger: true,
	});
	if (!ok) return;
	const removed = s.dashboards.remove(meta.id);
	after?.();
	if (removed) actionNotice(`“${meta.name}” deleted.`, { label: 'Undo', run: () => s.dashboards.restore(removed) });
}
