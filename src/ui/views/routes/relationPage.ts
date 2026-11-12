import { Component, Keymap, Menu, Notice, setIcon } from 'obsidian';
import type { EdgePatch, EntityRecord, FieldDefinition, RelationEdge, RelationType } from '../../../core/types';
import type { FieldEditorHandle } from '../../../fields/FieldType';
import { ROUTES } from '../../../state/route';
import { avatar } from '../../components/avatar';
import { button, cx, emptyState, icon } from '../../components/dom';
import { own } from '../../components/lifecycle';
import { actionNotice } from '../../components/notice';
import type { RouteDefinition } from './RouteRegistry';

/** Built-in properties every connection has, described as ordinary fields. */
const EDGE_FIELDS: Array<FieldDefinition & { key: keyof EdgePatch }> = [
	{
		key: 'status',
		id: 'status',
		type: 'select',
		label: 'Status',
		width: 'third',
		config: {
			options: [
				{ id: 'active', label: 'Active', color: 'green' },
				{ id: 'strained', label: 'Strained', color: 'orange' },
				{ id: 'ended', label: 'Ended', color: 'gray' },
				{ id: 'unknown', label: 'Unknown', color: 'purple' },
			],
		},
	},
	{ key: 'strength', id: 'strength', type: 'rating', label: 'Strength', width: 'third', config: { max: 5 } },
	{ key: 'secret', id: 'secret', type: 'boolean', label: 'Secret', width: 'third', description: 'Known only to the two of them (or to you).' },
	{ key: 'start', id: 'start', type: 'chrono', label: 'Began', width: 'half' },
	{ key: 'end', id: 'end', type: 'chrono', label: 'Ended', width: 'half' },
	{ key: 'description', id: 'description', type: 'text', label: 'Summary', width: 'full', placeholder: 'One line about this connection — shown on both entries' },
];

const NOTES_FIELD: FieldDefinition = { id: 'notes', type: 'richtext', label: 'Notes', width: 'full', placeholder: 'How did it start? What does each of them want from it?' };

/**
 * A connection's own page: who it links, how each side sees it, its details, notes and
 * the custom properties of its relationship type.
 */
