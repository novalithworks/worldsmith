import type { DevTask, FieldDefinition, SelectOption } from '../../core/types';
import { own } from '../../ui/components/lifecycle';
import type { TaskUiHost } from '../../ui/tasks/taskUi';
import type { WorldSession } from '../../services/WorldSession';
import type { BlockRenderContext } from '../BlockRegistry';

export function hostOf(ctx: BlockRenderContext): TaskUiHost {
	return { ws: ctx.ws, session: ctx.session, navigate: (r, nl) => ctx.navigate(r, nl) };
}

/**
 * Repaint (batched to one frame) whenever tasks, entries or the world's progress settings
 * change. Task widgets are cheap to redraw and always show live data.
 */
export function watchTasks(ctx: BlockRenderContext, paint: () => void, opts: { entities?: boolean } = {}): void {
	const s = ctx.session;
	let queued = false;
	const later = () => {
		if (queued) return;
		queued = true;
		window.requestAnimationFrame(() => {
			queued = false;
			if (ctx.el.isConnected) paint();
		});
	};
	for (const ev of ['task:created', 'task:updated', 'task:deleted'] as const) own(ctx.component, s.events.on(ev, later));
	own(ctx.component, s.events.on('world:updated', ({ keys }) => (keys.includes('progress') || keys.includes('statuses')) && later()));
	if (opts.entities !== false) {
		own(ctx.component, s.events.on('entity:updated', ({ change }) => change.keys.some((k) => k === 'name' || k === 'trashedAt' || k === 'media' || k === 'typeId' || k === 'archivedAt' || k.startsWith('values.')) && later()));
		own(ctx.component, s.events.on('entity:created', later));
		own(ctx.component, s.events.on('entity:deleted', later));
	}
}

/** Visible tasks restricted to the block's `types` config (empty = all). */
export function scopedTasks(ctx: BlockRenderContext): DevTask[] {
	const types = Array.isArray(ctx.config.types) ? (ctx.config.types as string[]) : [];
	return ctx.session.tasks.visible().filter((t) => !types.length || (t.typeId && types.includes(t.typeId)));
}

export function typeOptions(s: WorldSession): SelectOption[] {
	return s.schemas.list().map((t) => ({ id: t.id, label: t.plural, ...(t.color ? { color: t.color } : {}) }));
}

/** Common "Only these types" setting. */
export function typesField(s: WorldSession): FieldDefinition {
	return { id: 'types', type: 'multiselect', label: 'Only these types', width: 'full', placeholder: 'All types', config: { options: typeOptions(s) } };
}

export const byDue = (a: DevTask, b: DevTask): number => (a.due ?? '9999').localeCompare(b.due ?? '9999') || b.priority - a.priority || a.order - b.order;
