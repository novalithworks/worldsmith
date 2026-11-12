import { setTooltip } from 'obsidian';
import type { WorldsmithContext } from '../../../../app/context';
import type { BlockInstance, EntitySchema } from '../../../../core/types';
import { relativeTime } from '../../../../core/util/strings';
import type { WorldSession } from '../../../../services/WorldSession';
import type { Route } from '../../../../state/route';
import { avatar } from '../../../components/avatar';
import { button, cx, emptyState, icon, nameRegion } from '../../../components/dom';
import { confirmModal } from '../../../components/modals';
import { actionNotice } from '../../../components/notice';
import { undoLayoutReset } from '../../../layoutUndo';

/** A miniature of a page layout: one tinted cell per widget, placed on the 12-column grid. */
export function layoutMiniature(parent: HTMLElement, ws: WorldsmithContext, schema: EntitySchema, blocks: BlockInstance[], o: { small?: boolean } = {}): HTMLElement {
	const mini = parent.createDiv({ cls: cx('ws-lt__mini', o.small && 'ws-lt__mini--small', schema.color && `ws-tint--${schema.color}`), attr: { role: 'img' } });
	nameRegion(mini, `Layout: ${blocks.map((b) => ws.blocks.get(b.type)?.name ?? b.type).join(', ')}`);
	for (const b of blocks) {
		if (b.hidden) continue;
		const def = ws.blocks.get(b.type);
		const cell = mini.createDiv({ cls: cx('ws-lt__cell', `ws-lt__cell--${b.type}`, !def && 'is-unknown') });
		cell.style.gridColumn = `${b.x + 1} / span ${b.w}`;
		cell.style.gridRow = `${b.y + 1} / span ${b.h}`;
		icon(cell, def?.icon ?? 'puzzle', 'ws-lt__icon');
		const label = b.title ?? (typeof b.config.title === 'string' ? b.config.title : (def?.name ?? b.type));
		if (!o.small) {
			cell.createSpan({ cls: 'ws-lt__label', text: label });
			setTooltip(cell, `${label} · ${b.w} of 12 columns`, { delay: 300 });
		}
	}
	return mini;
}

/**
 * Type Studio → Page layout: a miniature of the type's page layout, where to edit it (on a
 * real entry, so you arrange your own content), reset, and the entries that have a layout
 * of their own.
 */
export function renderLayoutTab(parent: HTMLElement, ws: WorldsmithContext, s: WorldSession, schema: EntitySchema, navigate: (r: Route) => void): void {
	const entries = s.entities
		.all()
		.filter((e) => e.typeId === schema.id && !e.trashedAt)
		.sort((a, b) => b.updatedAt - a.updatedAt);
	const { blocks, custom } = s.layouts.typeLayout(schema);
	const doc = s.layouts.get({ kind: 'type', typeId: schema.id });

	const intro = parent.createDiv({ cls: 'ws-lt__intro' });
	const text = intro.createDiv({ cls: 'ws-lt__text' });
	const status = text.createDiv({ cls: cx('ws-lt__status', custom && 'is-custom') });
	icon(status, custom ? 'layout-dashboard' : 'sparkles');
	status.createSpan({ text: custom ? `Custom layout · changed ${relativeTime(doc?.updatedAt ?? Date.now())}` : 'Worldsmith’s default layout' });
	text.createDiv({
		cls: 'ws-fm__hint',
		text: `Every ${schema.singular.toLowerCase()} page uses this layout unless it has one of its own. You edit it on a real page, so you see your own content while you arrange it.`,
	});

	const actions = intro.createDiv({ cls: 'ws-lt__actions' });
	if (entries.length) {
		const pick = actions.createEl('select', { cls: 'dropdown ws-lt__pick', attr: { 'aria-label': `Edit on which ${schema.singular.toLowerCase()}’s page` } });
		for (const e of entries.slice(0, 60)) pick.createEl('option', { value: e.id, text: e.name });
		button(actions, {
			label: 'Edit layout',
			icon: 'layout-grid',
			variant: 'primary',
			cls: 'ws-lt__edit',
			onClick: () => navigate({ name: 'entity', params: { id: pick.value, edit: 'type' } }),
		});
	} else {
		button(actions, {
			label: `Create a ${schema.singular.toLowerCase()} to edit on`,
			icon: 'plus',
			variant: 'primary',
			onClick: () => {
				const e = s.entityService.create(schema.id, { name: `New ${schema.singular.toLowerCase()}` });
				navigate({ name: 'entity', params: { id: e.id, edit: 'type' } });
			},
		});
	}
	const reset = button(actions, {
		label: 'Reset to default',
		icon: 'rotate-ccw',
		variant: 'ghost',
		cls: 'ws-lt__reset',
		onClick: () => void (async () => {
			const ok = await confirmModal(ws.app, {
				title: `Reset the ${schema.singular} layout?`,
				body: `Every ${schema.singular.toLowerCase()} page goes back to Worldsmith’s default layout. Entries with a layout of their own keep it.`,
				confirmLabel: 'Reset layout',
			});
			if (!ok) return;
			const removed = s.layouts.reset({ kind: 'type', typeId: schema.id });
			if (removed) actionNotice(`The ${schema.singular} layout is back to the default.`, { label: 'Undo', run: () => undoLayoutReset(s, removed, `The ${schema.singular} layout`) });
		})(),
	});
	reset.disabled = !custom;
	button(actions, {
		label: 'Presets & preview',
		icon: 'layout-template',
		variant: 'ghost',
		cls: 'ws-lt__studio',
		tooltip: 'Layout Studio: try ready-made layouts on your own entries, or copy another type’s',
		onClick: () => navigate({ name: 'layout-studio', params: { typeId: schema.id } }),
	});

	const wrap = parent.createDiv({ cls: 'ws-lt' });
	layoutMiniature(wrap, ws, schema, blocks);

	const side = wrap.createDiv({ cls: 'ws-lt__side' });
	side.createDiv({ cls: 'ws-lt__h', text: 'Pages with their own layout' });
	const own = s.layouts.overridesOf(schema.id, (id) => s.entities.get(id));
	if (!own.length) {
		emptyState(side, { icon: 'layout-template', title: 'None yet', body: `To give one ${schema.singular.toLowerCase()} a different page, open Customize on it and choose “Only …”.`, compact: true });
	}
	for (const e of own) {
		const row = side.createDiv({ cls: 'ws-lt__own', attr: { 'data-entity': e.id } });
		const who = row.createDiv({ cls: 'ws-lt__own-who' });
		avatar(who, ws.app, e, schema, { size: 'xs' });
		who.createSpan({ cls: 'ws-lt__own-name', text: e.name });
		const acts = row.createDiv({ cls: 'ws-lt__own-acts' });
		button(acts, { label: 'Open', icon: 'arrow-up-right', variant: 'ghost', size: 'sm', onClick: () => navigate({ name: 'entity', params: { id: e.id } }) });
		button(acts, {
			label: `Use the ${schema.plural} layout`,
			variant: 'ghost',
			size: 'sm',
			cls: 'ws-lt__use-type',
			onClick: () => {
				const removed = s.layouts.reset({ kind: 'entity', entityId: e.id });
				if (removed) actionNotice(`${e.name} now uses the ${schema.plural} layout.`, { label: 'Undo', run: () => undoLayoutReset(s, removed, `${e.name}’s page`) });
			},
		});
	}
	side.createDiv({ cls: 'ws-fm__hint ws-lt__note', text: 'New fields and sections appear on every page automatically — wherever a Details widget shows “every other section”.' });
}
