import { Keymap, Menu, setIcon, setTooltip, type PaneType } from 'obsidian';
import type { WorldsmithContext } from '../../app/context';
import type { DevTask, EntityRecord } from '../../core/types';
import { TASK_PRIORITIES, TASK_STATUSES } from '../../core/types';
import { dueLabel, today } from '../../core/util/dates';
import type { WorldSession } from '../../services/WorldSession';
import { ROUTES, type Route } from '../../state/route';
import { avatar } from '../components/avatar';
import { openDatePopover } from '../components/datePicker';
import { cx } from '../components/dom';
import { actionNotice } from '../components/notice';
import { TaskModal } from './TaskModal';

export interface TaskUiHost {
	ws: WorldsmithContext;
	session: WorldSession;
	navigate(route: Route, newLeaf?: boolean | PaneType): void;
}

export function isOverdue(t: DevTask, now = today()): boolean {
	return t.status !== 'done' && !!t.due && t.due < now;
}

/** Due date chip; click to change the date. */
export function dueChip(parent: HTMLElement, host: TaskUiHost, t: DevTask, opts: { editable?: boolean; empty?: string } = {}): HTMLElement {
	const now = today();
	const chip = parent.createEl(opts.editable === false ? 'span' : 'button', {
		cls: cx('ws-due', !t.due && 'is-empty', t.due === now && t.status !== 'done' && 'is-today', isOverdue(t, now) && 'is-over', t.status === 'done' && 'is-done'),
		text: t.due ? dueLabel(t.due, now) : (opts.empty ?? ''),
		attr: opts.editable === false ? {} : { type: 'button', 'aria-label': t.due ? `Due ${t.due}. Change date` : 'Set a due date' },
	});
	if (!t.due && opts.empty === undefined) setIcon(chip, 'calendar-plus');
	if (t.repeat) {
		const r = chip.createSpan({ cls: 'ws-due__repeat' });
		setIcon(r, 'repeat');
	}
	if (opts.editable !== false) {
		chip.addEventListener('click', (e) => {
			e.stopPropagation();
			openDatePopover(chip, {
				value: t.due,
				marked: (d) => host.session.tasks.all().some((x) => x.due === d && x.status !== 'done'),
				onPick: (d) => host.session.tasks.update(t.id, { due: d }),
			});
		});
	}
	return chip;
}

export function priorityFlag(parent: HTMLElement, priority: number): HTMLElement | null {
	if (!priority) return null;
	const f = parent.createSpan({ cls: cx('ws-prio', `ws-prio--${priority}`), attr: { 'aria-label': `${TASK_PRIORITIES[priority]?.label} priority` } });
	setIcon(f, 'flag');
	setTooltip(f, `${TASK_PRIORITIES[priority]?.label} priority`, { delay: 300 });
	return f;
}

export function checkbox(parent: HTMLElement, host: TaskUiHost, t: DevTask): HTMLElement {
	const box = parent.createEl('button', {
		cls: cx('ws-task-check', t.status === 'done' && 'is-done', t.status === 'blocked' && 'is-blocked', t.status === 'in-progress' && 'is-progress'),
		attr: { type: 'button', role: 'checkbox', 'aria-checked': String(t.status === 'done'), 'aria-label': t.status === 'done' ? `Mark “${t.title}” not done` : `Complete “${t.title}”` },
	});
	if (t.status === 'done') setIcon(box, 'check');
	box.addEventListener('click', (e) => {
		e.stopPropagation();
		host.session.tasks.toggleDone(t.id);
	});
	return box;
}

export function entityLink(parent: HTMLElement, host: TaskUiHost, e: EntityRecord, size: 'xs' | 'sm' = 'xs'): HTMLElement {
	const el = parent.createEl('button', { cls: 'ws-task-ent', attr: { type: 'button' } });
	avatar(el, host.ws.app, e, host.session.schemas.get(e.typeId), { size });
	el.createSpan({ text: e.name });
	el.addEventListener('click', (evt) => {
		evt.stopPropagation();
		host.navigate(ROUTES.entity(e.id), Keymap.isModEvent(evt) ? 'tab' : false);
	});
	return el;
}

