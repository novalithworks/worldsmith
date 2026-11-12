import { Notice } from 'obsidian';
import { orphanFieldId, orphansOf, type EntityRecord, type OrphanedValue } from '../../core/types';
import { relativeTime } from '../../core/util/strings';
import { setBlockHidden } from '../../layouts/renderer/LayoutRenderer';
import { button, icon } from '../../ui/components/dom';
import type { BlockDefinition } from '../BlockRegistry';
import { currentEntity, watchEntity } from '../util';
import { revealField } from './properties';

/**
 * Values kept after a schema edit made them homeless: the field was deleted, or its kind
 * changed and the value couldn't be converted. Nothing here is ever removed without the
 * user asking. The block hides itself when there's nothing to show.
 */
export const unusedDataBlock: BlockDefinition = {
	id: 'unused-data',
	category: 'Basics',
	name: 'Unused data',
	icon: 'archive-restore',
	description: 'Values left over from deleted or changed fields, ready to restore or discard.',
	surfaces: ['entity'],
	frame: 'card',
	defaultSize: { w: 4, h: 1 },
	defaultConfig: {},
	render(ctx) {
		const entity = ctx.entity;
		if (!entity) return;
		const s = ctx.session;
		const E = s.schemaEdits;
		const root = ctx.el.createDiv({ cls: 'ws-unused' });

		const paint = (e: EntityRecord) => {
			const bag = orphansOf(e.values);
			const keys = Object.keys(bag).sort((a, b) => (bag[b]?.at ?? 0) - (bag[a]?.at ?? 0));
			setBlockHidden(ctx.el, keys.length === 0);
			ctx.setTitle(keys.length ? `Unused data · ${keys.length}` : 'Unused data');
			root.empty();
			if (!keys.length) return;
			root.createDiv({
				cls: 'ws-unused__intro',
				text: 'Kept from fields that were deleted or changed kind, so nothing is lost. Restore what you need; discard the rest.',
			});
			const list = root.createDiv({ cls: 'ws-unused__list', attr: { role: 'list' } });
			for (const key of keys) row(list, e, key, bag[key] as OrphanedValue);
		};

		const row = (list: HTMLElement, e: EntityRecord, key: string, o: OrphanedValue) => {
			const schema = s.schemas.get(e.typeId);
			const fieldId = orphanFieldId(key);
			const field = schema?.fields.find((f) => f.id === fieldId);
			const item = list.createDiv({ cls: 'ws-unused__item', attr: { role: 'listitem', 'data-key': key } });
			const head = item.createDiv({ cls: 'ws-unused__head' });
			icon(head, o.reason === 'deleted' ? 'trash' : 'shuffle', 'ws-unused__icon');
			head.createSpan({ cls: 'ws-unused__label', text: o.label });
			head.createSpan({
				cls: 'ws-unused__why',
				text: o.reason === 'deleted' ? `field deleted ${relativeTime(o.at)}` : `didn’t fit a ${kindLabel(field?.type ?? '')} field`,
			});
			const text = o.text ?? preview(o.value);
			item.createDiv({ cls: 'ws-unused__value', text: text.length > 280 ? `${text.slice(0, 280)}…` : text });

			const actions = item.createDiv({ cls: 'ws-unused__actions' });
			if (field) {
				button(actions, {
					label: 'Restore',
					icon: 'undo-2',
					size: 'sm',
					variant: 'ghost',
					tooltip: `Put this back into “${field.label}”`,
					onClick: () => {
						const res = E.restoreOrphan(e.id, key);
						if (!res.ok) new Notice(res.reason ?? 'Couldn’t restore this value.', 7000);
						else window.setTimeout(() => revealField(ctx.el, field.id), 60);
					},
				});
			} else {
				button(actions, {
					label: 'Restore field',
					icon: 'undo-2',
					size: 'sm',
					variant: 'ghost',
					tooltip: `Re-create the “${o.label}” field and restore its values`,
					onClick: () => {
						try {
							const { field: f, restored } = E.recreateField(e.id, key);
							new Notice(`Restored the “${f.label}” field${restored > 1 ? ` and ${restored} values` : ''}.`);
						} catch (err) {
							new Notice(err instanceof Error ? err.message : String(err), 7000);
						}
					},
				});
			}
			button(actions, {
				icon: 'copy',
				size: 'sm',
				variant: 'quiet',
				tooltip: 'Copy value',
				onClick: () => {
					void navigator.clipboard?.writeText(text).then(
						() => new Notice('Copied.'),
						() => new Notice('Couldn’t copy to the clipboard.'),
					);
				},
			});
			button(actions, {
				icon: 'x',
				size: 'sm',
				variant: 'quiet',
				tooltip: 'Discard',
				onClick: () => {
					const removed = E.discardOrphan(e.id, key);
					if (!removed) return;
					const frag = createFragment();
					const wrap = frag.createDiv({ cls: 'ws-notice' });
					wrap.createSpan({ text: `Discarded the old “${o.label}” value. ` });
					const undo = wrap.createEl('button', { cls: 'ws-notice__action', text: 'Undo' });
					const n = new Notice(frag, 8000);
					undo.addEventListener('click', () => {
						E.putOrphan(e.id, key, removed);
						n.hide();
					});
				},
			});
		};

		const kindLabel = (type: string) => (ctx.ws.fieldTypes.get(type)?.label ?? type).toLowerCase();

		paint(currentEntity(ctx) ?? entity);
		watchEntity(ctx, (e) => paint(e), (k) => k.startsWith('values'));
	},
};

function preview(v: unknown): string {
	if (v == null) return '';
	if (typeof v === 'string') return v;
	if (typeof v === 'number' || typeof v === 'boolean') return String(v);
	if (Array.isArray(v)) return v.map(preview).join(', ');
	try {
		return JSON.stringify(v);
	} catch {
		return String(v);
	}
}
