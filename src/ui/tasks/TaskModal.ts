import { Notice, setIcon } from 'obsidian';
import type { DevTask, TaskPriority, TaskRepeat, TaskStatus } from '../../core/types';
import { TASK_PRIORITIES, TASK_STATUSES } from '../../core/types';
import { longDate, type ISODate } from '../../core/util/dates';
import { ROUTES } from '../../state/route';
import { avatar } from '../components/avatar';
import { renderDatePicker } from '../components/datePicker';
import { button, cx } from '../components/dom';
import { EntitySuggestModal } from '../components/EntitySuggestModal';
import { WorldsmithModal } from '../components/modals';
import { actionNotice } from '../components/notice';
import { inlineText, segmented, toggle } from '../views/routes/typeStudio/common';
import type { TaskUiHost } from './taskUi';

const REPEATS: Array<{ id: TaskRepeat | 'none'; label: string }> = [
	{ id: 'none', label: 'Never' },
	{ id: 'daily', label: 'Every day' },
	{ id: 'weekly', label: 'Every week' },
	{ id: 'monthly', label: 'Every month' },
	{ id: 'yearly', label: 'Every year' },
];

function row(parent: HTMLElement, label: string): HTMLElement {
	const r = parent.createDiv({ cls: 'ws-tm__row' });
	r.createDiv({ cls: 'ws-tm__label', text: label });
	return r.createDiv({ cls: 'ws-tm__control' });
}

/** Everything about one task, saved as you go. */
export class TaskModal extends WorldsmithModal {
	private ws_off: Array<{ dispose(): void }> = [];
	private ws_self = 0;

	constructor(
		private readonly ws_host: TaskUiHost,
		private readonly ws_taskId: string,
	) {
		super(ws_host.ws.app);
		this.modalEl.addClass('ws-task-modal');
	}

	private get task(): DevTask | undefined {
		return this.ws_host.session.tasks.get(this.ws_taskId);
	}

	private save(patch: import('../../core/types').TaskPatch): void {
		this.ws_self++;
		try {
			this.ws_host.session.tasks.update(this.ws_taskId, patch);
		} finally {
			this.ws_self--;
		}
	}

	override onOpen(): void {
		const ev = this.ws_host.session.events;
		this.ws_off.push(
			ev.on('task:updated', ({ task }) => task.id === this.ws_taskId && !this.ws_self && this.ws_render()),
			ev.on('task:deleted', ({ task }) => task.id === this.ws_taskId && this.close()),
		);
		this.ws_render();
	}

	override onClose(): void {
		for (const o of this.ws_off) o.dispose();
		this.contentEl.empty();
	}

