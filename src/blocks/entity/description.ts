import type { FieldDefinition } from '../../core/types';
import { richTextUI } from '../../fields/ui/textual';
import type { BlockDefinition } from '../BlockRegistry';
import { watchEntity } from '../util';

const DESCRIPTION_FIELD: FieldDefinition = {
	id: '__description',
	type: 'richtext',
	label: 'Summary',
	placeholder: 'Write a short summary — who or what this is, in a few sentences.',
};

/** The core description every entity has, rendered as Markdown. */
export const descriptionBlock: BlockDefinition = {
	id: 'description',
	category: 'Basics',
	name: 'Summary',
	icon: 'align-left',
	description: 'The entity’s core description, in Markdown.',
	surfaces: ['entity'],
	frame: 'card',
	defaultSize: { w: 8, h: 1 },
	defaultConfig: {},
	render(ctx) {
		const entity = ctx.entity;
		if (!entity) return;
		const wrap = ctx.el.createDiv({ cls: 'ws-description' });
		const handle = richTextUI.createEditor(wrap, {
			app: ctx.app,
			field: DESCRIPTION_FIELD,
			entity,
			component: ctx.component,
			value: entity.description,
			onChange: (v) => ctx.session.entityService.update(entity.id, { description: typeof v === 'string' ? v : '' }),
		});
		watchEntity(ctx, (e) => handle.setValue(e.description), (k) => k === 'description');
	},
};
