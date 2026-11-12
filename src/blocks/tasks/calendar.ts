import { Menu, setIcon, setTooltip } from 'obsidian';
import type { DevTask } from '../../core/types';
import { TASK_STATUSES } from '../../core/types';
import { addDays, addMonths, fromISO, longDate, monthGridDays, monthLabel, startOfWeek, today, weekdayShort, type ISODate } from '../../core/util/dates';
import { button, cx, icon, nameRegion } from '../../ui/components/dom';
import { Popover } from '../../ui/components/popover';
import { NewTaskModal, TaskModal } from '../../ui/tasks/TaskModal';
import { isOverdue, taskMenu, taskRow } from '../../ui/tasks/taskUi';
import type { BlockDefinition, BlockRenderContext } from '../BlockRegistry';
import { hostOf, scopedTasks, typesField, watchTasks } from './common';

type View = 'month' | 'week' | 'agenda';
type ColorBy = 'type' | 'priority' | 'status';

/** Where each calendar is looking, remembered for the session. */
const anchors = new Map<string, ISODate>();
const PRIORITY_TINT = ['gray', 'cyan', 'yellow', 'orange', 'red'];

/**
 * Tasks on a real-world calendar: month, week and agenda views. Drag a task to another
 * day to reschedule; click an empty day to add a task due then.
 */
