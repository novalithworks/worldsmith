import { setIcon } from 'obsidian';
import type { DevTask, EntityRecord } from '../../core/types';
import { TASK_PRIORITIES, TASK_STATUSES } from '../../core/types';
import { addDays, startOfWeek, today } from '../../core/util/dates';
import { avatar } from '../../ui/components/avatar';
import { openPropertyPicker } from '../../ui/components/propertyPicker';
import { button, cx, emptyState, icon } from '../../ui/components/dom';
import { NewTaskModal, TaskModal } from '../../ui/tasks/TaskModal';
import { checkbox, dueChip, entityLink, isOverdue, priorityFlag, taskMenu, taskRow } from '../../ui/tasks/taskUi';
import type { BlockDefinition } from '../BlockRegistry';
import { byDue, hostOf, scopedTasks, typesField, watchTasks } from './common';

type Sort = 'due' | 'priority' | 'created' | 'title';
type Group = 'none' | 'entry' | 'type' | 'due' | 'priority' | 'category' | 'status';
type View = 'next' | 'overdue' | 'week' | 'nodate' | 'done' | 'all';

const VIEWS: Array<{ id: View; label: string; icon: string }> = [
	{ id: 'next', label: 'Up next', icon: 'circle-dashed' },
	{ id: 'overdue', label: 'Overdue', icon: 'alarm-clock' },
	{ id: 'week', label: 'This week', icon: 'calendar-range' },
	{ id: 'nodate', label: 'No date', icon: 'calendar-off' },
	{ id: 'done', label: 'Done', icon: 'check-circle-2' },
	{ id: 'all', label: 'All', icon: 'list' },
];
const GROUPS: Array<{ id: Group; label: string; icon: string }> = [
	{ id: 'entry', label: 'Entry', icon: 'user-round' },
	{ id: 'type', label: 'Entry type', icon: 'shapes' },
	{ id: 'due', label: 'Due date', icon: 'calendar' },
	{ id: 'priority', label: 'Priority', icon: 'flag' },
	{ id: 'status', label: 'Status', icon: 'circle-dot' },
	{ id: 'category', label: 'Category', icon: 'tag' },
];
const SORTS: Array<{ id: Sort; label: string; icon: string }> = [
	{ id: 'due', label: 'Due date', icon: 'calendar' },
	{ id: 'priority', label: 'Priority', icon: 'flag' },
	{ id: 'created', label: 'Newest first', icon: 'sparkles' },
	{ id: 'title', label: 'Title', icon: 'type' },
];
/** Tasks shown per group before "Show N more"; groups shown before "More groups". */
const PER_GROUP = 4;
const GROUP_PAGE = 8;
const FLAT_PAGE = 30;

/** Per-instance UI state for the session (search, folded and expanded groups, paging). */
const state = new Map<string, { q: string; type: string | null; folded: Set<string>; open: Set<string>; groups: number; shown: number }>();

/**
 * Every task in the world, organized instead of dumped: quick views (Up next, Overdue,
 * This week…), grouping (by entry by default, so each entry's checklist reads as one
 * card with its progress), a few tasks per group with "Show more", search, and type filter.
 * Rows edit inline (done, due date) and open the task on click.
 */
