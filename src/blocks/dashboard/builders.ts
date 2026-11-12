import { Keymap, Menu, Notice, setIcon, setTooltip } from 'obsidian';
import type { EntityRecord, FieldDefinition } from '../../core/types';
import { blockActions } from '../../layouts/renderer/LayoutRenderer';
import { describeQuery, fieldOf, GROUPABLE_KINDS, groupEntries, measure, MEASURES, queryFields, queryFromConfig, runQuery, usableFields, whereFieldMissing, resetDependents, type Group, type Measure } from '../../services/entryQuery';
import { ROUTES } from '../../state/route';
import { openCreateEntity } from '../../ui/actions';
import { avatar } from '../../ui/components/avatar';
import { button, cx, emptyState, icon, progressRing, statusPill } from '../../ui/components/dom';
import { EntitySuggestModal } from '../../ui/components/EntitySuggestModal';
import { cardFieldsOf, renderEntityCard, subtitleFor } from '../../ui/components/entityCard';
import { NotePickerModal, promptModal } from '../../ui/components/modals';
import { vaultImage } from '../../fields/ui/media';
import { safeUrl } from '../../core/util/urls';
import { relativeTime } from '../../core/util/strings';
import { runView } from '../../services/viewQuery';
import { own } from '../../ui/components/lifecycle';
import type { BlockDefinition, BlockRenderContext } from '../BlockRegistry';
import { linkToEntity } from '../util';
import { COLOR_FIELD, colorOf, ICON_FIELD, num, str, watchWorld } from './common';

const CATEGORY = 'Build your own';
/** An entry list that picks its own entries (no saved view). */
const NO_VIEW = '__none';

function savedViewOf(ctx: BlockRenderContext) {
	const id = ctx.config.view;
	return typeof id === 'string' && id !== NO_VIEW ? ctx.session.views.get(id) : undefined;
}

function openType(ctx: BlockRenderContext, typeId: string | null, evt?: MouseEvent): void {
	if (typeId) ctx.navigate(ROUTES.database(typeId), !!evt && Keymap.isModEvent(evt));
}

// ── Entry list ─────────────────────────────────────────────────────────────────

type ListStyle = 'list' | 'cards' | 'table' | 'portraits';