	private ws_render(): void {
		const t = this.task;
		if (!t) return this.close();
		const host = this.ws_host;
		const S = host.session;
		const c = this.contentEl;
		c.empty();
		this.setTitle('Task');

		// Title + done
		const head = c.createDiv({ cls: 'ws-tm__head' });
		const box = head.createEl('button', {
			cls: cx('ws-task-check', 'ws-task-check--lg', t.status === 'done' && 'is-done'),
			attr: { type: 'button', role: 'checkbox', 'aria-checked': String(t.status === 'done'), 'aria-label': 'Done' },
		});
		if (t.status === 'done') setIcon(box, 'check');
		box.addEventListener('click', () => {
			S.tasks.toggleDone(t.id);
		});
		inlineText(head, t.title, { cls: 'ws-tm__title', ariaLabel: 'Task title', onCommit: (v) => v.trim() && this.save({ title: v }) });

		// Entry
		const ent = c.createDiv({ cls: 'ws-tm__entity' });
		const e = t.entityId ? S.entities.get(t.entityId) : undefined;
		if (e) {
			const link = ent.createEl('button', { cls: 'ws-task-ent', attr: { type: 'button' } });
			avatar(link, host.ws.app, e, S.schemas.get(e.typeId), { size: 'xs' });
			link.createSpan({ text: e.name });
			link.addEventListener('click', () => {
				this.close();
				host.navigate(ROUTES.entity(e.id));
			});
			ent.createSpan({ cls: 'ws-tm__muted', text: S.schemas.get(e.typeId)?.singular ?? '' });
		} else ent.createSpan({ cls: 'ws-tm__muted', text: 'World task (not tied to an entry)' });
		const change = ent.createEl('button', { cls: 'ws-link-btn', text: e ? 'Move to another entry' : 'Attach to an entry', attr: { type: 'button' } });
		change.addEventListener('click', () =>
			new EntitySuggestModal(host.ws.app, S, (picked) => this.save({ entityId: picked.id }), { placeholder: 'Which entry is this task for?' }).open(),
		);
		if (e) {
			const detach = ent.createEl('button', { cls: 'ws-link-btn', text: 'Detach', attr: { type: 'button' } });
			detach.addEventListener('click', () => this.save({ entityId: null }));
		}

		const grid = c.createDiv({ cls: 'ws-tm__grid' });
		segmented(
			row(grid, 'Status'),
			TASK_STATUSES.map((st) => ({ id: st.id, label: st.label })),
			t.status,
			(v) => S.tasks.setStatus(t.id, v),
			'Status',
		);
		segmented(
			row(grid, 'Priority'),
			TASK_PRIORITIES.map((p) => ({ id: String(p.id), label: p.label })),
			String(t.priority),
			(v) => S.tasks.update(t.id, { priority: Number(v) as TaskPriority }),
			'Priority',
		);

		const dueSlot = row(grid, 'Due');
		const dueText = dueSlot.createDiv({ cls: 'ws-tm__due', text: t.due ? longDate(t.due) : 'No date' });
		const pickerSlot = grid.createDiv({ cls: 'ws-tm__picker' });
		renderDatePicker(pickerSlot, {
			value: t.due,
			marked: (d: ISODate) => S.tasks.all().some((x) => x.id !== t.id && x.due === d && x.status !== 'done'),
			onPick: (d) => {
				dueText.setText(d ? longDate(d) : 'No date');
				S.tasks.update(t.id, { due: d });
			},
		});

		const rep = row(grid, 'Repeats').createEl('select', { cls: 'ws-input dropdown', attr: { 'aria-label': 'Repeats' } });
		for (const r of REPEATS) rep.createEl('option', { text: r.label, value: r.id });
		rep.value = t.repeat ?? 'none';
		rep.addEventListener('change', () => {
			if (rep.value !== 'none' && !this.task?.due) new Notice('Repeating tasks repeat from their due date — today is used until you pick one.');
			this.save({ repeat: rep.value === 'none' ? null : (rep.value as TaskRepeat) });
		});

		inlineText(row(grid, 'Category'), t.category, { cls: 'ws-input-like', placeholder: 'e.g. Backstory', ariaLabel: 'Category', onCommit: (v) => this.save({ category: v.trim() }) });
		toggle(row(grid, 'Optional'), t.optional, (v) => S.tasks.update(t.id, { optional: v }), 'Optional — doesn’t count toward development');

		const notes = c.createDiv({ cls: 'ws-tm__notes' });
		notes.createDiv({ cls: 'ws-tm__label', text: 'Notes' });
		inlineText(notes, t.notes, { multiline: true, cls: 'ws-input-like ws-tm__notes-input', placeholder: 'Anything to remember while working on this…', ariaLabel: 'Notes', onCommit: (v) => this.save({ notes: v }) });

		const foot = c.createDiv({ cls: 'ws-tm__foot' });
		foot.createSpan({ cls: 'ws-tm__muted', text: t.completedAt ? `Completed ${new Date(t.completedAt).toLocaleDateString()}` : `Added ${new Date(t.createdAt).toLocaleDateString()}` });
		button(foot, {
			label: 'Delete task',
			icon: 'trash-2',
			variant: 'danger',
			size: 'sm',
			onClick: () => {
				const removed = S.tasks.remove([t.id]);
				this.close();
				actionNotice(`Deleted “${t.title}”.`, { label: 'Undo', run: () => S.tasks.restore(removed) });
			},
		});
	}
}

