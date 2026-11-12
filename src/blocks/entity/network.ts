import { Keymap, setTooltip } from 'obsidian';
import type { EntityRecord, EntitySchema, FieldDefinition, LinkedEntry } from '../../core/types';
import type { EdgeView } from '../../services/RelationService';
import type { WorldSession } from '../../services/WorldSession';
import { ROUTES } from '../../state/route';
import { blockActions } from '../../layouts/renderer/LayoutRenderer';
import { avatar } from '../../ui/components/avatar';
import { button, cx, emptyState, icon } from '../../ui/components/dom';
import { own } from '../../ui/components/lifecycle';
import { openAddConnection } from '../../ui/relationActions';
import type { BlockDefinition, BlockRenderContext } from '../BlockRegistry';
import { currentEntity } from '../util';
import { revealField } from './properties';

const HOSTILE = new Set(['rivalry', 'enmity', 'hostility']);
const RELATION_KINDS = ['relation', 'children'];

/** Repaint (once per frame) when this entry, its connections, or linked entries change. */
function watchNetwork(ctx: BlockRenderContext, paint: () => void, deep = false): void {
	let queued = false;
	const schedule = () => {
		if (queued) return;
		queued = true;
		window.requestAnimationFrame(() => {
			queued = false;
			paint();
		});
	};
	const s = ctx.session;
	const id = ctx.entity?.id;
	own(ctx.component, s.events.on('entity:updated', ({ entity, change }) => {
		if (entity.id === id || deep || change.keys.some((k) => k === 'name' || k === 'media' || k === 'trashedAt')) schedule();
	}));
	own(ctx.component, s.events.on('entity:deleted', schedule));
	for (const ev of ['edge:created', 'edge:deleted', 'edge:updated'] as const) {
		own(ctx.component, s.events.on(ev, ({ edge }) => (deep || edge.from === id || edge.to === id) && schedule()));
	}
}

function open(ctx: BlockRenderContext, id: string, evt: MouseEvent | KeyboardEvent): void {
	ctx.navigate(ROUTES.entity(id), Keymap.isModEvent(evt));
}

/** One row per connected entry (several connections to the same entry are merged). */
function neighbours(s: WorldSession, entityId: string): Array<{ other: EntityRecord; views: EdgeView[] }> {
	const map = new Map<string, { other: EntityRecord; views: EdgeView[] }>();
	for (const v of s.relations.viewsOf(entityId)) {
		if (v.other.id === entityId) continue;
		const cur = map.get(v.other.id) ?? { other: v.other, views: [] };
		cur.views.push(v);
		map.set(v.other.id, cur);
	}
	return [...map.values()];
}

// ── Relationship web ───────────────────────────────────────────────────────────

