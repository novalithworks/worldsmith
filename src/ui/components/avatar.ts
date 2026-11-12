import type { App } from 'obsidian';
import type { EntityRecord, EntitySchema } from '../../core/types';
import { initials } from '../../core/util/strings';
import { vaultImage } from '../../fields/ui/media';
import { icon, cx } from './dom';

/**
 * Entity image: portrait if set, else the entity/type icon on a tinted ground.
 * `shape: 'arch'` is Worldsmith's signature frame — a cathedral-window top.
 */
export function avatar(
	parent: HTMLElement,
	app: App,
	entity: EntityRecord,
	schema: EntitySchema | undefined,
	o: { shape?: 'arch' | 'circle' | 'square'; size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'; cls?: string } = {},
): HTMLElement {
	const el = parent.createDiv({
		cls: cx('ws-avatar',
			`ws-avatar--${o.shape ?? 'circle'}`,
			`ws-avatar--${o.size ?? 'sm'}`,
			schema?.color ? `ws-tint--${schema.color}` : 'ws-tint--gray',
			o.cls ?? ''),
	});
	const portrait = entity.media.portrait;
	if (portrait) {
		vaultImage(el, app, portrait, 'ws-avatar__img');
	} else if (entity.media.icon || schema?.icon) {
		icon(el, entity.media.icon || schema?.icon || 'box', 'ws-avatar__icon');
	} else {
		el.createSpan({ cls: 'ws-avatar__initials', text: initials(entity.name) });
	}
	return el;
}
