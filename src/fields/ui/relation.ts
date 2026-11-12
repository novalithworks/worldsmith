import { Keymap, Menu, Notice, setIcon, setTooltip } from 'obsidian';
import type { EntityRecord, FieldDefinition, LinkedEntry } from '../../core/types';
import { isChronoDate } from '../../core/types';
import { own } from '../../ui/components/lifecycle';
import { avatar } from '../../ui/components/avatar';
import { cx, icon, nameRegion } from '../../ui/components/dom';
import { EntityPicker } from '../../ui/components/EntityPicker';
import { actionNotice } from '../../ui/components/notice';
import { ROUTES } from '../../state/route';
import { relationConfig, type EdgeView } from '../../services/RelationService';
import { rollupConfig } from '../../services/FieldValues';
import type { FieldEditorContext, FieldEditorHandle, FieldHost, FieldRenderContext, FieldTypeUI } from '../FieldType';

const asLinked = (v: unknown): LinkedEntry[] => (Array.isArray(v) ? (v as LinkedEntry[]) : []);

/** Compact read-only list for tables, previews and settings dialogs. */
function renderLinkedPills(el: HTMLElement, value: unknown): void {
	const linked = asLinked(value);
	if (!linked.length) {
		el.createSpan({ cls: 'ws-field-display is-empty', text: '—' });
		return;
	}
	const wrap = el.createDiv({ cls: 'ws-rel-pills' });
	for (const l of linked.slice(0, 6)) wrap.createSpan({ cls: 'ws-rel-pill', text: l.name });
	if (linked.length > 6) wrap.createSpan({ cls: 'ws-rel-pill is-more', text: `+${linked.length - 6}` });
}

/** Re-render when connections of `entityId`, or entries it shows, change. */
function watchLinks(ctx: FieldRenderContext, host: FieldHost, entityId: string, shown: () => Set<string>, render: () => void): void {
	const ev = host.session.events;
	let queued = false;
	const later = () => {
		if (queued) return;
		queued = true;
		window.requestAnimationFrame(() => {
			queued = false;
			render();
		});
	};
	const touches = (e: { from: string; to: string }) => e.from === entityId || e.to === entityId;
	own(ctx.component, ev.on('edge:created', ({ edge }) => touches(edge) && later()));
	own(ctx.component, ev.on('edge:deleted', ({ edge }) => touches(edge) && later()));
	own(ctx.component, ev.on('edge:updated', ({ edge, prev }) => (touches(edge) || touches(prev)) && later()));
	own(
		ctx.component,
		ev.on('entity:updated', ({ entity, change }) => {
			if (entity.id === entityId && change.keys.includes('parentId')) return later();
			if (shown().has(entity.id) && change.keys.some((k) => k === 'name' || k === 'media' || k === 'trashedAt' || k === 'archivedAt' || k === 'parentId')) later();
		}),
	);
	own(ctx.component, ev.on('entity:created', ({ entity }) => entity.parentId === entityId && later()));
	own(ctx.component, ev.on('entity:deleted', ({ entity }) => shown().has(entity.id) && later()));
}

interface ChipOpts {
	host: FieldHost;
	entity: EntityRecord;
	view?: EdgeView;
	onRemove?: () => void;
	removeLabel?: string;
}