export const taskTableBlock: BlockDefinition = {
	id: 'task-list',
	name: 'All tasks',
	icon: 'list-checks',
	description: 'Every task, organized: quick views, grouping by entry, type or date, search and filters.',
	hint: 'Views, groups, search',
	surfaces: ['tasks'],
	frame: 'plain',
	defaultSize: { w: 8, h: 1 },
	defaultConfig: { view: 'next', group: 'entry', sort: 'due', tl: 2 },
	configFields: (s) => [
		{ id: 'view', type: 'select', label: 'Opens on', config: { options: VIEWS.map((v) => ({ id: v.id, label: v.label })) } },
		{ id: 'group', type: 'select', label: 'Group by', config: { options: [...GROUPS.map((g) => ({ id: g.id, label: g.label })), { id: 'none', label: 'No groups' }] } },
		{ id: 'sort', type: 'select', label: 'Sort by', config: { options: SORTS.map((x) => ({ id: x.id, label: x.label })) } },
		typesField(s),
	],
	render(ctx) {
		const s = ctx.session;
		const host = hostOf(ctx);
		const st = state.get(ctx.instance.id) ?? { q: '', type: null, folded: new Set<string>(), open: new Set<string>(), groups: GROUP_PAGE, shown: FLAT_PAGE };
		state.set(ctx.instance.id, st);
		// Lists from before the overhaul (no `tl`) open grouped by entry instead of one long list.
		const legacy = ctx.config.tl !== 2;
		const view = (): View => (VIEWS.some((v) => v.id === ctx.config.view) ? ctx.config.view : 'next') as View;
		const group = (): Group => (legacy && (ctx.config.group === 'none' || !ctx.config.group) ? 'entry' : ([...GROUPS.map((g) => g.id), 'none'].includes(ctx.config.group as Group) ? ctx.config.group : 'entry')) as Group;
		const sort = (): Sort => (SORTS.some((x) => x.id === ctx.config.sort) ? ctx.config.sort : ctx.config.sort === 'entry' ? 'title' : 'due') as Sort;
		const set = (patch: Record<string, unknown>) => {
			ctx.config = { ...ctx.config, ...patch, tl: 2 };
			ctx.setConfig?.(ctx.config);
			st.groups = GROUP_PAGE;
			st.shown = FLAT_PAGE;
			paint();
		};
		const now = today();
		const weekEnd = addDays(startOfWeek(now, ctx.ws.settings.weekStart), 6);
		const inView = (t: DevTask, v: View): boolean => {
			switch (v) {
				case 'next':
					return t.status !== 'done';
				case 'overdue':
					return isOverdue(t, now);
				case 'week':
					// From today to the end of the week; older ones are under Overdue.
					return t.status !== 'done' && !!t.due && t.due >= now && t.due <= weekEnd;
				case 'nodate':
					return t.status !== 'done' && !t.due;
				case 'done':
					return t.status === 'done';
				default:
					return true;
			}
		};
		const entityName = (t: DevTask) => (t.entityId ? (s.entities.get(t.entityId)?.name ?? '') : '');
		const cmp: Record<Sort, (a: DevTask, b: DevTask) => number> = {
			due: (a, b) => Number(b.status !== 'done') - Number(a.status !== 'done') || byDue(a, b),
			priority: (a, b) => b.priority - a.priority || byDue(a, b),
			created: (a, b) => b.createdAt - a.createdAt,
			title: (a, b) => a.title.localeCompare(b.title),
		};
		const dueBucket = (t: DevTask): { key: string; label: string; rank: number } => {
			if (t.status === 'done') return { key: 'done', label: 'Done', rank: 6 };
			if (!t.due) return { key: 'none', label: 'No date', rank: 5 };
			if (t.due < now) return { key: 'over', label: 'Overdue', rank: 0 };
			if (t.due === now) return { key: 'today', label: 'Today', rank: 1 };
			if (t.due <= weekEnd) return { key: 'week', label: 'Later this week', rank: 2 };
			if (t.due <= addDays(now, 30)) return { key: 'month', label: 'Next 30 days', rank: 3 };
			return { key: 'later', label: 'Later', rank: 4 };
		};
		interface G {
			key: string;
			label: string;
			rank: number | string;
			icon?: string;
			color?: string | null;
			entity?: EntityRecord;
			tasks: DevTask[];
		}
		const keyOf = (t: DevTask): Omit<G, 'tasks'> => {
			switch (group()) {
				case 'entry': {
					const e = t.entityId ? s.entities.get(t.entityId) : undefined;
					return e ? { key: e.id, label: e.name, rank: e.name.toLowerCase(), entity: e } : { key: '__world', label: `${s.world.name} (world tasks)`, rank: '~', icon: 'globe-2' };
				}
				case 'type': {
					const sc = t.typeId ? s.schemas.get(t.typeId) : undefined;
					return sc ? { key: sc.id, label: sc.plural, rank: sc.plural.toLowerCase(), icon: sc.icon, color: sc.color } : { key: '__world', label: 'World tasks', rank: '~', icon: 'globe-2' };
				}
				case 'due':
					return { ...dueBucket(t), icon: 'calendar' };
				case 'priority':
					return { key: String(t.priority), label: t.priority ? `${TASK_PRIORITIES[t.priority]?.label} priority` : 'No priority', rank: 4 - t.priority, icon: 'flag' };
				case 'status': {
					const i = TASK_STATUSES.findIndex((x) => x.id === t.status);
					return { key: t.status, label: TASK_STATUSES[i]?.label ?? t.status, rank: i, icon: 'circle-dot', color: TASK_STATUSES[i]?.color };
				}
				case 'category':
					return t.category ? { key: `c:${t.category}`, label: t.category, rank: t.category.toLowerCase(), icon: 'tag' } : { key: '__none', label: 'No category', rank: '~', icon: 'tag' };
				default:
					return { key: '', label: '', rank: 0 };
			}
		};

		// The head (with the search box) is built once; repaints redraw the rest, so typing,
		// on-screen keyboards and input methods aren't interrupted.
		const card = ctx.el.createDiv({ cls: 'ws-tcard ws-tl' });
		const head = card.createDiv({ cls: 'ws-tl__head' });
		const title = head.createDiv({ cls: 'ws-tl__title' });
		title.createSpan({ text: ctx.instance.title ?? 'All tasks' });
		const countEl = title.createSpan({ cls: 'ws-tl__count' });
		const searchWrap = head.createDiv({ cls: 'ws-tl__search' });
		icon(searchWrap, 'search');
		const input = searchWrap.createEl('input', { cls: 'ws-tl__input', attr: { type: 'search', placeholder: 'Search tasks…', 'aria-label': 'Search tasks', spellcheck: 'false' } });
		input.value = st.q;
		const onSearch = (e?: Event) => {
			if ((e as InputEvent | undefined)?.isComposing) return;
			st.q = input.value;
			st.groups = GROUP_PAGE;
			st.shown = FLAT_PAGE;
			paint();
		};
		input.addEventListener('input', onSearch);
		input.addEventListener('compositionend', () => onSearch());
		const tools = head.createDiv({ cls: 'ws-tl__tools' });
		const views = card.createDiv({ cls: 'ws-tl__views', attr: { role: 'tablist' } });
		const body = card.createDiv({ cls: 'ws-tl__body' });
		const paint = () => {
			tools.empty();
			views.empty();
			body.empty();
			const pool = scopedTasks(ctx).filter((t) => !st.type || t.typeId === st.type);
			const q = st.q.trim().toLowerCase();
			const searched = q ? pool.filter((t) => `${t.title} ${t.category ?? ''} ${entityName(t)}`.toLowerCase().includes(q)) : pool;
			const rows = searched.filter((t) => inView(t, view())).sort(cmp[sort()]);

			countEl.setText(rows.length.toLocaleString());
			const tool = (ic: string, label: string, on: boolean, run: (el: HTMLElement) => void) => {
				const b = tools.createEl('button', { cls: cx('ws-tool-btn', on && 'is-on'), attr: { type: 'button' } });
				icon(b, ic);
				b.createSpan({ text: label });
				b.addEventListener('click', () => run(b));
				return b;
			};
			tool('filter', st.type ? (s.schemas.get(st.type)?.plural ?? 'Type') : 'All types', !!st.type, (b) =>
				openPropertyPicker(b, {
					title: 'Show tasks of',
					selected: st.type,
					none: { label: 'All types', icon: 'layers' },
					items: s.schemas.list().map((t) => ({ id: t.id, label: t.plural, icon: t.icon, hint: String(pool.filter((x) => x.typeId === t.id && inView(x, view())).length || '') })),
					onPick: (id) => {
						st.type = id;
						paint();
					},
				}),
			);
			const g = group();
			tool('rows-3', g === 'none' ? 'No groups' : `By ${GROUPS.find((x) => x.id === g)?.label.toLowerCase()}`, g !== 'none', (b) =>
				openPropertyPicker(b, {
					title: 'Group tasks by',
					selected: g === 'none' ? null : g,
					none: { label: 'No groups', icon: 'list' },
					items: GROUPS.map((x) => ({ id: x.id, label: x.label, icon: x.icon })),
					onPick: (id) => set({ group: id ?? 'none' }),
				}),
			);
			tool('arrow-up-down', SORTS.find((x) => x.id === sort())?.label ?? 'Sort', false, (b) =>
				openPropertyPicker(b, {
					title: 'Sort tasks by',
					selected: sort(),
					items: SORTS.map((x) => ({ id: x.id, label: x.label, icon: x.icon })),
					onPick: (id) => id && set({ sort: id }),
				}),
			);
			button(tools, { icon: 'plus', label: 'New task', variant: 'primary', size: 'sm', onClick: () => new NewTaskModal(host).open() });

			// Quick views with counts.
			for (const v of VIEWS) {
				const n = searched.filter((t) => inView(t, v.id)).length;
				const on = view() === v.id;
				const b = views.createEl('button', { cls: cx('ws-tl__view', on && 'is-active', v.id === 'overdue' && n > 0 && 'is-alert'), attr: { type: 'button', role: 'tab', 'aria-selected': String(on) } });
				icon(b, v.icon);
				b.createSpan({ text: v.label });
				b.createSpan({ cls: 'ws-tl__view-n', text: n.toLocaleString() });
				b.addEventListener('click', () => set({ view: v.id }));
			}

			if (!rows.length) {
				const empty: Record<View, string> = { next: 'Nothing left to do', overdue: 'Nothing overdue', week: 'Nothing due this week', nodate: 'Every open task has a date', done: 'Nothing done yet', all: 'No tasks yet' };
				emptyState(body, { icon: view() === 'overdue' || view() === 'next' ? 'party-popper' : 'list-checks', title: q ? `No tasks match “${st.q}”` : empty[view()], compact: true });
				return;
			}
			if (g === 'none') {
				const list = body.createDiv({ cls: 'ws-tl__rows' });
				for (const t of rows.slice(0, st.shown)) taskLine(list, t, true);
				if (rows.length > st.shown) moreButton(body, `Show ${Math.min(FLAT_PAGE, rows.length - st.shown)} more · ${rows.length - st.shown} left`, () => (st.shown += FLAT_PAGE));
				return;
			}
			// Groups.
			const map = new Map<string, G>();
			for (const t of rows) {
				const k = keyOf(t);
				const cur = map.get(k.key) ?? { ...k, tasks: [] };
				cur.tasks.push(t);
				map.set(k.key, cur);
			}
			// Entries and types with something due soonest come first; then alphabetical.
			const soonest = (gr: G) => gr.tasks.reduce((m, t) => (t.status !== 'done' && t.due && t.due < m ? t.due : m), '9999');
			const byDueFirst = g === 'entry' || g === 'type';
			const groups = [...map.values()].sort((a, b) => (byDueFirst ? soonest(a).localeCompare(soonest(b)) : 0) || (typeof a.rank === 'number' && typeof b.rank === 'number' ? a.rank - b.rank : String(a.rank).localeCompare(String(b.rank))));
			for (const gr of groups.slice(0, st.groups)) groupCard(body, gr, g);
			if (groups.length > st.groups) moreButton(body, `Show ${Math.min(GROUP_PAGE, groups.length - st.groups)} more groups · ${groups.length - st.groups} left`, () => (st.groups += GROUP_PAGE));
		};

		const moreButton = (parent: HTMLElement, label: string, run: () => void) => {
			const b = parent.createEl('button', { cls: 'ws-tl__more', attr: { type: 'button' } });
			icon(b, 'chevrons-down');
			b.createSpan({ text: label });
			b.addEventListener('click', () => {
				run();
				paint();
			});
		};

		const groupCard = (parent: HTMLElement, gr: G, g: Group) => {
			const folded = st.folded.has(`${g}:${gr.key}`);
			const sec = parent.createDiv({ cls: cx('ws-tl__group', folded && 'is-folded', gr.color && `ws-tint--${gr.color}`) });
			const head = sec.createEl('button', { cls: 'ws-tl__ghead', attr: { type: 'button', 'aria-expanded': String(!folded) } });
			const caret = head.createSpan({ cls: 'ws-tl__caret' });
			setIcon(caret, 'chevron-down');
			if (gr.entity) avatar(head, ctx.app, gr.entity, s.schemas.get(gr.entity.typeId), { size: 'xs' });
			else if (gr.icon) icon(head, gr.icon, 'ws-tl__gicon');
			const name = head.createSpan({ cls: 'ws-tl__gname', text: gr.label });
			if (gr.entity) {
				const sc = s.schemas.get(gr.entity.typeId);
				if (sc) head.createSpan({ cls: cx('ws-tl__gtype', sc.color && `ws-tint--${sc.color}`), text: sc.singular });
			}
			void name;
			head.createSpan({ cls: 'ws-tl__gspacer' });
			// Entry groups show that entry's whole checklist progress, not just these rows.
			if (gr.entity) {
				const all = s.tasks.forEntity(gr.entity.id).filter((t) => !t.optional || s.world.progress.includeOptional);
				const done = all.filter((t) => t.status === 'done').length;
				if (all.length) {
					const bar = head.createSpan({ cls: 'ws-tl__gbar' });
					bar.createSpan({ cls: 'ws-tl__gbar-fill' }).style.transform = `scaleX(${done / all.length})`;
					head.createSpan({ cls: 'ws-tl__gprog', text: `${done}/${all.length}` });
				}
			}
			head.createSpan({ cls: 'ws-tl__gcount', text: gr.tasks.length.toLocaleString() });
			head.addEventListener('click', () => {
				const k = `${g}:${gr.key}`;
				if (st.folded.has(k)) st.folded.delete(k);
				else st.folded.add(k);
				paint();
			});
			if (folded) return;
			const list = sec.createDiv({ cls: 'ws-tl__rows' });
			const k = `${g}:${gr.key}`;
			const shown = st.open.has(k) ? gr.tasks : gr.tasks.slice(0, PER_GROUP);
			for (const t of shown) taskLine(list, t, g !== 'entry');
			if (shown.length < gr.tasks.length) {
				const more = sec.createEl('button', { cls: 'ws-tl__gmore', attr: { type: 'button' }, text: `Show ${gr.tasks.length - shown.length} more` });
				more.addEventListener('click', () => {
					st.open.add(k);
					paint();
				});
			} else if (st.open.has(k) && gr.tasks.length > PER_GROUP) {
				const less = sec.createEl('button', { cls: 'ws-tl__gmore', attr: { type: 'button' }, text: 'Show fewer' });
				less.addEventListener('click', () => {
					st.open.delete(k);
					paint();
				});
			}
		};

		const taskLine = (parent: HTMLElement, t: DevTask, showEntity: boolean) => {
			const r = parent.createDiv({ cls: cx('ws-tl__row', t.status === 'done' && 'is-done'), attr: { role: 'row', tabindex: '0', 'data-task': t.id } });
			checkbox(r, host, t);
			const main = r.createDiv({ cls: 'ws-tl__main' });
			main.createSpan({ cls: 'ws-tl__task', text: t.title });
			const meta = main.createDiv({ cls: 'ws-tl__meta' });
			const e = t.entityId ? s.entities.get(t.entityId) : undefined;
			if (showEntity && e) entityLink(meta, host, e);
			else if (showEntity && !t.entityId) meta.createSpan({ cls: 'ws-tl__world', text: 'World' });
			if (t.category) meta.createSpan({ cls: 'ws-task__cat', text: t.category });
			if (t.status === 'in-progress' || t.status === 'blocked') {
				const x = TASK_STATUSES.find((y) => y.id === t.status);
				meta.createSpan({ cls: cx('ws-tl__status', `ws-tint--${x?.color}`), text: x?.label ?? '' });
			}
			if (!meta.childElementCount) meta.remove();
			const side = r.createDiv({ cls: 'ws-tl__side' });
			priorityFlag(side, t.priority);
			dueChip(side, host, t, { empty: '' });
			r.addEventListener('click', (ev) => {
				if ((ev.target as HTMLElement).closest('button, a')) return;
				new TaskModal(host, t.id).open();
			});
			r.addEventListener('keydown', (ev) => ev.target === r && ev.key === 'Enter' && new TaskModal(host, t.id).open());
			r.addEventListener('contextmenu', (ev) => {
				ev.preventDefault();
				taskMenu(host, t).showAtMouseEvent(ev);
			});
		};

		paint();
		watchTasks(ctx, paint);
	},
};

