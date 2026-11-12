import { Keymap, Menu, setIcon, setTooltip } from 'obsidian';
import type { DetailsLayout } from '../../settings/settings';
import type { EntityRecord, FieldDefinition } from '../../core/types';
import type { FieldEditorHandle } from '../../fields/FieldType';
import type { SectionView } from '../../services/SchemaService';
import { button, emptyState, icon, cx } from '../../ui/components/dom';
import { entityFieldMenu, openAddField } from '../../ui/schemaActions';
import { ROUTES } from '../../state/route';
import type { BlockDefinition, BlockRenderContext } from '../BlockRegistry';
import { blockActions, setBlockHidden } from '../../layouts/renderer/LayoutRenderer';
import { currentEntity, watchEntity } from '../util';
import { own } from '../../ui/components/lifecycle';

/** Section collapse/disclosure state, remembered per type for the session. */
const sectionCollapsed = new Map<string, boolean>();
const advancedOpen = new Map<string, boolean>();

/** Event dispatched on the page root to bring a field into view and focus it. */
export const REVEAL_FIELD_EVENT = 'worldsmith-reveal-field';

export const propertiesBlock: BlockDefinition = {
	id: 'properties',
	category: 'Basics',
	name: 'Details',
	icon: 'list',
	description: 'This entry’s fields, grouped by section and edited in place.',
	surfaces: ['entity'],
	frame: 'card',
	defaultSize: { w: 8, h: 1 },
	defaultConfig: { sections: null, columns: 2, layout: 'auto' },
	configFields: (_s, scope) => [
		...(scope?.schema
			? [
					{
						id: 'sections',
						type: 'multiselect',
						label: 'Sections shown',
						description: 'Leave empty to show the sections this widget shows by default.',
						width: 'full' as const,
						// “Other” collects fields that aren't in any section.
						config: { options: [...scope.schema.sections.map((x) => ({ id: x.id, label: x.label })), { id: '__other', label: 'Other (fields in no section)' }] },
					},
				]
			: []),
		{ id: 'layout', type: 'select', label: 'Layout', config: { options: [{ id: 'auto', label: 'Follow the page setting' }, { id: 'grid', label: 'Always grid' }, { id: 'rows', label: 'Always list' }] } },
		{ id: 'columns', type: 'select', label: 'Grid columns', config: { options: [{ id: '1', label: '1' }, { id: '2', label: '2' }] } },
	],
	title: (ctx) => (typeof ctx.config.title === 'string' ? ctx.config.title : 'Details'),
	render(ctx) {
		const entity = ctx.entity;
		const schema = ctx.schema;
		if (!entity || !schema) return;
		const s = ctx.session;
		// `sections` picks sections by id; `exclude` shows everything else (so sections added
		// later in Type Studio still appear somewhere on the page).
		const wanted = Array.isArray(ctx.config.sections) ? (ctx.config.sections as string[]) : null;
		// Sections picked by hand win over the built-in "everything else" list.
		const excluded = !wanted && Array.isArray(ctx.config.exclude) ? (ctx.config.exclude as string[]) : [];
		const views = s.schemas
			.sections(schema)
			.filter((v) => (!wanted || wanted.includes(v.section.id)) && !excluded.includes(v.section.id));
		const single = ctx.config.columns === 1 || ctx.config.columns === '1';
		const appearance = ctx.ws.settings.appearance;
		/** Block setting (fixed) → this entry's choice → its type's default → the Worldsmith default. */
		const typeKey = `${s.worldId}:${schema.id}`;
		const typeDefault = (): DetailsLayout => appearance.detailsLayoutByType[typeKey] ?? appearance.detailsLayout ?? 'grid';
		const resolveLayout = (): DetailsLayout => {
			if (ctx.config.layout === 'grid' || ctx.config.layout === 'rows') return ctx.config.layout;
			return appearance.detailsLayoutByEntry[entity.id] ?? typeDefault();
		};
		let layout = resolveLayout();
		const root = ctx.el.createDiv({ cls: cx('ws-props', `ws-props--${layout}`, single && 'ws-props--single') });
		const applyLayout = () => {
			const next = resolveLayout();
			if (next === layout) return;
			layout = next;
			root.removeClass('ws-props--grid', 'ws-props--rows');
			root.addClass(`ws-props--${layout}`);
			paintSwitch();
		};

		// Layout switch in the block header: this page, or every page.
		// One switch per page is enough (the character page has two Details panels).
		const firstOnPage = !ctx.el.closest('.ws-page')?.querySelector('.ws-props-switch');
		const actions = firstOnPage ? blockActions(ctx.el) : null;
		const switchBtn = actions ? button(actions, { icon: 'layout-grid', variant: 'quiet', size: 'sm', cls: 'ws-props-switch', onClick: (evt) => layoutMenu(evt) }) : null;
		const LABEL: Record<DetailsLayout, string> = { grid: 'grid', rows: 'list' };
		const paintSwitch = () => {
			if (!switchBtn) return;
			switchBtn.empty();
			icon(switchBtn, layout === 'grid' ? 'layout-grid' : 'list', 'ws-btn__icon');
			const from = appearance.detailsLayoutByEntry[entity.id] ? 'this page' : appearance.detailsLayoutByType[typeKey] ? `all ${schema.plural}` : 'default';
			const label = `Layout: ${LABEL[layout]} (${from})`;
			switchBtn.setAttr('aria-label', label);
			setTooltip(switchBtn, label, { delay: 300 });
		};
		const save = () => void ctx.ws.saveSettings();
		const layoutMenu = (evt: MouseEvent) => {
			const pageOwn = appearance.detailsLayoutByEntry[entity.id];
			const typeOwn = appearance.detailsLayoutByType[typeKey];
			const fixed = ctx.config.layout === 'grid' || ctx.config.layout === 'rows';
			const m = new Menu();
			const options = [
				['grid', 'Grid — labels above', 'layout-grid'],
				['rows', 'List — labels beside', 'list'],
			] as const;

			// 1. This page
			m.addItem((i) => i.setTitle(pageOwn ? 'This page' : `This page — following ${typeOwn ? `all ${schema.plural}` : 'the default'}`).setIsLabel(true));
			for (const [id, title, ic] of options) {
				m.addItem((i) =>
					i
						.setTitle(title)
						.setIcon(ic)
						.setChecked(layout === id)
						.setDisabled(fixed)
						.onClick(() => {
							// Matching what the page would get anyway means "follow", not "override".
							if (id === typeDefault()) delete appearance.detailsLayoutByEntry[entity.id];
							else appearance.detailsLayoutByEntry[entity.id] = id;
							save();
							applyLayout();
						}),
				);
			}
			if (pageOwn) {
				m.addItem((i) =>
					i.setTitle(`Follow all ${schema.plural}`).setIcon('rotate-ccw').onClick(() => {
						delete appearance.detailsLayoutByEntry[entity.id];
						save();
						applyLayout();
					}),
				);
			}

			// 2. This type
			m.addSeparator();
			m.addItem((i) => i.setTitle(typeOwn ? `All ${schema.plural}` : `All ${schema.plural} — following the default`).setIsLabel(true));
			for (const [id, title] of options) {
				m.addItem((i) =>
					i
						.setTitle(title)
						.setChecked(typeDefault() === id)
						.onClick(() => {
							if (id === appearance.detailsLayout) delete appearance.detailsLayoutByType[typeKey];
							else appearance.detailsLayoutByType[typeKey] = id;
							// If this page only differed to get this layout, it can follow the type again.
							if (appearance.detailsLayoutByEntry[entity.id] === typeDefault()) delete appearance.detailsLayoutByEntry[entity.id];
							save();
							applyLayout();
						}),
				);
			}
			if (typeOwn) {
				m.addItem((i) =>
					i.setTitle('Follow the default').setIcon('rotate-ccw').onClick(() => {
						delete appearance.detailsLayoutByType[typeKey];
						save();
						applyLayout();
					}),
				);
			}

			// 3. Everything
			m.addSeparator();
			m.addItem((i) => i.setTitle('Default for every type').setIsLabel(true));
			for (const [id, title] of options) {
				m.addItem((i) =>
					i
						.setTitle(title)
						.setChecked(appearance.detailsLayout === id)
						.onClick(() => {
							appearance.detailsLayout = id;
							save();
							applyLayout();
						}),
				);
			}
			m.showAtMouseEvent(evt);
		};
		paintSwitch();
		own(ctx.component, ctx.ws.events.on('settings:changed', applyLayout));

		if (views.length === 0) {
			// A block showing a subset of sections simply disappears when that subset is empty.
			if (wanted || excluded.length) {
				setBlockHidden(ctx.el, true);
				return;
			}
			emptyState(root, {
				icon: 'list-plus',
				title: 'No fields here yet',
				body: `Give every ${schema.singular.toLowerCase()} its own fields in Type Studio.`,
				actionLabel: 'Open Type Studio',
				actionIcon: 'shapes',
				onAction: () => ctx.navigate(ROUTES.typeStudio(schema.id, { tab: 'fields' })),
				compact: true,
			});
			return;
		}

		const editors = new Map<string, { handle: FieldEditorHandle; row: HTMLElement; field: FieldDefinition }>();
		const counters: Array<{ el: HTMLElement; view: SectionView }> = [];
		const sectionEls = new Map<string, { el: HTMLElement; setCollapsed(c: boolean): void; openAdvanced(): void }>();

		for (const view of views) {
			const key = `${schema.id}:${view.section.id}`;
			const sec = root.createDiv({ cls: 'ws-section', attr: { 'data-section': view.section.id } });
			const bar = sec.createDiv({ cls: 'ws-section__bar' });
			const head = bar.createEl('button', { cls: 'ws-section__head', attr: { type: 'button', 'aria-expanded': 'true' } });
			const caret = head.createSpan({ cls: 'ws-section__caret' });
			setIcon(caret, 'chevron-down');
			if (view.section.icon) icon(head, view.section.icon, 'ws-section__icon');
			head.createSpan({ cls: 'ws-section__label', text: view.section.label });
			const count = head.createSpan({ cls: 'ws-section__count' });
			counters.push({ el: count, view });
			if (view.section.description) setTooltip(head, view.section.description, { delay: 500 });
			const realSection = view.section.id === '__other' ? null : view.section.id;
			const acts = bar.createDiv({ cls: 'ws-section__actions' });
			button(acts, {
				icon: 'plus',
				variant: 'quiet',
				size: 'sm',
				tooltip: `Add a field to ${view.section.label}`,
				onClick: () => openAddField(ctx.ws, s, s.schemas.get(schema.id) ?? schema, realSection),
			});
			button(acts, {
				icon: 'shapes',
				variant: 'quiet',
				size: 'sm',
				tooltip: 'Edit in Type Studio',
				onClick: (evt) => ctx.navigate(ROUTES.typeStudio(schema.id, { tab: 'fields', section: realSection ?? undefined }), Keymap.isModEvent(evt)),
			});

			const bodyEl = sec.createDiv({ cls: 'ws-section__body' });
			const grid = bodyEl.createDiv({ cls: 'ws-fields' });
			for (const f of view.fields) mountField(grid, f);
			markColumns(grid);

			let openAdv = () => {};
			if (view.advancedFields.length) {
				const more = bodyEl.createDiv({ cls: 'ws-more' });
				const toggle = more.createEl('button', { cls: 'ws-more__toggle', attr: { type: 'button', 'aria-expanded': 'false' } });
				const mcaret = toggle.createSpan({ cls: 'ws-more__caret' });
				setIcon(mcaret, 'chevron-right');
				const label = toggle.createSpan();
				const advGrid = more.createDiv({ cls: 'ws-fields ws-more__fields' });
				let mounted = false;
				const apply = () => {
					const open = advancedOpen.get(key) ?? false;
					more.toggleClass('is-open', open);
					toggle.setAttr('aria-expanded', String(open));
					label.setText(open ? 'Fewer fields' : `${view.advancedFields.length} more field${view.advancedFields.length === 1 ? '' : 's'}`);
					// Mount lazily: most people never open every disclosure.
					if (open && !mounted) {
						mounted = true;
						for (const f of view.advancedFields) mountField(advGrid, f);
						markColumns(advGrid);
					}
				};
				toggle.addEventListener('click', () => {
					advancedOpen.set(key, !(advancedOpen.get(key) ?? false));
					apply();
				});
				openAdv = () => {
					advancedOpen.set(key, true);
					apply();
				};
				apply();
			}

			const setCollapsed = (c: boolean) => {
				sectionCollapsed.set(key, c);
				sec.toggleClass('is-collapsed', c);
				head.setAttr('aria-expanded', String(!c));
			};
			setCollapsed(sectionCollapsed.get(key) ?? !!view.section.collapsed);
			head.addEventListener('click', () => setCollapsed(!(sectionCollapsed.get(key) ?? false)));
			sectionEls.set(view.section.id, { el: sec, setCollapsed, openAdvanced: openAdv });
		}

		function mountField(grid: HTMLElement, field: FieldDefinition) {
			const type = ctx.ws.fieldTypes.for(field);
			const width = field.width ?? type.defaultWidth ?? 'half';
			const row = grid.createDiv({ cls: ['ws-prop', `ws-prop--${width}`], attr: { 'data-field-id': field.id } });
			const label = row.createDiv({ cls: 'ws-prop__label' });
			const labelText = label.createSpan({ cls: 'ws-prop__label-text', text: field.label });
			if (field.required) label.createSpan({ cls: 'ws-prop__req', text: '*', attr: { 'aria-label': 'required' } });
			if (field.description) setTooltip(labelText, field.description, { delay: 400 });
			const openMenu = (evt: MouseEvent) => {
				const fresh = s.schemas.get(schema!.id);
				const f = fresh?.fields.find((x) => x.id === field.id);
				if (fresh && f) entityFieldMenu(ctx.ws, s, fresh, f, { entityId: entity!.id, navigate: (r) => ctx.navigate(r) }).showAtMouseEvent(evt);
			};
			const menuBtn = label.createEl('button', { cls: 'ws-prop__menu', attr: { type: 'button', 'aria-label': `${field.label} field options` } });
			setIcon(menuBtn, 'more-horizontal');
			menuBtn.addEventListener('click', (evt) => {
				evt.stopPropagation();
				openMenu(evt);
			});
			label.addEventListener('contextmenu', (evt) => {
				evt.preventDefault();
				openMenu(evt);
			});
			const valueEl = row.createDiv({ cls: 'ws-prop__value' });
			const msg = row.createDiv({ cls: 'ws-prop__msg' });

			const e = currentEntity(ctx) as EntityRecord;
			if (!type.ui) {
				valueEl.createSpan({ cls: 'ws-field-display is-empty', text: 'This field type has no editor.' });
				return;
			}
			const handle = type.ui.createEditor(valueEl, {
				app: ctx.app,
				field,
				entity: e,
				component: ctx.component,
				host: { ws: ctx.ws, session: s, navigate: (r, nl) => ctx.navigate(r, nl) },
				value: s.values.get(e, field),
				onChange: (v) => {
					const res = s.entityService.setFieldValue(entity!.id, field.id, v);
					row.toggleClass('is-invalid', !res.ok);
					row.toggleClass('has-warning', res.ok && !!res.warning);
					msg.setText(res.error ?? res.warning ?? '');
				},
			});
			editors.set(field.id, { handle, row, field });
			markEmpty(row, field, e);
		}

		/**
		 * Grid layout: mark each right-hand field of a two-field row so CSS can draw the
		 * column divider beside it, and mark where each run of paired rows starts and ends
		 * so the line fades in and out instead of stopping abruptly at full-width fields.
		 */
		function markColumns(grid: HTMLElement) {
			if (single) return;
			const props = Array.from(grid.children).filter((el): el is HTMLElement => el.instanceOf(HTMLElement) && el.hasClass('ws-prop'));
			const rows: HTMLElement[][] = [];
			let cur: HTMLElement[] = [];
			for (const p of props) {
				p.removeClass('is-pair-right', 'is-run-start', 'is-run-end');
				if (p.hasClass('ws-prop--full')) {
					if (cur.length) rows.push(cur);
					rows.push([p]);
					cur = [];
					continue;
				}
				cur.push(p);
				if (cur.length === 2) {
					rows.push(cur);
					cur = [];
				}
			}
			if (cur.length) rows.push(cur);
			rows.forEach((r, i) => {
				const right = r[1];
				if (!right) return;
				right.addClass('is-pair-right');
				if (rows[i - 1]?.length !== 2) right.addClass('is-run-start');
				if (rows[i + 1]?.length !== 2) right.addClass('is-run-end');
			});
		}

		/** Empty fields show one quiet "Empty" until hovered or focused (CSS). */
		function markEmpty(row: HTMLElement, field: FieldDefinition, e: EntityRecord) {
			row.toggleClass('is-empty', ctx.ws.fieldTypes.isEmpty(field, s.values.get(e, field)));
		}

		const paintCounts = (e: EntityRecord) => {
			for (const { el, view } of counters) {
				// Links count as filled once linked; other computed kinds aren't "filled in".
				const all = [...view.fields, ...view.advancedFields].filter((f) => {
					const t = ctx.ws.fieldTypes.for(f);
					return !t.computed || t.category === 'relation';
				});
				const filled = all.filter((f) => !ctx.ws.fieldTypes.isEmpty(f, s.values.get(e, f))).length;
				el.setText(all.length ? `${filled}/${all.length}` : '');
				el.toggleClass('is-complete', all.length > 0 && filled === all.length);
				el.style.setProperty('--ws-fill', all.length ? `${Math.round((filled / all.length) * 100)}%` : '0%');
			}
			for (const { row, field } of editors.values()) markEmpty(row, field, e);
		};
		paintCounts(entity);

		watchEntity(
			ctx,
			(e, keys) => {
				for (const k of keys) {
					if (!k.startsWith('values.')) continue;
					editors.get(k.slice(7))?.handle.setValue(e.values[k.slice(7)]);
				}
				paintCounts(e);
			},
			(k) => k.startsWith('values.') || k === 'parentId',
		);
		// Linked fields fill and empty as connections change.
		const recount = () => {
			const e = currentEntity(ctx);
			if (e) paintCounts(e);
		};
		const touches = (edge: { from: string; to: string }) => edge.from === entity.id || edge.to === entity.id;
		own(ctx.component, s.events.on('edge:created', ({ edge }) => touches(edge) && recount()));
		own(ctx.component, s.events.on('edge:deleted', ({ edge }) => touches(edge) && recount()));

		// Reveal requests (e.g. from the progress block's "next up" list).
		const page = ctx.el.closest('.ws-page');
		if (page) {
			const onReveal = (evt: Event) => {
				const fieldId = (evt as CustomEvent<{ fieldId: string }>).detail.fieldId;
				const view = views.find((v) => [...v.fields, ...v.advancedFields].some((f) => f.id === fieldId));
				if (!view) return;
				const sec = sectionEls.get(view.section.id);
				sec?.setCollapsed(false);
				if (view.advancedFields.some((f) => f.id === fieldId)) sec?.openAdvanced();
				const ed = editors.get(fieldId);
				if (!ed) return;
				ed.row.scrollIntoView({ behavior: 'smooth', block: 'center' });
				ed.row.addClass('is-flash');
				window.setTimeout(() => ed.row.removeClass('is-flash'), 1200);
				window.setTimeout(() => ed.handle.focus(), 250);
			};
			page.addEventListener(REVEAL_FIELD_EVENT, onReveal);
			ctx.component.register(() => page.removeEventListener(REVEAL_FIELD_EVENT, onReveal));
		}
	},
};

export function revealField(from: HTMLElement, fieldId: string): void {
	from.closest('.ws-page')?.dispatchEvent(new CustomEvent(REVEAL_FIELD_EVENT, { detail: { fieldId } }));
}

export type { BlockRenderContext };