function chip(parent: HTMLElement, o: ChipOpts): HTMLElement {
	const { host, entity } = o;
	const schema = host.session.schemas.get(entity.typeId);
	const edge = o.view?.edge;
	const el = parent.createDiv({
		cls: cx(
			'ws-rel-chip',
			schema?.color ? `ws-tint--${schema.color}` : 'ws-tint--gray',
			!!entity.archivedAt && 'is-archived',
			edge?.secret && 'is-secret',
			edge?.status === 'ended' && 'is-ended',
		),
		attr: { role: 'listitem' },
	});
	const open = el.createEl('button', { cls: 'ws-rel-chip__main', attr: { type: 'button', 'aria-label': `Open ${entity.name}` } });
	avatar(open, host.ws.app, entity, schema, { size: 'xs' });
	open.createSpan({ cls: 'ws-rel-chip__name', text: entity.name });
	if (edge?.secret) icon(open, 'eye-off', 'ws-rel-chip__flag');
	const tip = [edge?.description, edge?.status && edge.status !== 'active' ? `Status: ${edge.status}` : '', schema?.singular].filter(Boolean).join(' · ');
	if (tip) setTooltip(open, tip, { delay: 450 });
	open.addEventListener('click', (evt) => host.navigate(ROUTES.entity(entity.id), Keymap.isModEvent(evt) ? 'tab' : false));
	open.addEventListener('auxclick', (evt) => {
		if (evt.button === 1) host.navigate(ROUTES.entity(entity.id), 'tab');
	});
	const menu = (evt: MouseEvent) => {
		evt.preventDefault();
		const m = new Menu();
		m.addItem((i) => i.setTitle('Open').setIcon('arrow-up-right').onClick(() => host.navigate(ROUTES.entity(entity.id))));
		m.addItem((i) => i.setTitle('Open in new tab').setIcon('file-plus-2').onClick(() => host.navigate(ROUTES.entity(entity.id), 'tab')));
		if (edge) m.addItem((i) => i.setTitle('Connection details…').setIcon('link-2').onClick(() => host.navigate(ROUTES.relation(edge.id))));
		if (o.onRemove) {
			m.addSeparator();
			m.addItem((i) => i.setTitle(o.removeLabel ?? 'Remove').setIcon('x').setWarning(true).onClick(() => o.onRemove?.()));
		}
		m.showAtMouseEvent(evt);
	};
	el.addEventListener('contextmenu', menu);
	const acts = edge || o.onRemove ? el.createDiv({ cls: 'ws-rel-chip__actions' }) : null;
	if (edge && acts) {
		const det = acts.createEl('button', { cls: 'ws-rel-chip__btn', attr: { type: 'button', 'aria-label': `Connection with ${entity.name}` } });
		setIcon(det, 'more-horizontal');
		det.addEventListener('click', menu);
	}
	if (o.onRemove && acts) {
		const x = acts.createEl('button', { cls: 'ws-rel-chip__btn ws-rel-chip__remove', attr: { type: 'button', 'aria-label': `${o.removeLabel ?? 'Remove'} ${entity.name}` } });
		setIcon(x, 'x');
		x.addEventListener('click', (evt) => {
			evt.stopPropagation();
			o.onRemove?.();
		});
	}
	return el;
}

// ── relation ─────────────────────────────────────────────────────────────────

export const relationUI: FieldTypeUI = {
	renderDisplay: (el, value) => renderLinkedPills(el, value),
	createEditor(el, ctx): FieldEditorHandle {
		const host = ctx.host;
		const entity0 = ctx.entity;
		if (!host || !entity0) {
			renderLinkedPills(el, ctx.value);
			return { setValue() {}, focus() {} };
		}
		const R = host.session.relations;
		const root = el.createDiv({ cls: 'ws-rel', attr: { role: 'list'} });
		nameRegion(root, ctx.field.label );
		let addBtn: HTMLButtonElement | null = null;
		let shownIds = new Set<string>();
		const field = () => host.session.schemas.get(entity0.typeId)?.fields.find((f) => f.id === ctx.field.id) ?? ctx.field;

		const render = () => {
			const f = field();
			const cfg = relationConfig(f);
			root.empty();
			if (!cfg.relationType || !R.type(cfg.relationType)) {
				const n = root.createDiv({ cls: 'ws-rel__setup' });
				icon(n, 'settings-2');
				n.createSpan({ text: 'Not set up yet — choose what it links to in the field’s settings.' });
				return;
			}
			const views = R.fieldViews(entity0.id, f);
			shownIds = new Set(views.map((v) => v.other.id));
			for (const v of views) {
				chip(root, {
					host,
					entity: v.other,
					view: v,
					onRemove: () => {
						const removed = R.unlink(v.edge.id);
						if (removed) actionNotice(`Unlinked ${v.other.name}.`, { label: 'Undo', run: () => R.restore([removed]) });
					},
				});
			}
			const single = cfg.max === 1;
			const full = cfg.max !== null && cfg.max > 1 && views.length >= cfg.max;
			if (full) return;
			addBtn = root.createEl('button', {
				cls: cx('ws-rel__add', views.length ? 'is-compact' : ''),
				attr: { type: 'button', 'aria-label': single && views.length ? `Change ${f.label}` : `Link ${f.label}` },
			});
			icon(addBtn, single && views.length ? 'replace' : 'plus');
			if (!views.length) addBtn.createSpan({ text: f.placeholder || `Link ${f.label.toLowerCase()}…` });
			addBtn.addEventListener('click', () => openPicker());
		};

		const openPicker = () => {
			if (!addBtn) return;
			const f = field();
			const cfg = relationConfig(f);
			const entity = host.session.entities.get(entity0.id) ?? entity0;
			const exclude = new Set<string>([entity.id, ...shownIds]);
			if (cfg.max === 1) for (const id of shownIds) exclude.delete(id);
			new EntityPicker(addBtn, {
				session: host.session,
				app: host.ws.app,
				typeIds: cfg.targetTypes,
				exclude,
				placeholder: `Link ${f.label.toLowerCase()}…`,
				createTypes: cfg.targetTypes.length ? cfg.targetTypes : [],
				onPick: (target) => {
					const res = R.link(entity.id, f, target.id);
					if (res.error) {
						new Notice(res.error);
						return;
					}
					if (res.replaced.length) {
						const edge = res.edge;
						actionNotice(`${f.label}: ${target.name}.`, {
							label: 'Undo',
							run: () => {
								if (edge) R.unlink(edge.id);
								R.restore(res.replaced);
							},
						});
					}
					window.setTimeout(() => (root.querySelector('.ws-rel__add'))?.focus(), 30);
				},
			});
		};

		render();
		watchLinks(ctx, host, entity0.id, () => shownIds, render);
		return {
			setValue: () => render(),
			focus: () => addBtn?.focus(),
		};
	},
};