export const relationshipWebBlock: BlockDefinition = {
	id: 'relationship-web',
	name: 'Graph',
	icon: 'network',
	category: 'Connections',
	description: 'A small diagram: this entry in the middle, its connections around it. Click any name to go there.',
	hint: 'Connections as a diagram',
	surfaces: ['entity'],
	frame: 'card',
	defaultSize: { w: 8, h: 1 },
	defaultConfig: { max: 14, size: 'medium', labels: true },
	configFields: [
		{ id: 'max', type: 'number', label: 'Most entries shown', config: { min: 3, max: 30 } },
		{ id: 'size', type: 'select', label: 'Height', config: { options: [{ id: 'small', label: 'Small' }, { id: 'medium', label: 'Medium' }, { id: 'large', label: 'Large' }] } },
		{ id: 'labels', type: 'boolean', label: 'Show how each is connected' },
	],
	title: () => 'Relationships',
	render(ctx) {
		const s = ctx.session;
		const entity = ctx.entity;
		if (!entity) return;
		const size = ['small', 'medium', 'large'].includes(ctx.config.size as string) ? (ctx.config.size as string) : 'medium';
		const root = ctx.el.createDiv({ cls: cx('ws-web', `ws-web--${size}`) });
		const actions = blockActions(ctx.el);
		if (actions) {
			button(actions, {
				icon: 'plus',
				variant: 'quiet',
				size: 'sm',
				tooltip: 'Add a connection',
				onClick: () => {
					const e = currentEntity(ctx);
					if (e) openAddConnection(ctx.ws, s, e);
				},
			});
		}
		const paint = () => {
			root.empty();
			const e = currentEntity(ctx);
			if (!e) return;
			const all = neighbours(s, e.id).sort((a, b) => (a.views[0]?.label ?? '').localeCompare(b.views[0]?.label ?? '') || a.other.name.localeCompare(b.other.name));
			if (!all.length) {
				// Nothing left to draw: drop the legend and the count from the last paint.
				ctx.el.querySelector('.ws-web__foot')?.remove();
				ctx.setTitle('Relationships');
				root.addClass('is-empty');
				emptyState(root, {
					icon: 'network',
					title: 'No connections yet',
					body: 'Link entries through fields like Friends or Members, or add any connection.',
					actionLabel: 'Add a connection',
					onAction: () => openAddConnection(ctx.ws, s, e),
					compact: true,
				});
				return;
			}
			root.removeClass('is-empty');
			const max = Math.max(3, Math.min(30, typeof ctx.config.max === 'number' ? ctx.config.max : 14));
			const shown = all.slice(0, max);
			const ns = 'http://www.w3.org/2000/svg';
			const svg = document.createElementNS(ns, 'svg');
			svg.setAttribute('class', 'ws-web__lines');
			svg.setAttribute('viewBox', '0 0 100 100');
			svg.setAttribute('preserveAspectRatio', 'none');
			svg.setAttribute('aria-hidden', 'true');
			root.appendChild(svg);

			const n = shown.length;
			const lines: SVGLineElement[] = [];
			shown.forEach((nb, i) => {
				// Evenly around an ellipse, starting at the top; a slight stagger keeps
				// neighbouring labels from colliding when there are many.
				const angle = -Math.PI / 2 + (2 * Math.PI * i) / n;
				const stagger = n > 8 && i % 2 ? 0.86 : 1;
				const x = 50 + Math.cos(angle) * 38 * stagger;
				const y = 50 + Math.sin(angle) * 36 * stagger;
				const hostile = nb.views.some((v) => HOSTILE.has(v.edge.type));
				const secret = nb.views.every((v) => v.edge.secret);
				const ended = nb.views.every((v) => v.edge.status === 'ended');
				const line = document.createElementNS(ns, 'line');
				line.setAttribute('x1', '50');
				line.setAttribute('y1', '50');
				line.setAttribute('x2', String(x));
				line.setAttribute('y2', String(y));
				line.setAttribute('vector-effect', 'non-scaling-stroke');
				line.setAttribute('class', cx('ws-web__line', hostile && 'is-hostile', secret && 'is-secret', ended && 'is-ended').join(' '));
				svg.appendChild(line);
				lines.push(line);

				const schema = s.schemas.get(nb.other.typeId);
				const node = root.createEl('button', {
					cls: cx('ws-web__node', schema?.color && `ws-tint--${schema.color}`, hostile && 'is-hostile', ended && 'is-ended'),
					attr: { type: 'button', 'data-entity': nb.other.id },
				});
				node.style.left = `${x}%`;
				node.style.top = `${y}%`;
				avatar(node, ctx.app, nb.other, schema, { size: 'sm' });
				const t = node.createDiv({ cls: 'ws-web__text' });
				t.createDiv({ cls: 'ws-web__name', text: nb.other.name });
				const labels = [...new Set(nb.views.map((v) => v.label))];
				if (ctx.config.labels !== false) t.createDiv({ cls: 'ws-web__label', text: labels.join(' · ') });
				setTooltip(node, `${nb.other.name} — ${labels.join(', ')}${secret ? ' (secret)' : ''}${ended ? ' (ended)' : ''}`, { delay: 300 });
				node.addEventListener('click', (ev) => open(ctx, nb.other.id, ev));
				node.addEventListener('mouseenter', () => line.addClass('is-hot'));
				node.addEventListener('mouseleave', () => line.removeClass('is-hot'));
				node.addEventListener('focus', () => line.addClass('is-hot'));
				node.addEventListener('blur', () => line.removeClass('is-hot'));
			});

			const centerSchema = s.schemas.get(e.typeId);
			const center = root.createDiv({ cls: cx('ws-web__node ws-web__center', centerSchema?.color && `ws-tint--${centerSchema.color}`) });
			center.setCssStyles({ left: '50%' });
			center.setCssStyles({ top: '50%' });
			avatar(center, ctx.app, e, centerSchema, { size: 'md' });
			center.createDiv({ cls: 'ws-web__name', text: e.name });

			const foot = ctx.el.querySelector('.ws-web__foot') ?? ctx.el.createDiv({ cls: 'ws-web__foot' });
			foot.empty();
			const legend = foot.createDiv({ cls: 'ws-web__legend' });
			const k1 = legend.createSpan({ cls: 'ws-web__key' });
			k1.createSpan({ cls: 'ws-web__swatch' });
			k1.createSpan({ text: 'Connection' });
			if (shown.some((nb) => nb.views.some((v) => HOSTILE.has(v.edge.type)))) {
				const k = legend.createSpan({ cls: 'ws-web__key' });
				k.createSpan({ cls: 'ws-web__swatch is-hostile' });
				k.createSpan({ text: 'Rivalry or enmity' });
			}
			if (shown.some((nb) => nb.views.every((v) => v.edge.secret))) {
				const k = legend.createSpan({ cls: 'ws-web__key' });
				k.createSpan({ cls: 'ws-web__swatch is-secret' });
				k.createSpan({ text: 'Secret' });
			}
			if (all.length > shown.length) foot.createDiv({ cls: 'ws-web__more', text: `+${all.length - shown.length} more in Connections` });
			ctx.setTitle(`Relationships · ${all.length}`);
		};
		paint();
		watchNetwork(ctx, paint);
	},
};