export const entryListBlock: BlockDefinition = {
	id: 'entry-list',
	name: 'Entry list',
	icon: 'list-filter',
	category: CATEGORY,
	description: 'Any entries you choose — by type, status, tag or field — as a list, cards, a table or portraits.',
	hint: 'Your own filtered list',
	surfaces: ['dashboard'],
	frame: 'card',
	defaultSize: { w: 6, h: 1 },
	defaultConfig: { view: NO_VIEW, type: 'character', style: 'list', limit: 8, sort: 'updated', dir: 'auto', only: 'all', whereField: '__none', whereOp: 'is' },
	// Choosing a saved view keeps the rest; otherwise settings that depended on the old type go.
	onSettingChange: (key, config) => (key === 'view' ? config : resetDependents(key, config)),
	configFields: (s, scope) => {
		const config = scope?.config ?? {};
		const views = s.views
			.all()
			.filter((v) => s.schemas.get(v.typeId))
			.sort((a, b) => (s.schemas.get(a.typeId)?.plural ?? '').localeCompare(s.schemas.get(b.typeId)?.plural ?? '') || a.order - b.order);
		const source: FieldDefinition = {
			id: 'view',
			type: 'select',
			label: 'Show',
			width: 'full',
			description: views.length ? 'A saved view brings its own filters, order and columns — and follows them when they change.' : 'Save views on a type’s page (the + next to its tabs) to show them here.',
			config: { options: [{ id: NO_VIEW, label: 'Entries I choose below' }, ...views.map((v) => ({ id: v.id, label: `${s.schemas.get(v.typeId)?.plural ?? ''} › ${v.name}` }))] },
		};
		const style: FieldDefinition = {
			id: 'style',
			type: 'select',
			label: 'Show as',
			config: {
				options: [
					{ id: 'list', label: 'List' },
					{ id: 'cards', label: 'Cards' },
					{ id: 'table', label: 'Table' },
					{ id: 'portraits', label: 'Portrait wall' },
				],
			},
		};
		const limit: FieldDefinition = { id: 'limit', type: 'number', label: 'How many', config: { min: 1, max: 60 } };
		if (typeof config.view === 'string' && config.view !== NO_VIEW && s.views.get(config.view)) return [source, style, limit];
		const q = queryFromConfig(config);
		const schema = q.type ? s.schemas.get(q.type) : undefined;
		const out: FieldDefinition[] = [
			source,
			...queryFields(s, config),
			{
				id: 'style',
				type: 'select',
				label: 'Show as',
				config: {
					options: [
						{ id: 'list', label: 'List' },
						{ id: 'cards', label: 'Cards' },
						{ id: 'table', label: 'Table' },
						{ id: 'portraits', label: 'Portrait wall' },
					],
				},
			},
			{ id: 'limit', type: 'number', label: 'How many', config: { min: 1, max: 60 } },
		];
		if (schema && config.style === 'table') {
			out.push({
				id: 'columns',
				type: 'multiselect',
				label: 'Table columns',
				placeholder: 'The type’s card fields',
				width: 'full',
				config: { options: [{ id: '__status', label: 'Status' }, { id: '__progress', label: 'Development' }, ...usableFields(schema).map((f) => ({ id: f.id, label: f.label }))] },
			});
		}
		return out;
	},
	title: (ctx) => {
		const v = savedViewOf(ctx);
		return v ? v.name : describeQuery(ctx.session, queryFromConfig(ctx.config));
	},
	render(ctx) {
		const s = ctx.session;
		const root = ctx.el.createDiv({ cls: 'ws-elist' });
		// Re-read by paint() when "Pick entries instead" switches a deleted view's list to its own query.
		let viewId = typeof ctx.config.view === 'string' && ctx.config.view !== NO_VIEW ? ctx.config.view : null;
		let q = queryFromConfig(viewId ? { type: s.views.get(viewId)?.typeId ?? ctx.config.type } : ctx.config);
		const style = (['list', 'cards', 'table', 'portraits'].includes(ctx.config.style as string) ? ctx.config.style : 'list') as ListStyle;
		const limit = num(ctx.config.limit, 8, 1, 60);
		const schema = q.type ? s.schemas.get(q.type) : undefined;
		const tableSort = { by: '', dir: 1 };
		const actions = blockActions(ctx.el);
		if (actions && schema) {
			button(actions, { icon: 'plus', variant: 'quiet', size: 'sm', tooltip: `New ${schema.singular.toLowerCase()}`, onClick: () => openCreateEntity(ctx.ws, { typeId: schema.id }) });
		}
		const paint = () => {
			root.empty();
			root.className = cx('ws-elist', `ws-elist--${style}`).join(' ');
			// The type may have been renamed or deleted since the widget was drawn.
			const schema = q.type ? s.schemas.get(q.type) : undefined;
			const saved = viewId ? s.views.get(viewId) : undefined;
			if (viewId && !saved) {
				ctx.setTitle('Entry list');
				emptyState(root, {
					icon: 'filter-x',
					title: 'The saved view this list showed was deleted',
					body: 'Choose another view, or pick the entries yourself, in its settings.',
					actionLabel: 'Pick entries instead',
					actionIcon: 'list-filter',
					onAction: () => {
						ctx.config = { ...ctx.config, view: NO_VIEW };
						ctx.setConfig?.(ctx.config);
						viewId = null;
						q = queryFromConfig(ctx.config);
						paint();
					},
					compact: true,
				});
				return;
			}
			const all = saved ? runView(s, saved) : runQuery(s, q);
			const items = all.slice(0, limit);
			const title = saved ? saved.name : describeQuery(s, q);
			ctx.setTitle(all.length ? `${title} · ${all.length}` : title);
			if (!saved && whereFieldMissing(s, q)) {
				emptyState(root, { icon: 'filter-x', title: 'This list’s filter field was removed', body: 'Pick another condition in its settings (gear in Customize).', compact: true });
				return;
			}
			if (!items.length) {
				emptyState(root, {
					icon: schema?.icon ?? 'list-filter',
					title: 'Nothing matches yet',
					body: ctx.editing ? 'Change what this list shows in its settings (gear).' : `Entries appear here when they match: ${title}.`,
					compact: true,
					...(schema ? { actionLabel: `New ${schema.singular.toLowerCase()}`, onAction: () => openCreateEntity(ctx.ws, { typeId: schema.id }) } : {}),
				});
				return;
			}
			if (style === 'cards') {
				const grid = root.createDiv({ cls: 'ws-elist__cards' });
				for (const e of items) {
					const sc = s.schemas.get(e.typeId);
					if (!sc) continue;
					const card = renderEntityCard(grid, { app: ctx.app, session: s, fieldTypes: ctx.ws.fieldTypes, schema: sc, entity: e, cardImage: ctx.ws.settings.appearance.cardImage });
					linkToEntity(ctx, card, e);
				}
			} else if (style === 'portraits') {
				const wall = root.createDiv({ cls: 'ws-elist__wall' });
				for (const e of items) {
					const sc = s.schemas.get(e.typeId);
					const tile = wall.createDiv({ cls: cx('ws-elist__face', sc?.color && `ws-tint--${sc.color}`) });
					avatar(tile, ctx.app, e, sc, { shape: 'arch', size: 'lg' });
					tile.createDiv({ cls: 'ws-elist__face-name', text: e.name });
					const sub = sc ? subtitleFor(e, sc, ctx.ws.fieldTypes, s.values).split(' • ')[0] : '';
					if (sub) tile.createDiv({ cls: 'ws-elist__face-sub', text: sub });
					linkToEntity(ctx, tile, e);
				}
			} else if (style === 'table') {
				paintTable(ctx, root, items, schema, saved ? (saved.columns?.map((c) => c.id) ?? null) : ctx.config.columns, tableSort, paint);
			} else {
				const list = root.createDiv({ cls: 'ws-mini-list' });
				for (const e of items) {
					const sc = s.schemas.get(e.typeId);
					const row = list.createDiv({ cls: 'ws-mini-list__row' });
					avatar(row, ctx.app, e, sc, { size: 'sm' });
					const t = row.createDiv({ cls: 'ws-mini-list__text' });
					t.createDiv({ cls: 'ws-mini-list__name', text: e.name });
					const sub = sc ? subtitleFor(e, sc, ctx.ws.fieldTypes, s.values) : '';
					t.createDiv({ cls: 'ws-mini-list__meta', text: sub || (q.type ? '' : (sc?.singular ?? '')) || '—' });
					statusPill(row, s.world.statuses.find((x) => x.id === e.status)).addClass('ws-elist__status');
					linkToEntity(ctx, row, e);
				}
			}
			if (all.length > items.length || schema) {
				const foot = root.createDiv({ cls: 'ws-elist__foot' });
				foot.createSpan({ text: all.length > items.length ? `Showing ${items.length} of ${all.length}` : `${all.length} ${all.length === 1 ? 'entry' : 'entries'}` });
				if (schema) {
					const a = foot.createEl('a', { cls: 'ws-link', text: saved ? `Open “${saved.name}”` : `Open ${schema.plural}`, attr: { href: '#' } });
					a.addEventListener('click', (evt) => {
						evt.preventDefault();
						if (saved) ctx.navigate({ name: 'database', params: { typeId: saved.typeId, view: saved.id } }, Keymap.isModEvent(evt));
						else openType(ctx, schema.id, evt);
					});
				}
			}
		};
		paint();
		watchWorld(ctx, paint, { tasks: true, edges: !!viewId, world: (k) => k.includes('statuses') || k.includes('progress') });
		// A saved view changed (filters, order, columns) or was deleted.
		if (viewId) {
			for (const ev of ['view:saved', 'view:deleted'] as const) own(ctx.component, s.events.on(ev, ({ view }) => view.id === viewId && paint()));
		}
	},
};

