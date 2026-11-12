import { Keymap } from 'obsidian';
import type { DevTask, EntityRecord } from '../../core/types';
import { addDays, today } from '../../core/util/dates';
import { ROUTES } from '../../state/route';
import { avatar } from '../../ui/components/avatar';
import { cx, emptyState, icon, progressRing } from '../../ui/components/dom';
import { NewTaskModal } from '../../ui/tasks/TaskModal';
import { taskRow } from '../../ui/tasks/taskUi';
import type { BlockDefinition, BlockRenderContext } from '../BlockRegistry';
import { blockActions } from '../../layouts/renderer/LayoutRenderer';
import { byDue, hostOf, scopedTasks, typesField, watchTasks } from './common';
import { button } from '../../ui/components/dom';

const limitField = (label = 'How many to show') => ({ id: 'limit', type: 'number', label, config: { min: 1, max: 30 } });

function taskListBlock(def: {
	id: string;
	name: string;
	icon: string;
	description: string;
	hint: string;
	defaultConfig: Record<string, unknown>;
	extraFields?: BlockDefinition['configFields'];
	pick(ctx: BlockRenderContext, now: string): DevTask[];
	empty: { icon: string; title: string; body?: string };
	addButton?: boolean;
}): BlockDefinition {
	return {
		id: def.id,
		name: def.name,
		icon: def.icon,
		description: def.description,
		hint: def.hint,
		surfaces: ['tasks'],
		frame: 'card',
		defaultSize: { w: 4, h: 1 },
		defaultConfig: def.defaultConfig,
		configFields: (s) => [limitField(), ...(typeof def.extraFields === 'function' ? def.extraFields(s) : (def.extraFields ?? [])), typesField(s)] as never,
		render(ctx) {
			const host = hostOf(ctx);
			const root = ctx.el.createDiv({ cls: 'ws-task-list', attr: { role: 'list' } });
			if (def.addButton) {
				const a = blockActions(ctx.el);
				if (a) button(a, { icon: 'plus', variant: 'quiet', size: 'sm', tooltip: 'New task', onClick: () => new NewTaskModal(host).open() });
			}
			const paint = () => {
				root.empty();
				const all = def.pick(ctx, today());
				const limit = typeof ctx.config.limit === 'number' ? ctx.config.limit : 6;
				const base = ctx.instance.title ?? def.name;
				ctx.setTitle(all.length ? `${base} · ${all.length}` : base);
				if (!all.length) {
					emptyState(root, { ...def.empty, compact: true });
					return;
				}
				for (const t of all.slice(0, limit)) taskRow(root, host, t);
				if (all.length > limit) root.createDiv({ cls: 'ws-task-list__more', text: `and ${all.length - limit} more` });
			};
			paint();
			watchTasks(ctx, paint);
		},
	};
}

export const dueSoonBlock = taskListBlock({
	id: 'task-due-soon',
	name: 'Due soon',
	icon: 'clock',
	description: 'Open tasks due in the next few days, with overdue ones first.',
	hint: 'Next few days',
	defaultConfig: { limit: 6, days: 7, overdue: true },
	extraFields: [
		{ id: 'days', type: 'number', label: 'Days ahead', config: { min: 1, max: 60 } },
		{ id: 'overdue', type: 'boolean', label: 'Include overdue tasks' },
	],
	addButton: true,
	pick: (ctx, now) => {
		const days = typeof ctx.config.days === 'number' ? ctx.config.days : 7;
		const end = addDays(now, days - 1);
		return scopedTasks(ctx)
			.filter((t) => t.status !== 'done' && t.due && t.due <= end && (ctx.config.overdue !== false || t.due >= now))
			.sort(byDue);
	},
	empty: { icon: 'sun', title: 'Nothing due soon', body: 'Tasks with a due date in the next days show up here.' },
});

export const overdueBlock = taskListBlock({
	id: 'task-overdue',
	name: 'Overdue',
	icon: 'alert-circle',
	description: 'Open tasks whose due date has passed, oldest first.',
	hint: 'Past their due date',
	defaultConfig: { limit: 6 },
	pick: (ctx, now) => scopedTasks(ctx).filter((t) => t.status !== 'done' && t.due && t.due < now).sort(byDue),
	empty: { icon: 'party-popper', title: 'Nothing overdue' },
});

export const recentBlock = taskListBlock({
	id: 'task-recent',
	name: 'Recently completed',
	icon: 'circle-check',
	description: 'The latest finished tasks — uncheck one to reopen it.',
	hint: 'Latest wins',
	defaultConfig: { limit: 6 },
	pick: (ctx) => scopedTasks(ctx)
		.filter((t) => t.status === 'done' && t.completedAt)
		.sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0)),
	empty: { icon: 'circle-check', title: 'Nothing completed yet' },
});

// ── progress by type ──────────────────────────────────────────────────────────