/** Quick capture: title, optional entry, date and priority. */
export class NewTaskModal extends WorldsmithModal {
	private ws_entityId: string | null;
	private ws_due: ISODate | null;
	private ws_priority: TaskPriority = 0;

	constructor(
		private readonly ws_host: TaskUiHost,
		opts: { entityId?: string | null; due?: ISODate | null } = {},
		private readonly ws_onCreated?: (t: DevTask) => void,
	) {
		super(ws_host.ws.app);
		this.ws_entityId = opts.entityId ?? null;
		this.ws_due = opts.due ?? null;
		this.modalEl.addClass('ws-task-modal');
	}

	override onOpen(): void {
		const S = this.ws_host.session;
		this.setTitle('New task');
		const form = this.contentEl.createEl('form', { cls: 'ws-form' });
		const title = form.createEl('input', { cls: 'ws-input ws-tm__new-title', attr: { type: 'text', placeholder: 'What needs doing?', 'aria-label': 'Task title' } });
		const grid = form.createDiv({ cls: 'ws-tm__grid' });

		const entSlot = row(grid, 'Entry');
		const paintEnt = () => {
			entSlot.empty();
			const e = this.ws_entityId ? S.entities.get(this.ws_entityId) : undefined;
			const b = entSlot.createEl('button', { cls: 'ws-task-ent ws-task-ent--pick', attr: { type: 'button' } });
			if (e) {
				avatar(b, this.app, e, S.schemas.get(e.typeId), { size: 'xs' });
				b.createSpan({ text: e.name });
			} else b.createSpan({ text: 'World task — choose an entry…' });
			b.addEventListener('click', () =>
				new EntitySuggestModal(this.app, S, (picked) => {
					this.ws_entityId = picked.id;
					paintEnt();
				}).open(),
			);
			if (e) {
				const x = entSlot.createEl('button', { cls: 'ws-link-btn', text: 'Clear', attr: { type: 'button' } });
				x.addEventListener('click', () => {
					this.ws_entityId = null;
					paintEnt();
				});
			}
		};
		paintEnt();

		const prioSlot = row(grid, 'Priority');
		const paintPrio = () => {
			prioSlot.empty();
			segmented(
				prioSlot,
				TASK_PRIORITIES.map((p) => ({ id: String(p.id), label: p.label })),
				String(this.ws_priority),
				(v) => {
					this.ws_priority = Number(v) as TaskPriority;
					paintPrio();
				},
				'Priority',
			);
		};
		paintPrio();

		const dueSlot = row(grid, 'Due');
		const dueText = dueSlot.createDiv({ cls: 'ws-tm__due', text: this.ws_due ? longDate(this.ws_due) : 'No date' });
		renderDatePicker(grid.createDiv({ cls: 'ws-tm__picker' }), {
			value: this.ws_due,
			marked: (d) => S.tasks.all().some((x) => x.due === d && x.status !== 'done'),
			onPick: (d) => {
				this.ws_due = d;
				dueText.setText(d ? longDate(d) : 'No date');
			},
		});

		const actions = form.createDiv({ cls: 'ws-modal-actions' });
		button(actions, { label: 'Cancel', variant: 'ghost', onClick: () => this.close() });
		const submit = button(actions, { label: 'Add task', icon: 'plus', variant: 'primary' });
		submit.type = 'submit';
		form.addEventListener('submit', (e) => {
			e.preventDefault();
			if (!title.value.trim()) {
				title.addClass('is-invalid');
				title.focus();
				return;
			}
			const t = S.tasks.create({ title: title.value, entityId: this.ws_entityId, due: this.ws_due, priority: this.ws_priority });
			this.close();
			this.ws_onCreated?.(t);
			new Notice(`Added “${t.title}”${t.due ? ` for ${longDate(t.due)}` : ''}.`);
		});
		window.setTimeout(() => title.focus(), 0);
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