function paintTable(ctx: BlockRenderContext, root: HTMLElement, items: EntityRecord[], schema: ReturnType<BlockRenderContext['session']['schemas']['get']>, columns: unknown, sortState: { by: string; dir: number }, repaint: () => void): void {
	const s = ctx.session;
	const wanted = Array.isArray(columns) ? (columns as string[]) : [];
	const cols: Array<{ id: string; label: string; field?: FieldDefinition }> = [];
	if (schema) {
		const ids = wanted.length ? wanted : ['__status', ...cardFieldsOf(schema, ctx.ws.fieldTypes).map((f) => f.id)];
		for (const id of ids) {
			if (id === '__status') cols.push({ id, label: 'Status' });
			else if (id === '__progress') cols.push({ id, label: 'Developed' });
			else if (id === '__updated') cols.push({ id, label: 'Last edited' });
			else if (id === '__created') cols.push({ id, label: 'Created' });
			else if (id === '__connections') cols.push({ id, label: 'Connections' });
			else if (id === '__tags') cols.push({ id, label: 'Tags' });
			else {
				const f = schema.fields.find((x) => x.id === id);
				if (f) cols.push({ id, label: f.label, field: f });
			}
		}
	} else cols.push({ id: '__type', label: 'Type' }, { id: '__status', label: 'Status' });
	const textOf = (e: EntityRecord, id: string): string => {
		if (id === 'name') return e.name;
		if (id === '__type') return s.schemas.get(e.typeId)?.singular ?? '';
		if (id === '__status') return s.world.statuses.find((x) => x.id === e.status)?.label ?? '';
		if (id === '__progress') return String(Math.round(s.entityService.progress(e).ratio * 100)).padStart(3, '0');
		if (id === '__updated') return String(e.updatedAt);
		if (id === '__created') return String(e.createdAt);
		if (id === '__connections') return String(s.relations.count(e.id)).padStart(6, '0');
		if (id === '__tags') return e.tags.map((t) => `#${t}`).join(' ');
		const f = fieldOf(s, e.typeId, id);
		return f ? s.values.text(e, f) : '';
	};
	// Clicking a heading re-sorts what's shown; the widget's own order is the default.
	const rows = sortState.by
		? [...items].sort((a, b) => {
				const ta = textOf(a, sortState.by);
				const tb = textOf(b, sortState.by);
				if (!ta !== !tb) return ta ? -1 : 1; // blanks last either way
				return sortState.dir * ta.localeCompare(tb, undefined, { numeric: true, sensitivity: 'base' });
			})
		: items;
	const wrap = root.createDiv({ cls: 'ws-roster' }).createDiv({ cls: 'ws-table-wrap ws-roster__wrap' });
	const table = wrap.createEl('table', { cls: 'ws-table ws-roster__table' });
	const head = table.createEl('thead').createEl('tr');
	const th = (id: string, label: string) => {
		const cell = head.createEl('th', { attr: { scope: 'col' } });
		const b = cell.createEl('button', { cls: 'ws-table__sort', attr: { type: 'button' } });
		b.createSpan({ text: label });
		if (sortState.by === id) {
			cell.setAttr('aria-sort', sortState.dir > 0 ? 'ascending' : 'descending');
			icon(b, sortState.dir > 0 ? 'arrow-up' : 'arrow-down', 'ws-table__sort-icon');
		}
		b.addEventListener('click', () => {
			if (sortState.by === id && sortState.dir < 0) sortState.by = '';
			else {
				sortState.dir = sortState.by === id ? -1 : 1;
				sortState.by = id;
			}
			repaint();
		});
	};
	th('name', 'Name');
	for (const c of cols) th(c.id, c.label);
	const body = table.createEl('tbody');
	for (const e of rows) {
		const sc = s.schemas.get(e.typeId);
		const tr = body.createEl('tr', { cls: 'ws-table__row', attr: { 'data-entity': e.id } });
		const name = tr.createEl('td').createDiv({ cls: 'ws-table__name' });
		avatar(name, ctx.app, e, sc, { size: 'xs' });
		name.createSpan({ text: e.name });
		for (const c of cols) {
			const td = tr.createEl('td');
			if (c.id === '__status') {
				const st = s.world.statuses.find((x) => x.id === e.status);
				if (st) td.createSpan({ cls: cx('ws-roster__status', `ws-tint--${st.color}`), text: st.label });
				continue;
			}
			const text =
				c.id === '__progress'
					? `${Math.round(s.entityService.progress(e).ratio * 100)}%`
					: c.id === '__updated' || c.id === '__created'
						? relativeTime(c.id === '__updated' ? e.updatedAt : e.createdAt)
						: c.id === '__connections'
							? String(s.relations.count(e.id))
							: textOf(e, c.id);
			if (text) td.setText(text);
			else td.createSpan({ cls: 'ws-field-display is-empty', text: '—' });
		}
		linkToEntity(ctx, tr, e);
	}
}

// ── Number ─────────────────────────────────────────────────────────────────────