export const progressByTypeBlock: BlockDefinition = {
	id: 'task-progress-types',
	name: 'Progress by type',
	icon: 'bar-chart-3',
	description: 'How far along each kind of entry is, by its tasks.',
	hint: 'A bar per type',
	surfaces: ['tasks'],
	frame: 'card',
	defaultSize: { w: 4, h: 1 },
	defaultConfig: {},
	configFields: (s) => [typesField(s)],
	render(ctx) {
		const s = ctx.session;
		const root = ctx.el.createDiv({ cls: 'ws-ptypes' });
		const paint = () => {
			root.empty();
			const per = new Map<string, { done: number; total: number; open: number }>();
			for (const t of scopedTasks(ctx)) {
				if (!t.typeId) continue;
				if (t.optional && !s.world.progress.includeOptional) continue;
				const p = per.get(t.typeId) ?? { done: 0, total: 0, open: 0 };
				p.total++;
				if (t.status === 'done') p.done++;
				else p.open++;
				per.set(t.typeId, p);
			}
			const rows = [...per].filter(([, p]) => p.total).sort((a, b) => b[1].open - a[1].open);
			if (!rows.length) {
				emptyState(root, { icon: 'bar-chart-3', title: 'No tasks yet', compact: true });
				return;
			}
			for (const [typeId, p] of rows) {
				const schema = s.schemas.get(typeId);
				const pct = Math.round((p.done / p.total) * 100);
				const r = root.createEl('button', { cls: cx('ws-ptype', `ws-tint--${schema?.color ?? 'gray'}`), attr: { type: 'button' } });
				icon(r, schema?.icon ?? 'box', 'ws-ptype__icon');
				r.createSpan({ cls: 'ws-ptype__name', text: schema?.plural ?? typeId });
				r.createSpan({ cls: 'ws-ptype__num', text: `${p.open} open · ${pct}%` });
				const bar = r.createDiv({ cls: 'ws-ptype__bar' });
				bar.createDiv({ cls: 'ws-ptype__fill' }).style.width = `${pct}%`;
				r.addEventListener('click', (ev) => ctx.navigate(ROUTES.database(typeId), Keymap.isModEvent(ev)));
			}
		};
		paint();
		watchTasks(ctx, paint, { entities: false });
	},
};

// ── entries ────────────────────────────────────────────────────────────────────

function entryRow(ctx: BlockRenderContext, parent: HTMLElement, e: EntityRecord, meta: string, ratio: number): void {
	const s = ctx.session;
	const schema = s.schemas.get(e.typeId);
	const r = parent.createDiv({ cls: 'ws-mini-list__row', attr: { tabindex: '0', role: 'link' } });
	avatar(r, ctx.app, e, schema, { size: 'sm' });
	const t = r.createDiv({ cls: 'ws-mini-list__text' });
	t.createDiv({ cls: 'ws-mini-list__name', text: e.name });
	t.createDiv({ cls: 'ws-mini-list__meta', text: meta });
	progressRing(r, ratio, 30);
	r.addEventListener('click', (ev) => ctx.navigate(ROUTES.entity(e.id), Keymap.isModEvent(ev)));
	r.addEventListener('keydown', (ev) => ev.key === 'Enter' && ctx.navigate(ROUTES.entity(e.id)));
}

export const attentionBlock: BlockDefinition = {
	id: 'task-attention',
	name: 'Needs attention',
	icon: 'target',
	description: 'The least developed entries, so nothing gets forgotten.',
	hint: 'Least developed entries',
	surfaces: ['tasks'],
	frame: 'card',
	defaultSize: { w: 4, h: 1 },
	defaultConfig: { limit: 3 },
	configFields: (s) => [limitField(), typesField(s)] as never,
	render(ctx) {
		const s = ctx.session;
		const root = ctx.el.createDiv({ cls: 'ws-mini-list' });
		const paint = () => {
			root.empty();
			const types = Array.isArray(ctx.config.types) ? (ctx.config.types as string[]) : [];
			const list = s.entities
				.all()
				.filter((e) => !e.trashedAt && !e.archivedAt && (!types.length || types.includes(e.typeId)))
				.map((e) => ({ e, p: s.entityService.progress(e) }))
				.sort((a, b) => a.p.ratio - b.p.ratio || b.e.updatedAt - a.e.updatedAt);
			const limit = typeof ctx.config.limit === 'number' ? ctx.config.limit : 3;
			if (!list.length) {
				emptyState(root, { icon: 'target', title: 'No entries yet', compact: true });
				return;
			}
			for (const { e, p } of list.slice(0, limit)) {
				const schema = s.schemas.get(e.typeId);
				const meta = p.tasks.total ? `${schema?.singular ?? ''} · ${p.tasks.done} of ${p.tasks.total} tasks` : `${schema?.singular ?? ''} · ${Math.round(p.ratio * 100)}% developed`;
				entryRow(ctx, root, e, meta, p.ratio);
			}
		};
		paint();
		watchTasks(ctx, paint);
	},
};

export const focusBlock: BlockDefinition = {
	id: 'task-focus',
	name: 'Focus entries',
	icon: 'pin',
	description: 'Pinned or favorite entries with their next task.',
	hint: 'Pinned or favorites',
	surfaces: ['tasks'],
	frame: 'card',
	defaultSize: { w: 4, h: 1 },
	defaultConfig: { source: 'pinned', limit: 5 },
	configFields: [
		{ id: 'source', type: 'select', label: 'Show', config: { options: [{ id: 'pinned', label: 'Pinned entries' }, { id: 'favorites', label: 'Favorites' }] } },
		limitField(),
	],
	render(ctx) {
		const s = ctx.session;
		const root = ctx.el.createDiv({ cls: 'ws-mini-list' });
		const paint = () => {
			root.empty();
			const src = ctx.config.source === 'favorites' ? s.index.favoriteEntities() : s.index.pinnedEntities();
			const limit = typeof ctx.config.limit === 'number' ? ctx.config.limit : 5;
			if (!src.length) {
				emptyState(root, { icon: 'pin', title: ctx.config.source === 'favorites' ? 'No favorites yet' : 'Nothing pinned yet', body: 'Use an entry’s ⋯ menu to pin it here.', compact: true });
				return;
			}
			for (const e of src.slice(0, limit)) {
				const next = s.tasks.forEntity(e.id).filter((t) => t.status !== 'done').sort(byDue)[0];
				const p = s.entityService.progress(e);
				entryRow(ctx, root, e, next ? `Next: ${next.title}` : 'No open tasks', p.ratio);
			}
		};
		paint();
		watchTasks(ctx, paint);
		void today;
	},
};
