import { Menu, Notice } from 'obsidian';
import type { DevTask } from '../../core/types';
import { blockActions } from '../../layouts/renderer/LayoutRenderer';
import { ROUTES } from '../../state/route';
import { button, cx, emptyState } from '../../ui/components/dom';
import { own } from '../../ui/components/lifecycle';
import { NewTaskModal } from '../../ui/tasks/TaskModal';
import { taskRow, type TaskUiHost } from '../../ui/tasks/taskUi';
import type { BlockDefinition } from '../BlockRegistry';
import { currentEntity } from '../util';

/** Show done tasks, remembered per entry for the session. */
const showDone = new Map<string, boolean>();

/**
 * An entry's development checklist: its type's default tasks plus anything added here.
 * Check things off inline, set due dates from the chip, open a task for everything else.
 */
export const checklistBlock: BlockDefinition = {
	id: 'checklist',
	category: 'Basics',
	name: 'Checklist',
	icon: 'list-checks',
	description: 'Development tasks for this entry, with due dates and priorities.',
	surfaces: ['entity'],
	frame: 'card',
	defaultSize: { w: 4, h: 1 },
	defaultConfig: { groupByCategory: true },
	render(ctx) {
		const entity = ctx.entity;
		if (!entity) return;
		const s = ctx.session;
		const T = s.tasks;
		const host: TaskUiHost = { ws: ctx.ws, session: s, navigate: (r, nl) => ctx.navigate(r, nl) };
		const root = ctx.el.createDiv({ cls: 'ws-checklist' });

		const actions = blockActions(ctx.el);
		if (actions) {
			button(actions, { icon: 'plus', variant: 'quiet', size: 'sm', tooltip: 'Add task', onClick: () => addInput?.focus() });
			button(actions, {
				icon: 'more-horizontal',
				variant: 'quiet',
				size: 'sm',
				tooltip: 'Checklist options',
				onClick: (evt) => {
					const e = currentEntity(ctx);
					if (!e) return;
					const m = new Menu();
					m.addItem((i) => i.setTitle(showDone.get(e.id) ? 'Hide done tasks' : 'Show done tasks').setIcon('check-check').onClick(() => {
						showDone.set(e.id, !showDone.get(e.id));
						paint();
					}));
					m.addItem((i) => i.setTitle('New task with details…').setIcon('square-pen').onClick(() => new NewTaskModal(host, { entityId: e.id }).open()));
					const missing = (s.schemas.get(e.typeId)?.defaultTasks ?? []).filter((tpl) => !T.forEntity(e.id).some((t) => t.templateId === tpl.id)).length;
					if (missing) {
						m.addItem((i) => i.setTitle(`Add ${missing} missing default task${missing === 1 ? '' : 's'}`).setIcon('list-plus').onClick(() => {
							const n = T.instantiate(e).length;
							new Notice(`Added ${n} task${n === 1 ? '' : 's'} from the ${s.schemas.get(e.typeId)?.singular ?? ''} checklist.`);
						}));
					}
					m.addSeparator();
					m.addItem((i) => i.setTitle('Open the Tasks page').setIcon('list-checks').onClick(() => ctx.navigate(ROUTES.tasks())));
					m.addItem((i) => i.setTitle('Edit the default checklist').setIcon('shapes').onClick(() => ctx.navigate(ROUTES.typeStudio(e.typeId, { tab: 'checklist' }))));
					m.showAtMouseEvent(evt);
				},
			});
		}

		let addInput: HTMLInputElement | null = null;
		const paint = () => {
			const e = currentEntity(ctx);
			if (!e) return;
			const focused = root.ownerDocument.activeElement === addInput;
			root.empty();
			const tasks = T.forEntity(e.id);
			const counted = tasks.filter((t) => !t.optional || s.world.progress.includeOptional);
			const done = counted.filter((t) => t.status === 'done').length;
			ctx.setTitle(tasks.length ? `Checklist · ${done}/${counted.length}` : 'Checklist');
			if (counted.length) {
				const bar = root.createDiv({ cls: 'ws-bar ws-checklist__bar', attr: { 'aria-label': `${done} of ${counted.length} done` } });
				bar.createDiv({ cls: 'ws-bar__fill' }).style.width = `${Math.round((done / counted.length) * 100)}%`;
			}
			const open = tasks.filter((t) => t.status !== 'done');
			const finished = tasks.filter((t) => t.status === 'done');
			if (!tasks.length) {
				emptyState(root, { icon: 'list-checks', title: 'No tasks yet', body: 'Add what this entry still needs — they show up on the Tasks page and calendar too.', compact: true });
			}
			const list = root.createDiv({ cls: 'ws-checklist__list', attr: { role: 'list' } });
			const group = ctx.config.groupByCategory !== false;
			let lastCat: string | null = null;
			const ordered = group ? [...open].sort((a, b) => catKey(a).localeCompare(catKey(b)) || a.order - b.order) : open;
			for (const t of ordered) {
				if (group && t.category !== lastCat && ordered.some((x) => x.category)) {
					list.createDiv({ cls: 'ws-checklist__cat', text: t.category || 'Other' });
					lastCat = t.category;
				}
				taskRow(list, host, t, { showEntity: false });
			}
			if (open.length === 0 && tasks.length) list.createDiv({ cls: 'ws-checklist__all-done', text: 'Everything here is done. ✦' });

			// Quick add
			const add = root.createDiv({ cls: 'ws-checklist__add' });
			addInput = add.createEl('input', { cls: 'ws-checklist__input', attr: { type: 'text', placeholder: 'Add a task and press Enter', 'aria-label': 'New task' } });
			addInput.addEventListener('keydown', (ev) => {
				if (ev.key !== 'Enter' || !addInput?.value.trim()) return;
				ev.preventDefault();
				T.create({ title: addInput.value, entityId: e.id });
				addInput.value = '';
			});
			if (focused) addInput.focus();

			if (finished.length) {
				const on = showDone.get(e.id) ?? false;
				const t = root.createEl('button', { cls: cx('ws-checklist__done-toggle', on && 'is-open'), attr: { type: 'button', 'aria-expanded': String(on) }, text: on ? `Hide ${finished.length} done` : `${finished.length} done` });
				t.addEventListener('click', () => {
					showDone.set(e.id, !on);
					paint();
				});
				if (on) {
					const dl = root.createDiv({ cls: 'ws-checklist__list is-done', attr: { role: 'list' } });
					for (const ft of finished) taskRow(dl, host, ft, { showEntity: false });
				}
			}
		};
		const catKey = (t: DevTask) => (t.category ? `0${t.category}` : '1');

		paint();
		let queued = false;
		const later = () => {
			if (queued) return;
			queued = true;
			window.requestAnimationFrame(() => {
				queued = false;
				paint();
			});
		};
		const mine = (t: DevTask) => t.entityId === entity.id;
		own(ctx.component, s.events.on('task:created', ({ task }) => mine(task) && later()));
		own(ctx.component, s.events.on('task:deleted', ({ task }) => mine(task) && later()));
		own(ctx.component, s.events.on('task:updated', ({ task, prev }) => (mine(task) || mine(prev)) && later()));
		own(ctx.component, s.events.on('world:updated', ({ keys }) => keys.includes('progress') && later()));
	},
};