export const entryStatBlock: BlockDefinition = {
	id: 'entry-stat',
	name: 'Number',
	icon: 'hash',
	category: CATEGORY,
	description: 'One big number about your world: how many, a total, an average or a percentage.',
	hint: 'Count, total, average or %',
	surfaces: ['dashboard'],
	frame: 'plain',
	defaultSize: { w: 3, h: 1 },
	defaultConfig: { type: 'character', measure: 'count', label: '', compare: true, color: '__type', icon: '__type', only: 'all', whereField: '__none', whereOp: 'is' },
	onSettingChange: resetDependents,
	configFields: (s, scope) => {
		const config = scope?.config ?? {};
		const q = queryFromConfig(config);
		const schema = q.type ? s.schemas.get(q.type) : undefined;
		// Measures over a field need one type to pick the field from.
		const measures = schema ? MEASURES : MEASURES.filter((x) => !x.needsField);
		const m = measures.find((x) => x.id === config.measure) ?? measures[0]!;
		const out: FieldDefinition[] = [
			{ id: 'label', type: 'text', label: 'Label', placeholder: 'e.g. Characters', width: 'full' },
			{
				id: 'measure',
				type: 'select',
				label: 'Show',
				description: schema ? undefined : 'Pick one type below to total, average or check one of its fields.',
				config: { options: measures.map((x) => ({ id: x.id, label: x.label })) },
			},
		];
		if (m.needsField && schema) {
			const kinds = m.id === 'filled' ? undefined : new Set(['number', 'percent', 'rating', 'text']);
			const fields = usableFields(schema, kinds);
			out.push(
				fields.length
					? { id: 'field', type: 'select', label: 'Field', config: { options: fields.map((f) => ({ id: f.id, label: f.label })) } }
					: { id: 'field', type: 'text', label: 'Field', description: `${schema.plural} have no number fields yet — add one in Type Studio.` },
			);
		}
		out.push(...queryFields(s, config, { sort: false }));
		out.push({ id: 'caption', type: 'boolean', label: 'Show the detail line under the number' });
		if (m.id === 'count' && config.caption !== false) out.push({ id: 'compare', type: 'boolean', label: 'Detail line: how many are new this month' });
		out.push(ICON_FIELD, COLOR_FIELD);
		return out;
	},
	render(ctx) {
		const s = ctx.session;
		const root = ctx.el.createDiv({ cls: 'ws-stats ws-stats--single' });
		const paint = () => {
			root.empty();
			const q = queryFromConfig(ctx.config);
			const m = (MEASURES.some((x) => x.id === ctx.config.measure) ? ctx.config.measure : 'count') as Measure;
			const fieldId = str(ctx.config.field) || null;
			const entries = runQuery(s, q, { sorted: false });
			const def = MEASURES.find((x) => x.id === m)!;
			// Field measures need one type (the dialog only offers them then).
			const unusable = (def.needsField && !q.type) || whereFieldMissing(s, q);
			const r = unusable ? { value: null, display: '—', ratio: null, n: 0 } : measure(s, entries, m, fieldId);
			const schema = q.type ? s.schemas.get(q.type) : undefined;
			const color = ctx.config.color === '__type' || !ctx.config.color ? (schema?.color ?? 'purple') : colorOf(ctx.config.color, schema?.color ?? 'purple');
			const iconName = str(ctx.config.icon) && ctx.config.icon !== '__type' ? str(ctx.config.icon) : (schema?.icon ?? 'hash');
			const field = fieldId && q.type ? fieldOf(s, q.type, fieldId) : undefined;
			const label =
				str(ctx.config.label).trim() ||
				(m === 'count'
					? describeQuery(s, q)
					: m === 'progress'
						? `${schema?.plural ?? 'World'} developed`
						: field
							? { sum: `Total ${field.label.toLowerCase()}`, avg: `Average ${field.label.toLowerCase()}`, min: `Lowest ${field.label.toLowerCase()}`, max: `Highest ${field.label.toLowerCase()}`, filled: `${field.label} filled in` }[m]
							: 'Number');
			// Only a tile about one type leads somewhere (its database); others aren't buttons.
			const el = q.type
				? root.createEl('button', { cls: cx('ws-stat', `ws-tint--${color}`, r.ratio !== null && 'has-ring'), attr: { type: 'button' } })
				: root.createDiv({ cls: cx('ws-stat', `ws-tint--${color}`, r.ratio !== null && 'has-ring') });
			const lab = el.createDiv({ cls: 'ws-stat__label' });
			icon(lab, iconName);
			lab.createSpan({ text: label });
			el.createDiv({ cls: 'ws-stat__value', text: r.display });
			let sub = '';
			const filtered = q.statuses.length || q.tags.length || q.where || q.only !== 'all';
			if (m === 'count' && ctx.config.compare !== false && !filtered) {
				const start = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
				const fresh = entries.filter((e) => e.createdAt >= start).length;
				sub = fresh ? `+${fresh} this month` : 'none new this month';
			} else if (m === 'count') {
				const total = runQuery(s, { ...q, statuses: [], tags: [], where: null, only: 'all' }, { sorted: false }).length;
				sub = `of ${total.toLocaleString()} ${(schema?.plural ?? 'entries').toLowerCase()}`;
			} else if (m === 'progress' || m === 'filled') sub = `across ${r.n} ${r.n === 1 ? 'entry' : 'entries'}`;
			else if (r.n) sub = `from ${r.n} ${r.n === 1 ? 'entry' : 'entries'}`;
			else sub = field ? `no numbers in ${field.label.toLowerCase()} yet` : 'choose a field in settings';
			if (whereFieldMissing(s, q)) sub = 'its filter field was removed';
			else if (def.needsField && !q.type) sub = 'pick one type in settings';
			if (ctx.config.caption !== false) el.createDiv({ cls: 'ws-stat__sub', text: sub });
			if (r.ratio !== null) progressRing(el.createDiv({ cls: 'ws-stat__ring' }), r.ratio, 46);
			setTooltip(el, describeQuery(s, q), { delay: 500 });
			if (q.type) el.addEventListener('click', (evt) => openType(ctx, q.type, evt as MouseEvent));
		};
		paint();
		watchWorld(ctx, paint, { tasks: ctx.config.measure === 'progress' });
	},
};