// ── Roster table ───────────────────────────────────────────────────────────────

function relationFields(schema: EntitySchema | undefined): FieldDefinition[] {
	return (schema?.fields ?? []).filter((f) => RELATION_KINDS.includes(f.type) && !f.hidden);
}

/** Fields of the types a relation field links to, as "Type · Field" column choices. */
function columnOptions(s: WorldSession, schema: EntitySchema | undefined): Array<{ id: string; label: string }> {
	const out: Array<{ id: string; label: string }> = [{ id: '__status', label: 'Status' }, { id: '__summary', label: 'Connection summary' }];
	const types = new Set<string>();
	for (const f of relationFields(schema)) for (const t of (f.config?.targetTypes as string[] | undefined) ?? []) types.add(t);
	if (relationFields(schema).some((f) => f.type === 'children' || !(f.config?.targetTypes as string[] | undefined)?.length)) for (const sc of s.schemas.list()) types.add(sc.id);
	for (const t of types) {
		const sc = s.schemas.get(t);
		if (!sc) continue;
		for (const f of sc.fields) if (!f.hidden && !['richtext', 'longtext', 'gallery', 'image', 'file'].includes(f.type)) out.push({ id: `${sc.id}.${f.id}`, label: `${sc.singular} · ${f.label}` });
	}
	return out;
}