export const relationRoute: RouteDefinition = {
	id: 'relation',
	needsWorld: true,
	title: (p, s) => {
		const e = s?.relations.edge(p.id ?? '');
		if (!e || !s) return 'Connection';
		return `${s.entities.get(e.from)?.name ?? '?'} & ${s.entities.get(e.to)?.name ?? '?'}`;
	},
	icon: (p, s) => s?.relations.type(s.relations.edge(p.id ?? '')?.type)?.icon ?? 'link-2',
	render(ctx) {
		const s = ctx.session!;
		const R = s.relations;
		const id = ctx.params.id ?? '';
		const page = ctx.el.createDiv({ cls: 'ws-page ws-page--relation' });
		let scope = new Component();
		ctx.component.addChild(scope);
		const editors = new Map<string, FieldEditorHandle>();

		const draw = () => {
			ctx.component.removeChild(scope);
			scope = new Component();
			ctx.component.addChild(scope);
			editors.clear();
			page.empty();
			const edge = R.edge(id);
			const from = edge ? s.entities.get(edge.from) : undefined;
			const to = edge ? s.entities.get(edge.to) : undefined;
			if (!edge || !from || !to) {
				emptyState(page, {
					icon: 'unlink',
					title: 'This connection no longer exists',
					body: 'It was removed, or one of its entries was deleted.',
					actionLabel: 'Back to dashboard',
					actionIcon: 'home',
					onAction: () => ctx.navigate(ROUTES.dashboard()),
				});
				return;
			}
			const type = R.type(edge.type);
			ctx.setTitle(`${from.name} & ${to.name}`);
			header(edge, type, from, to);
			details(edge, type, from);
		};

		const header = (edge: RelationEdge, type: RelationType | undefined, from: EntityRecord, to: EntityRecord) => {
			const head = page.createDiv({ cls: 'ws-relpage__head' });
			const eyebrow = head.createDiv({ cls: 'ws-relpage__eyebrow' });
			icon(eyebrow, type?.icon ?? 'link-2');
			const typeBtn = eyebrow.createEl('button', { cls: 'ws-link-btn', attr: { type: 'button' }, text: type?.label ?? edge.type });
			typeBtn.addEventListener('click', () => ctx.navigate(ROUTES.relationships(edge.type)));
			if (type?.symmetric) eyebrow.createSpan({ cls: 'ws-relpage__both', text: 'goes both ways' });

			const pair = head.createDiv({ cls: 'ws-relpage__pair' });
			party(pair, from, to, type ? (type.symmetric ? type.forwardLabel : type.reverseLabel) : '');
			const mid = pair.createDiv({ cls: 'ws-relpage__arrow', attr: { 'aria-hidden': 'true' } });
			setIcon(mid, type?.symmetric ? 'arrow-left-right' : 'arrow-right');
			party(pair, to, from, type?.forwardLabel ?? '');

			const actions = head.createDiv({ cls: 'ws-relpage__actions' });
			if (!type?.symmetric) {
				button(actions, {
					label: 'Swap direction',
					icon: 'arrow-left-right',
					variant: 'ghost',
					size: 'sm',
					onClick: () => {
						try {
							R.swap(edge.id);
						} catch (e) {
							new Notice(e instanceof Error ? e.message : String(e));
						}
					},
				});
			}
			button(actions, {
				label: 'Change relationship',
				icon: 'replace',
				variant: 'ghost',
				size: 'sm',
				onClick: (evt) => {
					const m = new Menu();
					let last = '';
					for (const t of R.types()) {
						if (t.category !== last) {
							m.addItem((i) => i.setTitle(t.category).setIsLabel(true));
							last = t.category;
						}
						m.addItem((i) =>
							i
								.setTitle(t.symmetric ? t.label : `${t.label} (${t.forwardLabel} / ${t.reverseLabel})`)
								.setIcon(t.icon ?? 'link-2')
								.setChecked(t.id === edge.type)
								.onClick(() => {
									try {
										R.changeType(edge.id, t.id);
									} catch (e) {
										new Notice(e instanceof Error ? e.message : String(e));
									}
								}),
						);
					}
					m.showAtMouseEvent(evt);
				},
			});
			button(actions, {
				label: 'Remove',
				icon: 'trash-2',
				variant: 'danger',
				size: 'sm',
				onClick: () => {
					const removed = R.unlink(edge.id);
					if (!removed) return;
					ctx.navigate(ROUTES.entity(from.id));
					actionNotice('Connection removed.', { label: 'Undo', run: () => R.restore([removed]) });
				},
			});
		};

		/** One side: the entry, and where the *other* entry lists it. */
		const party = (parent: HTMLElement, e: EntityRecord, other: EntityRecord, listedAs: string) => {
			const schema = s.schemas.get(e.typeId);
			const card = parent.createEl('button', { cls: cx('ws-relpage__party', schema?.color ? `ws-tint--${schema.color}` : 'ws-tint--gray'), attr: { type: 'button' } });
			avatar(card, ctx.ws.app, e, schema, { shape: 'arch', size: 'lg' });
			card.createDiv({ cls: 'ws-relpage__name', text: e.name });
			card.createDiv({ cls: 'ws-relpage__type', text: schema?.singular ?? '' });
			if (listedAs) card.createDiv({ cls: 'ws-relpage__listed', text: `Listed under ${other.name}’s ${listedAs}` });
			card.addEventListener('click', (evt) => ctx.navigate(ROUTES.entity(e.id), Keymap.isModEvent(evt)));
		};

		const details = (edge: RelationEdge, type: RelationType | undefined, from: EntityRecord) => {
			const card = page.createDiv({ cls: 'ws-block ws-block--card ws-relpage__card' });
			const body = card.createDiv({ cls: 'ws-block__body' });
			const grid = body.createDiv({ cls: 'ws-props' }).createDiv({ cls: 'ws-fields' });
			for (const f of EDGE_FIELDS) {
				mount(grid, f, edge[f.key as keyof RelationEdge], (v) => patch({ [f.key]: v }), from);
			}
			if (type?.fields.length) {
				const extra = body.createDiv({ cls: 'ws-props ws-relpage__custom' });
				const h = extra.createDiv({ cls: 'ws-relpage__section' });
				h.setText(`${type.label} details`);
				const g2 = extra.createDiv({ cls: 'ws-fields' });
				for (const f of type.fields) mount(g2, f, edge.props[f.id], (v) => patch({ props: { [f.id]: v } }), from, `props.${f.id}`);
			}
			const notes = page.createDiv({ cls: 'ws-block ws-block--card ws-relpage__card' });
			const nb = notes.createDiv({ cls: 'ws-block__body' });
			const ng = nb.createDiv({ cls: 'ws-props' }).createDiv({ cls: 'ws-fields' });
			mount(ng, NOTES_FIELD, edge.notes, (v) => patch({ notes: typeof v === 'string' ? v : '' }), from);
		};

		const mount = (grid: HTMLElement, f: FieldDefinition, value: unknown, save: (v: unknown) => void, entity: EntityRecord, key = f.id) => {
			const kind = ctx.ws.fieldTypes.for(f);
			const row = grid.createDiv({ cls: ['ws-prop', `ws-prop--${f.width ?? kind.defaultWidth ?? 'half'}`], attr: { 'data-field-id': f.id } });
			row.createDiv({ cls: 'ws-prop__label', text: f.label });
			const val = row.createDiv({ cls: 'ws-prop__value' });
			const msg = row.createDiv({ cls: 'ws-prop__msg' });
			if (!kind.ui) return;
			const handle = kind.ui.createEditor(val, {
				app: ctx.ws.app,
				field: f,
				entity,
				component: scope,
				value: value ?? undefined,
				onChange: (v) => {
					if (kind.isEmpty(v)) {
						row.removeClass('is-invalid');
						msg.setText('');
						return save(null);
					}
					const res = kind.coerce(v, f);
					row.toggleClass('is-invalid', !res.ok);
					msg.setText(res.ok ? '' : `Not a valid ${kind.label.toLowerCase()}`);
					if (res.ok) save(res.value);
				},
			});
			editors.set(key, handle);
		};

		let selfEdit = 0;
		const patch = (p: EdgePatch) => {
			selfEdit++;
			try {
				R.updateEdge(id, p);
			} finally {
				selfEdit--;
			}
		};

		draw();
		own(
			ctx.component,
			s.events.on('edge:updated', ({ edge, keys }) => {
				if (edge.id !== id) return;
				// Structural changes redraw; value edits patch the editors in place.
				if (keys.some((k) => k === 'from' || k === 'to' || k === 'type')) return draw();
				if (selfEdit) return;
				for (const k of keys) {
					const h = editors.get(k);
					if (!h) continue;
					const v = k.startsWith('props.') ? edge.props[k.slice(6)] : (edge as unknown as Record<string, unknown>)[k];
					h.setValue(v ?? undefined);
				}
			}),
		);
		own(ctx.component, s.events.on('edge:deleted', ({ edge }) => edge.id === id && draw()));
		own(ctx.component, s.events.on('edge:created', ({ edge }) => edge.id === id && draw()));
		own(ctx.component, s.events.on('relationType:updated', ({ type }) => type.id === R.edge(id)?.type && draw()));
		own(
			ctx.component,
			s.events.on('entity:updated', ({ entity, change }) => {
				const e = R.edge(id);
				if (e && (entity.id === e.from || entity.id === e.to) && change.keys.some((k) => k === 'name' || k === 'media')) draw();
			}),
		);
	},
};