// ── Chart ──────────────────────────────────────────────────────────────────────

type ChartStyle = 'bars' | 'donut';

export const entryChartBlock: BlockDefinition = {
	id: 'entry-chart',
	name: 'Chart',
	icon: 'pie-chart',
	category: CATEGORY,
	description: 'Entries grouped by status, tag or any choice field — as bars or a donut.',
	hint: 'Bars or a donut of any field',
	surfaces: ['dashboard'],
	frame: 'card',
	defaultSize: { w: 6, h: 1 },
	defaultConfig: { type: 'character', groupBy: 'status', style: 'bars', max: 8, only: 'all', whereField: '__none', whereOp: 'is' },
	onSettingChange: resetDependents,
	configFields: (s, scope) => {
		const config = scope?.config ?? {};
		const q = queryFromConfig(config);
		const schema = q.type ? s.schemas.get(q.type) : undefined;
		const groups = [
			{ id: 'status', label: 'Status' },
			...(q.type ? [] : [{ id: 'type', label: 'Type' }]),
			{ id: 'tag', label: 'Tags' },
			...usableFields(schema, GROUPABLE_KINDS).map((f) => ({ id: `field:${f.id}`, label: f.label })),
		];
		return [
			{ id: 'groupBy', type: 'select', label: 'Group by', config: { options: groups } },
			{ id: 'style', type: 'select', label: 'Chart', config: { options: [{ id: 'bars', label: 'Bars' }, { id: 'donut', label: 'Donut' }] } },
			{ id: 'max', type: 'number', label: 'Most groups shown', description: 'The rest are added up as “Other”.', config: { min: 3, max: 16 } },
			{ id: 'hideEmpty', type: 'boolean', label: 'Leave out entries with no value' },
			...queryFields(s, config, { sort: false }),
		];
	},
	title: (ctx) => {
		const s = ctx.session;
		const q = queryFromConfig(ctx.config);
		const by = str(ctx.config.groupBy, 'status');
		const what = q.type ? (s.schemas.get(q.type)?.plural ?? 'Entries') : 'Entries';
		const label = by === 'status' ? 'status' : by === 'type' ? 'type' : by === 'tag' ? 'tag' : (q.type && fieldOf(s, q.type, by.slice(6))?.label.toLowerCase()) || 'field';
		return `${what} by ${label}`;
	},
	render(ctx) {
		const s = ctx.session;
		const root = ctx.el.createDiv({ cls: 'ws-echart' });
		const paint = () => {
			root.empty();
			const q = queryFromConfig(ctx.config);
			const by = str(ctx.config.groupBy, 'status');
			const style = (ctx.config.style === 'donut' ? 'donut' : 'bars');
			const max = num(ctx.config.max, 8, 3, 16);
			const entries = runQuery(s, q, { sorted: false });
			if (whereFieldMissing(s, q)) {
				emptyState(root, { icon: 'filter-x', title: 'This chart’s filter field was removed', body: 'Pick another condition in its settings.', compact: true });
				return;
			}
			if (by.startsWith('field:') && q.type && !fieldOf(s, q.type, by.slice(6))) {
				emptyState(root, { icon: 'pie-chart', title: 'Choose what to group by', body: 'The field this chart used was removed. Pick another in its settings.', compact: true });
				return;
			}
			let groups = groupEntries(s, entries, by);
			if (ctx.config.hideEmpty === true) groups = groups.filter((g) => g.key !== '__none');
			if (!groups.length) {
				emptyState(root, { icon: 'pie-chart', title: 'Nothing to chart yet', body: `No entries match: ${describeQuery(s, q)}.`, compact: true });
				return;
			}
			if (groups.length > max) {
				const keep = groups.slice(0, max - 1);
				const rest = groups.slice(max - 1);
				keep.push({ key: '__other', label: `Other (${rest.length})`, color: 'gray', entries: [...new Set(rest.flatMap((g) => g.entries))] });
				groups = keep;
			}
			// Percentages are of entries, not of slices: with tags or multi-choice fields an
			// entry sits in several groups, so the slices can add up to more than 100%.
			const total = Math.max(1, entries.length);
			const tip = (g: (typeof groups)[number]) => {
				const names = g.entries.slice(0, 6).map((e) => e.name);
				return `${g.label}: ${g.entries.length} (${Math.round((g.entries.length / total) * 100)}%)${names.length ? `\n${names.join(', ')}${g.entries.length > names.length ? '…' : ''}` : ''}`;
			};
			if (style === 'donut') {
				paintDonut(root, groups, total, tip);
				return;
			}
			const most = Math.max(1, ...groups.map((g) => g.entries.length));
			const bars = root.createDiv({ cls: 'ws-echart__bars', attr: { role: 'list' } });
			for (const g of groups) {
				const row = bars.createDiv({ cls: cx('ws-echart__row', g.key === '__none' && 'is-none'), attr: { role: 'listitem' } });
				const name = row.createDiv({ cls: 'ws-echart__name' });
				if (g.color) name.createSpan({ cls: cx('ws-echart__dot', `ws-tint--${g.color}`) });
				name.createSpan({ text: g.label });
				const track = row.createDiv({ cls: 'ws-echart__track' });
				track.createDiv({ cls: 'ws-echart__fill' }).style.width = `${(g.entries.length / most) * 100}%`;
				row.createDiv({ cls: 'ws-echart__num', text: String(g.entries.length) });
				setTooltip(row, tip(g), { delay: 150 });
			}
			root.createDiv({ cls: 'ws-echart__foot', text: `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'} · ${describeQuery(s, q)}` });
		};
		paint();
		watchWorld(ctx, paint, { edges: str(ctx.config.groupBy).startsWith('field:'), world: (k) => k.includes('statuses') });
	},
};