// ── parent / nested entries ───────────────────────────────────────────────────

function descendantsOf(host: FieldHost, id: string): Set<string> {
	const out = new Set<string>();
	const stack = [id];
	while (stack.length) {
		const cur = stack.pop() as string;
		for (const c of host.session.index.childrenOf(cur)) {
			if (out.has(c.id)) continue;
			out.add(c.id);
			stack.push(c.id);
		}
	}
	return out;
}

export const parentUI: FieldTypeUI = {
	renderDisplay: (el, value) => renderLinkedPills(el, value),
	createEditor(el, ctx): FieldEditorHandle {
		const host = ctx.host;
		const entity0 = ctx.entity;
		if (!host || !entity0) {
			renderLinkedPills(el, ctx.value);
			return { setValue() {}, focus() {} };
		}
		const S = host.session;
		const root = el.createDiv({ cls: 'ws-rel', attr: { role: 'list' } });
		let addBtn: HTMLButtonElement | null = null;
		let shown = new Set<string>();
		const render = () => {
			root.empty();
			const e = S.entities.get(entity0.id) ?? entity0;
			const parent = e.parentId ? S.entities.get(e.parentId) : undefined;
			shown = new Set(parent ? [parent.id] : []);
			if (parent && !parent.trashedAt) {
				chip(root, {
					host,
					entity: parent,
					removeLabel: 'Move to top level',
					onRemove: () => {
						const prev = e.parentId;
						S.entityService.update(e.id, { parentId: null });
						actionNotice(`${e.name} moved to the top level.`, { label: 'Undo', run: () => S.entityService.update(e.id, { parentId: prev }) });
					},
				});
			}
			addBtn = root.createEl('button', { cls: cx('ws-rel__add', parent ? 'is-compact' : ''), attr: { type: 'button', 'aria-label': 'Place inside…' } });
			icon(addBtn, parent ? 'replace' : 'corner-left-up');
			if (!parent) addBtn.createSpan({ text: 'Place inside…' });
			addBtn.addEventListener('click', () => {
				const schema = S.schemas.get(e.typeId);
				const exclude = descendantsOf(host, e.id);
				exclude.add(e.id);
				if (!addBtn) return;
				new EntityPicker(addBtn, {
					session: S,
					app: host.ws.app,
					typeIds: schema?.hierarchy.parentTypes ?? [],
					exclude,
					placeholder: `Place ${e.name} inside…`,
					onPick: (p) => S.entityService.update(e.id, { parentId: p.id }),
				});
			});
		};
		render();
		watchLinks(ctx, host, entity0.id, () => shown, render);
		return { setValue: render, focus: () => addBtn?.focus() };
	},
};

export const childrenUI: FieldTypeUI = {
	renderDisplay: (el, value) => renderLinkedPills(el, value),
	createEditor(el, ctx): FieldEditorHandle {
		const host = ctx.host;
		const entity0 = ctx.entity;
		if (!host || !entity0) {
			renderLinkedPills(el, ctx.value);
			return { setValue() {}, focus() {} };
		}
		const S = host.session;
		const root = el.createDiv({ cls: 'ws-rel', attr: { role: 'list' } });
		let addBtn: HTMLButtonElement | null = null;
		let shown = new Set<string>();
		const render = () => {
			root.empty();
			const kids = S.index.childrenOf(entity0.id);
			shown = new Set(kids.map((k) => k.id));
			for (const k of kids) {
				chip(root, {
					host,
					entity: k,
					removeLabel: 'Take out',
					onRemove: () => {
						S.entityService.update(k.id, { parentId: null });
						actionNotice(`${k.name} is no longer inside ${entity0.name}.`, { label: 'Undo', run: () => S.entityService.update(k.id, { parentId: entity0.id }) });
					},
				});
			}
			addBtn = root.createEl('button', { cls: cx('ws-rel__add', kids.length ? 'is-compact' : ''), attr: { type: 'button', 'aria-label': 'Nest an entry here' } });
			icon(addBtn, 'plus');
			if (!kids.length) addBtn.createSpan({ text: 'Nest an entry here…' });
			addBtn.addEventListener('click', () => {
				if (!addBtn) return;
				const schema = S.schemas.get(entity0.typeId);
				// Ancestors can't become children (no cycles).
				const exclude = new Set<string>([entity0.id, ...shown]);
				let cur = S.entities.get(entity0.id)?.parentId ?? null;
				while (cur && !exclude.has(cur)) {
					exclude.add(cur);
					cur = S.entities.get(cur)?.parentId ?? null;
				}
				const kinds = schema?.hierarchy.childTypes ?? [];
				new EntityPicker(addBtn, {
					session: S,
					app: host.ws.app,
					typeIds: kinds,
					exclude,
					createTypes: kinds.length ? kinds : [entity0.typeId],
					placeholder: `Nest inside ${entity0.name}…`,
					onPick: (child) => S.entityService.update(child.id, { parentId: entity0.id }),
				});
			});
		};
		render();
		watchLinks(ctx, host, entity0.id, () => shown, render);
		return { setValue: render, focus: () => addBtn?.focus() };
	},
};