export const rosterBlock: BlockDefinition = {
	id: 'roster',
	name: 'Roster table',
	icon: 'table-2',
	category: 'Connections',
	description: 'Linked entries as a table with their own fields — a faction’s members with rank, status and home.',
	hint: 'Linked entries as a table',
	surfaces: ['entity'],
	frame: 'card',
	defaultSize: { w: 12, h: 1 },
	defaultConfig: { field: null, columns: null, sort: 'name' },
	configFields: (s, scope) => [
		{ id: 'field', type: 'select', label: 'Which links', config: { options: relationFields(scope?.schema).map((f) => ({ id: f.id, label: f.label })) } },
		{ id: 'columns', type: 'multiselect', label: 'Columns', width: 'full', description: 'Empty = each linked type’s card fields.', config: { options: columnOptions(s, scope?.schema) } },
	],
	title: (ctx) => ctx.schema?.fields.find((f) => f.id === ctx.config.field)?.label ?? 'Roster',
	render(ctx) {
		const s = ctx.session;
		const schema = ctx.schema;
		if (!schema || !ctx.entity) return;
		const root = ctx.el.createDiv({ cls: 'ws-roster' });
		let sortBy = typeof ctx.config.sort === 'string' ? ctx.config.sort : 'name';
		let dir = 1;
		const pickField = (e: EntityRecord): FieldDefinition | undefined => {
			const fields = relationFields(schema);
			const wanted = fields.find((f) => f.id === ctx.config.field);
			if (wanted) return wanted;
			// Default: the link field with the most entries on this page.
			let best: FieldDefinition | undefined;
			let n = 0;
			for (const f of fields) {
				const v = s.values.get(e, f);
				const len = Array.isArray(v) ? v.length : 0;
				if (len > n) {
					n = len;
					best = f;
				}
			}
			return best ?? fields[0];
		};
		const paint = () => {
			root.empty();
			const e = currentEntity(ctx);
			if (!e) return;
			const field = pickField(e);
			if (!field) {
				emptyState(root, { icon: 'table-2', title: `${schema.plural} have no link fields`, body: 'Add a relation field in Type Studio to list linked entries here.', compact: true });
				return;
			}
			ctx.setTitle(field.label);
			const linked = (s.values.get(e, field) as LinkedEntry[] | undefined) ?? [];
			const views = field.type === 'relation' ? s.relations.fieldViews(e.id, field) : [];
			const edgeOf = new Map(views.map((v) => [v.other.id, v.edge]));
			const rows = linked.map((l) => s.entities.get(l.id)).filter((x): x is EntityRecord => !!x && !x.trashedAt);
			if (!rows.length) {
				emptyState(root, {
					icon: 'users',
					title: `No ${field.label.toLowerCase()} yet`,
					actionLabel: `Link ${field.label.toLowerCase()}`,
					onAction: () => revealField(ctx.el, field.id),
					compact: true,
				});
				return;
			}
			// Columns: chosen, else each linked type's card fields.
			const chosen = Array.isArray(ctx.config.columns) && ctx.config.columns.length ? (ctx.config.columns as string[]) : null;
			type Col = { id: string; label: string; get: (r: EntityRecord) => string; render?: (cell: HTMLElement, r: EntityRecord) => boolean };
			const cols: Col[] = [];
			const valueCol = (typeId: string | null, fieldId: string, label: string): Col => ({
				id: `${typeId ?? '*'}.${fieldId}`,
				label,
				get: (r) => {
					if (typeId && r.typeId !== typeId) return '';
					const f = s.schemas.get(r.typeId)?.fields.find((x) => x.id === fieldId);
					return f ? ctx.ws.fieldTypes.toText(f, s.values.get(r, f)) : '';
				},
				render: (cell, r) => {
					if (typeId && r.typeId !== typeId) return false;
					const f = s.schemas.get(r.typeId)?.fields.find((x) => x.id === fieldId);
					if (!f) return false;
					const v = s.values.get(r, f);
					if (ctx.ws.fieldTypes.isEmpty(f, v)) return false;
					const ui = ctx.ws.fieldTypes.for(f).ui;
					if (ui && ['select', 'multiselect', 'tags', 'relation', 'parent'].includes(f.type)) ui.renderDisplay(cell, v, { app: ctx.app, field: f, entity: r, component: ctx.component });
					else cell.setText(ctx.ws.fieldTypes.toText(f, v));
					return true;
				},
			});
			const statusCol: Col = {
				id: '__status',
				label: 'Status',
				get: (r) => s.world.statuses.find((x) => x.id === r.status)?.label ?? '',
			};
			const summaryCol: Col = { id: '__summary', label: 'Connection', get: (r) => edgeOf.get(r.id)?.description ?? '' };
			if (chosen) {
				for (const id of chosen) {
					if (id === '__status') cols.push(statusCol);
					else if (id === '__summary') cols.push(summaryCol);
					else {
						const [typeId, fieldId] = id.split('.');
						const f = s.schemas.get(typeId ?? '')?.fields.find((x) => x.id === fieldId);
						if (f && typeId && fieldId) cols.push(valueCol(typeId, fieldId, f.label));
					}
				}
			} else {
				const seen = new Set<string>();
				for (const r of rows) {
					const sc = s.schemas.get(r.typeId);
					for (const fid of sc?.display.cardFields ?? []) {
						const f = sc?.fields.find((x) => x.id === fid);
						if (!f || seen.has(f.label)) continue;
						seen.add(f.label);
						cols.push(valueCol(null, fid, f.label));
					}
				}
				cols.splice(4);
				if (views.some((v) => v.edge.description)) cols.push(summaryCol);
			}

			const sorted = [...rows].sort((a, b) => {
				if (sortBy === 'name') return dir * a.name.localeCompare(b.name);
				const c = cols.find((x) => x.id === sortBy);
				return c ? dir * c.get(a).localeCompare(c.get(b), undefined, { numeric: true }) || a.name.localeCompare(b.name) : 0;
			});

			const wrap = root.createDiv({ cls: 'ws-table-wrap ws-roster__wrap' });
			const table = wrap.createEl('table', { cls: 'ws-table ws-roster__table' });
			const head = table.createEl('thead').createEl('tr');
			const th = (id: string, label: string) => {
				const cell = head.createEl('th', { attr: { scope: 'col' } });
				const b = cell.createEl('button', { cls: 'ws-table__sort', attr: { type: 'button' } });
				b.createSpan({ text: label });
				if (sortBy === id) {
					cell.setAttr('aria-sort', dir > 0 ? 'ascending' : 'descending');
					icon(b, dir > 0 ? 'arrow-up' : 'arrow-down', 'ws-table__sort-icon');
				}
				b.addEventListener('click', () => {
					dir = sortBy === id ? -dir : 1;
					sortBy = id;
					paint();
				});
			};
			th('name', 'Name');
			for (const c of cols) th(c.id, c.label);
			const body = table.createEl('tbody');
			for (const r of sorted) {
				const sc = s.schemas.get(r.typeId);
				const tr = body.createEl('tr', { cls: 'ws-table__row', attr: { tabindex: '0', 'data-entity': r.id } });
				const name = tr.createEl('td').createDiv({ cls: 'ws-table__name' });
				avatar(name, ctx.app, r, sc, { size: 'xs' });
				name.createSpan({ text: r.name });
				const edge = edgeOf.get(r.id);
				if (edge?.secret) icon(name, 'eye-off', 'ws-roster__flag');
				for (const c of cols) {
					const td = tr.createEl('td');
					if (c.id === '__status') {
						const st = s.world.statuses.find((x) => x.id === r.status);
						if (st) td.createSpan({ cls: cx('ws-roster__status', `ws-tint--${st.color}`), text: st.label });
						continue;
					}
					let ok: boolean;
					if (c.render) ok = c.render(td, r);
					else {
						const text = c.get(r);
						td.setText(text);
						ok = !!text;
					}
					if (!ok || !td.textContent) {
						td.empty();
						td.createSpan({ cls: 'ws-field-display is-empty', text: '—' });
					}
				}
				tr.addEventListener('click', (ev) => {
					if ((ev.target as HTMLElement).closest('a, button')) return;
					open(ctx, r.id, ev);
				});
				tr.addEventListener('keydown', (ev) => ev.key === 'Enter' && open(ctx, r.id, ev));
			}
			const foot = root.createDiv({ cls: 'ws-roster__foot' });
			foot.createSpan({ text: `${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}` });
			const add = foot.createEl('button', { cls: 'ws-link-btn', text: `Link more ${field.label.toLowerCase()}`, attr: { type: 'button' } });
			add.addEventListener('click', () => revealField(ctx.el, field.id));
		};
		paint();
		watchNetwork(ctx, paint, true);
	},
};