/** Fallback hues for groups without their own colour, in a fixed order (never cycled by rank). */
const DONUT_ORDER = ['purple', 'blue', 'cyan', 'green', 'yellow', 'orange', 'red', 'pink'] as const;

function paintDonut(root: HTMLElement, groups: Group[], total: number, tip: (g: Group) => string): void {
	// The ring itself shares out the slices (which may overlap); labels use `total` entries.
	const ring = Math.max(1, groups.reduce((a, g) => a + g.entries.length, 0));
	const wrap = root.createDiv({ cls: 'ws-echart__donut' });
	const ns = 'http://www.w3.org/2000/svg';
	const svg = document.createElementNS(ns, 'svg');
	svg.setAttribute('viewBox', '0 0 120 120');
	svg.setAttribute('class', 'ws-echart__svg');
	svg.setAttribute('role', 'img');
	svg.setAttribute('aria-label', groups.map((g) => `${g.label} ${g.entries.length}`).join(', '));
	wrap.appendChild(svg);
	const r = 46;
	const circ = 2 * Math.PI * r;
	const gap = groups.length > 1 ? 2.2 : 0;
	let offset = 0;
	let fallback = 0;
	const colors = groups.map((g) => (g.key === '__none' || g.key === '__other' ? 'gray' : (g.color ?? DONUT_ORDER[fallback++ % DONUT_ORDER.length])));
	const legend = wrap.createDiv({ cls: 'ws-echart__legend' });
	groups.forEach((g, i) => {
		const len = (g.entries.length / ring) * circ;
		const c = document.createElementNS(ns, 'circle');
		c.setAttribute('cx', '60');
		c.setAttribute('cy', '60');
		c.setAttribute('r', String(r));
		c.setAttribute('class', `ws-echart__seg ws-tint--${colors[i]}`);
		c.setAttribute('stroke-dasharray', `${Math.max(0.5, len - gap)} ${circ}`);
		c.setAttribute('stroke-dashoffset', String(-offset));
		c.setAttribute('transform', 'rotate(-90 60 60)');
		const title = document.createElementNS(ns, 'title');
		title.textContent = tip(g);
		c.appendChild(title);
		svg.appendChild(c);
		offset += len;
		const k = legend.createDiv({ cls: cx('ws-echart__key', `ws-tint--${colors[i]}`) });
		k.createSpan({ cls: 'ws-echart__swatch' });
		k.createSpan({ cls: 'ws-echart__key-label', text: g.label });
		k.createSpan({ cls: 'ws-echart__key-num', text: `${g.entries.length}` });
		k.createSpan({ cls: 'ws-echart__key-pct', text: `${Math.round((g.entries.length / total) * 100)}%` });
		setTooltip(k, tip(g), { delay: 150 });
		const hot = (on: boolean) => c.classList.toggle('is-hot', on);
		k.addEventListener('mouseenter', () => hot(true));
		k.addEventListener('mouseleave', () => hot(false));
	});
	const center = wrap.createDiv({ cls: 'ws-echart__center' });
	center.createDiv({ cls: 'ws-echart__total', text: total.toLocaleString() });
	center.createDiv({ cls: 'ws-echart__total-label', text: total === 1 ? 'entry' : 'entries' });
}

// ── Entry card ─────────────────────────────────────────────────────────────────