// ── rollup ────────────────────────────────────────────────────────────────────

function renderRollup(el: HTMLElement, field: FieldDefinition, value: unknown, toText: (v: unknown) => string): void {
	el.empty();
	const cfg = rollupConfig(field);
	if (!cfg.relationField) {
		const n = el.createDiv({ cls: 'ws-rel__setup' });
		icon(n, 'settings-2');
		n.createSpan({ text: 'Choose what to summarise in the field’s settings.' });
		return;
	}
	if (value == null || (Array.isArray(value) && !value.length)) {
		el.createSpan({ cls: 'ws-field-display is-empty', text: '—' });
		return;
	}
	if (Array.isArray(value)) {
		const wrap = el.createDiv({ cls: 'ws-rel-pills' });
		for (const v of value.slice(0, 24)) wrap.createSpan({ cls: 'ws-rel-pill', text: String(v) });
		if (value.length > 24) wrap.createSpan({ cls: 'ws-rel-pill is-more', text: `+${value.length - 24}` });
		return;
	}
	el.createSpan({ cls: cx('ws-rollup', typeof value === 'number' && 'is-number', isChronoDate(value) && 'is-date'), text: toText(value) });
}

export const rollupUI: FieldTypeUI = {
	renderDisplay(el, value, ctx) {
		renderRollup(el, ctx.field, value, (v) => (typeof v === 'number' ? String(v) : isChronoDate(v) ? '' : String(v)));
	},
	createEditor(el, ctx: FieldEditorContext): FieldEditorHandle {
		const host = ctx.host;
		const entity0 = ctx.entity;
		const root = el.createDiv({ cls: 'ws-rollup-wrap', attr: { 'aria-live': 'polite' } });
		const fieldNow = () => (entity0 && host?.session.schemas.get(entity0.typeId)?.fields.find((f) => f.id === ctx.field.id)) || ctx.field;
		let linkedIds = new Set<string>();
		const render = () => {
			const f = fieldNow();
			if (!host || !entity0) {
				renderRollup(root, f, ctx.value, (v) => String(v ?? ''));
				return;
			}
			const e = host.session.entities.get(entity0.id) ?? entity0;
			const value = host.session.values.get(e, f);
			renderRollup(root, f, value, (v) => host.ws.fieldTypes.toText(f, v));
			// Track linked entries so their edits refresh the summary.
			const cfg = rollupConfig(f);
			const via = host.session.schemas.get(e.typeId)?.fields.find((x) => x.id === cfg.relationField);
			linkedIds = new Set(via ? asLinked(host.session.values.get(e, via)).map((l) => l.id) : []);
		};
		render();
		if (host && entity0) {
			watchLinks(ctx, host, entity0.id, () => linkedIds, render);
			let queued = false;
			own(
				ctx.component,
				host.session.events.on('entity:updated', ({ entity, change }) => {
					if (!linkedIds.has(entity.id) || !change.keys.some((k) => k.startsWith('values.')) || queued) return;
					queued = true;
					window.requestAnimationFrame(() => {
						queued = false;
						render();
					});
				}),
			);
		}
		return { setValue: render, focus() {} };
	},
};

// ── formula (planned) ─────────────────────────────────────────────────────────

export const formulaUI: FieldTypeUI = {
	renderDisplay(el) {
		el.createSpan({ cls: 'ws-field-display is-empty', text: '—' });
	},
	createEditor(el) {
		const row = el.createDiv({ cls: 'ws-rel__setup' });
		icon(row, 'function-square');
		row.createSpan({ text: 'Formulas arrive in a later update.' });
		return { setValue() {}, focus() {} };
	},
};