// ── board ─────────────────────────────────────────────────────────────────────

export const taskBoardBlock: BlockDefinition = {
	id: 'task-board',
	name: 'Board',
	icon: 'columns-3',
	description: 'Tasks in columns by status. Drag a card to change its status.',
	hint: 'Columns by status',
	surfaces: ['tasks'],
	frame: 'card',
	defaultSize: { w: 12, h: 1 },
	defaultConfig: { perColumn: 8 },
	configFields: (s) => [{ id: 'perColumn', type: 'number', label: 'Cards per column', config: { min: 3, max: 50 } }, typesField(s)],
	render(ctx) {
		const s = ctx.session;
		const host = hostOf(ctx);
		const root = ctx.el.createDiv({ cls: 'ws-board' });
		const paint = () => {
			root.empty();
			const per = typeof ctx.config.perColumn === 'number' ? ctx.config.perColumn : 8;
			const all = scopedTasks(ctx);
			for (const st of TASK_STATUSES) {
				const col = root.createDiv({ cls: cx('ws-board__col', `ws-tint--${st.color}`), attr: { 'data-status': st.id } });
				const list = all.filter((t) => t.status === st.id).sort(st.id === 'done' ? (a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0) : byDue);
				const h = col.createDiv({ cls: 'ws-board__head' });
				h.createSpan({ cls: 'ws-board__dot' });
				h.createSpan({ text: st.label });
				h.createSpan({ cls: 'ws-board__count', text: String(list.length) });
				const body = col.createDiv({ cls: 'ws-board__list', attr: { role: 'list' } });
				for (const t of list.slice(0, per)) {
					const row = taskRow(body, host, t);
					row.setAttr('draggable', 'true');
					row.addEventListener('dragstart', (ev) => ev.dataTransfer?.setData('text/x-worldsmith-task', t.id));
				}
				if (list.length > per) body.createDiv({ cls: 'ws-task-list__more', text: `and ${list.length - per} more` });
				col.addEventListener('dragover', (ev) => {
					if (!ev.dataTransfer?.types.includes('text/x-worldsmith-task')) return;
					ev.preventDefault();
					col.addClass('is-drop');
				});
				col.addEventListener('dragleave', () => col.removeClass('is-drop'));
				col.addEventListener('drop', (ev) => {
					col.removeClass('is-drop');
					const id = ev.dataTransfer?.getData('text/x-worldsmith-task');
					if (id) s.tasks.setStatus(id, st.id);
				});
			}
		};
		paint();
		watchTasks(ctx, paint);
		void setIcon;
	},
};