export const featuredEntryBlock: BlockDefinition = {
	id: 'featured-entry',
	name: 'Entry card',
	icon: 'contact',
	category: CATEGORY,
	description: 'One entry you choose, shown large: image, summary and key facts.',
	hint: 'Pin one entry, large',
	surfaces: ['dashboard'],
	frame: 'plain',
	defaultSize: { w: 6, h: 1 },
	defaultConfig: { entityId: '', image: 'auto', summary: true },
	configFields: [
		{ id: 'image', type: 'select', label: 'Image', config: { options: [{ id: 'auto', label: 'Banner, else portrait' }, { id: 'portrait', label: 'Portrait' }, { id: 'banner', label: 'Banner' }, { id: 'none', label: 'No image' }] } },
		{ id: 'summary', type: 'boolean', label: 'Show the summary' },
	],
	render(ctx) {
		const s = ctx.session;
		const root = ctx.el.createDiv({ cls: 'ws-feature' });
		const pick = () =>
			new EntitySuggestModal(ctx.app, s, (e) => {
				ctx.config = { ...ctx.config, entityId: e.id };
				ctx.setConfig?.(ctx.config);
				paint();
			}, { placeholder: 'Which entry should this card show?' }).open();
		const paint = () => {
			root.empty();
			const e = s.entities.get(str(ctx.config.entityId));
			if (!e || e.trashedAt) {
				root.className = 'ws-feature is-empty';
				emptyState(root, {
					icon: 'contact',
					title: e ? 'This entry is in the trash' : 'Choose an entry',
					body: 'Feature a main character, the capital, the current villain…',
					actionLabel: 'Choose an entry',
					onAction: pick,
					compact: true,
				});
				return;
			}
			const schema = s.schemas.get(e.typeId);
			root.className = cx('ws-feature', schema?.color && `ws-tint--${schema.color}`).join(' ');
			// A fresh element per paint, so click handlers never pile up on the root.
			const card = root.createDiv({ cls: 'ws-feature__card' });
			const mode = str(ctx.config.image, 'auto');
			const banner = (mode === 'auto' || mode === 'banner') && e.media.banner;
			if (banner && e.media.banner) {
				const b = card.createDiv({ cls: 'ws-feature__banner' });
				vaultImage(b, ctx.app, e.media.banner, 'ws-feature__img');
			}
			const body = card.createDiv({ cls: 'ws-feature__body' });
			if (mode !== 'none' && mode !== 'banner') avatar(body, ctx.app, e, schema, { shape: 'arch', size: banner || !e.media.portrait ? 'lg' : 'xl', cls: 'ws-feature__portrait' });
			const text = body.createDiv({ cls: 'ws-feature__text' });
			const eyebrow = text.createDiv({ cls: 'ws-feature__eyebrow' });
			if (schema) icon(eyebrow, schema.icon);
			eyebrow.createSpan({ text: schema?.singular ?? '' });
			text.createDiv({ cls: 'ws-feature__name', text: e.name });
			const sub = schema ? subtitleFor(e, schema, ctx.ws.fieldTypes, s.values) : '';
			if (sub) text.createDiv({ cls: 'ws-feature__sub', text: sub });
			if (ctx.config.summary !== false && e.description) {
				const plain = e.description.replace(/[*_`#>[\]]/g, '').replace(/\s+/g, ' ').trim();
				text.createDiv({ cls: 'ws-feature__summary', text: plain.length > 260 ? `${plain.slice(0, 257)}…` : plain });
			}
			if (schema) {
				const facts = text.createDiv({ cls: 'ws-feature__facts' });
				for (const f of cardFieldsOf(schema, ctx.ws.fieldTypes).slice(0, 4)) {
					if (schema.display.subtitleFields.includes(f.id)) continue;
					const v = s.values.text(e, f);
					if (!v) continue;
					const fact = facts.createDiv({ cls: 'ws-feature__fact' });
					fact.createDiv({ cls: 'ws-feature__fact-label', text: f.label });
					fact.createDiv({ cls: 'ws-feature__fact-value', text: v });
				}
			}
			const tools = card.createDiv({ cls: 'ws-feature__tools' });
			button(tools, { icon: 'replace', variant: 'quiet', size: 'sm', tooltip: 'Show a different entry', onClick: pick });
			linkToEntity(ctx, card, e);
		};
		paint();
		own2(ctx, paint);
	},
};

function own2(ctx: BlockRenderContext, paint: () => void): void {
	watchWorld(ctx, paint, { entities: (k) => k.some((x) => ['name', 'media', 'description', 'values', 'trashedAt', 'status'].includes(x)) });
}

// ── Links ──────────────────────────────────────────────────────────────────────

interface LinkItem {
	id: string;
	kind: 'entry' | 'note' | 'url' | 'page';
	target: string;
	label?: string;
}

const PAGES: Array<{ id: string; label: string; icon: string }> = [
	{ id: 'tasks', label: 'Tasks', icon: 'list-checks' },
	{ id: 'search', label: 'Search', icon: 'search' },
	{ id: 'media', label: 'Media library', icon: 'images' },
	{ id: 'relationships', label: 'Relationship types', icon: 'git-merge' },
	{ id: 'type-studio', label: 'Type Studio', icon: 'shapes' },
	{ id: 'layout-studio', label: 'Layout Studio', icon: 'layout-template' },
	{ id: 'calendars', label: 'Calendars', icon: 'calendar-range' },
	{ id: 'timeline', label: 'Timeline', icon: 'gantt-chart' },
	{ id: 'health', label: 'World health', icon: 'heart-pulse' },
	{ id: 'maps', label: 'Maps', icon: 'map' },
	{ id: 'trees', label: 'Trees', icon: 'network' },
	{ id: 'graph', label: 'Graph', icon: 'share-2' },
	{ id: 'transfer', label: 'Import & export', icon: 'arrow-down-up' },
	{ id: 'trash', label: 'Trash', icon: 'trash-2' },
];

function linksOf(v: unknown): LinkItem[] {
	if (!Array.isArray(v)) return [];
	return v.filter((x): x is LinkItem => !!x && typeof x === 'object' && typeof (x as LinkItem).id === 'string' && typeof (x as LinkItem).target === 'string' && ['entry', 'note', 'url', 'page'].includes((x as LinkItem).kind));
}

export const linksBlock: BlockDefinition = {
	id: 'links',
	name: 'Links',
	icon: 'bookmark',
	category: CATEGORY,
	description: 'Your own shortcuts: entries, notes, pages of Worldsmith and websites.',
	hint: 'Shortcuts you collect',
	surfaces: ['dashboard'],
	frame: 'card',
	defaultSize: { w: 4, h: 1 },
	defaultConfig: { links: [] },
	render(ctx) {
		const s = ctx.session;
		const root = ctx.el.createDiv({ cls: 'ws-links' });
		const save = (links: LinkItem[]) => {
			ctx.config = { ...ctx.config, links };
			ctx.setConfig?.(ctx.config);
			paint();
		};
		const add = (item: Omit<LinkItem, 'id'>) => save([...linksOf(ctx.config.links), { ...item, id: Math.random().toString(36).slice(2, 9) }]);
		/** Opens below `anchor` (the + button, or the empty state's button). */
		const addMenu = (anchor: HTMLElement | null) => {
			const m = new Menu();
			m.addItem((i) => i.setTitle('An entry…').setIcon('user').onClick(() => new EntitySuggestModal(ctx.app, s, (e) => add({ kind: 'entry', target: e.id })).open()));
			m.addItem((i) => i.setTitle('A note…').setIcon('file-text').onClick(() => new NotePickerModal(ctx.app, (f) => add({ kind: 'note', target: f.path })).open()));
			m.addItem((i) =>
				i
					.setTitle('A website…')
					.setIcon('globe')
					.onClick(async () => {
						const url = await promptModal(ctx.app, { title: 'Add a website', label: 'Address', placeholder: 'https://…', confirmLabel: 'Add' });
						if (!url?.trim()) return;
						const clean = safeUrl(url);
						if (!clean) {
							new Notice('Links can be web addresses (https://…), mailto: or obsidian:// links.');
							return;
						}
						const label = await promptModal(ctx.app, { title: 'Name this link', label: 'Name', value: clean.replace(/^https?:\/\/(www\.)?/, '').split('/')[0] ?? clean, confirmLabel: 'Add' });
						add({ kind: 'url', target: clean, label: label?.trim() || undefined });
					}),
			);
			m.addSeparator();
			for (const p of PAGES) m.addItem((i) => i.setTitle(p.label).setIcon(p.icon).onClick(() => add({ kind: 'page', target: p.id })));
			const r = (anchor ?? root).getBoundingClientRect();
			m.showAtPosition({ x: r.left, y: r.bottom + 4 });
		};
		const actions = blockActions(ctx.el);
		if (actions) {
			const plus = button(actions, { icon: 'plus', variant: 'quiet', size: 'sm', tooltip: 'Add a link', onClick: () => addMenu(plus) });
		}
		const paint = () => {
			root.empty();
			const links = linksOf(ctx.config.links);
			if (!links.length) {
				emptyState(root, { icon: 'bookmark', title: 'No links yet', body: 'Collect the entries, notes and sites you open most.', actionLabel: 'Add a link', onAction: () => addMenu(root.querySelector<HTMLElement>('.ws-empty button')), compact: true });
				return;
			}
			const list = root.createDiv({ cls: 'ws-links__list' });
			links.forEach((l, i) => {
				let label = l.label ?? '';
				let iconName = 'link';
				let sub = '';
				let missing = false;
				let tint: string | null = null;
				if (l.kind === 'entry') {
					const e = s.entities.get(l.target);
					const sc = e ? s.schemas.get(e.typeId) : undefined;
					label ||= e?.name ?? 'Missing entry';
					iconName = e?.media.icon || sc?.icon || 'file-question';
					sub = sc?.singular ?? '';
					tint = sc?.color ?? null;
					missing = !e || !!e.trashedAt;
				} else if (l.kind === 'note') {
					const f = ctx.app.vault.getAbstractFileByPath(l.target);
					label ||= (l.target.split('/').pop() ?? l.target).replace(/\.md$/, '');
					iconName = 'file-text';
					sub = 'Note';
					missing = !f;
				} else if (l.kind === 'url') {
					label ||= l.target;
					iconName = 'globe';
					sub = l.target.replace(/^https?:\/\/(www\.)?/, '').split('/')[0] ?? '';
				} else {
					const p = PAGES.find((x) => x.id === l.target);
					label ||= p?.label ?? l.target;
					iconName = p?.icon ?? 'layout-dashboard';
					sub = 'Worldsmith';
				}
				const row = list.createDiv({ cls: cx('ws-links__row', missing && 'is-missing', tint && `ws-tint--${tint}`), attr: { tabindex: '0', role: 'link' } });
				icon(row, iconName, 'ws-links__icon');
				const t = row.createDiv({ cls: 'ws-links__text' });
				t.createDiv({ cls: 'ws-links__label', text: label });
				if (sub) t.createDiv({ cls: 'ws-links__sub', text: missing ? 'Not found' : sub });
				if (l.kind === 'url') icon(row, 'arrow-up-right', 'ws-links__out');
				const open = (evt: MouseEvent | KeyboardEvent) => {
					const nl = Keymap.isModEvent(evt);
					if (l.kind === 'entry') ctx.navigate(ROUTES.entity(l.target), nl);
					else if (l.kind === 'note') void ctx.app.workspace.openLinkText(l.target, '', nl);
					else if (l.kind === 'url') {
						const url = safeUrl(l.target);
						if (url) window.open(url);
					}
					else ctx.navigate({ name: l.target }, nl);
				};
				row.addEventListener('click', (evt) => {
					if ((evt.target as HTMLElement).closest('button')) return;
					open(evt);
				});
				row.addEventListener('keydown', (evt) => evt.key === 'Enter' && open(evt));
				const menu = (evt: MouseEvent) => {
					evt.preventDefault();
					const m = new Menu();
					m.addItem((it) =>
						it
							.setTitle('Rename…')
							.setIcon('pencil')
							.onClick(async () => {
								const name = await promptModal(ctx.app, { title: 'Rename link', value: label, confirmLabel: 'Rename' });
								if (name === null) return;
								save(links.map((x, j) => (j === i ? { ...x, label: name.trim() || undefined } : x)));
							}),
					);
					if (i > 0) m.addItem((it) => it.setTitle('Move up').setIcon('arrow-up').onClick(() => save(swap(links, i, i - 1))));
					if (i < links.length - 1) m.addItem((it) => it.setTitle('Move down').setIcon('arrow-down').onClick(() => save(swap(links, i, i + 1))));
					m.addItem((it) => it.setTitle('Remove').setIcon('x').setWarning(true).onClick(() => save(links.filter((_, j) => j !== i))));
					m.showAtMouseEvent(evt);
				};
				row.addEventListener('contextmenu', menu);
				const more = row.createEl('button', { cls: 'ws-links__more clickable-icon', attr: { type: 'button', 'aria-label': 'Link options' } });
				setIcon(more, 'more-horizontal');
				more.addEventListener('click', menu);
			});
		};
		paint();
		watchWorld(ctx, paint, { entities: (k) => k.includes('name') || k.includes('trashedAt') || k.includes('media') });
	},
};

function swap<T>(list: T[], a: number, b: number): T[] {
	const out = [...list];
	[out[a], out[b]] = [out[b] as T, out[a] as T];
	return out;
}

