import { Keymap } from 'obsidian';
import type { EntityRecord } from '../core/types';
import { own } from '../ui/components/lifecycle';
import type { BlockRenderContext } from './BlockRegistry';
import { ROUTES } from '../state/route';
import { entityMenu } from '../ui/actions';

/**
 * Subscribe to changes of the block's entity. `keys` lets blocks ignore unrelated edits
 * (e.g. the gallery block doesn't care about field values).
 */
export function watchEntity(
	ctx: BlockRenderContext,
	cb: (entity: EntityRecord, keys: string[]) => void,
	filter?: (key: string) => boolean,
): void {
	const id = ctx.entity?.id;
	if (!id) return;
	own(
		ctx.component,
		ctx.session.events.on('entity:updated', ({ entity, change }) => {
			if (entity.id !== id) return;
			if (filter && !change.keys.some(filter)) return;
			cb(entity, change.keys);
		}),
	);
}

export function currentEntity(ctx: BlockRenderContext): EntityRecord | undefined {
	return ctx.entity ? ctx.session.entities.get(ctx.entity.id) : undefined;
}

/** Wire click (mod-click → new tab) and context menu to open an entity. */
export function linkToEntity(ctx: BlockRenderContext, el: HTMLElement, entity: EntityRecord): void {
	el.addEventListener('click', (evt) => {
		if ((evt.target as HTMLElement).closest('button')) return;
		ctx.navigate(ROUTES.entity(entity.id), Keymap.isModEvent(evt));
	});
	el.addEventListener('keydown', (evt) => {
		if (evt.key === 'Enter') ctx.navigate(ROUTES.entity(entity.id), Keymap.isModEvent(evt));
	});
	el.addEventListener('contextmenu', (evt) => {
		evt.preventDefault();
		const fresh = ctx.session.entities.get(entity.id);
		if (fresh) entityMenu(ctx.ws, fresh).showAtMouseEvent(evt);
	});
	el.tabIndex = 0;
}