/** Right-click menu for a task anywhere. */
export function taskMenu(host: TaskUiHost, t: DevTask): Menu {
	const T = host.session.tasks;
	const m = new Menu();
	m.addItem((i) => i.setTitle('Open task…').setIcon('square-pen').onClick(() => new TaskModal(host, t.id).open()));
	if (t.entityId) {
		const e = host.session.entities.get(t.entityId);
		if (e) m.addItem((i) => i.setTitle(`Open ${e.name}`).setIcon('arrow-up-right').onClick(() => host.navigate(ROUTES.entity(e.id))));
	}
	m.addSeparator();
	for (const st of TASK_STATUSES) m.addItem((i) => i.setTitle(st.label).setChecked(t.status === st.id).onClick(() => T.setStatus(t.id, st.id)));
	m.addSeparator();
	for (const p of [...TASK_PRIORITIES].reverse()) m.addItem((i) => i.setTitle(`Priority: ${p.label}`).setChecked(t.priority === p.id).onClick(() => T.update(t.id, { priority: p.id })));
	m.addSeparator();
	m.addItem((i) =>
		i
			.setTitle('Delete task')
			.setIcon('trash-2')
			.setWarning(true)
			.onClick(() => deleteTask(host, t)),
	);
	return m;
}

export function deleteTask(host: TaskUiHost, t: DevTask): void {
	const removed = host.session.tasks.remove([t.id]);
	if (removed.length) actionNotice(`Deleted “${t.title}”.`, { label: 'Undo', run: () => host.session.tasks.restore(removed) });
}

/**
 * One task as a row: checkbox, title, (entry), category, priority, due. Click opens the
 * task; right-click for the menu.
 */
export function taskRow(parent: HTMLElement, host: TaskUiHost, t: DevTask, o: { showEntity?: boolean; showCategory?: boolean } = {}): HTMLElement {
	const row = parent.createDiv({
		cls: cx('ws-task', t.status === 'done' && 'is-done', t.optional && 'is-optional', isOverdue(t) && 'is-over'),
		attr: { role: 'listitem', tabindex: '0', 'data-task': t.id },
	});
	checkbox(row, host, t);
	const text = row.createDiv({ cls: 'ws-task__text' });
	text.createDiv({ cls: 'ws-task__title', text: t.title });
	const meta = text.createDiv({ cls: 'ws-task__meta' });
	const e = t.entityId ? host.session.entities.get(t.entityId) : undefined;
	if (o.showEntity !== false && e) entityLink(meta, host, e);
	if (o.showCategory && t.category) meta.createSpan({ cls: 'ws-task__cat', text: t.category });
	if (t.optional) meta.createSpan({ cls: 'ws-task__cat', text: 'Optional' });
	if (t.status === 'blocked' || t.status === 'in-progress') {
		const st = TASK_STATUSES.find((x) => x.id === t.status);
		meta.createSpan({ cls: cx('ws-task__status', `ws-tint--${st?.color ?? 'gray'}`), text: st?.label ?? '' });
	}
	if (!meta.childElementCount) meta.remove();
	priorityFlag(row, t.priority);
	dueChip(row, host, t);
	row.addEventListener('click', () => new TaskModal(host, t.id).open());
	row.addEventListener('keydown', (evt) => {
		if (evt.target !== row) return;
		if (evt.key === 'Enter') new TaskModal(host, t.id).open();
		else if (evt.key === ' ') {
			evt.preventDefault();
			host.session.tasks.toggleDone(t.id);
		}
	});
	row.addEventListener('contextmenu', (evt) => {
		evt.preventDefault();
		taskMenu(host, t).showAtMouseEvent(evt);
	});
	return row;
}