export const taskCalendarBlock: BlockDefinition = {
	id: 'task-calendar',
	name: 'Calendar',
	icon: 'calendar-days',
	description: 'Tasks on their due dates — month, week or agenda. Drag to reschedule.',
	hint: 'Month, week and agenda',
	surfaces: ['tasks'],
	frame: 'plain',
	singleton: false,
	defaultSize: { w: 8, h: 1 },
	defaultConfig: { view: 'month', colorBy: 'type', showDone: true, perDay: 2 },
	configFields: (s) => [
		{ id: 'view', type: 'select', label: 'Starts in', config: { options: [{ id: 'month', label: 'Month' }, { id: 'week', label: 'Week' }, { id: 'agenda', label: 'Agenda' }] } },
		{ id: 'colorBy', type: 'select', label: 'Color tasks by', config: { options: [{ id: 'type', label: 'Entry type' }, { id: 'priority', label: 'Priority' }, { id: 'status', label: 'Status' }] } },
		{ id: 'perDay', type: 'number', label: 'Tasks shown per day (month)', config: { min: 1, max: 6 } },
		{ id: 'showDone', type: 'boolean', label: 'Show completed tasks' },
		typesField(s),
	],
	render(ctx) {
		const s = ctx.session;
		const host = hostOf(ctx);
		const card = ctx.el.createDiv({ cls: 'ws-tcard ws-cal-card' });
		let view: View = (['month', 'week', 'agenda'].includes(ctx.config.view as string) ? ctx.config.view : 'month') as View;
		const key = ctx.instance.id;
		const colorBy = (): ColorBy => (['type', 'priority', 'status'].includes(ctx.config.colorBy as string) ? ctx.config.colorBy : 'type') as ColorBy;
		const ws = () => ctx.ws.settings.weekStart;

		const tint = (t: DevTask): string => {
			if (colorBy() === 'priority') return PRIORITY_TINT[t.priority] ?? 'gray';
			if (colorBy() === 'status') return TASK_STATUSES.find((x) => x.id === t.status)?.color ?? 'gray';
			const schema = t.typeId ? s.schemas.get(t.typeId) : undefined;
			return schema?.color ?? 'gray';
		};
		const tasksByDay = (): Map<string, DevTask[]> => {
			const m = new Map<string, DevTask[]>();
			for (const t of scopedTasks(ctx)) {
				if (!t.due) continue;
				if (t.status === 'done' && ctx.config.showDone === false) continue;
				const l = m.get(t.due) ?? [];
				l.push(t);
				m.set(t.due, l);
			}
			for (const l of m.values()) l.sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done') || b.priority - a.priority || a.order - b.order);
			return m;
		};

		const chip = (parent: HTMLElement, t: DevTask, showEntity = false) => {
			const e = t.entityId ? s.entities.get(t.entityId) : undefined;
			const el = parent.createDiv({
				cls: cx('ws-cal-ev', `ws-tint--${tint(t)}`, t.status === 'done' && 'is-done', isOverdue(t) && 'is-over'),
				attr: { draggable: 'true', tabindex: '0', role: 'button', 'data-task': t.id },
			});
			el.createSpan({ cls: 'ws-cal-ev__title', text: t.title });
			if (showEntity && e) el.createSpan({ cls: 'ws-cal-ev__ent', text: e.name });
			setTooltip(el, [t.title, e?.name].filter(Boolean).join(' — '), { delay: 500 });
			el.addEventListener('click', (ev) => {
				ev.stopPropagation();
				new TaskModal(host, t.id).open();
			});
			el.addEventListener('keydown', (ev) => {
				if (ev.key === 'Enter') new TaskModal(host, t.id).open();
			});
			el.addEventListener('contextmenu', (ev) => {
				ev.preventDefault();
				ev.stopPropagation();
				taskMenu(host, t).showAtMouseEvent(ev);
			});
			el.addEventListener('dragstart', (ev) => {
				ev.dataTransfer?.setData('text/x-worldsmith-task', t.id);
				ev.dataTransfer?.setData('text/plain', t.title);
				el.addClass('is-dragging');
			});
			el.addEventListener('dragend', () => el.removeClass('is-dragging'));
			return el;
		};

		const dropTarget = (el: HTMLElement, date: ISODate) => {
			el.addEventListener('dragover', (ev) => {
				if (!ev.dataTransfer?.types.includes('text/x-worldsmith-task')) return;
				ev.preventDefault();
				el.addClass('is-drop');
			});
			el.addEventListener('dragleave', () => el.removeClass('is-drop'));
			el.addEventListener('drop', (ev) => {
				el.removeClass('is-drop');
				const id = ev.dataTransfer?.getData('text/x-worldsmith-task');
				if (!id) return;
				ev.preventDefault();
				s.tasks.update(id, { due: date });
			});
		};

		const paint = () => {
			card.empty();
			let anchor = anchors.get(key) ?? today();
			const now = today();
			// Toolbar
			const bar = card.createDiv({ cls: 'ws-cal__bar' });
			const title = bar.createDiv({ cls: 'ws-cal__title' });
			if (view === 'week') {
				const a = startOfWeek(anchor, ws());
				const b = addDays(a, 6);
				title.setText(`${fromISO(a).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${fromISO(b).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`);
			} else if (view === 'agenda') title.setText('Upcoming');
			else title.setText(monthLabel(anchor));
			const nav = (dir: number, label: string, ic: string) => {
				const b = bar.createEl('button', { cls: 'ws-cal__nav', attr: { type: 'button', 'aria-label': label } });
				setIcon(b, ic);
				b.addEventListener('click', () => {
					anchor = view === 'week' ? addDays(anchor, 7 * dir) : addMonths(anchor, dir);
					anchors.set(key, anchor);
					paint();
				});
			};
			if (view !== 'agenda') {
				nav(-1, view === 'week' ? 'Previous week' : 'Previous month', 'chevron-left');
				nav(1, view === 'week' ? 'Next week' : 'Next month', 'chevron-right');
				button(bar, {
					label: 'Today',
					variant: 'ghost',
					size: 'sm',
					onClick: () => {
						anchors.set(key, now);
						paint();
					},
				});
			}
			bar.createDiv({ cls: 'ws-cal__spacer' });
			const seg = bar.createDiv({ cls: 'ws-segmented ws-segmented--labels', attr: { role: 'radiogroup'} });
			nameRegion(seg, 'Calendar view' );
			for (const v of [
				{ id: 'month', label: 'Month' },
				{ id: 'week', label: 'Week' },
				{ id: 'agenda', label: 'Agenda' },
			] as const) {
				const b = seg.createEl('button', { cls: cx('ws-segmented__item', view === v.id && 'is-active'), text: v.label, attr: { type: 'button', role: 'radio', 'aria-checked': String(view === v.id) } });
				b.addEventListener('click', () => {
					view = v.id;
					paint();
				});
			}
			const opts = bar.createEl('button', { cls: 'ws-cal__nav', attr: { type: 'button', 'aria-label': 'Calendar options' } });
			setIcon(opts, 'sliders-horizontal');
			opts.addEventListener('click', (ev) => optionsMenu(ev));

			const body = card.createDiv({ cls: 'ws-cal__body' });
			const days = tasksByDay();
			if (view === 'month') month(body, anchor, days, now);
			else if (view === 'week') week(body, anchor, days, now);
			else agenda(body, now);
			legend(card, days, anchor);
		};

		const month = (body: HTMLElement, anchor: ISODate, days: Map<string, DevTask[]>, now: ISODate) => {
			const grid = body.createDiv({ cls: 'ws-cal-month', attr: { role: 'grid'} });
			nameRegion(grid, monthLabel(anchor) );
			for (let i = 0; i < 7; i++) grid.createDiv({ cls: 'ws-cal-month__dow', text: weekdayShort(ws() + i) });
			const per = typeof ctx.config.perDay === 'number' ? ctx.config.perDay : 2;
			// Whole weeks only: a short last row left the grid lines hanging.
			for (const d of monthGridDays(anchor, ws())) {
				const out = d.slice(0, 7) !== anchor.slice(0, 7);
				const dow = fromISO(d).getDay();
				const cell = grid.createDiv({
					cls: cx('ws-cal-day', out && 'is-out', d === now && 'is-today', (dow === 0 || dow === 6) && 'is-weekend'),
					attr: { role: 'gridcell', 'data-date': d, 'aria-label': longDate(d) },
				});
				cell.createDiv({ cls: 'ws-cal-day__n', text: String(fromISO(d).getDate()) });
				const list = days.get(d) ?? [];
				for (const t of list.slice(0, per)) chip(cell, t);
				if (list.length > per) {
					const more = cell.createEl('button', { cls: 'ws-cal-more', text: `+${list.length - per}`, attr: { type: 'button' } });
					more.createSpan({ cls: 'ws-cal-more__word', text: '\u00a0more' });
					more.addEventListener('click', (ev) => {
						ev.stopPropagation();
						dayPopover(more, d, list);
					});
				}
				cell.addEventListener('click', (ev) => {
					if ((ev.target as HTMLElement).closest('.ws-cal-ev, .ws-cal-more')) return;
					new NewTaskModal(host, { due: d }).open();
				});
				dropTarget(cell, d);
			}
		};

		const week = (body: HTMLElement, anchor: ISODate, days: Map<string, DevTask[]>, now: ISODate) => {
			const a = startOfWeek(anchor, ws());
			const grid = body.createDiv({ cls: 'ws-cal-week' });
			for (let i = 0; i < 7; i++) {
				const d = addDays(a, i);
				const col = grid.createDiv({ cls: cx('ws-cal-wday', d === now && 'is-today'), attr: { 'data-date': d } });
				const h = col.createDiv({ cls: 'ws-cal-wday__head' });
				h.createSpan({ cls: 'ws-cal-wday__dow', text: weekdayShort(ws() + i) });
				h.createSpan({ cls: 'ws-cal-wday__n', text: String(fromISO(d).getDate()) });
				const list = col.createDiv({ cls: 'ws-cal-wday__list' });
				for (const t of days.get(d) ?? []) chip(list, t, true);
				const add = col.createEl('button', { cls: 'ws-cal-wday__add', attr: { type: 'button', 'aria-label': `Add a task on ${longDate(d)}` } });
				setIcon(add, 'plus');
				add.addEventListener('click', () => new NewTaskModal(host, { due: d }).open());
				dropTarget(col, d);
			}
		};

		const agenda = (body: HTMLElement, now: ISODate) => {
			const tasks = scopedTasks(ctx).filter((t) => t.due && t.status !== 'done');
			const overdue = tasks.filter((t) => (t.due as string) < now).sort((a, b) => (a.due as string).localeCompare(b.due as string));
			const upcoming = tasks.filter((t) => (t.due as string) >= now && (t.due as string) <= addDays(now, 60)).sort((a, b) => (a.due as string).localeCompare(b.due as string) || b.priority - a.priority);
			const wrap = body.createDiv({ cls: 'ws-cal-agenda' });
			if (!overdue.length && !upcoming.length) {
				wrap.createDiv({ cls: 'ws-cal-agenda__empty', text: 'Nothing scheduled in the next 60 days. Give tasks a due date to see them here.' });
				return;
			}
			const group = (label: string, list: DevTask[], cls?: string) => {
				const g = wrap.createDiv({ cls: cx('ws-cal-agenda__group', cls) });
				g.createDiv({ cls: 'ws-cal-agenda__date', text: label });
				const l = g.createDiv({ cls: 'ws-task-list', attr: { role: 'list' } });
				for (const t of list) taskRow(l, host, t);
			};
			if (overdue.length) group('Overdue', overdue, 'is-over');
			let cur = '';
			let bucket: DevTask[] = [];
			for (const t of upcoming) {
				if (t.due !== cur) {
					if (bucket.length) group(cur === now ? `Today · ${longDate(cur)}` : longDate(cur), bucket);
					cur = t.due as string;
					bucket = [];
				}
				bucket.push(t);
			}
			if (bucket.length) group(cur === now ? `Today · ${longDate(cur)}` : longDate(cur), bucket);
		};

		const dayPopover = (anchorEl: HTMLElement, d: ISODate, list: DevTask[]) => {
			const pop = new Popover(anchorEl, { cls: 'ws-cal-pop', width: 320, label: longDate(d) });
			pop.el.createDiv({ cls: 'ws-cal-pop__title', text: longDate(d) });
			const l = pop.el.createDiv({ cls: 'ws-task-list', attr: { role: 'list' } });
			for (const t of list) taskRow(l, host, t);
			const add = pop.el.createEl('button', { cls: 'ws-link-btn', text: 'Add a task on this day', attr: { type: 'button' } });
			add.addEventListener('click', () => {
				pop.close();
				new NewTaskModal(host, { due: d }).open();
			});
			pop.position();
		};

		const legend = (parent: HTMLElement, days: Map<string, DevTask[]>, anchor: ISODate) => {
			const foot = parent.createDiv({ cls: 'ws-cal__legend' });
			if (colorBy() === 'type') {
				const seen = new Map<string, string>();
				for (const [d, l] of days) {
					if (view === 'month' && d.slice(0, 7) !== anchor.slice(0, 7)) continue;
					for (const t of l) {
						const schema = t.typeId ? s.schemas.get(t.typeId) : undefined;
						if (schema && !seen.has(schema.id)) seen.set(schema.id, schema.plural);
					}
				}
				for (const [id, label] of [...seen].slice(0, 8)) {
					const it = foot.createSpan({ cls: cx('ws-cal__key', `ws-tint--${s.schemas.get(id)?.color ?? 'gray'}`) });
					it.createSpan({ cls: 'ws-cal__dot' });
					it.createSpan({ text: label });
				}
			} else if (colorBy() === 'status') {
				for (const st of TASK_STATUSES) {
					const it = foot.createSpan({ cls: cx('ws-cal__key', `ws-tint--${st.color}`) });
					it.createSpan({ cls: 'ws-cal__dot' });
					it.createSpan({ text: st.label });
				}
			}
			foot.createSpan({ cls: 'ws-cal__hint', text: view === 'agenda' ? 'Click a task to open it' : 'Drag a task to another day to reschedule' });
		};

		const optionsMenu = (ev: MouseEvent) => {
			const m = new Menu();
			const set = (patch: Record<string, unknown>) => {
				ctx.config = { ...ctx.config, ...patch };
				ctx.setConfig?.(ctx.config);
				paint();
			};
			m.addItem((i) => i.setTitle('Show completed tasks').setChecked(ctx.config.showDone !== false).onClick(() => set({ showDone: ctx.config.showDone === false })));
			m.addSeparator();
			for (const [id, label] of [
				['type', 'Color by entry type'],
				['priority', 'Color by priority'],
				['status', 'Color by status'],
			] as const) {
				m.addItem((i) => i.setTitle(label).setChecked(colorBy() === id).onClick(() => set({ colorBy: id })));
			}
			m.addSeparator();
			m.addItem((i) =>
				i
					.setTitle(ws() === 1 ? 'Start weeks on Sunday' : 'Start weeks on Monday')
					.setIcon('calendar-range')
					.onClick(async () => {
						ctx.ws.settings.weekStart = ws() === 1 ? 0 : 1;
						await ctx.ws.saveSettings();
						paint();
					}),
			);
			m.showAtMouseEvent(ev);
		};

		paint();
		watchTasks(ctx, paint);
		void icon;
	},
};

export type { BlockRenderContext };