// ── Shared connections ─────────────────────────────────────────────────────────

export const sharedConnectionsBlock: BlockDefinition = {
	id: 'shared-connections',
	name: 'Shared connections',
	icon: 'git-fork',
	category: 'Connections',
	description: 'Entries that know the same people and places as this one — “also connected to the Night Guard”.',
	hint: 'Who shares your connections',
	surfaces: ['entity'],
	frame: 'card',
	defaultSize: { w: 4, h: 1 },
	defaultConfig: { limit: 8, includeDirect: false },
	configFields: [
		{ id: 'limit', type: 'number', label: 'Most shown', config: { min: 1, max: 40 } },
		{ id: 'includeDirect', type: 'boolean', label: 'Include entries already connected to this one' },
	],
	title: () => 'Shared connections',
	render(ctx) {
		const s = ctx.session;
		if (!ctx.entity) return;
		const root = ctx.el.createDiv({ cls: 'ws-shared' });
		const paint = () => {
			root.empty();
			const e = currentEntity(ctx);
			if (!e) return;
			const direct = new Map(neighbours(s, e.id).map((n) => [n.other.id, n.other]));
			const score = new Map<string, { other: EntityRecord; via: EntityRecord[] }>();
			for (const mid of direct.values()) {
				for (const nb of neighbours(s, mid.id)) {
					const m = nb.other;
					if (m.id === e.id || m.trashedAt) continue;
					if (!ctx.config.includeDirect && direct.has(m.id)) continue;
					const cur = score.get(m.id) ?? { other: m, via: [] };
					if (!cur.via.some((v) => v.id === mid.id)) cur.via.push(mid);
					score.set(m.id, cur);
				}
			}
			const list = [...score.values()].sort((a, b) => b.via.length - a.via.length || a.other.name.localeCompare(b.other.name));
			const limit = Math.max(1, typeof ctx.config.limit === 'number' ? ctx.config.limit : 8);
			if (!list.length) {
				emptyState(root, { icon: 'git-fork', title: 'Nothing shared yet', body: 'Entries appear here when the people and places this one is connected to are connected to others too.', compact: true });
				return;
			}
			for (const item of list.slice(0, limit)) {
				const sc = s.schemas.get(item.other.typeId);
				const row = root.createEl('button', { cls: 'ws-shared__row', attr: { type: 'button', 'data-entity': item.other.id } });
				avatar(row, ctx.app, item.other, sc, { size: 'sm' });
				const t = row.createDiv({ cls: 'ws-shared__text' });
				t.createDiv({ cls: 'ws-shared__name', text: item.other.name });
				const names = item.via.map((v) => v.name);
				t.createDiv({ cls: 'ws-shared__via', text: `via ${names.slice(0, 2).join(', ')}${names.length > 2 ? ` +${names.length - 2}` : ''}` });
				row.createSpan({ cls: 'ws-shared__count', text: String(item.via.length), attr: { 'aria-label': `${item.via.length} shared` } });
				setTooltip(row, `${item.other.name} — shares ${names.join(', ')}`, { delay: 400 });
				row.addEventListener('click', (ev) => open(ctx, item.other.id, ev));
			}
			if (list.length > limit) root.createDiv({ cls: 'ws-shared__more', text: `+${list.length - limit} more` });
		};
		paint();
		watchNetwork(ctx, paint, true);
	},
};
